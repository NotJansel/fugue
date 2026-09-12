<script setup lang="ts">
import type { ColumnMapping, SheetPreview } from '#shared/types'

/**
 * Reads the qualifier results out of a published Google Sheet.
 *
 * Two steps on purpose: previewing shows the columns the sheet actually has and guesses what each one
 * is, and only the second press writes anything. Re-importing later keeps manual Discord links,
 * captain overrides and everything already bought at auction.
 */
const { state, api } = useDashboard()
const { t } = useLang()
const { dateTime } = useFormat()

const url = ref('')
const sheetName = ref('')
const enrich = ref(true)
const preview = ref<SheetPreview | null>(null)
const previewing = ref(false)
const importing = ref(false)
const registering = ref(false)

const mapping = ref<ColumnMapping>({
  username: '',
  osuId: null,
  discordId: null,
  score: null,
  seed: null,
  description: null
})

// Whatever was imported last is the obvious thing to import again, so the fields start there.
watchEffect(() => {
  const sheet = state.value?.sheet
  if (!sheet || url.value !== '') return

  url.value = sheet.url
  sheetName.value = sheet.sheetName ?? ''
  mapping.value = { ...sheet.mapping }
})

const options = computed(() => (preview.value?.headers ?? []).map(header => ({ label: header, value: header })))
const optionalOptions = computed(() => [{ label: t('common.none'), value: SELECT_NONE }, ...options.value])

const fields = computed(() => [
  { key: 'osuId' as const, label: t('sheet.field.osuId') },
  { key: 'discordId' as const, label: t('sheet.field.discordId') },
  { key: 'score' as const, label: t('sheet.field.score') },
  { key: 'seed' as const, label: t('sheet.field.seed') },
  { key: 'description' as const, label: t('sheet.field.description') }
])

async function runPreview() {
  previewing.value = true

  try {
    const result = await $fetch<SheetPreview>('/api/sheet/preview', {
      method: 'POST',
      body: { url: url.value, sheetName: sheetName.value || null }
    })

    preview.value = result
    if (result.suggestedMapping) mapping.value = { ...result.suggestedMapping }
  } catch (error) {
    const payload = (error as { data?: { data?: { error?: string, code?: string } } }).data?.data

    useToast().add({
      title: payload?.code ? t(payload.code) : payload?.error ?? String(error),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    previewing.value = false
  }
}

async function runImport() {
  importing.value = true

  try {
    await api('/api/sheet/import', {
      url: url.value,
      sheetName: sheetName.value || null,
      mapping: mapping.value,
      enrich: enrich.value
    })
  } finally {
    importing.value = false
  }
}

/** Adds sign-ups and refreshes what they wrote, without touching the seeding or any result. */
async function runRegister() {
  registering.value = true

  try {
    await api('/api/sheet/register', {
      url: url.value,
      sheetName: sheetName.value || null,
      mapping: mapping.value,
      enrich: enrich.value
    })
  } finally {
    registering.value = false
  }
}

const progress = computed(() => state.value?.importProgress ?? null)
</script>

<template>
  <UCard variant="subtle">
    <template #header>
      <div>
        <h2 class="font-display text-lg">
          {{ t('setup.sheet.title') }}
        </h2>
        <p class="mt-1 text-xs text-muted">
          {{ t('setup.sheet.hint') }}
        </p>
      </div>
    </template>

    <div class="space-y-4">
      <UFormField :label="t('sheet.url')">
        <UInput
          v-model="url"
          placeholder="https://docs.google.com/spreadsheets/d/…"
          class="w-full"
        />
      </UFormField>

      <UFormField
        :label="t('sheet.tab')"
        :help="t('sheet.tabHint')"
      >
        <UInput
          v-model="sheetName"
          placeholder="Qualifiers"
          class="w-full"
        />
      </UFormField>

      <div class="flex flex-wrap items-center gap-3">
        <UButton
          icon="i-lucide-table-2"
          color="neutral"
          variant="subtle"
          :loading="previewing"
          :disabled="!url"
          @click="runPreview"
        >
          {{ t('sheet.preview') }}
        </UButton>

        <span
          v-if="preview"
          class="text-xs text-muted"
        >{{ t('sheet.rows', { count: preview.rowCount }) }}</span>

        <span
          v-if="state?.sheet?.importedAt"
          class="text-xs text-muted"
        >{{ t('sheet.lastImport', { when: dateTime(state.sheet.importedAt) }) }}</span>
      </div>

      <template v-if="preview">
        <USeparator />

        <div class="space-y-3">
          <h3 class="text-sm font-medium">
            {{ t('sheet.mapping') }}
          </h3>

          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField
              :label="t('sheet.field.username')"
              required
              size="sm"
            >
              <USelect
                v-model="mapping.username"
                :items="options"
                value-key="value"
                class="w-full"
              />
            </UFormField>

            <UFormField
              v-for="field in fields"
              :key="field.key"
              :label="field.label"
              size="sm"
            >
              <USelect
                :model-value="mapping[field.key] ?? SELECT_NONE"
                :items="optionalOptions"
                value-key="value"
                class="w-full"
                @update:model-value="mapping[field.key] = selectValue($event)"
              />
            </UFormField>
          </div>

          <UCheckbox
            v-model="enrich"
            :label="t('setup.sheet.enrich')"
          />

          <div class="flex flex-wrap items-center gap-3">
            <UButton
              icon="i-lucide-download"
              :loading="importing"
              :disabled="!mapping.username || registering"
              @click="runImport"
            >
              {{ t('setup.sheet.import') }}
            </UButton>

            <UButton
              icon="i-lucide-user-plus"
              color="neutral"
              variant="subtle"
              :loading="registering"
              :disabled="!mapping.username || importing"
              @click="runRegister"
            >
              {{ t('setup.sheet.register') }}
            </UButton>

            <span
              v-if="progress"
              class="text-xs text-muted tnum"
            >{{ t('setup.sheet.importing', { ...progress }) }}</span>
          </div>

          <UProgress
            v-if="progress"
            :model-value="progress.done"
            :max="progress.total"
            color="secondary"
            size="xs"
          />

          <p class="text-xs text-muted">
            {{ t('setup.sheet.note') }}
          </p>
          <p class="text-xs text-muted">
            {{ t('setup.sheet.registerNote') }}
          </p>
        </div>
      </template>
    </div>
  </UCard>
</template>
