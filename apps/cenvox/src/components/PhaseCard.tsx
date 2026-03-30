interface Phase {
  num: string;
  name: string;
  description: string;
  products: { name: string; color: string }[];
  accentColor: string;
}

export default function PhaseCard({ phase, isLast }: { phase: Phase; isLast: boolean }) {
  return (
    <div className="flex items-stretch">
      <div
        className="reveal group relative flex w-full flex-col rounded-xl border p-5 md:p-6"
        style={{
          background: 'var(--cx-surface)',
          borderColor: 'var(--cx-border)',
        }}
      >
        {/* Phase number */}
        <span
          className="font-mono text-xs font-[400] tracking-[0.15em]"
          style={{ color: phase.accentColor }}
        >
          {phase.num}
        </span>

        {/* Phase name */}
        <h4 className="mt-2 font-display text-lg font-[700]" style={{ color: 'var(--cx-white)' }}>
          {phase.name}
        </h4>

        {/* Description */}
        <p className="mt-2 flex-1 font-body text-sm font-[300] leading-relaxed" style={{ color: 'var(--cx-mid)' }}>
          {phase.description}
        </p>

        {/* Product badges */}
        <div className="mt-4 flex flex-wrap gap-2">
          {phase.products.map((p) => (
            <span
              key={p.name}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-[400] tracking-wider"
              style={{
                background: `${p.color}15`,
                border: `1px solid ${p.color}30`,
                color: p.color,
              }}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: p.color }}
              />
              {p.name}
            </span>
          ))}
        </div>
      </div>

      {/* Arrow connector (hidden on mobile & last item) */}
      {!isLast && (
        <div className="hidden items-center px-2 lg:flex" style={{ color: 'var(--cx-muted)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M5 12h14m-4-4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </div>
  );
}
