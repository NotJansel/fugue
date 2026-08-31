<script setup lang="ts">
const { state, players, teams, isAdmin, api, auction } = useDashboard()
const { t } = useLang()
const { money, number } = useFormat()

const startingBid = ref<number>(0)
const maxBid = ref<number>(0)
const starting = ref<string | null>(null)

// The defaults live with the tournament, so a reload - or a second organiser's tab - starts from the
// same bid range rather than from zero.
watchEffect(() => {
  startingBid.value = state.value?.config.defaultStartingBid ?? 0
  maxBid.value = state.value?.config.defaultMaxBid ?? 0
})

const teamNames = computed(() => new Map(teams.value.map(team => [team.captainOsuId, team.name])))

const pool = computed(() => players.value.filter(player => !player.isCaptain))
const unsold = computed(() => pool.value.filter(player => player.soldTo == null))

const canStart = computed(() =>
  isAdmin.value && state.value?.config.auctionChannelConfigured === true && auction.value == null
)

async function start(osuId: string) {
  starting.value = osuId

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
          {{ t('pool.summary', { remaining: unsold.length, total: pool.length }) }}
        </p>
      </div>

      <div
        v-if="isAdmin"
        class="flex flex-wrap items-end gap-3"
      >
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
      </div>
    </div>

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
        :class="player.soldTo ? 'opacity-60' : ''"
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
            v-else
            class="text-xs text-muted tnum"
          >
            {{ number(player.ppRaw) }} {{ t('common.pp') }}
            <span v-if="player.ppRank"> · #{{ number(player.ppRank) }}</span>
          </p>
        </div>

        <UButton
          v-if="canStart && !player.soldTo"
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
