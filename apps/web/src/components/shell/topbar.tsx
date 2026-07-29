'use client'

import { Badge, Button } from '@nexusai/ui'
import { LogOutIcon, PauseIcon, PlayIcon, SearchIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { toggleAutomationPause } from '@/app/actions/automation'
import { CommandPalette } from '@/components/shell/command-palette'
import { ThemeToggle } from '@/components/theme-toggle'
import { signOut } from '@/lib/auth-client'

interface TopbarProps {
  userName: string
  automationPaused: boolean
  canPause: boolean
  usingMockModels: boolean
}

export function Topbar({ userName, automationPaused, canPause, usingMockModels }: TopbarProps) {
  const router = useRouter()
  const [paused, setPaused] = useState(automationPaused)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // The shortcut lives here, next to the state it toggles, so the button and the
  // keystroke are one code path rather than the button faking a keystroke.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  function togglePause() {
    if (!canPause) {
      toast.error('You do not have permission to change automation settings.')
      return
    }

    startTransition(async () => {
      try {
        const result = await toggleAutomationPause()
        setPaused(result.paused)
        toast[result.paused ? 'warning' : 'success'](
          result.paused ? 'Automation paused' : 'Automation resumed',
          {
            description: result.paused
              ? 'Every autonomous run will stop before its first step. Chat still works.'
              : 'Scheduled work and autonomous runs can start again.',
          },
        )
      } catch {
        toast.error('Could not change the pause setting.')
      }
    })
  }

  return (
    <>
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-5 backdrop-blur">
        <button
          type="button"
          onClick={() => {
            setPaletteOpen(true)
          }}
          className="flex h-8 items-center gap-2 rounded-md border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
        >
          <SearchIcon className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">Search or jump to…</span>
          <kbd className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground">
            ⌘K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-2">
          {usingMockModels ? (
            <Badge
              variant="info"
              title="No model API keys are configured, so answers are deterministic fakes."
            >
              Mock models
            </Badge>
          ) : null}

          {paused ? <Badge variant="warning">Automation paused</Badge> : null}

          <Button
            variant="ghost"
            size="icon"
            onClick={togglePause}
            disabled={pending || !canPause}
            aria-label={paused ? 'Resume automation' : 'Pause all automation'}
            title={paused ? 'Resume automation' : 'Pause all automation'}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
          </Button>

          <ThemeToggle />

          <Button
            variant="ghost"
            size="icon"
            aria-label={`Sign out ${userName}`}
            title="Sign out"
            onClick={() => {
              void signOut().then(() => {
                router.push('/sign-in')
                router.refresh()
              })
            }}
          >
            <LogOutIcon />
          </Button>
        </div>
      </header>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        automationPaused={paused}
        onTogglePause={togglePause}
      />
    </>
  )
}
