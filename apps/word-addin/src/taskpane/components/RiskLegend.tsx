import * as React from 'react';
import type { RiskFinding, RiskLevel } from '../lib/types';

interface Props {
  findings: RiskFinding[];
  onPick?: (level: RiskLevel) => void;
}

export function RiskLegend({ findings, onPick }: Props) {
  const counts = React.useMemo(() => {
    const c = { LOW: 0, MEDIUM: 0, HIGH: 0 } as Record<RiskLevel, number>;
    for (const f of findings) c[f.risk_level] = (c[f.risk_level] ?? 0) + 1;
    return c;
  }, [findings]);

  const item = (level: RiskLevel, label: string, dot: string) => (
    <span
      onClick={() => onPick?.(level)}
      title={`Jump to first ${label.toLowerCase()}-risk clause`}
    >
      <span
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          borderRadius: 5,
          background: dot,
          marginRight: 4,
          verticalAlign: 'middle',
        }}
      />
      {label} <strong>{counts[level]}</strong>
    </span>
  );

  return (
    <div className="sign-card sign-legend">
      {item('LOW', 'Low', '#1d9d3b')}
      {item('MEDIUM', 'Medium', '#d2a300')}
      {item('HIGH', 'High', '#c0392b')}
    </div>
  );
}
