import { useState } from 'react';
import { todayISO } from '../api.js';
import { Field, Modal } from './ui.jsx';

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function presets() {
  const t = new Date(todayISO() + 'T00:00:00');
  const day = (t.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(t);
  monday.setDate(t.getDate() - day);
  const firstThis = new Date(t.getFullYear(), t.getMonth(), 1);
  const firstLast = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  const endLast = new Date(t.getFullYear(), t.getMonth(), 0);
  const last7 = new Date(t);
  last7.setDate(t.getDate() - 6);
  return [
    { key: 'week', label: 'This week', from: iso(monday), to: iso(t) },
    { key: '7', label: 'Last 7 days', from: iso(last7), to: iso(t) },
    { key: 'month', label: 'This month', from: iso(firstThis), to: iso(t) },
    { key: 'lastmonth', label: 'Last month', from: iso(firstLast), to: iso(endLast) },
  ];
}

/** Choose a period (max 31 days) and download the landscape attendance sheet. */
export default function AttendancePdfModal({ projectId, onClose }) {
  const P = presets();
  const [sel, setSel] = useState('month');
  const [from, setFrom] = useState(P[2].from);
  const [to, setTo] = useState(P[2].to);
  const span = from && to ? (Date.parse(to) - Date.parse(from)) / 86400000 + 1 : 0;
  const problem = !from || !to ? 'Choose both dates.' : span < 1 ? 'The start date must be before the end date.' : span > 31 ? 'Choose a period of up to 31 days (one page width).' : null;
  const href = `/api/projects/${projectId}/attendance-pdf?from=${from}&to=${to}`;

  const choose = (p) => {
    setSel(p.key);
    setFrom(p.from);
    setTo(p.to);
  };

  return (
    <Modal
      title="Download attendance register"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <a className={`btn ghost ${problem ? 'disabled' : ''}`} href={problem ? undefined : `${href}&inline=1`} target="_blank" rel="noreferrer" aria-disabled={Boolean(problem)}>View</a>
          <a className={`btn primary ${problem ? 'disabled' : ''}`} href={problem ? undefined : href} aria-disabled={Boolean(problem)} onClick={() => !problem && setTimeout(onClose, 300)}>Download PDF</a>
        </>
      }
    >
      <p className="muted small">A landscape sheet with everyone down the side and the dates across: P (present), L (late) or A (absent) for each day, each person's totals and attendance %, and a list of every absence with its reason.</p>
      <div className="preset-row">
        {P.map((p) => (
          <button key={p.key} className={`att-chip ${sel === p.key ? 'on' : ''}`} onClick={() => choose(p)}>{p.label}</button>
        ))}
      </div>
      <div className="grid-2">
        <Field label="From"><input type="date" value={from} max={todayISO()} onChange={(e) => { setFrom(e.target.value); setSel(null); }} /></Field>
        <Field label="To"><input type="date" value={to} max={todayISO()} onChange={(e) => { setTo(e.target.value); setSel(null); }} /></Field>
      </div>
      {problem ? <div className="note warn small"><span>{problem}</span></div> : <p className="muted small">{span} day{span === 1 ? '' : 's'}. Days with no register are shaded on the sheet.</p>}
    </Modal>
  );
}
