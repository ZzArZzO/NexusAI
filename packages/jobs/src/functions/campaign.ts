import { prisma } from '@nexusai/db'

import { inngest } from '../client'
import { ApprovalRequested, ApprovalResponded, CampaignRequested } from '../events'
import { runDepartment } from './department'

/**
 * The multi-department workflow from the original brief, made real.
 *
 * The CEO briefs it, Research and Finance work in parallel, Marketing builds on
 * both, Sales prepares outreach, the operator approves, Operations schedules, and
 * the CEO writes one report. Every arrow is a durable step: a crash resumes at the
 * last completed one, and the approval gate can hold for three days without
 * anything being lost or re-run.
 *
 * It exists as much to prove the shape as to be used. Once this works, every other
 * cross-department workflow is the same pattern with different departments.
 */

/**
 * `runDepartment` can legitimately decline to run — automation paused, budget
 * exhausted — so its result is a union, and narrowing it is not ceremony.
 *
 * Without this check a campaign started while paused would walk through every
 * stage on empty output and file a confident report about work that never
 * happened. TypeScript caught exactly that.
 */
function ran(result: unknown): result is { runId: string; costMicros: number; text: string } {
  return typeof result === 'object' && result !== null && 'runId' in result
}

function skipReason(result: unknown): string {
  return typeof result === 'object' && result !== null && 'reason' in result
    ? String(result.reason)
    : 'the run was skipped'
}

