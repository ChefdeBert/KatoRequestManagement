import { UnrecoverableError } from 'bullmq';

/** Shared HTTP client for Atlassian Cloud (Jira + Confluence). */

export class AtlassianHttpError extends Error {
  constructor(
    public service: string,
    public status: number,
    public body: unknown,
  ) {
    super(`${service} HTTP ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`.slice(0, 2000));
  }
  /** 408/409/425/429/5xx are transient; other 4xx are payload/permission problems → DLQ immediately. */
  get retryable() {
    return this.status >= 500 || [408, 409, 425, 429].includes(this.status);
  }
}

export const basicAuth = (email: string, token: string) => 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

const safeJson = (t: string) => {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};

export async function atlassianFetch<T>(
  service: 'Jira' | 'Confluence',
  baseUrl: string,
  auth: string,
  path: string,
  init: RequestInit & { allow404?: boolean } = {},
): Promise<T | null> {
  const { allow404, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...rest,
      headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json', ...rest.headers },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new Error(`${service} network error: ${(err as Error).message}`); // retryable
  }
  if (res.status === 404 && allow404) return null;
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const e = new AtlassianHttpError(service, res.status, body);
    throw e.retryable ? e : new UnrecoverableError(e.message);
  }
  return body as T;
}
