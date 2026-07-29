import { fileURLToPath } from 'node:url'

import { reactVitestConfig } from '@nexusai/config/vitest/react'

export default reactVitestConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
