import { useEffect, useRef, useState } from 'react';
import { CenvoxLogo, CenvoxLogoMark, CenvoxWordmark } from './components/CenvoxLogo';
import StatsTicker from './components/StatsTicker';
import PhaseCard from './components/PhaseCard';
import ProductCard from './components/ProductCard';
import TestimonialCard from './components/TestimonialCard';
import OrbitalDiagram from './components/OrbitalDiagram';

/* ═══════════════════════════════════════════════════════════════════
   SIGN is a separate app running on a different port/domain.
   All CENVOX → SIGN links use this base URL (plain <a> tags, not
   router Link components). Swap to https://sign.ai in production.

   Wired navigation:
     - Nav "Sign in"              → SIGN_URL + /auth/login
     - Nav "Get started"          → SIGN_URL + /auth/register
     - SIGN product card          → SIGN_URL + /
     - Footer SIGN link           → SIGN_URL + /

   cursor: pointer is set on all interactive elements (see index.css)
   so hover states work alongside the custom cursor overlay.
   ═══════════════════════════════════════════════════════════════════ */
const SIGN_URL = 'http://localhost:5173';
const SIGN_LOGIN = SIGN_URL + '/auth/login';
const SIGN_SIGNUP = SIGN_URL + '/auth/register';
const SIGN_HOME = SIGN_URL + '/';

/* ── Nav links ─────────────────────────────────────────────────── */
const NAV_LINKS = [
  { label: 'Platform', href: '#platform' },
  { label: 'Products', href: '#products' },
  { label: 'Company', href: '#company' },
  { label: 'Research', href: '#research' },
];

/* ── Lifecycle phases ──────────────────────────────────────────── */
const PHASES = [
  {
    num: '01',
    name: 'Initiation',
    description:
      'Feasibility, scope definition, early risk identification, contract strategy, and vendor pre-qualification.',
    products: [
      { name: 'SIGN', color: 'var(--color-sign)' },
      { name: 'VENDRIX', color: 'var(--color-vendrix)' },
    ],
    accentColor: 'var(--cx-fire)',
  },
  {
    num: '02',
    name: 'Planning',
    description:
      'Programme development, resource allocation, scheduling, baseline setting, and contract terms governing EOT and delay provisions.',
    products: [
      { name: 'SPANTEC', color: 'var(--color-spantec)' },
      { name: 'SIGN', color: 'var(--color-sign)' },
    ],
    accentColor: 'var(--color-spantec)',
  },
  {
    num: '03',
    name: 'Procurement',
    description:
      'Tendering, bid evaluation, vendor qualification, subcontract and supplier agreement review, onerous clause flagging, and contract award.',
    products: [
      { name: 'VENDRIX', color: 'var(--color-vendrix)' },
      { name: 'SIGN', color: 'var(--color-sign)' },
    ],
    accentColor: 'var(--color-vendrix)',
  },
  {
    num: '04',
    name: 'Execution',
    description:
      'HSE compliance, document control, progress monitoring, live contract obligation tracking, variation management, notices, and instructions.',
    products: [
      { name: 'GUARDIA', color: 'var(--color-guardia)' },
      { name: 'DOXEN', color: 'var(--color-doxen)' },
      { name: 'SIGN', color: 'var(--color-sign)' },
    ],
    accentColor: 'var(--color-guardia)',
  },
  {
    num: '05',
    name: 'Closeout',
    description:
      'Forensic analysis, claims resolution, EOT substantiation, final account negotiation, and lessons learned.',
    products: [
      { name: 'CLAIMX', color: 'var(--color-claimx)' },
      { name: 'SIGN', color: 'var(--color-sign)' },
    ],
    accentColor: 'var(--color-claimx)',
  },
];

