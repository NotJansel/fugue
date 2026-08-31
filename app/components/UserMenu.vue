<script setup lang="ts">
/**
 * Who you are, and what that lets you do.
 *
 * The role badge is the fastest answer to "why can't I press this": guest, member, captain or
 * organiser, in that order of privilege.
 */
const { user, isAdmin, myCaptain, state } = useDashboard()
const { t } = useLang()

const role = computed(() => {
  if (!user.value) return { label: t('role.guest'), colour: 'neutral' as const }
  if (isAdmin.value) return { label: t('role.organiser'), colour: 'primary' as const }
  if (myCaptain.value) return { label: t('role.captain'), colour: 'secondary' as const }

  return { label: t('role.viewer'), colour: 'neutral' as const }
})

const avatar = computed(() => {
  if (user.value?.osuId) return `https://a.ppy.sh/${user.value.osuId}`
  if (user.value?.avatar) return `https://cdn.discordapp.com/avatars/${user.value.id}/${user.value.avatar}.png?size=64`

  return undefined
})

const needsLink = computed(() =>
  user.value != null && user.value.osuId == null && state.value?.config.osuConfigured === true
)
</script>

<template>
  <div class="flex items-center gap-2">
    <UButton
      v-if="!user"
      to="/login"
      external
      icon="i-simple-icons-discord"
      color="primary"
      size="sm"
    >
      {{ t('nav.signIn') }}
    </UButton>

    <template v-else>
      <UButton
        v-if="needsLink"
        to="/link/osu"
        external
        size="sm"
        color="secondary"
        variant="subtle"
        icon="i-lucide-link"
      >
        {{ t('nav.linkOsu') }}
      </UButton>

      <UPopover mode="hover">
        <button
          type="button"
          class="flex items-center gap-2 rounded-full py-1 ps-1 pe-3 hover:bg-elevated/60 transition-colors"
        >
          <UAvatar
            :src="avatar"
            :alt="user.username"
            size="xs"
          />
          <span class="text-sm font-medium hidden sm:inline">{{ user.osuUsername ?? user.username }}</span>
        </button>

        <template #content>
          <div class="p-3 w-56 space-y-3">
            <div class="flex items-center gap-2">
              <UAvatar
                :src="avatar"
                :alt="user.username"
                size="sm"
              />
              <div class="min-w-0">
                <p class="text-sm font-medium truncate">
                  {{ user.osuUsername ?? user.username }}
                </p>
                <p class="text-xs text-muted truncate">
                  {{ user.username }}
                </p>
              </div>
            </div>

            <UBadge
              :color="role.colour"
              variant="subtle"
              size="sm"
            >
              {{ role.label }}
            </UBadge>

            <UButton
              to="/logout"
              external
              block
              size="sm"
              color="neutral"
              variant="subtle"
              icon="i-lucide-log-out"
            >
              {{ t('nav.signOut') }}
            </UButton>
          </div>
        </template>
      </UPopover>
    </template>
  </div>
</template>
