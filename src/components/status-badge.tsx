import type { JiraSyncStatus, Level, RequestStatus } from '@prisma/client';
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
