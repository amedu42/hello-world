// Subscription plans, prices and what each company is entitled to.
import { db } from './db.js';

export const TRIAL_DAYS = 7;
const GRACE_DAYS = 3; // keep a paid plan this long after a renewal is due, while Paystack retries the card

/**
 * Plan limits and features. null = unlimited. Prices live in the plan_prices table so they can change without a release.
 * AI features: summaries (report summaries), programmes (AI programme generator), programme_pdf (read PDF programmes),
 * notes (fill reports from site notes), insights (AI project insights).
 */
const NO_AI = { summaries: false, programmes: false, programme_pdf: false, notes: false, insights: false };
const STARTER_AI = { ...NO_AI, summaries: true, programmes: true, programme_pdf: true };
const ALL_AI = { summaries: true, programmes: true, programme_pdf: true, notes: true, insights: true };
export const AI_FEATURE_NAMES = {
  summaries: 'AI report summaries',
  programmes: 'The AI work programme generator',
  programme_pdf: 'Reading PDF programmes with AI',
  notes: 'Filling reports from site notes with AI',
  insights: 'AI project insights',
};
export const PLANS = {
  free: { key: 'free', name: 'Free', rank: 0, members: 3, projects: 2, features: NO_AI, programmes_per_day: 0, blurb: 'For small teams getting started' },
  starter: { key: 'starter', name: 'Starter', rank: 1, members: 10, projects: 10, features: STARTER_AI, programmes_per_day: 5, blurb: 'AI report summaries and work programmes' },
  professional: { key: 'professional', name: 'Professional', rank: 2, members: 30, projects: null, features: ALL_AI, programmes_per_day: 20, blurb: 'Adds AI from site notes and project insights' },
  business: { key: 'business', name: 'Business', rank: 3, members: null, projects: null, features: ALL_AI, programmes_per_day: 50, blurb: 'For larger contractors, with priority support' },
};
/** The cheapest plan that includes an AI feature (for upgrade messages). */
export const planWith = (feature) => Object.values(PLANS).sort((a, b) => a.rank - b.rank).find((p) => p.features[feature]);

export const PAID = ['starter', 'professional', 'business'];
export const CURRENCIES = ['NGN', 'USD'];
export const INTERVALS = ['monthly', 'annually'];

// Monthly prices in major units; annual = 10 × monthly (2 months free).
const DEFAULT_MONTHLY = { starter: { NGN: 25000, USD: 19 }, professional: { NGN: 60000, USD: 45 }, business: { NGN: 150000, USD: 110 } };

/** Called by auth.js once the companies table exists. */
export function migrateBilling() {
  const cols = db.prepare('PRAGMA table_info(companies)').all().map((c) => c.name);
  const add = (name, def) => !cols.includes(name) && db.exec(`ALTER TABLE companies ADD COLUMN ${name} ${def}`);
  const isNew = !cols.includes('trial_ends_at');
  add('plan', "TEXT NOT NULL DEFAULT 'free'"); // plan being paid for
  add('billing_interval', 'TEXT');
  add('billing_currency', 'TEXT');
  add('subscription_status', 'TEXT'); // active | non-renewing | attention | cancelled
  add('current_period_end', 'TEXT'); // paid access runs until this date (ISO)
  add('trial_ends_at', 'TEXT');
  add('plan_override', 'TEXT'); // set by the platform admin: complimentary plan, no payment needed
  add('paystack_customer_code', 'TEXT');
  add('paystack_subscription_code', 'TEXT');
  add('paystack_email_token', 'TEXT');
  if (isNew) {
    // Companies that existed before plans get a fresh 7-day trial, so nobody loses features overnight.
    db.prepare('UPDATE companies SET trial_ends_at = ?').run(new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString());
    // The old per-company premium switch becomes a complimentary Professional plan.
    if (cols.includes('premium_programmes')) db.exec("UPDATE companies SET plan_override = 'professional' WHERE premium_programmes = 1");
  }

  db.exec(`
  CREATE TABLE IF NOT EXISTS plan_prices (
    plan TEXT NOT NULL,
    currency TEXT NOT NULL,
    interval TEXT NOT NULL,
    amount INTEGER NOT NULL,          -- major units (naira / dollars)
    paystack_plan_code TEXT,          -- created on first checkout at this price
    PRIMARY KEY (plan, currency, interval)
  );
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    reference TEXT NOT NULL UNIQUE,
    plan TEXT,
    interval TEXT,
    currency TEXT,
    amount REAL,                      -- major units
    status TEXT,
    paid_at TEXT,
    channel TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS billing_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT,
    company_id INTEGER,
    payload TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_payments_company ON payments(company_id, created_at);
  `);
  // The platform owner's own company always has every feature, free of charge.
  const owner = (process.env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();
  if (owner) db.prepare("UPDATE companies SET plan_override = 'business' WHERE plan_override IS NULL AND id IN (SELECT company_id FROM users WHERE email = ?)").run(owner);
  const ins = db.prepare('INSERT OR IGNORE INTO plan_prices (plan, currency, interval, amount) VALUES (?,?,?,?)');
  for (const [plan, byCur] of Object.entries(DEFAULT_MONTHLY)) {
    for (const [cur, monthly] of Object.entries(byCur)) {
      ins.run(plan, cur, 'monthly', monthly);
      ins.run(plan, cur, 'annually', monthly * 10);
    }
  }
}

export function priceList() {
  const rows = db.prepare('SELECT plan, currency, interval, amount FROM plan_prices').all();
  const out = {};
  for (const r of rows) ((out[r.plan] ??= {})[r.currency] ??= {})[r.interval] = r.amount;
  return out;
}

const daysLeft = (iso) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400000));

