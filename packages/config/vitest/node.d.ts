import type { UserConfig } from 'vitest/config'

/** Shared Vitest config for Node-side packages. */
export declare function nodeVitestConfig(overrides?: UserConfig): UserConfig
export default nodeVitestConfig
