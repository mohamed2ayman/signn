import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import SignLogo from '@/components/common/SignLogo';
import { ManagexMark } from '@/components/common/ManagexLogo';

/**
 * Slim, shell-less public layout for the Guest Portal viewer.
 *
 * Distinct from `AppLayout` (sidebar/topbar shell — wrong for an external,
 * unauthenticated guest) and from the narrow `AuthLayout` card (too small for
 * a full contract). Wide content column, a persistent read-only cue, SIGN
 * branding, and the mandated MANAGEX attribution.
 */
export default function GuestLayout({
  children,
  contractName,
}: {
  children: ReactNode;
  contractName?: string | null;
}) {
  const { t } = useTranslation();
  const manageXUrl = import.meta.env.VITE_MANAGEX_URL || 'http://localhost:5175';
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <SignLogo size="sm" variant="light" />
            {contractName && (
              <span className="hidden min-w-0 items-center gap-1 truncate text-sm text-gray-400 sm:flex">
                <span className="text-gray-300">/</span>
                <span
                  className="truncate text-gray-600"
                  dir="auto"
                  style={{ unicodeBidi: 'plaintext' }}
                >
                  {contractName}
                </span>
              </span>
            )}
          </div>
          <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            {t('guest.readOnlyBadge')}
          </span>
        </div>
      </header>

      {/* Content */}
      <main className="relative flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">{children}</div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 py-5 text-center text-xs text-gray-400">
        <div className="flex items-center justify-center gap-4">
          <span>&copy; {year} SIGN</span>
          <span className="text-gray-300">|</span>
          <div className="inline-flex items-center gap-1.5">
            <span style={{ opacity: 0.7, display: 'inline-flex' }}>
              <ManagexMark size={14} onLight={false} />
            </span>
            <span>{t('guest.poweredBy')}</span>
            <a
              href={manageXUrl}
              className="font-medium text-gray-500 hover:text-gray-700"
            >
              MANAGEX
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
