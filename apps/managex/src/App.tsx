import { useEffect, useState } from 'react';
import ManagexLogo from './components/ManagexLogo';
import HeroDashboard from './components/HeroDashboard';

/* ═══════════════════════════════════════════════════════════════════
   MANAGEX is the parent brand. SIGN is the first product, running on
   its own port. All MANAGEX → SIGN links use this base URL.
   Swap VITE_SIGN_APP_URL in production.

   Wired navigation:
     - Nav "Sign in"              → SIGN_URL + /auth/login
     - Nav "Get started"          → SIGN_URL + /auth/register
     - Hero text link             → SIGN_URL + /
     - SIGN product card          → SIGN_URL + /
     - Footer SIGN link           → SIGN_URL + /
   ═══════════════════════════════════════════════════════════════════ */
const SIGN_URL = import.meta.env.VITE_SIGN_APP_URL || 'http://localhost:5173';
const SIGN_LOGIN = SIGN_URL + '/auth/login';
const SIGN_SIGNUP = SIGN_URL + '/auth/register';
const SIGN_HOME = SIGN_URL + '/';

const NAV_LINKS = [
  { label: 'Platform', href: '#platform' },
  { label: 'Products', href: '#products' },
  { label: 'Company', href: '#mission' },
  { label: 'Research', href: '#research' },
];

const PHASES = [
  {
    num: '01',
    name: 'Initiation',
    desc: 'Feasibility, scope definition, early risk identification and contract strategy.',
    products: [
      { name: 'SIGN', color: 'var(--color-sign)' },
      { name: 'VENDRIX', color: 'var(--color-vendrix)' },
    ],
  },
  {
    num: '02',
    name: 'Planning',
    desc: 'Programme development, scheduling, baseline setting and EOT contract terms.',
    products: [
      { name: 'SPANTEC', color: 'var(--color-spantec)' },
      { name: 'SIGN', color: 'var(--color-sign)' },
    ],
  },
  {
    num: '03',
    name: 'Procurement',
    desc: 'Tendering, bid evaluation, subcontract review, onerous clause flagging and award.',
    products: [
      { name: 'VENDRIX', color: 'var(--color-vendrix)' },
      { name: 'SIGN', color: 'var(--color-sign)' },
    ],
  },
  {
    num: '04',
    name: 'Execution',
    desc: 'HSE compliance, document control, obligation tracking and variation management.',
    products: [
      { name: 'GUARDIA', color: 'var(--color-guardia)' },
      { name: 'DOXEN', color: 'var(--color-doxen)' },
      { name: 'SIGN', color: 'var(--color-sign)' },
    ],
  },
  {
    num: '05',
    name: 'Closeout',
    desc: 'Forensic analysis, claims resolution, EOT substantiation and final account.',
    products: [
      { name: 'CLAIMX', color: 'var(--color-claimx)' },
      { name: 'SIGN', color: 'var(--color-sign)' },
    ],
  },
];

const PRODUCTS = [
  {
    name: 'SIGN',
    domain: 'sign.ai',
    color: '#4F6EF7',
    description:
      'The contract intelligence backbone of your entire project. Active from first agreement to final account — reviewing, monitoring, and protecting your contractual position at every phase.',
    tag: 'Contracts & Risk →',
    available: true,
    href: SIGN_HOME,
  },
  {
    name: 'VENDRIX',
    domain: 'vendrix.ai',
    color: '#FF8C42',
    description:
      'AI-driven procurement intelligence. Evaluate bids, qualify vendors, and manage supply chain risk with data-driven decisions across your entire portfolio.',
  },
  {
    name: 'SPANTEC',
    domain: 'spantec.ai',
    color: '#38BDF8',
    description:
      'Predictive planning and scheduling that sees delays before they happen. Baseline tracking, critical path analysis, and programme risk intelligence.',
  },
  {
    name: 'CLAIMX',
    domain: 'claimx.ai',
    color: '#A855F7',
    description:
      'Forensic claims analysis powered by AI. Build EOT narratives, substantiate delay events, and resolve disputes with evidence-backed intelligence.',
  },
  {
    name: 'GUARDIA',
    domain: 'guardia.ai',
    color: '#22C55E',
    description:
      'HSE compliance monitoring and safety intelligence. Real-time risk tracking, incident prediction, and regulatory compliance across all project sites.',
  },
  {
    name: 'DOXEN',
    domain: 'doxen.ai',
    color: '#EAB308',
    description:
      'Intelligent document control for construction. Automated classification, version tracking, transmittal management, and instant retrieval across projects.',
  },
];

