import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

import { baseConfig } from './base.js'

export const reactLibraryConfig = tseslint.config(...baseConfig, {
  files: ['**/*.{ts,tsx}'],
  plugins: { 'react-hooks': reactHooks },
  rules: {
    ...reactHooks.configs.recommended.rules,
  },
})

export default reactLibraryConfig
