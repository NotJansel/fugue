<script setup lang="ts">
import type { TeamDto } from '#shared/types'

const props = defineProps<{ team: TeamDto, leading: boolean }>()

const { isAdmin, api } = useDashboard()
const { t } = useLang()
const { money } = useFormat()

const renaming = ref(false)
const draft = ref(props.team.name)

watch(() => props.team.name, (name) => {
  draft.value = name
})

async function rename() {
  renaming.value = false
  if (draft.value.trim() === props.team.name) return

  await api('/api/teams/name', { captainOsuId: props.team.captainOsuId, name: draft.value.trim() }, { quiet: true })
}

const remove = (osuId: string) =>
  api('/api/rosters/remove', { captainOsuId: props.team.captainOsuId, osuId }, { quiet: true })

/** How much of the purse is already gone, so a team's room to move reads at a glance. */
const spentFraction = computed(() => {
  const total = props.team.spent + (props.team.balance ?? 0)

  return total > 0 ? Math.round((props.team.spent / total) * 100) : 0
})
</script>

<template>
  <UCard
    variant="subtle"
    :class="leading ? 'gilded ring-1 ring-secondary/30' : ''"
  >
    <template #header>
      <div class="flex items-start gap-3">
        <PlayerAvatar
          :osu-id="team.captainOsuId"
          :username="team.captainName"
          size="md"
        />

        <div class="min-w-0 flex-1">
          <div
            v-if="renaming"
            class="flex gap-2"
          >
            <UInput
              v-model="draft"
              size="sm"
              autofocus
              class="flex-1"
              @keyup.enter="rename"
              @keyup.escape="renaming = false"
            />
            <UButton
              icon="i-lucide-check"
              size="sm"
              @click="rename"
            />
          </div>

          <template v-else>
            <h3 class="truncate font-display text-lg leading-tight">
              {{ team.name }}
              <UButton
                v-if="isAdmin"
                icon="i-lucide-pencil"
                size="xs"
                color="neutral"
                variant="ghost"
                :aria-label="t('teams.rename')"
                @click="renaming = true"
              />
            </h3>
            <p class="truncate text-xs text-muted">
              #{{ team.captainSeed }} · {{ team.captainName }}
            </p>
          </template>
        </div>

        <UBadge
          :color="team.slotsLeft === 0 ? 'neutral' : 'secondary'"
          variant="subtle"
          size="sm"
        >
          {{ team.slotsLeft === 0 ? t('teams.full') : t('teams.slotsLeft', { count: team.slotsLeft }) }}
        </UBadge>
      </div>
    </template>

    <div class="space-y-4">
      <div
        v-if="team.balance != null"
        class="space-y-1.5"
      >
        <div class="flex items-baseline justify-between text-sm">
          <span class="text-muted">{{ t('teams.purse') }}</span>
          <span class="font-display tnum text-secondary">{{ money(team.balance) }}</span>
        </div>
        <UProgress
          :model-value="spentFraction"
          color="primary"
          size="xs"
        />
        <div class="flex justify-between text-xs text-muted tnum">
          <span>{{ t('teams.spent') }} {{ money(team.spent) }}</span>
          <span v-if="team.held">{{ t('auction.bid.held') }} {{ money(team.held) }}</span>
        </div>
      </div>

      <p
        v-if="!team.discordId && isAdmin"
        class="text-xs text-warning"
      >
        {{ t('teams.noDiscord') }}
      </p>

      <ul
        v-if="team.members.length"
        class="space-y-1.5"
      >
        <li
          v-for="member in team.members"
          :key="member.osuId"
          class="group flex items-center gap-2.5 rounded-md bg-elevated/40 px-2.5 py-1.5"
        >
          <PlayerAvatar
            :osu-id="member.osuId"
            :username="member.username"
            size="xs"
          />
          <span class="min-w-0 flex-1 truncate text-sm">{{ member.username }}</span>
          <span class="text-xs text-muted tnum">#{{ member.seed }}</span>
          <span class="font-display text-sm tnum">{{ money(member.price) }}</span>
          <UButton
            v-if="isAdmin"
            icon="i-lucide-x"
            size="xs"
            color="error"
            variant="ghost"
            class="opacity-0 group-hover:opacity-100 transition-opacity"
            :aria-label="t('common.remove')"
            @click="remove(member.osuId)"
          />
        </li>
      </ul>

      <p
        v-else
        class="text-sm text-muted"
      >
        {{ t('teams.noMembers') }}
      </p>
    </div>
  </UCard>
</template>
