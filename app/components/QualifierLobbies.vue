<script setup lang="ts">
/**
 * The qualifier lobbies osu! has been asked about, and how much of each has been read into results.
 *
 * Most turn up on their own - the server scans the match history for them every minute - so
 * this is mainly a place to see that they did, and to add one by link when they did not.
 */
const { state, isAdmin, api } = useDashboard()
const { t } = useLang()
const { dateTime } = useFormat()

const lobbies = computed(() => state.value?.lobbies ?? [])

const link = ref('')
const adding = ref(false)

async function add() {
  adding.value = true

  try {
    await api('/api/lobbies/add', { url: link.value })
    link.value = ''
  } finally {
    adding.value = false
  }
}

const rereading = ref(false)

/** Reads every lobby again from the top - for scores that were read before they were read right. */
async function reread() {
  rereading.value = true

  try {
    await api('/api/lobbies/refresh')
  } finally {
    rereading.value = false
  }
}

/** The lobby whose removal is being confirmed, if any. */
const removing = ref<number | null>(null)

async function remove() {
  const matchId = removing.value
  removing.value = null
  if (matchId == null) return

  await api('/api/lobbies/remove', { matchId })
}

const matchLink = (matchId: number) => `https://osu.ppy.sh/community/matches/${matchId}`
</script>

<template>
  <UCard
    v-if="isAdmin || lobbies.length"
    variant="subtle"
  >
    <template #header>
      <div>
        <h2 class="font-display text-lg">
          {{ t('lobbies.title') }}
        </h2>
        <p
          v-if="isAdmin"
          class="mt-1 text-xs text-muted"
        >
          {{ t('lobbies.hint') }}
        </p>
      </div>
    </template>

    <div class="space-y-4">
      <div
        v-if="isAdmin"
        class="flex flex-wrap items-end gap-3"
      >
        <UFormField
          :label="t('lobbies.link')"
          class="flex-1 min-w-64"
          size="sm"
        >
          <UInput
            v-model="link"
            placeholder="https://osu.ppy.sh/community/matches/…"
            class="w-full"
            @keyup.enter="add"
          />
        </UFormField>
        <UButton
          icon="i-lucide-plus"
          :loading="adding"
          :disabled="!link"
          @click="add"
        >
          {{ t('lobbies.add') }}
        </UButton>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="subtle"
          :title="t('lobbies.rereadHint')"
          :loading="rereading"
          :disabled="!lobbies.length"
          @click="reread"
        >
          {{ rereading ? t('lobbies.rereading') : t('lobbies.reread') }}
        </UButton>
      </div>

      <p
        v-if="!lobbies.length"
        class="text-sm text-muted"
      >
        {{ t('lobbies.empty') }}
      </p>

      <ul
        v-else
        class="space-y-2"
      >
        <li
          v-for="lobby in lobbies"
          :key="lobby.matchId"
          class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-elevated/40 px-3 py-2"
        >
          <a
            :href="matchLink(lobby.matchId)"
            target="_blank"
            rel="noopener"
            class="min-w-0 flex-1 truncate text-sm font-medium hover:text-secondary transition-colors"
          >
            {{ lobby.name }}
          </a>

          <span class="text-xs text-muted tnum">{{ dateTime(lobby.startedAt) }}</span>

          <span class="text-xs text-muted tnum">
            {{ lobby.games > 0 ? t('lobbies.read', { games: lobby.games, players: lobby.players }) : t('lobbies.unread') }}
          </span>

          <UBadge
            v-if="lobby.endedAt == null"
            color="primary"
            variant="subtle"
            size="sm"
            class="gap-1.5"
          >
            <span class="size-1.5 rounded-full bg-current pulse-gold" />
            {{ t('lobbies.open') }}
          </UBadge>
          <UBadge
            v-else
            color="neutral"
            variant="subtle"
            size="sm"
          >
            {{ t('lobbies.closed') }}
          </UBadge>

          <UButton
            v-if="isAdmin"
            icon="i-lucide-trash-2"
            size="xs"
            color="error"
            variant="ghost"
            :aria-label="t('lobbies.remove')"
            @click="removing = lobby.matchId"
          />
        </li>
      </ul>
    </div>

    <UModal
      :open="removing != null"
      :title="t('lobbies.remove')"
      :description="t('lobbies.removeConfirm')"
      @update:open="removing = $event ? removing : null"
    >
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="removing = null"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="error"
            @click="remove"
          >
            {{ t('lobbies.remove') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </UCard>
</template>
