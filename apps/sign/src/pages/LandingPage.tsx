import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import SignLogo from '@/components/common/SignLogo';

/* ── Company logo imports ──────────────────────────────────────── */
import logoOrascom from '@/assets/logos/orascom.png';
import logoEmaar from '@/assets/logos/Emaar-Properties-Logo.png';
import logoCCC from '@/assets/logos/Consolidated_Contractors_Company_Logo.svg.png';
import logoRoshn from '@/assets/logos/Roshn_Logo.svg';
import logoChrome from '@/assets/logos/managed-by-chrome.png';
import logoRedcon from '@/assets/logos/redcon.png';

/* ═══════════════════════════════════════════════════════════════════
   SIGN — World-Class Marketing Landing Page
   AI Contract Management for Construction & Engineering | MENA
   ═══════════════════════════════════════════════════════════════════ */

/* ── Islamic Geometric Pattern SVG ─────────────────────────────── */
function GeometricPattern({ opacity = 0.05 }: { opacity?: number }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="islamic-geo"
          x="0"
          y="0"
          width="60"
          height="60"
          patternUnits="userSpaceOnUse"
        >
          {/* 6-pointed star tessellation */}
          <path
            d="M30 0L37.32 15h17.32L40 30l14.64 15H37.32L30 60 22.68 45H5.36L20 30 5.36 15h17.32Z"
            fill="none"
            stroke="white"
            strokeWidth="0.5"
            opacity={opacity}
          />
          <path
            d="M30 15L37.32 30 30 45 22.68 30Z"
            fill="none"
            stroke="white"
            strokeWidth="0.4"
            opacity={opacity * 0.8}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#islamic-geo)" />
    </svg>
  );
}

/* ── Language config ───────────────────────────────────────────── */
const LANGUAGES = [
  { code: 'en', label: 'English', flag: '\u{1F1EC}\u{1F1E7}', font: 'Inter' },
  { code: 'ar', label: '\u0627\u0644\u0639\u0631\u0628\u064A\u0629', flag: '\u{1F1F8}\u{1F1E6}', font: 'Cairo' },
  { code: 'fr', label: 'Fran\u00E7ais', flag: '\u{1F1EB}\u{1F1F7}', font: 'Inter' },
  { code: 'es', label: 'Espa\u00F1ol', flag: '\u{1F1EA}\u{1F1F8}', font: 'Inter' },
];

/* ── Keyframes (injected once) ─────────────────────────────────── */
const KEYFRAMES = `
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap');
`;

/* ── Nav links ─────────────────────────────────────────────────── */
const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'Solutions', href: '#solutions' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Contact', href: '#contact' },
];

/* ── Company logos for marquee ──────────────────────────────────── */
const LOGO_URLS: string[] = [logoOrascom, logoEmaar, logoCCC, logoRoshn, logoChrome, logoRedcon];

/* ── Problems ──────────────────────────────────────────────────── */
const PROBLEMS = [
  {
    title: 'Complex Contracts & Risk Assessment',
    desc: 'Managing intricate construction terms and identifying risks across hundreds of clauses is overwhelming without specialized AI built for FIDIC and NEC standards.',
  },
  {
    title: 'High Risk of Disputes & Delays',
    desc: 'Poor contract oversight leads to costly legal disputes, project delays, and budget overruns that could have been prevented with proactive risk management.',
  },
  {
    title: 'Slow, Manual Review Processes',
    desc: 'Traditional contract review methods waste weeks of expert time and delay critical project decisions \u2014 putting timelines and profitability at risk.',
  },
  {
    title: 'Compliance Challenges',
    desc: 'Adhering simultaneously to FIDIC standards, international best practices, and local MENA construction regulations is complex and error-prone.',
  },
  {
    title: 'Legal Clause Interpretation Issues',
    desc: 'Misinterpretation of technical legal language increases compliance risk and creates disputes between owners, contractors, and consultants.',
  },
  {
    title: 'Multi-Language Contracts',
    desc: 'Cross-border MENA projects require contracts in Arabic, English, French, and Spanish \u2014 most tools handle only one language.',
  },
  {
    title: 'Human Error in Manual Review',
    desc: 'Manual contract reviews consistently lead to overlooked risks, missed obligations, and costly inconsistencies that AI can systematically eliminate.',
  },
];

/* ── Comparison table rows ─────────────────────────────────────── */
const COMPARISON_ROWS = [
  'FIDIC & NEC templates built-in',
  'Arabic + English + French OCR',
  'Construction risk categories',
  'Claims & notices management',
  'Clause-level AI risk scoring',
  'MENA jurisdiction compliance',
  'Amendments & addendums tracking',
  'Built for Owners AND Contractors',
  'Microsoft Word add-in',
];

