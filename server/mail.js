// Outgoing email over SMTP. Works with any provider (Resend, Postmark, SendGrid, Mailgun, Gmail, Outlook…).
// Without SMTP settings, messages are written to the server log instead so nothing is lost.
import nodemailer from 'nodemailer';

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;

export const mailEnabled = () => Boolean(SMTP_HOST && MAIL_FROM);

let transport;
function getTransport() {
  if (!transport) {
    const port = Number(SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
  }
  return transport;
}

/** Returns true if the message was handed to the mail server, false if it was only logged. */
export async function sendMail({ to, subject, text, html }) {
  if (!mailEnabled()) {
    console.log(`[mail not configured] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return false;
  }
  await getTransport().sendMail({ from: MAIL_FROM, to, subject, text, html });
  return true;
}

/** Public base URL used in links inside emails (never taken from the request in production). */
export function appUrl(req) {
  const configured = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/+$/, '');
  if (process.env.NODE_ENV !== 'production') return `${req.protocol}://${req.get('host')}`;
  return null;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function resetEmail({ name, link, minutes }) {
  const text = `Hi ${name},

Someone (hopefully you) asked to reset your Proj4D password.
Open this link within ${minutes} minutes to choose a new password:

${link}

If you didn't ask for this, you can ignore this email; your password won't change.

– Proj4D`;
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;color:#1c2430;max-width:520px">
  <p>Hi ${esc(name)},</p>
  <p>Someone (hopefully you) asked to reset your Proj4D password. Use the button below within ${minutes} minutes to choose a new password.</p>
  <p><a href="${esc(link)}" style="display:inline-block;background:#f2a900;color:#1c1600;padding:10px 18px;border-radius:8px;font-weight:700;text-decoration:none">Choose a new password</a></p>
  <p style="color:#687384;font-size:13px">Or copy this link: ${esc(link)}</p>
  <p style="color:#687384;font-size:13px">If you didn't ask for this, ignore this email; your password won't change.</p>
</div>`;
  return { subject: 'Reset your Proj4D password', text, html };
}
