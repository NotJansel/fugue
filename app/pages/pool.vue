<script setup lang="ts">
const { state, players, teams, isAdmin, api, auction } = useDashboard()
const { t } = useLang()
const { money, number } = useFormat()

const startingBid = ref<number>(0)
const maxBid = ref<number>(0)
const starting = ref<string | null>(null)
const unpassing = ref<string | null>(null)

// The defaults live with the tournament, so a reload - or a second organiser's tab - starts from the
// same bid range rather than from zero.
watchEffect(() => {
  // The effective opening price, so the second run's half price is already in the box.
  startingBid.value = state.value?.config.startingBid ?? 0
  maxBid.value = state.value?.config.defaultMaxBid ?? 0
})

const secondRun = computed(() => state.value?.config.secondRun === true)

const toggleSecondRun = (value: boolean) => api('/api/config', { secondRun: value }, { quiet: true })

const teamNames = computed(() => new Map(teams.value.map(team => [team.captainOsuId, team.name])))

// Only the field takes part: anyone below the cut keeps their seed and results but is not for sale.
const pool = computed(() => players.value.filter(player => player.inField && !player.isCaptain))
// Unsold, and not already passed over in this run - who can go under the hammer right now.
const open = computed(() => pool.value.filter(player => player.soldTo == null && !player.passedOver))

const canStart = computed(() =>
  isAdmin.value && state.value?.config.auctionChannelConfigured === true && auction.value == null
)

/** Lets a player nobody bid on be offered again in this run - for an auction that ran out by mistake. */
async function unpass(osuId: string) {
  unpassing.value = osuId

  try {
    await api('/api/auction/unpass', { osuId })
  } finally {
    unpassing.value = null
  }
}

/** Which button is busy starting an auction: a player's osu! ID, or `RANDOM` for the random draw. */
const RANDOM = 'random'

/** Starts an auction for `osuId`, or with none for a player the server draws from whoever is open. */
async function start(osuId: string | null) {
  starting.value = osuId ?? RANDOM

  try {
    await api('/api/auction/start', { osuId, startingBid: startingBid.value, maxBid: maxBid.value })
  } finally {
    starting.value = null
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="font-display text-2xl">
          {{ t('pool.title') }}
        </h1>
        <p class="text-sm text-muted">
          {{ t('pool.summary', { remaining: open.length, total: pool.length }) }}
        </p>
        <PresenceSummary
          v-if="isAdmin"
          class="mt-2"
        />
      </div>

      <div
        v-if="isAdmin"
        class="flex flex-wrap items-end gap-3"
      >
        <USwitch
          :model-value="secondRun"
          :label="t('pool.secondRun')"
          color="secondary"
          class="mb-2"
          @update:model-value="toggleSecondRun($event)"
        />
        <UFormField
          :label="t('pool.start')"
          size="sm"
        >
          <UInputNumber
            v-model="startingBid"
            :min="0"
            class="w-32"
          />
        </UFormField>
        <UFormField
          :label="t('pool.max')"
          size="sm"
        >
          <UInputNumber
            v-model="maxBid"
            :min="0"
            class="w-32"
          />
        </UFormField>
        <UButton
          icon="i-lucide-dices"
          color="secondary"
          :disabled="!canStart || !open.length || starting != null"
          :loading="starting === RANDOM"
          @click="start(null)"
        >
          {{ t('pool.random') }}
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="secondRun"
      icon="i-lucide-percent"
      color="secondary"
      variant="subtle"
      :description="t('pool.secondRunOn', { step: money(state?.config.bidIncrement ?? 1) })"
    />

    <UAlert
      v-if="isAdmin && !state?.config.auctionChannelConfigured"
      icon="i-lucide-hash"
      color="warning"
      variant="subtle"
      :description="t('pool.noChannel')"
    />

    <UAlert
      v-else-if="isAdmin && auction"
      icon="i-lucide-gavel"
      color="neutral"
      variant="subtle"
      :description="t('pool.running')"
    />

    <p
      v-if="!pool.length"
      class="rounded-xl border border-dashed border-default/60 py-14 text-center text-sm text-muted"
    >
      {{ t('pool.empty') }}
    </p>

    <div
      v-else
      class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      <div
        v-for="player in pool"
        :key="player.osuId"
        class="flex items-center gap-3 rounded-xl border border-default/50 bg-elevated/30 px-3 py-2.5"
        :class="player.soldTo || player.passedOver ? 'opacity-60' : ''"
      >
        <span class="w-7 shrink-0 text-center font-display text-sm text-muted tnum">{{ player.seed }}</span>

        <PlayerAvatar
          :osu-id="player.osuId"
          :username="player.username"
          size="md"
        />

        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">
            {{ player.username }}
          </p>
          <p
            v-if="player.soldTo"
            class="truncate text-xs text-secondary"
          >
            {{ t('pool.sold', {
              team: teamNames.get(player.soldTo) ?? '?',
              price: money(player.price)
            }) }}
          </p>
          <p
            v-else-if="player.passedOver"
            class="truncate text-xs text-muted"
          >
            {{ t(secondRun ? 'pool.passedSecond' : 'pool.passedFirst') }}
          </p>
          <p
            v-else
            class="text-xs text-muted tnum"
          >
            {{ number(player.ppRaw) }} {{ t('common.pp') }}
            <span v-if="player.ppRank"> · #{{ number(player.ppRank) }}</span>
          </p>
        </div>

        <UButton
          v-if="isAdmin && !player.soldTo && player.passedOver"
          icon="i-lucide-rotate-ccw"
          size="xs"
          color="neutral"
          variant="ghost"
          :loading="unpassing === player.osuId"
          @click="unpass(player.osuId)"
        >
          {{ t('pool.unpass') }}
        </UButton>

        <UButton
          v-if="canStart && !player.soldTo && !player.passedOver"
          icon="i-lucide-gavel"
          size="xs"
          variant="subtle"
          :loading="starting === player.osuId"
          @click="start(player.osuId)"
        >
          {{ t('pool.auction') }}
        </UButton>
      </div>
    </div>
  </div>
</template>
