<script setup lang="ts">
/**
 * Where the published schedule comes from.
 *
 * Saving reads the sheet straight away, so a wrong link is reported here rather than as an empty page;
 * after that the server re-reads it every five minutes on its own.
 */
const { state, api } = useDashboard()
const { t, tCode } = useLang()
const { dateTime } = useFormat()

const schedule = computed(() => state.value?.schedule ?? null)
const url = ref('')

watchEffect(() => {
  const saved = schedule.value?.url
  if (saved && url.value === '') url.value = saved
})

const rows = computed(() => (schedule.value?.sections ?? []).reduce((total, section) => total + section.rows.length, 0))

const saving = ref(false)
const refreshing = ref(false)

async function save() {
  saving.value = true

  try {
    await api('/api/schedule', { url: url.value })
  } finally {
    saving.value = false
  }
}

async function refresh() {
  refreshing.value = true

  try {
    await api('/api/schedule/refresh')
  } finally {
    refreshing.value = false
  }
}

async function remove() {
  await api('/api/schedule', { url: null })
  url.value = ''
}
</script>

<template>
  <UCard variant="subtle">
    <template #header>
      <div>
        <h2 class="font-display text-lg">
          {{ t('setup.schedule.title') }}
        </h2>
        <p class="mt-1 text-xs text-muted">
          {{ t('setup.schedule.hint') }}
        </p>
      </div>
    </template>

    <div class="space-y-4">
      <UFormField :label="t('sheet.url')">
        <UInput
          v-model="url"
          placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=…"
          class="w-full"
        />
      </UFormField>

      <div class="flex flex-wrap items-center gap-3">
        <UButton
          icon="i-lucide-calendar-clock"
          :loading="saving"
          :disabled="!url"
          @click="save"
        >
          {{ t('setup.schedule.save') }}
        </UButton>

        <template v-if="schedule">
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="subtle"
            :loading="refreshing"
            @click="refresh"
          >
            {{ t('setup.schedule.refresh') }}
          </UButton>

          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            @click="remove"
          >
            {{ t('setup.schedule.remove') }}
          </UButton>
        </template>
      </div>

      <p
        v-if="schedule?.fetchedAt"
        class="text-xs text-muted"
      >
        {{ t('setup.schedule.status', {
          sections: schedule.sections.length,
          rows,
          when: dateTime(schedule.fetchedAt)
        }) }}
      </p>

      <UAlert
        v-if="schedule?.error"
        icon="i-lucide-triangle-alert"
        color="warning"
        variant="subtle"
        :description="tCode(schedule.error.code, schedule.error.args ?? {}, schedule.error.error)"
      />
    </div>
  </UCard>
</template>
