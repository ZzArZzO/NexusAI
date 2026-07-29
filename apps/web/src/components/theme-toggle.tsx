'use client'

import { Button } from '@nexusai/ui'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useSyncExternalStore } from 'react'

const ORDER = ['light', 'dark', 'system'] as const
type Theme = (typeof ORDER)[number]

const ICONS: Record<Theme, typeof SunIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
}

/**
 * The server cannot know the resolved theme, so the icon must not be chosen
 * until the client has hydrated. `useSyncExternalStore` expresses that directly
 * — server snapshot `false`, client snapshot `true` — without a state update
 * inside an effect, which would cost an extra render pass.
 */
const unsubscribe = () => undefined
const subscribe = () => unsubscribe

function useHasHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}

function isTheme(value: string | undefined): value is Theme {
  return value !== undefined && (ORDER as readonly string[]).includes(value)
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const hydrated = useHasHydrated()

  const current: Theme = hydrated && isTheme(theme) ? theme : 'system'
  const Icon = ICONS[current]

  function cycle() {
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]
    setTheme(next ?? 'system')
  }

  return (
    <Button variant="ghost" size="icon" onClick={cycle} aria-label={`Theme: ${current}`}>
      <Icon />
    </Button>
  )
}
