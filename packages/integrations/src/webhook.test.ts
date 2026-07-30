import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createConnectorRegistry, github, slack, stripe } from './connectors/index'
import { verifyHmac, withinTolerance } from './webhook'

/**
 * Signature verification, tested against payloads built the way each provider
 * builds them.
 *
 * These are the tests that matter most in this package: a verifier that accepts
 * everything is indistinguishable from one that works, right up until someone
 * posts to the endpoint. So every case here asserts both directions — the valid
 * signature passes *and* a forged one fails.
 */

const SECRET = 'whsec_test_secret_value'

describe('verifyHmac', () => {
  it('accepts a correct signature', () => {
    const body = '{"hello":"world"}'
    const signature = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`

    expect(verifyHmac({ signedPayload: body, secret: SECRET, signature, prefix: 'sha256=' })).toBe(
      true,
    )
  })

  it('rejects a signature made with a different secret', () => {
    const body = '{"hello":"world"}'
    const signature = `sha256=${createHmac('sha256', 'wrong').update(body).digest('hex')}`

    expect(verifyHmac({ signedPayload: body, secret: SECRET, signature, prefix: 'sha256=' })).toBe(
      false,
    )
  })

  it('rejects a signature over a different body', () => {
    const signature = `sha256=${createHmac('sha256', SECRET).update('{"a":1}').digest('hex')}`

    expect(
      verifyHmac({ signedPayload: '{"a":2}', secret: SECRET, signature, prefix: 'sha256=' }),
    ).toBe(false)
  })

  it('rejects an empty signature', () => {
    expect(
      verifyHmac({ signedPayload: '{}', secret: SECRET, signature: '', prefix: 'sha256=' }),
    ).toBe(false)
  })
})

describe('withinTolerance', () => {
  it('accepts a fresh timestamp', () => {
    expect(withinTolerance(Math.floor(Date.now() / 1000))).toBe(true)
  })

  it('rejects one older than the tolerance', () => {
    expect(withinTolerance(Math.floor(Date.now() / 1000) - 3600)).toBe(false)
  })

  it('rejects one from the future beyond the tolerance', () => {
    // Clock skew cuts both ways; a signature dated an hour ahead is as suspect as
    // one an hour behind.
    expect(withinTolerance(Math.floor(Date.now() / 1000) + 3600)).toBe(false)
  })
})

describe('github webhooks', () => {
  const body = '{"action":"opened","number":7}'

  it('verifies a real GitHub signature and reads the delivery id', () => {
    const result = github.verifyWebhook!(
      {
        rawBody: body,
        headers: {
          'x-github-delivery': 'd-123',
          'x-github-event': 'pull_request',
          'x-hub-signature-256': `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`,
        },
      },
      SECRET,
    )

    expect(result).toEqual({ externalId: 'd-123', eventType: 'pull_request', signatureOk: true })
  })

  it('records the delivery id even when the signature fails', () => {
    // The row is still written, so a probe against the endpoint leaves a trace.
    const result = github.verifyWebhook!(
      {
        rawBody: body,
        headers: {
          'x-github-delivery': 'd-456',
          'x-github-event': 'push',
          'x-hub-signature-256': 'sha256=deadbeef',
        },
      },
      SECRET,
    )

    expect(result).toEqual({ externalId: 'd-456', eventType: 'push', signatureOk: false })
  })
})

describe('stripe webhooks', () => {
  const body = '{"id":"evt_1234","type":"charge.succeeded"}'

  function sign(timestamp: number, secret = SECRET): string {
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
    return `t=${timestamp},v1=${signature}`
  }

  it('verifies the timestamped scheme', () => {
    const now = Math.floor(Date.now() / 1000)
    const result = stripe.verifyWebhook!(
      { rawBody: body, headers: { 'stripe-signature': sign(now) } },
      SECRET,
    )

    expect(result).toEqual({
      externalId: 'evt_1234',
      eventType: 'charge.succeeded',
      signatureOk: true,
    })
  })

  it('rejects a replayed event whose signature is still valid', () => {
    // The signature verifies; only the timestamp check stops this. Without it a
    // captured webhook can be replayed indefinitely.
    const old = Math.floor(Date.now() / 1000) - 7200
    const result = stripe.verifyWebhook!(
      { rawBody: body, headers: { 'stripe-signature': sign(old) } },
      SECRET,
    )

    expect(result.signatureOk).toBe(false)
  })

  it('accepts any one of several v1 signatures during a secret rotation', () => {
    const now = Math.floor(Date.now() / 1000)
    const wrong = createHmac('sha256', 'old-secret').update(`${now}.${body}`).digest('hex')
    const right = createHmac('sha256', SECRET).update(`${now}.${body}`).digest('hex')

    const result = stripe.verifyWebhook!(
      { rawBody: body, headers: { 'stripe-signature': `t=${now},v1=${wrong},v1=${right}` } },
      SECRET,
    )

    expect(result.signatureOk).toBe(true)
  })

  it('rejects a header with no timestamp', () => {
    const result = stripe.verifyWebhook!(
      { rawBody: body, headers: { 'stripe-signature': 'v1=abc' } },
      SECRET,
    )

    expect(result.signatureOk).toBe(false)
  })
})

describe('slack webhooks', () => {
  const body = '{"type":"event_callback","event_id":"Ev123"}'

  it('verifies the v0 scheme', () => {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = `v0=${createHmac('sha256', SECRET)
      .update(`v0:${timestamp}:${body}`)
      .digest('hex')}`

    const result = slack.verifyWebhook!(
      {
        rawBody: body,
        headers: { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature },
      },
      SECRET,
    )

    expect(result.signatureOk).toBe(true)
    expect(result.externalId).toBe('Ev123')
  })

  it('rejects a stale request', () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 600)
    const signature = `v0=${createHmac('sha256', SECRET)
      .update(`v0:${timestamp}:${body}`)
      .digest('hex')}`

    const result = slack.verifyWebhook!(
      {
        rawBody: body,
        headers: { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature },
      },
      SECRET,
    )

    expect(result.signatureOk).toBe(false)
  })
})

describe('connector registry', () => {
  const registry = createConnectorRegistry()

  it('registers every connector under a unique id', () => {
    expect(registry.ids()).toEqual(['github', 'google', 'mcp', 'notion', 'slack', 'stripe'])
  })

  it('refuses to register the same id twice', () => {
    expect(() => registry.register(github)).toThrow(/already registered/)
  })

  it('names the connectors that provide a capability', () => {
    expect(registry.providing('email.send').map((c) => c.id)).toEqual(['google'])
    expect(registry.providing('payments.read').map((c) => c.id)).toEqual(['stripe'])
  })

  it('throws a useful error for an unknown connector', () => {
    expect(() => registry.require('salesforce')).toThrow(/Unknown connector "salesforce"/)
  })

  it('exposes no connector that can move money', () => {
    // Stripe is read-only by design: moving money stays behind Finance's
    // payment.send, which needs an approval and a second confirmation. A
    // connector with payments.write would be a way around that.
    expect(registry.providing('payments.write')).toEqual([])
  })
})
