<script setup lang="ts">
/** Says whether what you are looking at is still live - the one thing an organiser must be sure of. */
const { connection, state } = useDashboard()
const { t } = useLang()

const label = computed(() => t(`conn.${connection.value}`))

const colour = computed(() =>
  connection.value === 'live' ? 'success' : connection.value === 'offline' ? 'error' : 'neutral'
)

const botOffline = computed(() => state.value?.config.botConnected === false)
</script>

<template>
  <div class="flex items-center gap-2">
    <UTooltip
      v-if="botOffline"
      :text="t('conn.botOffline')"
    >
      <UIcon
        name="i-lucide-unplug"
        class="size-4 text-warning"
      />
    </UTooltip>

    <UBadge
      :color="colour"
      variant="subtle"
      size="sm"
      class="gap-1.5"
    >
      <span
        class="size-1.5 rounded-full bg-current"
        :class="connection === 'live' ? 'pulse-gold' : ''"
      />
      {{ label }}
    </UBadge>
  </div>
</template>
