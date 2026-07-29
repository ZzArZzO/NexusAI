'use client'

import { Command } from 'cmdk'
import { PauseIcon, PlayIcon, SearchIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { DEPARTMENT_NAV, PRIMARY_NAV } from '@/lib/navigation'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  automationPaused: boolean
  onTogglePause: () => void
}

/**
 * ⌘K navigation.
 *
 * The primary way to move around, which is why every department is reachable in
 * two keystrokes and the pause switch lives here too — the one control you want
 * without hunting for it is the one that stops everything.
 *
 * Open state is owned by the topbar rather than here, so the button and the
 * shortcut are the same code path. It used to be local, and the button opened it
 * by dispatching a synthetic keydown — which worked, and was a lie: it meant the
 * button could pass while the actual shortcut was broken.
 */
export function CommandPalette({
  open,
  onOpenChange,
  automationPaused,
  onTogglePause,
}: CommandPaletteProps) {
  const router = useRouter()

  function setOpen(next: boolean) {
    onOpenChange(next)
  }

  function go(href: string) {
    setOpen(false)
    router.push(href)
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm"
      overlayClassName="fixed inset-0"
      contentClassName="fixed top-[18vh] left-1/2 w-full max-w-lg -translate-x-1/2 px-4"
    >
      <div className="overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Command.Input
            placeholder="Go to a department, or type a command…"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <Command.List className="max-h-80 overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing matches that.
          </Command.Empty>

          <Group heading="Go to">
            {PRIMARY_NAV.map((item) => (
              <Item
                key={item.href}
                value={item.label}
                onSelect={() => {
                  go(item.href)
                }}
                hint={item.hint}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Item>
            ))}
          </Group>

          <Group heading="Departments">
            {DEPARTMENT_NAV.map((item) => (
              <Item
                key={item.href}
                value={item.label}
                onSelect={() => {
                  go(item.href)
                }}
                hint={item.hint}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Item>
            ))}
          </Group>

          <Group heading="Company">
            <Item
              value={automationPaused ? 'Resume automation' : 'Pause all automation'}
              onSelect={() => {
                setOpen(false)
                onTogglePause()
              }}
              hint={
                automationPaused
                  ? 'Let scheduled work and autonomous runs start again'
                  : 'Halt every autonomous run before its first step'
              }
            >
              {automationPaused ? (
                <PlayIcon className="size-4" aria-hidden />
              ) : (
                <PauseIcon className="size-4" aria-hidden />
              )}
              {automationPaused ? 'Resume automation' : 'Pause all automation'}
            </Item>
          </Group>
        </Command.List>
      </div>
    </Command.Dialog>
  )
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[0.65rem] [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase"
    >
      {children}
    </Command.Group>
  )
}

function Item({
  children,
  onSelect,
  hint,
  value,
}: {
  children: React.ReactNode
  onSelect: () => void
  hint?: string | undefined
  /**
   * Explicit, rather than letting cmdk derive it from the rendered text.
   * Derived values include the hint, so typing a word that appears in one
   * department's description would match a different department's row.
   */
  value: string
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
    >
      {children}
      {hint ? (
        <span className="ml-auto max-w-[55%] truncate text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </Command.Item>
  )
}
