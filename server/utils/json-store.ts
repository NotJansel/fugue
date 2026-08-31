import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { config } from './config'

/**
 * A JSON file that is read once at startup and rewritten after every mutation, so dashboard edits
 * survive an unclean shutdown.
 *
 * Writes are serialised through a promise chain rather than a mutex library: Node runs the mutating
 * callbacks on one thread anyway, so all this has to prevent is two overlapping *writes* to the same
 * file, and it does that by never starting one before the last has finished.
 */
export class JsonStore<T> {
  private state: T
  private queue: Promise<unknown> = Promise.resolve()
  private readonly file: string

  constructor(fileName: string, private readonly initial: T) {
    this.state = initial
    this.file = join(config.dataDir, fileName)
  }

  /** Reads the file if it exists. A broken or empty file starts the store empty rather than crashing. */
  async load(): Promise<void> {
    try {
      const content = await readFile(this.file, 'utf8')
      if (content.trim() === '') return

      this.state = { ...this.initial, ...JSON.parse(content) as T }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return

      console.error(`[store] Failed to load ${this.file}, starting empty:`, error)
    }
  }

  /** The current snapshot. Callers treat it as immutable - every mutation goes through `update`. */
  get(): T {
    return this.state
  }

  /**
   * Applies `block` to the current state and persists the result.
   *
   * Returning the state unchanged is how a no-op mutation is expressed; the file is written either
   * way, which costs a few KB and keeps the code free of "did anything actually change" branches.
   */
  async update(block: (current: T) => T): Promise<T> {
    const run = this.queue.then(async () => {
      this.state = block(this.state)
      await this.persist(this.state)

      return this.state
    })

    // Keep the chain alive even when this particular update rejects.
    this.queue = run.catch(() => {})

    return run
  }

  private async persist(snapshot: T): Promise<void> {
    try {
      await mkdir(dirname(this.file), { recursive: true })

      // Written beside the target and moved into place, so a crash mid-write cannot truncate the
      // only copy of an evening's seeding work.
      const temporary = `${this.file}.tmp`
      await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
      await rename(temporary, this.file)
    } catch (error) {
      console.error(`[store] Failed to save ${this.file}:`, error)
    }
  }
}
