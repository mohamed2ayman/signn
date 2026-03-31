import React from 'react';
import { cn } from '@/utils/cn';
import LoadingSpinner from '@/components/common/LoadingSpinner';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
}

const variantClasses: Record<string, string> = {
  primary:
    'bg-primary text-white hover:bg-primary-600 focus:ring-primary-500',
  secondary:
    'bg-secondary text-white hover:bg-secondary-600 focus:ring-secondary-500',
  outline:
    'border border-primary text-primary bg-transparent hover:bg-primary hover:text-white focus:ring-primary-500',
  danger:
    'bg-danger text-white hover:bg-red-700 focus:ring-red-500',
};

const sizeClasses: Record<string, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
};

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  fullWidth = false,
  disabled,
  children,
  className,
  type = 'button',
  ...props
}) => {
  const isDisabled = disabled || isLoading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        isDisabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      {...props}
    >
      {isLoading && (
        <LoadingSpinner
          size="sm"
          color={variant === 'outline' ? '#0B7ABC' : '#FFFFFF'}
          className="ltr:mr-2 rtl:ml-2"
        />
      )}
      {children}
    </button>
  );
};

export default Button;
