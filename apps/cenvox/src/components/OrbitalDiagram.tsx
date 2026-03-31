import { CenvoxWordmark } from './CenvoxLogo';

const PRODUCTS = [
  { name: 'SIGN', color: 'var(--color-sign)', angle: 0 },
  { name: 'VENDRIX', color: 'var(--color-vendrix)', angle: 60 },
  { name: 'SPANTEC', color: 'var(--color-spantec)', angle: 120 },
  { name: 'CLAIMX', color: 'var(--color-claimx)', angle: 180 },
  { name: 'GUARDIA', color: 'var(--color-guardia)', angle: 240 },
  { name: 'DOXEN', color: 'var(--color-doxen)', angle: 300 },
];

export default function OrbitalDiagram() {
  const outerRadius = 160;
  const innerRadius = 110;
  const center = 200;

  return (
    <div className="relative mx-auto flex items-center justify-center" style={{ width: 400, height: 400 }}>
      {/* Connecting lines (static) */}
      <svg
        className="absolute inset-0"
        width="400"
        height="400"
        viewBox="0 0 400 400"
        fill="none"
      >
        {PRODUCTS.map((p) => {
          const rad = (p.angle * Math.PI) / 180;
          const x = center + outerRadius * Math.cos(rad);
          const y = center + outerRadius * Math.sin(rad);
          return (
            <line
              key={p.name}
              x1={center}
              y1={center}
              x2={x}
              y2={y}
              stroke={p.color}
              strokeWidth="1"
              opacity="0.2"
            />
          );
        })}
      </svg>

      {/* Outer ring */}
      <div
        className="orbit-outer absolute rounded-full border"
        style={{
          width: outerRadius * 2,
          height: outerRadius * 2,
          borderColor: 'var(--cx-border2)',
        }}
      >
        {/* Outer product nodes (SIGN, SPANTEC, GUARDIA) */}
        {PRODUCTS.filter((_, i) => i % 2 === 0).map((p) => {
          const rad = (p.angle * Math.PI) / 180;
          const x = outerRadius + outerRadius * Math.cos(rad);
          const y = outerRadius + outerRadius * Math.sin(rad);
          return (
            <div
              key={p.name}
              className="orbit-node absolute flex items-center justify-center"
              style={{
                left: x - 24,
                top: y - 24,
                width: 48,
                height: 48,
              }}
            >
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full border font-mono text-[9px] font-[400]"
                style={{
                  background: `${p.color}15`,
                  borderColor: `${p.color}40`,
                  color: p.color,
                  boxShadow: `0 0 20px ${p.color}20`,
                }}
              >
                {p.name}
              </div>
            </div>
          );
        })}
      </div>

      {/* Inner ring */}
      <div
        className="orbit-inner absolute rounded-full border"
        style={{
          width: innerRadius * 2,
          height: innerRadius * 2,
          borderColor: 'var(--cx-border)',
        }}
      >
        {/* Inner product nodes (VENDRIX, CLAIMX, DOXEN) */}
        {PRODUCTS.filter((_, i) => i % 2 === 1).map((p) => {
          const rad = (p.angle * Math.PI) / 180;
          const x = innerRadius + innerRadius * Math.cos(rad);
          const y = innerRadius + innerRadius * Math.sin(rad);
          return (
            <div
              key={p.name}
              className="orbit-node-inner absolute flex items-center justify-center"
              style={{
                left: x - 24,
                top: y - 24,
                width: 48,
                height: 48,
              }}
            >
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full border font-mono text-[9px] font-[400]"
                style={{
                  background: `${p.color}15`,
                  borderColor: `${p.color}40`,
                  color: p.color,
                  boxShadow: `0 0 20px ${p.color}20`,
                }}
              >
                {p.name}
              </div>
            </div>
          );
        })}
      </div>

      {/* Center core */}
      <div
        className="absolute z-10 flex h-20 w-20 items-center justify-center rounded-full"
        style={{
          background: 'var(--cx-fire)',
          boxShadow: '0 0 60px var(--cx-fire), 0 0 120px rgba(255,77,28,0.3)',
        }}
      >
        <CenvoxWordmark className="text-[10px] text-white" />
      </div>
    </div>
  );
}
