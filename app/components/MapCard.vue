<script setup lang="ts">
import type { QualifierMap } from '#shared/types'

/**
 * One mappool slot.
 *
 * In edit mode the card *is* the form: the fields sit where the values do, so an organiser never has
 * to hold "which row was that" in their head while typing. Star rating and difficulty settings are
 * shown exactly as stored, which is to say already adjusted for the slot's mods.
 */
const props = withDefaults(
  defineProps<{
    map: QualifierMap
    editing: boolean
    columns: string[]
    /** Players whose score on this slot was read from a lobby rather than the sheet. */
    lobbyScores?: number
  }>(),
  { lobbyScores: 0 }
)

const emit = defineEmits<{ update: [patch: Partial<QualifierMap>], remove: [] }>()

const { t } = useLang()
const { number, duration } = useFormat()

const cover = computed(() =>
  props.map.beatmapsetId ? `https://assets.ppy.sh/beatmaps/${props.map.beatmapsetId}/covers/cover.jpg` : null
)

const link = computed(() => props.map.beatmapId ? `https://osu.ppy.sh/b/${props.map.beatmapId}` : null)

const columnItems = computed(() => [
  { label: t('common.none'), value: SELECT_NONE },
  ...props.columns.map(column => ({ label: column, value: column }))
])

const settings = computed(() => [
  { label: 'CS', value: props.map.cs },
  { label: 'AR', value: props.map.ar },
  { label: 'OD', value: props.map.od },
  { label: 'HP', value: props.map.hp }
])
</script>

<template>
  <div class="relative overflow-hidden rounded-xl border border-default/50 bg-elevated/30">
    <div
      v-if="cover"
      class="absolute inset-0 bg-cover bg-center opacity-20"
      :style="{ backgroundImage: `url(${cover})` }"
    />
    <div class="absolute inset-0 bg-gradient-to-r from-default/95 via-default/85 to-default/60" />

    <div class="relative flex flex-wrap items-center gap-3 p-3">
      <div class="flex items-center gap-2">
        <UBadge
          color="secondary"
          variant="subtle"
          class="font-display"
        >
          {{ map.label }}
        </UBadge>
        <UBadge
          v-if="map.mods"
          color="primary"
          variant="subtle"
          size="sm"
        >
          {{ map.mods }}
        </UBadge>
      </div>

      <div class="min-w-0 flex-1">
        <template v-if="map.title">
          <component
            :is="link ? 'a' : 'div'"
            :href="link ?? undefined"
            target="_blank"
            rel="noopener"
            class="block min-w-0"
          >
            <p class="truncate text-sm font-medium hover:text-secondary transition-colors">
              {{ map.artist }} - {{ map.title }}
            </p>
            <p class="truncate text-xs text-muted">
              [{{ map.version }}]
            </p>
          </component>
        </template>
        <p
          v-else
          class="text-xs text-muted"
        >
          {{ t('mappool.unresolved') }}
        </p>
      </div>

      <div
        v-if="map.stars != null"
        class="flex items-center gap-1 font-display text-secondary tnum"
      >
        <UIcon
          name="i-lucide-star"
          class="size-3.5"
        />
        {{ number(map.stars, 2) }}
      </div>

      <div class="hidden lg:flex items-center gap-3 text-xs text-muted tnum">
        <span
          v-for="setting in settings"
          :key="setting.label"
        >
          {{ setting.label }} {{ number(setting.value, 1) }}
        </span>
        <span v-if="map.bpm != null">{{ number(map.bpm) }} BPM</span>
        <span v-if="map.lengthSeconds != null">{{ duration(map.lengthSeconds) }}</span>
      </div>

      <UBadge
        v-if="!editing && lobbyScores > 0"
        color="secondary"
        variant="subtle"
        size="sm"
        icon="i-lucide-radio"
      >
        {{ t('mappool.fromLobbies', { count: lobbyScores }) }}
      </UBadge>
      <UBadge
        v-else-if="!editing && map.column"
        color="neutral"
        variant="subtle"
        size="sm"
        icon="i-lucide-table-2"
      >
        {{ map.column }}
      </UBadge>
    </div>

    <div
      v-if="editing"
      class="relative grid gap-2 border-t border-default/40 p-3 sm:grid-cols-2 lg:grid-cols-5"
    >
      <UFormField
        :label="t('mappool.field.label')"
        size="xs"
      >
        <UInput
          :model-value="map.label"
          size="sm"
          @update:model-value="emit('update', { label: String($event) })"
        />
      </UFormField>

      <UFormField
        :label="t('mappool.field.mods')"
        :help="t('mappool.modsHint')"
        size="xs"
      >
        <UInput
          :model-value="map.mods"
          size="sm"
          placeholder="HDDT"
          @update:model-value="emit('update', { mods: String($event).toUpperCase() })"
        />
      </UFormField>

      <UFormField
        :label="t('mappool.field.beatmap')"
        size="xs"
      >
        <UInput
          :model-value="map.beatmapId ?? ''"
          size="sm"
          @update:model-value="emit('update', { beatmapId: String($event) || null })"
        />
      </UFormField>

      <UFormField
        :label="t('mappool.field.column')"
        size="xs"
      >
        <USelect
          :model-value="map.column ?? SELECT_NONE"
          :items="columnItems"
          value-key="value"
          size="sm"
          @update:model-value="emit('update', { column: selectValue($event) })"
        />
      </UFormField>

      <div class="flex items-end gap-2">
        <UFormField
          :label="t('mappool.field.stage')"
          size="xs"
          class="flex-1"
        >
          <UInput
            :model-value="map.stage"
            size="sm"
            placeholder="RO16"
            @update:model-value="emit('update', { stage: String($event) })"
          />
        </UFormField>
        <UButton
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          size="sm"
          :aria-label="t('common.remove')"
          @click="emit('remove')"
        />
      </div>
    </div>
  </div>
</template>
