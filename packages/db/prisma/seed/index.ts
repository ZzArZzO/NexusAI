import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { PrismaPg } from '@prisma/adapter-pg'
import { config } from 'dotenv'

import { PrismaClient } from '../../generated/client'
import { DEPARTMENT_SEEDS } from './charters'
import { PERMISSIONS, ROLES } from './permissions'
import { GOALS, KPIS, MEMORY, PLACEHOLDER_MARKER, TASKS } from './placeholder'

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true })

/**
 * Idempotent seed. Every write is an upsert keyed on something stable, so this
 * doubles as "bring my database up to date" and can be run after every pull.
 *
 * What it deliberately does NOT do: overwrite your real content. Goals, KPIs and
 * tasks are seeded only when the workspace has none, so re-running never
 * resurrects a placeholder you deleted or overwrites one you edited.
 */

const WORKSPACE_SLUG = process.env['SEED_WORKSPACE_SLUG'] ?? 'nexus'
const WORKSPACE_NAME = process.env['SEED_WORKSPACE_NAME'] ?? 'NexusAI'
const TIMEZONE = process.env['SEED_TIMEZONE'] ?? 'Europe/Lisbon'
const CURRENCY = process.env['SEED_CURRENCY'] ?? 'EUR'

const MEMORY_DIR = fileURLToPath(new URL('./memory/', import.meta.url))

