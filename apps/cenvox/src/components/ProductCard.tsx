import { CenvoxLogoMarkMini } from './CenvoxLogo';

interface Product {
  name: string;
  domain: string;
  description: string;
  tag: string;
  color: string;
  available: boolean;
  href?: string;
}

export default function ProductCard({ product }: { product: Product }) {
  const isActive = product.available;

  return (
    <div
      className={`product-card reveal group relative flex flex-col rounded-xl border p-6 transition-all duration-300 ${
        isActive ? 'cursor-pointer' : 'cursor-default'
      }`}
      style={{
        background: 'var(--cx-surface)',
        borderColor: 'var(--cx-border)',
        opacity: isActive ? 1 : 0.55,
      }}
      onMouseEnter={(e) => {
        if (!isActive) return;
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.borderColor = `${product.color}30`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.borderColor = 'var(--cx-border)';
      }}
      onClick={() => {
        if (isActive && product.href) window.location.href = product.href;
      }}
      role={isActive ? 'link' : undefined}
      tabIndex={isActive ? 0 : undefined}
    >
      {/* Colored top border (animates on hover) */}
      <div
        className="product-border absolute left-0 right-0 top-0 h-0.5 rounded-t-xl"
        style={{ background: product.color }}
      />

      {/* Radial glow on hover (active cards only) */}
      {isActive && (
        <div
          className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: `radial-gradient(ellipse at 50% 0%, ${product.color}08 0%, transparent 70%)`,
          }}
        />
      )}

      {/* Dot + Name */}
      <div className="flex items-center gap-2.5">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: product.color }}
        />
        <h3 className="font-display text-xl font-[800]" style={{ color: product.color }}>
          {product.name}
        </h3>
      </div>

      {/* Domain */}
      <span className="mt-1 font-mono text-xs font-[300]" style={{ color: 'var(--cx-muted)' }}>
        {product.domain}
      </span>

      {/* Description */}
      <p
        className="mt-4 flex-1 font-body text-sm font-[300] leading-relaxed"
        style={{ color: 'var(--cx-mid)' }}
      >
        {product.description}
      </p>

      {/* Tag + badge */}
      <div className="mt-5 flex items-center justify-between">
        <span className="font-mono text-xs font-[400]" style={{ color: product.color }}>
          {product.tag}
        </span>

        {isActive ? (
          <span
            className="rounded-full px-2.5 py-0.5 font-mono text-[10px] font-[400]"
            style={{
              background: `${product.color}15`,
              border: `1px solid ${product.color}30`,
              color: product.color,
            }}
          >
            Available now
          </span>
        ) : (
          <span className="font-mono text-[10px]" style={{ color: 'var(--cx-muted)' }}>
            Coming soon
          </span>
        )}
      </div>

      {/* Powered by CENVOX (active cards only) */}
      {isActive && (
        <div
          className="mt-4 flex items-center gap-1.5 border-t pt-3"
          style={{ borderColor: 'var(--cx-border)' }}
        >
          <CenvoxLogoMarkMini size={12} />
          <span className="font-mono text-[9px]" style={{ color: 'var(--cx-muted)' }}>
            Powered by CENVOX
          </span>
        </div>
      )}
    </div>
  );
}
