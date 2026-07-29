import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import type { ReactNode } from 'react'

import { ThemeProvider } from '@/components/theme-provider'

import './globals.css'

const sans = Geist({ variable: '--font-sans', subsets: ['latin'], display: 'swap' })
const mono = Geist_Mono({ variable: '--font-mono', subsets: ['latin'], display: 'swap' })

export const metadata: Metadata = {
  title: {
    default: 'NexusAI',
    template: '%s · NexusAI',
  },
  description: 'A personal AI operating system: autonomous departments with one shared memory.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'oklch(0.994 0.001 286)' },
    { media: '(prefers-color-scheme: dark)', color: 'oklch(0.165 0.007 286)' },
  ],
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} font-sans`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
