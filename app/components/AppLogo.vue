<script setup lang="ts">
/**
 * The tournament's mark, as supplied: a white brush stroke on a transparent ground, which is why it
 * sits on the dark theme without a tile of its own. `/logo.png` is the full-size original;
 * `/favicon.png` is the same mark at tab size.
 */
const { t } = useLang()
</script>

<template>
  <img
    src="/logo.png"
    :alt="t('app.title')"
    decoding="async"
  >
</template>
