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

/** The player whose removal is being confirmed, if any. */
const removing = ref<PlayerDto | null>(null)

async function remove() {
  const player = removing.value
  removing.value = null
  if (!player) return

  await api('/api/players/remove', { osuId: player.osuId })
}

/** The player whose description is being overridden, and the text in the box. */
const describing = ref<PlayerDto | null>(null)
const descriptionDraft = ref('')

function describe(player: PlayerDto) {
  describing.value = player
  descriptionDraft.value = player.description ?? ''
}

/** `null` takes the override away, so the sheet's own text shows again. */
async function saveDescription(description: string | null) {
  const player = describing.value
  describing.value = null
  if (!player) return

  // Text left as the sheet has it is no override at all - saved as one, it would only stop a later
  // import from bringing the player's own edits through.
  const asSheet = description != null && description.trim() === (player.sheetDescription ?? '').trim()
  if (asSheet && !player.descriptionOverridden) return

  await api('/api/players/description', { osuId: player.osuId, description: asSheet ? null : description })
}

/** Whether any result is on file to seed by - what makes the reseed button worth showing. */
const hasResults = computed(() => players.value.some(player => player.zSum != null))

/** An osu! ID or username typed in to put a player on the list without an import. */
const newPlayer = ref('')
const addingPlayer = ref(false)

useUnsavedWork(() => describing.value != null || newPlayer.value.trim() !== '')

async function addPlayer() {
  addingPlayer.value = true

  try {
    await api('/api/players/add', { user: newPlayer.value })
    newPlayer.value = ''
  } finally {
    addingPlayer.value = false
  }
}

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

    <div
      v-if="editable"
      class="flex flex-wrap items-end gap-3"
    >
      <UFormField
        :label="t('seeding.addPlayer')"
        :hint="t('seeding.addPlayerHint')"
        class="flex-1 min-w-64"
        size="sm"
      >
        <UInput
          v-model="newPlayer"
          :placeholder="t('seeding.addPlayerPlaceholder')"
          class="w-full"
          @keyup.enter="addPlayer"
        />
      </UFormField>
      <UButton
        icon="i-lucide-user-plus"
        :loading="addingPlayer"
        :disabled="!newPlayer"
        @click="addPlayer"
      >
        {{ t('common.add') }}
      </UButton>
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
            :describable="isAdmin"
            :can-move-up="player.seed > 1"
            :can-move-down="player.seed < players.length"
            @move="move(player.osuId, $event)"
            @mode="setMode(player.osuId, $event)"
            @remove="removing = player"
            @describe="describe(player)"
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
            :describable="isAdmin"
            :can-move-up="player.seed > 1"
            :can-move-down="player.seed < players.length"
            @move="move(player.osuId, $event)"
            @mode="setMode(player.osuId, $event)"
            @remove="removing = player"
            @describe="describe(player)"
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

    <UModal
      :open="describing != null"
      :title="t('seeding.description.edit')"
      :description="describing ? t('seeding.description.hint', { name: describing.username }) : ''"
      @update:open="describing = $event ? describing : null"
    >
      <template #body>
        <div class="space-y-4">
          <UTextarea
            v-model="descriptionDraft"
            :rows="5"
            autoresize
            autofocus
            class="w-full"
          />

          <div
            v-if="describing?.sheetDescription"
            class="space-y-1"
          >
            <p class="text-[11px] uppercase tracking-wider text-muted">
              {{ t('seeding.description.fromSheet') }}
            </p>
            <p class="whitespace-pre-line border-l-2 border-default pl-3 text-xs text-muted">
              {{ describing.sheetDescription }}
            </p>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full flex-wrap justify-between gap-2">
          <UButton
            v-if="describing?.descriptionOverridden"
            color="neutral"
            variant="subtle"
            icon="i-lucide-rotate-ccw"
            @click="saveDescription(null)"
          >
            {{ t('seeding.description.reset') }}
          </UButton>
          <span v-else />

          <div class="flex gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              @click="describing = null"
            >
              {{ t('common.cancel') }}
            </UButton>
            <UButton @click="saveDescription(descriptionDraft)">
              {{ t('common.save') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <UModal
      :open="removing != null"
      :title="t('seeding.remove')"
      :description="removing ? t('seeding.removeConfirm', { name: removing.username }) : ''"
      @update:open="removing = $event ? removing : null"
    >
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="removing = null"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="error"
            @click="remove"
          >
            {{ t('seeding.remove') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
