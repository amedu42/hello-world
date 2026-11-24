// Plan & billing: current plan, trial, usage, plan choice (Paystack checkout), payment history.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { useAuth } from '../App.jsx';
import { ErrorNote, Spinner } from '../components/ui.jsx';

const FEATURES = {
  free: ['Daily site reports and PDFs', 'Attendance and materials registers', 'Programme upload (Excel, CSV, MS Project)', 'Progress tracking and notifications'],
  starter: ['Everything in Free', 'AI report summaries', 'Fill reports from site notes with AI', 'AI project insights', 'Read PDF programmes with AI'],
  professional: ['Everything in Starter', 'AI work programme generator (PDF and MS Project)'],
  business: ['Everything in Professional', 'Higher AI programme limits', 'Priority support'],
};
const limitText = (n, word) => (n == null ? `Unlimited ${word}` : `Up to ${n} ${word}`);

const guessCurrency = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone === 'Africa/Lagos' ? 'NGN' : 'USD';
  } catch {
    return 'NGN';
  }
};
// Symbols written out: some browsers show "NGN" instead of "₦".
const money = (amount, currency) =>
  (currency === 'NGN' ? '₦' : '$') +
  Number(amount || 0).toLocaleString(undefined, currency === 'NGN' || Number.isInteger(amount) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BillingPage() {
  const { reload } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);
  const [currency, setCurrency] = useState(null);
  const [interval, setPeriod] = useState('monthly');
  const verified = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get('/api/billing');
      setData(d);
      setCurrency((c) => c || d.billing.subscription?.currency || guessCurrency());
      if (d.billing.subscription?.interval) setPeriod((i) => (i === 'monthly' ? d.billing.subscription.interval : i));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // Back from Paystack: confirm the payment.
  const reference = params.get('reference') || params.get('trxref');
  useEffect(() => {
    if (!reference || verified.current) {
      load();
      return;
    }
    verified.current = true;
    (async () => {
      setBusy('verify');
      try {
        const r = await api.post('/api/billing/verify', { reference });
        if (r.ok) {
          setNotice(`Payment received. You're now on the ${r.billing.plan_name} plan. Thank you!`);
          reload();
        } else setError(`The payment was not completed${r.message ? ` (${r.message})` : ''}. You have not been charged for the plan; please try again.`);
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(null);
        setParams({}, { replace: true });
        load();
      }
    })();
  }, [reference, load, reload, setParams]);

  const run = async (key, fn) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) return <ErrorNote error={error} />;
  if (!data || !currency) return <Spinner label={busy === 'verify' ? 'Confirming your payment…' : 'Loading…'} />;

  const b = data.billing;
  const sub = b.subscription;
  const activeSub = sub?.active ? sub : null;

  const choose = (plan) =>
    run(`plan:${plan.key}`, async () => {
      if (activeSub && !confirm(`Switch to ${plan.name}? The new plan starts today and is paid in full now; the time left on ${activeSub.plan_name} isn't refunded, and your ${activeSub.plan_name} subscription is stopped.`)) return;
      const { url } = await api.post('/api/billing/checkout', { plan: plan.key, interval, currency });
      window.location.assign(url);
    });

  const manage = () =>
    run('manage', async () => {
      const { url } = await api.post('/api/billing/manage-link');
      window.open(url, '_blank', 'noopener');
    });

  const cancel = () =>
    run('cancel', async () => {
      if (!confirm(`Cancel your ${sub.plan_name} subscription? You keep it until ${fmtDate(sub.current_period_end.slice(0, 10))}, then move to the Free plan. Your data is kept.`)) return;
      await api.post('/api/billing/cancel');
      setNotice(`Your subscription is cancelled. You keep ${sub.plan_name} until ${fmtDate(sub.current_period_end.slice(0, 10))}.`);
      reload();
      load();
    });

  const statusLine = () => {
    if (b.source === 'trial') return `Free trial with every feature: ${b.trial_days_left} day${b.trial_days_left === 1 ? '' : 's'} left (until ${fmtDate(b.trial_ends_at.slice(0, 10))}). No card needed. Choose a plan to keep your features after the trial.`;
    if (b.source === 'complimentary') return 'Provided free of charge by Proj4D.';
    if (activeSub) {
      const end = fmtDate(activeSub.current_period_end.slice(0, 10));
      if (activeSub.status === 'active') return `Paid ${activeSub.interval === 'annually' ? 'yearly' : 'monthly'} in ${activeSub.currency}. Renews automatically on ${end}.`;
      if (activeSub.status === 'attention') return `Your last renewal payment failed. Update your card to keep this plan (paid until ${end}).`;
      return `Cancelled. You keep this plan until ${end}, then move to Free.`;
    }
    return 'Free forever. Upgrade any time for AI features and bigger teams.';
  };

  const usageRow = (label, used, limit) => (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{used}<span className="stat-of"> / {limit == null ? '∞' : limit}</span></div>
    </div>
  );

  return (
    <div className="billing">
      <nav className="crumbs"><Link to="/">Projects</Link> / <span>Plan &amp; billing</span></nav>
      <div className="page-head">
        <div>
          <h1>Plan &amp; billing</h1>
          <p className="muted">Every plan starts with a {data.trial_days}-day free trial of all features. No card needed.</p>
        </div>
      </div>
      <ErrorNote error={error} onClose={() => setError(null)} />
      {notice && <div className="note success"><span>{notice}</span><button className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button></div>}
      {busy === 'verify' && <div className="note info"><Spinner label="Confirming your payment…" /></div>}

      <section className="card current-plan">
        <div className="current-plan-main">
          <div className="hero-label">Current plan</div>
          <div className="current-plan-name">
            {b.plan_name}
            {b.source === 'trial' && <span className="premium-tag">Trial</span>}
          </div>
          <p className="muted">{statusLine()}</p>
          {data.is_admin && sub?.manageable && activeSub && (
            <div className="row gap wrap">
              <button className="btn ghost sm" onClick={manage} disabled={!!busy}>Update card</button>
              {activeSub.status !== 'cancelled' && <button className="btn ghost sm danger-text" onClick={cancel} disabled={!!busy}>Cancel subscription</button>}
            </div>
          )}
        </div>
        <div className="hero-stats">
          {usageRow('Members', b.usage.members, b.limits.members)}
          {usageRow('Projects', b.usage.projects, b.limits.projects)}
          <div className="stat">
            <div className="stat-label">AI features</div>
            <div className="stat-value small-value">{b.features.programmes ? 'All' : b.features.ai ? 'Reports' : 'None'}</div>
          </div>
        </div>
      </section>

      {!data.payments_enabled && (
        <div className="note info">Online payment isn't switched on yet. <Link to="/home#demo">Contact us</Link> to subscribe.</div>
      )}
      {!data.is_admin && <div className="note info">Only your company admin can change the plan.</div>}

      <div className="row between wrap gap plan-toggles">
        <div className="segmented" role="group" aria-label="Billing period">
          {[['monthly', 'Monthly'], ['annually', 'Yearly · 2 months free']].map(([k, label]) => (
            <label key={k} className={interval === k ? 'on' : ''}>
              <input type="radio" name="interval" checked={interval === k} onChange={() => setPeriod(k)} /> {label}
            </label>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Currency">
          {data.currencies.map((c) => (
            <label key={c} className={currency === c ? 'on' : ''}>
              <input type="radio" name="currency" checked={currency === c} onChange={() => setCurrency(c)} /> {c === 'NGN' ? '₦ Naira' : '$ US dollar'}
            </label>
          ))}
        </div>
      </div>

      <div className="plan-grid">
        {data.plans.map((p) => {
          const price = data.prices[p.key]?.[currency]?.[interval];
          const isCurrentPaid = activeSub && activeSub.plan === p.key && activeSub.interval === interval && activeSub.status === 'active';
          const isCurrent = p.key === b.plan && b.source !== 'trial';
          return (
            <section key={p.key} className={`card plan-card ${p.key === 'professional' ? 'featured' : ''} ${isCurrent ? 'current' : ''}`}>
              {p.key === 'professional' && <div className="plan-flag">Most popular</div>}
              <h2>{p.name}</h2>
              <p className="muted small plan-blurb">{p.blurb}</p>
              <div className="plan-price">
                {p.key === 'free' ? (
                  <>{money(0, currency)}<span> forever</span></>
                ) : (
                  <>
                    {money(price, currency)}
                    <span>/{interval === 'annually' ? 'year' : 'month'}</span>
                  </>
                )}
              </div>
              {p.key !== 'free' && interval === 'annually' && <div className="muted small">{money(Math.round((price / 12) * 100) / 100, currency)} a month, billed yearly</div>}
              <ul className="plan-features">
                <li><b>{limitText(p.members, 'members')}</b></li>
                <li><b>{limitText(p.projects, 'projects')}</b></li>
                {FEATURES[p.key].map((f) => (
                  <li key={f}>{f}</li>
                ))}
                {p.key === 'free' && <li className="no">No AI features</li>}
              </ul>
              <div className="plan-cta">
                {p.key === 'free' ? (
                  <span className="muted small">{isCurrent ? 'Your current plan' : activeSub ? 'Cancel your subscription to move to Free' : 'Included after your trial'}</span>
                ) : isCurrentPaid ? (
                  <button className="btn ghost" disabled>Current plan</button>
                ) : (
                  <button
                    className={`btn ${p.key === 'professional' ? 'primary' : 'ghost'}`}
                    disabled={!data.is_admin || !data.payments_enabled || !!busy}
                    onClick={() => choose(p)}
                  >
                    {busy === `plan:${p.key}` ? 'Opening Paystack…' : activeSub ? (p.rank > (data.plans.find((x) => x.key === activeSub.plan)?.rank ?? 0) ? `Upgrade to ${p.name}` : `Switch to ${p.name}`) : `Choose ${p.name}`}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <p className="muted small">
        Payments are processed securely by Paystack (card, bank transfer or USSD). Subscriptions renew automatically and you can cancel any time; you keep your plan until
        the end of the period you paid for. If you go over the Free plan's limits after a trial or cancellation, nothing is deleted: extra members are paused until you upgrade.
      </p>

      {data.payments.length > 0 && (
        <section className="card">
          <h2 className="no-margin">Payments</h2>
          <div className="table-scroll">
            <table className="table stack-mobile">
              <thead><tr><th>Date</th><th>Plan</th><th className="num">Amount</th><th>Method</th><th>Reference</th></tr></thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.reference}>
                    <td className="nowrap">{fmtDate((p.paid_at || '').slice(0, 10))}</td>
                    <td data-label="Plan">{data.plans.find((x) => x.key === p.plan)?.name || p.plan} ({p.interval === 'annually' ? 'yearly' : 'monthly'})</td>
                    <td className="num" data-label="Amount">{money(p.amount, p.currency)}</td>
                    <td data-label="Method">{p.channel || '—'}</td>
                    <td className="muted small break" data-label="Reference">{p.reference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Paystack emails a receipt for each payment.</p>
        </section>
      )}
    </div>
  );
}
