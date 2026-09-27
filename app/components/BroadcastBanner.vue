<script setup lang="ts">
import type { Broadcast } from '#shared/types'

/**
 * Shows a message an organiser sent to everyone, across the top of every page - for as long as they
 * chose, or until the viewer closes it: a notice about a break or a change of plan has to be read,
 * not merely flash past.
 *
 * Only a message that arrives while the page is open is shown (`onArrival`); a newer one replaces it.
 * A timed one is measured from when it was *sent*, so every screen takes it down at the same moment,
 * and a tab that reconnects while it is still up gets the rest of it.
 */
const { state, isAdmin, api } = useDashboard()
const { t } = useLang()

const shown = ref<Broadcast | null>(null)
/** How far into its time a timed message already was when it arrived - where the bar starts. */
const elapsedMs = ref(0)
let timer: ReturnType<typeof setTimeout> | undefined

const dismiss = () => {
  clearTimeout(timer)
  shown.value = null
}

onArrival(() => state.value?.broadcast, (broadcast) => {
  clearTimeout(timer)
  shown.value = broadcast

  if (broadcast.durationMs != null) {
    elapsedMs.value = Math.max(Date.now() - broadcast.at, 0)
    timer = setTimeout(dismiss, broadcast.durationMs - elapsedMs.value)
  }
}, broadcast => broadcast.durationMs)

// An organiser taking the message down ends it on every screen. A newer one replaces it through
// `onArrival` instead.
watch(() => state.value?.broadcast?.id, (id) => {
  if (shown.value && id == null) dismiss()
})

const withdrawing = ref(false)

/** Takes the message down for everyone, not just on this screen. */
async function withdraw() {
  withdrawing.value = true

  try {
    await api('/api/broadcast/clear')
  } finally {
    withdrawing.value = false
  }
}

onBeforeUnmount(() => clearTimeout(timer))
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
      class="pointer-events-auto w-full max-w-lg overflow-hidden rounded-xl border border-primary/50 bg-elevated/95 shadow-lg backdrop-blur"
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
          <UButton
            v-if="isAdmin"
            icon="i-lucide-trash-2"
            color="neutral"
            variant="link"
            size="xs"
            class="-ms-1.5 mt-1"
            :loading="withdrawing"
            @click="withdraw"
          >
            {{ t('broadcast.withdraw') }}
          </UButton>
        </div>

        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          :aria-label="t('common.close')"
          @click="dismiss"
        />
      </div>

      <div
        v-if="shown.durationMs != null"
        class="broadcast-countdown h-0.5 bg-primary"
        :style="{ animationDuration: `${shown.durationMs}ms`, animationDelay: `-${elapsedMs}ms` }"
      />
    </div>
  </Transition>
</template>

<style scoped>
.broadcast-countdown {
  transform-origin: left;
  animation-name: broadcast-countdown;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}

@keyframes broadcast-countdown {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}
</style>
