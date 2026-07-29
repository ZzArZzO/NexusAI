import { MockLanguageModelV4, MockEmbeddingModelV4 } from 'ai/test'
import type { EmbeddingModel, LanguageModel } from 'ai'

/**
 * The mock provider.
 *
 * This exists so the entire system — kernel, tool loop, risk gate, memory
 * retrieval, instrumentation — can be built, run and tested before anyone has
 * decided to pay for a model. It is not a stub that returns "hello": it drives
 * the real tool loop, because a kernel proven only against canned text has not
 * been proven at all.
 *
 * Behaviour is deterministic and derived from the prompt:
 *
 *   - A question that looks like it needs context calls `memory.recall` first,
 *     then answers citing what came back.
 *   - A request to record something calls `task.create`.
 *   - Anything else answers directly.
 *
 * It never emits an external- or financial-tier tool call. Approving a fake
 * email is not a useful rehearsal, and a mock that could would make the gate
 * tests meaningless.
 */

const RECALL_TRIGGERS = [
  'what did',
  'what do we',
  'remind me',
  'remember',
  'decided',
  'decision',
  'context',
  'know about',
  'tell me about',
  'summar',
  'pricing',
  'goal',
]

const TASK_TRIGGERS = ['add a task', 'create a task', 'remind me to', 'todo', 'to-do', 'follow up']

function lastUserText(prompt: unknown): string {
  if (!Array.isArray(prompt)) return ''

  for (let i = prompt.length - 1; i >= 0; i -= 1) {
    const message = prompt[i] as { role?: string; content?: unknown }
    if (message.role !== 'user') continue

    if (typeof message.content === 'string') return message.content.toLowerCase()

    if (Array.isArray(message.content)) {
      return message.content
        .map((part: unknown) =>
          typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : '',
        )
        .join(' ')
        .toLowerCase()
    }
  }

  return ''
}

/** Has the loop already run a tool? If so the model should answer, not call again. */
function hasToolResult(prompt: unknown): boolean {
  if (!Array.isArray(prompt)) return false
  return prompt.some((message: unknown) => {
    const role = (message as { role?: string }).role
    return role === 'tool'
  })
}

/**
 * Usage in the *provider* shape, which is not the same as the one `generateText`
 * returns.
 *
 * At this layer `inputTokens` is an object with a `total`/`noCache`/`cacheRead`
 * breakdown; by the time it reaches the caller the SDK has flattened it to plain
 * numbers with the detail under `inputTokenDetails`. Two shapes, same name — and
 * getting it wrong here would not fail loudly, it would quietly record NaN token
 * counts and a nonsense bill.
 */
function usage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
  }
}

const MOCK_NOTICE =
  '\n\n_(Mock model: no API key is configured, so this answer is generated locally and is not a real model response. Add ANTHROPIC_API_KEY and OPENAI_API_KEY to switch to live models.)_'

export function createMockLanguageModel(modelId = 'mock'): LanguageModel {
  return new MockLanguageModelV4({
    modelId,

    // eslint-disable-next-line @typescript-eslint/require-await -- the SDK's signature demands a promise; this mock has nothing to await
    doGenerate: async ({ prompt, tools }) => {
      const text = lastUserText(prompt)
      const toolNames = new Set((tools ?? []).map((tool) => tool.name))
      const answered = hasToolResult(prompt)

      if (
        !answered &&
        toolNames.has('memory.recall') &&
        RECALL_TRIGGERS.some((t) => text.includes(t))
      ) {
        return {
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: 'mock-recall-1',
              toolName: 'memory.recall',
              input: JSON.stringify({ query: text.slice(0, 120) || 'context', limit: 5 }),
            },
          ],
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage: usage(320, 24),
          warnings: [],
        }
      }

      if (
        !answered &&
        toolNames.has('task.create') &&
        TASK_TRIGGERS.some((t) => text.includes(t))
      ) {
        return {
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: 'mock-task-1',
              toolName: 'task.create',
              input: JSON.stringify({
                title: text.slice(0, 80) || 'Untitled task',
                priority: 'medium',
              }),
            },
          ],
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage: usage(300, 30),
          warnings: [],
        }
      }

      const body = answered
        ? 'Based on what I found in memory, here is the answer.'
        : 'I can help with that.'

      return {
        content: [{ type: 'text' as const, text: body + MOCK_NOTICE }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: usage(340, 48),
        warnings: [],
      }
    },
  })
}

/**
 * Deterministic embeddings.
 *
 * Derived from the text's own characters, so the same input always produces the
 * same vector and two similar strings land near each other. That is enough for
 * retrieval to be exercised end to end — it is not enough for retrieval to be
 * *good*, which is the honest reason the UI says "mock" rather than pretending.
 */
export function createMockEmbeddingModel(dimensions = 1536): EmbeddingModel {
  return new MockEmbeddingModelV4({
    modelId: 'mock-embedding',
    // eslint-disable-next-line @typescript-eslint/require-await -- same: the interface is async, the mock is not
    doEmbed: async ({ values }) => ({
      embeddings: values.map((value) => deterministicVector(value, dimensions)),
      usage: { tokens: values.reduce((total, value) => total + Math.ceil(value.length / 4), 0) },
      warnings: [],
    }),
  })
}

export function deterministicVector(value: string, dimensions = 1536): number[] {
  // A cheap rolling hash per dimension. Not semantically meaningful, but stable,
  // bounded, and different for different text — which is all retrieval needs to
  // be testable without a provider.
  const vector = new Array<number>(dimensions).fill(0)
  let hash = 2166136261

  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
    vector[i % dimensions] = ((hash >>> 0) % 2000) / 1000 - 1
  }

  // Normalise, so cosine distance behaves and no vector dominates by magnitude.
  const magnitude = Math.sqrt(vector.reduce((total, x) => total + x * x, 0)) || 1
  return vector.map((x) => x / magnitude)
}
