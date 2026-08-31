<script setup lang="ts">
import type { AuctionSnapshot } from '#shared/types'

/**
 * Where bids are placed - the one non-admin write in the whole dashboard.
 *
 * The bidder is never sent: the server takes it from the session and checks that the Discord account
 * owns a captain, so a bid can't be placed as someone else. All this panel does is help you pick a
 * number your purse can actually cover.
 */
const props = defineProps<{ auction: AuctionSnapshot }>()

const { api, user, myCaptain, myTeam } = useDashboard()
const { t } = useLang()
const { money } = useFormat()

const amount = ref<number>(0)
const pending = ref(false)

const available = computed(() => (myTeam.value?.balance ?? 0) - (myTeam.value?.held ?? 0))
const leading = computed(() => props.auction.highestBidderId != null && props.auction.highestBidderId === user.value?.id)

/** The smallest bid that would actually take: one over the leader, or the starting price if untouched. */
const minimum = computed(() =>
  props.auction.highestBidderId == null
    ? Math.max(props.auction.startingBid, 0)
    : props.auction.highestBid + 1
)

watchEffect(() => {
  if (amount.value < minimum.value) amount.value = Math.min(minimum.value, props.auction.maxBid)
})

const steps = [1, 5, 10, 25]

const bump = (by: number) => {
  amount.value = Math.min(Math.max(amount.value + by, minimum.value), props.auction.maxBid)
}

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

    <div
      v-else
      class="space-y-4"
    >
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

      <UFormField :label="t('auction.bid.amount')">
        <UInputNumber
          v-model="amount"
          :min="minimum"
          :max="auction.maxBid"
          :step="1"
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
          @click="amount = auction.maxBid"
        >
          {{ money(auction.maxBid) }}
        </UButton>
      </div>

      <UButton
        block
        size="lg"
        icon="i-lucide-gavel"
        :loading="pending"
        :disabled="leading || amount > available"
        @click="bid"
      >
        {{ t('auction.bid.place') }}
      </UButton>
    </div>
  </UCard>
</template>
