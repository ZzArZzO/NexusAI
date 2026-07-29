import { DEPARTMENT_IDS, DEPARTMENTS } from '@nexusai/core'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@nexusai/ui'

import { ThemeToggle } from '@/components/theme-toggle'

/**
 * Phase 0 status page. It exists to prove the stack is wired end to end:
 * workspace packages resolve, the token layer applies, dark mode switches.
 * Phase 1 replaces this route with the real dashboard.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-10 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Phase 0 · Foundation
          </span>
          <h1 className="text-3xl font-semibold tracking-tight">NexusAI</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Nine departments, one shared memory, durable orchestration. The org chart below is
            loaded from the domain layer — it is the same source the agent kernel will use.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <section aria-labelledby="departments" className="flex flex-col gap-4">
        <h2 id="departments" className="text-sm font-medium">
          Departments
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DEPARTMENT_IDS.map((id) => {
            const department = DEPARTMENTS[id]
            return (
              <Card
                key={id}
                className="transition-colors duration-(--duration-base) hover:border-ring/40"
              >
                <CardHeader>
                  <CardTitle>{department.displayName}</CardTitle>
                  <CardDescription>{department.remit}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    {department.canDelegateTo.length === 0
                      ? 'Does not delegate'
                      : `Delegates to ${department.canDelegateTo.length} department${
                          department.canDelegateTo.length === 1 ? '' : 's'
                        }`}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>
    </main>
  )
}
