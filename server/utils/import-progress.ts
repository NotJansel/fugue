import type { ImportProgress } from '#shared/types'
import { emitChange } from './bus'

/** Progress of a running sheet import, surfaced to every connected dashboard. */
let progress: ImportProgress | null = null

export const currentImportProgress = (): ImportProgress | null => progress

export function setImportProgress(done: number, total: number): void {
  progress = { done, total }
  emitChange()
}

export function clearImportProgress(): void {
  progress = null
  emitChange()
}
