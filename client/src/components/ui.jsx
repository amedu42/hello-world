import { useEffect, useLayoutEffect, useState } from 'react';

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

/**
 * Caps a scrollable list so exactly `count` rows are visible (rows can differ in height, e.g. long
 * names wrapping on phones). Returns { overflowing, total } for showing a "scroll for more" hint.
 * `rowSelector` matches the rows inside the container; group headers in between are included.
 */
export function useVisibleRows(ref, rowSelector, count, deps = []) {
  const [state, setState] = useState({ overflowing: false, total: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The screen-height limit is left to CSS (min(…px, 65svh)) so it is always right, even while a
    // phone browser is still settling its viewport or its address bar shows and hides.
    const unit = typeof CSS !== 'undefined' && CSS.supports?.('height', '1svh') ? 'svh' : 'vh';
    const countVisible = (rows, top) => {
      const h = el.getBoundingClientRect().height;
      return [...rows].filter((r) => r.getBoundingClientRect().bottom - top <= h + 1).length;
    };
    const measure = () => {
      const rows = el.querySelectorAll(rowSelector);
      if (rows.length <= count) {
        el.style.maxHeight = '';
        setState({ overflowing: false, total: rows.length, visible: rows.length });
        return;
      }
      const top = el.getBoundingClientRect().top - el.scrollTop;
      const nRows = rows[count - 1].getBoundingClientRect().bottom - top;
      // Phones: at most 75% of the screen so the page can still be scrolled past the list; larger screens: 85%.
      const pct = window.matchMedia('(max-width: 640px)').matches ? 75 : 85;
      el.style.maxHeight = `min(${Math.ceil(nRows)}px, ${pct}${unit})`;
      setState({ overflowing: true, total: rows.length, visible: countVisible(rows, top) });
    };
    measure();
    // Re-measure when the list's width changes (text may rewrap) or the screen height changes
    // (the CSS limit then shows a different number of rows, which the hint reports).
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      el.style.maxHeight = '';
      measure();
    });
    ro.observe(el);
    const onResize = () => {
      const rows = el.querySelectorAll(rowSelector);
      if (rows.length > count) setState((st) => ({ ...st, visible: countVisible(rows, el.getBoundingClientRect().top - el.scrollTop) }));
    };
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
