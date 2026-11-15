import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';

const isTestEnv = import.meta.env.MODE === 'test';

function findSquishTarget(x: number, y: number): HTMLElement | null {
  if (typeof document.elementFromPoint !== 'function') return null;
  const hit = document.elementFromPoint(x, y);
  if (!(hit instanceof Element)) return null;
  if (hit.closest('[data-testid^="drag-handle-"]')) return null;
  const target = hit.closest('.liquid-squish-target');
  return target instanceof HTMLElement ? target : null;
}

/**
 * Global non-blocking touch/pointer feedback layer:
 * 1. Uses passive native touch events (touchstart/touchmove/touchend) so native
 *    scrolling never cancels the finger-following 180px aura via pointercancel.
 * 2. Preserves mouse/pen tracking via pointerdown/pointermove/pointerup.
 * 3. Drives GPU-composited .is-liquid-squished CSS class toggling on isolated
 *    .liquid-squish-target inner wrappers via elementFromPoint inside rAF.
 */
export function GlobalTouchAura() {
  const prefersReducedMotion = useReducedMotion();
  const isDisabled = isTestEnv || Boolean(prefersReducedMotion);

  const posRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);

  const isTouchActiveRef = useRef(false);
  const isMouseDownRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const activeSquishElRef = useRef<HTMLElement | null>(null);

  const latestTouchPointRef = useRef<{ x: number; y: number } | null>(null);
  const latestPointerPointRef = useRef<{
    x: number;
    y: number;
    pointerId: number;
  } | null>(null);
  const lastHitTestRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const touchRafRef = useRef<number | null>(null);
  const pointerRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (isDisabled) return;

    const setSquishElement = (nextEl: HTMLElement | null) => {
      const prevEl = activeSquishElRef.current;
      if (prevEl === nextEl) return;

      if (prevEl) {
        prevEl.classList.remove('is-liquid-squished');
      }
      if (nextEl) {
        nextEl.classList.add('is-liquid-squished');
      }

      activeSquishElRef.current = nextEl;
    };

    const hitTestImmediately = (x: number, y: number) => {
      lastHitTestRef.current = { x, y, time: performance.now() };
      setSquishElement(findSquishTarget(x, y));
    };

    const hitTestThrottled = (x: number, y: number) => {
      const now = performance.now();
      const last = lastHitTestRef.current;
      if (last) {
        const dx = x - last.x;
        const dy = y - last.y;
        if (dx * dx + dy * dy <= 36 || now - last.time <= 32) {
          return;
        }
      }
      lastHitTestRef.current = { x, y, time: now };
      setSquishElement(findSquishTarget(x, y));
    };

    const showAuraAt = (x: number, y: number) => {
      if (posRef.current) {
        posRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      if (haloRef.current) {
        haloRef.current.style.opacity = '1';
        haloRef.current.style.transform = 'scale(1)';
      }
    };

    const hideAura = () => {
      if (haloRef.current) {
        haloRef.current.style.opacity = '0';
        haloRef.current.style.transform = 'scale(0.65)';
      }
    };

    /* --- Native Passive Touch Listeners (immune to pointercancel during scroll) --- */
    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;

      isTouchActiveRef.current = true;
      isMouseDownRef.current = false;
      activePointerIdRef.current = null;
      latestTouchPointRef.current = { x: touch.clientX, y: touch.clientY };

      showAuraAt(touch.clientX, touch.clientY);
      hitTestImmediately(touch.clientX, touch.clientY);
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;

      isTouchActiveRef.current = true;
      latestTouchPointRef.current = { x: touch.clientX, y: touch.clientY };

      if (touchRafRef.current !== null) return;
      touchRafRef.current = requestAnimationFrame(() => {
        touchRafRef.current = null;
        const latest = latestTouchPointRef.current;
        if (!latest || !isTouchActiveRef.current) return;

        showAuraAt(latest.x, latest.y);
        hitTestThrottled(latest.x, latest.y);
      });
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length > 0) return;

      isTouchActiveRef.current = false;
      latestTouchPointRef.current = null;
      lastHitTestRef.current = null;
      if (touchRafRef.current !== null) {
        cancelAnimationFrame(touchRafRef.current);
        touchRafRef.current = null;
      }

      hideAura();
      setSquishElement(null);
    };

    /* --- Mouse / Stylus Pointer Listeners --- */
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      if (isTouchActiveRef.current) return;

      isMouseDownRef.current = true;
      activePointerIdRef.current = event.pointerId;
      showAuraAt(event.clientX, event.clientY);
      hitTestImmediately(event.clientX, event.clientY);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      if (isTouchActiveRef.current) return;

      latestPointerPointRef.current = {
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
      };

      if (pointerRafRef.current !== null) return;
      pointerRafRef.current = requestAnimationFrame(() => {
        pointerRafRef.current = null;
        const latest = latestPointerPointRef.current;
        if (!latest || isTouchActiveRef.current) return;

        if (
          isMouseDownRef.current &&
          activePointerIdRef.current === latest.pointerId &&
          posRef.current
        ) {
          posRef.current.style.transform = `translate3d(${latest.x}px, ${latest.y}px, 0)`;
        }

        hitTestThrottled(latest.x, latest.y);
      });
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      if (
        activePointerIdRef.current !== null &&
        event.pointerId !== activePointerIdRef.current
      ) {
        return;
      }

      isMouseDownRef.current = false;
      activePointerIdRef.current = null;
      lastHitTestRef.current = null;
      hideAura();
      setSquishElement(null);
    };

    const handleMouseLeave = () => {
      if (isTouchActiveRef.current) return;
      isMouseDownRef.current = false;
      activePointerIdRef.current = null;
      lastHitTestRef.current = null;
      hideAura();
      setSquishElement(null);
    };

    const handleWindowBlur = () => {
      isTouchActiveRef.current = false;
      isMouseDownRef.current = false;
      activePointerIdRef.current = null;
      latestTouchPointRef.current = null;
      latestPointerPointRef.current = null;
      lastHitTestRef.current = null;
      hideAura();
      setSquishElement(null);
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    window.addEventListener('pointerdown', handlePointerDown, { passive: true });
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerEnd, { passive: true });
    window.addEventListener('pointercancel', handlePointerEnd, { passive: true });

    window.addEventListener('blur', handleWindowBlur, { passive: true });
    document.addEventListener('pointerleave', handleMouseLeave, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);

      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);

      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('pointerleave', handleMouseLeave);

      if (touchRafRef.current !== null) {
        cancelAnimationFrame(touchRafRef.current);
      }
      if (pointerRafRef.current !== null) {
        cancelAnimationFrame(pointerRafRef.current);
      }
      setSquishElement(null);
    };
  }, [isDisabled]);

  if (isDisabled) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="global-touch-aura"
      className="fixed inset-0 pointer-events-none z-[60] overflow-hidden"
    >
      <div
        ref={posRef}
        className="fixed left-0 top-0 will-change-transform"
        style={{ transform: 'translate3d(-9999px, -9999px, 0)' }}
      >
        <div
          ref={haloRef}
          className="-ml-[90px] -mt-[90px] h-[180px] w-[180px] rounded-full will-change-[transform,opacity]"
          style={{
            background: 'var(--touch-aura-gradient)',
            filter: 'blur(14px)',
            opacity: 0,
            transform: 'scale(0.65)',
            transition:
              'opacity 75ms cubic-bezier(0.22, 1, 0.36, 1), transform 75ms ease-out',
          }}
        />
      </div>
    </div>
  );
}