/* ── Features ──────────────────────────────────────────────────── */
const FEATURES = [
  {
    title: 'Contract Review & Risk Analysis',
    desc: 'Automatically review every clause for risks impacting Contractors, Employers, and all parties. Flag indemnities, penalties, and unclear deliverables with Low, Medium, or High risk ratings and AI-powered clause suggestions.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        <circle cx="18" cy="6" r="3" strokeWidth={1.5} />
      </svg>
    ),
  },
  {
    title: 'Summarization & Insights',
    desc: 'Generate concise contract summaries highlighting obligations, deadlines, and penalties. View results directly on your dashboard or export as a downloadable PDF report.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12" />
      </svg>
    ),
  },
  {
    title: 'Compliance Checks',
    desc: 'Verify compliance against FIDIC standards, international best practices, and local organizational policies. Non-compliant clauses are flagged automatically for your team\u2019s review.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.745 3.745 0 011.043 3.296A3.745 3.745 0 0121 12z" />
      </svg>
    ),
  },
  {
    title: 'Q&A Contract Assistant',
    desc: 'Ask any question about your contract and get instant, cited answers. Our AI chatbot is trained on FIDIC terminology, local construction law, and industry-specific FAQs.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        <path d="M15 9l.5-.5M16.5 7.5L17 7" strokeLinecap="round" strokeWidth={1.5} />
      </svg>
    ),
  },
  {
    title: 'Notices Management',
    desc: 'Submit, receive, acknowledge, and respond to formal contractual notices using predefined templates. Execute notice-triggered actions with full audit trails \u2014 all in one unified dashboard.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 5.25v-1.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 00-.75.75v1.5" />
      </svg>
    ),
  },
  {
    title: 'Claims Management',
    desc: 'Submit formal claims digitally, assess and respond with full traceability, negotiate counter-proposals, and execute settlement agreements \u2014 with real-time tracking throughout.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z" />
      </svg>
    ),
  },
  {
    title: 'Contract Sharing & E-Signature',
    desc: 'Share contract drafts securely with all stakeholders. Review, approve, and execute electronic signatures compliant with MENA legal standards.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L18.5 8.15" />
      </svg>
    ),
  },
  {
    title: 'Amendments & Addendums Management',
    desc: 'Create, approve, and attach amendments and addendums using standardized templates. Track all changes and obligations arising from executed modifications with integrated version history.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  },
  {
    title: 'Task & Obligation Management',
    desc: 'View and manage all contract tasks assigned to your team. Track completion, responsible parties, and upcoming deadlines with automated reminders.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12.75l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: 'User-Friendly Dashboard & Analytics',
    desc: 'Customizable dashboards for Contract Managers, Legal Teams, and Employer\u2019s Representatives. Visual analytics, reporting tools, onboarding assistance, and live chat customer support.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
];

/* ── How It Works steps ────────────────────────────────────────── */
const STEPS = [
  {
    num: 1,
    title: 'Upload Your Contract',
    desc: 'Upload any contract \u2014 PDF, DOCX, or scanned image \u2014 in Arabic, English, French, or Spanish. SIGN identifies the contract type (FIDIC, NEC, or bespoke) and extracts every clause automatically.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-8 w-8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
      </svg>
    ),
  },
  {
    num: 2,
    title: 'AI Analyzes & Flags Risks',
    desc: 'Our Risk Analyzer scans against FIDIC standards, MENA construction law, and your organization\u2019s policies. Every clause gets a risk score with recommendations and citations \u2014 in minutes.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-8 w-8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
  },
  {
    num: 3,
    title: 'Collaborate, Track & Execute',
    desc: 'Assign tasks, manage notices and claims, share with contractors, track obligations, and execute with e-signature. Everything connected, nothing missed.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-8 w-8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
  },
];

/* ── Testimonials ──────────────────────────────────────────────── */
const TESTIMONIALS = [
  {
    quote: 'SIGN transformed how we manage FIDIC contracts across our mega-projects. The AI risk analysis caught a delay damages clause that would have cost us tens of millions.',
    name: 'Ahmad Al-Rashidi',
    title: 'Contracts Director',
    company: 'Large Infrastructure Developer \u00B7 Dubai, UAE',
    flag: '\u{1F1E6}\u{1F1EA}',
  },
  {
    quote: 'Finally a contract tool that truly understands Arabic documents and MENA construction law. Our legal and contracts teams adopted it within days \u2014 no training needed.',
    name: 'Sara El-Masri',
    title: 'Head of Legal',
    company: 'Engineering & Design Consultancy \u00B7 Cairo, Egypt',
    flag: '\u{1F1EA}\u{1F1EC}',
  },
  {
    quote: 'The obligations tracking and notices management modules alone saved our team over 40 hours per month. Nothing falls through the cracks anymore.',
    name: 'Mohammed Al-Harbi',
    title: 'Senior Project Manager',
    company: 'Tier 1 Construction Group \u00B7 Riyadh, KSA',
    flag: '\u{1F1F8}\u{1F1E6}',
  },
];

/* ── Pricing plans ─────────────────────────────────────────────── */
const PRICING_PLANS = [
  {
    name: 'Starter',
    badge: 'For growing teams',
    price: 'Contact Us',
    subprice: 'Tailored to your project scope',
    features: [
      'Up to 3 active projects',
      '5 team members',
      'AI risk analysis',
      'Obligation tracking',
      'Arabic + English support',
      'Email support',
    ],
    cta: 'Get Started',
    ctaLink: '/auth/register',
    highlighted: false,
  },
  {
    name: 'Professional',
    badge: 'Most Popular',
    price: 'Contact Us',
    subprice: 'For established contractors & developers',
    features: [
      'Unlimited projects',
      '20 team members',
      'All Starter features',
      'FIDIC & NEC templates',
      'Notices & claims management',
      'Amendments & addendums tracking',
      'Contractor collaboration portal',
      'DocuSign e-signature',
      'Priority support',
    ],
    cta: 'Start Free Trial',
    ctaLink: '/auth/register',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    badge: 'For large organizations',
    price: 'Custom',
    subprice: 'Unlimited scale, full control',
    features: [
      'All Professional features',
      'Unlimited team members',
      'Microsoft Word add-in',
      'Private LLM deployment',
      'Custom risk rules & categories',
      'API access & integrations',
      'SSO & enterprise security',
      'Dedicated account manager',
      'SLA guarantee',
    ],
    cta: 'Talk to Sales',
    ctaLink: 'mailto:demo@sign-platform.com',
    highlighted: false,
  },
];

