import { randomUUID } from 'node:crypto'
import type { Broadcast } from '#shared/types'
import { emitChange } from './bus'

/** The longest message an organiser can send - a notice, not a letter. */
export const BROADCAST_MAX_LENGTH = 500

/**
 * The last message sent to every dashboard. Like an auction result it is not persisted: it is news
 * for whoever has the page open when it goes out, and a restart has nothing to tell anyone.
 */
let last: Broadcast | null = null

export const lastBroadcast = (): Broadcast | null => last

/** Sends `message` to every open dashboard, over the same state push everything else rides on. */
export function sendBroadcast(message: string, from: string): Broadcast {
  last = { id: randomUUID(), message, from, at: Date.now() }
  emitChange()

  return last
}
