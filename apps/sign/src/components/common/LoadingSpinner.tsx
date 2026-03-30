import React from 'react';
import { cn } from '@/utils/cn';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  className?: string;
}

const sizeClasses: Record<string, string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-[3px]',
  lg: 'h-12 w-12 border-4',
};

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  color,
  className,
}) => {
  return (
    <div
      className={cn(
        'animate-spin rounded-full border-solid border-t-transparent',
        sizeClasses[size],
        className,
      )}
      style={{
        borderColor: color || undefined,
        borderTopColor: 'transparent',
      }}
      role="status"
      aria-label="Loading"
    >
      {!color && (
        <style>{`
          .spinner-default {
            border-color: #0B7ABC;
            border-top-color: transparent;
          }
        `}</style>
      )}
      <span className="sr-only">Loading...</span>
    </div>
  );
};

// Simplified version that uses Tailwind color classes directly
const LoadingSpinnerStyled: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  className,
}) => {
  return (
    <div
      className={cn(
        'animate-spin rounded-full border-primary border-solid border-t-transparent',
        sizeClasses[size],
        className,
      )}
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
};

export { LoadingSpinnerStyled };
export default LoadingSpinner;
