import React from 'react';
import { useTranslation } from 'react-i18next';
import LanguageToggle from '@/components/common/LanguageToggle';
import SignLogo from '@/components/common/SignLogo';
import { ManagexMark } from '@/components/common/ManagexLogo';

interface AuthLayoutProps {
  children: React.ReactNode;
  title?: string;
}

const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();
  const manageXUrl = import.meta.env.VITE_MANAGEX_URL || 'http://localhost:5175';

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Subtle background pattern */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-48 right-0 h-96 w-96 rounded-full bg-[#4F6EF7]/[0.04] blur-3xl" />
        <div className="absolute -bottom-48 left-0 h-96 w-96 rounded-full bg-[#4F6EF7]/[0.03] blur-3xl" />
      </div>

      {/* Language toggle */}
      <div className="absolute top-4 ltr:right-4 rtl:left-4 z-10">
        <LanguageToggle />
      </div>

      {/* Main content */}
      <div className="relative flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="mb-8 flex flex-col items-center text-center">
            <SignLogo size="lg" variant="light" />
            <div className="sign-parent-tag">
              A <a href={manageXUrl} className="sign-parent-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', verticalAlign: 'middle' }}><ManagexMark size={13} onLight={true} />MANAGEX</a> product
            </div>
            <p className="mt-3 text-sm text-gray-400">
              {t('app.tagline')}
            </p>
          </div>

          {/* Card */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-8 shadow-elevated">
            {children}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="relative py-4 text-center text-xs text-gray-400">
        <div className="flex items-center justify-center gap-4">
          <span>&copy; {currentYear} {t('app.copyright')}</span>
          <span className="text-gray-300">|</span>
          <div className="managex-attribution">
            <span style={{ opacity: 0.7, display: 'inline-flex' }}>
              <ManagexMark size={14} onLight={false} />
            </span>
            <span>Powered by</span>
            <a href={manageXUrl} className="managex-attribution-link">MANAGEX</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default AuthLayout;
