import { randomUUID } from 'node:crypto'
import type { Broadcast } from '#shared/types'
import { emitChange } from './bus'

/** The longest message an organiser can send - a notice, not a letter. */
export const BROADCAST_MAX_LENGTH = 500

/** The longest a message can be put up for, in seconds. Anything meant to stay longer can stay until closed. */
export const BROADCAST_MAX_SECONDS = 3600

/**
 * The last message sent to every dashboard. Like an auction result it is not persisted: it is news
 * for whoever has the page open when it goes out, and a restart has nothing to tell anyone.
 */
let last: Broadcast | null = null

export const lastBroadcast = (): Broadcast | null => last

/** Takes the message down on every open dashboard. Returns whether there was one to take down. */
export function clearBroadcast(): boolean {
  if (!last) return false

  last = null
  emitChange()

  return true
}

/**
 * Sends `message` to every open dashboard, over the same state push everything else rides on. It
 * stays up for `durationMs`, or until each viewer closes it when that is `null`.
 */
export function sendBroadcast(message: string, from: string, durationMs: number | null): Broadcast {
  last = { id: randomUUID(), message, from, at: Date.now(), durationMs }
  emitChange()

  return last
}
