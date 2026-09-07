import { useCallback, useRef } from 'react';

/**
 * Drag-to-pan + wheel-to-pan for a chart whose content is wider than its container (Poin 1 -
 * "chart yang datanya panjang harus bisa digeser/scroll horizontal"). Attach `containerRef` (a
 * callback ref, not a plain ref object - see below) to the outer `overflow-x-auto` wrapper, and
 * spread `containerHandlers` onto it for drag; the browser's own native scrollbar/touch-swipe
 * already handles panning, this only adds two things it doesn't give for free:
 *  - a plain vertical mouse wheel pans horizontally (these charts never scroll vertically, so
 *    there's nothing to lose by remapping deltaY -> scrollLeft), and
 *  - click-drag panning for mouse users on a track/laptop pad without a horizontal wheel.
 *
 * Wheel is wired as a native `addEventListener('wheel', ..., { passive: false })` on mount,
 * rather than a JSX `onWheel` prop (round 2 bug fix - "drag/geser tidak jalan"): confirmed live
 * in-browser that React's synthetic onWheel handler was never invoked at all on this element,
 * while a plain native listener on the exact same node fired correctly on every wheel tick -
 * React delegates "wheel" as a passive root listener, and that passivity apparently extends to
 * dropping the synthetic dispatch here rather than merely neutering preventDefault() the way it's
 * more commonly documented to. `containerRef` is therefore a CALLBACK ref (attaches/detaches the
 * native listener exactly when the DOM node mounts/unmounts) instead of a plain ref object - a
 * plain object + `useEffect` would only attach once on this hook instance's first mount, missing
 * every caller here (LineChart, DualAxisAreaChart, the equity curve) that can render its "not
 * enough data yet" placeholder first and mount the real scrollable node only once data arrives.
 *
 * `isDragging()` lets a caller suppress its own hover/crosshair updates while a drag is in
 * progress, so panning doesn't fight with a tooltip trying to follow the same pointer.
 *
 * CoinGlass parity ROUND 3 lampiran (macOS trackpad gestures - "drag hanya di plot" bocor di
 * MacBook meski lolos di testing pakai mouse biasa): two real trackpad-specific conflicts, both
 * fixed here so every caller (LineChart, DualAxisAreaChart) gets them for free, scoped tightly to
 * this container only:
 *  - Two-finger horizontal swipe on macOS Safari/Chrome is the OS/browser's own "back/forward"
 *    gesture. Panning this chart to its edge (nothing left to scroll) makes the browser more
 *    likely to steal that swipe as page navigation instead of stopping the pan.
 *    `overscroll-behavior-x: contain` (set directly on the node here, not via a caller's own
 *    className, so it never has to be remembered per call site) stops that hand-off without
 *    touching vertical page scroll once the cursor leaves this element.
 *  - Trackpad pinch is `wheel` + `ctrlKey: true` (a synthetic flag) in Chrome/Firefox, but native
 *    `gesturestart`/`gesturechange`/`gestureend` in Safari (WebKit-only, no standard DOM type -
 *    hence the `Event` + cast below). Neither this chart nor the page has a real pinch-zoom
 *    handler (yet), so both are prevented here as a safety net - without it, a pinch meant for the
 *    chart zooms the whole browser page instead, which is exactly the "kartu dan halaman diam"
 *    requirement this hook exists to uphold.
 */
export function useHorizontalChartScroll<T extends HTMLElement>() {
  const nodeRef = useRef<T | null>(null);
  const detachWheel = useRef<(() => void) | null>(null);
  const drag = useRef<{ startX: number; startScrollLeft: number; dragging: boolean } | null>(null);

  const canScroll = useCallback(() => {
    const el = nodeRef.current;
    return Boolean(el && el.scrollWidth - el.clientWidth > 1);
  }, []);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      // Chrome/Firefox trackpad pinch arrives as a wheel event with ctrlKey true - block it here
      // regardless of scrollability so pinching over this chart never zooms the whole page.
      if (e.ctrlKey) {
        e.preventDefault();
        return;
      }
      const el = nodeRef.current;
      if (!el || !canScroll()) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // already a horizontal gesture, let the browser handle it
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    },
    [canScroll]
  );

  // Safari-only pinch gesture events - no standard DOM type exists for these (WebKit API), so the
  // handler is typed as a plain `Event` and cast when registering.
  const handleGesture = useCallback((e: Event) => {
    e.preventDefault();
  }, []);

  const containerRef = useCallback(
    (node: T | null) => {
      detachWheel.current?.();
      detachWheel.current = null;
      nodeRef.current = node;
      if (node) {
        node.style.overscrollBehaviorX = 'contain';
        node.addEventListener('wheel', handleWheel, { passive: false });
        node.addEventListener('gesturestart', handleGesture as EventListener, { passive: false });
        node.addEventListener('gesturechange', handleGesture as EventListener, { passive: false });
        detachWheel.current = () => {
          node.removeEventListener('wheel', handleWheel);
          node.removeEventListener('gesturestart', handleGesture as EventListener);
          node.removeEventListener('gesturechange', handleGesture as EventListener);
        };
      }
    },
    [handleWheel, handleGesture]
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = nodeRef.current;
    if (!el || el.scrollWidth - el.clientWidth <= 1) return;
    drag.current = { startX: e.clientX, startScrollLeft: el.scrollLeft, dragging: false };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const el = nodeRef.current;
    const state = drag.current;
    if (!el || !state || e.buttons !== 1) return;
    const dx = e.clientX - state.startX;
    if (!state.dragging && Math.abs(dx) < 4) return;
    state.dragging = true;
    el.scrollLeft = state.startScrollLeft - dx;
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  return {
    containerRef,
    canScroll,
    isDragging: () => drag.current?.dragging ?? false,
    containerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerLeave: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
