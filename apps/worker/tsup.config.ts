import { defineConfig } from 'tsup'

/**
 * Workspace packages are published as TypeScript source, so the worker is
 * bundled rather than merely transpiled — otherwise `node dist/index.js` would
 * try to import a `.ts` file at runtime.
 *
 * Everything under `@nexusai/*` (and the Prisma client generated inside
 * `packages/db`) is inlined; real npm dependencies stay external and are
 * installed into the image by `pnpm deploy --prod`.
 *
 * Anything used at runtime therefore belongs in `dependencies`, not
 * `devDependencies` — tsup bundles devDependencies, and bundling a CommonJS
 * package into ESM output turns its internal `require('fs')` into a shim that
 * throws at startup.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  sourcemap: true,
  clean: true,
  noExternal: [/^@nexusai\//],
  external: ['@prisma/client', '@prisma/adapter-pg', 'pg', 'pino', 'pino-pretty'],
})
