import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorNote, Spinner } from '../components/ui.jsx';
import { disablePush, enablePush, pushStatus } from '../push.js';

const DESCRIPTIONS = {
  register_reminder: "If today's attendance register hasn't been taken by your reminder time.",
  report_reminder: "If today's daily report hasn't been filed by your reminder time.",
  register_submitted: 'When someone saves the day’s attendance register (present / late / absent).',
  report_submitted: 'When someone files a new daily report, with the progress figure.',
  high_issue: 'As soon as a daily report records a High-severity site issue.',
  low_stock: 'When a material drops to its reorder level (or below zero).',
  behind: 'When a project falls behind its programme by your threshold (at most once a week per project).',
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ORDER = ['register_reminder', 'report_reminder', 'register_submitted', 'report_submitted', 'high_issue', 'low_stock', 'behind'];

export default function NotificationsPage() {
  const [cfg, setCfg] = useState(null);
  const [status, setStatus] = useState('…');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const [c, st] = await Promise.all([api.get('/api/push/config'), pushStatus()]);
      setCfg(c);
      setStatus(st);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (patch) => {
    setError(null);
    const prev = cfg.prefs;
    setCfg((c) => ({ ...c, prefs: { ...c.prefs, ...patch, types: { ...c.prefs.types, ...(patch.types || {}) } } }));
    try {
      const { prefs } = await api.put('/api/push/prefs', patch);
      setCfg((c) => ({ ...c, prefs }));
    } catch (e) {
      setError(e.message);
      setCfg((c) => ({ ...c, prefs: prev }));
    }
  };

  const toggleDevice = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (status === 'on') {
        await disablePush();
        setNotice('Notifications turned off on this device.');
      } else {
        await enablePush();
        setNotice('Notifications are on for this device.');
      }
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setError(null);
    setNotice(null);
    try {
      const { sent } = await api.post('/api/push/test');
      setNotice(sent ? `Test sent to ${sent} device${sent > 1 ? 's' : ''}. It should arrive in a few seconds.` : 'No devices are set up yet. Turn notifications on first.');
    } catch (e) {
      setError(e.message);
    }
  };

  if (!cfg) return error ? <ErrorNote error={error} /> : <Spinner label="Loading…" />;
  const p = cfg.prefs;
  const deviceText = {
    on: 'On for this device',
    off: 'Off for this device',
    blocked: 'Blocked in this browser',
    unsupported: 'Not supported by this browser',
    'ios-install-first': 'Add Proj4D to your home screen first',
  }[status] || '…';

  return (
    <div className="narrow wide-narrow">
      <nav className="crumbs"><Link to="/">Projects</Link> / <span>Notifications</span></nav>
      <h1>Notifications</h1>
      <p className="muted">Reminders and alerts for your company's projects, sent to your phone or computer.</p>
      <ErrorNote error={error} onClose={() => setError(null)} />
      {notice && <div className="note success"><span>{notice}</span></div>}

      <section className="card">
        <div className="row between wrap gap">
          <div>
            <h2 className="no-margin">This device</h2>
            <div className={`device-status ${status}`}>{deviceText}</div>
          </div>
          <div className="row gap wrap">
            {(status === 'on' || status === 'off') && (
              <button className={`btn ${status === 'on' ? 'ghost' : 'primary'}`} onClick={toggleDevice} disabled={busy}>
                {busy ? 'Please wait…' : status === 'on' ? 'Turn off' : 'Turn on notifications'}
              </button>
            )}
            {cfg.devices > 0 && <button className="btn ghost" onClick={test}>Send a test</button>}
          </div>
        </div>
        {status === 'blocked' && <p className="small muted">Notifications were blocked. Allow them for this site in your browser's site settings (on Android: tap the padlock or ⓘ next to the address, or long-press the installed app icon → App info → Notifications), then come back here.</p>}
        {status === 'ios-install-first' && <p className="small muted">On iPhone and iPad, notifications work once Proj4D is on your home screen: open it in Safari, tap Share → <b>Add to Home Screen</b>, then open Proj4D from the home screen and turn notifications on here.</p>}
        <p className="small muted">You're set up on {cfg.devices} device{cfg.devices === 1 ? '' : 's'}. Turn notifications on separately on each phone or computer you use.</p>
      </section>

      <section className="card">
        <h2>What to notify me about</h2>
        <div className="notif-list">
          {ORDER.map((k) => (
            <label key={k} className="notif-row">
              <input type="checkbox" checked={Boolean(p.types[k])} onChange={(e) => save({ types: { [k]: e.target.checked } })} />
              <span>
                <b>{cfg.types[k]}</b>
                <span className="muted small">{DESCRIPTIONS[k]}</span>
                {k === 'register_reminder' && p.types[k] && (
                  <span className="inline-field">Remind me at <input type="time" value={p.register_time} onChange={(e) => e.target.value && save({ register_time: e.target.value })} /></span>
                )}
                {k === 'report_reminder' && p.types[k] && (
                  <span className="inline-field">Remind me at <input type="time" value={p.report_time} onChange={(e) => e.target.value && save({ report_time: e.target.value })} /></span>
                )}
                {k === 'behind' && p.types[k] && (
                  <span className="inline-field">
                    When at least <input type="number" min="1" max="100" value={p.behind_points} onChange={(e) => e.target.value && save({ behind_points: Number(e.target.value) })} className="pts" /> percentage points behind plan
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Reminder days and time zone</h2>
        <div className="day-chips" role="group" aria-label="Working days">
          {DAYS.map((d, i) => {
            const on = p.workdays.includes(i);
            return (
              <button key={d} className={`att-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => save({ workdays: on ? p.workdays.filter((x) => x !== i) : [...p.workdays, i] })}>
                {d}
              </button>
            );
          })}
        </div>
        <p className="small muted">Reminders are only sent on these days. Alerts (issues, low stock, submissions) come any day.</p>
        <p className="small">
          Time zone: <b>{p.timezone}</b>{' '}
          {Intl.DateTimeFormat().resolvedOptions().timeZone !== p.timezone && (
            <button className="btn ghost sm" onClick={() => save({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}>
              Use this device's ({Intl.DateTimeFormat().resolvedOptions().timeZone})
            </button>
          )}
        </p>
      </section>
    </div>
  );
}

/** One-time prompt on the projects page; hidden once notifications are on or dismissed. */
export function NotificationPrompt() {
  const [status, setStatus] = useState(null);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('sitepulse:notif-prompt') === 'dismissed';
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    pushStatus().then(setStatus).catch(() => setStatus('unsupported'));
  }, []);
  if (hidden || !status || status === 'on' || status === 'unsupported' || status === 'blocked') return null;
  const dismiss = () => {
    try {
      localStorage.setItem('sitepulse:notif-prompt', 'dismissed');
    } catch {
      /* ignore */
    }
    setHidden(true);
  };
  return (
    <div className="note info notif-prompt">
      <span>
        <b>Get reminders and alerts.</b>{' '}
        {status === 'ios-install-first'
          ? 'On iPhone, add Proj4D to your home screen (Share → Add to Home Screen) to receive notifications.'
          : 'Reminders to take the register and file the daily report, plus alerts for site issues, low stock and progress.'}
        {error && <span className="neg"> {error}</span>}
      </span>
      <span className="row gap">
        {status === 'off' && (
          <button
            className="btn primary sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await enablePush();
                setStatus('on');
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '…' : 'Turn on'}
          </button>
        )}
        <Link className="btn ghost sm" to="/notifications">Settings</Link>
        <button className="icon-btn" onClick={dismiss} aria-label="Dismiss">✕</button>
      </span>
    </div>
  );
}
