/**
 * The server's clock, as best this page can tell.
 *
 * Every deadline the server sends - when bidding opens, when the hammer falls, when a message was
 * sent - is a point on *its* clock, and a viewer's can be seconds off it: a PC whose clock drifted
 * would otherwise count the 3 seconds before bidding as 13, and keep the bid button shut long after
 * the server is taking bids. Each pushed state carries the server's time, and the offset between the
 * two is what `now()` adds on.
 *
 * The push takes a moment to arrive, so the estimate runs that moment behind - tens of milliseconds,
 * against the seconds a wrong clock is off by.
 */
export function useServerClock() {
  const offset = useState<number>('ba-clock-offset', () => 0)

  /** Takes a state's `serverTime` the moment it arrives. */
  const sync = (serverTime: number | null | undefined) => {
    if (serverTime != null) offset.value = serverTime - Date.now()
  }

  /** Epoch millis on the server's clock. */
  const now = () => Date.now() + offset.value

  return { now, sync }
}
