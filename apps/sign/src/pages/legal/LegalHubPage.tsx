import { Link } from 'react-router-dom';
import {
  Scale,
  Shield,
  Cookie,
  Brain,
  Copyright,
  Gavel,
  FileWarning,
  CreditCard,
  Bell,
  Globe,
  Mail,
  type LucideIcon,
} from 'lucide-react';
import LegalPageLayout from './LegalPageLayout';

interface PolicyCard {
  to: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

const POLICIES: PolicyCard[] = [
  {
    to: '/legal/terms',
    title: 'Terms & Conditions',
    description: 'The binding agreement between you and SIGN governing Platform access and use.',
    icon: Scale,
  },
  {
    to: '/legal/privacy',
    title: 'Privacy Policy',
    description: 'How SIGN collects, uses, and protects your personal data across all products.',
    icon: Shield,
  },
  {
    to: '/legal/cookies',
    title: 'Cookie Policy',
    description: 'What cookies SIGN uses, why, and how to manage your preferences.',
    icon: Cookie,
  },
  {
    to: '/legal/ai-policy',
    title: 'AI Innovation & Usage Policy',
    description:
      "How SIGN's AI features work, their limitations, and your rights regarding AI data.",
    icon: Brain,
  },
  {
    to: '/legal/ip',
    title: 'IP & Copyright Policy',
    description:
      'Intellectual property rights, content ownership, and copyright infringement procedures.',
    icon: Copyright,
  },
  {
    to: '/legal/law-enforcement',
    title: 'Law Enforcement Guidelines',
    description: 'How SIGN responds to government and law enforcement data requests.',
    icon: Gavel,
  },
  {
    to: '/legal/acceptable-use',
    title: 'Acceptable Use Policy',
    description: 'Permitted and prohibited uses of the SIGN Platform.',
    icon: FileWarning,
  },
  {
    to: '/legal/cancellation',
    title: 'Cancellation & Downgrade Policy',
    description: 'Your rights when ending or changing your SIGN subscription.',
    icon: CreditCard,
  },
  {
    to: '/legal/communications',
    title: 'Communication Preferences',
    description: 'How SIGN communicates with you and how to manage your preferences.',
    icon: Bell,
  },
  {
    to: '/legal/bcr',
    title: 'Binding Corporate Rules',
    description: "SIGN's global data protection standards for cross-border data transfers.",
    icon: Globe,
  },
];

export default function LegalHubPage() {
  return (
    <LegalPageLayout
      title="SIGN Legal Hub"
      effectiveDate="June 1, 2025"
      lastUpdated="June 1, 2025"
      sections={[]}
      showToc={false}
    >
      <section className="max-w-3xl">
        <p className="text-base text-gray-600">
          All our legal documents in one place. Last reviewed: June 2025.
        </p>
      </section>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {POLICIES.map((p) => {
          const Icon = p.icon;
          return (
            <Link
              key={p.to}
              to={p.to}
              className="group flex flex-col rounded-xl border border-gray-200 bg-white p-5 transition hover:border-[#4F6EF7] hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-[#4F6EF7]">
                  <Icon size={20} />
                </span>
                <h3 className="text-lg font-bold text-[#0F1729]">{p.title}</h3>
              </div>
              <p className="mt-3 text-sm text-gray-600">{p.description}</p>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="text-gray-400">Last Updated: June 1, 2025</span>
                <span className="font-medium text-[#4F6EF7] group-hover:underline">
                  View Policy →
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      <section className="mt-10 rounded-xl border border-gray-200 bg-gray-50 p-5">
        <h3 className="text-base font-semibold text-[#0F1729]">
          Questions about our legal documents?
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          Reach out to the SIGN legal or privacy team — we typically respond within two business
          days.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href="mailto:legal@sign.io"
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <Mail size={14} /> legal@sign.io
          </a>
          <a
            href="mailto:privacy@sign.io"
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <Mail size={14} /> privacy@sign.io
          </a>
        </div>
      </section>
    </LegalPageLayout>
  );
}
