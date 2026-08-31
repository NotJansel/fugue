import { emitChange } from './bus'
import { JsonStore } from './json-store'

interface PurseSnapshot {
  balances: Record<string, number>
}

/**
 * Purse balances per Discord user, and the funds held against a live bid.
 *
 * Balances are persisted; holds are not. A hold only means anything while an auction is running, and
 * an auction does not survive a restart either - so a crash mid-auction releases everyone's money
 * rather than stranding it.
 */
const store = new JsonStore<PurseSnapshot>('purses.json', { balances: {} })

const holds = new Map<string, number>()

export const loadPurses = () => store.load()

export const getBalance = (userId: string): number => store.get().balances[userId] ?? 0

export const getAllBalances = (): Record<string, number> => store.get().balances

export const getAllHolds = (): Record<string, number> => Object.fromEntries(holds)

export async function setBalance(userId: string, amount: number): Promise<void> {
  await store.update(current => ({
    ...current,
    balances: { ...current.balances, [userId]: Math.max(Math.trunc(amount), 0) }
  }))

  emitChange()
}

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

  await store.update(current => ({
    ...current,
    balances: { ...current.balances, [userId]: (current.balances[userId] ?? 0) - amount }
  }))

  emitChange()

  return true
}
