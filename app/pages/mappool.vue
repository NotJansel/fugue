<script setup lang="ts">
import type { MapScore, PlayerDto, QualifierMap } from '#shared/types'

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

/** How many players have a lobby score on each slot - what marks a slot as read live. */
const lobbyScored = computed(() => {
  const counts = new Map<string, number>()

  for (const player of players.value) {
    for (const [mapId, score] of Object.entries(player.mapScores)) {
      if (score.source === 'lobby') counts.set(mapId, (counts.get(mapId) ?? 0) + 1)
    }
  }

  return counts
})

/** Slots that actually carry results - from a lobby, or from the sheet column they are bound to. */
const scored = computed(() =>
  visible.value.filter(map => lobbyScored.value.has(map.id) || players.value.some(player => player.mapScores[map.id]))
)

/** Each scored slot's bracket colour, by column. */
const scoredStyles = computed(() => scored.value.map(bracketStyle))

/**
 * Every heading cell of the results table. The table scrolls in a box of its own - it has to, for
 * the slot names to stay on top: it scrolls sideways too, and a sideways scroller is what a sticky
 * heading sticks to whether it scrolls down or not. Stuck, a heading needs a background of its own,
 * mixed to match the card it sits on, and its line drawn as a shadow, since a collapsed border
 * stays with the table rather than with the heading.
 */
const HEAD = 'sticky top-0 z-10 bg-[color-mix(in_oklab,var(--ui-bg-elevated)_50%,var(--color-umber-950))]'
const HEAD_LINE = 'shadow-[inset_0_-1px_0_var(--ui-border)]'

/** A sheet cell is shown as written; a read or typed-in score is a number and gets the viewer's grouping. */
const cellText = (cell: MapScore): string => cell.source === 'sheet' ? cell.display : number(cell.value)

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

const bound = computed(() => maps.value.filter(map => map.column || lobbyScored.value.has(map.id)).length)

/**
 * The cell being typed into, if any.
 *
 * A score is entered per player and slot, for a run osu! has no usable record of - a disconnect
 * early enough to submit nothing, or early enough to submit something worse. Whatever goes in here
 * is what osu! *would* have reported, mods and all, and is normalised on its way back like any
 * other; the organiser types what they saw.
 */
const editing = ref<{ player: PlayerDto, map: QualifierMap } | null>(null)
const cellScore = ref(0)
const cellMods = ref('')
const savingCell = ref(false)

// A deploy reloads every open tab; an unsaved pool or an open score editor holds it off.
useUnsavedWork(() => draft.value != null || editing.value != null)

/** What an organiser typed for this cell before, if they typed one - `null` for a read score. */
const manualFor = (osuId: string, mapId: string) =>
  state.value?.manualScores?.find(entry => entry.osuId === osuId && entry.mapId === mapId) ?? null

const editingManual = computed(() =>
  editing.value ? manualFor(editing.value.player.osuId, editing.value.map.id) : null
)

function openCell(player: PlayerDto, map: QualifierMap | undefined) {
  if (!isAdmin.value || !map) return

  const typed = manualFor(player.osuId, map.id)
  const cell = player.mapScores[map.id]

  editing.value = { player, map }
  // A score that was read is put back in the box as osu! reported it, not as it is ranked, so an
  // organiser correcting one starts from the number they would see on the scoreboard.
  cellScore.value = typed?.score ?? (cell ? Math.round(cell.value / cell.multiplier) : 0)
  cellMods.value = typed?.mods ?? (cell?.mods || map.mods || '')
}

