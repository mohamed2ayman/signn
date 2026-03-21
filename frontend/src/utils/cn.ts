import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility function to merge Tailwind CSS classes with clsx.
 * Combines clsx for conditional class names with tailwind-merge
 * for intelligent Tailwind class deduplication.
 *
 * @example
 * cn('px-4 py-2', isActive && 'bg-primary', className)
 * cn('text-sm font-medium', { 'text-red-500': hasError })
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
