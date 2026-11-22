import { useState } from 'react';
import { todayISO } from '../api.js';
import { Field, Modal } from './ui.jsx';

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function presets(day) {
  const t = new Date(todayISO() + 'T00:00:00');
  const weekday = (t.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(t);
  monday.setDate(t.getDate() - weekday);
  const firstThis = new Date(t.getFullYear(), t.getMonth(), 1);
  const firstLast = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  const endLast = new Date(t.getFullYear(), t.getMonth(), 0);
  const last7 = new Date(t);
  last7.setDate(t.getDate() - 6);
  return [
    ...(day ? [{ key: 'day', label: day === todayISO() ? 'Today' : 'This day', from: day, to: day }] : []),
    { key: 'week', label: 'This week', from: iso(monday), to: iso(t) },
    { key: '7', label: 'Last 7 days', from: iso(last7), to: iso(t) },
    { key: 'month', label: 'This month', from: iso(firstThis), to: iso(t) },
    { key: 'lastmonth', label: 'Last month', from: iso(firstLast), to: iso(endLast) },
  ];
}

/** Attendance sheet for a period (max 31 days: one landscape page width). */
export default function AttendancePdfModal({ projectId, onClose }) {
  return (
    <PeriodPdfModal
      title="Download attendance register"
      description="A landscape sheet with everyone down the side and the dates across: P (present), L (late) or A (absent) for each day, each person's totals and attendance %, and a list of every absence with its reason."
      hrefBase={`/api/projects/${projectId}/attendance-pdf`}
      maxDays={31}
      maxNote="one page width"
      footNote="Days with no register are shaded on the sheet."
      onClose={onClose}
    />
  );
}

/** Choose a period and download a register PDF from `${hrefBase}?from=&to=`. */
export function PeriodPdfModal({ title, description, hrefBase, maxDays, maxNote, footNote, day, defaultPreset = 'month', onClose }) {
  const P = presets(day);
  const start = P.find((p) => p.key === defaultPreset) || P[0];
  const [sel, setSel] = useState(start.key);
  const [from, setFrom] = useState(start.from);
  const [to, setTo] = useState(start.to);
  const span = from && to ? (Date.parse(to) - Date.parse(from)) / 86400000 + 1 : 0;
  const problem = !from || !to ? 'Choose both dates.' : span < 1 ? 'The start date must be before the end date.' : span > maxDays ? `Choose a period of up to ${maxDays} days${maxNote ? ` (${maxNote})` : ''}.` : null;
  const href = `${hrefBase}?from=${from}&to=${to}`;

  const choose = (p) => {
    setSel(p.key);
    setFrom(p.from);
    setTo(p.to);
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <a className={`btn ghost ${problem ? 'disabled' : ''}`} href={problem ? undefined : `${href}&inline=1`} target="_blank" rel="noreferrer" aria-disabled={Boolean(problem)}>View</a>
          <a className={`btn primary ${problem ? 'disabled' : ''}`} href={problem ? undefined : href} aria-disabled={Boolean(problem)} onClick={() => !problem && setTimeout(onClose, 300)}>Download PDF</a>
        </>
      }
    >
      <p className="muted small">{description}</p>
      <div className="preset-row">
        {P.map((p) => (
          <button key={p.key} className={`att-chip ${sel === p.key ? 'on' : ''}`} onClick={() => choose(p)}>{p.label}</button>
        ))}
      </div>
      <div className="grid-2">
        <Field label="From"><input type="date" value={from} max={todayISO()} onChange={(e) => { setFrom(e.target.value); setSel(null); }} /></Field>
        <Field label="To"><input type="date" value={to} max={todayISO()} onChange={(e) => { setTo(e.target.value); setSel(null); }} /></Field>
      </div>
      {problem ? <div className="note warn small"><span>{problem}</span></div> : <p className="muted small">{span} day{span === 1 ? '' : 's'}.{footNote ? ` ${footNote}` : ''}</p>}
    </Modal>
  );
}
