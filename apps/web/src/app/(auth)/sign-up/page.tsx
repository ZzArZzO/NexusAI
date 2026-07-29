import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AuthForm } from '@/components/auth/auth-form'
import { getSessionContext, isRegistrationOpen } from '@/lib/session'

export const metadata: Metadata = { title: 'Create your account' }

export default async function SignUpPage() {
  if (await getSessionContext()) redirect('/')

  const open = await isRegistrationOpen()

  if (!open) {
    return (
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <span className="font-mono text-xs tracking-[0.16em] text-muted-foreground uppercase">
            NexusAI
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Registration is closed</h1>
        </header>

        <p className="text-sm leading-relaxed text-muted-foreground">
          This workspace already has an operator, so self-service sign-up is switched off. That is
          deliberate: it is the difference between &ldquo;anything that can reach this port can
          create an account&rdquo; and &ldquo;only people you added can&rdquo;.
        </p>

        <p className="text-sm leading-relaxed text-muted-foreground">
          To add someone, create their membership directly rather than opening registration again.
        </p>

        <Link
          href="/sign-in"
          className="text-sm text-primary underline underline-offset-4 hover:no-underline"
        >
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <span className="font-mono text-xs tracking-[0.16em] text-muted-foreground uppercase">
          NexusAI · first run
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This is the only account that can be created this way. It becomes the owner, and
          registration closes behind it.
        </p>
      </header>

      <AuthForm mode="sign-up" redirectTo="/" />
    </div>
  )
}
