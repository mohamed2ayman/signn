/* ═══════════════════════════════════════════════════════════════
   SIGN Brand Logo — "The Bloom"
   ═══════════════════════════════════════════════════════════════
   Icon:  6 overlapping ellipses (rx=16, ry=27, opacity=0.80)
          rotated 60° apart, with a white 4-point star center.
   Color: #4F6EF7 (indigo blue) — same in light & dark modes.
   ═══════════════════════════════════════════════════════════════ */

const ICON_COLOR = '#4F6EF7';
const WORDMARK_LIGHT = '#0F1729';
const WORDMARK_DARK = '#F8FAFF';

const PETAL_ANGLES = [0, 60, 120, 180, 240, 300];

/* ── Size presets ─────────────────────────────────────────────── */
const sizeConfig = {
  sm: { icon: 26, font: 20, gap: 7, tracking: -1 },
  md: { icon: 32, font: 24, gap: 9, tracking: -1.25 },
  lg: { icon: 56, font: 48, gap: 14, tracking: -2.5 },
};

/* ── Bloom Icon (standalone) ──────────────────────────────────── */
export function BloomIcon({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-28 -28 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* 6 petals */}
      {PETAL_ANGLES.map((angle) => (
        <ellipse
          key={angle}
          rx="16"
          ry="27"
          fill={ICON_COLOR}
          opacity="0.80"
          transform={`rotate(${angle})`}
        />
      ))}
      {/* 4-point star — two overlapping diamonds */}
      <path d="M0,-9 L2.5,0 L0,9 L-2.5,0Z" fill="white" />
      <path d="M-9,0 L0,-2.5 L9,0 L0,2.5Z" fill="white" />
      {/* Solid center circle */}
      <circle cx="0" cy="0" r="4.5" fill="white" />
    </svg>
  );
}

/* ── White-on-color Bloom (for use over brand-color surfaces) ──
   Mirrors BloomIcon but renders the petals in white at 0.9 opacity
   with a transparent center, so it reads cleanly on a brand-color
   bubble (chat widget bubble, etc.). Star center is solid white. */
export function WhiteBloomIcon({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-28 -28 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {PETAL_ANGLES.map((angle) => (
        <ellipse
          key={angle}
          rx="16"
          ry="27"
          fill="white"
          opacity="0.9"
          transform={`rotate(${angle})`}
        />
      ))}
      {/* solid white center for crispness on brand-color backgrounds */}
      <circle cx="0" cy="0" r="5" fill="white" />
    </svg>
  );
}

/* ── App Icon variant (white bloom on blue background) ────────── */
export function BloomAppIcon({
  size = 64,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const pad = 10;
  const full = 56 + pad * 2;
  const r = full * 0.22; // corner radius

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${full} ${full}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Rounded blue background */}
      <rect width={full} height={full} rx={r} fill={ICON_COLOR} />
      {/* Bloom in white */}
      <g transform={`translate(${full / 2}, ${full / 2})`}>
        {PETAL_ANGLES.map((angle) => (
          <ellipse
            key={angle}
            rx="14"
            ry="23"
            fill="white"
            opacity="0.85"
            transform={`rotate(${angle})`}
          />
        ))}
        {/* Blue center circle (shows through white petals) */}
        <circle cx="0" cy="0" r="4" fill={ICON_COLOR} />
      </g>
    </svg>
  );
}

/* ── Main Logo Component ──────────────────────────────────────── */
interface SignLogoProps {
  /** sm = sidebar/nav, md = general, lg = auth pages */
  size?: 'sm' | 'md' | 'lg';
  /** light = dark text, dark = white text, auto = inherits */
  variant?: 'light' | 'dark' | 'auto';
  /** Show icon only (no wordmark) */
  iconOnly?: boolean;
  className?: string;
}

export default function SignLogo({
  size = 'md',
  variant = 'light',
  iconOnly = false,
  className = '',
}: SignLogoProps) {
  const config = sizeConfig[size];

  const wordmarkColor =
    variant === 'dark'
      ? WORDMARK_DARK
      : variant === 'light'
        ? WORDMARK_LIGHT
        : 'currentColor';

  if (iconOnly) {
    return <BloomIcon size={config.icon} className={className} />;
  }

  return (
    <div
      className={`inline-flex items-center ${className}`}
      style={{ gap: config.gap }}
    >
      <BloomIcon size={config.icon} />
      <span
        style={{
          fontSize: config.font,
          fontWeight: 700,
          letterSpacing: config.tracking,
          color: wordmarkColor,
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
          lineHeight: 1,
        }}
      >
        Sign
      </span>
    </div>
  );
}
