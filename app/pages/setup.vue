<script setup lang="ts">
const { state, players, isAdmin, api } = useDashboard()
const { t } = useLang()
const { money } = useFormat()

const teamSize = ref(4)
const minTeamSize = ref(0)
const wholeField = ref(true)
const fieldSize = ref(0)
const autoCaptains = ref(true)
const captainCount = ref(0)
const defaultStartingBid = ref(0)
const defaultMaxBid = ref(0)
const minBidIncrement = ref(1)
const maxBidIncrement = ref(0)

// The form follows the server until it is saved, so a second organiser's change is never overwritten
// by a stale field left open in this tab.
watchEffect(() => {
  const config = state.value?.config
  if (!config) return

  teamSize.value = config.teamSize
  minTeamSize.value = config.minTeamSize
  wholeField.value = config.fieldSize == null
  fieldSize.value = config.fieldSize ?? config.fieldTotal
  autoCaptains.value = config.captainCountOverride == null
  captainCount.value = config.captainCountOverride ?? config.captainCount
  defaultStartingBid.value = config.defaultStartingBid
  defaultMaxBid.value = config.defaultMaxBid
  minBidIncrement.value = config.minBidIncrement
  maxBidIncrement.value = config.maxBidIncrement
})

const explainer = computed(() => t('setup.format.explainer', {
  players: players.value.length,
  size: teamSize.value,
  count: state.value?.config.captainCount ?? 0,
  pool: players.value.filter(player => !player.isCaptain).length
}))

const saveFormat = () => api('/api/config', {
  teamSize: teamSize.value,
  minTeamSize: minTeamSize.value,
  fieldSize: wholeField.value ? null : fieldSize.value,
  wholeField: wholeField.value,
  captainCount: autoCaptains.value ? null : captainCount.value,
  autoCaptainCount: autoCaptains.value,
  defaultStartingBid: defaultStartingBid.value,
  defaultMaxBid: defaultMaxBid.value,
  minBidIncrement: minBidIncrement.value,
  maxBidIncrement: maxBidIncrement.value
})

const bulkPurse = ref(0)
const singleDiscordId = ref('')
const singleAmount = ref(0)

const applyBulk = () => api('/api/purses/bulk', { amount: bulkPurse.value })
const applySingle = () => api('/api/purses/set', { discordId: singleDiscordId.value, amount: singleAmount.value })

/** Everyone with a Discord account attached, verified or typed in - the list an organiser fixes. */
const linked = computed(() => players.value.filter(player => player.discordId))

