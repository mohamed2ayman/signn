import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { normalizeLegalLocale } from './content';

export interface LegalTocItem {
  id: string;
  title: string;
  subsections?: { id: string; title: string }[];
}

interface LegalPageLayoutProps {
  title: string;
  lastUpdated: string;
  effectiveDate: string;
  sections: LegalTocItem[];
  children: ReactNode;
  showToc?: boolean;
}

export default function LegalPageLayout({
  title,
  lastUpdated,
  effectiveDate,
  sections,
  children,
  showToc = true,
}: LegalPageLayoutProps) {
  const [activeId, setActiveId] = useState<string>('');
  const { i18n } = useTranslation();
  const locale = normalizeLegalLocale(i18n.language);
  const localeLabel =
    locale === 'ar' ? 'عربي' : locale === 'fr' ? 'Français' : 'English';

  useEffect(() => {
    if (!showToc) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.target.getBoundingClientRect().top - b.target.getBoundingClientRect().top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: [0, 1] },
    );
    sections.forEach((sec) => {
      const el = document.getElementById(sec.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections, showToc]);

  return (
    <div className="min-h-screen bg-white text-gray-800">
      <style>{`@media print { .legal-no-print { display: none !important; } }`}</style>

      <header className="legal-no-print border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-lg font-extrabold tracking-tight text-[#0F1729]">
              SIGN
            </Link>
            <span className="text-gray-300">/</span>
            <Link
              to="/legal"
              className="flex items-center gap-1 text-sm font-medium text-[#4F6EF7] hover:underline"
            >
              <ChevronLeft size={14} /> Legal Hub
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span
              aria-label="Current language"
              className="rounded border border-gray-200 px-2 py-1 text-xs font-medium text-gray-500"
              title="Use the in-app language switcher to change locale"
            >
              {localeLabel}
            </span>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
            >
              <Printer size={14} /> Print
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-[#0F1729] sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-gray-500">
          Effective: {effectiveDate} &nbsp;|&nbsp; Last Updated: {lastUpdated}
        </p>

        {showToc && sections.length > 0 && (
          <div className="legal-no-print mt-6 md:hidden">
            <select
              aria-label="Jump to section"
              onChange={(e) => {
                const el = document.getElementById(e.target.value);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
              defaultValue=""
            >
              <option value="" disabled>
                Jump to section…
              </option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className={showToc ? 'mt-6 grid grid-cols-1 gap-8 md:grid-cols-[240px_1fr]' : 'mt-6'}>
          {showToc && (
            <aside className="legal-no-print hidden md:block">
              <nav
                aria-label="Table of contents"
                className="sticky top-6 max-h-[calc(100vh-6rem)] overflow-y-auto border-r border-gray-200 pr-4 text-sm"
              >
                <ul className="space-y-1">
                  {sections.map((s) => (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        className={[
                          'block rounded px-2 py-1 transition',
                          activeId === s.id
                            ? 'bg-indigo-50 font-semibold text-[#4F6EF7]'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-[#0F1729]',
                        ].join(' ')}
                      >
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </aside>
          )}

          <main className="min-w-0 leading-relaxed">{children}</main>
        </div>
      </div>

      <footer className="border-t border-gray-200 bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-gray-500 sm:px-6">
          © 2025 SIGN Technologies LLC &nbsp;|&nbsp; Dubai Internet City Free Zone, UAE &nbsp;|&nbsp;{' '}
          <a href="mailto:legal@sign.io" className="text-[#4F6EF7] hover:underline">
            legal@sign.io
          </a>
        </div>
      </footer>
    </div>
  );
}
