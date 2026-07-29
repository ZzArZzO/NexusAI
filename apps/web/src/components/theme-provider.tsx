'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ComponentProps, ReactNode } from 'react'

type NextThemesProps = ComponentProps<typeof NextThemesProvider>

/**
 * `class` strategy so the token layer's `.dark` selector drives everything,
 * and `disableTransitionOnChange` so switching themes doesn't animate every
 * colour on the page at once.
 */
export function ThemeProvider({
  children,
  ...props
}: { children: ReactNode } & Partial<NextThemesProps>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
