import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center px-6 py-16">
      {/* A single quiet gradient rather than a decorated auth page. The operator
          sees this twice a month; it should not perform. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_40rem_at_50%_-10%,var(--accent-glow),transparent)]"
        style={{
          ['--accent-glow' as string]: 'color-mix(in oklch, var(--primary) 12%, transparent)',
        }}
      />
      <main className="w-full max-w-sm">{children}</main>
    </div>
  )
}
