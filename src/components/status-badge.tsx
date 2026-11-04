import type { DevelopmentRoute, JiraSyncStatus, Level, RequestStatus, SyncState } from '@prisma/client';
import { ROUTE_LABELS } from '@/lib/routes';
import { Badge } from '@/components/ui';

const STATUS: Record<RequestStatus, { label: string; variant: 'secondary' | 'info' | 'warning' | 'success' | 'danger' }> = {
  DRAFT: { label: 'Draft', variant: 'secondary' },
  SUBMITTED: { label: 'Submitted', variant: 'info' },
  UNDER_IT_REVIEW: { label: 'Under IT review', variant: 'warning' },
  APPROVED: { label: 'Approved', variant: 'success' },
  REJECTED: { label: 'Rejected', variant: 'danger' },
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const s = STATUS[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

const LEVEL_VARIANT: Record<Level, 'secondary' | 'info' | 'warning' | 'danger'> = {
  LOW: 'secondary',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'danger',
};

export function LevelBadge({ level, prefix }: { level?: Level | string | null; prefix?: string }) {
  if (!level || !(level in LEVEL_VARIANT)) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant={LEVEL_VARIANT[level as Level]}>
      {prefix ? `${prefix} ` : ''}
      {level.charAt(0) + level.slice(1).toLowerCase()}
    </Badge>
  );
}

const SYNC_VARIANT: Record<JiraSyncStatus, 'secondary' | 'info' | 'success' | 'warning' | 'danger'> = {
  PENDING: 'secondary',
  IN_PROGRESS: 'info',
  SUCCEEDED: 'success',
  FAILED: 'warning',
  DEAD_LETTERED: 'danger',
};

export function SyncBadge({ status }: { status: JiraSyncStatus }) {
  return <Badge variant={SYNC_VARIANT[status]}>{status.replace('_', ' ').toLowerCase()}</Badge>;
}

const ROUTE_VARIANT: Record<DevelopmentRoute, 'success' | 'info' | 'secondary'> = {
  AUTONOMOUS: 'success',
  AI_ASSISTED: 'info',
  HUMAN_LED: 'secondary',
};

export function RouteBadge({ route, pending }: { route?: DevelopmentRoute | null; pending?: boolean }) {
  if (!route) return <span className="text-xs text-muted-foreground">{pending ? 'Assessing…' : '—'}</span>;
  return <Badge variant={ROUTE_VARIANT[route]}>{ROUTE_LABELS[route]}</Badge>;
}

const SYNC_STATE: Record<SyncState, { label: string; variant: 'secondary' | 'info' | 'success' | 'danger' }> = {
  NOT_SYNCED: { label: 'not published', variant: 'secondary' },
  PENDING: { label: 'publishing', variant: 'info' },
  SYNCED: { label: 'published', variant: 'success' },
  FAILED: { label: 'publish failed', variant: 'danger' },
};

export function SyncStateBadge({ state }: { state: SyncState }) {
  const s = SYNC_STATE[state];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
