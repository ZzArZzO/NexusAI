import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AuthForm } from '@/components/auth/auth-form'
import { getSessionContext, isRegistrationOpen } from '@/lib/session'

export const metadata: Metadata = { title: 'Sign in' }

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  if (await getSessionContext()) redirect('/')

  // Before the first account exists there is nothing to sign in to, so send the
  // operator where they can actually get in rather than showing a form that
  // cannot succeed.
  if (await isRegistrationOpen()) redirect('/sign-up')

  const { next } = await searchParams

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <span className="font-mono text-xs tracking-[0.16em] text-muted-foreground uppercase">
          NexusAI
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">Your departments are waiting.</p>
      </header>

      <AuthForm mode="sign-in" redirectTo={next ?? '/'} />

      <p className="text-xs text-muted-foreground">
        Registration closed after the first account.{' '}
        <Link href="/sign-up" className="underline underline-offset-2">
          Why?
        </Link>
      </p>
    </div>
  )
}
