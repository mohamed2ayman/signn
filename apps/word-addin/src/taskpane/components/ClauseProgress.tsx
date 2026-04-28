import * as React from 'react';

interface Props {
  clauseIndex: number;
  total: number;
}

/**
 * Per-clause progress indicator (Decision 3) — not a generic spinner.
 * If the backend doesn't emit per-clause progress yet, the indicator
 * still shows a meaningful "Analyzing clause N of M…" text driven by
 * the deterministic fallback in the parent (see RiskTab).
 */
export function ClauseProgress({ clauseIndex, total }: Props) {
  const pct = total > 0 ? Math.min(100, Math.round((clauseIndex / total) * 100)) : 0;
  return (
    <div className="sign-card">
      <div className="sign-progress">
        Analyzing clause {Math.max(1, clauseIndex)} of {Math.max(1, total)}…
      </div>
      <div
        style={{
          height: 4,
          background: '#eef2ff',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: '#4f6ef7',
            transition: 'width 200ms ease',
          }}
        />
      </div>
    </div>
  );
}
