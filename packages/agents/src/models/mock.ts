import type { EmbeddingModel, LanguageModel } from 'ai'
import { simulateReadableStream } from 'ai'
import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test'

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
 *     then answers from what came back.
 *   - A request to record something calls `task.create`.
 *   - Anything else answers directly.
 *
 * It never emits an external- or financial-tier tool call. Approving a fake
 * email is not a useful rehearsal, and a mock that could would make the gate
 * tests meaningless.
 *
 * Both `doGenerate` and `doStream` are implemented, from one shared decision
 * function. They have to be: the kernel uses `generateText` for autonomous runs
 * and `streamText` for chat, so a mock with only the former fails precisely
 * where the operator is watching — which is exactly how this was found.
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

const MOCK_NOTICE =
  '\n\n_(Mock model: no API key is configured, so this answer is generated locally rather than by a real model. Add ANTHROPIC_API_KEY and OPENAI_API_KEY to switch to live models.)_'

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
  return prompt.some((message: unknown) => (message as { role?: string }).role === 'tool')
}

/**
 * Usage in the *provider* shape, which is not the one `generateText` returns.
 *
 * Here `inputTokens` is an object with a total/noCache/cacheRead breakdown; by
 * the time it reaches the caller the SDK has flattened it. Two shapes, same
 * name — and getting it wrong would not fail loudly, it would record NaN token
 * counts and a nonsense bill.
 */
function usage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
  }
}

type Decision =
  | {
      kind: 'tool'
      toolName: string
      toolCallId: string
      input: string
      inputTokens: number
      outputTokens: number
    }
  | { kind: 'text'; text: string; inputTokens: number; outputTokens: number }

/** The one decision function both doGenerate and doStream are built on. */
function decide(prompt: unknown, tools: readonly { name: string }[] | undefined): Decision {
  const text = lastUserText(prompt)
  const toolNames = new Set((tools ?? []).map((tool) => tool.name))
  const answered = hasToolResult(prompt)

  if (
    !answered &&
    toolNames.has('memory.recall') &&
    RECALL_TRIGGERS.some((t) => text.includes(t))
  ) {
    return {
      kind: 'tool',
      toolName: 'memory.recall',
      toolCallId: 'mock-recall-1',
      input: JSON.stringify({ query: text.slice(0, 120) || 'context', limit: 5 }),
      inputTokens: 320,
      outputTokens: 24,
    }
  }

  if (!answered && toolNames.has('task.create') && TASK_TRIGGERS.some((t) => text.includes(t))) {
    return {
      kind: 'tool',
      toolName: 'task.create',
      toolCallId: 'mock-task-1',
      input: JSON.stringify({ title: text.slice(0, 80) || 'Untitled task', priority: 'medium' }),
      inputTokens: 300,
      outputTokens: 30,
    }
  }

  const body = answered
    ? 'Based on what I found in long-term memory, here is what I can tell you.'
    : 'I can help with that.'

  return { kind: 'text', text: body + MOCK_NOTICE, inputTokens: 340, outputTokens: 48 }
}

export function createMockLanguageModel(modelId = 'mock'): LanguageModel {
  return new MockLanguageModelV4({
    modelId,

    // eslint-disable-next-line @typescript-eslint/require-await -- the SDK's signature is async; this mock has nothing to await
    doGenerate: async ({ prompt, tools }) => {
      const decision = decide(prompt, tools)

      if (decision.kind === 'tool') {
        return {
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: decision.toolCallId,
              toolName: decision.toolName,
              input: decision.input,
            },
          ],
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage: usage(decision.inputTokens, decision.outputTokens),
          warnings: [],
        }
      }

      return {
        content: [{ type: 'text' as const, text: decision.text }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: usage(decision.inputTokens, decision.outputTokens),
        warnings: [],
      }
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- same
    doStream: async ({ prompt, tools }) => {
      const decision = decide(prompt, tools)

      if (decision.kind === 'tool') {
        return {
          stream: simulateReadableStream({
            chunkDelayInMs: 0,
            chunks: [
              {
                type: 'tool-call' as const,
                toolCallId: decision.toolCallId,
                toolName: decision.toolName,
                input: decision.input,
              },
              {
                type: 'finish' as const,
                finishReason: { unified: 'tool-calls' as const, raw: undefined },
                usage: usage(decision.inputTokens, decision.outputTokens),
              },
            ],
          }),
        }
      }

      // A few words at a time rather than one lump, so the UI's streaming path
      // is genuinely exercised rather than merely reachable.
      const words = decision.text.split(/(\s+)/).filter((word) => word !== '')

      return {
        stream: simulateReadableStream({
          chunkDelayInMs: 8,
          chunks: [
            { type: 'text-start' as const, id: 'mock-text' },
            ...words.map((word) => ({
              type: 'text-delta' as const,
              id: 'mock-text',
              delta: word,
            })),
            { type: 'text-end' as const, id: 'mock-text' },
            {
              type: 'finish' as const,
              finishReason: { unified: 'stop' as const, raw: undefined },
              usage: usage(decision.inputTokens, decision.outputTokens),
            },
          ],
        }),
      }
    },
  })
}

/**
 * Deterministic embeddings.
 *
 * Derived from the text's own characters, so the same input always produces the
 * same vector and identical strings land in the same place. Enough for retrieval
 * to be exercised end to end — not enough for retrieval to be *good*, which is
 * the honest reason the UI says "mock" rather than pretending.
 */
export function createMockEmbeddingModel(dimensions = 1536): EmbeddingModel {
  return new MockEmbeddingModelV4({
    modelId: 'mock-embedding',
    // eslint-disable-next-line @typescript-eslint/require-await -- the interface is async, the mock is not
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
