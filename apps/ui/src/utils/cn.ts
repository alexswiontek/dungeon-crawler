import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS classes with automatic conflict resolution
 * Combines clsx for conditional classes with twMerge for Tailwind deduplication
 *
 * @example
 * cn('px-4 py-2', isActive && 'bg-primary text-white')
 * → 'px-4 py-2 bg-primary text-white'
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
