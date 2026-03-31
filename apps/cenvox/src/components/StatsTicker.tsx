const STATS = [
  { value: '6+', label: 'AI Products' },
  { value: '100%', label: 'Project Lifecycle' },
  { value: '40%', label: 'Risk Reduction' },
  { value: '10\u00D7', label: 'Faster Decisions' },
  { value: '\u221E', label: 'Real-time Intelligence' },
  { value: '0', label: 'Blind Spots' },
];

export default function StatsTicker() {
  const items = [...STATS, ...STATS];

  return (
    <section
      className="relative overflow-hidden border-y"
      style={{
        background: 'var(--cx-void2)',
        borderColor: 'var(--cx-border)',
      }}
    >
      <div className="ticker-track flex whitespace-nowrap py-5">
        {items.map((stat, i) => (
          <div key={i} className="flex shrink-0 items-center gap-3 px-10">
            <span
              className="font-display text-2xl font-[800] md:text-3xl"
              style={{ color: 'var(--cx-white)' }}
            >
              {stat.value}
            </span>
            <span
              className="font-mono text-[10px] uppercase tracking-[0.15em] md:text-xs"
              style={{ color: 'var(--cx-muted)' }}
            >
              {stat.label}
            </span>
            <span
              className="mx-6 inline-block h-1 w-1 rounded-full"
              style={{ background: 'var(--cx-fire)' }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
