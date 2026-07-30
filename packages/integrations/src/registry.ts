import type { AnyConnector, Capability } from './connector'

/**
 * The connector registry.
 *
 * Holds definitions only — never credentials, never live clients. A registry that
 * cached connected clients would keep decrypted tokens in memory for the process
 * lifetime; instead a client is built per use and discarded, which costs a
 * handshake and removes a whole class of leak.
 */
export class ConnectorRegistry {
  private readonly connectors = new Map<string, AnyConnector>()

  register(...connectors: AnyConnector[]): this {
    for (const connector of connectors) {
      if (this.connectors.has(connector.id)) {
        throw new Error(`Connector "${connector.id}" is already registered.`)
      }
      this.connectors.set(connector.id, connector)
    }
    return this
  }

  get(id: string): AnyConnector | undefined {
    return this.connectors.get(id)
  }

  /** Throws rather than returning undefined, for call sites that cannot continue without it. */
  require(id: string): AnyConnector {
    const connector = this.connectors.get(id)
    if (!connector) {
      throw new Error(
        `Unknown connector "${id}". Registered: ${this.ids().join(', ') || '(none)'}.`,
      )
    }
    return connector
  }

  ids(): string[] {
    return [...this.connectors.keys()].sort()
  }

  all(): AnyConnector[] {
    return this.ids().map((id) => this.connectors.get(id)!)
  }

  /** Every connector that can do something — used to answer "how do I send email?" */
  providing(capability: Capability): AnyConnector[] {
    return this.all().filter((connector) => connector.capabilities.includes(capability))
  }

  /**
   * The capability catalogue, for the settings UI.
   *
   * Answers the question the operator actually has — "what can this system do
   * once I connect things, and what is still unavailable?" — rather than listing
   * providers and leaving them to work it out.
   */
  catalogue(): { capability: Capability; connectors: string[] }[] {
    const map = new Map<Capability, string[]>()

    for (const connector of this.all()) {
      for (const capability of connector.capabilities) {
        map.set(capability, [...(map.get(capability) ?? []), connector.id])
      }
    }

    return [...map.entries()]
      .map(([capability, connectors]) => ({ capability, connectors }))
      .sort((a, b) => a.capability.localeCompare(b.capability))
  }
}
