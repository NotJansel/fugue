/**
 * Starts a sheet import and reports how it ended.
 *
 * Imports run on the server after their request has been answered - the osu! and Discord lookups take
 * longer than a proxy waits - so the answer only says it started. The result arrives later as
 * `importOutcome` in the pushed state, and is announced only in the tab that started the import.
 */
export function useBackgroundImport(path: string) {
  const { state, api } = useDashboard()
  const { tCode } = useLang()
  const toast = useToast()

  /** Set before the request goes out: a quick import can finish before its own response arrives. */
  const waiting = ref(false)

  const progress = computed(() => state.value?.importProgress ?? null)
  const busy = computed(() => waiting.value || progress.value != null)

  watch(() => state.value?.importOutcome?.finishedAt, (finishedAt) => {
    const outcome = state.value?.importOutcome
    if (!waiting.value || finishedAt == null || !outcome) return

    waiting.value = false

    toast.add({
      title: tCode(outcome.code, outcome.args, outcome.message),
      color: outcome.ok ? 'success' : 'error',
      icon: outcome.ok ? 'i-lucide-check' : 'i-lucide-triangle-alert'
    })
  })

  async function start(body: unknown) {
    waiting.value = true

    try {
      await api(path, body)
    } catch {
      // Already announced by `api`; nothing was started, so there is no outcome to wait for.
      waiting.value = false
    }
  }

  return { progress, busy, start }
}
