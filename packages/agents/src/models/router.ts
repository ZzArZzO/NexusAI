import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { EmbeddingModel, LanguageModel } from 'ai'

import { createMockEmbeddingModel, createMockLanguageModel } from './mock'

/**
 * Model routing.
 *
 * Departments ask for a *role*, never a model. That indirection is what makes
 * "put the CEO on Opus but leave everything else on Sonnet" a config edit rather
 * than a search-and-replace, and what lets the whole system run on mocks when no
 * key is present.
 */

export const MODEL_ROLES = ['reasoning', 'drafting', 'bulk'] as const
export type ModelRole = (typeof MODEL_ROLES)[number]

export interface ModelProfile {
  readonly name: string
  readonly description: string
  readonly models: Readonly<Record<ModelRole, string>>
}

/**
 * The default is `frugal`, not `capable`.
 *
 * At this workload the difference between Sonnet and Opus for routine planning
 * is small and the price difference is not — roughly $42/month against $77 at
 * expected volume. Opus is worth reaching for on genuinely hard judgment, which
 * is what the per-department override is for.
 */
export const PROFILES: Record<string, ModelProfile> = {
  frugal: {
    name: 'Frugal',
    description: 'Sonnet for reasoning and drafting, Haiku for bulk. The sensible default.',
    models: {
      reasoning: 'claude-sonnet-5',
      drafting: 'claude-sonnet-5',
      bulk: 'claude-haiku-4-5-20251001',
    },
  },
  capable: {
    name: 'Capable',
    description: 'Opus for reasoning. Reach for this when judgment quality actually matters.',
    models: {
      reasoning: 'claude-opus-5',
      drafting: 'claude-sonnet-5',
      bulk: 'claude-haiku-4-5-20251001',
    },
  },
}

export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIMENSIONS = 1536

export interface RouterOptions {
  anthropicApiKey?: string | undefined
  openaiApiKey?: string | undefined
  profile?: string | undefined
  /** Per-department overrides, e.g. `{ reasoning: 'claude-opus-5' }`. */
  overrides?: Partial<Record<ModelRole, string>> | undefined
}

export interface ResolvedModel {
  model: LanguageModel
  /** The id used for cost accounting and shown in the run timeline. */
  modelId: string
  /** False when this is the mock, which the UI surfaces rather than hides. */
  live: boolean
}

export class ModelRouter {
  private readonly profile: ModelProfile
  private readonly overrides: Partial<Record<ModelRole, string>>
  private readonly anthropic: ReturnType<typeof createAnthropic> | undefined
  private readonly openai: ReturnType<typeof createOpenAI> | undefined

  constructor(options: RouterOptions = {}) {
    this.profile = PROFILES[options.profile ?? 'frugal'] ?? PROFILES['frugal']!
    this.overrides = options.overrides ?? {}

    this.anthropic = options.anthropicApiKey
      ? createAnthropic({ apiKey: options.anthropicApiKey })
      : undefined
    this.openai = options.openaiApiKey ? createOpenAI({ apiKey: options.openaiApiKey }) : undefined
  }

  /** True when real providers are configured. Drives the "mock models" badge. */
  get live(): boolean {
    return this.anthropic !== undefined
  }

  get embeddingLive(): boolean {
    return this.openai !== undefined
  }

  modelIdFor(role: ModelRole): string {
    return this.overrides[role] ?? this.profile.models[role]
  }

  language(role: ModelRole): ResolvedModel {
    const modelId = this.modelIdFor(role)

    if (!this.anthropic) {
      return { model: createMockLanguageModel(modelId), modelId: 'mock', live: false }
    }

    return { model: this.anthropic(modelId), modelId, live: true }
  }

  embedding(): { model: EmbeddingModel; modelId: string; live: boolean } {
    if (!this.openai) {
      return { model: createMockEmbeddingModel(EMBEDDING_DIMENSIONS), modelId: 'mock', live: false }
    }

    return {
      model: this.openai.textEmbeddingModel(EMBEDDING_MODEL),
      modelId: EMBEDDING_MODEL,
      live: true,
    }
  }
}

/**
 * Build a router from the environment.
 *
 * Deliberately tolerant of missing keys: absence selects the mock rather than
 * throwing, because a system that refuses to start without a paid API key
 * cannot be developed or demonstrated.
 */
export function routerFromEnv(overrides?: Partial<Record<ModelRole, string>>): ModelRouter {
  return new ModelRouter({
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
    openaiApiKey: process.env['OPENAI_API_KEY'],
    profile: process.env['MODEL_PROFILE'] ?? 'frugal',
    overrides,
  })
}
