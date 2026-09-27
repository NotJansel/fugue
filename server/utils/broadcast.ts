import { randomUUID } from 'node:crypto'
import type { Broadcast } from '#shared/types'
import { emitChange } from './bus'
import { query } from './db'
import { serialiser } from './store-queue'

/** The longest message an organiser can send - a notice, not a letter. */
export const BROADCAST_MAX_LENGTH = 500

/** The longest a message can be put up for, in seconds. Anything meant to stay longer can stay until closed. */
export const BROADCAST_MAX_SECONDS = 3600

/**
 * The message up on every dashboard, if any. Kept in the database (table `broadcast`, one row at
 * most) so it outlasts a restart - a deploy mid-evening reloads every open tab, and a notice about
 * a break must still be there when they come back.
 */
let last: Broadcast | null = null

const write = serialiser()

interface BroadcastRow {
  broadcast_id: string
  message: string
  sender: string
  sent_at: string
  duration_ms: number | null
}

export async function loadBroadcast(): Promise<void> {
  const [row] = await query<BroadcastRow>('SELECT * FROM broadcast')

  last = row
    ? {
        id: row.broadcast_id,
        message: row.message,
        from: row.sender,
        // bigint comes back as a string, so it does not lose precision past 2^53.
        at: Number(row.sent_at),
        durationMs: row.duration_ms
      }
    : null
}

export const lastBroadcast = (): Broadcast | null => last

/**
 * Sends `message` to every open dashboard, over the same state push everything else rides on. It
 * stays up for `durationMs`, or until each viewer closes it when that is `null`.
 */
export function sendBroadcast(message: string, from: string, durationMs: number | null): Promise<Broadcast> {
  const next: Broadcast = { id: randomUUID(), message, from, at: Date.now(), durationMs }

  return write(async () => {
    await query(
      `INSERT INTO broadcast (id, broadcast_id, message, sender, sent_at, duration_ms)
       VALUES (true, $1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         broadcast_id = EXCLUDED.broadcast_id,
         message = EXCLUDED.message,
         sender = EXCLUDED.sender,
         sent_at = EXCLUDED.sent_at,
         duration_ms = EXCLUDED.duration_ms`,
      [next.id, next.message, next.from, next.at, next.durationMs]
    )

    last = next
    emitChange()

    return next
  })
}

/** Takes the message down on every open dashboard. Returns whether there was one to take down. */
export function clearBroadcast(): Promise<boolean> {
  return write(async () => {
    if (!last) return false

    await query('DELETE FROM broadcast')

    last = null
    emitChange()

    return true
  })
}
