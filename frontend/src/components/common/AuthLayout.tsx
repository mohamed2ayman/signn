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
        &copy; {currentYear} {t('app.copyright')}
      </footer>
    </div>
  );
};

export default AuthLayout;
