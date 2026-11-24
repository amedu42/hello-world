// Subscriptions and payments through Paystack (settles to the business's Nigerian bank account).
// Flow: checkout → Paystack payment page → back to /billing?reference=… → verify; renewals, cancellations
// and failed payments arrive by webhook at /api/billing/paystack/webhook.
import express from 'express';
import crypto from 'node:crypto';
import { db } from './db.js';
import { isPlatformAdmin, requireUser } from './auth.js';
import { appUrl } from './mail.js';
import { CURRENCIES, INTERVALS, PAID, PLANS, TRIAL_DAYS, billingSummary, priceList } from './plans.js';

const SECRET = () => process.env.PAYSTACK_SECRET_KEY || '';
const BASE = (process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co').replace(/\/+$/, '');
export const paystackEnabled = () => Boolean(SECRET());

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function paystack(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { Authorization: `Bearer ${SECRET()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new HttpError(502, 'Could not reach Paystack. Please try again.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false) {
    console.error('Paystack error', method, path, res.status, json.message);
    throw new HttpError(502, `Paystack: ${json.message || `request failed (${res.status})`}`);
  }
  return json.data;
}

// ------------------------------------------------------------------ helpers

const toMinor = (amount) => Math.round(amount * 100); // kobo / cents
const addInterval = (fromMs, interval) => {
  const d = new Date(fromMs);
  if (interval === 'annually') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
};

/** The Paystack plan for a price, created the first time someone checks out at that price. */
async function planCode(plan, currency, interval) {
  const row = db.prepare('SELECT * FROM plan_prices WHERE plan = ? AND currency = ? AND interval = ?').get(plan, currency, interval);
  if (!row) throw new HttpError(400, 'That plan is not available.');
  if (row.paystack_plan_code) return { code: row.paystack_plan_code, amount: row.amount };
  const created = await paystack('POST', '/plan', {
    name: `Proj4D ${PLANS[plan].name} (${interval === 'annually' ? 'annual' : 'monthly'}, ${currency} ${row.amount})`,
    interval,
    amount: toMinor(row.amount),
    currency,
    send_invoices: true,
    send_sms: false,
  });
  db.prepare('UPDATE plan_prices SET paystack_plan_code = ? WHERE plan = ? AND currency = ? AND interval = ?').run(created.plan_code, plan, currency, interval);
  return { code: created.plan_code, amount: row.amount };
}

function planForCode(code) {
  const r = db.prepare('SELECT plan, currency, interval FROM plan_prices WHERE paystack_plan_code = ?').get(code);
  return r ? { ...r } : null;
}

function logEvent(event, companyId, payload) {
  db.prepare('INSERT INTO billing_events (event, company_id, payload) VALUES (?,?,?)').run(event, companyId ?? null, JSON.stringify(payload).slice(0, 20000));
}

function recordPayment(companyId, t, { plan, interval }) {
  const amount = (t.amount || 0) / 100;
  db.prepare(
    `INSERT INTO payments (company_id, reference, plan, interval, currency, amount, status, paid_at, channel) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(reference) DO UPDATE SET status = excluded.status, paid_at = excluded.paid_at, amount = excluded.amount, channel = excluded.channel`
  ).run(companyId, t.reference, plan, interval, t.currency, amount, t.status, t.paid_at || t.paidAt || null, t.channel || null);
}

const alreadyApplied = (reference) => db.prepare("SELECT 1 FROM payments WHERE reference = ? AND status = 'success'").get(reference);

/** Looks up the subscription Paystack created for this customer and plan (it is created just after the first charge). */
async function findSubscription(customerId, code) {
  if (!customerId) return null;
  try {
    const subs = await paystack('GET', `/subscription?customer=${encodeURIComponent(customerId)}&perPage=50`);
    return (subs || [])
      .filter((s) => s.plan?.plan_code === code && ['active', 'non-renewing', 'attention'].includes(s.status))
      .sort((a, b) => Date.parse(b.createdAt || b.created_at || 0) - Date.parse(a.createdAt || a.created_at || 0))[0] || null;
  } catch {
    return null;
  }
}

async function disableSubscription(code, token) {
  if (!code || !token) return;
  try {
    await paystack('POST', '/subscription/disable', { code, token });
  } catch (e) {
    console.error('Could not disable old subscription', code, e.message);
  }
}

/** A first payment for a plan succeeded: switch the company to it. Safe to call twice for the same payment. */
async function activateFromTransaction(companyId, t) {
  if (alreadyApplied(t.reference)) return;
  const meta = t.metadata || {};
  const plan = PAID.includes(meta.plan) ? meta.plan : planForCode(t.plan?.plan_code || t.plan)?.plan;
  const interval = INTERVALS.includes(meta.interval) ? meta.interval : planForCode(t.plan?.plan_code || t.plan)?.interval || 'monthly';
  if (!plan) throw new HttpError(400, 'This payment is not for a subscription plan.');
  const code = meta.plan_code || t.plan?.plan_code || (typeof t.plan === 'string' ? t.plan : null);
  const old = db.prepare('SELECT paystack_subscription_code, paystack_email_token FROM companies WHERE id = ?').get(companyId);
  const paidAt = Date.parse(t.paid_at || t.paidAt || '') || Date.now();

  db.prepare(
    `UPDATE companies SET plan = ?, billing_interval = ?, billing_currency = ?, subscription_status = 'active', current_period_end = ?,
       paystack_customer_code = COALESCE(?, paystack_customer_code) WHERE id = ?`
  ).run(plan, interval, t.currency, addInterval(paidAt, interval), t.customer?.customer_code || null, companyId);
  recordPayment(companyId, t, { plan, interval });

  const sub = await findSubscription(t.customer?.id, code);
  if (sub) {
    db.prepare('UPDATE companies SET paystack_subscription_code = ?, paystack_email_token = ? WHERE id = ?').run(sub.subscription_code, sub.email_token, companyId);
    if (sub.next_payment_date) db.prepare('UPDATE companies SET current_period_end = ? WHERE id = ?').run(new Date(sub.next_payment_date).toISOString(), companyId);
  }
  // Changing plan: stop the previous subscription so the company isn't billed twice.
  if (old?.paystack_subscription_code && old.paystack_subscription_code !== sub?.subscription_code) {
    await disableSubscription(old.paystack_subscription_code, old.paystack_email_token);
    if (!sub) db.prepare('UPDATE companies SET paystack_subscription_code = NULL, paystack_email_token = NULL WHERE id = ?').run(companyId);
  }
}

// ------------------------------------------------------------------ routes

export const billingRouter = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const requireCompanyAdmin = (req, _res, next) => (req.user?.role === 'admin' ? next() : next(new HttpError(403, 'Only company admins can manage the plan.')));
const requirePlatformAdmin = (req, _res, next) => (isPlatformAdmin(req.user) ? next() : next(new HttpError(403, 'Not allowed.')));

// Paystack webhook: no login; trusted only when the signature matches our secret key.
billingRouter.post(
  '/paystack/webhook',
  wrap(async (req, res) => {
    const sig = req.headers['x-paystack-signature'];
    const expected = SECRET() && req.rawBody ? crypto.createHmac('sha512', SECRET()).update(req.rawBody).digest('hex') : '';
    if (!sig || !expected || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.status(401).json({ error: 'Bad signature' });
    }
    const { event, data = {} } = req.body || {};
    const byCustomer = (cc) => (cc ? db.prepare('SELECT id FROM companies WHERE paystack_customer_code = ?').get(cc)?.id : null);
    const bySub = (sc) => (sc ? db.prepare('SELECT id FROM companies WHERE paystack_subscription_code = ?').get(sc)?.id : null);
    let companyId = Number(data.metadata?.company_id) || bySub(data.subscription_code || data.subscription?.subscription_code) || byCustomer(data.customer?.customer_code);
    if (companyId && !db.prepare('SELECT 1 FROM companies WHERE id = ?').get(companyId)) companyId = null;
    logEvent(event, companyId, data);

    try {
      if (event === 'charge.success' && companyId) {
        if (data.metadata?.company_id) {
          await activateFromTransaction(companyId, data); // first payment (if the browser didn't confirm it already)
        } else if (!alreadyApplied(data.reference)) {
          // Renewal: extend the paid period from whichever is later, the old end date or today.
          const p = planForCode(data.plan?.plan_code) || {};
          const c = db.prepare('SELECT plan, billing_interval, current_period_end FROM companies WHERE id = ?').get(companyId);
          const plan = p.plan || c.plan;
          const interval = p.interval || c.billing_interval || 'monthly';
          const from = Math.max(Date.parse(c.current_period_end || 0) || 0, Date.parse(data.paid_at || '') || Date.now());
          db.prepare("UPDATE companies SET plan = ?, billing_interval = ?, billing_currency = ?, subscription_status = 'active', current_period_end = ? WHERE id = ?").run(
            plan, interval, data.currency, addInterval(from, interval), companyId
          );
          recordPayment(companyId, data, { plan, interval });
        }
      } else if (event === 'subscription.create' && companyId) {
        const p = planForCode(data.plan?.plan_code);
        const c = db.prepare('SELECT plan FROM companies WHERE id = ?').get(companyId);
        if (!p || p.plan === c.plan) {
          db.prepare('UPDATE companies SET paystack_subscription_code = ?, paystack_email_token = ?, paystack_customer_code = COALESCE(?, paystack_customer_code) WHERE id = ?').run(
            data.subscription_code, data.email_token, data.customer?.customer_code || null, companyId
          );
          if (data.next_payment_date) db.prepare('UPDATE companies SET current_period_end = ? WHERE id = ?').run(new Date(data.next_payment_date).toISOString(), companyId);
        }
      } else if (['subscription.not_renew', 'subscription.disable'].includes(event) && companyId) {
        // Only the company's current subscription matters (an old one is disabled when changing plan).
        db.prepare('UPDATE companies SET subscription_status = ? WHERE id = ? AND paystack_subscription_code = ?').run(
          event === 'subscription.disable' ? 'cancelled' : 'non-renewing', companyId, data.subscription_code
        );
      } else if (event === 'invoice.payment_failed' && companyId) {
        db.prepare("UPDATE companies SET subscription_status = 'attention' WHERE id = ? AND paystack_subscription_code = ?").run(companyId, data.subscription?.subscription_code);
      }
    } catch (e) {
      console.error('Paystack webhook handling failed:', event, e);
    }
    res.json({ ok: true }); // always acknowledge so Paystack doesn't retry forever
  })
);

billingRouter.use(requireUser);

billingRouter.get('/', (req, res) => {
  const payments = db
    .prepare("SELECT reference, plan, interval, currency, amount, status, paid_at, channel FROM payments WHERE company_id = ? AND status = 'success' ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 50")
    .all(req.company.id)
    .map((r) => ({ ...r }));
  res.json({
    billing: billingSummary(req.company.id),
    plans: Object.values(PLANS),
    prices: priceList(),
    currencies: CURRENCIES,
    trial_days: TRIAL_DAYS,
    payments_enabled: paystackEnabled(),
    payments,
    is_admin: req.user.role === 'admin',
  });
});

billingRouter.post(
  '/checkout',
  requireCompanyAdmin,
  wrap(async (req, res) => {
    if (!paystackEnabled()) throw new HttpError(503, 'Online payments are not set up yet. Please contact us to subscribe.');
    const { plan, interval = 'monthly', currency = 'NGN' } = req.body || {};
    if (!PAID.includes(plan) || !INTERVALS.includes(interval) || !CURRENCIES.includes(currency)) throw new HttpError(400, 'Choose a plan, billing period and currency.');
    const cur = billingSummary(req.company.id).subscription;
    if (cur?.active && cur.plan === plan && cur.interval === interval && cur.status === 'active') throw new HttpError(409, `You're already on the ${PLANS[plan].name} plan.`);

    const { code, amount } = await planCode(plan, currency, interval);
    const reference = `p4d_${req.company.id}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const base = appUrl(req) || `${req.protocol}://${req.get('host')}`;
    const t = await paystack('POST', '/transaction/initialize', {
      email: req.user.email,
      amount: toMinor(amount),
      currency,
      plan: code,
      reference,
      callback_url: `${base}/billing`,
      metadata: {
        company_id: req.company.id,
        user_id: req.user.id,
        plan,
        interval,
        plan_code: code,
        custom_fields: [
          { display_name: 'Company', variable_name: 'company', value: req.company.name },
          { display_name: 'Plan', variable_name: 'plan', value: `${PLANS[plan].name} (${interval})` },
        ],
      },
    });
    db.prepare('INSERT INTO payments (company_id, reference, plan, interval, currency, amount, status) VALUES (?,?,?,?,?,?,?)').run(
      req.company.id, reference, plan, interval, currency, amount, 'pending'
    );
    res.json({ url: t.authorization_url, reference });
  })
);

