import { baseConfig, layerBoundaries } from '@nexusai/config/eslint/base'

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: layerBoundaries('@nexusai/integrations'),
  },
]
