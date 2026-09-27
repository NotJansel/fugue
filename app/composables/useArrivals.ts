/**
 * Something older than this when it arrives is not news: a tab that slept or lost its connection
 * catches up on the state, not on the announcements it missed. `at` is the server's clock, and so
 * is what it is measured against (`useServerClock`).
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
  announce: (item: T) => void
): void {
  const clock = useServerClock()

  onMounted(() => {
    watch(source, (item, previous) => {
      if (!item || item.id === previous?.id) return
      if (clock.now() - item.at > STALE_AFTER_MS) return

      announce(item)
    })
  })
}
