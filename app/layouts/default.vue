<script setup lang="ts">
const { state, isGuest } = useDashboard()
const { t, tCode } = useLang()

const links = computed(() => [
  { label: t('nav.auction'), icon: 'i-lucide-gavel', to: '/' },
  { label: t('nav.seeding'), icon: 'i-lucide-list-ordered', to: '/seeding' },
  { label: t('nav.teams'), icon: 'i-lucide-users', to: '/teams' },
  { label: t('nav.pool'), icon: 'i-lucide-user-round-search', to: '/pool' },
  { label: t('nav.mappool'), icon: 'i-lucide-disc-3', to: '/mappool' },
  // Only once there is a schedule to show - for most of a tournament's setup there is none.
  ...(state.value?.schedule?.sections.length
    ? [{ label: t('nav.schedule'), icon: 'i-lucide-calendar-clock', to: '/schedule' }]
    : []),
  { label: t('nav.setup'), icon: 'i-lucide-settings', to: '/setup' }
])

// Up to seven destinations, a brand, a status pill, a language picker and an account all have to share one
// line. The icons earn their place in the drawer, where there is room; across the top the labels are
// enough, and dropping them keeps the bar from overflowing on a laptop screen.
const barLinks = computed(() => links.value.map(({ icon: _icon, ...link }) => link))

/** A live auction is the one thing worth pulling someone away from whatever tab they are on. */
const auctionLive = computed(() => state.value?.auction != null)

const warnings = computed(() => state.value?.warnings ?? [])
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <UHeader
      mode="drawer"
      :ui="{ root: 'border-b border-default/60 bg-default/70 backdrop-blur' }"
    >
      <template #left>
        <NuxtLink
          to="/"
          class="flex items-center gap-2.5 rounded-lg p-1 -ms-1 outline-primary/40 focus-visible:outline-2"
        >
          <AppLogo class="size-8 shrink-0" />
          <span class="hidden lg:block font-display text-base font-semibold leading-tight">{{ t('app.title') }}</span>
        </NuxtLink>
      </template>

      <UNavigationMenu
        :items="barLinks"
        highlight
        highlight-color="secondary"
        color="neutral"
        variant="link"
      >
        <template #item-trailing="{ item }">
          <span
            v-if="item.to === '/' && auctionLive"
            class="size-1.5 rounded-full bg-secondary pulse-gold"
          />
        </template>
      </UNavigationMenu>

      <template #right>
        <ConnectionPill class="hidden xl:flex" />
        <LangSwitch class="hidden md:block" />
        <UserMenu />
      </template>

      <template #body>
        <UNavigationMenu
          :items="links"
          orientation="vertical"
          highlight
          highlight-color="secondary"
        />
        <div class="mt-6 flex items-center justify-between">
          <ConnectionPill />
          <LangSwitch />
        </div>
      </template>
    </UHeader>

    <UMain class="flex-1">
      <UContainer class="py-6 sm:py-8 space-y-6">
        <UAlert
          v-if="isGuest"
          icon="i-lucide-eye"
          color="neutral"
          variant="subtle"
          :description="t('role.guestHint')"
          :ui="{ description: 'text-xs' }"
        />

        <div
          v-if="warnings.length"
          class="space-y-2"
        >
          <UAlert
            v-for="warning in warnings"
            :key="warning.code"
            icon="i-lucide-triangle-alert"
            color="warning"
            variant="subtle"
            :description="tCode(warning.code, warning.args, warning.text)"
            :ui="{ description: 'text-sm' }"
          />
        </div>

        <slot />
      </UContainer>
    </UMain>

    <footer class="border-t border-default/60 mt-8">
      <UContainer class="py-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span>{{ t('app.title') }} · {{ new Date().getFullYear() }}</span>
        <ConnectionPill class="md:hidden" />
      </UContainer>
    </footer>
  </div>
</template>
