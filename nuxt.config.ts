// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  /**
   * The dashboard is a dark room by design - oxblood, umber and gold. A light variant of that is a
   * different design rather than a toggle, so the palette is fixed instead of following the system.
   */
  colorMode: {
    preference: 'dark',
    fallback: 'dark'
  },

  /**
   * The tournament this deployment runs. Built for Trinitas Proelium, and those are the defaults;
   * another tournament sets `NUXT_PUBLIC_TOURNAMENT_NAME` and `NUXT_PUBLIC_TOURNAMENT_ACRONYM` at
   * runtime - Nuxt reads the `NUXT_PUBLIC_` names itself, so a published image needs no rebuild.
   * The acronym is what qualifier lobbies are named after: `<ACRONYM>: (Qualifiers) vs (Lobby …)`.
   */
  runtimeConfig: {
    public: {
      tournamentName: 'Trinitas Proelium',
      tournamentAcronym: 'TP'
    }
  },

  // Nothing here is prerenderable: every page is a live view of the tournament, rendered per request
  // so a signed-in organiser and a guest never share a cached payload.

  // Same variable the Kotlin deployment used. In production Nitro reads PORT, which `WEB_PORT` also
  // seeds through `server/utils/config.ts` for anything that needs to know the public port.
  devServer: {
    port: Number(process.env.WEB_PORT ?? 3000)
  },

  compatibilityDate: '2026-06-30',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
