<script setup lang="ts">
/**
 * The house mark: a struck coin, gold on oxblood.
 *
 * Drawn rather than imported so it inherits the theme's own tokens - change the palette in
 * `main.css` and the logo follows.
 */
</script>

<template>
  <svg
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Auction House"
  >
    <defs>
      <linearGradient
        id="ba-coin"
        x1="6"
        y1="4"
        x2="42"
        y2="44"
        gradientUnits="userSpaceOnUse"
      >
        <stop
          offset="0"
          stop-color="var(--color-gold-400)"
        />
        <stop
          offset="0.55"
          stop-color="var(--color-gold-600)"
        />
        <stop
          offset="1"
          stop-color="var(--color-ember-700)"
        />
      </linearGradient>
    </defs>

    <rect
      x="3"
      y="3"
      width="42"
      height="42"
      rx="13"
      fill="url(#ba-coin)"
    />
    <rect
      x="6.5"
      y="6.5"
      width="35"
      height="35"
      rx="10"
      fill="var(--color-ember-950)"
      fill-opacity="0.72"
    />
    <path
      d="M30.5 17.4c-1.5-1.4-3.4-2.2-5.6-2.2-3.7 0-6.8 2.3-8 5.6h10.4l-1 2.6H16.4a9.6 9.6 0 0 0 0 1.2h9.3l-1 2.6h-7.8c1.2 3.3 4.3 5.6 8 5.6 2.2 0 4.1-.8 5.6-2.2"
      stroke="var(--color-gold-300)"
      stroke-width="2.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
  </svg>
</template>
