import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dtf = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Johannesburg',
});

export function formatDateTime(d: Date | string | null | undefined) {
  if (!d) return '—';
  return dtf.format(typeof d === 'string' ? new Date(d) : d);
}

export function publicUrl(path = '') {
  const base = (process.env.KATO_PUBLIC_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}${path}`;
}

export function csv(v?: string) {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