const WHY_ROWS = [
  {
    label: 'Domain-native AI',
    heading: 'AI that speaks construction.',
    body:
      'MANAGEX models are trained on construction contracts, schedules, claims, and project data — not generic text. Not the internet. It reads a programme delay the way a scheduler does, and a contract clause the way a commercial manager does.',
    visual: null,
  },
  {
    label: 'Connected Data',
    heading: 'Every product. One truth.',
    body:
      'A contract clause in SIGN automatically generates a compliance check in GUARDIA, a schedule risk alert in SPANTEC, and a claims marker in CLAIMX — simultaneously. One platform. One source of truth. Zero information lost between disciplines.',
    visual: ['6 products', 'one brain'],
  },
  {
    label: 'Proactive Intelligence',
    heading: 'See risk before it becomes loss.',
    body:
      'Traditional tools report what happened. MANAGEX predicts what will happen — surfacing delay indicators, contract risks, safety signals, and cost anomalies before they compound into crises. Not reactive. Not retrospective. Predictive.',
    visual: ['40%', 'fewer disputes'],
  },
];

const TESTIMONIALS = [
  {
    quote:
      'SIGN identified three onerous clauses in a £40M subcontract that our legal team missed. It paid for itself in the first week.',
    name: 'Ahmed Al-Rashid',
    role: 'Commercial Director, Tier-1 Contractor — UAE',
  },
  {
    quote:
      'SPANTEC gave us 6 weeks advance notice of a critical path delay. We had mitigation in place before the client even noticed the risk.',
    name: 'Sarah Okonkwo',
    role: 'Planning Manager, Infrastructure PMC — UK',
  },
  {
    quote:
      'CLAIMX built our extension of time narrative from programme data and correspondence in hours — not the six weeks our forensic consultant quoted.',
    name: 'Marco Fernandes',
    role: 'Head of Claims, EPC Contractor — KSA',
  },
];

const LOGOS = ['AECOM', 'Turner', 'Bechtel', 'Mace', 'Laing O’Rourke', 'WSP'];

const FOOTER_PRODUCTS = [
  { label: 'SIGN', href: SIGN_HOME },
  { label: 'VENDRIX', href: '#' },
  { label: 'SPANTEC', href: '#' },
  { label: 'CLAIMX', href: '#' },
  { label: 'GUARDIA', href: '#' },
  { label: 'DOXEN', href: '#' },
];
const FOOTER_PLATFORM = ['How it works', 'Integrations', 'Security', 'API', 'Pricing'];
const FOOTER_COMPANY = ['About MANAGEX', 'Research', 'Careers', 'Press', 'Contact'];
const FOOTER_RESOURCES = ['Documentation', 'Blog', 'Case studies', 'Webinars', 'Help centre'];

type NotifyEntry = { email: string; submitted: boolean };

