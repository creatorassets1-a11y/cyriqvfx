import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Transactional email (PRD §64). The console driver is the default so the app
 * runs with no mail provider configured; Resend is used when a key is present.
 * Nothing promotional is ever sent from here.
 */

export interface EmailInput {
  to: string;
  subject: string;
  heading: string;
  body: string;
  ctaLabel?: string;
  /** Site-relative path; turned into an absolute URL against PUBLIC_SITE_URL. */
  ctaPath?: string;
  footnote?: string;
}

function renderHtml(input: EmailInput): string {
  const url = input.ctaPath
    ? new URL(input.ctaPath, env.PUBLIC_SITE_URL).toString()
    : undefined;
  const cta =
    url && input.ctaLabel
      ? `<a href="${escapeHtml(url)}" style="display:inline-block;background:#2563ff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(input.ctaLabel)}</a>`
      : '';
  return `<!doctype html><html><body style="margin:0;background:#0b1020;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 24px;color:#e8ecf8">
  <p style="margin:0 0 24px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8fa3c8">Cyriq VFX</p>
  <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#fff">${escapeHtml(input.heading)}</h1>
  <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#b9c6e0">${escapeHtml(input.body)}</p>
  ${cta}
  ${input.footnote ? `<p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#7286a8">${escapeHtml(input.footnote)}</p>` : ''}
</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export async function sendEmail(input: EmailInput): Promise<void> {
  if (env.EMAIL_DRIVER === 'resend' && env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        html: renderHtml(input),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.error({ status: res.status, detail: detail.slice(0, 300) }, 'email send failed');
      throw new Error(`Email provider returned ${res.status}`);
    }
    return;
  }

  // Console driver: the link is logged so verification and reset flows are
  // fully usable in development without a mail provider.
  logger.info(
    {
      to: input.to,
      subject: input.subject,
      link: input.ctaPath ? new URL(input.ctaPath, env.PUBLIC_SITE_URL).toString() : undefined,
    },
    'email (console driver)',
  );
}
