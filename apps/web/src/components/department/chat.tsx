'use client'

import { useChat } from '@ai-sdk/react'
import type { DepartmentId } from '@nexusai/core'
import { Badge, Button, cn } from '@nexusai/ui'
import { DefaultChatTransport } from 'ai'
import { ArrowUpIcon, Loader2Icon, ShieldAlertIcon, WrenchIcon } from 'lucide-react'
import Link from 'next/link'
import { useRef, useState, type FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface ChatProps {
  department: DepartmentId
  displayName: string
  suggestions: string[]
}

/**
 * The conversation.
 *
 * Tool calls are rendered, not hidden. Watching the CEO search memory before it
 * answers is what makes the difference between trusting the answer and taking it
 * on faith — and when something parks for approval, the operator needs to see
 * that immediately rather than read a sentence claiming it was done.
 */
export function DepartmentChat({ department, displayName, suggestions }: ChatProps) {
  const [input, setInput] = useState('')
  const formRef = useRef<HTMLFormElement>(null)

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: `/api/departments/${department}/chat` }),
  })

  const busy = status === 'submitted' || status === 'streaming'

  function submit(event?: FormEvent) {
    event?.preventDefault()

    const text = input.trim()
    if (text === '' || busy) return

    setInput('')
    void sendMessage({ text })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {messages.length === 0 ? (
            <Opening
              displayName={displayName}
              suggestions={suggestions}
              onPick={(text) => {
                setInput(text)
                formRef.current?.requestSubmit()
              }}
            />
          ) : null}

          {messages.map((message) => (
            <Message key={message.id} role={message.role} parts={message.parts} />
          ))}

          {busy && messages.at(-1)?.role === 'user' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
              Thinking…
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="border-l-2 border-destructive/60 pl-3 text-sm text-destructive"
            >
              {error.message}
            </p>
          ) : null}
        </div>
      </div>

      <form
        ref={formRef}
        onSubmit={submit}
        className="border-t border-border bg-background/80 px-5 py-4 backdrop-blur"
      >
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-lg border border-input p-2 focus-within:ring-2 focus-within:ring-ring">
          <textarea
            value={input}
            onChange={(event) => {
              setInput(event.target.value)
            }}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter breaks the line. The opposite of a
              // document editor, because this is a conversation.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
            rows={1}
            placeholder={`Ask ${displayName} something…`}
            aria-label={`Message ${displayName}`}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
          />
          <Button type="submit" size="icon" disabled={busy || input.trim() === ''}>
            {busy ? <Loader2Icon className="animate-spin" /> : <ArrowUpIcon />}
            <span className="sr-only">Send</span>
          </Button>
        </div>
      </form>
    </div>
  )
}

function Opening({
  displayName,
  suggestions,
  onPick,
}: {
  displayName: string
  suggestions: string[]
  onPick: (text: string) => void
}) {
  return (
    <div className="flex flex-col gap-4 py-8">
      <p className="text-sm text-muted-foreground">
        {displayName} reads long-term memory before answering, and cites what it used.
      </p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => {
              onPick(suggestion)
            }}
            className="rounded-md border border-border px-3 py-1.5 text-left text-sm transition-colors hover:border-ring hover:bg-accent"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
}

interface MessagePart {
  type: string
  text?: string
  toolCallId?: string
  state?: string
  input?: unknown
  output?: unknown
}

function Message({ role, parts }: { role: string; parts: readonly MessagePart[] }) {
  const isUser = role === 'user'

  return (
    <div className={cn('flex flex-col gap-2', isUser ? 'items-end' : 'items-start')}>
      {parts.map((part, index) => {
        if (part.type === 'text' && part.text) {
          return (
            <div
              key={index}
              className={cn(
                'max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm',
                isUser
                  ? 'bg-primary text-primary-foreground'
                  : 'prose-sm border border-border bg-card',
              )}
            >
              {isUser ? (
                <span className="whitespace-pre-wrap">{part.text}</span>
              ) : (
                <Markdown>{part.text}</Markdown>
              )}
            </div>
          )
        }

        if (part.type.startsWith('tool-')) {
          return <ToolCall key={index} name={part.type.slice(5)} part={part} />
        }

        return null
      })}
    </div>
  )
}

/**
 * A tool call, rendered inline.
 *
 * The approval case gets its own treatment because it is the one the operator
 * must not skim past: nothing happened, and something is waiting for them.
 */
function ToolCall({ name, part }: { name: string; part: MessagePart }) {
  const output = part.output as { status?: string; approvalId?: string; found?: number } | undefined
  const parked = output?.status === 'awaiting_approval'
  const running = part.state !== 'output-available' && part.state !== 'output-error'

  if (parked) {
    return (
      <div className="flex w-full max-w-[85%] items-start gap-2.5 rounded-md border border-warning/50 bg-warning/8 px-3 py-2.5">
        <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Waiting for your approval — nothing has happened yet</span>
          <Link
            href="/approvals"
            className="text-xs text-muted-foreground underline underline-offset-2"
          >
            Review it in Approvals
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
      {running ? (
        <Loader2Icon className="size-3 animate-spin" aria-hidden />
      ) : (
        <WrenchIcon className="size-3" aria-hidden />
      )}
      <span>{name}</span>
      {typeof output?.found === 'number' ? (
        <Badge variant="outline">{output.found} from memory</Badge>
      ) : null}
    </div>
  )
}

function Markdown({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-3 [&_a]:text-primary [&_a]:underline [&_code]:font-mono [&_code]:text-[0.85em] [&_li]:ml-4 [&_li]:list-disc [&_p]:leading-relaxed [&_strong]:font-semibold">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}