/* ── Products ──────────────────────────────────────────────────── */
const PRODUCTS = [
  {
    name: 'SIGN',
    domain: 'sign.ai',
    description:
      'The contract intelligence backbone of your entire project. SIGN is active from first agreement to final account \u2014 reviewing, monitoring, and protecting your contractual position at every phase.',
    tag: 'Contracts & Risk \u2192',
    color: 'var(--color-sign)',
    available: true,
    href: SIGN_HOME,
  },
  {
    name: 'VENDRIX',
    domain: 'vendrix.ai',
    description:
      'AI-driven procurement intelligence. Evaluate bids, qualify vendors, and manage supply chain risk with data-driven decisions across your entire portfolio.',
    tag: 'Procurement & Vendors \u2192',
    color: 'var(--color-vendrix)',
    available: false,
  },
  {
    name: 'SPANTEC',
    domain: 'spantec.ai',
    description:
      'Predictive planning and scheduling that sees delays before they happen. Baseline tracking, critical path analysis, and programme risk intelligence.',
    tag: 'Planning & Scheduling \u2192',
    color: 'var(--color-spantec)',
    available: false,
  },
  {
    name: 'CLAIMX',
    domain: 'claimx.ai',
    description:
      'Forensic claims analysis powered by AI. Build EOT narratives, substantiate delay events, and resolve disputes with evidence-backed intelligence.',
    tag: 'Forensic & Claims \u2192',
    color: 'var(--color-claimx)',
    available: false,
  },
  {
    name: 'GUARDIA',
    domain: 'guardia.ai',
    description:
      'HSE compliance monitoring and safety intelligence. Real-time risk tracking, incident prediction, and regulatory compliance across all project sites.',
    tag: 'HSE & Compliance \u2192',
    color: 'var(--color-guardia)',
    available: false,
  },
  {
    name: 'DOXEN',
    domain: 'doxen.ai',
    description:
      'Intelligent document control for construction. Automated classification, version tracking, transmittal management, and instant retrieval across projects.',
    tag: 'Document Control \u2192',
    color: 'var(--color-doxen)',
    available: false,
  },
];

/* ── Testimonials ──────────────────────────────────────────────── */
const TESTIMONIALS = [
  {
    quote:
      'SIGN identified three onerous clauses in a \u00A340M subcontract that our legal team missed. It paid for itself in the first week.',
    name: 'Ahmed Al-Rashid',
    title: 'Commercial Director',
    company: 'Tier-1 Contractor, UAE',
  },
  {
    quote:
      'SPANTEC gave us 6 weeks advance notice of a critical path delay. We had mitigation in place before the client even noticed the risk.',
    name: 'Sarah Okonkwo',
    title: 'Planning Manager',
    company: 'Infrastructure PMC, UK',
  },
  {
    quote:
      'CLAIMX built our extension of time narrative from programme data and correspondence in hours \u2014 not the six weeks our forensic consultant quoted.',
    name: 'Marco Fernandes',
    title: 'Head of Claims',
    company: 'EPC Contractor, KSA',
  },
];

