import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import api from '@/services/api/axios';

// ─── Step Data ────────────────────────────────────────────

const quickSteps = [
  {
    title: 'Your Dashboard',
    description:
      'Your dashboard provides a real-time overview of your contracts, risks, obligations, and team activity. Loss-aversion metrics show you exactly how much time and risk exposure you\'re saving.',
    icon: (
      <svg className="w-16 h-16 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    title: 'Create a Project',
    description:
      'Projects are the top-level container for your contracts. Create one per engagement, tender, or deal. Each project can hold multiple contracts and has its own team access.',
    icon: (
      <svg className="w-16 h-16 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
    ),
  },
  {
    title: 'Upload & Analyze Contracts',
    description:
      'Upload PDF or Word contracts and our AI will automatically extract clauses, identify parties, and structure the document. You can also draft contracts from requirements using AI.',
    icon: (
      <svg className="w-16 h-16 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
    ),
  },
  {
    title: 'AI Risk Analysis',
    description:
      'Once clauses are extracted, our AI analyzes every clause against your knowledge base, legal standards, and custom risk rules. Risks are classified as High, Medium, or Low with actionable recommendations.',
    icon: (
      <svg className="w-16 h-16 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
      </svg>
    ),
  },
  {
    title: 'Track Obligations',
    description:
      'AI automatically identifies obligations from your contracts — deadlines, deliverables, payment schedules. Track them in one place with automated reminders so nothing falls through the cracks.',
    icon: (
      <svg className="w-16 h-16 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

const comprehensiveExtra = [
  {
    title: 'Clause Library',
    description:
      'Build a reusable library of clauses. Import from templates, AI-draft new ones, or save from existing contracts. Auto-populates when creating new contracts based on type.',
    icon: (
      <svg className="w-16 h-16 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    title: 'Knowledge Base',
    description:
      'Upload laws, standards, and internal policies. AI uses these as citation sources during risk analysis, giving you legally-grounded recommendations.',
    icon: (
      <svg className="w-16 h-16 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342" />
      </svg>
    ),
  },
  {
    title: 'Team Management',
    description:
      'Invite team members with role-based access. Owners can create, review, and approve. Contractors get their own portal. Everyone stays aligned.',
    icon: (
      <svg className="w-16 h-16 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
  {
    title: 'Reports & Exports',
    description:
      'Export contract PDFs, risk analysis reports, and summary documents. Share with stakeholders or keep for your records.',
    icon: (
      <svg className="w-16 h-16 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
    ),
  },
  {
    title: 'Settings & Billing',
    description:
      'Manage your subscription plan, billing details, and organization settings. Upgrade anytime to unlock more projects, users, and features.',
    icon: (
      <svg className="w-16 h-16 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

// ─── Component ────────────────────────────────────────────

type TourLevel = 'quick' | 'comprehensive';

export default function OnboardingPage() {
  const navigate = useNavigate();
  const user = useSelector((state: RootState) => state.auth.user);
  const [stage, setStage] = useState<'welcome' | 'tour'>('welcome');
  const [tourLevel, setTourLevel] = useState<TourLevel>('quick');
  const [stepIndex, setStepIndex] = useState(0);

  const steps = tourLevel === 'quick' ? quickSteps : [...quickSteps, ...comprehensiveExtra];
  const totalSteps = steps.length;
  const isLastStep = stepIndex === totalSteps - 1;

  const completeOnboarding = async () => {
    try {
      await api.put('/auth/onboarding/complete', { level: tourLevel });
    } catch {
      // non-critical
    }
    navigate('/app/dashboard');
  };

  // ── Welcome screen ──
  if (stage === 'welcome') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white flex items-center justify-center p-6">
        <div className="max-w-xl w-full text-center">
          {/* Bloom icon */}
          <div className="flex justify-center mb-6">
            <svg width="64" height="64" viewBox="-28 -28 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
              {[0, 60, 120, 180, 240, 300].map((a) => (
                <ellipse key={a} rx="16" ry="27" fill="#4F6EF7" opacity="0.80" transform={`rotate(${a})`} />
              ))}
              <path d="M0,-9 L2.5,0 L0,9 L-2.5,0Z" fill="white" />
              <path d="M-9,0 L0,-2.5 L9,0 L0,2.5Z" fill="white" />
              <circle cx="0" cy="0" r="4.5" fill="white" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold text-navy-900 mb-2">
            Welcome to Sign{user?.first_name ? `, ${user.first_name}` : ''}!
          </h1>
          <p className="text-gray-500 mb-10">
            Let's get you set up. Choose how you'd like to explore the platform.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Quick Tour */}
            <button
              onClick={() => { setTourLevel('quick'); setStage('tour'); }}
              className="bg-white rounded-2xl border border-gray-200 p-6 text-left shadow-card hover:shadow-card-hover hover:border-primary/30 transition-all group"
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                </svg>
              </div>
              <h3 className="font-semibold text-navy-900 mb-1">Quick Tour</h3>
              <p className="text-sm text-gray-500">5 key highlights · ~5 min</p>
            </button>

            {/* Comprehensive Tour */}
            <button
              onClick={() => { setTourLevel('comprehensive'); setStage('tour'); }}
              className="bg-white rounded-2xl border border-gray-200 p-6 text-left shadow-card hover:shadow-card-hover hover:border-primary/30 transition-all group"
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
              </div>
              <h3 className="font-semibold text-navy-900 mb-1">Comprehensive Tour</h3>
              <p className="text-sm text-gray-500">10 features deep-dive · ~15 min</p>
            </button>
          </div>

          <button
            onClick={() => navigate('/app/dashboard')}
            className="mt-6 text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  // ── Tour slides ──
  const step = steps[stepIndex];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white flex items-center justify-center p-6">
      <div className="max-w-lg w-full">
        {/* Progress bar */}
        <div className="flex items-center gap-1.5 mb-8">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= stepIndex ? 'bg-primary' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>

        {/* Step card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-elevated p-8 text-center">
          <div className="flex justify-center mb-6">{step.icon}</div>
          <h2 className="text-xl font-bold text-navy-900 mb-3">{step.title}</h2>
          <p className="text-sm text-gray-500 leading-relaxed">{step.description}</p>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            disabled={stepIndex === 0}
            className="px-5 py-2.5 text-sm font-medium text-gray-500 hover:text-navy-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Back
          </button>

          <span className="text-xs text-gray-400">
            {stepIndex + 1} / {totalSteps}
          </span>

          {isLastStep ? (
            <button
              onClick={completeOnboarding}
              className="px-6 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-600 transition-colors shadow-sm"
            >
              Go to Dashboard
            </button>
          ) : (
            <button
              onClick={() => setStepIndex((i) => i + 1)}
              className="px-6 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-600 transition-colors shadow-sm"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
