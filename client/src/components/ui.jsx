import { useEffect } from 'react';

export function Modal({ title, onClose, children, wide, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ProgressBar({ value = 0, planned, size = 'md' }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className={`pbar ${size}`} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={`pbar-fill ${v >= 100 ? 'done' : ''}`} style={{ width: `${v}%` }} />
      {planned > 0 && <div className="pbar-plan" style={{ left: `${Math.min(100, planned)}%` }} title={`Planned: ${planned}%`} />}
    </div>
  );
}

export function Spinner({ label }) {
  return (
    <span className="spinner-wrap">
      <span className="spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function ErrorNote({ error, onClose }) {
  if (!error) return null;
  return (
    <div className="note error" role="alert">
      <span>{error}</span>
      {onClose && <button className="icon-btn" onClick={onClose} aria-label="Dismiss">✕</button>}
    </div>
  );
}

export function Field({ label, children, hint, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Status of an activity vs its planned progress. */
export function activityStatus(a) {
  if (a.progress >= 100) return { key: 'done', label: 'Complete' };
  if (a.planned == null) return a.progress > 0 ? { key: 'active', label: 'In progress' } : { key: 'idle', label: 'Not started' };
  const gap = a.planned - a.progress;
  if (gap > 15) return { key: 'behind', label: 'Behind' };
  if (gap > 5) return { key: 'risk', label: 'Slipping' };
  if (a.progress > 0) return { key: 'active', label: 'On track' };
  return { key: 'idle', label: 'Not started' };
}
