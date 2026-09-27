import { emitChange } from './bus'

/**
 * Who has the dashboard open right now, by Discord ID - one count per open event stream, since the
 * same person can have it open in several tabs and is only gone once the last one closes.
 *
 * Kept in memory only: it describes connections, and a restart drops every one of them anyway. A
 * browser that goes away without closing its connection is noticed when the next heartbeat on the
 * stream fails to write, within `HEARTBEAT_MS` or so.
 */
const connections = new Map<string, number>()

/** When each account's last open dashboard closed - since this process started. */
const lastSeen = new Map<string, number>()

/**
 * Counts `discordId` as present for as long as one event stream is open, and returns what to call
 * when it closes. Only arriving and leaving altogether is a change worth pushing - a second tab is not.
 */
export function trackPresence(discordId: string): () => void {
  const open = connections.get(discordId) ?? 0
  connections.set(discordId, open + 1)

  if (open === 0) emitChange()

  let left = false

  return () => {
    if (left) return
    left = true

    const remaining = (connections.get(discordId) ?? 1) - 1

    if (remaining > 0) {
      connections.set(discordId, remaining)

      return
    }

    connections.delete(discordId)
    lastSeen.set(discordId, Date.now())
    emitChange()
  }
}

export interface Presence {
  online: boolean
  /** When they last closed the dashboard; `null` if they have not been on it since the restart. */
  lastSeenAt: number | null
}

export const presenceOf = (discordId: string): Presence => ({
  online: connections.has(discordId),
  lastSeenAt: lastSeen.get(discordId) ?? null
})
