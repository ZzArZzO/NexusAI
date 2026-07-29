import { loadAgent } from '@nexusai/agents'
import { assert, departmentIdSchema, isNexusError } from '@nexusai/core'
import { prisma } from '@nexusai/db'
import { convertToModelMessages, type UIMessage } from 'ai'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireActor } from '@/lib/session'

/**
 * Interactive chat with a department.
 *
 * Everything the operator sees comes through here, so this is where the two
 * non-negotiables live: the Policy check happens before anything is loaded, and
 * the conversation is persisted before the stream starts — a client that
 * disconnects mid-answer must still leave a durable record of what was asked.
 */

const bodySchema = z.object({
  messages: z.array(z.custom<UIMessage>()),
  conversationId: z.uuid().optional(),
})

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params

  const parsedKey = departmentIdSchema.safeParse(key)
  if (!parsedKey.success) {
    return NextResponse.json({ error: `Unknown department "${key}".` }, { status: 404 })
  }

  try {
    const { actor, workspace } = await requireActor()

    // Running a department costs money and takes actions; reading about one does
    // not. They are different permissions, checked here rather than in the UI.
    assert(actor, 'department:run', { workspaceId: workspace.id })

    const body = bodySchema.safeParse(await request.json())
    if (!body.success) {
      return NextResponse.json({ error: 'Malformed request.' }, { status: 400 })
    }

    const uiMessages = body.data.messages
    const lastUserMessage = [...uiMessages].reverse().find((message) => message.role === 'user')

    const userQuery = (lastUserMessage?.parts ?? [])
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join(' ')
      .trim()

    if (userQuery === '') {
      return NextResponse.json({ error: 'Say something first.' }, { status: 400 })
    }

    const department = await prisma.department.findUniqueOrThrow({
      where: { workspaceId_key: { workspaceId: workspace.id, key: parsedKey.data } },
      select: { id: true },
    })

    const conversation = await ensureConversation({
      workspaceId: workspace.id,
      departmentId: department.id,
      userId: actor.id,
      conversationId: body.data.conversationId,
      title: userQuery.slice(0, 80),
    })

    await prisma.message.create({
      data: { conversationId: conversation.id, role: 'user', content: userQuery },
    })

    const agent = await loadAgent({
      prisma,
      workspaceId: workspace.id,
      department: parsedKey.data,
    })

    const { runId, result } = await agent.stream({
      messages: await convertToModelMessages(uiMessages),
      conversationId: conversation.id,
      userQuery,
    })

    return result.toUIMessageStreamResponse({
      // The client needs these to link the answer back to its run timeline and
      // to keep writing into the same conversation.
      headers: {
        'X-Nexus-Run-Id': runId,
        'X-Nexus-Conversation-Id': conversation.id,
      },

      onFinish: async ({ responseMessage }) => {
        const text = (responseMessage.parts ?? [])
          .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
          .map((part) => part.text)
          .join('')

        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: 'assistant',
            content: text,
            parts: responseMessage.parts as never,
            runId,
          },
        })
      },
    })
  } catch (error) {
    if (isNexusError(error)) {
      return NextResponse.json({ error: error.userMessage }, { status: error.status })
    }

    console.error('Chat failed:', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

async function ensureConversation(params: {
  workspaceId: string
  departmentId: string
  userId: string
  conversationId: string | undefined
  title: string
}) {
  if (params.conversationId) {
    return prisma.conversation.update({
      where: { id: params.conversationId },
      data: { updatedAt: new Date() },
      select: { id: true },
    })
  }

  return prisma.conversation.create({
    data: {
      workspaceId: params.workspaceId,
      departmentId: params.departmentId,
      userId: params.userId,
      title: params.title,
    },
    select: { id: true },
  })
}
