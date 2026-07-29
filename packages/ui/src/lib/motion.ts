import type { Transition, Variants } from 'motion/react'

/**
 * Motion tokens. Every animation in the product pulls from this file so timing
 * stays coherent across the app rather than being re-invented per component.
 *
 * Durations are in seconds (Motion's unit), mirroring the CSS custom properties
 * `--duration-fast|base|slow` in globals.css.
 */
export const DURATION = {
  fast: 0.12,
  base: 0.2,
  slow: 0.32,
} as const

export const EASING = {
  /** Default for most UI: quick out, gentle settle. */
  standard: [0.2, 0, 0, 1],
  /** Elements entering the viewport. */
  entrance: [0, 0, 0, 1],
  /** Elements leaving. */
  exit: [0.3, 0, 1, 1],
} as const

export const SPRING: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 32,
  mass: 0.9,
}

export const transitions = {
  fast: { duration: DURATION.fast, ease: EASING.standard },
  base: { duration: DURATION.base, ease: EASING.standard },
  slow: { duration: DURATION.slow, ease: EASING.standard },
  spring: SPRING,
} as const satisfies Record<string, Transition>

/** Fade + subtle rise. The default entrance for cards, panels and list rows. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: transitions.base },
  exit: { opacity: 0, y: -4, transition: transitions.fast },
}

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transitions.base },
  exit: { opacity: 0, transition: transitions.fast },
}

/**
 * Parent variant that cascades children in sequence — used for dashboard
 * panels and activity feeds so content arrives rather than flashing.
 */
export function stagger(staggerChildren = 0.04, delayChildren = 0): Variants {
  return {
    hidden: {},
    visible: { transition: { staggerChildren, delayChildren } },
  }
}