billingRouter.post(
  '/verify',
  wrap(async (req, res) => {
    const reference = String(req.body?.reference || '');
    if (!/^[\w.=-]{6,100}$/.test(reference)) throw new HttpError(400, 'Invalid payment reference.');
    const own = db.prepare('SELECT * FROM payments WHERE reference = ? AND company_id = ?').get(reference, req.company.id);
    if (!own) throw new HttpError(404, 'Payment not found.');
    if (own.status !== 'success') {
      const t = await paystack('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
      if (t.status !== 'success') {
        db.prepare('UPDATE payments SET status = ? WHERE reference = ?').run(t.status || 'failed', reference);
        return res.json({ ok: false, status: t.status, message: t.gateway_response || 'The payment was not completed.', billing: billingSummary(req.company.id) });
      }
      if (Number(t.metadata?.company_id) !== req.company.id) throw new HttpError(400, 'This payment belongs to another account.');
      await activateFromTransaction(req.company.id, t);
    }
    res.json({ ok: true, billing: billingSummary(req.company.id) });
  })
);

billingRouter.post(
  '/manage-link',
  requireCompanyAdmin,
  wrap(async (req, res) => {
    const c = db.prepare('SELECT paystack_subscription_code FROM companies WHERE id = ?').get(req.company.id);
    if (!c?.paystack_subscription_code) throw new HttpError(404, 'There is no subscription to manage yet.');
    const d = await paystack('GET', `/subscription/${encodeURIComponent(c.paystack_subscription_code)}/manage/link`);
    res.json({ url: d.link });
  })
);

billingRouter.post(
  '/cancel',
  requireCompanyAdmin,
  wrap(async (req, res) => {
    const c = db.prepare('SELECT paystack_subscription_code, paystack_email_token FROM companies WHERE id = ?').get(req.company.id);
    if (!c?.paystack_subscription_code) throw new HttpError(404, 'There is no subscription to cancel.');
    await paystack('POST', '/subscription/disable', { code: c.paystack_subscription_code, token: c.paystack_email_token });
    db.prepare("UPDATE companies SET subscription_status = 'cancelled' WHERE id = ?").run(req.company.id);
    res.json({ ok: true, billing: billingSummary(req.company.id) });
  })
);

// ---------- platform admin: prices and complimentary plans

billingRouter.put('/admin/prices', requirePlatformAdmin, (req, res) => {
  const rows = Array.isArray(req.body?.prices) ? req.body.prices : [];
  const upd = db.prepare('UPDATE plan_prices SET amount = ?, paystack_plan_code = NULL WHERE plan = ? AND currency = ? AND interval = ? AND amount != ?');
  for (const r of rows) {
    const amount = Math.round(Number(r.amount) * 100) / 100;
    if (!PAID.includes(r.plan) || !CURRENCIES.includes(r.currency) || !INTERVALS.includes(r.interval) || !(amount > 0)) throw new HttpError(400, 'Every price must be more than 0.');
    upd.run(amount, r.plan, r.currency, r.interval, amount); // a new Paystack plan is created at the next checkout; existing subscribers keep their price
  }
  res.json({ prices: priceList() });
});

billingRouter.put('/admin/companies/:cid', requirePlatformAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.cid);
  if (!c) throw new HttpError(404, 'Company not found');
  const b = req.body || {};
  if (b.plan_override !== undefined) {
    const v = PAID.includes(b.plan_override) ? b.plan_override : null;
    db.prepare('UPDATE companies SET plan_override = ? WHERE id = ?').run(v, c.id);
  }
  if (b.extend_trial_days) {
    const days = Math.min(90, Math.max(1, Math.round(Number(b.extend_trial_days))));
    const from = Math.max(Date.now(), Date.parse(c.trial_ends_at || 0) || 0);
    db.prepare('UPDATE companies SET trial_ends_at = ? WHERE id = ?').run(new Date(from + days * 86400000).toISOString(), c.id);
  }
  res.json({ billing: billingSummary(c.id) });
});
