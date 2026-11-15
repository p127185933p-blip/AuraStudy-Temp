import {
  forwardRef,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type HTMLMotionProps,
} from 'framer-motion';
import {
  CaptureOriginRect,
  LIQUID_SPRING_BOUNCY,
  LIQUID_SPRING_DEFAULT,
  MODAL_BACKDROP_VARIANTS,
  MODAL_PANEL_VARIANTS,
  SPATIAL_MODAL_VARIANTS,
  captureOriginRect,
  computeSpatialDelta,
  type LaunchOrigin,
} from '@/styles/motion';

export { CaptureOriginRect, captureOriginRect, type LaunchOrigin };

const isTestEnv = import.meta.env.MODE === 'test';

export type GlassLayer = 1 | 2 | 3;

const LAYER_CLASS_MAP: Record<GlassLayer, string> = {
  1: 'glass-layer-1',
  2: 'glass-layer-2',
  3: 'glass-layer-3',
};

/**
 * Fixed full-viewport Dawn Apricot & Serene Sea Blue Aurora Backdrop.
 */
export function AmbientAuroraBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-10 pointer-events-none overflow-hidden"
      style={{ background: 'var(--aurora-base-gradient)' }}
    >
      {/* Dawn Warm Apricot Diffused Glow (top-left) */}
      <motion.div
        className="absolute -left-[12%] -top-[14%] h-[62vw] w-[62vw] max-h-[680px] max-w-[680px] min-h-[320px] min-w-[320px] rounded-full will-change-transform"
        style={{ background: 'var(--aurora-orb-1)' }}
        animate={{ x: [0, 24, -10, 0], y: [0, 16, -12, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Serene Sea Blue Diffused Glow (top-right / mid-right) */}
      <motion.div
        className="absolute -right-[14%] top-[8%] h-[68vw] w-[68vw] max-h-[760px] max-w-[760px] min-h-[340px] min-w-[340px] rounded-full will-change-transform"
        style={{ background: 'var(--aurora-orb-2)' }}
        animate={{ x: [0, -26, 12, 0], y: [0, -18, 16, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Horizon Mist Blend (bottom-center) */}
      <motion.div
        className="absolute -bottom-[20%] left-[18%] h-[58vw] w-[66vw] max-h-[640px] max-w-[760px] min-h-[280px] min-w-[320px] rounded-full will-change-transform"
        style={{ background: 'var(--aurora-orb-3)' }}
        animate={{ x: [0, 18, -16, 0], y: [0, -14, 10, 0] }}
        transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

export interface LiquidSurfaceProps extends HTMLMotionProps<'div'> {
  layer?: GlassLayer;
  sheen?: boolean;
  interactive?: boolean;
  squish?: boolean;
  children?: ReactNode;
}

export const LiquidSurface = forwardRef<HTMLDivElement, LiquidSurfaceProps>(
  function LiquidSurface(
    {
      layer = 2,
      sheen: _sheen = false,
      interactive = false,
      squish = interactive,
      className = '',
      children,
      whileHover,
      whileTap,
      transition,
      ...rest
    },
    ref,
  ) {
    const useSquish = Boolean(squish);

    if (useSquish) {
      return (
        <motion.div
          ref={ref}
          className="relative"
          whileHover={whileHover}
          whileTap={whileTap}
          transition={
            transition ??
            (interactive ? LIQUID_SPRING_BOUNCY : LIQUID_SPRING_DEFAULT)
          }
          {...rest}
        >
          <div
            data-liquid-squish="true"
            className={`liquid-squish-target relative ${LAYER_CLASS_MAP[layer]} ${className}`}
          >
            {children}
          </div>
        </motion.div>
      );
    }

    return (
      <motion.div
        ref={ref}
        className={`relative ${LAYER_CLASS_MAP[layer]} ${className}`}
        whileHover={
          interactive ? (whileHover ?? { scale: 1.015 }) : whileHover
        }
        whileTap={
          interactive ? (whileTap ?? { scale: 0.955 }) : whileTap
        }
        transition={
          transition ??
          (interactive ? LIQUID_SPRING_BOUNCY : LIQUID_SPRING_DEFAULT)
        }
        {...rest}
      >
        {children}
      </motion.div>
    );
  },
);

export interface LiquidButtonProps extends HTMLMotionProps<'button'> {
  sheen?: boolean;
  glassLayer?: GlassLayer | 'none';
  bounce?: boolean;
  squish?: boolean;
  children?: ReactNode;
}

export const LiquidButton = forwardRef<HTMLButtonElement, LiquidButtonProps>(
  function LiquidButton(
    {
      type = 'button',
      sheen: _sheen = false,
      glassLayer = 'none',
      bounce = true,
      squish = false,
      disabled = false,
      className = '',
      children,
      whileHover,
      whileTap,
      transition,
      ...rest
    },
    ref,
  ) {
    const layerClass = glassLayer === 'none' ? '' : LAYER_CLASS_MAP[glassLayer];
    const useSquish = Boolean(squish && !disabled);

    if (squish) {
      return (
        <button
          ref={ref}
          type={type}
          disabled={disabled}
          data-liquid-squish={useSquish ? 'true' : undefined}
          className={`relative ${useSquish ? 'liquid-squish-target' : ''} ${layerClass} ${className}`}
          {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
        >
          {children}
        </button>
      );
    }

    return (
      <motion.button
        ref={ref}
        type={type}
        disabled={disabled}
        className={`relative ${layerClass} ${className}`}
        whileHover={
          !disabled && bounce
            ? (whileHover ?? { scale: 1.015 })
            : whileHover
        }
        whileTap={
          !disabled && bounce
            ? (whileTap ?? { scale: 0.955 })
            : whileTap
        }
        transition={transition ?? LIQUID_SPRING_BOUNCY}
        {...rest}
      >
        {children}
      </motion.button>
    );
  },
);

export interface LiquidModalBackdropProps extends HTMLMotionProps<'div'> {
  children: ReactNode;
}

export function LiquidModalBackdrop({
  className = '',
  children,
  ...rest
}: LiquidModalBackdropProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={MODAL_BACKDROP_VARIANTS}
      className={`fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[4px] sm:items-center sm:p-4 ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export interface LiquidModalPanelProps extends HTMLMotionProps<'div'> {
  children: ReactNode;
}

export function LiquidModalPanel({
  className = '',
  children,
  ...rest
}: LiquidModalPanelProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={MODAL_PANEL_VARIANTS}
      className={`glass-layer-3 flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-[var(--radius-xl)] sm:rounded-[var(--radius-xl)] ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export interface SpatialMorphModalProps {
  isOpen: boolean;
  onClose: () => void;
  origin?: LaunchOrigin | null;
  panelClassName?: string;
  backdropClassName?: string;
  ariaLabelledBy?: string;
  ariaLabel?: string;
  dataTestId?: string;
  children: ReactNode;
}

/**
 * Spatial Origin Expansion Modal:
 * Launches a Layer-3 Liquid Glass modal from the clicked trigger's viewport
 * coordinates (deltaX, deltaY) with ~310ms spring expansion and collapses back
 * into the exact origin vector on exit. Gracefully degrades to centered scale
 * when no click origin is available (e.g. keyboard shortcuts or tests).
 */
export function SpatialMorphModal({
  isOpen,
  onClose,
  origin,
  panelClassName = '',
  backdropClassName = '',
  ariaLabelledBy,
  ariaLabel,
  dataTestId,
  children,
}: SpatialMorphModalProps) {
  const prefersReducedMotion = useReducedMotion();
  const lastOriginRef = useRef<LaunchOrigin | null>(null);

  if (isOpen) {
    lastOriginRef.current = origin ?? null;
  }

  const effectiveOrigin = isOpen ? (origin ?? null) : lastOriginRef.current;
  const spatialDelta = prefersReducedMotion
    ? null
    : computeSpatialDelta(effectiveOrigin);

  if (isTestEnv) {
    if (!isOpen) return null;
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel}
        data-testid={dataTestId}
        onClick={onClose}
        className={`fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-[4px] sm:p-4 ${backdropClassName}`}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className={`glass-layer-3 flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-[var(--radius-xl)] ${panelClassName}`}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <AnimatePresence custom={spatialDelta}>
      {isOpen && (
        <motion.div
          key="spatial-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby={ariaLabelledBy}
          aria-label={ariaLabel}
          data-testid={dataTestId}
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={MODAL_BACKDROP_VARIANTS}
          onClick={onClose}
          className={`fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-[4px] sm:p-4 ${backdropClassName}`}
        >
          <motion.div
            key="spatial-modal-panel"
            custom={spatialDelta}
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={SPATIAL_MODAL_VARIANTS}
            transformTemplate={(_, generated) =>
              generated && generated !== 'none'
                ? `${generated} translateZ(0)`
                : 'translateZ(0)'
            }
            style={{
              contain: 'layout style',
              boxShadow: 'var(--glass-layer-3-shadow)',
            }}
            onClick={(e) => e.stopPropagation()}
            className={`relative flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-[var(--radius-xl)] will-change-transform ${panelClassName}`}
          >
            <div
              aria-hidden="true"
              className="glass-layer-3 pointer-events-none absolute inset-0 z-0 rounded-[inherit]"
              style={{ boxShadow: 'none', transform: 'translateZ(0)' }}
            />
            <div className="relative z-10 flex min-h-0 w-full flex-1 flex-col overflow-hidden">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
