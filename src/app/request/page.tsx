import type { UIMessage } from 'ai';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { asDraft } from '@/lib/brd';
import { getOrCreateDraft } from '@/lib/lifecycle';
import { prisma } from '@/lib/prisma';
import { KatoWorkspace } from './kato-workspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New request · Kato' };

export default async function RequestPage({ searchParams }: { searchParams: Promise<{ id?: string; new?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/signin?callbackUrl=/request');

  const { id } = await searchParams;
  if (!id) {
    // Reuses an untouched draft so refreshing / "New request" doesn't pile up empty rows
    const draft = await getOrCreateDraft(user.id);
    redirect(`/request?id=${draft.id}`);
  }

  const [fr, myRequests] = await Promise.all([
    prisma.featureRequest.findFirst({
      where: { id, requesterId: user.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    }),
    prisma.featureRequest.findMany({
      where: { requesterId: user.id, messages: { some: {} } },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: { id: true, number: true, title: true, status: true },
    }),
  ]);
  if (!fr) notFound();

  const initialMessages: UIMessage[] = fr.messages.map((m) => ({
    id: m.id,
    role: m.role === 'USER' ? 'user' : 'assistant',
    parts: Array.isArray(m.parts) ? (m.parts as unknown as UIMessage['parts']) : [{ type: 'text', text: m.content }],
  }));

  return (
    <KatoWorkspace
      request={{
        id: fr.id,
        number: fr.number,
        status: fr.status,
        jiraIssueKey: fr.jiraIssueKey,
        jiraIssueUrl: fr.jiraIssueUrl,
        rejectionReason: fr.rejectionReason,
        submittedAt: fr.submittedAt?.toISOString() ?? null,
        confluencePageUrl: fr.confluencePageUrl,
      }}
      initialMessages={initialMessages}
      initialDraft={asDraft(fr.draftBrd)}
      user={{ name: user.name }}
      myRequests={myRequests}
    />
  );
}
