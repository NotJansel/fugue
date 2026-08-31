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

    const source = new EventSource('/api/events')

    source.onopen = () => {
      connection.value = 'live'
    }

    source.onmessage = (event: MessageEvent<string>) => {
      connection.value = 'live'
      state.value = JSON.parse(event.data) as DashboardState
    }

    source.onerror = () => {
      connection.value = source.readyState === EventSource.CLOSED ? 'offline' : 'connecting'
    }

    return () => source.close()
  }

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

  /** The captain this session controls, if any - what makes the bid panel appear. */
  const myCaptain = computed(() =>
    user.value ? players.value.find(player => player.isCaptain && player.discordId === user.value?.id) ?? null : null
  )

  const myTeam = computed(() =>
    myCaptain.value ? teams.value.find(team => team.captainOsuId === myCaptain.value?.osuId) ?? null : null
  )

  return {
    state,
    connection,
    load,
    connect,
    api,
    user,
    isAdmin,
    isGuest,
    players,
    teams,
    auction,
    myCaptain,
    myTeam
  }
}