/**
 * What a company can use right now. Paid plan while the period (plus grace) runs; otherwise a complimentary
 * plan set by the platform admin; otherwise the trial (every paid feature); otherwise Free.
 */
export function companyBilling(companyId) {
  const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  if (!c) return { plan: PLANS.free, source: 'free' };
  const now = Date.now();
  // A renewal that is still being retried gets a few days' grace; a cancelled plan simply runs to the end of its period.
  const grace = ['active', 'attention'].includes(c.subscription_status) ? GRACE_DAYS * 86400000 : 0;
  const paidUntil = c.current_period_end ? Date.parse(c.current_period_end) + grace : 0;
  const paid = PAID.includes(c.plan) && paidUntil > now;
  const trialActive = c.trial_ends_at && Date.parse(c.trial_ends_at) > now;

  let plan = PLANS.free;
  let source = 'free';
  if (paid) {
    plan = PLANS[c.plan];
    source = 'paid';
  }
  if (c.plan_override && PLANS[c.plan_override] && PLANS[c.plan_override].rank > plan.rank) {
    plan = PLANS[c.plan_override];
    source = 'complimentary';
  }
  if (trialActive && plan.rank < PLANS.business.rank) {
    plan = PLANS.business;
    source = 'trial';
  }
  return {
    plan,
    source,
    trial_ends_at: c.trial_ends_at || null,
    trial_days_left: trialActive ? daysLeft(c.trial_ends_at) : 0,
    trial_used: Boolean(c.trial_ends_at),
    subscription: PAID.includes(c.plan) && c.current_period_end
      ? {
          plan: c.plan,
          plan_name: PLANS[c.plan]?.name,
          interval: c.billing_interval,
          currency: c.billing_currency,
          status: c.subscription_status,
          current_period_end: c.current_period_end,
          active: paid,
          manageable: Boolean(c.paystack_subscription_code),
        }
      : null,
    override: c.plan_override || null,
  };
}

export const planOf = (companyId) => companyBilling(companyId).plan;

/**
 * Members allowed to use the app when a company has more users than its plan allows
 * (e.g. after a trial ends): admins first, then the longest-standing members.
 */
export function allowedUserIds(companyId) {
  const limit = planOf(companyId).members;
  const ids = db
    .prepare("SELECT id FROM users WHERE company_id = ? ORDER BY (role = 'admin') DESC, created_at, id")
    .all(companyId)
    .map((r) => r.id);
  return new Set(limit == null ? ids : ids.slice(0, limit));
}

export function usage(companyId) {
  return {
    members: db.prepare('SELECT COUNT(*) n FROM users WHERE company_id = ?').get(companyId).n,
    projects: db.prepare('SELECT COUNT(*) n FROM projects WHERE company_id = ?').get(companyId).n,
  };
}

/** Public summary for /me and the billing page. */
export function billingSummary(companyId) {
  const b = companyBilling(companyId);
  const { plan } = b;
  return {
    plan: plan.key,
    plan_name: plan.name,
    source: b.source,
    trial_days_left: b.trial_days_left,
    trial_ends_at: b.trial_ends_at,
    limits: { members: plan.members, projects: plan.projects },
    features: { ...plan.features },
    usage: usage(companyId),
    subscription: b.subscription,
    override: b.override,
  };
}
