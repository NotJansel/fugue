<script setup lang="ts">
import type { QualifierMap } from '#shared/types'

const { state, players, isAdmin, api } = useDashboard()
const { t } = useLang()
const { number } = useFormat()

const pool = computed(() => state.value?.mappool ?? [])
const columns = computed(() => state.value?.sheetColumns ?? [])

/**
 * The pool being edited.
 *
 * While a draft exists it renders instead of the pushed pool - the one piece of state this dashboard
 * keeps of its own, because an organiser mid-edit should not have their fields rewritten by someone
 * else's save. Discarding drops back to whatever the server last sent.
 */
const draft = ref<QualifierMap[] | null>(null)
const saving = ref(false)
const refreshing = ref(false)

const maps = computed(() => draft.value ?? pool.value)

const stageFilter = ref(SELECT_ALL)

const stages = computed(() => {
  const found = [...new Set(maps.value.map(map => map.stage))]

  return [
    { label: t('mappool.allStages'), value: SELECT_ALL },
    ...found.map(stage => ({ label: stage || t('mappool.ungrouped'), value: stage || SELECT_NONE }))
  ]
})

const visible = computed(() =>
  stageFilter.value === SELECT_ALL
    ? maps.value
    : maps.value.filter(map => (map.stage || SELECT_NONE) === stageFilter.value)
)

/** Grouped for display, in the order the rounds first appear in the pool. */
const grouped = computed(() => {
  const groups = new Map<string, QualifierMap[]>()

  for (const map of visible.value) {
    const key = map.stage || ''
    groups.set(key, [...(groups.get(key) ?? []), map])
  }

  return [...groups.entries()]
})

const edit = () => {
  draft.value = maps.value.map(map => ({ ...map }))
}

const update = (id: string, patch: Partial<QualifierMap>) => {
  if (!draft.value) return

  draft.value = draft.value.map(map => map.id === id ? { ...map, ...patch } : map)
}

const removeMap = (id: string) => {
  if (!draft.value) return

  draft.value = draft.value.filter(map => map.id !== id)
}

const addMap = () => {
  if (!draft.value) edit()

  draft.value = [...(draft.value ?? []), {
    // Slots are addressed by id everywhere, so a new one gets its own straight away rather than
    // waiting for the save - the same 8 characters the server would have assigned.
    id: crypto.randomUUID().slice(0, 8),
    label: '',
    stage: stageFilter.value === SELECT_ALL || stageFilter.value === SELECT_NONE ? '' : stageFilter.value,
    mods: '',
    column: null,
    beatmapId: null
  }]
}

async function save() {
  if (!draft.value) return

  saving.value = true

  try {
    await api('/api/mappool', { maps: draft.value })
    draft.value = null
  } finally {
    saving.value = false
  }
}

async function refresh() {
  refreshing.value = true

  try {
    await api('/api/mappool/refresh')
  } finally {
    refreshing.value = false
  }
}

/** Slots that actually carry results - the only ones the results table can have a column for. */
const scored = computed(() => visible.value.filter(map => map.column))

const results = computed(() => {
  if (scored.value.length === 0) return []

  return players.value
    .map(player => ({
      player,
      cells: scored.value.map(map => player.mapScores[map.id] ?? null),
      // The average across the pool, not the sum - a map a player skipped counts as a zero either
      // way, so this is the sheet's own "Avg. Score" and stays comparable when a round has more maps
      // than the last one did.
      average: scored.value.reduce((sum, map) => sum + (player.mapScores[map.id]?.value ?? 0), 0)
        / scored.value.length
    }))
    // By seed, so the table reads in the same order as the seeding page and a row can be found by
    // the number an organiser already has in their head. `players` arrives in that order anyway -
    // sorting says so out loud rather than depending on it.
    .sort((a, b) => a.player.seed - b.player.seed)
})

