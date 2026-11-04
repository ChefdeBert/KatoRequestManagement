// Client-safe route metadata (no server imports).
import type { DevelopmentRoute } from '@prisma/client';

export const ROUTES = ['AUTONOMOUS', 'AI_ASSISTED', 'HUMAN_LED'] as const satisfies readonly DevelopmentRoute[];

export const ROUTE_LABELS: Record<DevelopmentRoute, string> = {
  AUTONOMOUS: 'Autonomous',
  AI_ASSISTED: 'AI-assisted',
  HUMAN_LED: 'Human-led',
};

export const ROUTE_DESCRIPTIONS: Record<DevelopmentRoute, string> = {
  AUTONOMOUS: 'AI agents design, build, test and release. Humans approve at PR and release gates.',
  AI_ASSISTED: 'Engineers lead; AI agents generate code and tests under close review.',
  HUMAN_LED: 'Conventional engineering; AI used opportunistically.',
};
