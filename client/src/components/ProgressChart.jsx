import { useEffect, useRef, useState } from 'react';
import { fmtDate } from '../api.js';

// Planned vs actual overall progress over the report dates (one y-axis, 0–100%).
export default function ProgressChart({ data }) {
  const wrap = useRef(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  if (!data?.length) {
    return <div className="chart-empty muted">The progress curve appears after the first daily report.</div>;
  }

  const H = 220;
  const m = { t: 12, r: 84, b: 28, l: 36 };
  const iw = width - m.l - m.r;
  const ih = H - m.t - m.b;
  const t = data.map((d) => Date.parse(d.date));
  const t0 = Math.min(...t);
  const t1 = Math.max(...t);
  const x = (ms) => m.l + (t1 === t0 ? iw / 2 : ((ms - t0) / (t1 - t0)) * iw);
  const hasPlan = data.some((d) => d.planned != null);
  // Zoom the y-axis early in a project so small movements stay visible; always start at 0.
  const peak = Math.max(...data.flatMap((d) => [d.actual || 0, d.planned || 0]));
  const yMax = [10, 20, 40, 60, 80, 100].find((n) => peak <= n * 0.9) ?? 100;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));
  const y = (v) => m.t + ih - (Math.min(v, yMax) / yMax) * ih;
  const path = (key) =>
    data
      .filter((d) => d[key] != null)
      .map((d, i) => `${i ? 'L' : 'M'}${x(Date.parse(d.date)).toFixed(1)},${y(d[key]).toFixed(1)}`)
      .join('');

  const ticks = (() => {
    const n = Math.min(data.length, Math.max(2, Math.floor(iw / 90)));
    if (data.length === 1) return [data[0]];
    return Array.from({ length: n }, (_, i) => data[Math.round((i * (data.length - 1)) / (n - 1))]);
  })();

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    let best = 0;
    data.forEach((d, i) => {
      if (Math.abs(x(Date.parse(d.date)) - px) < Math.abs(x(Date.parse(data[best].date)) - px)) best = i;
    });
    setHover(best);
  };

  const last = data[data.length - 1];
  const h = hover != null ? data[hover] : null;
  // End labels: nudge apart when the two series finish close together.
  let ya = y(last.actual);
  let yp = hasPlan && last.planned != null ? y(last.planned) : null;
  if (yp != null && Math.abs(ya - yp) < 14) {
    const mid = (ya + yp) / 2;
    const up = last.actual >= last.planned;
    ya = mid + (up ? -7 : 7);
    yp = mid + (up ? 7 : -7);
  }

  return (
    <div className="chart" ref={wrap}>
      <div className="legend">
        <span><i className="sw actual" /> Actual</span>
        {hasPlan && <span><i className="sw planned" /> Planned (programme)</span>}
      </div>
      <svg width={width} height={H} role="img" aria-label="Overall progress, actual versus planned" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} className="grid" />
            <text x={m.l - 8} y={y(v)} className="axis" textAnchor="end" dominantBaseline="middle">{v}%</text>
          </g>
        ))}
        {ticks.map((d) => (
          <text key={d.date} x={x(Date.parse(d.date))} y={H - 8} className="axis" textAnchor="middle">
            {fmtDate(d.date, { day: 'numeric', month: 'short' })}
          </text>
        ))}
        {hasPlan && <path d={path('planned')} className="line planned" />}
        <path d={path('actual')} className="line actual" />
        {data.length <= 40 &&
          data.map((d) => <circle key={d.date} cx={x(Date.parse(d.date))} cy={y(d.actual)} r={4} className="dot actual" />)}
        {/* direct end labels */}
        <text x={x(t1) + 8} y={ya} className="end-label" dominantBaseline="middle">{last.actual}% actual</text>
        {yp != null && (
          <text x={x(t1) + 8} y={yp} className="end-label muted" dominantBaseline="middle">{last.planned}% plan</text>
        )}
        {h && (
          <g pointerEvents="none">
            <line x1={x(Date.parse(h.date))} x2={x(Date.parse(h.date))} y1={m.t} y2={m.t + ih} className="crosshair" />
            <circle cx={x(Date.parse(h.date))} cy={y(h.actual)} r={5} className="dot actual ring" />
          </g>
        )}
        <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" />
      </svg>
      {h && (
        <div className="tooltip" style={{ left: Math.min(width - 170, Math.max(0, x(Date.parse(h.date)) - 80)), top: 30 }}>
          <div className="tt-title">{fmtDate(h.date)}</div>
          <div><i className="sw actual" /> Actual <b>{h.actual}%</b></div>
          {h.planned != null && <div><i className="sw planned" /> Planned <b>{h.planned}%</b></div>}
        </div>
      )}
    </div>
  );
}
