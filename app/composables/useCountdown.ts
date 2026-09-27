/** The 20 seconds an auction runs once bidding opens - `AUCTION_DURATION_MS` on the server. */
export const AUCTION_DURATION_MS = 20_000

/** The seconds an auction shows the player before bids are taken - `OPENING_DELAY_MS` on the server. */
export const OPENING_DELAY_MS = 3_000

/**
 * Seconds left until `endsAt`, ticking on the client.
 *
 * The server sends the instant a countdown lapses rather than a duration, so every open tab agrees on
 * when the hammer falls no matter when it connected - and it is read against the server's clock
 * (`useServerClock`), so a viewer whose own clock is off still sees the right number.
 */
export function useCountdown(
  endsAt: MaybeRefOrGetter<number | null | undefined>,
  totalMs: MaybeRefOrGetter<number> = AUCTION_DURATION_MS
) {
  // `endsAt` is on the server's clock, so this counts on it too, not on whatever the viewer's says.
  const clock = useServerClock()
  const now = ref(clock.now())
  let timer: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    timer = setInterval(() => {
      now.value = clock.now()
    }, 200)
  })

  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })

  const remainingMs = computed(() => {
    const deadline = toValue(endsAt)

    return deadline ? Math.max(deadline - now.value, 0) : 0
  })
  const seconds = computed(() => Math.ceil(remainingMs.value / 1000))
  /**
   * 1 at the start of the countdown, 0 when it lapses - what the progress ring reads. Measured against
   * `totalMs`, by default the 20 seconds an auction runs for, so a late bid that puts the clock back up
   * to 10 shows as the ring refilling halfway.
   */
  const fraction = computed(() => Math.min(remainingMs.value / toValue(totalMs), 1))

  return { seconds, remainingMs, fraction }
}
