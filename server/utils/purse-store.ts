import { emitChange } from './bus'
import { query } from './db'
import { serialiser } from './store-queue'

/**
 * Purse balances per Discord user, and the funds held against a live bid.
 *
 * Balances live in the `purses` table and are cached here, so the dashboard can render a team's gold
 * without waiting on a query; each change writes the one row it touches.
 *
 * Holds are *not* persisted. A hold only means anything while an auction is running, and an auction
 * does not survive a restart either - so a crash mid-auction releases everyone's money rather than
 * stranding it.
 */
const balances = new Map<string, number>()

const holds = new Map<string, number>()

const write = serialiser()

export async function loadPurses(): Promise<void> {
  const rows = await query<{ discord_id: string, balance: number }>(
    'SELECT discord_id, balance FROM purses'
  )

  balances.clear()
  for (const row of rows) balances.set(row.discord_id, row.balance)
}

export const getBalance = (userId: string): number => balances.get(userId) ?? 0

export const getAllBalances = (): Record<string, number> => Object.fromEntries(balances)

export const getAllHolds = (): Record<string, number> => Object.fromEntries(holds)

/** Writes one balance, in memory and in the database. Negative amounts settle at zero. */
async function store(userId: string, amount: number): Promise<void> {
  const value = Math.max(Math.trunc(amount), 0)

  await write(async () => {
    await query(
      `INSERT INTO purses (discord_id, balance) VALUES ($1, $2)
       ON CONFLICT (discord_id) DO UPDATE SET balance = EXCLUDED.balance`,
      [userId, value]
    )

    balances.set(userId, value)
  })

  emitChange()
}

export const setBalance = (userId: string, amount: number): Promise<void> => store(userId, amount)

/** What the user could still commit: their balance, minus anything already held against a bid. */
const available = (userId: string): number => getBalance(userId) - (holds.get(userId) ?? 0)

/** Whether the user's balance, minus any existing hold, covers `amount`. */
export const canAfford = (userId: string, amount: number): boolean => amount >= 0 && available(userId) >= amount

/**
 * Places a hold for `amount` against the user's available balance, replacing any hold they already
 * have. Returns whether the hold was placed - a balance that doesn't cover it leaves the old hold
 * exactly as it was.
 */
export function reserve(userId: string, amount: number): boolean {
  if (amount < 0 || available(userId) < amount) return false

  holds.set(userId, amount)
  emitChange()

  return true
}

/** Releases any hold placed for the given user without touching their balance. */
export function release(userId: string): void {
  holds.delete(userId)
  emitChange()
}

/** Debits the user's held amount from their balance and clears the hold. Returns true on success. */
export async function settleHold(userId: string, amount: number): Promise<boolean> {
  holds.delete(userId)

  if (amount < 0 || getBalance(userId) < amount) {
    emitChange()

    return false
  }

  await store(userId, getBalance(userId) - amount)

  return true
}
