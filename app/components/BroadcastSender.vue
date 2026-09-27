<script setup lang="ts">
/** An organiser's way to put a message on every open dashboard at once. */
const { api, state } = useDashboard()
const { t } = useLang()

/** Kept in step with `BROADCAST_MAX_LENGTH` on the server, which refuses anything longer. */
const MAX_LENGTH = 500

/** Kept in step with `BROADCAST_MAX_SECONDS` on the server. */
const MAX_SECONDS = 3600

const open = ref(false)
const message = ref('')
/** How long it stays up, in seconds; 0 until each viewer closes it. Kept between messages. */
const seconds = ref(0)
const sending = ref(false)

// Half a message typed out is work a deploy's reload would throw away.
useUnsavedWork(() => open.value && message.value.trim() !== '')

/**
 * The message still up, if any - shown in the dialog so it can be taken down from there too. A timed
 * one that has run out is up nowhere any more; `now` is taken when the dialog opens, which is when
 * this is read.
 */
const now = ref(Date.now())
watch(open, (isOpen) => {
  if (isOpen) now.value = Date.now()
})

const current = computed(() => {
  const broadcast = state.value?.broadcast
  if (!broadcast) return null

  return broadcast.durationMs == null || broadcast.at + broadcast.durationMs > now.value ? broadcast : null
})

const withdrawing = ref(false)

/** Takes the current message down on every screen. */
async function withdraw() {
  withdrawing.value = true

  try {
    await api('/api/broadcast/clear')
  } finally {
    withdrawing.value = false
  }
}

const sendable = computed(() => message.value.trim() !== '' && message.value.trim().length <= MAX_LENGTH)

async function send() {
  if (!sendable.value || sending.value) return

  sending.value = true

  try {
    // The banner it puts up on this page too is confirmation enough.
    await api('/api/broadcast', { message: message.value, durationSeconds: seconds.value }, { quiet: true })
    message.value = ''
    open.value = false
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UTooltip :text="t('broadcast.title')">
    <UButton
      icon="i-lucide-megaphone"
      color="neutral"
      variant="ghost"
      size="sm"
      :aria-label="t('broadcast.title')"
      @click="open = true"
    />
  </UTooltip>

  <UModal
    v-model:open="open"
    :title="t('broadcast.title')"
    :description="t('broadcast.hint')"
  >
    <template #body>
      <div
        v-if="current"
        class="mb-4 flex items-start gap-3 rounded-lg bg-elevated/50 px-3 py-2"
      >
        <div class="min-w-0 flex-1">
          <p class="text-xs text-muted">
            {{ t('broadcast.current', { name: current.from }) }}
          </p>
          <p class="mt-0.5 line-clamp-3 whitespace-pre-line break-words text-sm">
            {{ current.message }}
          </p>
        </div>
        <UButton
          icon="i-lucide-trash-2"
          color="error"
          variant="subtle"
          size="xs"
          :loading="withdrawing"
          @click="withdraw"
        >
          {{ t('broadcast.withdraw') }}
        </UButton>
      </div>

      <div class="space-y-2">
        <UTextarea
          v-model="message"
          :rows="4"
          :maxlength="MAX_LENGTH"
          autoresize
          autofocus
          class="w-full"
          :placeholder="t('broadcast.placeholder')"
          @keydown.enter.meta.prevent="send"
          @keydown.enter.ctrl.prevent="send"
        />
        <p class="text-end text-xs text-muted tnum">
          {{ message.trim().length }} / {{ MAX_LENGTH }}
        </p>

        <UFormField
          :label="t('broadcast.duration')"
          :help="seconds > 0 ? t('broadcast.durationTimed', { seconds }) : t('broadcast.durationUntilClosed')"
        >
          <UInputNumber
            v-model="seconds"
            :min="0"
            :max="MAX_SECONDS"
            :step="5"
            class="w-40"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          @click="open = false"
        >
          {{ t('common.cancel') }}
        </UButton>
        <UButton
          icon="i-lucide-send"
          :loading="sending"
          :disabled="!sendable"
          @click="send"
        >
          {{ t('broadcast.send') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
