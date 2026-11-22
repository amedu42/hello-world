import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, todayISO } from '../api.js';
import { Spinner } from './ui.jsx';

const DAYS = 14;
const shift = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

export default function AttendancePanel({ projectId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const today = todayISO();

  useEffect(() => {
    api.get(`/api/projects/${projectId}/attendance-overview?today=${today}&days=${DAYS}`).then(setData).catch((e) => setError(e.message));
  }, [projectId, today]);

  const link = `/projects/${projectId}/attendance`;

  return (
    <section className="card attendance-panel">
      <div className="row between wrap gap">
        <h2>Attendance</h2>
        {data?.active_workers > 0 && <Link className="btn ghost sm" to={link}>Open register</Link>}
      </div>
      {error && <p className="muted small">{error}</p>}
      {!data && !error && <Spinner label="Loading…" />}
      {data && data.active_workers === 0 && !data.today && (
        <div className="att-empty">
          <p className="muted">Keep a daily register of who is on site. Add your workforce once; each morning the supervisor marks who is present, late or absent.</p>
          <Link className="btn primary" to={link}>Set up attendance register</Link>
        </div>
      )}
      {data && (data.active_workers > 0 || data.today) && (
        <div className="att-panel-grid">
          <Today t={data.today} total={data.active_workers} link={link} />
          <History history={data.history} today={today} />
        </div>
      )}
    </section>
  );
}

function Today({ t, total, link }) {
  if (!t) {
    return (
      <div className="att-today pending">
        <div className="hero-label">Today · {fmtDate(todayISO(), { weekday: 'short', day: 'numeric', month: 'short' })}</div>
        <p>Today's register hasn't been taken yet ({total} worker{total === 1 ? '' : 's'} on the list).</p>
        <Link className="btn primary" to={link}>Take today's register</Link>
      </div>
    );
  }
  const shown = t.absentees.slice(0, 6);
  return (
    <div className="att-today">
      <div className="hero-label">Today · taken by {t.taken_by}</div>
      <div className="att-big">
        <div><span className="n">{t.present}</span><span className="l">present</span></div>
        <div className="late"><span className="n">{t.late}</span><span className="l">late</span></div>
        <div className="absent"><span className="n">{t.absent}</span><span className="l">absent</span></div>
      </div>
      <p className="small att-onsite"><b>{t.on_site}</b> of {t.present + t.late + t.absent} on site{total > t.present + t.late + t.absent ? ` · ${total - (t.present + t.late + t.absent)} not marked` : ''}</p>
      <h4>Absentees</h4>
      {t.absentees.length === 0 ? (
        <p className="muted small">Everyone on the register is here.</p>
      ) : (
        <ul className="absentee-list compact">
          {shown.map((a, i) => (
            <li key={i}>
              <b>{a.name}</b> <span className="muted">· {a.trade || 'General'}</span>
              <span className={`reason ${a.reason ? '' : 'missing'}`}>{a.reason_label}</span>
            </li>
          ))}
          {t.absentees.length > shown.length && <li className="muted small"><Link to={link}>and {t.absentees.length - shown.length} more…</Link></li>}
        </ul>
      )}
    </div>
  );
}

/** Stacked bars: present / late / absent per day for the last 14 days (gaps = no register). */
function History({ history, today }) {
  const [hover, setHover] = useState(null);
  const byDate = new Map(history.map((h) => [h.date, h]));
  const days = Array.from({ length: DAYS }, (_, i) => shift(today, i - DAYS + 1));
  const max = Math.max(1, ...history.map((h) => h.present + h.late + h.absent));
  const H = 120;
  const taken = history.length;
  const rate = taken
    ? Math.round((history.reduce((s, h) => s + h.present + h.late, 0) / Math.max(1, history.reduce((s, h) => s + h.present + h.late + h.absent, 0))) * 100)
    : null;
  const h = hover ? byDate.get(hover) : null;

  return (
    <div className="att-history">
      <div className="row between wrap gap">
        <div className="hero-label">Last {DAYS} days</div>
        {rate != null && <div className="small"><b>{rate}%</b> attendance across {taken} register{taken === 1 ? '' : 's'}</div>}
      </div>
      <div className="att-legend small">
        <span><i className="sq present" /> Present</span>
        <span><i className="sq late" /> Late</span>
        <span><i className="sq absent" /> Absent</span>
      </div>
      <div className="att-bars" style={{ height: H + 22 }} onMouseLeave={() => setHover(null)}>
        {days.map((d) => {
          const r = byDate.get(d);
          const tot = r ? r.present + r.late + r.absent : 0;
          const seg = (n) => (n / max) * H;
          return (
            <div key={d} className={`att-bar ${hover === d ? 'hover' : ''}`} onMouseEnter={() => setHover(d)} onClick={() => setHover(d)} title={r ? undefined : `${fmtDate(d)}: no register`}>
              <div className="att-stack" style={{ height: H }}>
                {r ? (
                  <>
                    {r.absent > 0 && <div className="seg absent" style={{ height: seg(r.absent) }} />}
                    {r.late > 0 && <div className="seg late" style={{ height: seg(r.late) }} />}
                    {r.present > 0 && <div className="seg present" style={{ height: seg(r.present) }} />}
                  </>
                ) : (
                  <div className="seg none" />
                )}
              </div>
              <div className="att-day">{d === today ? 'Today' : fmtDate(d, { day: 'numeric' })}</div>
              {tot > 0 && <span className="sr-only">{`${fmtDate(d)}: ${r.present} present, ${r.late} late, ${r.absent} absent`}</span>}
            </div>
          );
        })}
      </div>
      <div className="att-tip small">
        {hover ? (
          h ? (
            <span><b>{fmtDate(hover, { weekday: 'short', day: 'numeric', month: 'short' })}</b>: {h.present} present · {h.late} late · {h.absent} absent</span>
          ) : (
            <span><b>{fmtDate(hover, { weekday: 'short', day: 'numeric', month: 'short' })}</b>: no register taken</span>
          )
        ) : (
          <span className="muted">Hover or tap a day for details.</span>
        )}
      </div>
    </div>
  );
}
