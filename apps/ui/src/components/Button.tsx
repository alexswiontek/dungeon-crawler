import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/utils/cn';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'unstyled';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = 'default', className, ...props }, ref) {
    if (variant === 'unstyled') {
      return <button ref={ref} className={className} {...props} />;
    }

    return (
      <button
        ref={ref}
        className={cn(
          'font-inherit text-base px-5 py-2.5',
          'bg-secondary text-[#e5e7eb]',
          'border-2 border-tertiary',
          'cursor-pointer transition-all duration-200',
          'hover:enabled:bg-tertiary hover:enabled:border-accent',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      />
    );
  },
);
