// "Book a demo" requests from the public homepage: stored for the platform owner, who is alerted.
import express from 'express';
import { db } from './db.js';
import { isPlatformAdmin } from './auth.js';
import { sendMail, mailEnabled } from './mail.js';
import { sendToUser } from './notifications.js';

db.exec(`
CREATE TABLE IF NOT EXISTS demo_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  team_size TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new',   -- new | contacted | closed
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const hits = new Map();
setInterval(() => hits.clear(), 3600000).unref();

/** Public: POST /api/public/demo-request */
export const publicRouter = express.Router();
publicRouter.post('/demo-request', async (req, res) => {
  const b = req.body || {};
  // Honeypot field: real people never see or fill it. Pretend success so bots learn nothing.
  if (b.website) return res.status(201).json({ ok: true });
  const n = (hits.get(req.ip) || 0) + 1;
  hits.set(req.ip, n);
  if (n > 5) return res.status(429).json({ error: 'Too many requests. Please try again later or message us directly.' });
  const r = {
    name: clean(b.name, 120),
    company: clean(b.company, 120),
    email: clean(b.email, 160).toLowerCase(),
    phone: clean(b.phone, 40),
    team_size: clean(b.team_size, 40),
    message: clean(b.message, 2000),
  };
  if (!r.name || !r.company) return res.status(400).json({ error: 'Please enter your name and company.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  db.prepare('INSERT INTO demo_requests (name, company, email, phone, team_size, message, ip) VALUES (?,?,?,?,?,?,?)').run(
    r.name, r.company, r.email, r.phone || null, r.team_size || null, r.message || null, req.ip
  );
  res.status(201).json({ ok: true });

  // Alert the platform owner (push to their devices, and email when configured).
  const ownerEmail = (process.env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!ownerEmail) return;
  const owner = db.prepare('SELECT * FROM users WHERE email = ?').get(ownerEmail);
  const summary = `${r.name}, ${r.company}${r.team_size ? ` (${r.team_size})` : ''}`;
  if (owner) {
    sendToUser(owner.id, { title: 'New demo request', body: `${summary}${r.message ? ` – ${r.message.slice(0, 120)}` : ''}`, url: '/admin', tag: 'demo-request' }).catch(() => {});
  }
  if (mailEnabled()) {
    const text = `New Proj4D demo request\n\nName: ${r.name}\nCompany: ${r.company}\nEmail: ${r.email}\nPhone: ${r.phone || '-'}\nTeam size: ${r.team_size || '-'}\n\n${r.message || ''}`;
    sendMail({ to: ownerEmail, subject: `Demo request: ${summary}`, text }).catch((e) => console.warn('Demo request email failed:', e.message));
  }
});

/** Platform owner: /api/admin/demo-requests (login required; mounted after requireUser). */
export const demoAdminRouter = express.Router();
demoAdminRouter.use((req, res, next) => (isPlatformAdmin(req.user) ? next() : res.status(403).json({ error: 'Not allowed.' })));
demoAdminRouter.get('/', (_req, res) => {
  res.json({ requests: db.prepare('SELECT id, name, company, email, phone, team_size, message, status, created_at FROM demo_requests ORDER BY id DESC LIMIT 500').all().map((r) => ({ ...r })) });
});
demoAdminRouter.put('/:id', (req, res) => {
  const status = ['new', 'contacted', 'closed'].includes(req.body?.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Unknown status.' });
  db.prepare('UPDATE demo_requests SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});