/* ── Stats ─────────────────────────────────────────────────────── */
const STATS = [
  { value: 70, suffix: '%', label: 'Reduction in contract review time' },
  { value: 10, suffix: '+', label: 'Feature modules built for construction' },
  { value: 4, suffix: '', label: 'Languages: Arabic, English, French, Spanish' },
  { value: 100, suffix: '%', label: 'FIDIC & NEC standards compliance ready' },
];

/* ── Trust badges ──────────────────────────────────────────────── */
const TRUST_BADGES = [
  { icon: '\uD83D\uDD12', label: 'SOC 2 Ready' },
  { icon: '\uD83C\uDF10', label: 'MENA Compliant' },
  { icon: '\u{1F1F8}\u{1F1E6}', label: 'Arabic Native' },
  { icon: '\uD83D\uDCCB', label: 'FIDIC Certified' },
  { icon: '\u26A1', label: '14-Day Free Trial' },
];

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════ */
export default function LandingPage() {
  const navigate = useNavigate();
  const isAuthenticated = useSelector((s: RootState) => s.auth.isAuthenticated);

  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [currentLang, setCurrentLang] = useState(LANGUAGES[0]);
  const langRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const [statsAnimated, setStatsAnimated] = useState(false);
  const [animatedValues, setAnimatedValues] = useState(STATS.map(() => 0));

  // Redirect if authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/app/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Page title
  useEffect(() => {
    document.title = 'SIGN \u2014 AI Contract Management for Construction | MENA';
    document.documentElement.style.scrollBehavior = 'smooth';
    return () => {
      document.documentElement.style.scrollBehavior = '';
    };
  }, []);

  // Scroll handler
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Click outside lang dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Stats count-up animation
  const animateStats = useCallback(() => {
    if (statsAnimated) return;
    setStatsAnimated(true);
    const duration = 1500;
    const startTime = performance.now();
    const targets = STATS.map((s) => s.value);

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedValues(targets.map((t) => Math.round(t * eased)));
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [statsAnimated]);

  useEffect(() => {
    const el = statsRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) animateStats(); },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [animateStats]);

  // Language switcher
  const switchLang = (lang: typeof LANGUAGES[number]) => {
    setCurrentLang(lang);
    setLangOpen(false);
    document.documentElement.lang = lang.code;
    document.documentElement.dir = lang.code === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.style.fontFamily = lang.font === 'Cairo' ? 'Cairo, sans-serif' : 'Inter, sans-serif';
  };

  if (isAuthenticated) return null;

  return (
    <div className="min-h-screen" style={{ fontFamily: 'Inter, sans-serif' }}>
      <style>{KEYFRAMES}</style>

      {/* ═══════ SECTION 1: NAVIGATION BAR ═══════ */}
      <nav
        className="fixed inset-x-0 top-0 z-50 transition-all duration-300"
        style={{
          background: scrolled ? 'rgba(15,23,42,0.92)' : 'transparent',
          backdropFilter: scrolled ? 'blur(12px)' : 'none',
          boxShadow: scrolled ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
        }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          {/* Logo */}
          <Link to="/" className="flex items-center">
            <SignLogo size="md" variant="dark" />
          </Link>

          {/* Center nav (desktop) */}
          <div className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-gray-300 transition-colors hover:text-white"
                style={{ fontWeight: 500, fontSize: 14 }}
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Right side (desktop) */}
          <div className="hidden items-center gap-3 md:flex">
            {/* Language dropdown */}
            <div className="relative" ref={langRef}>
              <button
                onClick={() => setLangOpen(!langOpen)}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-white/40 hover:text-white"
              >
                <span>{currentLang.flag}</span>
                <span style={{ fontSize: 13 }}>{currentLang.label}</span>
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {langOpen && (
                <div className="absolute right-0 mt-2 w-44 rounded-xl border border-white/10 bg-[#1E293B] py-1 shadow-xl">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => switchLang(lang)}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-gray-300 transition-colors hover:bg-white/5 hover:text-white"
                    >
                      <span>{lang.flag}</span>
                      <span>{lang.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Auth buttons */}
            <Link
              to="/auth/login"
              className="rounded-lg border border-white/30 px-4 py-2 text-sm font-medium text-white transition-all hover:border-white hover:bg-white hover:text-[#0F172A]"
            >
              Log In
            </Link>
            <Link
              to="/auth/register"
              className="inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ background: '#0D6EFD' }}
            >
              Start Free Trial
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="text-white md:hidden"
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
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
          <div className="absolute bottom-0 right-0 top-0 w-72 overflow-y-auto bg-[#0F172A] p-6">
            <div className="mb-8 flex items-center justify-between">
              <SignLogo size="sm" variant="dark" />
              <button onClick={() => setMobileMenuOpen(false)} className="text-gray-400 hover:text-white">
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
                  className="text-base text-gray-300 hover:text-white"
                >
                  {link.label}
                </a>
              ))}
              <hr className="border-white/10" />
              {/* Language selector in mobile */}
              <div className="flex flex-col gap-2">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => { switchLang(lang); setMobileMenuOpen(false); }}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${currentLang.code === lang.code ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                  >
                    <span>{lang.flag}</span> {lang.label}
                  </button>
                ))}
              </div>
              <hr className="border-white/10" />
              <Link to="/auth/login" onClick={() => setMobileMenuOpen(false)} className="rounded-lg border border-white/30 px-4 py-2.5 text-center text-sm font-medium text-white">
                Log In
              </Link>
              <Link to="/auth/register" onClick={() => setMobileMenuOpen(false)} className="rounded-lg px-4 py-2.5 text-center text-sm font-semibold text-white" style={{ background: '#0D6EFD' }}>
                Start Free Trial &rarr;
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ SECTION 2: HERO ═══════ */}
      <section
        className="relative flex min-h-screen items-center overflow-hidden"
        style={{ background: '#0F172A' }}
      >
        <GeometricPattern />
        {/* Radial glow */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 80% 60% at 60% 50%, rgba(13,110,253,0.12), transparent)',
          }}
        />

        <div className="relative z-10 mx-auto max-w-7xl px-6 pb-20 pt-32">
          <div className="grid items-center gap-12 lg:grid-cols-[55%_45%] lg:gap-16">
            {/* Left column */}
            <div>
              {/* Badge */}
              <div
                className="mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm"
                style={{
                  border: '1px solid #D4A853',
                  color: '#D4A853',
                  background: 'rgba(212,168,83,0.08)',
                }}
              >
                <span>{'\u{1F3D7}\u{FE0F}'}</span>
                <span style={{ fontWeight: 500 }}>Built for Construction &amp; Engineering &middot; MENA&apos;s #1 Platform</span>
              </div>

              {/* Headline */}
              <h1
                className="text-white"
                style={{
                  fontSize: 'clamp(38px, 5vw, 60px)',
                  fontWeight: 800,
                  lineHeight: 1.1,
                  letterSpacing: '-0.02em',
                }}
              >
                Stop Losing Millions<br />to Contract Risk.
              </h1>

              {/* Subheadline */}
              <p
                className="mt-6"
                style={{
                  color: '#94A3B8',
                  fontSize: 19,
                  lineHeight: 1.7,
                  maxWidth: 520,
                  fontWeight: 400,
                }}
              >
                SIGN is the only AI-powered contract management platform purpose-built for construction and engineering in the MENA region. Analyze risk, track obligations, manage claims and notices &mdash; in Arabic, English, French, and Spanish.
              </p>

              {/* CTAs */}
              <div className="mt-8 flex flex-wrap gap-4">
                <Link
                  to="/auth/register"
                  className="inline-flex items-center gap-2 rounded-lg px-7 text-base font-semibold text-white transition-all hover:opacity-90"
                  style={{ background: '#0D6EFD', height: 48, borderRadius: 8 }}
                >
                  Start Free Trial
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </Link>
                <a
                  href="mailto:demo@sign-platform.com"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-7 text-base font-medium text-white transition-all hover:border-white hover:bg-white hover:text-[#0F172A]"
                  style={{ height: 48, borderRadius: 8 }}
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Watch Demo
                </a>
              </div>
            </div>

            {/* Right column — Dashboard mock */}
            <div className="relative flex justify-center lg:justify-end">
              {/* Blue glow */}
              <div
                className="pointer-events-none absolute"
                style={{
                  width: '120%',
                  height: '120%',
                  top: '-10%',
                  left: '-10%',
                  background: 'radial-gradient(circle, rgba(13,110,253,0.2), transparent)',
                  filter: 'blur(40px)',
                  zIndex: -1,
                }}
              />
              <div
                className="w-full max-w-md"
                style={{
                  animation: 'float 5s ease-in-out infinite alternate',
                }}
              >
                <div
                  className="overflow-hidden"
                  style={{
                    background: '#1E293B',
                    borderRadius: 16,
                    padding: 24,
                    boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
                  }}
                >
                  {/* Card top bar */}
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span style={{ color: '#0D6EFD', fontWeight: 700, fontSize: 14 }}>Sign</span>
                      <span style={{ color: '#64748B', fontSize: 13 }}>&middot; Contract Analysis</span>
                    </div>
                    <div
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5"
                      style={{ background: 'rgba(34,197,94,0.15)', fontSize: 12, fontWeight: 600 }}
                    >
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#22C55E' }} />
                      <span style={{ color: '#22C55E' }}>AI Complete</span>
                    </div>
                  </div>

                  {/* Contract name */}
                  <p className="mb-3 truncate" style={{ color: '#CBD5E1', fontSize: 13 }}>
                    FIDIC Red Book &mdash; Cairo Metro Extension, Phase 3
                  </p>

                  {/* Risk summary bar */}
                  <div className="mb-2 flex overflow-hidden rounded" style={{ height: 8 }}>
                    <div style={{ width: '18%', background: '#EF4444' }} />
                    <div style={{ width: '38%', background: '#F59E0B' }} />
                    <div style={{ width: '44%', background: '#22C55E' }} />
                  </div>
                  <p className="mb-4" style={{ color: '#64748B', fontSize: 12 }}>
                    3 High &middot; 7 Medium &middot; 12 Low
                  </p>

                  {/* Risk items */}
                  <div className="mb-4 space-y-2.5">
                    {[
                      { clause: 'Clause 8.7 \u2014 Delay Damages', level: 'HIGH', color: '#EF4444' },
                      { clause: 'Clause 14.3 \u2014 Payment Timeline', level: 'MEDIUM', color: '#F59E0B' },
                      { clause: 'Clause 4.1 \u2014 Contractor Obligations', level: 'LOW', color: '#22C55E' },
                    ].map((r) => (
                      <div
                        key={r.clause}
                        className="flex items-center justify-between rounded-lg px-3 py-2.5"
                        style={{ borderLeft: `3px solid ${r.color}`, background: 'rgba(255,255,255,0.03)' }}
                      >
                        <span style={{ color: '#E2E8F0', fontSize: 13 }}>{r.clause}</span>
                        <span
                          className="rounded px-2 py-0.5"
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: r.color,
                            background: `${r.color}15`,
                          }}
                        >
                          {r.level}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Divider */}
                  <hr style={{ borderColor: 'rgba(255,255,255,0.06)' }} />

                  {/* Upcoming obligation */}
                  <div className="mt-3 flex items-center gap-2">
                    <svg className="h-4 w-4" style={{ color: '#E86C29' }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span style={{ color: '#CBD5E1', fontSize: 13 }}>Submit Progress Report</span>
                    <span style={{ color: '#E86C29', fontSize: 12, fontWeight: 600, marginLeft: 'auto' }}>Due in 3 days</span>
                  </div>

                  {/* Bottom row */}
                  <div className="mt-3 flex items-center gap-4">
                    <span style={{ color: '#0D6EFD', fontSize: 13, cursor: 'pointer' }}>{'\uD83D\uDCC4'} Summary Ready</span>
                    <span style={{ color: '#64748B', fontSize: 13, cursor: 'pointer' }}>{'\u2B07'} Export Report</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ SECTION 3: SOCIAL PROOF BAR ═══════ */}
      {LOGO_URLS.length > 0 && (
        <section className="bg-white py-12">
          <p
            className="mb-8 text-center"
            style={{
              color: '#64748B',
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            Trusted by Construction Leaders Across the MENA Region
          </p>
          <div className="overflow-hidden">
            <div
              className="flex whitespace-nowrap"
              style={{ animation: 'marquee 30s linear infinite' }}
            >
              {[...LOGO_URLS, ...LOGO_URLS].map((url, i) => (
                <div
                  key={`logo-${i}`}
                  className="mx-4 flex-shrink-0 rounded-lg bg-white transition-opacity duration-200 hover:opacity-80"
                  style={{ width: 160, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <img
                    src={url}
                    alt=""
                    loading="lazy"
                    style={{ maxHeight: 40, maxWidth: 120, width: 'auto', height: 'auto', objectFit: 'contain' }}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═══════ SECTION 4: THE PROBLEM ═══════ */}
      <section id="solutions" className="relative overflow-hidden" style={{ background: '#0F172A', padding: '100px 0', scrollMarginTop: 80 }}>
        <GeometricPattern />
        <div className="relative z-10 mx-auto max-w-7xl px-6">
          <p style={{ color: '#E86C29', textTransform: 'uppercase', fontWeight: 600, fontSize: 12, letterSpacing: '3px', marginBottom: 16 }}>
            THE PROBLEM
          </p>
          <h2
            className="mb-12"
            style={{ color: 'white', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 44px)', lineHeight: 1.15, maxWidth: 600 }}
          >
            Construction contracts are uniquely complex.{' '}
            <span style={{ color: '#94A3B8' }}>Generic legal tools aren&apos;t built for them.</span>
          </h2>

          <div className="grid gap-12 lg:grid-cols-[45%_55%]">
            {/* Left — problems */}
            <div className="space-y-3">
              {PROBLEMS.map((p) => (
                <div
                  key={p.title}
                  className="rounded-lg"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    borderLeft: '4px solid #E86C29',
                    borderRadius: 8,
                    padding: '16px 20px',
                  }}
                >
                  <div className="mb-1.5 flex items-center gap-2.5">
                    <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: '#E86C29' }} />
                    <span style={{ color: 'white', fontWeight: 600, fontSize: 15 }}>{p.title}</span>
                  </div>
                  <p style={{ color: '#94A3B8', fontSize: 14, lineHeight: 1.6, paddingLeft: 22 }}>{p.desc}</p>
                </div>
              ))}
            </div>

            {/* Right — comparison table */}
            <div>
              <h3 className="mb-6" style={{ color: 'white', fontWeight: 700, fontSize: 20 }}>
                Why SIGN beats every generic CLM tool
              </h3>
              <div className="overflow-hidden rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                {/* Header */}
                <div className="grid grid-cols-[1fr_100px_100px]" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <div style={{ padding: '14px 20px', color: '#94A3B8', fontSize: 13, fontWeight: 600 }}>Feature</div>
                  <div className="text-center" style={{ padding: '14px 12px', color: '#94A3B8', fontSize: 13, fontWeight: 600 }}>Generic CLM</div>
                  <div
                    className="text-center"
                    style={{ padding: '14px 12px', color: 'white', fontSize: 13, fontWeight: 700, background: 'rgba(232,108,41,0.2)' }}
                  >
                    SIGN
                  </div>
                </div>
                {/* Rows */}
                {COMPARISON_ROWS.map((row, i) => (
                  <div
                    key={row}
                    className="grid grid-cols-[1fr_100px_100px]"
                    style={{ borderBottom: i < COMPARISON_ROWS.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
                  >
                    <div style={{ padding: '12px 20px', color: 'white', fontSize: 14 }}>{row}</div>
                    <div className="flex items-center justify-center">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <svg className="h-3.5 w-3.5" style={{ color: '#64748B' }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </span>
                    </div>
                    <div className="flex items-center justify-center" style={{ background: 'rgba(13,110,253,0.08)' }}>
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full" style={{ background: '#0D6EFD' }}>
                        <svg className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ SECTION 5: CORE FEATURES ═══════ */}
      <section id="features" className="bg-[#F8FAFC]" style={{ padding: '100px 0', scrollMarginTop: 80 }}>
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-12 text-center">
            <p style={{ color: '#0D6EFD', textTransform: 'uppercase', fontWeight: 600, fontSize: 12, letterSpacing: '3px', marginBottom: 12 }}>
              PLATFORM
            </p>
            <h2 style={{ color: '#0F172A', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 44px)', marginBottom: 16 }}>
              Everything You Need to Protect Your Project
            </h2>
            <p style={{ color: '#64748B', fontSize: 18, maxWidth: 600, margin: '0 auto', lineHeight: 1.6 }}>
              Purpose-built for construction contracts &mdash; from FIDIC Red Book to bespoke EPC agreements &mdash; across all MENA jurisdictions.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-xl bg-white p-8 transition-all duration-200 hover:-translate-y-1"
                style={{
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  borderLeft: '4px solid transparent',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderLeftColor = '#0D6EFD';
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 10px 40px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderLeftColor = 'transparent';
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
                }}
              >
                <div
                  className="mb-4 inline-flex items-center justify-center"
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 10,
                    background: 'rgba(13,110,253,0.1)',
                    color: '#0D6EFD',
                  }}
                >
                  {f.icon}
                </div>
                <h3 style={{ color: '#0F172A', fontWeight: 700, fontSize: 17, marginBottom: 8 }}>{f.title}</h3>
                <p style={{ color: '#64748B', fontSize: 14, lineHeight: 1.6 }}>{f.desc}</p>
              </div>
            ))}
          </div>

          {/* Word add-in note */}
          <div className="mt-10 flex items-center justify-center gap-2 text-center" style={{ color: '#64748B', fontSize: 14 }}>
            <span>Plus:</span>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
              <rect width="20" height="20" x="2" y="2" rx="3" fill="#2B579A" />
              <text x="12" y="16" textAnchor="middle" fill="white" fontSize="12" fontWeight="700" fontFamily="Inter, sans-serif">W</text>
            </svg>
            <span>Microsoft Word Add-in &mdash; use SIGN directly inside Word without switching tools.</span>
          </div>
        </div>
      </section>

      {/* ═══════ SECTION 6: HOW IT WORKS ═══════ */}
      <section id="how-it-works" className="relative overflow-hidden" style={{ background: '#0F172A', padding: '100px 0', scrollMarginTop: 80 }}>
        <GeometricPattern />
        <div className="relative z-10 mx-auto max-w-7xl px-6">
          <div className="mb-12 text-center">
            <p style={{ color: '#D4A853', textTransform: 'uppercase', fontWeight: 600, fontSize: 12, letterSpacing: '3px', marginBottom: 12 }}>
              PROCESS
            </p>
            <h2 style={{ color: 'white', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 44px)' }}>
              From contract upload to full clarity &mdash; in minutes
            </h2>
          </div>

          <div className="relative grid gap-8 md:grid-cols-3">
            {/* Connecting dashed line (desktop only) */}
            <div
              className="pointer-events-none absolute top-16 hidden md:block"
              style={{
                left: 'calc(33.333% - 20px)',
                right: 'calc(33.333% - 20px)',
                borderTop: '2px dashed #E86C29',
                opacity: 0.4,
              }}
            />

            {STEPS.map((step) => (
              <div key={step.num} className="relative text-center">
                <div
                  className="mx-auto mb-5 inline-flex items-center justify-center"
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background: '#E86C29',
                    color: 'white',
                    fontWeight: 800,
                    fontSize: 22,
                    position: 'relative',
                    zIndex: 2,
                  }}
                >
                  {step.num}
                </div>
                <div
                  className="rounded-xl p-8"
                  style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 12 }}
                >
                  <div className="mx-auto mb-4 flex items-center justify-center" style={{ color: '#94A3B8' }}>
                    {step.icon}
                  </div>
                  <h3 className="mb-3" style={{ color: 'white', fontWeight: 700, fontSize: 18 }}>{step.title}</h3>
                  <p style={{ color: '#94A3B8', fontSize: 15, lineHeight: 1.7 }}>{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ SECTION 7: STATS BAR ═══════ */}
      <section ref={statsRef} style={{ background: '#0D6EFD', padding: '80px 0' }}>
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-6 md:grid-cols-4">
          {STATS.map((stat, i) => (
            <div key={stat.label} className="relative text-center">
              {i > 0 && (
                <div
                  className="absolute left-0 top-1/2 hidden -translate-y-1/2 md:block"
                  style={{ width: 1, height: '60%', background: 'rgba(255,255,255,0.2)' }}
                />
              )}
              <p style={{ color: 'white', fontWeight: 800, fontSize: 'clamp(40px, 5vw, 64px)', lineHeight: 1 }}>
                {animatedValues[i]}{stat.suffix}
              </p>
              <p className="mt-2" style={{ color: 'rgba(255,255,255,0.8)', fontSize: 16 }}>{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════ SECTION 8: TESTIMONIALS ═══════ */}
      <section className="bg-white" style={{ padding: '100px 0' }}>
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-12 text-center">
            <p style={{ color: '#E86C29', textTransform: 'uppercase', fontWeight: 600, fontSize: 12, letterSpacing: '3px', marginBottom: 12 }}>
              TESTIMONIALS
            </p>
            <h2 style={{ color: '#0F172A', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 44px)' }}>
              Trusted by construction professionals across MENA
            </h2>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <div
                key={t.name}
                className="rounded-xl bg-white p-8"
                style={{
                  borderTop: '4px solid #D4A853',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
                }}
              >
                <span style={{ fontWeight: 800, fontSize: 64, lineHeight: 1, color: '#D4A853', opacity: 0.3 }}>&ldquo;</span>
                <p className="mb-6 -mt-6" style={{ color: '#374151', fontSize: 15, lineHeight: 1.7 }}>
                  {t.quote}
                </p>
                <div>
                  <p style={{ color: '#0F172A', fontWeight: 700, fontSize: 15 }}>{t.name}</p>
                  <p style={{ color: '#64748B', fontSize: 14 }}>{t.title}</p>
                  <p className="mt-1 flex items-center gap-1.5" style={{ color: '#94A3B8', fontSize: 13 }}>
                    {t.company} <span>{t.flag}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ SECTION 9: PRICING ═══════ */}
      <section id="pricing" className="bg-[#F8FAFC]" style={{ padding: '100px 0', scrollMarginTop: 80 }}>
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-12 text-center">
            <p style={{ color: '#0D6EFD', textTransform: 'uppercase', fontWeight: 600, fontSize: 12, letterSpacing: '3px', marginBottom: 12 }}>
              PRICING
            </p>
            <h2 style={{ color: '#0F172A', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 44px)', marginBottom: 16 }}>
              Simple, transparent pricing
            </h2>
            <p style={{ color: '#64748B', fontSize: 18, maxWidth: 600, margin: '0 auto' }}>
              All plans include AI risk analysis, Arabic language support, and FIDIC/NEC compliance. No hidden fees.
            </p>
          </div>

          <div className="mx-auto grid max-w-5xl items-center gap-6 md:grid-cols-3">
            {PRICING_PLANS.map((plan) => (
              <div
                key={plan.name}
                className="relative overflow-hidden rounded-2xl"
                style={{
                  background: plan.highlighted ? '#0F172A' : 'white',
                  padding: 32,
                  boxShadow: plan.highlighted ? '0 20px 60px rgba(0,0,0,0.3)' : '0 2px 12px rgba(0,0,0,0.08)',
                  transform: plan.highlighted ? 'scale(1.04)' : 'scale(1)',
                  zIndex: plan.highlighted ? 10 : 1,
                  border: plan.highlighted ? 'none' : '1px solid #E2E8F0',
                }}
              >
                {/* Glow for highlighted card */}
                {plan.highlighted && (
                  <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2" style={{ width: 300, height: 200, background: 'radial-gradient(circle, rgba(13,110,253,0.2), transparent)', filter: 'blur(50px)' }} />
                )}

                {/* Badge */}
                <div className="mb-4">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                    style={{
                      background: plan.highlighted ? '#D4A853' : '#F1F5F9',
                      color: plan.highlighted ? '#0F172A' : '#64748B',
                    }}
                  >
                    {plan.highlighted && '\u2B50 '}
                    {plan.badge}
                  </span>
                </div>

                <h3 className="mb-1" style={{ color: plan.highlighted ? 'white' : '#0F172A', fontWeight: 700, fontSize: 22 }}>
                  {plan.name}
                </h3>
                <p style={{ fontWeight: 800, fontSize: 32, color: plan.highlighted ? 'white' : '#0F172A', marginBottom: 4 }}>
                  {plan.price}
                </p>
                <p className="mb-6" style={{ color: plan.highlighted ? '#94A3B8' : '#64748B', fontSize: 14 }}>
                  {plan.subprice}
                </p>

                <hr className="mb-6" style={{ borderColor: plan.highlighted ? 'rgba(255,255,255,0.1)' : '#E2E8F0' }} />

                <ul className="mb-8 space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <svg
                        className="mt-0.5 h-5 w-5 flex-shrink-0"
                        fill="none"
                        stroke={plan.highlighted ? '#D4A853' : '#0D6EFD'}
                        strokeWidth={2}
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      <span style={{ color: plan.highlighted ? '#CBD5E1' : '#374151', fontSize: 14 }}>{f}</span>
                    </li>
                  ))}
                </ul>

                {plan.ctaLink.startsWith('mailto') ? (
                  <a
                    href={plan.ctaLink}
                    className="block w-full rounded-lg py-3 text-center text-sm font-semibold transition-all"
                    style={{
                      background: 'transparent',
                      color: plan.highlighted ? 'white' : '#0F172A',
                      border: `2px solid ${plan.highlighted ? 'rgba(255,255,255,0.3)' : '#0F172A'}`,
                    }}
                  >
                    {plan.cta}
                  </a>
                ) : (
                  <Link
                    to={plan.ctaLink}
                    className="block w-full rounded-lg py-3 text-center text-sm font-semibold transition-all"
                    style={{
                      background: plan.highlighted ? '#D4A853' : 'transparent',
                      color: plan.highlighted ? '#0F172A' : '#0D6EFD',
                      border: plan.highlighted ? 'none' : '2px solid #0D6EFD',
                    }}
                  >
                    {plan.cta}
                  </Link>
                )}
              </div>
            ))}
          </div>

          <p className="mt-10 text-center" style={{ color: '#94A3B8', fontSize: 14 }}>
            14-day free trial &middot; No credit card required &middot; Annual billing available &middot; Prices in USD
          </p>
        </div>
      </section>

      {/* ═══════ SECTION 10: FINAL CTA BANNER ═══════ */}
      <section id="contact" className="relative overflow-hidden" style={{ background: '#0F172A', padding: '120px 0', scrollMarginTop: 80 }}>
        <GeometricPattern opacity={0.08} />
        <div className="relative z-10 mx-auto max-w-[700px] px-6 text-center">
          <h2 style={{ color: 'white', fontWeight: 800, fontSize: 'clamp(32px, 4.5vw, 52px)', lineHeight: 1.1 }}>
            Ready to protect your next<br />construction project?
          </h2>
          <p className="mt-4" style={{ color: '#CBD5E1', fontSize: 18 }}>
            Join construction teams across the UAE, KSA, Egypt, Qatar, and Kuwait who trust SIGN to manage their most critical contracts.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/auth/register"
              className="inline-flex items-center gap-2 rounded-lg px-8 py-3.5 text-base font-semibold text-white transition-all hover:opacity-90"
              style={{ background: '#0D6EFD' }}
            >
              Start Free Trial
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
            <a
              href="mailto:demo@sign-platform.com"
              className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-8 py-3.5 text-base font-medium text-white transition-all hover:border-white hover:bg-white hover:text-[#0F172A]"
            >
              Schedule a Demo
            </a>
          </div>

          {/* Trust badges */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            {TRUST_BADGES.map((b) => (
              <span
                key={b.label}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2"
                style={{ background: 'rgba(255,255,255,0.06)', color: '#CBD5E1', fontSize: 13 }}
              >
                <span>{b.icon}</span>
                {b.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ SECTION 11: FOOTER ═══════ */}
      <footer style={{ background: '#0F172A', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '80px 0 40px' }}>
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
            {/* Column 1 — Brand */}
            <div>
              <SignLogo size="lg" variant="dark" />
              <p className="mt-3" style={{ color: '#94A3B8', fontSize: 14, maxWidth: 240, lineHeight: 1.6 }}>
                AI-Powered Contract Intelligence for Construction &amp; Engineering
              </p>
              <div className="mt-5 flex items-center gap-3">
                {/* LinkedIn */}
                <a
                  href="#"
                  className="inline-flex items-center justify-center rounded-full transition-colors"
                  style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.08)', color: '#94A3B8' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'white'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#94A3B8'; }}
                  aria-label="LinkedIn"
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 3a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h14m-.5 15.5v-5.3a3.26 3.26 0 00-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 011.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 001.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 00-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" />
                  </svg>
                </a>
                {/* X / Twitter */}
                <a
                  href="#"
                  className="inline-flex items-center justify-center rounded-full transition-colors"
                  style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.08)', color: '#94A3B8' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'white'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#94A3B8'; }}
                  aria-label="Twitter"
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </a>
              </div>
            </div>

            {/* Column 2 — Product */}
            <div>
              <h4 className="mb-4" style={{ color: 'white', fontWeight: 600, fontSize: 14 }}>Product</h4>
              <ul className="space-y-2.5">
                {['Features', 'How It Works', 'Pricing', 'Security', 'Integrations', 'Microsoft Word Add-in'].map((l) => (
                  <li key={l}>
                    <a href={`#${l.toLowerCase().replace(/ /g, '-')}`} className="text-sm transition-colors" style={{ color: '#94A3B8' }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'white'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#94A3B8'; }}>
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Column 3 — Solutions */}
            <div>
              <h4 className="mb-4" style={{ color: 'white', fontWeight: 600, fontSize: 14 }}>Solutions</h4>
              <ul className="space-y-2.5">
                {[
                  'For Owners & Developers',
                  'For Contractors & Subcontractors',
                  'For Engineering Consultants',
                  'FIDIC Contract Management',
                  'Arabic Contract Analysis',
                  'Claims & Notices Management',
                ].map((l) => (
                  <li key={l}>
                    <a href="#solutions" className="text-sm transition-colors" style={{ color: '#94A3B8' }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'white'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#94A3B8'; }}>
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Column 4 — Company */}
            <div>
              <h4 className="mb-4" style={{ color: 'white', fontWeight: 600, fontSize: 14 }}>Company</h4>
              <ul className="space-y-2.5">
                {['About Us', 'Contact Us', 'Privacy Policy', 'Terms of Service'].map((l) => (
                  <li key={l}>
                    <a href="#" className="text-sm transition-colors" style={{ color: '#94A3B8' }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'white'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#94A3B8'; }}>
                      {l}
                    </a>
                  </li>
                ))}
                <li>
                  <a href="#" className="text-sm transition-colors" style={{ color: '#94A3B8', fontFamily: 'Cairo, sans-serif', direction: 'rtl' }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'white'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#94A3B8'; }}>
                    {'\u0645\u0631\u0643\u0632 \u0627\u0644\u0645\u0633\u0627\u0639\u062F\u0629'}
                  </a>
                </li>
              </ul>

              {/* Footer language selector */}
              <div className="mt-6 relative" ref={langRef}>
                <button
                  onClick={() => setLangOpen(!langOpen)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1.5 text-xs transition-colors"
                  style={{ color: '#94A3B8' }}
                >
                  <span>{currentLang.flag}</span>
                  <span>{currentLang.label}</span>
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Footer bottom */}
          <div
            className="mt-12 flex flex-col items-center justify-between gap-4 pt-6 sm:flex-row"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            <p style={{ color: '#64748B', fontSize: 13 }}>
              &copy; 2025 Sign by Optomatica. All rights reserved.
            </p>
            <p style={{ color: '#64748B', fontSize: 13 }}>
              Built for MENA&apos;s construction industry {'\u{1F3D7}\u{FE0F}'}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
