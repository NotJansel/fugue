<script setup lang="ts">
import type { AuctionSaleDto } from '#shared/types'

/**
 * Announces who just bought whom, across the top of every page, for ten seconds after the hammer
 * falls.
 *
 * Only a sale that arrives while the page is open is announced: whatever is on file when it loads
 * has already been announced to whoever was watching, and a reload should not play it again.
 */
const DISMISS_AFTER_MS = 10_000

const { state } = useDashboard()
const { t } = useLang()
const { money } = useFormat()

const shown = ref<AuctionSaleDto | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

const dismiss = () => {
  clearTimeout(timer)
  shown.value = null
}

onMounted(() => {
  watch(
    () => state.value?.lastSale ?? null,
    (sale, previous) => {
      if (!sale || sale.id === previous?.id) return

      clearTimeout(timer)
      shown.value = sale
      timer = setTimeout(dismiss, DISMISS_AFTER_MS)
    }
  )
})

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4">
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="-translate-y-4 opacity-0"
      leave-active-class="transition duration-200 ease-in"
      leave-to-class="-translate-y-4 opacity-0"
    >
      <div
        v-if="shown"
        :key="shown.id"
        role="status"
        class="pointer-events-auto relative w-full max-w-lg overflow-hidden rounded-xl border border-secondary/40 bg-elevated/95 shadow-lg backdrop-blur"
      >
        <div class="flex items-center gap-3 px-4 py-3">
          <PlayerAvatar
            :osu-id="shown.osuId"
            :username="shown.username"
            size="md"
          />

          <p class="min-w-0 flex-1 text-sm">
            <UIcon
              name="i-lucide-gavel"
              class="me-1 size-4 align-[-3px] text-secondary"
            />
            {{ t('auction.sold', { player: shown.username, team: shown.teamName, price: money(shown.price) }) }}
          </p>

          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="t('common.close')"
            @click="dismiss"
          />
        </div>

        <div
          class="sale-countdown h-0.5 bg-secondary"
          :style="{ animationDuration: `${DISMISS_AFTER_MS}ms` }"
        />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.sale-countdown {
  transform-origin: left;
  animation-name: sale-countdown;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}

@keyframes sale-countdown {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}
</style>