/* ── Why CENVOX rows ───────────────────────────────────────────── */
const WHY_ROWS = [
  {
    heading: 'AI that speaks construction.',
    stat: 'FIDIC \u00B7 NEC \u00B7 JCT',
    body: 'CENVOX models are trained on construction contracts, schedules, claims, and project data \u2014 not generic text. It understands NEC, FIDIC, JCT. It reads a programme delay the way a scheduler does.',
  },
  {
    heading: 'Every product. One truth.',
    stat: '6 products / one brain',
    body: "Data doesn\u2019t live in silos. A contract clause in SIGN can automatically generate a compliance check in GUARDIA, a schedule risk alert in SPANTEC, and a claims marker in CLAIMX \u2014 simultaneously.",
  },
  {
    heading: 'See risk before it becomes loss.',
    stat: '40% fewer disputes',
    body: 'Traditional tools report what happened. CENVOX predicts what will happen \u2014 surfacing delay indicators, contract risks, safety signals, and cost anomalies before they compound into crises.',
  },
];

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════ */
export default function App() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const cursorDotRef = useRef<HTMLDivElement>(null);
  const cursorRingRef = useRef<HTMLDivElement>(null);
  /* ── Scroll handler ───────────────────────────────────── */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* ── Custom cursor ────────────────────────────────────── */
  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return;

    const dot = cursorDotRef.current;
    const ring = cursorRingRef.current;
    if (!dot || !ring) return;

    let mouseX = -100, mouseY = -100;
    let ringX = -100, ringY = -100;
    let hasMoved = false;

    const onMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;

      dot.style.left = mouseX + 'px';
      dot.style.top = mouseY + 'px';

      if (!hasMoved) {
        hasMoved = true;
        ringX = mouseX;
        ringY = mouseY;
        ring.style.left = ringX + 'px';
        ring.style.top = ringY + 'px';
        ring.classList.add('active');
      }
    };

    let rafId: number;
    const animate = () => {
      ringX += (mouseX - ringX) * 0.15;
      ringY += (mouseY - ringY) * 0.15;
      ring.style.left = ringX + 'px';
      ring.style.top = ringY + 'px';
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    const onEnter = () => ring.classList.add('hovered');
    const onLeave = () => ring.classList.remove('hovered');

    document.addEventListener('mousemove', onMouseMove);

    const selector = 'a, button, [role="button"], .product-card, [data-hoverable]';
    const bindHover = () => {
      document.querySelectorAll(selector).forEach((el) => {
        el.addEventListener('mouseenter', onEnter);
        el.addEventListener('mouseleave', onLeave);
      });
    };
    bindHover();

    const mo = new MutationObserver(bindHover);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      cancelAnimationFrame(rafId);
      mo.disconnect();
      document.querySelectorAll(selector).forEach((el) => {
        el.removeEventListener('mouseenter', onEnter);
        el.removeEventListener('mouseleave', onLeave);
      });
    };
  }, []);

  /* ── Scroll reveal (IntersectionObserver) ─────────────── */
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      document.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible'));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.05, rootMargin: '50px 0px 0px 0px' }
    );

    const revealIfPast = (el: Element) => {
      const rect = el.getBoundingClientRect();
      // If the element is already above or inside the viewport, reveal immediately
      if (rect.top < window.innerHeight) {
        el.classList.add('visible');
      } else {
        io.observe(el);
      }
    };

    const observeAll = () => {
      document.querySelectorAll('.reveal:not(.visible)').forEach(revealIfPast);
    };

    // Initial pass after a frame to let layout settle
    requestAnimationFrame(observeAll);

    // MutationObserver to catch dynamically rendered .reveal elements
    const mo = new MutationObserver(() => observeAll());
    mo.observe(document.body, { childList: true, subtree: true });

    // Also re-check on scroll for any missed elements
    const onScroll = () => observeAll();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      io.disconnect();
      mo.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  /* ── Rising lines data ────────────────────────────────── */
  const risingLines = Array.from({ length: 12 }, (_, i) => ({
    left: `${Math.random() * 100}%`,
    duration: `${5 + Math.random() * 4}s`,
    delay: `${Math.random() * 5}s`,
    height: `${80 + Math.random() * 80}px`,
  }));

  return (
    <>
      {/* Noise grain overlay */}
      <svg className="noise-overlay" xmlns="http://www.w3.org/2000/svg">
        <filter id="noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#noise)" />
      </svg>

      {/* Custom cursor — hidden on touch via CSS, starts off-screen */}
      <div ref={cursorDotRef} className="cx-cursor-dot" />
      <div ref={cursorRingRef} className="cx-cursor-ring" />

      {/* ═══════ 1. NAVIGATION ═══════ */}
      <nav
        className="fixed inset-x-0 top-0 z-50 transition-all duration-300"
        style={{
          background: scrolled ? 'rgba(6,6,10,0.85)' : 'transparent',
          backdropFilter: scrolled ? 'blur(20px)' : 'none',
          borderBottom: scrolled ? '1px solid var(--cx-border)' : '1px solid transparent',
        }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <CenvoxLogo size="sm" />

          {/* Center links (desktop) */}
          <div className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="font-body text-sm font-[400] transition-colors"
                style={{ color: 'var(--cx-muted)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--cx-white)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--cx-muted)')}
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Right buttons (desktop) */}
          <div className="hidden items-center gap-3 md:flex">
            <a
              href={SIGN_LOGIN}
              target="_self"
              className="rounded-lg border px-4 py-2 font-body text-sm font-[400] transition-colors"
              style={{ borderColor: 'var(--cx-border2)', color: 'var(--cx-mid)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--cx-white)';
                e.currentTarget.style.color = 'var(--cx-white)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--cx-border2)';
                e.currentTarget.style.color = 'var(--cx-mid)';
              }}
            >
              Sign in
            </a>
            <a
              href={SIGN_SIGNUP}
              target="_self"
              className="rounded-lg px-5 py-2 font-body text-sm font-[500] text-white transition-opacity hover:opacity-90"
              style={{ background: 'var(--cx-fire)' }}
            >
              Get started
            </a>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="md:hidden"
            style={{ color: 'var(--cx-white)' }}
            aria-label="Open menu"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
        </div>
      </nav>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileMenuOpen(false)} />
          <div
            className="absolute bottom-0 right-0 top-0 w-72 overflow-y-auto p-6"
            style={{ background: 'var(--cx-void)' }}
          >
            <div className="mb-8 flex items-center justify-between">
              <CenvoxLogo size="sm" />
              <button
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
                style={{ color: 'var(--cx-muted)' }}
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex flex-col gap-4">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="font-body text-base"
                  style={{ color: 'var(--cx-mid)' }}
                >
                  {link.label}
                </a>
              ))}
              <hr style={{ borderColor: 'var(--cx-border)' }} />
              <a href={SIGN_LOGIN} target="_self" className="font-body text-base" style={{ color: 'var(--cx-mid)' }}>
                Sign in
              </a>
              <a
                href={SIGN_SIGNUP}
                target="_self"
                className="inline-block rounded-lg px-5 py-2.5 text-center font-body text-sm font-[500] text-white"
                style={{ background: 'var(--cx-fire)' }}
              >
                Get started
              </a>
            </div>
          </div>
        </div>
      )}

      <main>
        {/* ═══════ 2. HERO SECTION ═══════ */}
        <section
          className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pt-20"
          style={{ background: 'var(--cx-void)' }}
        >
          {/* Dot grid background */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          />

          {/* Radial glow */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2"
            style={{
              width: '800px',
              height: '800px',
              background:
                'radial-gradient(circle, rgba(255,77,28,0.08) 0%, transparent 60%)',
            }}
          />

          {/* Rising vertical lines */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {risingLines.map((line, i) => (
              <div
                key={i}
                className="rising-line"
                style={{
                  left: line.left,
                  height: line.height,
                  ['--duration' as string]: line.duration,
                  ['--delay' as string]: line.delay,
                }}
              />
            ))}
          </div>

          {/* Hero content */}
          <div className="hero-stagger relative z-10 mx-auto flex max-w-4xl flex-col items-center text-center">
            {/* Eyebrow pill */}
            <div
              className="inline-flex items-center gap-2.5 rounded-full border px-4 py-1.5"
              style={{ borderColor: 'var(--cx-border2)' }}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  background: 'var(--cx-fire)',
                  boxShadow: '0 0 8px var(--cx-fire)',
                  animation: 'pulse 2s ease-in-out infinite',
                }}
              />
              <span className="font-mono text-[11px] tracking-[0.1em]" style={{ color: 'var(--cx-muted)' }}>
                Construction Intelligence Platform &middot; Idea to Delivery
              </span>
            </div>

            {/* H1 */}
            <h1 className="mt-8 font-display font-[800] leading-[1.05] tracking-tight">
              <span className="block text-5xl md:text-7xl lg:text-[96px]" style={{ color: 'var(--cx-white)' }}>
                Build Smarter.
              </span>
              <span
                className="block text-5xl md:text-7xl lg:text-[96px]"
                style={{
                  background: 'linear-gradient(135deg, var(--cx-fire), var(--cx-ember), #FFAA70)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Deliver Certain.
              </span>
            </h1>

            {/* Subtitle */}
            <p
              className="mt-6 max-w-2xl font-display text-lg font-[600] md:text-2xl lg:text-[28px]"
              style={{ color: 'var(--cx-muted)' }}
            >
              From first idea to final handover &mdash; AI that thinks like a project.
            </p>

            {/* Body */}
            <p
              className="mt-4 max-w-2xl font-body text-sm font-[300] leading-relaxed md:text-base"
              style={{ color: 'var(--cx-mid)' }}
            >
              CENVOX is the AI intelligence platform purpose-built for construction. Six products.
              One unified layer of intelligence that covers every discipline, every phase, every risk
              &mdash; across the entire project lifecycle.
            </p>

            {/* CTA buttons */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <a
                href="#products"
                className="rounded-lg px-6 py-3 font-body text-sm font-[500] text-white transition-opacity hover:opacity-90"
                style={{ background: 'var(--cx-fire)' }}
              >
                Explore the platform
              </a>
              <a
                href="#"
                className="rounded-lg border px-6 py-3 font-body text-sm font-[400] transition-colors"
                style={{ borderColor: 'var(--cx-border2)', color: 'var(--cx-mid)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--cx-white)';
                  e.currentTarget.style.color = 'var(--cx-white)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--cx-border2)';
                  e.currentTarget.style.color = 'var(--cx-mid)';
                }}
              >
                Watch demo &rarr;
              </a>
            </div>

          </div>

          {/* Scroll indicator */}
          <div className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2">
            <div className="relative h-10 w-px" style={{ background: 'var(--cx-border2)' }}>
              <div
                className="scroll-dot absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full"
                style={{ background: 'var(--cx-fire)' }}
              />
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.2em]" style={{ color: 'transparent' }}>
              Scroll
            </span>
          </div>
        </section>

        {/* ═══════ 3. STATS TICKER ═══════ */}
        <StatsTicker />

        {/* ═══════ 4. LIFECYCLE SECTION ═══════ */}
        <section id="platform" className="px-6 py-24 md:py-32" style={{ background: 'var(--cx-void)' }}>
          <div className="mx-auto max-w-7xl">
            <div className="reveal mb-16 max-w-2xl">
              <span className="font-mono text-xs uppercase tracking-[0.15em]" style={{ color: 'var(--cx-fire)' }}>
                Full Project Lifecycle
              </span>
              <h2 className="mt-3 font-display text-3xl font-[800] md:text-5xl" style={{ color: 'var(--cx-white)' }}>
                Intelligence from Idea to Delivery
              </h2>
              <p className="mt-4 font-body text-base font-[300] leading-relaxed" style={{ color: 'var(--cx-mid)' }}>
                SIGN is the contract intelligence backbone running across nearly every phase of the
                project lifecycle. From initiation to closeout, it reviews, monitors, and protects
                your contractual position &mdash; while specialist products handle planning,
                procurement, HSE, documents, and claims.
              </p>
            </div>

            {/* Phase cards */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
              {PHASES.map((phase, i) => (
                <PhaseCard key={phase.num} phase={phase} isLast={i === PHASES.length - 1} />
              ))}
            </div>
          </div>
        </section>

        {/* ═══════ 5. PRODUCTS SECTION ═══════ */}
        <section id="products" className="px-6 py-24 md:py-32" style={{ background: 'var(--cx-void2)' }}>
          <div className="mx-auto max-w-7xl">
            <div className="reveal mb-16 text-center">
              <h2 className="font-display text-3xl font-[800] md:text-5xl" style={{ color: 'var(--cx-white)' }}>
                Six products. One platform.
              </h2>
              <p
                className="mx-auto mt-4 max-w-2xl font-body text-base font-[300] leading-relaxed"
                style={{ color: 'var(--cx-mid)' }}
              >
                Each product is a specialist. Together, they form a unified intelligence layer
                &mdash; sharing data, context, and insights across every discipline on your project.
              </p>
            </div>

            {/* 3x2 grid */}
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {PRODUCTS.map((product) => (
                <ProductCard key={product.name} product={product} />
              ))}
            </div>
          </div>
        </section>

        {/* ═══════ 6. CONNECTED INTELLIGENCE / ORBITAL ═══════ */}
        <section className="px-6 py-24 md:py-32" style={{ background: 'var(--cx-void)' }}>
          <div className="mx-auto max-w-7xl">
            <div className="reveal mb-16 text-center">
              <h2 className="font-display text-3xl font-[800] md:text-5xl" style={{ color: 'var(--cx-white)' }}>
                Not tools. One brain.
              </h2>
              <p
                className="mx-auto mt-4 max-w-2xl font-body text-base font-[300] leading-relaxed"
                style={{ color: 'var(--cx-mid)' }}
              >
                Every CENVOX product shares context. A risk flagged in SIGN flows to CLAIMX. A
                schedule slippage in SPANTEC alerts VENDRIX. Intelligence compounds across the
                platform.
              </p>
            </div>

            <div className="reveal flex justify-center">
              <div className="scale-[0.65] sm:scale-75 md:scale-90 lg:scale-100">
                <OrbitalDiagram />
              </div>
            </div>

            <div className="mt-12 text-center">
              <a
                href="#products"
                className="font-body text-sm font-[400] transition-opacity hover:opacity-80"
                style={{ color: 'var(--cx-fire)' }}
              >
                See how it connects &rarr;
              </a>
            </div>
          </div>
        </section>

        {/* ═══════ 7. MISSION SECTION ═══════ */}
        <section id="company" className="px-6 py-24 md:py-32" style={{ background: 'var(--cx-void)' }}>
          <div className="reveal mx-auto max-w-3xl text-center">
            <span className="font-mono text-xs uppercase tracking-[0.15em]" style={{ color: 'var(--cx-fire)' }}>
              Our Mission
            </span>

            <p
              className="mt-8 font-display text-xl font-[700] leading-snug md:text-3xl"
              style={{ color: 'var(--cx-white)' }}
            >
              At CENVOX, we exist to transform how the world builds&mdash;unifying fragmented
              construction disciplines into one intelligent ecosystem.
            </p>

            <p
              className="mt-6 font-body text-base font-[300] leading-relaxed md:text-lg"
              style={{ color: 'var(--cx-mid)' }}
            >
              Through AI-powered platforms, we replace reactive workflows with predictive clarity,
              enabling organizations to design, plan, execute, and deliver with precision,
              confidence, and foresight.
            </p>

            <a
              href="#"
              className="mt-8 inline-block rounded-lg border px-6 py-3 font-body text-sm font-[400] transition-colors"
              style={{ borderColor: 'var(--cx-border2)', color: 'var(--cx-mid)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--cx-white)';
                e.currentTarget.style.color = 'var(--cx-white)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--cx-border2)';
                e.currentTarget.style.color = 'var(--cx-mid)';
              }}
            >
              Our mission &rarr;
            </a>
          </div>
        </section>

        {/* ═══════ 8. WHY CENVOX SECTION ═══════ */}
        <section className="px-6 py-24 md:py-32" style={{ background: 'var(--cx-void2)' }}>
          <div className="mx-auto max-w-7xl">
            {WHY_ROWS.map((row, i) => (
              <div
                key={i}
                className={`reveal flex flex-col gap-8 border-b py-16 first:pt-0 last:border-b-0 last:pb-0 md:flex-row md:items-center md:gap-16 ${
                  i % 2 === 1 ? 'md:flex-row-reverse' : ''
                }`}
                style={{ borderColor: 'var(--cx-border)' }}
              >
                {/* Text */}
                <div className="flex-1">
                  <h3
                    className="font-display text-2xl font-[800] md:text-4xl"
                    style={{ color: 'var(--cx-white)' }}
                  >
                    {row.heading}
                  </h3>
                  <p
                    className="mt-4 font-body text-base font-[300] leading-relaxed"
                    style={{ color: 'var(--cx-mid)' }}
                  >
                    {row.body}
                  </p>
                </div>

                {/* Visual stat */}
                <div
                  className="flex flex-1 items-center justify-center rounded-xl border p-10 md:p-16"
                  style={{
                    background: 'var(--cx-surface)',
                    borderColor: 'var(--cx-border)',
                  }}
                >
                  <span
                    className="text-center font-display text-3xl font-[800] md:text-5xl"
                    style={{ color: 'var(--cx-white)' }}
                  >
                    {row.stat}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ═══════ 9. TESTIMONIALS ═══════ */}
        <section className="px-6 py-24 md:py-32" style={{ background: 'var(--cx-void)' }}>
          <div className="mx-auto max-w-7xl">
            <div className="reveal mb-16 text-center">
              <h2 className="font-display text-3xl font-[800] md:text-5xl" style={{ color: 'var(--cx-white)' }}>
                Trusted by industry leaders
              </h2>
            </div>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {TESTIMONIALS.map((t, i) => (
                <TestimonialCard key={i} testimonial={t} />
              ))}
            </div>
          </div>
        </section>

        {/* ═══════ 10. CTA SECTION ═══════ */}
        <section className="relative overflow-hidden px-6 py-24 md:py-32" style={{ background: 'var(--cx-void2)' }}>
          {/* Radial glow */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{
              width: '600px',
              height: '600px',
              background: 'radial-gradient(circle, rgba(255,77,28,0.12) 0%, transparent 60%)',
            }}
          />

          <div className="reveal relative z-10 mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-[800] md:text-5xl">
              <span style={{ color: 'var(--cx-white)' }}>Ready to build </span>
              <span
                style={{
                  background: 'linear-gradient(135deg, var(--cx-fire), var(--cx-ember))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                smarter?
              </span>
            </h2>
            <p className="mt-4 font-body text-base font-[300] leading-relaxed" style={{ color: 'var(--cx-mid)' }}>
              Join the construction teams already running on CENVOX intelligence. Start with one
              product. Expand across the lifecycle.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <a
                href="mailto:demo@cenvox.ai"
                className="rounded-lg px-6 py-3 font-body text-sm font-[500] text-white transition-opacity hover:opacity-90"
                style={{ background: 'var(--cx-fire)' }}
              >
                Request a demo
              </a>
              <a
                href="#products"
                className="rounded-lg border px-6 py-3 font-body text-sm font-[400] transition-colors"
                style={{ borderColor: 'var(--cx-border2)', color: 'var(--cx-mid)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--cx-white)';
                  e.currentTarget.style.color = 'var(--cx-white)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--cx-border2)';
                  e.currentTarget.style.color = 'var(--cx-mid)';
                }}
              >
                Explore products &rarr;
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ═══════ 11. FOOTER ═══════ */}
      <footer className="border-t px-6 py-16" style={{ background: 'var(--cx-void)', borderColor: 'var(--cx-border)' }}>
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
            {/* Brand column */}
            <div className="lg:col-span-1">
              <CenvoxLogo size="sm" />
              <p className="mt-3 font-body text-xs font-[300] leading-relaxed" style={{ color: 'var(--cx-muted)' }}>
                AI intelligence platform for construction. From idea to delivery.
              </p>
              <div className="mt-4 flex gap-3">
                <a
                  href="#"
                  className="rounded-lg border p-2 transition-colors"
                  style={{ borderColor: 'var(--cx-border)', color: 'var(--cx-muted)' }}
                  aria-label="LinkedIn"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--cx-white)';
                    e.currentTarget.style.color = 'var(--cx-white)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--cx-border)';
                    e.currentTarget.style.color = 'var(--cx-muted)';
                  }}
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                  </svg>
                </a>
                <a
                  href="#"
                  className="rounded-lg border p-2 transition-colors"
                  style={{ borderColor: 'var(--cx-border)', color: 'var(--cx-muted)' }}
                  aria-label="X (Twitter)"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--cx-white)';
                    e.currentTarget.style.color = 'var(--cx-white)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--cx-border)';
                    e.currentTarget.style.color = 'var(--cx-muted)';
                  }}
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </a>
              </div>
            </div>

            {/* Products column */}
            <div>
              <h4 className="font-display text-sm font-[700]" style={{ color: 'var(--cx-white)' }}>
                Products
              </h4>
              <ul className="mt-4 flex flex-col gap-2.5">
                {PRODUCTS.map((p) => (
                  <li key={p.name}>
                    <a
                      href={p.available ? p.href : '#'}
                      className="font-body text-sm font-[300] transition-colors"
                      style={{ color: 'var(--cx-muted)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--cx-white)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--cx-muted)')}
                    >
                      {p.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Platform column */}
            <div>
              <h4 className="font-display text-sm font-[700]" style={{ color: 'var(--cx-white)' }}>
                Platform
              </h4>
              <ul className="mt-4 flex flex-col gap-2.5">
                {['Overview', 'Lifecycle Coverage', 'Connected Intelligence', 'Security'].map((item) => (
                  <li key={item}>
                    <a
                      href="#platform"
                      className="font-body text-sm font-[300] transition-colors"
                      style={{ color: 'var(--cx-muted)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--cx-white)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--cx-muted)')}
                    >
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company column */}
            <div>
              <h4 className="font-display text-sm font-[700]" style={{ color: 'var(--cx-white)' }}>
                Company
              </h4>
              <ul className="mt-4 flex flex-col gap-2.5">
                {['About', 'Mission', 'Careers', 'Contact'].map((item) => (
                  <li key={item}>
                    <a
                      href="#company"
                      className="font-body text-sm font-[300] transition-colors"
                      style={{ color: 'var(--cx-muted)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--cx-white)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--cx-muted)')}
                    >
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Resources column */}
            <div>
              <h4 className="font-display text-sm font-[700]" style={{ color: 'var(--cx-white)' }}>
                Resources
              </h4>
              <ul className="mt-4 flex flex-col gap-2.5">
                {['Documentation', 'Blog', 'Research', 'Support'].map((item) => (
                  <li key={item}>
                    <a
                      href="#"
                      className="font-body text-sm font-[300] transition-colors"
                      style={{ color: 'var(--cx-muted)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--cx-white)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--cx-muted)')}
                    >
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div
            className="mt-12 flex flex-col items-center justify-between gap-4 border-t pt-6 md:flex-row"
            style={{ borderColor: 'var(--cx-border)' }}
          >
            <p className="font-body text-xs font-[300]" style={{ color: 'var(--cx-muted)' }}>
              &copy; 2025 CENVOX Technologies. All rights reserved.
            </p>
            <div className="flex gap-6">
              {['Privacy Policy', 'Terms of Service', 'Cookie Policy'].map((item) => (
                <a
                  key={item}
                  href="#"
                  className="font-body text-xs font-[300] transition-colors"
                  style={{ color: 'var(--cx-muted)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--cx-white)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--cx-muted)')}
                >
                  {item}
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>

      {/* Pulse keyframe for eyebrow dot */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px var(--cx-fire); }
          50% { opacity: 0.5; box-shadow: 0 0 16px var(--cx-fire); }
        }
      `}</style>
    </>
  );
}
