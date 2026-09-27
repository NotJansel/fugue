<script setup lang="ts">
import type { Broadcast } from '#shared/types'

/**
 * Shows a message an organiser sent to everyone, across the top of every page, until the viewer
 * closes it - a notice about a break or a change of plan has to be read, not merely flash past.
 *
 * Only a message that arrives while the page is open is shown (`onArrival`); a newer one replaces it.
 */
const { state } = useDashboard()
const { t } = useLang()

const shown = ref<Broadcast | null>(null)

onArrival(() => state.value?.broadcast, (broadcast) => {
  shown.value = broadcast
})
</script>

<template>
  <Transition
    mode="out-in"
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="-translate-y-4 opacity-0"
    leave-active-class="transition duration-200 ease-in"
    leave-to-class="-translate-y-4 opacity-0"
  >
    <div
      v-if="shown"
      :key="shown.id"
      role="alert"
      class="pointer-events-auto w-full max-w-lg rounded-xl border border-primary/50 bg-elevated/95 shadow-lg backdrop-blur"
    >
      <div class="flex items-start gap-3 px-4 py-3">
        <UIcon
          name="i-lucide-megaphone"
          class="mt-0.5 size-5 shrink-0 text-primary"
        />

        <div class="min-w-0 flex-1">
          <p class="text-xs text-muted">
            {{ t('broadcast.from', { name: shown.from }) }}
          </p>
          <p class="mt-0.5 whitespace-pre-line break-words text-sm">
            {{ shown.message }}
          </p>
        </div>

        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          :aria-label="t('common.close')"
          @click="shown = null"
        />
      </div>
    </div>
  </Transition>
</template>
