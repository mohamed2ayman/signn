/**
 * CENVOX logo mark: stylised C-shape path interlocked with a V-chevron
 * inside a hexagonal frame, rendered in --cx-fire.
 * Plus the "CENVOX" wordmark in Syne 800 with the V in fire color.
 */
export function CenvoxLogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="CENVOX logo"
    >
      {/* Hexagonal frame */}
      <path
        d="M24 2L43.6 13v22L24 46 4.4 35V13L24 2z"
        stroke="var(--cx-fire)"
        strokeWidth="1.5"
        fill="none"
      />
      {/* C-shape path */}
      <path
        d="M30 14c-1.5-1-3.5-1.5-6-1.5-6.5 0-10.5 4.5-10.5 11.5S17.5 35.5 24 35.5c2.5 0 4.5-.5 6-1.5"
        stroke="var(--cx-fire)"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* V-chevron interlocked */}
      <path
        d="M22 18l5 12 5-12"
        stroke="var(--cx-fire)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function CenvoxLogoMarkMini({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="CENVOX"
    >
      <path d="M24 2L43.6 13v22L24 46 4.4 35V13L24 2z" stroke="var(--cx-fire)" strokeWidth="2" fill="none" />
      <path d="M30 14c-1.5-1-3.5-1.5-6-1.5-6.5 0-10.5 4.5-10.5 11.5S17.5 35.5 24 35.5c2.5 0 4.5-.5 6-1.5" stroke="var(--cx-fire)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M22 18l5 12 5-12" stroke="var(--cx-fire)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function CenvoxWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display font-[800] tracking-tight ${className}`}>
      CEN<span style={{ color: 'var(--cx-fire)' }}>V</span>OX
    </span>
  );
}

export function CenvoxLogo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const iconSize = size === 'sm' ? 24 : size === 'lg' ? 40 : 32;
  const textSize = size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-3xl' : 'text-2xl';

  return (
    <div className="flex items-center gap-2.5">
      <CenvoxLogoMark size={iconSize} />
      <CenvoxWordmark className={textSize} />
    </div>
  );
}
