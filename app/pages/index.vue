<script setup lang="ts">
import type { MapScore, QualifierMap } from '#shared/types'

const { state, auction, isAdmin, api, players } = useDashboard()
const { t } = useLang()
const { money, number } = useFormat()

const endsAt = computed(() => auction.value?.endsAt ?? null)
const { seconds, fraction } = useCountdown(endsAt)

// The few seconds between the player going up and bids being taken, counted down on their own ring.
const opensAt = computed(() => auction.value?.opensAt ?? null)
const opening = useCountdown(opensAt, OPENING_DELAY_MS)
const waiting = computed(() => opening.remainingMs.value > 0)

const cancelling = ref(false)

async function cancel() {
  cancelling.value = true

  try {
    await api('/api/auction/cancel')
  } finally {
    cancelling.value = false
  }
}

/**
 * The player on the block, as the seeding knows them.
 *
 * The auction's own subject is a snapshot taken when it started; the results are not on it and have
 * no business being, so they are read off the pushed player list instead - the same numbers the
 * mappool page shows, and the same ones the seed was worked out from.
 */
const onBlock = computed(() => players.value.find(player => player.osuId === auction.value?.osuId) ?? null)

/** The qualifier slots, picked the way the server picks them: the round named so, or the whole pool. */
const qualifierMaps = computed(() => {
  const pool = state.value?.mappool ?? []
  const named = pool.filter(map => /qualif/i.test(map.stage))

  return named.length > 0 ? named : pool
})

/** What the player on the block put up in the qualifiers, in pool order. Slots they skipped are left out. */
const quals = computed(() => {
  const player = onBlock.value
  if (!player) return []

  return qualifierMaps.value
    .map(map => ({ map, score: player.mapScores[map.id] }))
    .filter((entry): entry is { map: typeof entry.map, score: MapScore } => entry.score != null)
})

/** The beatmap's own background, the same one the mappool cards are built on. */
const coverFor = (map: QualifierMap): string | null =>
  map.beatmapsetId ? `https://assets.ppy.sh/beatmaps/${map.beatmapsetId}/covers/cover.jpg` : null

/** A sheet cell is shown as written; a read or typed-in score is a number and gets the viewer's grouping. */
const cellText = (cell: MapScore): string => cell.source === 'sheet' ? cell.display : number(cell.value)

/** Who is on the block after this one - the pool in seeding order, minus everyone already sold. */
const upNext = computed(() =>
  players.value
    .filter(player => !player.isCaptain && player.soldTo == null && player.osuId !== auction.value?.osuId)
    .slice(0, 8)
)

const remaining = computed(() => state.value?.poolRemaining ?? 0)
</script>

