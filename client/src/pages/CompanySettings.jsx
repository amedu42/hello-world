import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { ErrorNote, Field, Spinner } from '../components/ui.jsx';
import { prepareImage } from '../images.js';

const DEFAULT_BAND = '#16324f';
const PRESETS = ['#16324f', '#1f5fa8', '#0f766e', '#1f6f43', '#b42318', '#c2410c', '#f2a900', '#6d28d9', '#334155', '#111827'];
const HEX = /^#[0-9a-f]{6}$/i;

// Same colour rules as the PDF (server/pdf.js reportPalette), for the live preview.
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const lum = (h) => {
  const [r, g, b] = rgb(h).map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
function palette(p) {
  if (!p || !HEX.test(p)) return { band: DEFAULT_BAND, onBand: '#ffffff', sub: '#cfd9e6', stripe: '#f2a900', heading: DEFAULT_BAND, soft: '#f3f5f8', fill: '#f2a900', adjusted: false };
  const onBand = contrast(p, '#ffffff') >= contrast(p, '#1c2430') ? '#ffffff' : '#1c2430';
  let heading = p;
  for (let t = 0.1; contrast(heading, '#ffffff') < 4.5 && t <= 1; t += 0.1) heading = mix(p, '#000000', t);
  return { band: p, onBand, sub: mix(onBand, p, 0.25), stripe: mix(p, '#000000', 0.3), heading, soft: mix(p, '#ffffff', 0.9), fill: p, adjusted: heading !== p.toLowerCase() };
}

export default function CompanySettings() {
  const { me, reload } = useAuth();
  const isAdmin = me.user.role === 'admin';
  const [name, setName] = useState(me.company.name);
  const [color, setColor] = useState(me.company.primary_color || '');
  const [hexText, setHexText] = useState(me.company.primary_color || '');
  const [logoUrl, setLogoUrl] = useState(me.company.has_logo ? `/api/company/logo?v=${me.company.logo_version}` : null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setHexText(color);
  }, [color]);

  const P = palette(color);
  const dirty = name.trim() !== me.company.name || (color || null) !== (me.company.primary_color || null);

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      await api.put('/api/company', { name, primary_color: color || null });
      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    setBusy('logo');
    setError(null);
    try {
      const png = await prepareImage(file, { maxDim: 800, maxBytes: 2 * 1024 * 1024, output: 'png' });
      if (png.size > 2 * 1024 * 1024) throw new Error('The logo is larger than 2 MB even after resizing. Try a simpler image.');
      const fd = new FormData();
      fd.append('logo', png);
      const res = await api.post('/api/company/logo', fd);
      setLogoUrl(`/api/company/logo?v=${res.logo_version}`);
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const removeLogo = async () => {
    if (!confirm('Remove the company logo from reports?')) return;
    setBusy('logo');
    try {
      await api.del('/api/company/logo');
      setLogoUrl(null);
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (!isAdmin) {
    return (
      <>
        <nav className="crumbs"><Link to="/">Projects</Link> / <span>Company settings</span></nav>
        <p className="muted">Only company admins can change the logo and colours.</p>
      </>
    );
  }

  return (
    <>
      <nav className="crumbs"><Link to="/">Projects</Link> / <span>Company settings</span></nav>
      <div className="page-head">
        <div>
          <h1>Company settings</h1>
          <p className="muted">Your logo and brand colour appear on every daily report PDF your team downloads.</p>
        </div>
      </div>
      <ErrorNote error={error} onClose={() => setError(null)} />
      {saved && <div className="note success"><span>Saved. New PDFs will use these settings.</span></div>}

      <div className="settings-grid">
        <div>
          <section className="card">
            <h2>Company name</h2>
            <Field label="Shown on reports and to your team">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </Field>
          </section>

          <section className="card">
            <h2>Logo</h2>
            <div className="logo-row">
              <div className="logo-box">{logoUrl ? <img src={logoUrl} alt="Company logo" /> : <span className="muted small">No logo</span>}</div>
              <div className="stack">
                <label className="btn ghost">
                  <input type="file" accept="image/*" hidden onChange={(e) => { uploadLogo(e.target.files[0]); e.target.value = ''; }} />
                  {busy === 'logo' ? <Spinner label="Uploading…" /> : logoUrl ? 'Replace logo' : 'Upload logo'}
                </label>
                {logoUrl && <button className="btn ghost danger-text" onClick={removeLogo} disabled={busy === 'logo'}>Remove</button>}
              </div>
            </div>
            <p className="muted small">PNG with a transparent background works best. JPEG, SVG and WebP are converted automatically. It sits on a white tile in the report header, so any colour logo stays clear.</p>
          </section>

          <section className="card">
            <h2>Primary colour</h2>
            <div className="color-row">
              <input type="color" value={color || DEFAULT_BAND} onChange={(e) => setColor(e.target.value)} aria-label="Pick colour" className="color-input" />
              <input
                className="hex-input"
                value={hexText}
                placeholder="#1F5FA8"
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setHexText(v);
                  const h = v.startsWith('#') ? v : `#${v}`;
                  if (HEX.test(h)) setColor(h.toLowerCase());
                }}
                aria-label="Hex colour"
              />
              {color && <button className="btn ghost sm" onClick={() => setColor('')}>Use SitePulse default</button>}
            </div>
            <div className="swatches">
              {PRESETS.map((c) => (
                <button key={c} className={`swatch ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Use ${c}`} title={c} />
              ))}
            </div>
            <p className="muted small">
              Used for the report header, section headings, table headers, lines and progress bars.
              {P.adjusted && ' This colour is light, so headings use a darker shade of it to stay readable on white paper.'}
            </p>
          </section>

          <div className="row gap">
            <button className="btn primary" onClick={save} disabled={!dirty || busy === 'save' || !name.trim()}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button>
            {dirty && <span className="muted small">Unsaved changes</span>}
          </div>
        </div>

        <div className="preview-col">
          <div className="preview-label">PDF preview</div>
          <div className="pdf-preview" aria-label="Preview of the report header">
            <div className="pp-band" style={{ background: P.band, color: P.onBand }}>
              {logoUrl && <div className="pp-logo"><img src={logoUrl} alt="" /></div>}
              <div className="pp-titles">
                <div className="pp-title">DAILY SITE REPORT</div>
                <div className="pp-sub" style={{ color: P.sub }}>Riverside Office Block · RVB-01</div>
                <div className="pp-sub" style={{ color: P.sub }}>Friday, 20 November 2026</div>
              </div>
              <div className="pp-no">
                <b>Report No. 12</b>
                <div style={{ color: P.sub }}>{name || 'Your company'}</div>
              </div>
            </div>
            <div className="pp-stripe" style={{ background: P.stripe }} />
            <div className="pp-body">
              <div className="pp-overall" style={{ background: P.soft }}>
                <div className="pp-k">OVERALL PROGRESS</div>
                <div className="pp-big" style={{ color: P.heading }}>37.5%</div>
                <div className="pp-bar"><div style={{ width: '37.5%', background: P.fill }} /></div>
              </div>
              <div className="pp-h" style={{ color: P.heading, borderColor: P.fill }}>TODAY'S ACTIVITIES &amp; PROGRESS</div>
              <div className="pp-th" style={{ background: P.soft, color: P.heading }}><span>ACTIVITY</span><span>TODAY</span></div>
              <div className="pp-tr"><span>Excavation for foundations</span><span>25%</span></div>
              <div className="pp-tr"><span>Blinding to pad footings</span><span>10%</span></div>
              <div className="pp-h" style={{ color: P.heading, borderColor: P.fill }}>WEATHER CONDITIONS</div>
              <div className="pp-tr"><span>Condition</span><span>Sunny</span></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
