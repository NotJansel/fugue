<script setup lang="ts">
import type { PresenceDto } from '#shared/types'

/** Whether someone has the dashboard open right now: green when they do, grey with when they left otherwise. */
const props = defineProps<{ presence: PresenceDto }>()

const { t } = useLang()
const { time } = useFormat()

const label = computed(() => {
  if (props.presence.online) return t('presence.online')
  if (props.presence.lastSeenAt != null) return t('presence.lastSeen', { time: time(props.presence.lastSeenAt) })

  return t('presence.never')
})
</script>

<template>
  <UTooltip :text="label">
    <span
      class="inline-block size-2 shrink-0 rounded-full"
      :class="presence.online ? 'bg-success' : 'bg-(--ui-text-dimmed)'"
      role="img"
      :aria-label="label"
    />
  </UTooltip>
</template>
