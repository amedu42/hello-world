import { useState } from 'react';
import { api } from '../api.js';
import { ErrorNote, Field, Modal } from './ui.jsx';

const EMPTY = { name: '', code: '', client: '', location: '', contractor: '', supervisor: '', start_date: '', end_date: '', description: '' };

export default function ProjectFormModal({ project, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...Object.fromEntries(Object.entries(project || {}).map(([k, v]) => [k, v ?? ''])) }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.keys(EMPTY).map((k) => [k, form[k]]));
      const saved = project ? await api.put(`/api/projects/${project.id}`, body) : await api.post('/api/projects', body);
      onSaved(saved);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={project ? 'Edit project' : 'New project'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="project-form" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : project ? 'Save changes' : 'Create project'}
          </button>
        </>
      }
    >
      <form id="project-form" onSubmit={submit} className="grid-2">
        <ErrorNote error={error} />
        <Field label="Project name *" className="span-2">
          <input value={form.name} onChange={set('name')} required autoFocus placeholder="e.g. Riverside Office Block" />
        </Field>
        <Field label="Project code"><input value={form.code} onChange={set('code')} placeholder="RVB-01" /></Field>
        <Field label="Client"><input value={form.client} onChange={set('client')} /></Field>
        <Field label="Location"><input value={form.location} onChange={set('location')} /></Field>
        <Field label="Contractor"><input value={form.contractor} onChange={set('contractor')} /></Field>
        <Field label="Site supervisor"><input value={form.supervisor} onChange={set('supervisor')} /></Field>
        <div />
        <Field label="Start date"><input type="date" value={form.start_date} onChange={set('start_date')} /></Field>
        <Field label="Planned completion"><input type="date" value={form.end_date} onChange={set('end_date')} /></Field>
        <Field label="Description" className="span-2">
          <textarea rows={3} value={form.description} onChange={set('description')} placeholder="Scope of works" />
        </Field>
      </form>
    </Modal>
  );
}
