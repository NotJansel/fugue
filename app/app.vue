<script setup lang="ts">
const { load, connect } = useDashboard()
const { lang } = useLang()
const { tournamentName } = useRuntimeConfig().public

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
  // The tournament's own mark at tab size. Browsers probe `/favicon.ico` on their own - leaving the
  // starter's Nuxt logo there would show it in tabs that fall back.
  link: [
    { rel: 'icon', type: 'image/png', href: '/favicon.png' },
    { rel: 'apple-touch-icon', href: '/favicon.png' },
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
  title: tournamentName,
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
