import type { ComputedRef } from 'vue'

/**
 * Every piece of half-done work on screen - an open editor, a typed-in field not yet sent - that a
 * reload would throw away. A deploy reloads every open tab, and waits while any of these holds.
 *
 * Module state rather than `useState`: only mounted components register, so it only ever fills in the
 * browser, and a getter has no business in the SSR payload anyway.
 */
const holds = shallowReactive(new Set<ComputedRef<boolean>>())

/** Whether anything on the page holds work a reload would lose. */
export const hasUnsavedWork = computed(() => [...holds].some(hold => hold.value))

/** Holds off the reload a deploy triggers for as long as `dirty` says this component has unsaved work. */
export function useUnsavedWork(dirty: () => boolean): void {
  const hold = computed(dirty)

  onMounted(() => holds.add(hold))
  onBeforeUnmount(() => holds.delete(hold))
}
