<script setup lang="ts">
/**
 * Shows the message an organiser sent to everyone, across the top of every page - for as long as they
 * chose, or until the viewer closes it: a notice about a break or a change of plan has to be read,
 * not merely flash past.
 *
 * Unlike the auction result this is not a one-off announcement but a notice that is *up*: whatever
 * the server has on file shows, on a page open when it went out or loaded long after, and survives a
 * refresh. A timed one is measured from when it was *sent*, so every screen takes it down at the same
 * moment. Closing it hides it in this browser only, remembered across refreshes - and taking it down
 * for everyone is the organiser's `/api/broadcast/clear`.
 */
const DISMISSED_KEY = 'ba-dismissed-broadcast'

const { state, isAdmin, api } = useDashboard()
const { t } = useLang()

const broadcast = computed(() => state.value?.broadcast ?? null)

/**
 * The page renders nothing until it is mounted: whether a timed message has run out depends on the
 * viewer's clock, and whether it was closed on their browser's storage - neither of which the server
 * render can know.
 */
const mounted = ref(false)
/** The message this browser closed - the last one only, since only the last one can be up. */
const dismissedId = ref<string | null>(null)
/** Whether the timed message on file has run out. */
const expired = ref(false)
/** How far into its time a timed message already was when it came up - where the bar starts. */
const elapsedMs = ref(0)
let timer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  try {
    dismissedId.value = localStorage.getItem(DISMISSED_KEY)
  } catch {
    // No storage: closing still works, it just isn't remembered past this page.
  }

  mounted.value = true
})

// Each new message starts its own clock; a timed one is taken down when its time is up.
watch([() => broadcast.value?.id, mounted], () => {
  clearTimeout(timer)
  expired.value = false

  const current = broadcast.value
  if (!mounted.value || current?.durationMs == null) return

  elapsedMs.value = Math.max(Date.now() - current.at, 0)
  const remaining = current.durationMs - elapsedMs.value

  if (remaining <= 0) {
    expired.value = true
  } else {
    timer = setTimeout(() => {
      expired.value = true
    }, remaining)
  }
}, { immediate: true })

const shown = computed(() => {
  const current = broadcast.value
  if (!mounted.value || !current || expired.value || current.id === dismissedId.value) return null

  return current
})

/** Hides the message in this browser, for good - a refresh does not bring it back. */
function dismiss() {
  if (!shown.value) return

  dismissedId.value = shown.value.id

  try {
    localStorage.setItem(DISMISSED_KEY, shown.value.id)
  } catch {
    // Hidden for now all the same.
  }
}

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
