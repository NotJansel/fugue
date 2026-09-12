/**
 * A queue that never lets two writes overlap.
 *
 * Node runs the mutating code on one thread anyway, so what has to be prevented is two writes for the
 * same store being *in flight* at once - two `setBalance` calls for one captain would otherwise land
 * in whichever order the database finished them, which need not be the order they were made in. The
 * chain does that by never starting one before the last has finished.
 */
export function serialiser(): <T>(task: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve()

  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task)

    // Keep the chain alive even when this particular write rejects.
    queue = run.catch(() => {})

    return run
  }
}
