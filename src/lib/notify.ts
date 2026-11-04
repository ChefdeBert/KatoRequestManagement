import nodemailer from 'nodemailer';
import { prisma } from './prisma';
import { enqueueNotification } from './queue';
import { publicUrl } from './utils';

export type NotificationType =
  | 'REQUEST_SUBMITTED'
  | 'REQUEST_APPROVED'
  | 'JIRA_CREATED'
  | 'REQUEST_REJECTED'
  | 'JIRA_SYNC_FAILED';

type NotifyInput = {
  userId: string;
  requestId?: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
};

/**
 * Notifications are recorded in Postgres first (in-app inbox, audit), then
 * delivered by email from the worker. Queue failure never breaks the caller.
 */
export async function notifyUser(input: NotifyInput) {
  const n = await prisma.notification.create({ data: input });
  await enqueueNotification(n.id).catch((err) => console.error('[notify] enqueue failed; row persisted', n.id, err));
  return n;
}

export async function notifyStaff(input: Omit<NotifyInput, 'userId'>, excludeUserId?: string) {
  const staff = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'IT_REVIEWER'] }, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    select: { id: true },
  });
  await Promise.all(staff.map((s) => notifyUser({ ...input, userId: s.id })));
}

let transport: nodemailer.Transporter | null = null;
function mailer() {
  if (!process.env.SMTP_HOST) return null;
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  return transport;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Called by the worker. */
export async function deliverNotification(notificationId: string) {
  const n = await prisma.notification.findUnique({ where: { id: notificationId }, include: { user: true } });
  if (!n || n.sentAt) return;

  const t = mailer();
  if (t) {
    const link = n.link ? publicUrl(n.link) : undefined;
    await t.sendMail({
      from: process.env.SMTP_FROM ?? 'Kato <kato@cassava.tech>',
      to: n.user.email,
      subject: `[Kato] ${n.title}`,
      text: `${n.body}${link ? `\n\nOpen in Kato: ${link}` : ''}`,
      html: `<p>${escapeHtml(n.body).replace(/\n/g, '<br/>')}</p>${link ? `<p><a href="${link}">Open in Kato</a></p>` : ''}`,
    });
  } else {
    console.info(`[notify] (no SMTP) → ${n.user.email}: ${n.title}`);
  }
  await prisma.notification.update({ where: { id: n.id }, data: { sentAt: new Date() } });
}
