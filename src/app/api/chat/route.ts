import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from 'ai';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getCurrentUser, jsonError } from '@/lib/auth';
import { asDraft, assessCompleteness, brdPatchSchema, denormalise, formatRef, mergeBrd } from '@/lib/brd';
import { buildKatoSystemPrompt } from '@/lib/kato-prompt';
import { getModel } from '@/lib/llm';
import { prisma } from '@/lib/prisma';
import { redactMessages } from '@/lib/redact';

export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z.object({
  requestId: z.string().min(1),
  messages: z.array(z.any()).min(1).max(200),
});

const MAX_USER_CHARS = 8000;
const HISTORY_WINDOW = 40;

const textOf = (m: UIMessage) =>
  m.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'Unauthenticated');

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'Invalid request body');
  const { requestId } = parsed.data;
  const incoming = parsed.data.messages as UIMessage[];

  const fr = await prisma.featureRequest.findUnique({ where: { id: requestId } });
  if (!fr || fr.requesterId !== user.id) return jsonError(404, 'Request not found');
  if (fr.status !== 'DRAFT') return jsonError(409, 'This request has been submitted and is read-only');

  const last = incoming.at(-1);
  if (!last || last.role !== 'user') return jsonError(400, 'Last message must be from the user');
  if (textOf(last).length > MAX_USER_CHARS) return jsonError(413, `Messages are limited to ${MAX_USER_CHARS} characters`);

  // ── Guardrail: redact secrets/PII BEFORE persistence and BEFORE the LLM sees anything
  const { messages: safe, lastCount: redactions } = redactMessages(incoming);
  const safeLast = safe.at(-1)!;

  await prisma.conversationMessage.createMany({
    data: [
      {
        id: safeLast.id,
        requestId,
        role: 'USER',
        content: textOf(safeLast),
        parts: safeLast.parts as unknown as Prisma.InputJsonValue,
        redactions,
      },
    ],
    skipDuplicates: true, // client resends on regenerate; transcript rows are immutable
  });

  let draft = asDraft(fr.draftBrd);
  const { model, id: modelId } = getModel();
  const reference = formatRef(fr.number);

  const result = streamText({
    model,
    system: buildKatoSystemPrompt({
      user: { name: user.name, email: user.email, department: user.department, opco: user.opco },
      draft,
      missing: assessCompleteness(draft).missing,
      reference,
    }),
    messages: convertToModelMessages(safe.slice(-HISTORY_WINDOW)),
    temperature: 0.3,
    stopWhen: stepCountIs(4),
    tools: {
      updateBRD: tool({
        description:
          'Create or update fields of the Business Requirements Document shown live to the requester. ' +
          'Send only changed fields; list fields must contain the FULL updated list.',
        inputSchema: brdPatchSchema,
        execute: async (patch) => {
          draft = mergeBrd(draft, patch);
          const c = assessCompleteness(draft);
          await prisma.featureRequest.update({
            where: { id: requestId },
            data: { draftBrd: draft as unknown as Prisma.InputJsonValue, completeness: c.percent, ...denormalise(draft) },
          });
          return { saved: true, completeness: c.percent, stillMissing: c.missing };
        },
      }),
    },
    onError: ({ error }) => console.error('[chat] stream error', requestId, error),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: incoming,
    messageMetadata: ({ part }) => (part.type === 'start' ? { redactions } : undefined),
    onFinish: async ({ responseMessage }) => {
      await prisma.conversationMessage.createMany({
        data: [
          {
            id: responseMessage.id,
            requestId,
            role: 'ASSISTANT',
            content: textOf(responseMessage),
            parts: responseMessage.parts as unknown as Prisma.InputJsonValue,
            model: modelId,
          },
        ],
        skipDuplicates: true,
      });
    },
  });
}
