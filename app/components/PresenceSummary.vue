<script setup lang="ts">
/**
 * How many teams could bid right now - captain or stand-in with the dashboard open - and, on hover,
 * which ones could not. For organisers, before they put the next player up.
 */
const { teams } = useDashboard()
const { t } = useLang()

/** A team is there when either of the two who can bid for it is. */
const isPresent = (team: (typeof teams.value)[number]) =>
  team.presence?.captain?.online === true || team.presence?.proxy?.online === true

const present = computed(() => teams.value.filter(isPresent))
const missing = computed(() => teams.value.filter(team => !isPresent(team)))
</script>

<template>
  <UPopover
    v-if="teams.length"
    mode="hover"
  >
    <UBadge
      :color="missing.length ? 'warning' : 'success'"
      variant="subtle"
      icon="i-lucide-radio"
      class="cursor-default"
    >
      {{ t('presence.summary', { online: present.length, total: teams.length }) }}
    </UBadge>

    <template #content>
      <div class="w-64 space-y-2 p-3 text-sm">
        <p
          v-if="!missing.length"
          class="text-muted"
        >
          {{ t('presence.allOnline') }}
        </p>

        <template v-else>
          <p class="text-xs uppercase tracking-wider text-muted">
            {{ t('presence.offlineTeams') }}
          </p>
          <ul class="space-y-1">
            <li
              v-for="team in missing"
              :key="team.captainOsuId"
              class="flex items-center gap-2"
            >
              <PresenceDot
                v-if="team.presence?.captain"
                :presence="team.presence.captain"
              />
              <span class="min-w-0 flex-1 truncate">{{ team.name }}</span>
              <span
                v-if="!team.presence?.captain"
                class="text-xs text-warning"
              >{{ t('presence.noDiscord') }}</span>
            </li>
          </ul>
        </template>
      </div>
    </template>
  </UPopover>
</template>
