<script setup lang="ts">
import type { CaptainMode, PlayerDto } from '#shared/types'

/**
 * One player in the seeding list.
 *
 * Reordering is a list operation - the seed *is* the index - so the row only ever says "put me at
 * this position" and the server works out what that does to everyone else.
 */
defineProps<{
  player: PlayerDto
  editable: boolean
  canMoveUp: boolean
  canMoveDown: boolean
}>()

const emit = defineEmits<{
  move: [toIndex: number]
  mode: [mode: CaptainMode]
  remove: []
  dragstart: []
  drop: []
}>()

const { t } = useLang()
const { number } = useFormat()

const modes: { value: CaptainMode, icon: string }[] = [
  { value: 'AUTO', icon: 'i-lucide-circle-dashed' },
  { value: 'FORCE', icon: 'i-lucide-crown' },
  { value: 'EXCLUDE', icon: 'i-lucide-circle-slash' }
]

const dragOver = ref(false)

const onDrop = () => {
  dragOver.value = false
  emit('drop')
}
</script>

<template>
  <li
    :draggable="editable"
    class="group flex items-center gap-3 rounded-lg border border-default/50 bg-elevated/30 px-3 py-2 transition-colors"
    :class="[
      editable ? 'cursor-grab active:cursor-grabbing hover:border-secondary/40' : '',
      dragOver ? 'border-secondary bg-secondary/10' : ''
    ]"
    @dragstart="emit('dragstart')"
    @dragover.prevent="dragOver = true"
    @dragleave="dragOver = false"
    @drop.prevent="onDrop"
  >
    <span class="w-8 shrink-0 text-center font-display text-sm text-muted tnum">
      {{ player.seed }}
    </span>

    <PlayerAvatar
      :osu-id="player.osuId"
      :username="player.username"
    />

    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium">
        {{ player.username }}
        <UIcon
          v-if="player.discordVerified"
          name="i-lucide-badge-check"
          class="inline size-3.5 align-[-2px] text-secondary"
        />
      </p>
      <p class="text-xs text-muted tnum">
        <span v-if="player.ppRaw != null">{{ number(player.ppRaw) }} {{ t('common.pp') }}</span>
        <span v-if="player.zSum != null"> · {{ t('seeding.zSum', { value: number(player.zSum, 2) }) }}</span>
        <span v-else-if="player.qualScore != null"> · {{ number(player.qualScore, 2) }}</span>
        <span v-if="player.sheetSeed != null"> · {{ t('seeding.sheetSeed', { seed: player.sheetSeed }) }}</span>
      </p>
      <p
        v-if="player.description"
        class="mt-0.5 line-clamp-2 text-xs text-toned"
        :title="player.description"
      >
        {{ player.description }}
      </p>
    </div>

    <UBadge
      v-if="player.soldTo"
      color="neutral"
      variant="subtle"
      size="sm"
    >
      {{ player.price }} €
    </UBadge>

    <template v-if="editable">
      <div class="hidden sm:flex opacity-0 group-hover:opacity-100 transition-opacity">
        <UButton
          icon="i-lucide-chevron-up"
          size="xs"
          color="neutral"
          variant="ghost"
          :disabled="!canMoveUp"
          :aria-label="t('seeding.up')"
          @click="emit('move', player.seed - 2)"
        />
        <UButton
          icon="i-lucide-chevron-down"
          size="xs"
          color="neutral"
          variant="ghost"
          :disabled="!canMoveDown"
          :aria-label="t('seeding.down')"
          @click="emit('move', player.seed)"
        />
      </div>

      <UTooltip :text="t('captainMode.hint')">
        <div class="flex rounded-md bg-default/60 p-0.5">
          <UButton
            v-for="mode in modes"
            :key="mode.value"
            :icon="mode.icon"
            size="xs"
            :color="player.captainMode === mode.value ? 'secondary' : 'neutral'"
            :variant="player.captainMode === mode.value ? 'subtle' : 'ghost'"
            :aria-label="t(`captainMode.${mode.value}`)"
            @click="emit('mode', mode.value)"
          />
        </div>
      </UTooltip>

      <UButton
        icon="i-lucide-user-round-x"
        size="xs"
        color="error"
        variant="ghost"
        class="opacity-0 group-hover:opacity-100 transition-opacity"
        :aria-label="t('seeding.remove')"
        @click="emit('remove')"
      />
    </template>

    <UBadge
      v-else-if="player.captainMode !== 'AUTO'"
      color="neutral"
      variant="subtle"
      size="sm"
    >
      {{ t(`captainMode.${player.captainMode}`) }}
    </UBadge>
  </li>
</template>