async function saveCell(score: number | null) {
  const target = editing.value
  if (!target) return

  savingCell.value = true

  try {
    await api('/api/scores/set', {
      osuId: target.player.osuId,
      mapId: target.map.id,
      score,
      mods: cellMods.value
    })
    editing.value = null
  } finally {
    savingCell.value = false
  }
}
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

          <!-- Plain links, not fetches: the browser saves the file the route already names itself. -->
          <UButton
            icon="i-lucide-download"
            size="sm"
            color="neutral"
            variant="subtle"
            to="/api/export/maps.csv"
            external
            download
            :disabled="!maps.length"
          >
            {{ t('mappool.exportMaps') }}
          </UButton>

          <UButton
            icon="i-lucide-download"
            size="sm"
            color="neutral"
            variant="subtle"
            to="/api/export/scores.csv"
            external
            download
            :disabled="!scored.length"
          >
            {{ t('mappool.exportScores') }}
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
        :lobby-scores="lobbyScored.get(map.id) ?? 0"
        @update="update(map.id, $event)"
        @remove="removeMap(map.id)"
      />
    </section>

    <UCard
      v-if="scored.length"
      variant="subtle"
    >
      <template #header>
        <div>
          <h2 class="font-display text-lg">
            {{ t('mappool.results') }}
          </h2>
          <p class="mt-1 text-xs text-muted">
            {{ t('mappool.resultsHint') }}
          </p>
        </div>
      </template>

      <div class="max-h-[75vh] overflow-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs uppercase tracking-wider text-muted">
              <th
                class="py-2 pe-3 font-medium"
                :class="[HEAD, HEAD_LINE]"
              >
                {{ t('common.seed') }}
              </th>
              <th
                class="py-2 pe-3 font-medium"
                :class="[HEAD, HEAD_LINE]"
              >
                {{ t('sheet.field.username') }}
              </th>
              <th
                v-for="(map, index) in scored"
                :key="map.id"
                class="py-2 px-3 font-medium text-right"
                :class="[HEAD, scoredStyles[index]?.underline ?? HEAD_LINE]"
              >
                {{ map.label }}
              </th>
              <th
                class="py-2 ps-3 font-medium text-right"
                :class="[HEAD, HEAD_LINE]"
              >
                {{ t('mappool.average') }}
              </th>
              <th
                class="py-2 ps-3 font-medium text-right"
                :class="[HEAD, HEAD_LINE]"
              >
                {{ t('mappool.zSum') }}
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
                :class="[scoredStyles[index]?.tint, isAdmin ? 'cursor-pointer hover:bg-elevated/40' : '']"
                :title="isAdmin ? t('mappool.enterScore') : undefined"
                @click="openCell(row.player, scored[index])"
              >
                <span v-if="cell">
                  <UIcon
                    v-if="cell.source === 'manual'"
                    name="i-lucide-pencil"
                    class="me-1 size-3 align-middle text-muted"
                    :title="t('mappool.manual')"
                  />
                  {{ cellText(cell) }}
                  <span
                    class="ms-1 text-xs"
                    :class="cell.rank === 1 ? 'text-secondary' : 'text-muted'"
                  >#{{ cell.rank }}</span>
                  <UBadge
                    v-if="cell.mods"
                    color="primary"
                    variant="subtle"
                    size="xs"
                    class="ms-1 align-middle"
                  >
                    {{ cell.mods }}
                  </UBadge>
                </span>
                <span
                  v-else
                  class="text-muted"
                >&mdash;</span>
              </td>
              <td class="py-1.5 ps-3 text-right tnum">
                {{ number(row.average, 2) }}
              </td>
              <td
                class="py-1.5 ps-3 text-right font-display tnum"
                :class="row.player.zSum == null ? 'text-muted' : ''"
              >
                {{ row.player.zSum == null ? '—' : number(row.player.zSum, 2) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <QualifierLobbies />

    <UModal
      :open="editing != null"
      :title="editing ? `${editing.player.username} - ${editing.map.label}` : ''"
      :description="t('mappool.enterScoreHint')"
      @update:open="editing = null"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField :label="t('mappool.scoreValue')">
            <UInputNumber
              v-model="cellScore"
              :min="0"
              :step="1"
              class="w-full"
              :ui="{ base: 'tnum font-display' }"
            />
          </UFormField>

          <UFormField
            :label="t('mappool.scoreMods')"
            :help="t('mappool.scoreModsHint')"
          >
            <UInput
              v-model="cellMods"
              :placeholder="editing?.map.mods || t('common.none')"
              class="w-full"
            />
          </UFormField>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-between gap-2">
          <UButton
            v-if="editingManual"
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            :loading="savingCell"
            @click="saveCell(null)"
          >
            {{ t('common.remove') }}
          </UButton>
          <span v-else />

          <div class="flex gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              @click="editing = null"
            >
              {{ t('common.cancel') }}
            </UButton>
            <UButton
              icon="i-lucide-save"
              :loading="savingCell"
              @click="saveCell(cellScore)"
            >
              {{ t('common.save') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
