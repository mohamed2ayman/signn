interface Testimonial {
  quote: string;
  name: string;
  title: string;
  company: string;
}

export default function TestimonialCard({ testimonial }: { testimonial: Testimonial }) {
  return (
    <div
      className="reveal flex flex-col rounded-xl border p-6 md:p-8"
      style={{
        background: 'var(--cx-surface)',
        borderColor: 'var(--cx-border)',
      }}
    >
      {/* Decorative quote mark */}
      <span
        className="font-display text-5xl font-[800] leading-none"
        style={{ color: 'var(--cx-fire)' }}
      >
        &ldquo;
      </span>

      {/* Quote */}
      <p
        className="mt-2 flex-1 font-body text-sm font-[300] leading-relaxed md:text-base"
        style={{ color: 'var(--cx-mid)' }}
      >
        {testimonial.quote}
      </p>

      {/* Attribution */}
      <div className="mt-6 border-t pt-4" style={{ borderColor: 'var(--cx-border)' }}>
        <p className="font-display text-sm font-[700]" style={{ color: 'var(--cx-white)' }}>
          {testimonial.name}
        </p>
        <p className="mt-0.5 font-body text-xs font-[300]" style={{ color: 'var(--cx-muted)' }}>
          {testimonial.title}
        </p>
        <p className="font-body text-xs font-[300]" style={{ color: 'var(--cx-muted)' }}>
          {testimonial.company}
        </p>
      </div>
    </div>
  );
}
