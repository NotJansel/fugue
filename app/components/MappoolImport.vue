<script setup lang="ts">
import type { MappoolColumnMapping, SheetPreview } from '#shared/types'

/**
 * Reads the mappool out of its own sheet.
 *
 * A pool sheet lists maps, not players - it supplies slot names and beatmap IDs, while the scores stay
 * in the qualifier sheet. Where the pool sheet doesn't name a score column, each slot is bound to the
 * qualifier column named after it ("NM1" to "NM1" or "NM1 Score").
 *
 * All rounds are commonly published as one sheet, stacked round after round, which is what the round
 * name and row range are for: only the named round is replaced, everything else on file stays put.
 */
const { state, api } = useDashboard()
const { t } = useLang()
const { dateTime } = useFormat()

const url = ref('')
const sheetName = ref('')
const stage = ref('')
const startRow = ref<number | undefined>(undefined)
const endRow = ref<number | undefined>(undefined)
const preview = ref<SheetPreview | null>(null)
const previewing = ref(false)
const importing = ref(false)

const mapping = ref<MappoolColumnMapping>({ label: '', beatmapId: null, scoreColumn: null })

watchEffect(() => {
  const sheet = state.value?.mappoolSheet
  if (!sheet || url.value !== '') return

  url.value = sheet.url
  sheetName.value = sheet.sheetName ?? ''
  stage.value = sheet.stage ?? ''
  mapping.value = { ...sheet.mapping }
})

const options = computed(() => (preview.value?.headers ?? []).map(header => ({ label: header, value: header })))
const optionalOptions = computed(() => [{ label: t('common.none'), value: SELECT_NONE }, ...options.value])

async function runPreview() {
  previewing.value = true

  try {
    const result = await $fetch<SheetPreview>('/api/sheet/preview', {
      method: 'POST',
      body: { url: url.value, sheetName: sheetName.value || null }
    })

    preview.value = result
    if (result.suggestedMappoolMapping) mapping.value = { ...result.suggestedMappoolMapping }
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
    await api('/api/mappool/import', {
      url: url.value,
      sheetName: sheetName.value || null,
      mapping: mapping.value,
      stage: stage.value,
      startRow: startRow.value ?? null,
      endRow: endRow.value ?? null
    })
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <UCard variant="subtle">
    <template #header>
      <div>
        <h2 class="font-display text-lg">
          {{ t('setup.mappool.title') }}
        </h2>
        <p class="mt-1 text-xs text-muted">
          {{ t('setup.mappool.hint') }}
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
          placeholder="Mappool"
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
          v-if="state?.mappoolSheet?.importedAt"
          class="text-xs text-muted"
        >{{ t('sheet.lastImport', { when: dateTime(state.mappoolSheet.importedAt) }) }}</span>
      </div>

      <template v-if="preview">
        <USeparator />

        <div class="space-y-3">
          <h3 class="text-sm font-medium">
            {{ t('sheet.mapping') }}
          </h3>

          <div class="grid gap-3 sm:grid-cols-3">
            <UFormField
              :label="t('sheet.field.slot')"
              required
              size="sm"
            >
              <USelect
                v-model="mapping.label"
                :items="options"
                value-key="value"
                class="w-full"
              />
            </UFormField>

            <UFormField
              :label="t('sheet.field.beatmap')"
              size="sm"
            >
              <USelect
                :model-value="mapping.beatmapId ?? SELECT_NONE"
                :items="optionalOptions"
                value-key="value"
                class="w-full"
                @update:model-value="mapping.beatmapId = selectValue($event)"
              />
            </UFormField>

            <UFormField
              :label="t('sheet.field.scoreColumn')"
              size="sm"
            >
              <USelect
                :model-value="mapping.scoreColumn ?? SELECT_NONE"
                :items="optionalOptions"
                value-key="value"
                class="w-full"
                @update:model-value="mapping.scoreColumn = selectValue($event)"
              />
            </UFormField>
          </div>

          <h3 class="text-sm font-medium">
            {{ t('setup.mappool.range') }}
          </h3>
          <p class="text-xs text-muted">
            {{ t('setup.mappool.rangeHint') }}
          </p>

          <div class="grid gap-3 sm:grid-cols-3">
            <UFormField
              :label="t('setup.mappool.stage')"
              size="sm"
            >
              <UInput
                v-model="stage"
                placeholder="RO32"
                class="w-full"
              />
            </UFormField>
            <UFormField
              :label="t('setup.mappool.startRow')"
              size="sm"
            >
              <UInputNumber
                v-model="startRow"
                :min="2"
                class="w-full"
              />
            </UFormField>
            <UFormField
              :label="t('setup.mappool.endRow')"
              size="sm"
            >
              <UInputNumber
                v-model="endRow"
                :min="2"
                class="w-full"
              />
            </UFormField>
          </div>

          <UButton
            icon="i-lucide-download"
            :loading="importing"
            :disabled="!mapping.label"
            @click="runImport"
          >
            {{ t('setup.mappool.run') }}
          </UButton>
        </div>
      </template>
    </div>
  </UCard>
</template>
