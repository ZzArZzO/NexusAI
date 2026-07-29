import { baseConfig, layerBoundaries } from '@nexusai/config/eslint/base'

export default [
  ...baseConfig,
  { ignores: ['generated/**'] },
  {
    files: ['**/*.ts'],
    rules: layerBoundaries('@nexusai/db'),
  },
]
