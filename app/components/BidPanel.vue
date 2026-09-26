<script setup lang="ts">
import type { AuctionSnapshot } from '#shared/types'

/**
 * Where bids are placed - the one non-admin write in the whole dashboard.
 *
 * The bidder is never sent: the server takes it from the session and checks that the Discord account
 * owns a captain or stands in for one, so a bid can't be placed as someone else. All this panel does
 * is help you pick a number the team's purse can actually cover.
 */
const props = defineProps<{ auction: AuctionSnapshot }>()

const { state, api, myCaptain, myTeam, standingIn, user } = useDashboard()
const { t } = useLang()
const { money } = useFormat()

const amount = ref<number>(0)
const pending = ref(false)

const available = computed(() => (myTeam.value?.balance ?? 0) - (myTeam.value?.held ?? 0))
// The lead is held under the captain's Discord ID whoever placed the bid, so a captain and their
// stand-in lead together.
const leading = computed(() =>
  props.auction.highestBidderId != null && props.auction.highestBidderId === myTeam.value?.discordId
)

/** Gold that cannot be spent here, because the team still has to reach its smallest legal size. */
const reserved = computed(() => myTeam.value?.reserved ?? 0)
const teamFull = computed(() => (myTeam.value?.slotsLeft ?? 1) === 0)

/**
 * The window a legal bid falls in.
 *
 * The opening bid is measured from the starting price and every later one from the standing bid, so
 * the same two steps bound both - which is exactly how the server decides, spelled out here so a
 * captain sees the range rather than discovering it through a rejection.
 */
const standing = computed(() =>
  props.auction.highestBidderId == null ? props.auction.startingBid : props.auction.highestBid
)

const minimum = computed(() => props.auction.highestBidderId == null
  ? props.auction.startingBid
  : standing.value + (state.value?.config.bidIncrement ?? 1))

const maximum = computed(() => {
  const step = state.value?.config.maxBidIncrement ?? 0
  const byStep = step > 0 ? standing.value + step : props.auction.maxBid

  return Math.min(byStep, props.auction.maxBid, Math.max(available.value - reserved.value, 0))
})

watchEffect(() => {
  if (amount.value < minimum.value) amount.value = Math.min(minimum.value, props.auction.maxBid)
})

/** Quick raises - finer on the second run, where the players cost half and the minimum raise is 50. */
const steps = computed(() => state.value?.config.secondRun ? [50, 100, 500] : [100, 500, 1000])

const bump = (by: number) => {
  amount.value = Math.min(Math.max(amount.value + by, minimum.value), maximum.value)
}

/** Whether the number in the box is one the server would take. */
const legal = computed(() =>
  !leading.value && !teamFull.value && amount.value >= minimum.value && amount.value <= maximum.value
)

async function bid() {
  pending.value = true

  try {
    await api('/api/auction/bid', { amount: amount.value })
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UCard variant="subtle">
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <h3 class="font-display text-lg">
          {{ t('auction.bid.title') }}
        </h3>
        <UBadge
          v-if="leading"
          color="secondary"
          variant="subtle"
          icon="i-lucide-crown"
        >
          {{ t('auction.bid.leading') }}
        </UBadge>
      </div>
    </template>

    <div
      v-if="!user"
      class="space-y-3"
    >
      <p class="text-sm text-muted">
        {{ t('auction.bid.signIn') }}
      </p>
      <UButton
        to="/login"
        external
        icon="i-simple-icons-discord"
        block
      >
        {{ t('nav.signIn') }}
      </UButton>
    </div>

    <p
      v-else-if="!myCaptain"
      class="text-sm text-muted"
    >
      {{ t('auction.bid.notCaptain') }}
    </p>

    <p
      v-else-if="teamFull"
      class="text-sm text-warning"
    >
      {{ t('auction.bid.teamFull') }}
    </p>

    <div
      v-else
      class="space-y-4"
    >
      <p
        v-if="standingIn"
        class="rounded-lg bg-secondary/10 px-3 py-2 text-xs text-toned"
      >
        {{ t('auction.bid.standingIn', { team: myTeam?.name ?? myCaptain.username }) }}
      </p>

      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-lg bg-elevated/50 px-3 py-2">
          <p class="text-[11px] uppercase tracking-wider text-muted">
            {{ t('auction.bid.purse') }}
          </p>
          <p class="font-display text-lg tnum">
            {{ money(myTeam?.balance ?? 0) }}
          </p>
        </div>
        <div class="rounded-lg bg-elevated/50 px-3 py-2">
          <p class="text-[11px] uppercase tracking-wider text-muted">
            {{ t('auction.bid.available') }}
          </p>
          <p
            class="font-display text-lg tnum"
            :class="available < amount ? 'text-error' : 'text-secondary'"
          >
            {{ money(available) }}
          </p>
        </div>
      </div>

      <p
        v-if="reserved > 0"
        class="rounded-lg bg-elevated/40 px-3 py-2 text-xs text-muted"
      >
        {{ t('auction.bid.reserved', { count: myTeam?.slotsToMinimum ?? 0 }) }}
        <span class="text-default tnum">{{ money(reserved) }}</span>
      </p>

      <UFormField
        :label="t('auction.bid.amount')"
        :help="t('auction.bid.range', { min: money(minimum), max: money(maximum) })"
      >
        <UInputNumber
          v-model="amount"
          :min="minimum"
          :max="maximum"
          :step="state?.config.bidIncrement ?? 1"
          size="xl"
          class="w-full"
          :ui="{ base: 'tnum font-display text-xl' }"
        />
      </UFormField>

      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="step in steps"
          :key="step"
          size="xs"
          color="neutral"
          variant="subtle"
          @click="bump(step)"
        >
          +{{ step }}
        </UButton>
        <UButton
          size="xs"
          color="neutral"
          variant="subtle"
          @click="amount = maximum"
        >
          {{ money(maximum) }}
        </UButton>
      </div>

      <UButton
        block
        size="lg"
        icon="i-lucide-gavel"
        :loading="pending"
        :disabled="!legal"
        @click="bid"
      >
        {{ t('auction.bid.place') }}
      </UButton>
    </div>
  </UCard>
</template>
