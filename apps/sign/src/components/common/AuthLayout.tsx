import React from 'react';
import { useTranslation } from 'react-i18next';
import LanguageToggle from '@/components/common/LanguageToggle';
import SignLogo from '@/components/common/SignLogo';

interface AuthLayoutProps {
  children: React.ReactNode;
  title?: string;
}

const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();

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
              A <a href="http://localhost:5175" className="sign-parent-link">MANAGEX</a> product
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
            <svg width="14" height="14" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.7 }} aria-hidden="true">
              <rect x="0" y="0" width="22" height="22" rx="5" fill="#0D1829" stroke="#1E3A5F" strokeWidth="0.6"/>
              <rect x="4.5" y="5" width="2.2" height="12" rx="1" fill="white"/>
              <rect x="9.9" y="5" width="2.2" height="12" rx="1" fill="white"/>
              <rect x="15.3" y="5" width="2.2" height="12" rx="1" fill="white"/>
              <path d="M4.5 5 L11 9.5" stroke="#00D4FF" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M17.5 5 L11 9.5" stroke="#00D4FF" strokeWidth="1.3" strokeLinecap="round"/>
              <circle cx="11" cy="9.5" r="1.4" fill="#00D4FF"/>
            </svg>
            <span>Powered by</span>
            <a href="http://localhost:5175" className="managex-attribution-link">MANAGEX</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default AuthLayout;
