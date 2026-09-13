<script setup lang="ts">
import type { ScheduleRow, ScheduleSection } from '#shared/types'

/**
 * The tournament's schedules, as the organisers keep them in their sheet.
 *
 * The server re-reads the sheet every five minutes and pushes the result, so this page follows edits
 * without a reload. Start times are shown in the viewer's own time zone whenever the sheet says which
 * zone it writes in; whether a row is next, running or over is only worked out in the browser, against
 * its own clock.
 */
const { state, user, isAdmin } = useDashboard()
const { t } = useLang()
const { dateTime, locale } = useFormat()

/** How long a lobby or match counts as running after it starts. */
const RUNNING_MS = 90 * 60_000

const schedule = computed(() => state.value?.schedule ?? null)
const sections = computed(() => schedule.value?.sections ?? [])

// Null until mounted, so the server render and the first client render agree - the server has neither
// the viewer's clock nor their time zone.
const now = ref<number | null>(null)
let clock: ReturnType<typeof setInterval> | undefined

const active = ref('0')
const hidePast = ref(false)

onMounted(() => {
  now.value = Date.now()
  clock = setInterval(() => {
    now.value = Date.now()
  }, 30_000)

  // Open on the first schedule that still has something ahead in it.
  const upcoming = sections.value.findIndex(section =>
    section.rows.some(row => row.startsAt != null && row.startsAt + RUNNING_MS > Date.now()))
  if (upcoming > 0) active.value = String(upcoming)
})

onBeforeUnmount(() => clearInterval(clock))

const tabs = computed(() => sections.value.map((section, index) => ({
  label: section.title || t('schedule.title'),
  value: String(index)
})))

const section = computed<ScheduleSection | null>(() =>
  sections.value[Number(active.value)] ?? sections.value[0] ?? null)

const me = computed(() => user.value?.osuUsername?.toLowerCase() ?? null)

const startFormat = computed(() => new Intl.DateTimeFormat(locale.value, {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
}))

type Status = 'past' | 'live' | 'next' | 'upcoming' | null

const entries = computed(() => {
  const current = section.value
  if (!current) return []

  const role = (name: string) => current.columns.findIndex(column => column.role === name)
  const id = role('id')
  const date = role('date')
  const time = role('time')

  const clockNow = now.value
  const next = clockNow == null
    ? null
    : current.rows
      .map(row => row.startsAt)
      .filter((start): start is number => start != null && start > clockNow)
      .sort((a, b) => a - b)[0] ?? null

  return current.rows.flatMap((row: ScheduleRow, index) => {
    let status: Status = null

    if (clockNow != null && row.startsAt != null) {
      status = row.startsAt + RUNNING_MS <= clockNow
        ? 'past'
        : row.startsAt <= clockNow ? 'live' : row.startsAt === next ? 'next' : 'upcoming'
    }

    if (hidePast.value && status === 'past') return []

    const sheetWhen = [row.cells[date]?.[0], row.cells[time]?.[0]].filter(Boolean).join(' · ')

    return [{
      key: index,
      row,
      status,
      matchId: row.cells[id]?.[0] ?? null,
      when: row.startsAt != null && clockNow != null ? startFormat.value.format(row.startsAt) : sheetWhen,
      mine: me.value != null && row.cells.some(cell => cell.some(value => value.toLowerCase() === me.value)),
      details: current.columns.flatMap((column, at) =>
        column.role === 'text' && row.cells[at]?.[0] ? [{ label: column.label, value: row.cells[at]![0]! }] : []),
      lists: current.columns.flatMap((column, at) =>
        column.role === 'list' ? [{ label: column.label, names: row.cells[at] ?? [] }] : [])
    }]
  })
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="font-display text-2xl">
          {{ t('schedule.title') }}
        </h1>
        <p
          v-if="schedule?.fetchedAt"
          class="text-sm text-muted"
        >
          {{ t('schedule.updated', { when: dateTime(schedule.fetchedAt) }) }}
        </p>
      </div>

      <USwitch
        v-if="section"
        v-model="hidePast"
        :label="t('schedule.hidePast')"
        color="secondary"
      />
    </div>

    <UAlert
      v-if="schedule?.error"
      icon="i-lucide-triangle-alert"
      color="warning"
      variant="subtle"
      :description="t('schedule.stale')"
    />

    <p
      v-if="!section"
      class="rounded-xl border border-dashed border-default/60 py-14 text-center text-sm text-muted"
    >
      {{ isAdmin ? t('schedule.emptyAdmin') : t('schedule.empty') }}
    </p>

    <template v-else>
      <UTabs
        v-if="tabs.length > 1"
        v-model="active"
        :items="tabs"
        :content="false"
        variant="link"
        color="secondary"
      />

      <p
        v-if="!entries.length"
        class="text-sm text-muted"
      >
        {{ t('schedule.allPast') }}
      </p>

      <ol
        v-else
        class="space-y-2"
      >
        <li
          v-for="entry in entries"
          :key="entry.key"
          class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2.5 transition-colors"
          :class="[
            entry.mine
              ? 'border-secondary/60 bg-secondary/10'
              : entry.status === 'live' ? 'border-primary/50 bg-primary/10' : 'border-default/50 bg-elevated/30',
            entry.status === 'past' ? 'opacity-55' : ''
          ]"
        >
          <span
            v-if="entry.matchId"
            class="w-16 shrink-0 font-display text-sm tnum"
          >{{ entry.matchId }}</span>

          <span class="w-40 shrink-0 text-sm tnum">{{ entry.when || '—' }}</span>

          <div class="min-w-0 flex-1 space-y-1.5">
            <p
              v-if="entry.details.length"
              class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted"
            >
              <span
                v-for="detail in entry.details"
                :key="detail.label"
              >{{ detail.label }}: <span class="text-default">{{ detail.value }}</span></span>
            </p>

            <div
              v-for="list in entry.lists"
              :key="list.label"
              class="flex flex-wrap items-center gap-1.5"
            >
              <span
                v-if="!section.qualifiers"
                class="text-xs text-muted"
              >{{ list.label }}</span>
              <UBadge
                v-for="(name, at) in list.names"
                :key="at"
                :color="name.toLowerCase() === me ? 'secondary' : 'neutral'"
                variant="subtle"
                size="sm"
              >
                {{ name }}
              </UBadge>
              <span
                v-if="!list.names.length"
                class="text-xs text-muted"
              >{{ t('schedule.open') }}</span>
            </div>
          </div>

          <div class="flex shrink-0 gap-1.5">
            <UBadge
              v-if="entry.mine"
              color="secondary"
              variant="subtle"
              size="sm"
              icon="i-lucide-user"
            >
              {{ t('schedule.mine') }}
            </UBadge>
            <UBadge
              v-if="entry.status === 'live'"
              color="primary"
              variant="subtle"
              size="sm"
              class="gap-1.5"
            >
              <span class="size-1.5 rounded-full bg-current pulse-gold" />
              {{ t('schedule.live') }}
            </UBadge>
            <UBadge
              v-else-if="entry.status === 'next'"
              color="secondary"
              variant="outline"
              size="sm"
            >
              {{ t('schedule.next') }}
            </UBadge>
          </div>
        </li>
      </ol>
    </template>
  </div>
</template>
