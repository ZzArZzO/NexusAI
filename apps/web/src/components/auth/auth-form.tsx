'use client'

import { Button } from '@nexusai/ui'
import { Loader2Icon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { signIn, signUp } from '@/lib/auth-client'

const MIN_PASSWORD_LENGTH = 12

interface AuthFormProps {
  mode: 'sign-in' | 'sign-up'
  redirectTo: string
}

export function AuthForm({ mode, redirectTo }: AuthFormProps) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSignUp = mode === 'sign-up'

  /** FormData values are `string | File`; these fields are always text inputs. */
  function text(form: FormData, key: string): string {
    const value = form.get(key)
    return typeof value === 'string' ? value : ''
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const form = new FormData(event.currentTarget)
    const email = text(form, 'email')
    const password = text(form, 'password')
    const name = text(form, 'name')

    if (isSignUp && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }

    setPending(true)

    const result = isSignUp
      ? await signUp.email({ email, password, name })
      : await signIn.email({ email, password })

    if (result.error) {
      // Better Auth returns a structured error; surface its message rather than
      // a generic one, because the useful cases here ("registration is closed",
      // "invalid credentials") are things the operator needs to read.
      setError(result.error.message ?? 'That did not work. Check your details and try again.')
      setPending(false)
      return
    }

    router.push(redirectTo)
    router.refresh()
  }

  return (
    <form
      // `void` rather than passing the async function directly: React expects a
      // void-returning handler, and an unhandled rejection here would be silent.
      onSubmit={(event) => {
        void handleSubmit(event)
      }}
      className="flex flex-col gap-4"
    >
      {isSignUp ? (
        <Field
          label="Name"
          name="name"
          type="text"
          autoComplete="name"
          required
          disabled={pending}
        />
      ) : null}

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        autoFocus={!isSignUp}
        disabled={pending}
      />

      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete={isSignUp ? 'new-password' : 'current-password'}
        required
        disabled={pending}
        hint={isSignUp ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
      />

      {error ? (
        <p role="alert" className="border-l-2 border-destructive/60 pl-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="mt-2">
        {pending ? <Loader2Icon className="animate-spin" /> : null}
        {isSignUp ? 'Create account' : 'Sign in'}
      </Button>
    </form>
  )
}

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string
  name: string
  // Explicitly `| undefined`: with exactOptionalPropertyTypes, an optional
  // property cannot be passed an explicit undefined without it.
  hint?: string | undefined
}

function Field({ label, name, hint, ...props }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
        {...props}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
