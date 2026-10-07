import { useEffect, useRef, useState } from 'react';

import type { Cart } from '@entities/cart';

const mobileSummaryQuery = '(max-width: 1023px)';

function getSummaryJumpState(summaryHeading: HTMLElement) {
  const navigation = document
    .querySelector<HTMLAnchorElement>('nav a[href="/cart"]')
    ?.closest<HTMLElement>('nav');
  const visibleViewportBottom = navigation?.getBoundingClientRect().top ?? window.innerHeight;

  return {
    isBelowViewport: summaryHeading.getBoundingClientRect().top >= visibleViewportBottom,
    isMobile: window.matchMedia?.(mobileSummaryQuery).matches ?? false,
  };
}

export function useCartSummaryJump(cart: Cart | undefined) {
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null);
  const summaryJumpFrameRef = useRef<number | null>(null);
  const [isSummaryJumpVisible, setIsSummaryJumpVisible] = useState(false);

  useEffect(() => {
    const summaryHeading = summaryHeadingRef.current;
    if (!summaryHeading || !cart || cart.items.length === 0) {
      setIsSummaryJumpVisible(false);
      return;
    }

    const update = () => {
      const state = getSummaryJumpState(summaryHeading);
      setIsSummaryJumpVisible(state.isMobile && state.isBelowViewport);
    };
    const schedule = () => {
      if (summaryJumpFrameRef.current !== null) return;
      summaryJumpFrameRef.current = requestAnimationFrame(() => {
        summaryJumpFrameRef.current = null;
        update();
      });
    };
    const mobileMedia = window.matchMedia?.(mobileSummaryQuery);
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(schedule, { threshold: 0 });

    observer?.observe(summaryHeading);
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    mobileMedia?.addEventListener('change', schedule);
    return () => {
      observer?.disconnect();
      const pendingFrame = summaryJumpFrameRef.current;
      if (pendingFrame !== null) {
        cancelAnimationFrame(pendingFrame);
        if (summaryJumpFrameRef.current === pendingFrame) summaryJumpFrameRef.current = null;
      }
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      mobileMedia?.removeEventListener('change', schedule);
    };
  }, [cart]);

  const focusOrderSummary = () => {
    const summaryHeading = summaryHeadingRef.current;
    if (!summaryHeading) return;
    summaryHeading.focus({ preventScroll: true });
    summaryHeading.scrollIntoView?.({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  return { focusOrderSummary, isSummaryJumpVisible, summaryHeadingRef };
}
