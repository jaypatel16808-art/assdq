// Delivers a callback request to the shop's inbox via Resend (https://resend.com).
// The API key is read from server environment variables and never reaches the browser.
// Submissions are not stored by the website; the email is the only copy.

import { formatPhone } from '../../public/js/validate.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Strip anything that could break out of an email header. */
export function headerSafe(value, max = 120) {
  return String(value).replace(/[\r\n\t]+/g, ' ').replace(/[^\P{C} ]/gu, '').slice(0, max).trim();
}

export function buildCallbackEmail(values, receivedAt = new Date()) {
  const phone = formatPhone(values.phone);
  const when = receivedAt.toLocaleString('en-US', {
    timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short',
  });

  const subject = headerSafe(`Callback request: ${values.name} (${values.vehicle})`);

  const text = [
    'New callback request from the website',
    '',
    `Name:    ${values.name}`,
    `Phone:   ${phone}`,
    `Car:     ${values.vehicle}`,
    `Received: ${when} (New York time)`,
    '',
    'Problem:',
    values.problem,
    '',
    '—',
    'Sent from the callback form on the Vernon Auto Repair website.',
    'Please delete this email once the request has been handled (see the Privacy Policy).',
  ].join('\n');

  const row = (label, value) =>
    `<tr><td style="padding:6px 16px 6px 0;color:#4A5550;vertical-align:top">${label}</td><td style="padding:6px 0;font-weight:600">${value}</td></tr>`;

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#ECEEEA;font-family:Arial,Helvetica,sans-serif;color:#18201D">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #18201D">
<div style="background:#1F3D35;color:#ECEEEA;padding:16px 24px;font-size:18px;font-weight:700">New callback request</div>
<div style="padding:24px">
<table role="presentation" style="border-collapse:collapse;font-size:15px">
${row('Name', escapeHtml(values.name))}
${row('Phone', `<a href="tel:+1${escapeHtml(values.phone)}" style="color:#1F3D35">${escapeHtml(phone)}</a>`)}
${row('Car', escapeHtml(values.vehicle))}
${row('Received', `${escapeHtml(when)} (New York time)`)}
</table>
<p style="margin:20px 0 6px;color:#4A5550;font-size:14px">Problem</p>
<p style="margin:0;font-size:15px;line-height:1.5;white-space:pre-wrap">${escapeHtml(values.problem)}</p>
</div>
<div style="padding:14px 24px;border-top:1px solid #ddd;color:#4A5550;font-size:12px">Sent from the Vernon Auto Repair website. Please delete this email once the request has been handled.</div>
</div></body></html>`;

  return { subject, text, html };
}

export async function sendCallbackEmail(env, values, { fetchImpl = fetch } = {}) {
  const message = buildCallbackEmail(values);

  if (env.EMAIL_TRANSPORT === 'console') {
    // Local development only (see contact.js guard). Logs that a message would be sent, without the customer's details.
    console.log(`[dev] Callback email suppressed. Subject length ${message.subject.length}, body ${message.text.length} chars.`);
    return { ok: true };
  }

  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.CONTACT_FROM_EMAIL,
        to: env.CONTACT_TO_EMAIL.split(',').map((s) => s.trim()).filter(Boolean),
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`Email provider returned HTTP ${res.status}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error('Email provider request failed:', err?.name || 'Error');
    return { ok: false };
  }
}