const bound = computed(() => maps.value.filter(map => map.column).length)
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="font-display text-2xl">
          {{ t('mappool.title') }}
        </h1>
        <p class="text-sm text-muted">
          {{ t('mappool.summary', { count: maps.length, bound }) }}
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <USelect
          v-if="stages.length > 2"
          v-model="stageFilter"
          :items="stages"
          value-key="value"
          size="sm"
          class="w-40"
        />

        <template v-if="isAdmin">
          <UButton
            v-if="!draft"
            icon="i-lucide-pencil"
            size="sm"
            color="neutral"
            variant="subtle"
            :disabled="!maps.length"
            @click="edit"
          >
            {{ t('common.edit') }}
          </UButton>

          <UButton
            icon="i-lucide-plus"
            size="sm"
            color="neutral"
            variant="subtle"
            @click="addMap"
          >
            {{ t('mappool.add') }}
          </UButton>

          <UButton
            icon="i-lucide-refresh-cw"
            size="sm"
            color="neutral"
            variant="subtle"
            :loading="refreshing"
            @click="refresh"
          >
            {{ refreshing ? t('mappool.refreshing') : t('mappool.refresh') }}
          </UButton>

          <template v-if="draft">
            <UButton
              icon="i-lucide-x"
              size="sm"
              color="neutral"
              variant="ghost"
              @click="draft = null"
            >
              {{ t('common.discard') }}
            </UButton>
            <UButton
              icon="i-lucide-save"
              size="sm"
              :loading="saving"
              @click="save"
            >
              {{ t('mappool.save') }}
            </UButton>
          </template>
        </template>
      </div>
    </div>

    <UAlert
      v-if="draft"
      icon="i-lucide-pencil-line"
      color="warning"
      variant="subtle"
      :description="t('mappool.unsaved')"
    />

    <p
      v-if="!maps.length"
      class="rounded-xl border border-dashed border-default/60 py-14 text-center text-sm text-muted"
    >
      {{ isAdmin ? t('mappool.emptyAdmin') : t('mappool.empty') }}
    </p>

    <section
      v-for="[stage, group] in grouped"
      :key="stage || 'ungrouped'"
      class="space-y-2"
    >
      <h2
        v-if="grouped.length > 1 || stage"
        class="font-display text-lg"
      >
        {{ stage || t('mappool.ungrouped') }}
      </h2>

      <MapCard
        v-for="map in group"
        :key="map.id"
        :map="map"
        :editing="draft != null"
        :columns="columns"
        @update="update(map.id, $event)"
        @remove="removeMap(map.id)"
      />
    </section>

    <UCard
      v-if="scored.length"
      variant="subtle"
    >
      <template #header>
        <h2 class="font-display text-lg">
          {{ t('mappool.results') }}
        </h2>
      </template>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-default/60 text-left text-xs uppercase tracking-wider text-muted">
              <th class="py-2 pe-3 font-medium">
                {{ t('common.seed') }}
              </th>
              <th class="py-2 pe-3 font-medium">
                {{ t('sheet.field.username') }}
              </th>
              <th
                v-for="map in scored"
                :key="map.id"
                class="py-2 px-3 font-medium text-right"
              >
                {{ map.label }}
              </th>
              <th class="py-2 ps-3 font-medium text-right">
                {{ t('mappool.average') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in results"
              :key="row.player.osuId"
              class="border-b border-default/30 last:border-0"
            >
              <td class="py-1.5 pe-3 text-muted tnum">
                {{ row.player.seed }}
              </td>
              <td class="py-1.5 pe-3 whitespace-nowrap">
                {{ row.player.username }}
              </td>
              <td
                v-for="(cell, index) in row.cells"
                :key="index"
                class="py-1.5 px-3 text-right tnum"
              >
                <span v-if="cell">
                  {{ cell.display }}
                  <span
                    class="ms-1 text-xs"
                    :class="cell.rank === 1 ? 'text-secondary' : 'text-muted'"
                  >#{{ cell.rank }}</span>
                </span>
                <span
                  v-else
                  class="text-muted"
                >&mdash;</span>
              </td>
              <td class="py-1.5 ps-3 text-right font-display tnum">
                {{ number(row.average, 2) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
