/**
 * Seconds left until `endsAt`, ticking on the client.
 *
 * The server sends the instant a countdown lapses rather than a duration, so every open tab agrees on
 * when the hammer falls no matter when it connected or how far its clock has drifted since.
 */
export function useCountdown(endsAt: Ref<number | null | undefined>) {
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    timer = setInterval(() => {
      now.value = Date.now()
    }, 200)
  })

  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })

  const remainingMs = computed(() => endsAt.value ? Math.max(endsAt.value - now.value, 0) : 0)
  const seconds = computed(() => Math.ceil(remainingMs.value / 1000))
  /**
   * 1 at the start of the countdown, 0 when it lapses - what the progress ring reads. Measured against
   * the 20 seconds an auction opens with (`AUCTION_DURATION_MS` on the server), so a late bid that
   * puts the clock back up to 10 shows as the ring refilling halfway.
   */
  const fraction = computed(() => Math.min(remainingMs.value / 20_000, 1))

  return { seconds, remainingMs, fraction }
}