export const runCampaign = inngest.createFunction(
  {
    id: 'campaign-orchestration',
    name: 'Run a campaign across departments',
    triggers: [CampaignRequested],
    // One at a time per workspace. Two campaigns writing content and outreach
    // concurrently would compete for the operator's approval queue and make it
    // impossible to tell which brief a draft belongs to.
    concurrency: [{ key: 'event.data.workspaceId', limit: 1 }],
    retries: 1,
  },
  async ({ event, step }) => {
    const { workspaceId, brief, include } = event.data
    const wanted = (department: string) =>
      include === undefined || include.includes(department as never)

    const campaign = await step.run('create-campaign', async () =>
      prisma.campaign.create({
        data: {
          workspaceId,
          name: `${brief.slice(0, 60)} (${new Date().toISOString().slice(0, 10)})`,
          brief,
          status: 'draft',
        },
        select: { id: true, name: true },
      }),
    )

    const plan = await step.invoke('ceo-brief', {
      function: runDepartment,
      data: {
        workspaceId,
        department: 'ceo' as const,
        trigger: 'event' as const,
        objective:
          `Turn this into a brief the other departments can act on: "${brief}". ` +
          `Say what outcome we want, what constraints apply, and what "done" looks like. ` +
          `Do not delegate — the workflow does that. Keep it under 200 words.`,
      },
    })

    // If the company would not even brief this, nothing downstream is meaningful.
    if (!ran(plan)) {
      await step.run('abandon', async () => {
        await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'paused' } })
      })

      return {
        campaignId: campaign.id,
        launched: false,
        reason: `not started: ${skipReason(plan)}`,
      }
    }

    const parentRunId = plan.runId

    /**
     * Research and Finance in parallel — neither needs the other's output, and
     * sequencing them would double the wait for nothing.
     */
    const [research, budget] = await Promise.all([
      wanted('research')
        ? step.invoke('research', {
            function: runDepartment,
            data: {
              workspaceId,
              department: 'research' as const,
              trigger: 'delegation' as const,
              parentRunId,
              objective:
                `For this campaign brief, find out what is actually true about the market and ` +
                `the competition: "${brief}". Cite sources with dates. Say what you could not find.`,
            },
          })
        : Promise.resolve(null),

      wanted('finance')
        ? step.invoke('budget', {
            function: runDepartment,
            data: {
              workspaceId,
              department: 'finance' as const,
              trigger: 'delegation' as const,
              parentRunId,
              objective:
                `Estimate what this campaign can afford: "${brief}". Base it on actual cash and ` +
                `recent spend, not a percentage of an imagined budget. State the method.`,
            },
          })
        : Promise.resolve(null),
    ])

    const creative = wanted('marketing')
      ? await step.invoke('creative', {
          function: runDepartment,
          data: {
            workspaceId,
            department: 'marketing' as const,
            trigger: 'delegation' as const,
            parentRunId,
            objective:
              `Draft the content for this campaign: "${brief}". Research said: ` +
              `${summarise(research)}. Finance said: ${summarise(budget)}. ` +
              `Write in the operator's voice, create the content items, and publish nothing.`,
          },
        })
      : null

    const outreach = wanted('sales')
      ? await step.invoke('outreach', {
          function: runDepartment,
          data: {
            workspaceId,
            department: 'sales' as const,
            trigger: 'delegation' as const,
            parentRunId,
            objective:
              `Prepare outreach for this campaign: "${brief}". Draft the sequence, score who it ` +
              `should go to, and stage it. Send nothing.`,
          },
        })
      : null

    /**
     * The gate.
     *
     * A campaign is exactly the kind of thing that must not go out on an agent's
     * judgment, so the whole workflow parks here. `waitForEvent` returning null
     * means the operator never answered — and that resolves to not launched.
     */
    const approval = await step.run('request-launch-approval', async () => {
      const department = await prisma.department.findUniqueOrThrow({
        where: { workspaceId_key: { workspaceId, key: 'ceo' } },
        select: { id: true },
      })

      return prisma.approvalRequest.create({
        data: {
          workspaceId,
          departmentId: department.id,
          runId: parentRunId,
          status: 'pending',
          risk: 'external',
          title: `Launch campaign: ${campaign.name}`,
          summary:
            'Marketing has drafted the content and Sales has staged the outreach. ' +
            'Approving schedules it; nothing has been published or sent yet.',
          payload: { campaignId: campaign.id, brief },
          expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
          resumeEvent: 'nexus/approval.responded',
        },
        select: { id: true },
      })
    })

    await step.sendEvent(
      'notify-operator',
      ApprovalRequested.create({
        workspaceId,
        approvalId: approval.id,
        department: 'ceo',
        risk: 'external',
        title: `Launch campaign: ${campaign.name}`,
      }),
    )

    /**
     * `if`, not `match`.
     *
     * `match: 'data.approvalId'` compares a field on the *triggering* event to the
     * same field on the awaited one. This function is triggered by
     * `campaign.requested`, which has no approvalId — so the match could never
     * succeed, and the workflow sat parked forever after the operator approved.
     *
     * The approval id is only known at runtime, so it goes into the expression.
     */
    const decision = await step.waitForEvent('await-launch-decision', {
      event: ApprovalResponded,
      if: `async.data.approvalId == "${approval.id}"`,
      timeout: '72h',
    })

    if (!decision?.data.approved) {
      await step.run('mark-not-launched', async () => {
        await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'paused' } })
      })

      return {
        campaignId: campaign.id,
        launched: false,
        reason: decision ? 'rejected by the operator' : 'no decision before the deadline',
      }
    }

    if (wanted('operations')) {
      await step.invoke('schedule', {
        function: runDepartment,
        data: {
          workspaceId,
          department: 'operations' as const,
          trigger: 'delegation' as const,
          parentRunId,
          objective:
            `The operator approved campaign "${campaign.name}". Schedule the approved content and ` +
            `the outreach sequence. Anything that actually publishes or sends still needs its own ` +
            `approval — stage it, do not fire it.`,
        },
      })
    }

    await step.run('activate-campaign', async () => {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'active', startsAt: new Date() },
      })
    })

    const report = await step.invoke('final-report', {
      function: runDepartment,
      data: {
        workspaceId,
        department: 'ceo' as const,
        trigger: 'delegation' as const,
        parentRunId,
        objective:
          `Write one campaign report for "${campaign.name}". What each department produced, what ` +
          `it cost, what is scheduled, and what still needs a decision from me. File it as a ` +
          `campaign report. Do not restate the brief back to me.`,
      },
    })

    return {
      campaignId: campaign.id,
      launched: true,
      runIds: {
        brief: parentRunId,
        research: ran(research) ? research.runId : null,
        budget: ran(budget) ? budget.runId : null,
        creative: ran(creative) ? creative.runId : null,
        outreach: ran(outreach) ? outreach.runId : null,
        report: ran(report) ? report.runId : null,
      },
    }
  },
)

/**
 * An upstream department's output, short enough for prompt context — and honest
 * when there is none, so a downstream department is not left inferring that
 * silence meant agreement.
 */
function summarise(result: unknown, limit = 600): string {
  if (result === null) return 'nothing (that department was skipped)'
  if (!ran(result)) return `nothing — that department did not run (${skipReason(result)})`

  return result.text.length > limit ? `${result.text.slice(0, limit)}…` : result.text
}
