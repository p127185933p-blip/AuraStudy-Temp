import type { Transition, Variants } from 'framer-motion';

/**
 * Viewport-relative trigger bounding box center & dimensions
 * captured from a clicked button or timeline card.
 */
export interface LaunchOrigin {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpatialDelta {
  deltaX: number;
  deltaY: number;
}

/**
 * Captures the viewport center point and dimensions of a trigger element.
 * Returns null in non-DOM/JSDOM zero-rect environments so callers safely fall back
 * to centered modal expansion.
 */
export function captureOriginRect(
  target: Element | EventTarget | null | undefined,
): LaunchOrigin | null {
  if (!(target instanceof Element)) return null;
  const rect = target.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
  };
}

export const CaptureOriginRect = captureOriginRect;

export function computeSpatialDelta(origin: LaunchOrigin | null | undefined): SpatialDelta | null {
  if (!origin || typeof window === 'undefined') return null;
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  return {
    deltaX: Math.round(origin.x - centerX),
    deltaY: Math.round(origin.y - centerY),
  };
}

/**
 * Calibrated ~300ms Q-Bounce Spring Physics Presets
 * Strictly drives GPU-composited properties (transform, opacity).
 */
export const LIQUID_SPRING_DEFAULT: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 23,
  mass: 0.9,
};

export const LIQUID_SPRING_BOUNCY: Transition = {
  type: 'spring',
  stiffness: 360,
  damping: 19,
  mass: 0.85,
};

export const LIQUID_SPRING_SHEET: Transition = {
  type: 'spring',
  stiffness: 280,
  damping: 25,
  mass: 0.95,
};

/**
 * Critically damped morph spring (bounce: 0) so orb <-> panel container transforms
 * never overshoot into sharp rectangular corners.
 */
export const LIQUID_SPRING_MORPH: Transition = {
  type: 'spring',
  stiffness: 340,
  damping: 32,
  mass: 0.9,
  bounce: 0,
};

/**
 * Tactile squish spring for cards, glass panels, and filter pills.
 */
export const LIQUID_SPRING_SQUISH: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 22,
};

export const MODAL_BACKDROP_VARIANTS: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.16, ease: [0.4, 0, 1, 1] },
  },
};

export const MODAL_PANEL_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.94,
    y: 12,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: LIQUID_SPRING_DEFAULT,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 8,
    transition: { duration: 0.16, ease: [0.4, 0, 1, 1] },
  },
};

/**
 * Spatial Origin Expansion Variants:
 * Launches Layer-3 modal from the clicked trigger's (deltaX, deltaY) offset
 * and collapses smoothly back into the exact same vector on exit.
 */
export const SPATIAL_MODAL_VARIANTS: Variants = {
  hidden: (delta: SpatialDelta | null) =>
    delta
      ? {
          x: delta.deltaX,
          y: delta.deltaY,
          scale: 0.14,
          opacity: 0.25,
        }
      : {
          x: 0,
          y: 12,
          scale: 0.94,
          opacity: 0,
        },
  visible: {
    x: 0,
    y: 0,
    scale: 1,
    opacity: 1,
    transition: LIQUID_SPRING_DEFAULT,
  },
  exit: (delta: SpatialDelta | null) =>
    delta
      ? {
          x: delta.deltaX,
          y: delta.deltaY,
          scale: 0.14,
          opacity: 0,
          transition: { duration: 0.24, ease: [0.32, 0.72, 0, 1] },
        }
      : {
          x: 0,
          y: 8,
          scale: 0.94,
          opacity: 0,
          transition: { duration: 0.16, ease: [0.4, 0, 1, 1] },
        },
};

export const SHEET_PANEL_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.94,
    y: 18,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: LIQUID_SPRING_SHEET,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 14,
    transition: { duration: 0.16, ease: [0.4, 0, 1, 1] },
  },
};

export const POPOVER_VARIANTS: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.94,
    y: -6,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: LIQUID_SPRING_DEFAULT,
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: -4,
    transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
  },
};

export const TIMELINE_SLIDE_VARIANTS: Variants = {
  enter: (direction: number) => ({
    opacity: 0,
    x: direction === 0 ? 0 : direction > 0 ? 32 : -32,
  }),
  center: {
    opacity: 1,
    x: 0,
    transition: LIQUID_SPRING_DEFAULT,
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction === 0 ? 0 : direction > 0 ? -24 : 24,
    transition: { duration: 0.16, ease: [0.4, 0, 1, 1] },
  }),
};