<template>
  <div class="space-y-6">
    <template v-if="auction">
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <UCard
          variant="subtle"
          class="gilded ring-1 ring-secondary/25"
          :ui="{ body: 'sm:p-6' }"
        >
          <div class="flex flex-wrap items-start gap-5">
            <PlayerAvatar
              :osu-id="auction.osuId"
              :username="auction.username"
              size="3xl"
              class="size-20 sm:size-24"
            />

            <div class="min-w-0 flex-1 space-y-2">
              <UBadge
                color="secondary"
                variant="subtle"
                size="sm"
                class="gap-1.5"
              >
                <span class="size-1.5 rounded-full bg-current pulse-gold" />
                {{ t('auction.live') }}
              </UBadge>

              <h1 class="font-display text-3xl sm:text-4xl leading-tight truncate">
                {{ auction.username }}
              </h1>

              <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted tnum">
                <span>{{ t('common.seed') }} #{{ auction.seed }}</span>
                <span>{{ number(auction.ppRaw) }} {{ t('common.pp') }}</span>
                <span>{{ t('common.rank') }} #{{ number(auction.ppRank) }}</span>
              </div>

              <p
                v-if="auction.description"
                class="max-w-prose whitespace-pre-line border-l-2 border-secondary/40 pl-3 text-sm text-toned"
              >
                {{ auction.description }}
              </p>
            </div>

            <div class="flex shrink-0 flex-col items-center gap-1">
              <CountdownRing
                :seconds="waiting ? opening.seconds.value : seconds"
                :fraction="waiting ? opening.fraction.value : fraction"
                :waiting="waiting"
              />
              <span
                v-if="waiting"
                class="text-[11px] uppercase tracking-wider text-muted"
              >
                {{ t('auction.opening') }}
              </span>
            </div>
          </div>

          <USeparator class="my-5" />

          <div class="grid gap-4 sm:grid-cols-3">
            <div>
              <p class="text-[11px] uppercase tracking-wider text-muted">
                {{ t('auction.startingPrice') }}
              </p>
              <p class="font-display text-xl tnum">
                {{ money(auction.startingBid) }}
              </p>
            </div>
            <div>
              <p class="text-[11px] uppercase tracking-wider text-muted">
                {{ t('auction.maxPrice') }}
              </p>
              <p class="font-display text-xl tnum">
                {{ money(auction.maxBid) }}
              </p>
            </div>
            <div>
              <p class="text-[11px] uppercase tracking-wider text-muted">
                {{ t('auction.highest') }}
              </p>
              <p
                class="font-display text-2xl tnum"
                :class="auction.highestBid > 0 ? 'text-secondary' : 'text-muted'"
              >
                {{ auction.highestBid > 0 ? money(auction.highestBid) : t('auction.noBids') }}
              </p>
              <p
                v-if="state?.auctionLeader"
                class="text-xs text-muted mt-0.5"
              >
                {{ t('auction.leader') }}: <span class="text-default">{{ state.auctionLeader }}</span>
              </p>
            </div>
          </div>

          <template v-if="quals.length">
            <USeparator class="my-5" />

            <div class="space-y-2">
              <p class="text-[11px] uppercase tracking-wider text-muted">
                {{ t('auction.quals') }}
                <span
                  v-if="onBlock?.zSum != null"
                  class="ms-2 tnum text-toned"
                >{{ t('seeding.zSum', { value: number(onBlock.zSum, 2) }) }}</span>
              </p>

              <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                <div
                  v-for="entry in quals"
                  :key="entry.map.id"
                  class="relative overflow-hidden rounded-lg border bg-elevated/30"
                  :class="bracketStyle(entry.map)?.border ?? 'border-default/50'"
                  :title="entry.map.title ?? undefined"
                >
                  <div
                    v-if="coverFor(entry.map)"
                    class="absolute inset-0 bg-cover bg-center opacity-25"
                    :style="{ backgroundImage: `url(${coverFor(entry.map)})` }"
                  />
                  <!-- The same veil the mappool cards use: darkest where the text starts, thinning
                       out to the right so the map itself still shows. -->
                  <div class="absolute inset-0 bg-gradient-to-r from-default/95 via-default/85 to-default/60" />

                  <div class="relative space-y-0.5 p-3">
                    <div class="flex items-center justify-between gap-2">
                      <span class="font-display text-sm text-secondary">{{ entry.map.label }}</span>
                      <UBadge
                        v-if="entry.score.mods"
                        color="primary"
                        variant="subtle"
                        size="xs"
                      >
                        {{ entry.score.mods }}
                      </UBadge>
                    </div>
                    <p class="font-display text-xl tnum leading-tight">
                      {{ cellText(entry.score) }}
                    </p>
                    <p
                      class="text-xs tnum"
                      :class="entry.score.rank === 1 ? 'text-secondary' : 'text-muted'"
                    >
                      #{{ entry.score.rank }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <template
            v-if="isAdmin"
            #footer
          >
            <UButton
              color="error"
              variant="ghost"
              icon="i-lucide-ban"
              :loading="cancelling"
              @click="cancel"
            >
              {{ t('auction.cancel') }}
            </UButton>
          </template>
        </UCard>

        <BidPanel :auction="auction" />
      </div>
    </template>

    <UCard
      v-else
      variant="subtle"
      class="text-center"
      :ui="{ body: 'py-14' }"
    >
      <div class="mx-auto max-w-md space-y-4">
        <div class="mx-auto grid size-16 place-items-center rounded-2xl bg-elevated/60">
          <UIcon
            name="i-lucide-gavel"
            class="size-8 text-muted"
          />
        </div>
        <h1 class="font-display text-2xl">
          {{ t('auction.idle.title') }}
        </h1>
        <p class="text-sm text-muted">
          {{ isAdmin ? t('auction.idle.hintAdmin') : t('auction.idle.hint') }}
        </p>
        <UButton
          v-if="isAdmin"
          to="/pool"
          variant="subtle"
          icon="i-lucide-user-round-search"
        >
          {{ t('auction.idle.toPool') }}
        </UButton>
      </div>
    </UCard>

    <UCard
      v-if="upNext.length"
      variant="subtle"
    >
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-display text-lg">
            {{ t('nav.pool') }}
          </h2>
          <span class="text-xs text-muted">{{ t('auction.remaining', { count: remaining }) }}</span>
        </div>
      </template>

      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div
          v-for="player in upNext"
          :key="player.osuId"
          class="flex items-center gap-3 rounded-lg bg-elevated/40 px-3 py-2"
        >
          <PlayerAvatar
            :osu-id="player.osuId"
            :username="player.username"
          />
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">
              {{ player.username }}
            </p>
            <p class="text-xs text-muted tnum">
              #{{ player.seed }} · {{ number(player.ppRaw) }} {{ t('common.pp') }}
            </p>
          </div>
        </div>
      </div>
    </UCard>

    <p
      v-if="state?.importProgress"
      class="text-center text-sm text-muted"
    >
      {{ t(state.importProgress.phase === 'discord' ? 'setup.sheet.matchingDiscord' : 'setup.sheet.importing', { ...state.importProgress }) }}
    </p>
  </div>
</template>
