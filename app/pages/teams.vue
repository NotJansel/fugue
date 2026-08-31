<script setup lang="ts">
const { state, teams, isAdmin, api } = useDashboard()
const { t } = useLang()

const sold = computed(() => teams.value.reduce((total, team) => total + team.members.length, 0))

const confirming = ref(false)

async function clearRosters() {
  confirming.value = false
  await api('/api/rosters/clear')
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="font-display text-2xl">
          {{ t('teams.title') }}
        </h1>
        <p class="text-sm text-muted">
          {{ t('teams.summary', { teams: teams.length, size: state?.config.teamSize ?? 0, sold }) }}
        </p>
      </div>

      <UButton
        v-if="isAdmin && sold > 0"
        color="error"
        variant="ghost"
        icon="i-lucide-eraser"
        @click="confirming = true"
      >
        {{ t('teams.clear') }}
      </UButton>
    </div>

    <p
      v-if="!teams.length"
      class="rounded-xl border border-dashed border-default/60 py-14 text-center text-sm text-muted"
    >
      {{ t('teams.empty') }}
    </p>

    <div
      v-else
      class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
    >
      <TeamCard
        v-for="team in teams"
        :key="team.captainOsuId"
        :team="team"
        :leading="state?.auctionLeader === team.name"
      />
    </div>

    <UModal
      v-model:open="confirming"
      :title="t('teams.clear')"
      :description="t('teams.clearConfirm')"
    >
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="confirming = false"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="error"
            @click="clearRosters"
          >
            {{ t('teams.clear') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
