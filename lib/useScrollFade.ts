import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tracks whether a horizontally-scrollable container has more content hidden to the left/right,
 * so a caller can show a fade edge or a "scroll for more" hint instead of relying on the native
 * scrollbar alone to signal that a table extends further than its card (same pattern as the
 * Correlation heatmap's scroll affordance).
 */
export const useScrollFade = <T extends HTMLElement>(
  // Re-measure whenever content that can change the container's scrollWidth changes (e.g. a
  // table's row count going from 0 while loading to 15 once data lands) - a resize listener alone
  // would miss that, since the viewport itself does not change size.
  deps: unknown[] = []
): {
  ref: React.RefObject<T | null>;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  onScroll: () => void;
} => {
  const ref = useRef<T>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, ...deps]);

  return { ref, canScrollLeft, canScrollRight, onScroll: update };
};
