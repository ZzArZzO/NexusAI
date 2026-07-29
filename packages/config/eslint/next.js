import nextPlugin from '@next/eslint-plugin-next'
import tseslint from 'typescript-eslint'

import { reactLibraryConfig } from './react-library.js'

export const nextConfig = tseslint.config(
  ...reactLibraryConfig,
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
)

export default nextConfig
