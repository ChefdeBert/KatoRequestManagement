import { getServerSession, type NextAuthOptions } from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import OktaProvider from 'next-auth/providers/okta';
import CredentialsProvider from 'next-auth/providers/credentials';
import type { OpCo, Role } from '@prisma/client';
import { prisma } from './prisma';
import { csv } from './utils';

type SsoClaims = {
  sub?: string;
  oid?: string;
  email?: string;
  preferred_username?: string;
  upn?: string;
  name?: string;
  department?: string;
  companyName?: string;
  organization?: string;
  jobTitle?: string;
  title?: string;
  groups?: string[];
};

// ── Metadata mapping ────────────────────────────────────────────────

const OPCO_MATCHERS: [RegExp, OpCo][] = [
  [/liquid\s*c2/i, 'LIQUID_C2'],
  [/liquid/i, 'LIQUID_INTELLIGENT_TECHNOLOGIES'],
  [/africa\s*data\s*cent|\badc\b/i, 'AFRICA_DATA_CENTRES'],
  [/sasai/i, 'SASAI_FINTECH'],
  [/cassava\s*ai/i, 'CASSAVA_AI'],
  [/cassava/i, 'CASSAVA_GROUP'],
];

export function resolveOpco(companyName?: string | null): OpCo | null {
  if (!companyName) return null;
  return OPCO_MATCHERS.find(([re]) => re.test(companyName))?.[1] ?? 'OTHER';
}

export function resolveRole(email: string, groups: string[] = []): Role {
  const have = new Set(groups.map((g) => g.toLowerCase()));
  const inAny = (list: string[]) => list.some((g) => have.has(g.toLowerCase()));
  if (inAny(csv(process.env.KATO_ADMIN_GROUPS)) || csv(process.env.KATO_ADMIN_EMAILS).map((e) => e.toLowerCase()).includes(email.toLowerCase()))
    return 'ADMIN';
  if (inAny(csv(process.env.KATO_REVIEWER_GROUPS))) return 'IT_REVIEWER';
  return 'REQUESTER';
}

/** Azure AD ID tokens don't carry department/companyName by default — fall back to Graph. */
async function fetchGraphProfile(accessToken: string): Promise<Partial<SsoClaims>> {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=department,companyName,jobTitle', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return {};
    const j = (await res.json()) as { department?: string; companyName?: string; jobTitle?: string };
    return { department: j.department ?? undefined, companyName: j.companyName ?? undefined, jobTitle: j.jobTitle ?? undefined };
  } catch {
    return {};
  }
}

async function hydrateUser(c: SsoClaims) {
  const email = (c.email ?? c.preferred_username ?? c.upn ?? '').toLowerCase();
  if (!email) throw new Error('SSO profile has no email');
  const data = {
    externalId: c.oid ?? c.sub ?? null,
    name: c.name ?? email,
    department: c.department ?? null,
    opco: resolveOpco(c.companyName ?? c.organization),
    jobTitle: c.jobTitle ?? c.title ?? null,
    role: resolveRole(email, c.groups),
    lastLoginAt: new Date(),
  };
  return prisma.user.upsert({ where: { email }, create: { email, ...data }, update: data });
}

// ── Providers ───────────────────────────────────────────────────────

const providers: NextAuthOptions['providers'] = [];

if (process.env.AZURE_AD_CLIENT_ID) {
  providers.push(
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID,
      authorization: { params: { scope: 'openid profile email offline_access User.Read' } },
    }),
  );
}

if (process.env.OKTA_CLIENT_ID) {
  providers.push(
    OktaProvider({
      clientId: process.env.OKTA_CLIENT_ID,
      clientSecret: process.env.OKTA_CLIENT_SECRET!,
      issuer: process.env.OKTA_ISSUER!,
      authorization: { params: { scope: 'openid profile email groups' } },
    }),
  );
}

const devLoginEnabled = process.env.KATO_DEV_LOGIN === 'true' && process.env.NODE_ENV !== 'production';
if (devLoginEnabled) {
  providers.push(
    CredentialsProvider({
      id: 'kato-dev',
      name: 'Kato dev login',
      credentials: { email: { label: 'Email', type: 'email' }, name: { label: 'Name', type: 'text' } },
      async authorize(creds) {
        if (!creds?.email) return null;
        return { id: creds.email, email: creds.email, name: creds.name || creds.email };
      },
    }),
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  pages: { signIn: '/signin', error: '/signin' },
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  callbacks: {
    async jwt({ token, account, profile, user }) {
      if (account) {
        let claims: SsoClaims =
          account.provider === 'kato-dev'
            ? { email: user.email ?? undefined, name: user.name ?? undefined, department: 'IT', companyName: 'Cassava Technologies' }
            : { ...(profile as SsoClaims) };

        if (account.provider === 'azure-ad' && account.access_token && (!claims.department || !claims.companyName)) {
          const graph = await fetchGraphProfile(account.access_token);
          claims = { ...graph, ...Object.fromEntries(Object.entries(claims).filter(([, v]) => v != null)) };
        }

        const dbUser = await hydrateUser(claims);
        token.uid = dbUser.id;
        token.role = dbUser.role;
        token.opco = dbUser.opco;
        token.department = dbUser.department;
        token.name = dbUser.name;
        token.email = dbUser.email;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        id: token.uid,
        role: token.role,
        opco: token.opco ?? null,
        department: token.department ?? null,
        name: token.name ?? '',
        email: token.email ?? '',
      };
      return session;
    },
  },
};

// ── Helpers ─────────────────────────────────────────────────────────

export type SessionUser = { id: string; role: Role; name: string; email: string; opco: OpCo | null; department: string | null };

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ? (session.user as SessionUser) : null;
}

export const isStaff = (role?: Role | null) => role === 'ADMIN' || role === 'IT_REVIEWER';

export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return Response.json({ error, ...extra }, { status });
}
