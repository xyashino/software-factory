import type { ComponentProps } from 'react';
import { cn } from './cn';

export const Skeleton = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    aria-hidden="true"
    className={cn('animate-pulse rounded-md bg-muted', className)}
    {...props}
  />
);
