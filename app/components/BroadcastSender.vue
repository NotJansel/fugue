<script setup lang="ts">
/** An organiser's way to put a message on every open dashboard at once. */
const { api } = useDashboard()
const { t } = useLang()

/** Kept in step with `BROADCAST_MAX_LENGTH` on the server, which refuses anything longer. */
const MAX_LENGTH = 500

const open = ref(false)
const message = ref('')
const sending = ref(false)

// Half a message typed out is work a deploy's reload would throw away.
useUnsavedWork(() => open.value && message.value.trim() !== '')

const sendable = computed(() => message.value.trim() !== '' && message.value.trim().length <= MAX_LENGTH)

async function send() {
  if (!sendable.value || sending.value) return

  sending.value = true

  try {
    // The banner it puts up on this page too is confirmation enough.
    await api('/api/broadcast', { message: message.value }, { quiet: true })
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
