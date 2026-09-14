<script setup lang="ts">
import type { NuxtError } from '#app'

/**
 * The 404 and the crash screen.
 *
 * Without this file Nuxt serves its own built-in error pages - Nuxt-branded, light, and carrying two
 * font stacks that are neither of the dashboard's. This is the same dim hall as the rest of the app,
 * and it deliberately reads nothing from the dashboard state: a failure to load that state is one of
 * the ways people get here.
 */
const props = defineProps<{ error: NuxtError }>()

const { lang, t } = useLang()

const missing = computed(() => props.error.statusCode === 404)
const key = computed(() => missing.value ? 'notFound' : 'server')

useHead({
  htmlAttrs: { lang },
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  link: [
    { rel: 'icon', type: 'image/png', href: '/favicon.png' },
    {
      rel: 'preload',
      as: 'font',
      type: 'font/woff2',
      href: '/fonts/source-serif-4-latin-400.woff2',
      crossorigin: ''
    }
  ],
  title: () => `${props.error.statusCode} · ${t('app.title')}`
})
</script>

<template>
  <UApp>
    <div class="min-h-screen grid place-items-center p-6">
      <div class="w-full max-w-lg space-y-6 text-center">
        <AppLogo class="size-12 mx-auto" />

        <div class="space-y-2">
          <p class="font-display text-5xl text-secondary tnum">
            {{ error.statusCode }}
          </p>
          <h1 class="font-display text-2xl">
            {{ t(`errorPage.${key}.title`) }}
          </h1>
          <p class="text-sm text-muted">
            {{ t(`errorPage.${key}.body`) }}
          </p>
        </div>

        <!--
          The message on a 500 is whatever Nitro handed over - English, untranslated, and sometimes a
          stack-adjacent string. It is worth showing to the organiser who has to report it, but it
          stays quiet enough not to be the first thing read.
        -->
        <p
          v-if="!missing && error.message"
          class="text-xs text-dimmed break-words"
        >
          {{ error.message }}
        </p>

        <div class="flex items-center justify-center gap-2">
          <UButton
            icon="i-lucide-gavel"
            color="primary"
            :label="t('errorPage.home')"
            @click="clearError({ redirect: '/' })"
          />
          <UButton
            v-if="!missing"
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="subtle"
            :label="t('errorPage.retry')"
            @click="clearError({ redirect: $route.fullPath })"
          />
        </div>
      </div>
    </div>
  </UApp>
</template>
