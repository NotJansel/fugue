<script setup lang="ts">
import type { CaptainMode, PlayerDto } from '#shared/types'

const { state, players, isAdmin, api } = useDashboard()
const { t } = useLang()

const locked = computed(() => state.value?.config.seedingLocked ?? false)
const editable = computed(() => isAdmin.value && !locked.value)

const captains = computed(() => players.value.filter(player => player.isCaptain))
const pool = computed(() => players.value.filter(player => !player.isCaptain))

/** The row picked up by a drag, so a drop knows what to move where. */
const dragging = ref<PlayerDto | null>(null)

const move = (osuId: string, toIndex: number) => api('/api/seeding/move', { osuId, toIndex }, { quiet: true })

const drop = (target: PlayerDto) => {
  const source = dragging.value
  dragging.value = null

  if (!source || source.osuId === target.osuId) return

  // Seeds are 1-based on screen and indices are 0-based on the wire.
  return move(source.osuId, target.seed - 1)
}

const setMode = (osuId: string, mode: CaptainMode) => api('/api/players/captain', { osuId, mode }, { quiet: true })

const toggleLock = (value: boolean) => api('/api/seeding/lock', { locked: value }, { quiet: true })

/** Whether any result is on file to seed by - what makes the reseed button worth showing. */
const hasResults = computed(() => players.value.some(player => player.zSum != null))

const reseeding = ref(false)

async function reseed() {
  reseeding.value = true

  try {
    await api('/api/seeding/reseed')
  } finally {
    reseeding.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="font-display text-2xl">
          {{ t('seeding.title') }}
        </h1>
        <p class="text-sm text-muted">
          {{ t('seeding.summary', {
            players: players.length,
            captains: captains.length,
            pool: pool.length
          }) }}
        </p>
      </div>

      <div class="flex items-center gap-3">
        <p
          v-if="editable"
          class="hidden sm:block text-xs text-muted"
        >
          {{ t('seeding.dragHint') }}
        </p>
        <UButton
          v-if="editable && hasResults"
          icon="i-lucide-sigma"
          size="sm"
          color="neutral"
          variant="subtle"
          :loading="reseeding"
          @click="reseed"
        >
          {{ t('seeding.reseed') }}
        </UButton>
        <USwitch
          v-if="isAdmin"
          :model-value="locked"
          :label="t('seeding.lock')"
          color="secondary"
          @update:model-value="toggleLock($event)"
        />
      </div>
    </div>

    <UAlert
      v-if="locked"
      icon="i-lucide-lock"
      color="neutral"
      variant="subtle"
      :description="t('seeding.locked')"
    />
    <UAlert
      v-else-if="isAdmin && hasResults"
      icon="i-lucide-sigma"
      color="neutral"
      variant="subtle"
      :description="t('seeding.followsResults')"
    />

    <p
      v-if="!players.length"
      class="rounded-xl border border-dashed border-default/60 py-14 text-center text-sm text-muted"
    >
      {{ t('seeding.empty') }}
    </p>

    <div
      v-else
      class="grid gap-6 lg:grid-cols-2"
    >
      <section class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="font-display text-lg">
            {{ t('seeding.captains') }}
          </h2>
          <UBadge
            color="secondary"
            variant="subtle"
          >
            {{ captains.length }}
          </UBadge>
        </div>

        <ol
          v-if="captains.length"
          class="space-y-2"
        >
          <SeedRow
            v-for="player in captains"
            :key="player.osuId"
            :player="player"
            :editable="editable"
            :can-move-up="player.seed > 1"
            :can-move-down="player.seed < players.length"
            @move="move(player.osuId, $event)"
            @mode="setMode(player.osuId, $event)"
            @dragstart="dragging = player"
            @drop="drop(player)"
          />
        </ol>
        <p
          v-else
          class="text-sm text-muted"
        >
          {{ t('seeding.noCaptains') }}
        </p>
      </section>

      <section class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="font-display text-lg">
            {{ t('seeding.pool') }}
          </h2>
          <UBadge
            color="neutral"
            variant="subtle"
          >
            {{ pool.length }}
          </UBadge>
        </div>

        <ol
          v-if="pool.length"
          class="space-y-2"
        >
          <SeedRow
            v-for="player in pool"
            :key="player.osuId"
            :player="player"
            :editable="editable"
            :can-move-up="player.seed > 1"
            :can-move-down="player.seed < players.length"
            @move="move(player.osuId, $event)"
            @mode="setMode(player.osuId, $event)"
            @dragstart="dragging = player"
            @drop="drop(player)"
          />
        </ol>
        <p
          v-else
          class="text-sm text-muted"
        >
          {{ t('seeding.noPool') }}
        </p>
      </section>
    </div>
  </div>
</template>
