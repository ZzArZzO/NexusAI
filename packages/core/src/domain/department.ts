import { z } from 'zod'

/**
 * The org chart. Every department is an agent; this module holds only the
 * structural facts about them (identity, remit, who they may delegate to). Tool
 * grants are next door in `./tools`; prompts and models live in `@nexusai/agents`.
 */
export const DEPARTMENT_IDS = [
  'ceo',
  'operations',
  'research',
  'marketing',
  'sales',
  'support',
  'finance',
  'engineering',
  'assistant',
] as const

export const departmentIdSchema = z.enum(DEPARTMENT_IDS)
export type DepartmentId = z.infer<typeof departmentIdSchema>

export interface DepartmentProfile {
  readonly id: DepartmentId
  readonly displayName: string
  /** One-line remit, shown in the UI and injected into peer-department context. */
  readonly remit: string
  /**
   * Which departments this one may delegate to. Encoding the org chart here
   * makes delegation cycles a configuration error rather than a runtime hang.
   */
  readonly canDelegateTo: readonly DepartmentId[]
}

export const DEPARTMENTS: Readonly<Record<DepartmentId, DepartmentProfile>> = Object.freeze({
  ceo: {
    id: 'ceo',
    displayName: 'CEO',
    remit: 'Sets goals, prioritises, delegates, reviews reports and KPIs, makes final decisions.',
    canDelegateTo: [
      'operations',
      'research',
      'marketing',
      'sales',
      'support',
      'finance',
      'engineering',
      'assistant',
    ],
  },
  operations: {
    id: 'operations',
    displayName: 'Operations',
    remit:
      'Orchestrates workflows, schedules jobs, monitors system health, coordinates departments.',
    canDelegateTo: [
      'research',
      'marketing',
      'sales',
      'support',
      'finance',
      'engineering',
      'assistant',
    ],
  },
  research: {
    id: 'research',
    displayName: 'Research',
    remit: 'Searches the web, analyses competitors, compares products, writes reports into memory.',
    canDelegateTo: [],
  },
  marketing: {
    id: 'marketing',
    displayName: 'Marketing',
    remit: 'Generates content ideas and copy across channels, schedules posts, reads analytics.',
    canDelegateTo: ['research'],
  },
  sales: {
    id: 'sales',
    displayName: 'Sales',
    remit: 'Owns the CRM: prospects, lead scoring, outreach, sequences, pipeline and forecasting.',
    canDelegateTo: ['research', 'marketing'],
  },
  support: {
    id: 'support',
    displayName: 'Support',
    remit: 'Handles conversations, drafts replies, maintains the knowledge base, escalates issues.',
    canDelegateTo: ['research', 'engineering'],
  },
  finance: {
    id: 'finance',
    displayName: 'Finance',
    remit: 'Tracks revenue, expenses, cash flow and taxes; forecasts income; flags anomalies.',
    canDelegateTo: ['research'],
  },
  engineering: {
    id: 'engineering',
    displayName: 'Engineering',
    remit: 'Writes and reviews code, fixes bugs, generates tests and docs, deploys and monitors.',
    canDelegateTo: ['research'],
  },
  assistant: {
    id: 'assistant',
    displayName: 'Personal Assistant',
    remit:
      'Calendar, reminders, notes, daily agenda, meeting summaries, travel and personal goals.',
    canDelegateTo: ['research'],
  },
})

export function departmentProfile(id: DepartmentId): DepartmentProfile {
  return DEPARTMENTS[id]
}

/** True when `from` is permitted to delegate work to `to`. */
export function canDelegate(from: DepartmentId, to: DepartmentId): boolean {
  if (from === to) return false
  return DEPARTMENTS[from].canDelegateTo.includes(to)
}
