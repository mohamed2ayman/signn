import { ManagexMark } from './ManagexLogo';

/* ═══════════════════════════════════════════════════════════════════
   Hero Dashboard Mockup
   Static visual showing a SIGN-style contract dashboard inside a
   faux browser chrome. Pure decoration — no interactivity.
   ═══════════════════════════════════════════════════════════════════ */

const NAV = [
  { label: 'Contracts', active: true },
  { label: 'Obligations' },
  { label: 'Risk Register' },
  { label: 'Notices' },
  { label: 'Claims' },
  { label: 'Sub-Contracts' },
];

const STATS = [
  { label: 'Total Value', value: '$284M', delta: '↑ 12% this quarter', deltaColor: '#22C55E', valueColor: 'var(--mx-cyan)' },
  { label: 'Risk Flags', value: '7', delta: '3 require action', deltaColor: '#EAB308', valueColor: 'var(--d-bright)' },
  { label: 'Compliance', value: '94%', delta: '↑ from 88%', deltaColor: '#22C55E', valueColor: 'var(--mx-cyan)' },
];

const ROWS = [
  {
    dot: '#4F6EF7',
    name: 'Al Maryah Tower — Main Contract (NEC4)',
    badge: 'Active',
    badgeBg: 'rgba(34,197,94,0.10)',
    badgeColor: '#22C55E',
    value: '$142M',
  },
  {
    dot: '#EAB308',
    name: 'Riyadh Metro Phase 3 — Subcontract Review',
    badge: 'Under Review',
    badgeBg: 'rgba(234,179,8,0.10)',
    badgeColor: '#EAB308',
    value: '$38M',
  },
  {
    dot: '#EF4444',
    name: 'Cairo Infrastructure — FIDIC Clause 20 Risk',
    badge: 'Risk Flagged',
    badgeBg: 'rgba(239,68,68,0.10)',
    badgeColor: '#EF4444',
    value: '$104M',
  },
];

export default function HeroDashboard() {
  return (
    <div className="mx-dashboard">
      {/* Browser chrome */}
      <div className="mx-dashboard__chrome">
        <span style={{ background: '#FF5F57', width: 10, height: 10, borderRadius: '50%' }} />
        <span style={{ background: '#FEBC2E', width: 10, height: 10, borderRadius: '50%' }} />
        <span style={{ background: '#28C840', width: 10, height: 10, borderRadius: '50%' }} />
        <div className="mx-dashboard__url">app.managex.ai · SIGN — Contracts &amp; Risk</div>
        <span style={{ width: 30 }} />
      </div>

      {/* Body grid */}
      <div className="mx-dashboard__body">
        {/* Sidebar */}
        <aside className="mx-dashboard__sidebar">
          <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-end', gap: 8, lineHeight: 1 }}>
            <ManagexMark size={20} />
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, lineHeight: 1 }}>
              <span
                style={{
                  fontFamily: 'var(--f-display)',
                  fontWeight: 800,
                  fontSize: 13,
                  letterSpacing: '-0.02em',
                  color: 'var(--d-bright)',
                  lineHeight: 1,
                }}
              >
                MANAGE
              </span>
              <span
                style={{
                  fontFamily: 'var(--f-display)',
                  fontWeight: 800,
                  fontSize: 20,
                  letterSpacing: '-0.04em',
                  color: 'var(--mx-cyan)',
                  lineHeight: 0.82,
                  position: 'relative',
                  top: 2,
                }}
              >
                X
              </span>
            </div>
          </div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {NAV.map((item) => (
              <div
                key={item.label}
                className={item.active ? 'mx-dashboard__nav-item is-active' : 'mx-dashboard__nav-item'}
              >
                {item.label}
              </div>
            ))}
          </nav>
        </aside>

        {/* Main */}
        <div className="mx-dashboard__main">
          <header className="mx-dashboard__header">
            <h3>Active Contracts</h3>
            <span className="mx-dashboard__badge">SIGN · AI Active</span>
          </header>

          {/* Stats */}
          <div className="mx-dashboard__stats">
            {STATS.map((s) => (
              <div key={s.label} className="mx-dashboard__stat">
                <div className="mx-dashboard__stat-label">{s.label}</div>
                <div className="mx-dashboard__stat-value" style={{ color: s.valueColor }}>
                  {s.value}
                </div>
                <div className="mx-dashboard__stat-delta" style={{ color: s.deltaColor }}>
                  {s.delta}
                </div>
              </div>
            ))}
          </div>

          {/* Contract rows */}
          <div className="mx-dashboard__rows">
            {ROWS.map((r) => (
              <div key={r.name} className="mx-dashboard__row">
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: r.dot, flexShrink: 0 }} />
                <span className="mx-dashboard__row-name">{r.name}</span>
                <span
                  className="mx-dashboard__row-badge"
                  style={{ background: r.badgeBg, color: r.badgeColor }}
                >
                  {r.badge}
                </span>
                <span className="mx-dashboard__row-value">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
