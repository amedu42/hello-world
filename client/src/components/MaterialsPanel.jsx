import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, todayISO } from '../api.js';
import { fmtQty } from '../pages/MaterialsPage.jsx';
import { Spinner } from './ui.jsx';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default function MaterialsPanel({ projectId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const today = todayISO();
  useEffect(() => {
    api.get(`/api/projects/${projectId}/materials-overview?today=${today}`).then(setData).catch((e) => setError(e.message));
  }, [projectId, today]);
  const link = `/projects/${projectId}/materials`;

  return (
    <section className="card materials-panel">
      <div className="row between wrap gap">
        <h2>Materials</h2>
        {data?.materials.length > 0 && <Link className="btn ghost sm" to={link}>Open register</Link>}
      </div>
      {error && <p className="muted small">{error}</p>}
      {!data && !error && <Spinner label="Loading…" />}
      {data && data.materials.length === 0 && (
        <div className="att-empty">
          <p className="muted">Track deliveries and daily usage of materials, with stock on hand and low-stock warnings.</p>
          <Link className="btn primary" to={link}>Set up materials register</Link>
        </div>
      )}
      {data && data.materials.length > 0 && (
        <div className="mat-panel-grid">
          <div>
            <div className="hero-label">Today</div>
            <div className="att-big">
              <div><span className="n">{data.today?.deliveries || 0}</span><span className="l">{data.today?.deliveries === 1 ? 'delivery' : 'deliveries'}</span></div>
              <div><span className="n">{data.today?.usage || 0}</span><span className="l">{data.today?.usage === 1 ? 'usage entry' : 'usage entries'}</span></div>
              <div className={data.low.length ? 'absent' : ''}><span className="n">{data.low.length}</span><span className="l">low stock</span></div>
            </div>
            <p className="muted small">Last 7 days: {plural(data.week.delivered || 0, 'delivery', 'deliveries')}, {plural((data.week.used || 0) + (data.week.wasted || 0), 'usage entry', 'usage entries')}{data.week.wasted ? ` (${data.week.wasted} wastage)` : ''}.</p>
            <Link className="btn primary sm" to={link}>Record delivery or usage</Link>
          </div>
          <div>
            <div className="hero-label">{data.low.length ? 'Needs attention' : 'Stock on hand'}</div>
            <ul className="stock-list">
              {(data.low.length ? data.low : data.materials).slice(0, 6).map((m) => (
                <li key={m.id}>
                  <span className="stock-name">{m.name}</span>
                  <span className={`stock-qty ${m.negative || m.low ? 'neg' : ''}`}>
                    {fmtQty(m.stock)} {m.unit}
                    {m.negative ? <span className="stock-tag bad">check</span> : m.low ? <span className="stock-tag low">low</span> : null}
                  </span>
                  <span className="muted small stock-last">{m.last_delivery ? `last delivery ${fmtDate(m.last_delivery, { day: 'numeric', month: 'short' })}` : 'no deliveries yet'}</span>
                </li>
              ))}
            </ul>
            {data.materials.length > 6 && !data.low.length && <Link className="small" to={link}>All {data.materials.length} materials →</Link>}
          </div>
        </div>
      )}
    </section>
  );
}
