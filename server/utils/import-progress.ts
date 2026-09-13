import type { ImportOutcome, ImportPhase, ImportProgress } from '#shared/types'
import { emitChange } from './bus'
import { apiError } from './http-error'

/** Progress of a running sheet import, surfaced to every connected dashboard. */
let progress: ImportProgress | null = null

/** How the last import ended. Kept until the next one, so a dashboard that reconnects still sees it. */
let outcome: ImportOutcome | null = null

export const currentImportProgress = (): ImportProgress | null => progress

export const lastImportOutcome = (): ImportOutcome | null => outcome

export function setImportProgress(done: number, total: number, phase: ImportPhase = 'osu'): void {
  progress = { done, total, phase }
  emitChange()
}

export function clearImportProgress(): void {
  progress = null
  emitChange()
}

/** What a finished import reports: the same `code`/`args`/prose triple as any API answer. */
export interface ImportReport {
  message: string
  code: string
  args: Record<string, string>
}

/**
 * Runs an import after the request that started it has been answered.
 *
 * Looking every player up on osu! - and matching Discord handles after that - takes well over a minute
 * for a full registration list, which is longer than a reverse proxy waits for a response. So a route
 * reads and checks the sheet, starts the rest here and answers straight away; progress and the outcome
 * reach the dashboard over SSE like everything else.
 *
 * Only one import runs at a time: two of them writing the player list at once would each overwrite
 * the other's result. The check and the claim happen in the same synchronous step, so two requests
 * cannot both get past it.
 */
export function startImport(total: number, job: () => Promise<ImportReport>): void {
  if (progress != null) {
    throw apiError(409, 'An import is already running - wait for it to finish.', 'err.sheet.importRunning')
  }

  setImportProgress(0, total)

  void job()
    .then((report) => {
      outcome = { ok: true, ...report, finishedAt: Date.now() }
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[sheets] Import failed:', error)

      outcome = {
        ok: false,
        message: `The import failed: ${message}`,
        code: 'err.sheet.importFailed',
        args: { message },
        finishedAt: Date.now()
      }
    })
    .finally(clearImportProgress)
}
