import type { DashboardState } from '#shared/types'

export type Connection = 'connecting' | 'live' | 'offline'

interface ApiEnvelope {
  ok?: boolean
  message?: string
  code?: string
  args?: Record<string, string>
  error?: string
}

/** Pulls the `{ error, code, args }` payload out of whatever `$fetch` threw. */
function errorPayload(error: unknown): ApiEnvelope {
  const data = (error as { data?: { data?: ApiEnvelope } & ApiEnvelope })?.data

  return data?.data ?? data ?? {}
}

/** Remembers, for this tab, which server build it last reloaded for - so a reload can never loop. */
const RELOADED_FOR_KEY = 'ba-reloaded-for'

function reloadedFor(): string | null {
  try {
    return sessionStorage.getItem(RELOADED_FOR_KEY)
  } catch {
    return null
  }
}

/**
 * Reloads the page onto the server's build, once per build. Should the reload somehow come back on
 * the old code, it is not tried again - the banner stays up and the button is left to a person.
 */
function reloadOnto(buildId: string): void {
  if (reloadedFor() === buildId) return

  try {
    sessionStorage.setItem(RELOADED_FOR_KEY, buildId)
  } catch {
    // Without storage there is no loop guard, but a reload that works is still worth doing.
  }

  window.location.reload()
}

/**
 * The dashboard's single source of truth on the client.
 *
 * The page holds no state of its own: the server pushes a full `DashboardState` over SSE on every
 * change and everything re-renders from it. That is why an admin's edit shows up on every open tab at
 * once, and why no view has to guess what a write did to the rest of the tournament.
 */
export function useDashboard() {
  const state = useState<DashboardState | null>('ba-state', () => null)
  const connection = useState<Connection>('ba-connection', () => 'connecting')
  /** The server runs a different build than this page was built from - a deploy has happened. */
  const outdated = useState<boolean>('ba-outdated', () => false)
  const { t, tCode } = useLang()

  /** The first read, used for server-side rendering; SSE takes over the moment the page is alive. */
  const load = async () => {
    state.value = await useRequestFetch()<DashboardState>('/api/state')
  }

  /**
   * Opens the event stream.
   *
   * `EventSource` reconnects on its own, so the only job here is to say so in the header while it is
   * between attempts - an organiser needs to know whether what they are looking at is still live.
   */
  const connect = () => {
    if (!import.meta.client) return () => {}

    // A restart drops the stream and `EventSource` reconnects on its own, so the first state from a
    // redeployed server is also the first sign of it. The page's own code is still the old build's.
    const ownBuild = useRuntimeConfig().app.buildId
    const serverBuild = computed(() => state.value?.buildId)

    // While anything on screen holds unsaved work (`useUnsavedWork`), a new build only puts up the
    // banner, and the reload waits until the work is saved or gone.
    const stopWatching = watch([serverBuild, hasUnsavedWork], ([build, unsaved]) => {
      outdated.value = build != null && build !== ownBuild
      if (outdated.value && !unsaved) reloadOnto(build!)
    })

    const source = new EventSource('/api/events')

    source.onopen = () => {
      connection.value = 'live'
    }

    // Only the stream sets the clock: the server-rendered state was built a page load ago.
    const clock = useServerClock()

    source.onmessage = (event: MessageEvent<string>) => {
      connection.value = 'live'
      const next = JSON.parse(event.data) as DashboardState
      clock.sync(next.serverTime)
      state.value = next
    }

    source.onerror = () => {
      connection.value = source.readyState === EventSource.CLOSED ? 'offline' : 'connecting'
    }

    return () => {
      stopWatching()
      source.close()
    }
  }

  /** Reloads now, whatever is unsaved - the banner's button, for whoever would rather not wait. */
  const reloadNow = () => window.location.reload()

  const toast = useToast()

  /**
   * A write.
   *
   * Nothing is applied locally: the store fires a change, the change comes back over SSE, and the
   * page re-renders from it. Success and failure are both announced with the server's own dictionary
   * code, so the message reads in the user's language without the server knowing which that is.
   */
  async function api<T = ApiEnvelope>(path: string, body?: unknown, options: { quiet?: boolean } = {}) {
    try {
      const response = await $fetch<T>(path, { method: 'POST', body: body ?? {} })
      const envelope = response as ApiEnvelope

      if (!options.quiet) {
        toast.add({
          title: tCode(envelope?.code, envelope?.args ?? {}, envelope?.message ?? t('ok.saved')),
          color: 'success',
          icon: 'i-lucide-check'
        })
      }

      return response
    } catch (error) {
      const payload = errorPayload(error)

      toast.add({
        title: tCode(payload.code, payload.args ?? {}, payload.error ?? String(error)),
        color: 'error',
        icon: 'i-lucide-triangle-alert'
      })

      throw error
    }
  }

  const user = computed(() => state.value?.user ?? null)
  const isAdmin = computed(() => user.value?.admin === true)
  const isGuest = computed(() => user.value == null)
  const players = computed(() => state.value?.players ?? [])
  const teams = computed(() => state.value?.teams ?? [])
  const auction = computed(() => state.value?.auction ?? null)

  /**
   * The team this session bids for, if any - what makes the bid panel appear. Its own as a captain
   * first, the way the server decides, and failing that the one it stands in for.
   */
  const myTeam = computed(() => {
    const id = user.value?.id
    if (!id) return null

    return teams.value.find(team => team.discordId === id)
      ?? teams.value.find(team => team.proxyDiscordId === id)
      ?? null
  })

  /** Whether this session bids for `myTeam` as its stand-in rather than as its captain. */
  const standingIn = computed(() => myTeam.value != null && myTeam.value.discordId !== user.value?.id)

  /** The captain whose purse this session bids from - its own, or the one it stands in for. */
  const myCaptain = computed(() =>
    myTeam.value ? players.value.find(player => player.osuId === myTeam.value?.captainOsuId) ?? null : null
  )

  return {
    state,
    connection,
    load,
    connect,
    outdated,
    reloadNow,
    api,
    user,
    isAdmin,
    isGuest,
    players,
    teams,
    auction,
    myCaptain,
    myTeam,
    standingIn
  }
}
