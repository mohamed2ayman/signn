/* ═══════════════════════════════════════════════════════════════════
   MANAGEX Logo System
   Geometry extracted verbatim from managex_logo_final.svg.
   Mark: rounded square + 3 vertical pillars (M silhouette)
         + 2 diagonal lines converging to a luminous cyan dot (X).
   Wordmark: split sizes — "MANAGE" + dominant "X" in cyan.
   ═══════════════════════════════════════════════════════════════════ */

interface MarkProps {
  size?: number;
  /** When true (light surface), uses dark pillars + dark cyan accent. */
  onLight?: boolean;
}

/**
 * The MANAGEX mark — abstract M+X glyph inside a rounded square.
 * Drawn in the canonical 88×88 viewBox so it scales cleanly to any size.
 * Geometry copied directly from managex_logo_final.svg (88px container).
 */
export function ManagexMark({ size = 30, onLight = false }: MarkProps) {
  const pillarFill = onLight ? '#0A0F1E' : '#FFFFFF';
  const accent = onLight ? '#0099CC' : '#00D4FF';
  const frameFill = onLight ? '#E8F4FF' : '#0D1829';
  const frameStroke = onLight ? '#B8D4F0' : '#1E3A5F';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 88 88"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <rect
        x="0"
        y="0"
        width="88"
        height="88"
        rx="20"
        fill={frameFill}
        stroke={frameStroke}
        strokeWidth="1"
      />
      {/* Three vertical pillars forming the M silhouette */}
      <rect x="17" y="18" width="12" height="52" rx="3.5" fill={pillarFill} />
      <rect x="40" y="18" width="12" height="52" rx="3.5" fill={pillarFill} />
      <rect x="63" y="18" width="12" height="52" rx="3.5" fill={pillarFill} />
      {/* Diagonals converging at the X */}
      <path d="M17 18 L46 39" stroke={accent} strokeWidth="3" strokeLinecap="round" />
      <path d="M75 18 L46 39" stroke={accent} strokeWidth="3" strokeLinecap="round" />
      {/* Luminous accent dot at the X convergence */}
      <circle cx="46" cy="39" r="5" fill={accent} />
    </svg>
  );
}

interface LogoProps {
  /** Variant determines wordmark sizing. */
  variant?: 'nav' | 'footer' | 'sidebar';
  onLight?: boolean;
}

/**
 * Full MANAGEX lockup — mark + split-size wordmark.
 * Wordmark uses split font sizes: "MANAGE" small, dominant "X" in cyan.
 */
export default function ManagexLogo({ variant = 'nav', onLight = false }: LogoProps) {
  const cfg = (() => {
    switch (variant) {
      case 'footer':
        return { mark: 24, manage: 16, x: 24 };
      case 'sidebar':
        return { mark: 20, manage: 13, x: 20 };
      case 'nav':
      default:
        return { mark: 30, manage: 17, x: 28 };
    }
  })();

  const manageColor = onLight ? '#0A0F1E' : '#F4F6FF';
  const xColor = onLight ? '#0099CC' : 'var(--mx-cyan)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: '8px',
        lineHeight: 1,
      }}
    >
      <ManagexMark size={cfg.mark} onLight={onLight} />
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '1px',
          lineHeight: 1,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 800,
            fontSize: `${cfg.manage}px`,
            letterSpacing: '-0.02em',
            color: manageColor,
            lineHeight: 1,
          }}
        >
          MANAGE
        </span>
        <span
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 800,
            fontSize: `${cfg.x}px`,
            letterSpacing: '-0.04em',
            color: xColor,
            lineHeight: 0.82,
            position: 'relative',
            top: '2px',
          }}
        >
          X
        </span>
      </div>
    </div>
  );
}
