import type { QualifierMap } from '#shared/types'

/** The classes one bracket's colour is drawn with, spelled out whole so Tailwind finds them. */
interface BracketStyle {
  /** A tile's border. */
  border: string
  /** A table heading's underline - a shadow, since a collapsed border stays put under a sticky head. */
  underline: string
  /** A faint wash behind a table cell, light enough that the number on it still reads first. */
  tint: string
}

const BRACKETS: Record<string, BracketStyle> = {
  NM: { border: 'border-zinc-400/70', underline: 'shadow-[inset_0_-2px_0_var(--color-zinc-400)]', tint: 'bg-zinc-400/8' },
  HD: { border: 'border-yellow-400/70', underline: 'shadow-[inset_0_-2px_0_var(--color-yellow-400)]', tint: 'bg-yellow-400/8' },
  HR: { border: 'border-red-500/70', underline: 'shadow-[inset_0_-2px_0_var(--color-red-500)]', tint: 'bg-red-500/8' },
  DT: { border: 'border-violet-500/70', underline: 'shadow-[inset_0_-2px_0_var(--color-violet-500)]', tint: 'bg-violet-500/8' },
  FM: { border: 'border-green-500/70', underline: 'shadow-[inset_0_-2px_0_var(--color-green-500)]', tint: 'bg-green-500/8' }
}

/**
 * A slot's colour by its mod bracket - the letters its name starts with ("HD2" -> HD), the way the
 * seeding export groups them, or the slot's mods when the name has no letters. Brackets with no
 * colour of their own (TB, EZ, ...) get `null` and keep the plain look.
 */
export const bracketStyle = (map: QualifierMap): BracketStyle | null => {
  const bracket = (/^[a-z]+/i.exec(map.label.trim())?.[0] ?? '').toUpperCase() || map.mods || 'NM'

  return BRACKETS[bracket] ?? null
}