function log(message: string): void {
  console.warn(`  ${message}`)
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function main(): Promise<void> {
  const connectionString = process.env['DIRECT_DATABASE_URL'] ?? process.env['DATABASE_URL']
  if (!connectionString) {
    throw new Error('DIRECT_DATABASE_URL or DATABASE_URL must be set to seed the database.')
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

  try {
    console.warn('\nSeeding NexusAI\n')

    // ─── Workspace ───────────────────────────────────────────────
    const workspace = await prisma.workspace.upsert({
      where: { slug: WORKSPACE_SLUG },
      update: { name: WORKSPACE_NAME, timezone: TIMEZONE, currency: CURRENCY },
      create: {
        slug: WORKSPACE_SLUG,
        name: WORKSPACE_NAME,
        timezone: TIMEZONE,
        currency: CURRENCY,
      },
    })
    log(`workspace "${workspace.slug}" (${TIMEZONE}, ${CURRENCY})`)

    // ─── Settings ────────────────────────────────────────────────
    const settings = [
      {
        key: 'automation.paused',
        value: false,
        description:
          'Global kill switch. When true, every autonomous workflow halts before its first step.',
      },
      {
        key: 'automation.default_approval_timeout',
        value: '72h',
        description: 'How long an approval gate waits before expiring as not-done.',
      },
      {
        key: 'automation.monthly_budget_micros',
        value: 100_000_000,
        description:
          'Monthly model spend ceiling in micro-dollars ($100). Runs refuse to start above it.',
      },
    ]

    for (const setting of settings) {
      await prisma.systemSetting.upsert({
        where: { workspaceId_key: { workspaceId: workspace.id, key: setting.key } },
        update: { description: setting.description },
        create: { workspaceId: workspace.id, ...setting },
      })
    }
    log(`${settings.length} settings`)

    // ─── Permissions ─────────────────────────────────────────────
    for (const permission of PERMISSIONS) {
      await prisma.permission.upsert({
        where: {
          resource_action: { resource: permission.resource, action: permission.action },
        },
        update: { description: permission.description },
        create: permission,
      })
    }
    log(`${PERMISSIONS.length} permissions`)

    const allPermissions = await prisma.permission.findMany()
    const permissionByKey = new Map(allPermissions.map((p) => [`${p.resource}:${p.action}`, p.id]))

    // ─── Roles ───────────────────────────────────────────────────
    for (const role of ROLES) {
      const created = await prisma.role.upsert({
        where: { workspaceId_key: { workspaceId: workspace.id, key: role.key } },
        update: { name: role.name, description: role.description },
        create: {
          workspaceId: workspace.id,
          key: role.key,
          name: role.name,
          description: role.description,
          isSystem: true,
        },
      })

      const granted = role.permissions === '*' ? [...permissionByKey.keys()] : role.permissions

      // Replace rather than merge: the matrix in code is the source of truth,
      // so a permission removed there must actually disappear.
      await prisma.rolePermission.deleteMany({ where: { roleId: created.id } })
      await prisma.rolePermission.createMany({
        data: granted
          .map((key) => permissionByKey.get(key))
          .filter((id): id is string => id !== undefined)
          .map((permissionId) => ({ roleId: created.id, permissionId })),
        skipDuplicates: true,
      })
    }
    log(`${ROLES.length} roles with their permission matrix`)

    // ─── Departments ─────────────────────────────────────────────
    for (const seed of DEPARTMENT_SEEDS) {
      const department = await prisma.department.upsert({
        where: { workspaceId_key: { workspaceId: workspace.id, key: seed.key } },
        update: { displayName: seed.displayName, charter: seed.charter },
        create: {
          workspaceId: workspace.id,
          key: seed.key,
          displayName: seed.displayName,
          charter: seed.charter,
        },
      })

      await prisma.departmentConfig.upsert({
        where: { departmentId: department.id },
        update: {
          memoryScopes: seed.memoryScopes,
          autoApprove: seed.autoApprove,
          maxSteps: seed.maxSteps,
        },
        create: {
          departmentId: department.id,
          memoryScopes: seed.memoryScopes,
          autoApprove: seed.autoApprove,
          maxSteps: seed.maxSteps,
        },
      })
    }
    log(`${DEPARTMENT_SEEDS.length} departments with charters and config`)

    const departmentsByKey = new Map(
      (await prisma.department.findMany({ where: { workspaceId: workspace.id } })).map((d) => [
        d.key as string,
        d.id,
      ]),
    )

    // ─── Placeholder goals ───────────────────────────────────────
    // Only seeded when the workspace has none, so re-running never resurrects
    // placeholders the operator has deleted.
    const existingGoals = await prisma.goal.count({ where: { workspaceId: workspace.id } })
    if (existingGoals === 0) {
      for (const goal of GOALS) {
        await prisma.goal.create({
          data: {
            workspaceId: workspace.id,
            title: goal.title,
            description: goal.description,
            horizon: goal.horizon,
            ...(goal.ownerKey === undefined ? {} : { ownerKey: goal.ownerKey as never }),
            ...(goal.dueInDays === undefined ? {} : { targetDate: daysFromNow(goal.dueInDays) }),
          },
        })
      }
      log(`${GOALS.length} placeholder goals`)
    } else {
      log(`goals: ${existingGoals} already present, left alone`)
    }

    // ─── Placeholder KPIs ────────────────────────────────────────
    const existingKpis = await prisma.kpi.count({ where: { workspaceId: workspace.id } })
    if (existingKpis === 0) {
      for (const kpi of KPIS) {
        const created = await prisma.kpi.create({
          data: {
            workspaceId: workspace.id,
            key: kpi.key,
            name: kpi.name,
            unit: kpi.unit,
            direction: kpi.direction,
            target: kpi.target,
            ownerKey: kpi.ownerKey as never,
          },
        })

        // One measurement per week, oldest first, so charts have a shape.
        for (const [index, value] of kpi.history.entries()) {
          const weeksAgo = kpi.history.length - index
          await prisma.kpiSnapshot.create({
            data: {
              kpiId: created.id,
              value,
              observedAt: daysFromNow(-weeksAgo * 7),
              source: 'seed',
            },
          })
        }
      }
      log(`${KPIS.length} placeholder KPIs with history`)
    } else {
      log(`KPIs: ${existingKpis} already present, left alone`)
    }

    // ─── Memory ──────────────────────────────────────────────────
    // Documents are stored without embeddings. The backfill job embeds them on
    // its next pass, which is why seeding costs nothing and needs no API key.
    let memoryCount = 0
    const memoryDocuments = [...MEMORY.map((m) => ({ ...m, sourceRef: 'seed:placeholder' }))]

    // Anything the operator drops into seed/memory/*.md joins the same pipeline.
    try {
      const files = await readdir(MEMORY_DIR)
      for (const file of files.filter((f) => f.endsWith('.md'))) {
        const content = await readFile(new URL(file, `file://${MEMORY_DIR}`), 'utf8')
        memoryDocuments.push({
          kind: 'note',
          title: file.replace(/\.md$/, '').replace(/[-_]/g, ' '),
          content,
          scopes: ['company'],
          sourceRef: `seed:file:${file}`,
        })
      }
    } catch {
      // Directory is optional; its absence is not an error.
    }

    for (const doc of memoryDocuments) {
      const contentHash = hashContent(doc.content)
      await prisma.memoryDocument.upsert({
        where: { workspaceId_contentHash: { workspaceId: workspace.id, contentHash } },
        update: { title: doc.title, scopes: doc.scopes },
        create: {
          workspaceId: workspace.id,
          kind: doc.kind,
          title: doc.title,
          content: doc.content,
          contentHash,
          scopes: doc.scopes,
          sourceRef: doc.sourceRef,
        },
      })
      memoryCount += 1
    }
    log(`${memoryCount} memory documents (awaiting embedding)`)

    // ─── Onboarding tasks ────────────────────────────────────────
    const existingTasks = await prisma.task.count({ where: { workspaceId: workspace.id } })
    if (existingTasks === 0) {
      for (const task of TASKS) {
        const departmentId = departmentsByKey.get(task.departmentKey)
        const created = await prisma.task.create({
          data: {
            workspaceId: workspace.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            dueAt: daysFromNow(task.dueInDays),
            ...(departmentId === undefined ? {} : { departmentId }),
          },
        })
        await prisma.taskEvent.create({
          data: { taskId: created.id, kind: 'created', actor: 'seed' },
        })
      }
      log(`${TASKS.length} onboarding tasks`)
    } else {
      log(`tasks: ${existingTasks} already present, left alone`)
    }

    const placeholders = await prisma.goal.count({
      where: { workspaceId: workspace.id, title: { contains: PLACEHOLDER_MARKER } },
    })

    console.warn('\nSeed complete.')
    if (placeholders > 0) {
      console.warn(
        `\n  ${placeholders} placeholder goals are in place. Until you replace them, the CEO's\n` +
          '  prioritisation is fiction. See packages/db/prisma/seed/README.md.\n',
      )
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('\nSeed failed:', error)
  process.exit(1)
})
