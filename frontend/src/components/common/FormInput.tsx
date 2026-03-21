import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/utils/cn';

interface FormInputProps {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  error?: string;
  required?: boolean;
  icon?: React.ReactNode;
  disabled?: boolean;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  className?: string;
}

const FormInput: React.FC<FormInputProps> = ({
  label,
  name,
  type = 'text',
  placeholder,
  error,
  required = false,
  icon,
  disabled = false,
  value,
  onChange,
  onBlur,
  autoComplete,
  className,
}) => {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);

  const isPassword = type === 'password';
  const inputType = isPassword && showPassword ? 'text' : type;

  return (
    <div className={cn('mb-4', className)}>
      <label
        htmlFor={name}
        className="mb-1.5 block text-sm font-medium text-text"
      >
        {t(label)}
        {required && (
          <span className="text-danger ltr:ml-1 rtl:mr-1">*</span>
        )}
      </label>
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-gray-400 ltr:left-3 rtl:right-3">
            {icon}
          </span>
        )}
        <input
          id={name}
          name={name}
          type={inputType}
          placeholder={placeholder ? t(placeholder) : undefined}
          disabled={disabled}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          autoComplete={autoComplete}
          className={cn(
            'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-text transition-colors',
            'placeholder:text-gray-400',
            'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
            'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500',
            icon && 'ltr:pl-10 rtl:pr-10',
            isPassword && 'ltr:pr-10 rtl:pl-10',
            error && 'border-danger focus:border-danger focus:ring-danger/20',
          )}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 ltr:right-3 rtl:left-3"
            tabIndex={-1}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
      {error && (
        <p className="mt-1 text-sm text-danger">{t(error)}</p>
      )}
    </div>
  );
};

export default FormInput;
