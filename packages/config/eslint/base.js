import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

/**
 * Layer boundaries, enforced by lint rather than by convention.
 *
 * Dependencies point downward only:
 *   web/worker -> jobs -> agents -> integrations -> db -> core
 *
 * `core` is pure domain logic and must stay I/O-free so it is trivially testable.
 */
const LAYER_RULES = {
  '@nexusai/core': ['@nexusai/db', '@nexusai/agents', '@nexusai/integrations', '@nexusai/jobs'],
  '@nexusai/db': ['@nexusai/agents', '@nexusai/integrations', '@nexusai/jobs'],
  '@nexusai/integrations': ['@nexusai/agents', '@nexusai/jobs'],
  '@nexusai/agents': ['@nexusai/jobs'],
}

/**
 * Build the `no-restricted-imports` rule for a given package name.
 * @param {string} packageName
 */
export function layerBoundaries(packageName) {
  const forbidden = LAYER_RULES[packageName] ?? []
  if (forbidden.length === 0) return {}

  return {
    'no-restricted-imports': [
      'error',
      {
        patterns: forbidden.map((target) => ({
          group: [target, `${target}/*`],
          message: `Layer violation: ${packageName} must not import ${target}. Dependencies point downward only.`,
        })),
      },
    ],
  }
}

export const baseConfig = tseslint.config(
  {
    ignores: ['dist/**', '.next/**', 'coverage/**', 'generated/**', '.turbo/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      // Unused vars are an error, but an explicit `_` prefix opts out.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // `import type` must be explicit — required by verbatimModuleSyntax.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Silent failures are a defect class, not a style choice.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // `process.env['FOO']` is deliberate: it keeps env access uniform and stays
      // correct if `noPropertyAccessFromIndexSignature` is switched on later.
      '@typescript-eslint/dot-notation': ['error', { allowIndexSignaturePropertyAccess: true }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // Flat config files live outside the TypeScript project graph, so type-aware
    // rules cannot run on them.
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Tests may be looser: console output and `any` in fixtures are fine.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/tests/**', '**/__tests__/**'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  {
    // Config files run outside the type-aware project graph.
    files: ['**/*.config.{js,mjs,ts}', '**/*.setup.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  prettier,
)

export default baseConfig
