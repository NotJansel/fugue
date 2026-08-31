import { EventEmitter } from 'node:events'

/**
 * One process-wide change signal.
 *
 * Every store fires `change` after a mutation and the SSE stream pushes a fresh dashboard state on
 * it - the same shape the Kotlin version had as four `SharedFlow`s, merged into one emitter because
 * the consumer never cared which store moved.
 */
export const bus = new EventEmitter()

// An event-day dashboard can have a good few tabs open at once, each holding a listener.
bus.setMaxListeners(200)

export function emitChange(): void {
  bus.emit('change')
}

export function onChange(listener: () => void): () => void {
  bus.on('change', listener)

  return () => {
    bus.off('change', listener)
  }
}
