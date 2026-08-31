<script setup lang="ts">
import type { Lang } from '~/composables/useLang'

const { lang, t, setLang } = useLang()

const items = [
  { label: 'English', value: 'en' as Lang },
  { label: 'Deutsch', value: 'de' as Lang }
]
</script>

<template>
  <USelect
    :model-value="lang"
    :items="items"
    value-key="value"
    variant="ghost"
    color="neutral"
    size="sm"
    :aria-label="t('app.language')"
    class="w-28"
    @update:model-value="setLang($event as Lang)"
  />
</template>
