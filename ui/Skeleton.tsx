import React from 'react';

/**
 * Loading shimmer (§6: skeleton, never a big centred spinner). Shaped like the content it
 * replaces so the first paint already reads as the app rather than as a loading screen.
 */
export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`hev-skeleton rounded ${className}`} aria-hidden="true" />
);

export const SkeletonText: React.FC<{ lines?: number; className?: string }> = ({
  lines = 3,
  className = '',
}) => (
  <div className={`space-y-2 ${className}`} aria-hidden="true">
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
    ))}
  </div>
);

/** Standard placeholder for a table-shaped module while its first fetch is in flight. */
export const SkeletonTable: React.FC<{ rows?: number; className?: string }> = ({
  rows = 6,
  className = '',
}) => (
  <div className={`space-y-2 ${className}`} aria-hidden="true">
    {Array.from({ length: rows }).map((_, i) => (
      <Skeleton key={i} className="h-11 w-full rounded-lg" />
    ))}
  </div>
);

export const SkeletonCards: React.FC<{ count?: number; className?: string }> = ({
  count = 4,
  className = '',
}) => (
  <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 ${className}`} aria-hidden="true">
    {Array.from({ length: count }).map((_, i) => (
      <Skeleton key={i} className="h-24 rounded-[14px]" />
    ))}
  </div>
);