const unlink = (osuId: string) => api('/api/links/unlink', { osuId })
const setDiscordId = (osuId: string, discordId: string) =>
  api('/api/players/discord', { osuId, discordId: discordId || null })
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="font-display text-2xl">
        {{ t('setup.title') }}
      </h1>
    </div>

    <UAlert
      v-if="!isAdmin"
      icon="i-lucide-lock"
      color="neutral"
      variant="subtle"
      :description="t('common.adminOnly')"
    />

    <template v-else>
      <div class="grid gap-6 xl:grid-cols-2">
        <QualifierImport />
        <MappoolImport />

        <UCard variant="subtle">
          <template #header>
            <h2 class="font-display text-lg">
              {{ t('setup.format.title') }}
            </h2>
          </template>

          <div class="space-y-4">
            <UFormField :label="t('setup.format.field')">
              <div class="flex flex-wrap items-center gap-3">
                <UCheckbox
                  v-model="wholeField"
                  :label="t('setup.format.wholeField')"
                />
                <UInputNumber
                  v-model="fieldSize"
                  :min="0"
                  :disabled="wholeField"
                  class="w-32"
                />
                <span class="text-xs text-muted">{{ t('setup.format.fieldOf', { total: state?.config.fieldTotal ?? 0 }) }}</span>
              </div>
              <p class="mt-2 text-xs text-muted">
                {{ t('setup.format.fieldHint') }}
              </p>
            </UFormField>

            <div class="flex flex-wrap gap-4">
              <UFormField
                :label="t('setup.format.teamSize')"
                :help="t('setup.format.teamSizeHint')"
              >
                <UInputNumber
                  v-model="teamSize"
                  :min="1"
                  class="w-32"
                />
              </UFormField>

              <UFormField
                :label="t('setup.format.minTeamSize')"
                :help="t('setup.format.minTeamSizeHint')"
              >
                <UInputNumber
                  v-model="minTeamSize"
                  :min="0"
                  class="w-32"
                />
              </UFormField>
            </div>

            <UFormField :label="t('setup.format.captains')">
              <div class="flex flex-wrap items-center gap-3">
                <UCheckbox
                  v-model="autoCaptains"
                  :label="t('setup.format.auto')"
                />
                <UInputNumber
                  v-model="captainCount"
                  :min="0"
                  :disabled="autoCaptains"
                  class="w-32"
                />
              </div>
              <p class="mt-2 text-xs text-muted">
                {{ explainer }}
              </p>
            </UFormField>

            <UFormField :label="t('setup.format.bids')">
              <div class="flex flex-wrap gap-3">
                <UInputNumber
                  v-model="defaultStartingBid"
                  :min="0"
                  :placeholder="t('setup.format.starting')"
                  class="w-36"
                />
                <UInputNumber
                  v-model="defaultMaxBid"
                  :min="0"
                  :placeholder="t('setup.format.max')"
                  class="w-36"
                />
              </div>
            </UFormField>

            <UFormField
              :label="t('setup.format.steps')"
              :help="t('setup.format.maxStepHint')"
            >
              <div class="flex flex-wrap gap-3">
                <UInputNumber
                  v-model="minBidIncrement"
                  :min="1"
                  :placeholder="t('setup.format.minStep')"
                  class="w-36"
                />
                <UInputNumber
                  v-model="maxBidIncrement"
                  :min="0"
                  :placeholder="t('setup.format.maxStep')"
                  class="w-36"
                />
              </div>
            </UFormField>

            <UButton
              icon="i-lucide-save"
              @click="saveFormat"
            >
              {{ t('common.save') }}
            </UButton>
          </div>
        </UCard>

        <UCard variant="subtle">
          <template #header>
            <div>
              <h2 class="font-display text-lg">
                {{ t('setup.purses.title') }}
              </h2>
              <p class="mt-1 text-xs text-muted">
                {{ t('setup.purses.hint') }}
              </p>
            </div>
          </template>

          <div class="space-y-5">
            <div class="flex flex-wrap items-end gap-3">
              <UFormField
                :label="t('setup.purses.amount')"
                class="flex-1 min-w-40"
              >
                <UInputNumber
                  v-model="bulkPurse"
                  :min="0"
                  class="w-full"
                />
              </UFormField>
              <UButton
                icon="i-lucide-wallet"
                @click="applyBulk"
              >
                {{ t('setup.purses.apply') }}
              </UButton>
            </div>

            <USeparator />

            <div class="space-y-3">
              <h3 class="text-sm font-medium">
                {{ t('setup.purses.manual') }}
              </h3>
              <div class="flex flex-wrap items-end gap-3">
                <UFormField
                  :label="t('setup.purses.discordId')"
                  class="flex-1 min-w-48"
                  size="sm"
                >
                  <UInput
                    v-model="singleDiscordId"
                    placeholder="123456789012345678"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  :label="t('setup.purses.amount')"
                  size="sm"
                >
                  <UInputNumber
                    v-model="singleAmount"
                    :min="0"
                    class="w-32"
                  />
                </UFormField>
                <UButton
                  color="neutral"
                  variant="subtle"
                  @click="applySingle"
                >
                  {{ t('setup.purses.set') }}
                </UButton>
              </div>
            </div>
          </div>
        </UCard>
      </div>

      <UCard variant="subtle">
        <template #header>
          <div>
            <h2 class="font-display text-lg">
              {{ t('setup.links.title') }}
            </h2>
            <p class="mt-1 text-xs text-muted">
              {{ t('setup.links.hint') }}
            </p>
          </div>
        </template>

        <p
          v-if="!linked.length"
          class="text-sm text-muted"
        >
          {{ t('setup.links.none') }}
        </p>

        <ul
          v-else
          class="space-y-2"
        >
          <li
            v-for="player in linked"
            :key="player.osuId"
            class="flex flex-wrap items-center gap-3 rounded-lg bg-elevated/40 px-3 py-2"
          >
            <PlayerAvatar
              :osu-id="player.osuId"
              :username="player.username"
            />

            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">
                {{ player.username }}
              </p>
              <p class="text-xs text-muted tnum">
                {{ player.discordId }}
              </p>
            </div>

            <UBadge
              :color="player.discordVerified ? 'secondary' : 'neutral'"
              variant="subtle"
              size="sm"
              :icon="player.discordVerified ? 'i-lucide-badge-check' : 'i-lucide-pencil'"
            >
              {{ player.discordVerified ? t('setup.links.verified') : t('setup.links.manual') }}
            </UBadge>

            <UBadge
              v-if="player.balance != null"
              color="neutral"
              variant="subtle"
              size="sm"
            >
              {{ money(player.balance) }}
            </UBadge>

            <UButton
              v-if="player.discordVerified"
              size="xs"
              color="error"
              variant="ghost"
              icon="i-lucide-unlink"
              @click="unlink(player.osuId)"
            >
              {{ t('setup.links.unlink') }}
            </UButton>
            <UButton
              v-else
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              @click="setDiscordId(player.osuId, '')"
            >
              {{ t('common.remove') }}
            </UButton>
          </li>
        </ul>
      </UCard>
    </template>
  </div>
</template>
