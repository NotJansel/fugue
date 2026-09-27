<script setup lang="ts">
/**
 * The hammer, drawn as a ring so it reads from across the room. `waiting` draws the few seconds before
 * bidding opens instead, in a quieter colour - nothing can be done about those yet.
 *
 * The ring runs its own countdown to `endsAt` rather than being handed the seconds: it ticks five
 * times a second, and a page that passed the numbers down would re-render whole with every tick.
 */
const props = defineProps<{ endsAt: number | null, totalMs: number, size?: number, waiting?: boolean }>()

const { seconds, fraction } = useCountdown(() => props.endsAt, () => props.totalMs)

const size = computed(() => props.size ?? 84)
const radius = computed(() => size.value / 2 - 5)
const circumference = computed(() => 2 * Math.PI * radius.value)
const offset = computed(() => circumference.value * (1 - fraction.value))

/** Gold for the whole run, red for the last three seconds - the point at which people start typing. */
const stroke = computed(() => {
  if (props.waiting) return 'var(--color-umber-400)'

  return seconds.value <= 3 ? 'var(--color-ember-500)' : 'var(--color-gold-500)'
})

const tone = computed(() => {
  if (props.waiting) return 'text-muted'

  return seconds.value <= 3 ? 'text-primary' : 'text-secondary'
})
</script>

<template>
  <div
    class="relative shrink-0"
    :style="{ width: `${size}px`, height: `${size}px` }"
  >
    <svg
      :viewBox="`0 0 ${size} ${size}`"
      class="-rotate-90 size-full"
    >
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        stroke="var(--color-umber-800)"
        stroke-width="4"
      />
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        :stroke="stroke"
        stroke-width="4"
        stroke-linecap="round"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="offset"
        class="transition-[stroke-dashoffset] duration-200 ease-linear"
      />
    </svg>

    <span
      class="absolute inset-0 grid place-items-center font-display text-2xl tnum"
      :class="tone"
    >
      {{ seconds }}
    </span>
  </div>
</template>
