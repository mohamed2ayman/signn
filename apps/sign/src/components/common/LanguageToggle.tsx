import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { cn } from '@/utils/cn';

interface LanguageToggleProps {
  className?: string;
}

const LanguageToggle: React.FC<LanguageToggleProps> = ({ className }) => {
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'ar' ? 'en' : 'ar';
    i18n.changeLanguage(newLang);
    localStorage.setItem('i18nextLng', newLang);
    document.documentElement.setAttribute('dir', newLang === 'ar' ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', newLang);
  };

  const isArabic = i18n.language === 'ar';

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-text shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/20',
        className,
      )}
      aria-label={isArabic ? 'Switch to English' : 'Switch to Arabic'}
    >
      <Globe className="h-4 w-4" />
      <span>{isArabic ? 'EN' : '\u0639\u0631\u0628\u064A'}</span>
    </button>
  );
};

export default LanguageToggle;
