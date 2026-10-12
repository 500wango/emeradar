import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class names with Tailwind conflict resolution.
 * Lets a caller override a primitive's internal classes via `className`
 * without the two sets of utilities fighting each other.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
