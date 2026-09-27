/**
 * Something older than this when it arrives is not news: a tab that slept or lost its connection
 * catches up on the state, not on the announcements it missed. Loose, since `at` is the server's
 * clock and the viewer's may be a little off it.
 */
const STALE_AFTER_MS = 60_000

/**
 * Calls `announce` for each new item the server pushes - a new `id` - once the page is open.
 *
 * Whatever is on file when the page loads has already been announced to whoever was watching, and a
 * reload should not play it again; nor should a reconnect replay what went out while it was away.
 */
export function onArrival<T extends { id: string, at: number }>(
  source: () => T | null | undefined,
  announce: (item: T) => void,
  /** How long after `at` an item is still worth announcing, when that differs from the minute. */
  staleAfterMs: (item: T) => number | null | undefined = () => null
): void {
  onMounted(() => {
    watch(source, (item, previous) => {
      if (!item || item.id === previous?.id) return
      if (Date.now() - item.at > (staleAfterMs(item) ?? STALE_AFTER_MS)) return

      announce(item)
    })
  })
}
