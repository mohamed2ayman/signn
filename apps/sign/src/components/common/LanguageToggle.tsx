import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, ChevronDown } from 'lucide-react';
import { cn } from '@/utils/cn';

interface LanguageToggleProps {
  className?: string;
}

type SupportedLang = 'en' | 'ar' | 'fr';

const LANGUAGES: { code: SupportedLang; label: string; short: string; flag: string }[] = [
  { code: 'en', label: 'English', short: 'EN', flag: '🇬🇧' },
  { code: 'ar', label: 'العربية', short: 'عربي', flag: '🇸🇦' },
  { code: 'fr', label: 'Français', short: 'FR', flag: '🇫🇷' },
];

const LanguageToggle: React.FC<LanguageToggleProps> = ({ className }) => {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentCode = (LANGUAGES.find((l) => l.code === i18n.language)?.code ?? 'en') as SupportedLang;
  const current = LANGUAGES.find((l) => l.code === currentCode)!;

  const selectLanguage = (code: SupportedLang) => {
    i18n.changeLanguage(code);
    localStorage.setItem('i18nextLng', code);
    document.documentElement.setAttribute('dir', code === 'ar' ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', code);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={containerRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select language"
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-text shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        <Globe className="h-4 w-4" />
        <span>{current.short}</span>
        <ChevronDown className="h-3 w-3 text-gray-400" />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-50 mt-1 min-w-[140px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {LANGUAGES.map((lang) => (
            <li key={lang.code}>
              <button
                type="button"
                role="option"
                aria-selected={lang.code === currentCode}
                onClick={() => selectLanguage(lang.code)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50',
                  lang.code === currentCode ? 'font-semibold text-primary' : 'text-gray-700',
                )}
              >
                <span aria-hidden>{lang.flag}</span>
                <span>{lang.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default LanguageToggle;
