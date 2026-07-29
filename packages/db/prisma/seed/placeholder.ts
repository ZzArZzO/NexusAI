/**
 * PLACEHOLDER CONTENT — replace this before the system is useful.
 *
 * Everything here is deliberately, visibly fake. That is the point: a seed that
 * looks plausible is worse than one that looks fake, because plausible fiction
 * gets quietly treated as fact and ends up cited back to you by an agent six
 * weeks later.
 *
 * To replace it, see packages/db/prisma/seed/README.md. Short version: edit the
 * three exports below, drop real notes into `seed/memory/`, and run
 * `pnpm db:seed`. The seed is idempotent, so re-running it is safe.
 */

export const PLACEHOLDER_MARKER = '[PLACEHOLDER]'

export interface GoalSeed {
  title: string
  description: string
  horizon: 'annual' | 'quarterly' | 'monthly' | 'weekly'
  ownerKey?: string
  /** Days from seed time. Relative so the seed does not rot. */
  dueInDays?: number
}

export const GOALS: GoalSeed[] = [
  {
    title: `${PLACEHOLDER_MARKER} Replace these goals with your real ones`,
    description:
      'Edit packages/db/prisma/seed/placeholder.ts, or set goals in the UI and delete this one. ' +
      'The CEO agent reads goals to prioritise, so until this is real its prioritisation is fiction.',
    horizon: 'quarterly',
    dueInDays: 90,
  },
  {
    title: `${PLACEHOLDER_MARKER} Example: reach a revenue target`,
    description:
      'A goal the CEO can delegate against — Finance tracks it, Sales works toward it, ' +
      'Marketing supports it. Shows how one goal reaches four departments.',
    horizon: 'annual',
    ownerKey: 'finance',
    dueInDays: 365,
  },
  {
    title: `${PLACEHOLDER_MARKER} Example: ship something on a cadence`,
    description: 'A delivery goal, to show Engineering and Marketing sharing an owner.',
    horizon: 'quarterly',
    ownerKey: 'engineering',
    dueInDays: 90,
  },
]

export interface KpiSeed {
  key: string
  name: string
  unit: string
  direction: 'up' | 'down'
  target: number
  ownerKey: string
  /** Recent values, oldest first, one per week. Purely illustrative. */
  history: number[]
}

export const KPIS: KpiSeed[] = [
  {
    key: 'placeholder.revenue',
    name: `${PLACEHOLDER_MARKER} Monthly recurring revenue`,
    unit: 'EUR',
    direction: 'up',
    target: 10000,
    ownerKey: 'finance',
    history: [0, 0, 0, 0],
  },
  {
    key: 'placeholder.pipeline',
    name: `${PLACEHOLDER_MARKER} Open pipeline value`,
    unit: 'EUR',
    direction: 'up',
    target: 30000,
    ownerKey: 'sales',
    history: [0, 0, 0, 0],
  },
  {
    key: 'placeholder.published',
    name: `${PLACEHOLDER_MARKER} Content published`,
    unit: 'pieces/week',
    direction: 'up',
    target: 3,
    ownerKey: 'marketing',
    history: [0, 0, 0, 0],
  },
]

export interface MemorySeed {
  kind: 'note' | 'document' | 'report' | 'research'
  title: string
  content: string
  scopes: string[]
}

/**
 * Seed memory exists to prove retrieval works end to end, not to teach the
 * agents anything. Each document is written so that hybrid search has something
 * meaningful to find: one is full of exact terms, one is pure paraphrase, and
 * finding the second when you search for the first is the whole demonstration.
 */
export const MEMORY: MemorySeed[] = [
  {
    kind: 'note',
    title: `${PLACEHOLDER_MARKER} How this system works`,
    scopes: ['company'],
    content: `
# How NexusAI works

This company is run by nine AI departments sharing one memory. The CEO sets goals and delegates. Operations sequences the work. Research finds out what is true. Marketing, Sales, Support, Finance, Engineering and the Assistant do their respective jobs.

## The rule that matters

Every tool has a risk tier. Reading and analysing run freely. Anything that leaves the system — sending an email, publishing a post, pushing code — stops and waits for a human decision. Anything that moves money stops twice.

An approval that is never answered expires, and an expired approval means the action did not happen. The system fails closed.

## Memory

Everything the departments learn goes into one shared store. Retrieval is hybrid: exact-term search and meaning-based search, fused together, because either one alone misses things the other catches.
`.trim(),
  },
  {
    kind: 'note',
    title: `${PLACEHOLDER_MARKER} Working preferences`,
    scopes: ['company', 'personal'],
    content: `
# Working preferences

Replace this with how you actually like to work. The departments read it to calibrate tone, format and how much detail to give you.

Things worth recording here: how direct you want answers, whether you prefer prose or bullets, what time you start, when you do not want to be interrupted, and which decisions you always want to make yourself.

Until this is real, the agents are guessing.
`.trim(),
  },
  {
    kind: 'report',
    title: `${PLACEHOLDER_MARKER} Retrieval demonstration — pricing`,
    scopes: ['company'],
    content: `
# Retrieval demonstration

This document exists so you can prove hybrid search works without setting anything up.

Ask the CEO agent: *"what did we decide about pricing?"*

The word "pricing" appears in this heading, so keyword search finds this document. But the actual decision is written below in words that never use the term — which means only the semantic half of the search can find it. A working hybrid retrieval returns both. A broken one returns only the first.

## The decision

After looking at what three comparable tools charge, we settled on forty-nine euros a month for the standard tier, with the annual plan discounted to ten months. The reasoning was that anything under thirty reads as unserious to the buyers we want, and anything over eighty needs a sales conversation we are not staffed to have.

We deliberately did not add a free tier. The support load is real and the conversion from free was not.
`.trim(),
  },
]

export interface TaskSeed {
  title: string
  description: string
  departmentKey: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  dueInDays: number
}

export const TASKS: TaskSeed[] = [
  {
    title: `${PLACEHOLDER_MARKER} Tell the CEO what this company actually does`,
    description:
      'Open the CEO console and describe your business, what you are building, and what you most ' +
      'want off your plate. It will write that into memory, and every other department will read it.',
    departmentKey: 'ceo',
    priority: 'high',
    dueInDays: 1,
  },
  {
    title: `${PLACEHOLDER_MARKER} Replace the placeholder goals and KPIs`,
    description:
      'Edit them in the UI, or edit packages/db/prisma/seed/placeholder.ts and re-run pnpm db:seed.',
    departmentKey: 'ceo',
    priority: 'high',
    dueInDays: 2,
  },
  {
    title: `${PLACEHOLDER_MARKER} Drop your real notes into seed/memory/`,
    description:
      'Any markdown files there are ingested into long-term memory on the next seed. ' +
      'Past decisions, project notes and writing samples are the highest-value things to add first.',
    departmentKey: 'assistant',
    priority: 'medium',
    dueInDays: 7,
  },
]
