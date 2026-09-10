<script setup lang="ts">
const { load, connect } = useDashboard()
const { lang, t } = useLang()

// Fetched on the server so the first paint already has the tournament on it; the event stream takes
// over the moment the page is alive, and every later render comes from there.
await callOnce('ba-state', load)

let disconnect: (() => void) | undefined

onMounted(() => {
  disconnect = connect()
})

onBeforeUnmount(() => disconnect?.())

useHead({
  htmlAttrs: { lang },
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  // SVG only: the mark is drawn from the theme's own colours, and browsers probe `/favicon.ico` on
  // their own - leaving the starter's Nuxt logo there would show it in tabs that fall back.
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    // Every page opens on a heading in the display serif, and the stylesheet only reveals the font
    // once it has parsed the `@font-face`. Weight 600 is the brand line alone, so it can wait.
    {
      rel: 'preload',
      as: 'font',
      type: 'font/woff2',
      href: '/fonts/source-serif-4-latin-400.woff2',
      crossorigin: ''
    }
  ]
})

useSeoMeta({
  title: () => t('app.title'),
  description: () => t('app.subtitle'),
  robots: 'noindex'
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