export default function App() {
  const [scrolled, setScrolled] = useState(false);
  const [notifyState, setNotifyState] = useState<Record<string, NotifyEntry>>({});

  const getNotifyState = (name: string): NotifyEntry =>
    notifyState[name] ?? { email: '', submitted: false };

  const setNotifyEmail = (name: string, email: string) => {
    setNotifyState((prev) => ({
      ...prev,
      [name]: { email, submitted: prev[name]?.submitted ?? false },
    }));
  };

  const submitNotify = (name: string) => {
    const current = getNotifyState(name);
    if (!current.email.trim()) return;
    setNotifyState((prev) => ({
      ...prev,
      [name]: { email: current.email, submitted: true },
    }));
  };

  // ── Phase 6.4 Step 3D — mobile nav drawer (< 768px only) ─────────────
  // Desktop ignores this: the drawer's `data-open` attribute only animates
  // when the drawer is visible via the existing @media (max-width: 768px)
  // rule. On desktop the drawer + overlay are `display: none`.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      document.querySelectorAll('.mx-reveal').forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    document.querySelectorAll('.mx-reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <>
      {/* ═══════ NAVIGATION ═══════ */}
      <nav className="mx-nav" data-scrolled={scrolled ? 'true' : 'false'} aria-label="Primary">
        <div className="mx-nav__inner">
          <a href="#top" aria-label="MANAGEX home" className="mx-nav__logo">
            <ManagexLogo variant="nav" />
          </a>
          <div className="mx-nav__center">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="mx-nav__link">
                {l.label}
              </a>
            ))}
          </div>
          <div className="mx-nav__cta">
            <a href={SIGN_LOGIN} className="mx-btn mx-btn--ghost-d">
              Sign in
            </a>
            <a href={SIGN_SIGNUP} className="mx-btn mx-btn--cyan">
              Get started
            </a>
            {/*
              Mobile hamburger (Phase 6.4 Step 3D) — `display: none` on desktop
              via the unprefixed default rule; the @media (max-width: 768px)
              block flips it to `display: inline-flex`. 44×44 touch target.
            */}
            <button
              type="button"
              className="mx-nav__hamburger"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
              aria-expanded={mobileNavOpen}
              aria-controls="mx-mobile-drawer"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
          </div>
        </div>
      </nav>

      {/*
        ═══════ MOBILE NAV DRAWER (Phase 6.4 Step 3D) ═══════
        Always rendered so the slide-in/out transition works in both directions.
        Hidden entirely on desktop via the existing `@media (max-width: 768px)`
        block: outside that breakpoint the drawer + overlay are `display: none`.
      */}
      <div
        className="mx-nav__drawer-overlay"
        data-open={mobileNavOpen ? 'true' : 'false'}
        onClick={() => setMobileNavOpen(false)}
        aria-hidden="true"
      />
      <aside
        id="mx-mobile-drawer"
        className="mx-nav__drawer"
        data-open={mobileNavOpen ? 'true' : 'false'}
        aria-label="Mobile navigation"
        aria-hidden={!mobileNavOpen}
      >
        <button
          type="button"
          className="mx-nav__drawer-close"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close menu"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <nav className="mx-nav__drawer-nav" aria-label="Primary mobile">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="mx-nav__drawer-link"
              onClick={() => setMobileNavOpen(false)}
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="mx-nav__drawer-actions">
          <a
            href={SIGN_LOGIN}
            className="mx-btn mx-btn--ghost-d mx-nav__drawer-btn"
            onClick={() => setMobileNavOpen(false)}
          >
            Sign in
          </a>
          <a
            href={SIGN_SIGNUP}
            className="mx-btn mx-btn--cyan mx-nav__drawer-btn"
            onClick={() => setMobileNavOpen(false)}
          >
            Get started
          </a>
        </div>
      </aside>

      <main id="top">
        {/* ═══════ HERO ═══════ */}
        <section className="mx-hero">
          <div className="mx-hero__grid" aria-hidden="true" />
          <div className="mx-hero__glow" aria-hidden="true" />
          <div className="mx-hero__fade" aria-hidden="true" />

          <div className="mx-hero__inner">
            <div className="mx-hero__eyebrow mx-stagger" style={{ animationDelay: '0.10s' }}>
              <span className="mx-hero__dot" />
              <span>AI Platform for Construction Intelligence</span>
            </div>

            <h1 className="mx-hero__h1 mx-stagger" style={{ animationDelay: '0.25s' }}>
              <span>Build Smarter.</span>
              <span className="mx-grad-cyan">Deliver Certain.</span>
            </h1>

            <p className="mx-hero__sub mx-stagger" style={{ animationDelay: '0.40s' }}>
              Six AI products. One platform. Built for the professionals who build everything else —
              and the projects that carry the weight of the world.
            </p>

            <p className="mx-hero__body mx-stagger" style={{ animationDelay: '0.52s' }}>
              We built MANAGEX because the construction industry deserves better than fragmented
              tools and decisions made with yesterday&rsquo;s data. Not adapted from generic
              software. Not retrofitted from another industry. Built from scratch — for contracts,
              schedules, claims, procurement, compliance, and documents.
            </p>

            <div className="mx-hero__ctas mx-stagger" style={{ animationDelay: '0.64s' }}>
              <a href="#products" className="mx-btn mx-btn--cyan">
                Explore the platform
              </a>
              <a href="#" className="mx-btn mx-btn--ghost-d">
                Watch demo →
              </a>
            </div>

            <a
              href={SIGN_HOME}
              className="mx-hero__sign-link mx-stagger"
              style={{ animationDelay: '0.76s' }}
            >
              Start with SIGN, our contracts product →
            </a>

            <div className="mx-stagger" style={{ animationDelay: '0.88s', width: '100%' }}>
              <HeroDashboard />
            </div>
          </div>
        </section>

        {/* ═══════ LOGOS BAR ═══════ */}
        <section className="mx-logos">
          <div className="mx-logos__inner">
            <span className="mx-logos__label">Powering the teams building tomorrow&rsquo;s world</span>
            <div className="mx-logos__row">
              {LOGOS.map((l) => (
                <span key={l} className="mx-logos__item">
                  {l}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════ LIFECYCLE (LIGHT) ═══════ */}
        <section id="platform" className="mx-section mx-section--light">
          <div className="mx-container">
            <div className="mx-reveal mx-section__head">
              <span className="mx-eyebrow" style={{ color: 'var(--mx-cyan-d)' }}>
                Full Project Lifecycle
              </span>
              <h2 className="mx-h2 mx-h2--light">
                Intelligence from <span className="mx-grad-cyan-d">Idea to Delivery</span>
              </h2>
              <p className="mx-section__body mx-section__body--light">
                Construction doesn&rsquo;t happen in phases — it happens in one connected,
                high-stakes continuum. MANAGEX is the first platform built to treat it that way —
                connecting every phase, every team, and every decision from the first idea to the
                final handover.
              </p>
            </div>

            <div className="mx-lifecycle">
              {PHASES.map((p) => (
                <div key={p.num} className="mx-lifecycle__card">
                  <div className="mx-lifecycle__num">{p.num}</div>
                  <div className="mx-lifecycle__name">{p.name}</div>
                  <p className="mx-lifecycle__desc">{p.desc}</p>
                  <div className="mx-lifecycle__pills">
                    {p.products.map((prod) => (
                      <span
                        key={prod.name}
                        className="mx-pill"
                        style={{
                          background: `color-mix(in srgb, ${prod.color} 8%, transparent)`,
                          color: prod.color,
                        }}
                      >
                        {prod.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════ PRODUCTS (LIGHT-2) ═══════ */}
        <section id="products" className="mx-section mx-section--light-2">
          <div className="mx-container">
            <div className="mx-reveal mx-products__head">
              <div>
                <span className="mx-eyebrow" style={{ color: 'var(--mx-cyan-d)' }}>
                  Product Suite
                </span>
                <h2 className="mx-h2 mx-h2--light">
                  Six products. <span className="mx-grad-cyan-d">One platform.</span>
                </h2>
              </div>
              <div className="mx-products__head-right">
                <p>
                  We didn&rsquo;t build one product and call it a platform. We built six — each one
                  designed for a specific discipline, each one made more powerful by its connection
                  to the others. Use one. Use all six. Your intelligence grows with every project.
                </p>
                <a href="#" className="mx-link-dark">
                  Explore all →
                </a>
              </div>
            </div>

            <div className="mx-products__grid">
              {PRODUCTS.map((p) =>
                p.available ? (
                  <a key={p.name} href={p.href} className="mx-product mx-product--available">
                    <span className="mx-product__top-border" />
                    <div className="mx-product__badge">
                      <span className="mx-product__badge-dot" />
                      Available now
                    </div>
                    <span className="mx-product__dot" style={{ background: p.color }} />
                    <div className="mx-product__name" style={{ color: p.color }}>
                      {p.name}
                    </div>
                    <div className="mx-product__domain">{p.domain}</div>
                    <p className="mx-product__desc">{p.description}</p>
                    <div className="mx-product__tag">{p.tag}</div>
                  </a>
                ) : (
                  <div
                    key={p.name}
                    className="mx-product mx-product--soon"
                    style={{ ['--soon-color' as string]: p.color }}
                  >
                    <span
                      className="mx-product__top-strip"
                      style={{ background: p.color }}
                      aria-hidden="true"
                    />
                    <div className="mx-product__soon-badge">
                      <span
                        className="mx-product__soon-badge-dot"
                        style={{ background: p.color }}
                      />
                      Coming Soon
                    </div>
                    <div className="mx-product__name" style={{ color: p.color }}>
                      {p.name}
                    </div>
                    <div className="mx-product__domain">{p.domain}</div>
                    <p className="mx-product__desc">{p.description}</p>

                    {getNotifyState(p.name).submitted ? (
                      <div
                        className="mx-product__notify-confirm"
                        style={{ color: p.color }}
                        role="status"
                        aria-live="polite"
                      >
                        You&rsquo;re on the list! We&rsquo;ll notify you at launch.
                      </div>
                    ) : (
                      <>
                        <p className="mx-product__microcopy">
                          Be the first to know when we launch.
                        </p>
                        <form
                          className="mx-product__notify-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            submitNotify(p.name);
                          }}
                          noValidate
                        >
                          <label
                            htmlFor={`notify-${p.name}`}
                            className="mx-visually-hidden"
                          >
                            Email address for {p.name} launch updates
                          </label>
                          <input
                            id={`notify-${p.name}`}
                            type="email"
                            className="mx-product__notify-input"
                            placeholder="your@email.com"
                            value={getNotifyState(p.name).email}
                            onChange={(e) => setNotifyEmail(p.name, e.target.value)}
                            autoComplete="email"
                          />
                          <button
                            type="submit"
                            className="mx-btn mx-product__notify-btn"
                            style={{
                              background: p.color,
                              borderColor: p.color,
                              color: '#0C0E14',
                            }}
                          >
                            Notify Me
                          </button>
                        </form>
                      </>
                    )}
                  </div>
                )
              )}
            </div>
          </div>
        </section>

        {/* ═══════ WHY MANAGEX (DARK) ═══════ */}
        <section className="mx-section mx-section--dark">
          <div className="mx-container">
            <div className="mx-reveal mx-section__head">
              <span className="mx-eyebrow" style={{ color: 'var(--mx-cyan)' }}>
                Why MANAGEX
              </span>
              <h2 className="mx-h2 mx-h2--dark">
                Built different. <span className="mx-grad-cyan">Built for this.</span>
              </h2>
            </div>

            <div className="mx-why">
              {WHY_ROWS.map((row, i) => (
                <div
                  key={row.heading}
                  className="mx-why__row"
                  data-reverse={i % 2 === 1 ? 'true' : 'false'}
                >
                  <div className="mx-why__text mx-reveal">
                    <span
                      className="mx-eyebrow"
                      style={{ color: 'var(--mx-cyan)', display: 'block', marginBottom: 12 }}
                    >
                      {row.label}
                    </span>
                    <h3 className="mx-why__heading">{row.heading}</h3>
                    <p className="mx-why__body">{row.body}</p>
                  </div>
                  <div className="mx-why__visual mx-reveal">
                    {row.visual === null ? (
                      <WhyRow1Visual />
                    ) : (
                      row.visual.map((line, idx, arr) => (
                        <div key={idx} className="mx-why__visual-line">
                          <span
                            style={
                              idx === arr.length - 1
                                ? { color: 'var(--mx-cyan)' }
                                : undefined
                            }
                          >
                            {line}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════ TESTIMONIALS (LIGHT) ═══════ */}
        <section className="mx-section mx-section--light">
          <div className="mx-container">
            <div className="mx-reveal mx-section__head">
              <span className="mx-eyebrow" style={{ color: 'var(--mx-cyan-d)' }}>
                From the Field
              </span>
              <h2 className="mx-h2 mx-h2--light">
                Trusted by the <span className="mx-grad-cyan-d">industry.</span>
              </h2>
            </div>

            <div className="mx-testimonials">
              {TESTIMONIALS.map((t) => (
                <div key={t.name} className="mx-testimonial mx-reveal">
                  <div className="mx-testimonial__mark">“</div>
                  <p className="mx-testimonial__quote">{t.quote}</p>
                  <div className="mx-testimonial__name">{t.name}</div>
                  <div className="mx-testimonial__role">{t.role}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════ MISSION (DARK-2) ═══════ */}
        <section id="mission" className="mx-section mx-section--dark-2 mx-section--center">
          <div className="mx-container mx-reveal">
            <span className="mx-eyebrow mx-eyebrow--block" style={{ color: 'var(--mx-cyan)' }}>
              Our Mission
            </span>
            <p className="mx-mission__quote">
              We believe every construction professional deserves to walk into every project
              meeting{' '}
              <span style={{ color: 'var(--mx-cyan)' }}>knowing exactly where they stand</span> —
              on risk, on cost, on time, on contract. We built MANAGEX to make that possible.
            </p>
            <p className="mx-mission__body">
              Through six AI-powered products, we give construction organisations the clarity to
              plan precisely, the confidence to execute decisively, and the foresight to deliver
              on every commitment they make. Not for some projects. For every project.
            </p>
            <a href="#" className="mx-btn mx-btn--ghost-d">
              Our mission →
            </a>
          </div>
        </section>

        {/* ═══════ CTA (LIGHT-2) ═══════ */}
        <section className="mx-section mx-section--light-2 mx-section--center mx-cta">
          <div className="mx-cta__glow" aria-hidden="true" />
          <div className="mx-container mx-reveal">
            <h2 className="mx-h2 mx-h2--light mx-cta__heading">
              Start building with{' '}
              <span className="mx-grad-cyan-d">intelligence on your side.</span>
            </h2>
            <p className="mx-cta__body">
              One platform. Six products. Every phase covered. Join the teams already building
              smarter with MANAGEX.
            </p>
            <div className="mx-cta__buttons">
              <a href="mailto:demo@managex.ai" className="mx-btn mx-btn--dark">
                Request a demo
              </a>
              <a href="#products" className="mx-btn mx-btn--ghost-l">
                Explore products →
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ═══════ FOOTER ═══════ */}
      <footer className="mx-footer">
        <div className="mx-footer__inner">
          <div className="mx-footer__grid">
            <div className="mx-footer__brand">
              <ManagexLogo variant="footer" />
              <p className="mx-footer__tagline">
                AI project management platform for construction. From idea to delivery.
              </p>
            </div>

            <FooterCol title="Products" items={FOOTER_PRODUCTS} />
            <FooterCol title="Platform" items={FOOTER_PLATFORM.map((label) => ({ label, href: '#' }))} />
            <FooterCol title="Company" items={FOOTER_COMPANY.map((label) => ({ label, href: '#' }))} />
            <FooterCol title="Resources" items={FOOTER_RESOURCES.map((label) => ({ label, href: '#' }))} />
          </div>

          <div className="mx-footer__bottom">
            <span>© 2025 MANAGEX Technologies. All rights reserved.</span>
            <div className="mx-footer__legal">
              <a href="#">Privacy Policy</a>
              <a href="#">Terms of Service</a>
              <a href="#">Cookie Policy</a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}

function WhyRow1Visual() {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
      }}
    >
      {/* Zone 1 */}
      <div style={{ marginBottom: 20, textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 800,
            fontSize: 22,
            color: 'var(--d-bright)',
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
          }}
        >
          Trained on construction.
        </div>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 800,
            fontSize: 22,
            color: 'var(--mx-cyan)',
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
          }}
        >
          Not the internet.
        </div>
      </div>

      {/* Divider */}
      <div
        style={{
          width: '100%',
          height: 1,
          background: 'linear-gradient(to right, var(--mx-cyan), transparent)',
          opacity: 0.3,
          marginBottom: 20,
        }}
      />

      {/* Zone 2 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            color: '#EAB308',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span aria-hidden="true">⚠</span> Delay detected
        </div>
        <div
          style={{
            fontFamily: 'var(--f-body)',
            fontWeight: 400,
            fontSize: 13,
            color: 'var(--d-mid)',
          }}
        >
          Critical path · 26 days at risk
        </div>
        <div
          style={{
            fontFamily: 'var(--f-body)',
            fontWeight: 500,
            fontSize: 13,
            color: 'var(--mx-cyan)',
          }}
        >
          Identified 6 weeks early.
        </div>
      </div>
    </div>
  );
}

function FooterCol({
  title,
  items,
}: {
  title: string;
  items: { label: string; href: string }[];
}) {
  return (
    <div>
      <h4 className="mx-footer__title">{title}</h4>
      <ul className="mx-footer__list">
        {items.map((item) => (
          <li key={item.label}>
            <a href={item.href}>{item.label}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
