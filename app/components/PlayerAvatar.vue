<script setup lang="ts">
/**
 * An osu! avatar.
 *
 * Players imported without an ID column carry a `name:` placeholder until enrichment resolves them,
 * and `a.ppy.sh` would answer that with its own guest picture - so those fall back to initials here
 * instead, which at least says *who* rather than "someone".
 */
const props = defineProps<{ osuId: string, username: string, size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' }>()

const src = computed(() => props.osuId.startsWith('name:') ? undefined : `https://a.ppy.sh/${props.osuId}`)
</script>

<template>
  <UAvatar
    :src="src"
    :alt="username"
    :text="username.slice(0, 2).toUpperCase()"
    :size="size ?? 'sm'"
    class="ring-1 ring-default/60"
  />
</template>
