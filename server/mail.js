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

// ------------------------------------------------------------------ account emails

const button = (href, label) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#f2a900;color:#1c1600;padding:11px 20px;border-radius:8px;font-weight:700;text-decoration:none">${esc(label)}</a>`;

/** Branded wrapper: navy band with the Proj4D name, white body, small footer. */
function layout(inner, footer = '') {
  return `<div style="background:#f4f6f9;padding:24px 12px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e1e5eb">
    <div style="background:#16324f;border-bottom:3px solid #f2a900;padding:16px 24px;color:#ffffff;font-size:20px;font-weight:800">Proj4D</div>
    <div style="padding:24px;font-size:15px;line-height:1.6;color:#1c2430">${inner}</div>
  </div>
  <p style="max-width:560px;margin:14px auto 0;font-size:12px;color:#687384;text-align:center">${footer || 'Proj4D · Construction project management'}</p>
</div>`;
}

export function verifyEmail({ name, link, hours }) {
  const text = `Hi ${name},

Welcome to Proj4D! Please confirm your email address to finish setting up your account:

${link}

The link works for ${hours} hours. If you didn't sign up for Proj4D, you can ignore this email.

– Proj4D`;
  const html = layout(`<p style="margin-top:0">Hi ${esc(name)},</p>
  <p>Welcome to Proj4D! Please confirm your email address to finish setting up your account.</p>
  <p style="margin:24px 0">${button(link, 'Confirm my email')}</p>
  <p style="color:#687384;font-size:13px">The link works for ${hours} hours. Or copy it into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>
  <p style="color:#687384;font-size:13px">If you didn't sign up for Proj4D, you can ignore this email.</p>`);
  return { subject: 'Confirm your email for Proj4D', text, html };
}

export function welcomeEmail({ name, company, appLink, pricingLink, trialEnds, contactEmail, whatsapp }) {
  const steps = [
    ['Create your first project', 'Add the project name, client, location and dates.'],
    ['Set up the programme', 'Upload your work programme (Excel, CSV, MS Project XML or PDF), or let AI draft one from your drawings and BOQ.'],
    ['File the first daily report', 'Record progress, weather, labour, issues and photos from your phone.'],
    ['Invite your team', 'Add site supervisors and colleagues on the Team page.'],
    ['Install the app', 'On your phone, open Proj4D in Chrome or Safari and choose “Install app” or “Add to Home Screen”.'],
  ];
  const help = [contactEmail && `email ${contactEmail}`, whatsapp && `WhatsApp +${whatsapp}`].filter(Boolean).join(' or ');
  const text = `Hi ${name},

Your email is confirmed and ${company} is all set up on Proj4D.

${trialEnds ? `Your free trial of every feature, including AI programmes and client reports, runs until ${trialEnds}. No card needed. Afterwards you can stay on the Free plan or choose a paid plan.\n\n` : ''}Get started:
${steps.map(([t, d], i) => `${i + 1}. ${t}: ${d}`).join('\n')}

Open Proj4D: ${appLink}
Plans and pricing: ${pricingLink}
${help ? `\nQuestions? Just reply to this email${help ? `, or ${help}` : ''}.\n` : '\nQuestions? Just reply to this email.\n'}
– The Proj4D team`;
  const html = layout(`<p style="margin-top:0">Hi ${esc(name)},</p>
  <p>Your email is confirmed and <b>${esc(company)}</b> is all set up on Proj4D. Welcome aboard!</p>
  ${trialEnds ? `<div style="background:#fff8e6;border:1px solid #f6d27a;border-radius:10px;padding:12px 14px;margin:16px 0"><b>Your free trial runs until ${esc(trialEnds)}.</b> Use every feature, including AI work programmes and weekly, monthly and milestone reports. No card needed. Afterwards, stay on the Free plan or <a href="${esc(pricingLink)}" style="color:#224b74">choose a plan</a>.</div>` : ''}
  <p style="font-weight:700;margin-bottom:6px">Get started in five steps</p>
  <ol style="padding-left:20px;margin-top:0">${steps.map(([t, d]) => `<li style="margin-bottom:8px"><b>${esc(t)}</b><br><span style="color:#44505f">${esc(d)}</span></li>`).join('')}</ol>
  <p style="margin:22px 0">${button(appLink, 'Open Proj4D')}</p>
  <p style="color:#44505f">Questions? Just reply to this email${help ? `, or ${esc(help)}` : ''}. We're happy to help you set up your first project.</p>
  <p style="margin-bottom:0">– The Proj4D team</p>`);
  return { subject: `Welcome to Proj4D, ${name.split(' ')[0]}!`, text, html };
}

export function signupAlertEmail({ company, name, email, when, total, adminLink, verificationSent }) {
  const text = `New Proj4D signup

Company: ${company}
Name: ${name}
Email: ${email}
When: ${when}
Email verification: ${verificationSent ? 'sent' : 'not needed (email sending is off)'}

That makes ${total} compan${total === 1 ? 'y' : 'ies'} in total.
${adminLink ? `Platform admin: ${adminLink}` : ''}`;
  const row = (k, v) => `<tr><td style="padding:4px 12px 4px 0;color:#687384">${k}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`;
  const html = layout(`<p style="margin-top:0;font-size:18px;font-weight:800">New signup 🎉</p>
  <table style="border-collapse:collapse;font-size:15px">${row('Company', company)}${row('Name', name)}${row('Email', email)}${row('When', when)}${row('Verification', verificationSent ? 'Email sent' : 'Not needed')}</table>
  <p>That makes <b>${total}</b> compan${total === 1 ? 'y' : 'ies'} in total.</p>
  ${adminLink ? `<p style="margin-bottom:0">${button(adminLink, 'Open platform admin')}</p>` : ''}`, 'You get this because you are the Proj4D platform admin.');
  return { subject: `New Proj4D signup: ${company}`, text, html };
}
