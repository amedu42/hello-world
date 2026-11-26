// Tells the platform admin about new signups: an email and a push notification to their devices.
// Recipients: PLATFORM_ADMIN_EMAIL, plus any addresses in SIGNUP_ALERT_EMAILS (comma-separated).
// Turn off with SIGNUP_ALERTS=off.
import { db } from './db.js';
import { authEvents } from './auth.js';
import { sendMail, signupAlertEmail } from './mail.js';
import { sendToUser } from './notifications.js';

const enabled = () => process.env.SIGNUP_ALERTS !== 'off';
const adminEmail = () => (process.env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();

function alertEmails() {
  const extra = String(process.env.SIGNUP_ALERT_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  return [...new Set([adminEmail(), ...extra].filter(Boolean))];
}

authEvents.on('signup', ({ user, company, verificationSent }) => {
  if (!enabled()) return;
  if (adminEmail() && user.email.toLowerCase() === adminEmail()) return; // that's you signing up
  const total = db.prepare('SELECT COUNT(*) n FROM companies').get().n;
  const when = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.ALERT_TIMEZONE || 'Africa/Lagos' });
  const base = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  const adminLink = base ? `${base}/admin` : '';

  for (const to of alertEmails()) {
    sendMail({ to, ...signupAlertEmail({ company: company.name, name: user.name, email: user.email, when, total, adminLink, verificationSent }) }).catch((e) =>
      console.error('Signup alert email failed:', e.message)
    );
  }

  const admin = adminEmail() && db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail());
  if (admin) {
    sendToUser(admin.id, {
      title: `New signup: ${company.name}`,
      body: `${user.name} · ${user.email}`,
      url: '/admin',
      tag: `signup-${user.id}`,
      urgency: 'high',
    }).catch((e) => console.warn('Signup push failed:', e.message));
  }
});

authEvents.on('verified', ({ user }) => {
  if (!enabled() || !adminEmail()) return;
  if (user.email.toLowerCase() === adminEmail()) return;
  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail());
  const company = db.prepare('SELECT name FROM companies WHERE id = ?').get(user.company_id);
  if (admin) {
    sendToUser(admin.id, { title: `Email confirmed: ${company?.name || user.name}`, body: `${user.name} confirmed ${user.email}`, url: '/admin', tag: `signup-${user.id}` }).catch(() => {});
  }
});
