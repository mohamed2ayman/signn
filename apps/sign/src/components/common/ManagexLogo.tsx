/* ═══════════════════════════════════════════════════════════════════
   MANAGEX Mark — local copy for use in SIGN backlinks.
   Geometry extracted verbatim from managex_logo_final.svg.
   Source of truth: apps/managex/src/components/ManagexLogo.tsx
   ═══════════════════════════════════════════════════════════════════ */

interface MarkProps {
  size?: number;
  /** When true (light surface), uses dark pillars + dark cyan accent. */
  onLight?: boolean;
}

/**
 * The MANAGEX mark — abstract M+X glyph inside a rounded square.
 * Drawn in the canonical 88×88 viewBox so it scales cleanly to any size.
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
      style={{ display: 'block', flexShrink: 0 }}
    >
      <rect x="0" y="0" width="88" height="88" rx="20" fill={frameFill} stroke={frameStroke} strokeWidth="1" />
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
