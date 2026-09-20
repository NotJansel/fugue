/**
 * osu! mods, in the bitmask the legacy API (v1) speaks.
 *
 * Pools name their slots after mods ("HD2", "DT1"), and a slot's star rating only means anything with
 * those mods applied - a 4.69* map is a 6.56* map under DT. `difficultyMask` is what makes that
 * lookup work: `get_beatmaps` answers with a rating of *zero* for any `mods` value it does not
 * consider difficulty-affecting, so the mask has to be cut down to the bits it accepts.
 */
export const Mods = {
  NONE: 0,
  NF: 1,
  EZ: 2,
  TD: 4,
  HD: 8,
  HR: 16,
  SD: 32,
  DT: 64,
  RX: 128,
  HT: 256,
  NC: 512,
  FL: 1024,
  AT: 2048,
  SO: 4096,
  AP: 8192,
  PF: 16384
} as const

/**
 * Every acronym the parser knows, in the order osu! itself writes them, so `formatMods` produces the
 * spelling people expect ("HDHR", "HDDT") whichever way round they typed it.
 */
const ACRONYMS: [string, number][] = [
  ['EZ', Mods.EZ], ['NF', Mods.NF], ['HT', Mods.HT],
  ['HD', Mods.HD], ['HR', Mods.HR], ['SD', Mods.SD], ['PF', Mods.PF],
  ['DT', Mods.DT], ['NC', Mods.NC], ['FL', Mods.FL],
  ['TD', Mods.TD], ['RX', Mods.RX], ['AP', Mods.AP], ['AT', Mods.AT], ['SO', Mods.SO]
]

const BY_ACRONYM = new Map(ACRONYMS)

/**
 * Slot prefixes that name a *bracket* rather than a mod: no-mod, free-mod and tiebreaker slots are
 * all rated plain, but their names still have to parse or every such slot would read as "no idea".
 */
const BRACKETS = new Set(['NM', 'FM', 'TB'])

/** The only bits `get_beatmaps` accepts; anything else makes it answer with a rating of zero. */
const DIFFICULTY_BITS = Mods.EZ | Mods.TD | Mods.HD | Mods.HR | Mods.DT | Mods.HT | Mods.FL

const NORMAL_RATE = 1
const DT_RATE = 1.5
const HT_RATE = 0.75

/** `null` unless the whole text is known acronyms, back to back - "MAP" is not a mod combination. */
function decompose(letters: string): number | null {
  if (letters.length === 0 || letters.length % 2 !== 0) return null

  let mods = Mods.NONE

  for (let index = 0; index < letters.length; index += 2) {
    const acronym = letters.slice(index, index + 2)
    if (BRACKETS.has(acronym)) continue

    const bit = BY_ACRONYM.get(acronym)
    if (bit == null) return null

    mods |= bit
  }

  return mods
}

/**
 * Reads a written mod combination - "HDDT", "hd dt", "+HR" - into a bitmask.
 *
 * Every acronym is two letters, so the text is read in pairs; anything that does not decompose
 * cleanly into known ones is not a combination at all and comes back as `NONE`, which leaves a typo
 * showing the plain rating rather than a confidently wrong one.
 */
export const parseMods = (input: string): number =>
  decompose(input.toUpperCase().replace(/[^A-Z]/g, '')) ?? Mods.NONE

/**
 * The mods a pool slot is played with going by its name: "DT1" -> DT, "HDHR2" -> HD and HR,
 * "NM1"/"FM2"/"TB" -> none. `null` when the name says nothing about mods either way ("Map 3"), so a
 * caller can tell "no mods" apart from "no idea".
 */
export const modsFromSlotLabel = (label: string): number | null =>
  decompose((/^[a-z]*/i.exec(label)?.[0] ?? '').toUpperCase())

/** Canonical spelling of a combination, in osu!'s own order, so "dthd" and "HDDT" both read "HDDT". */
export const formatMods = (mods: number): string =>
  ACRONYMS.filter(([, bit]) => (mods & bit) !== 0).map(([acronym]) => acronym).join('')

/**
 * How fast the map plays: DT and NC run at 1.5x, HT at 0.75x, everything else at its own speed.
 *
 * This is the *only* thing those mods do to a map's settings - see `withMods` in `difficulty.ts`.
 */
export const modRate = (mods: number): number =>
  (mods & (Mods.DT | Mods.NC)) !== 0 ? DT_RATE : (mods & Mods.HT) !== 0 ? HT_RATE : NORMAL_RATE

/**
 * The part of a combination `get_beatmaps` will actually answer for.
 *
 * NC is DT as far as difficulty goes and is sent as such - asked for NC itself the API returns a
 * rating of zero. So does any bit outside the difficulty set (NF, SD, PF, SO...), and so does a
 * self-contradictory pair, which is why EZ+HR and DT+HT fall back to the plain rating rather than
 * being passed on to be answered with a zero.
 */
export function difficultyMask(mods: number): number {
  const bits = ((mods & Mods.NC) !== 0 ? mods | Mods.DT : mods) & DIFFICULTY_BITS

  if ((bits & Mods.EZ) !== 0 && (bits & Mods.HR) !== 0) return Mods.NONE
  if ((bits & Mods.DT) !== 0 && (bits & Mods.HT) !== 0) return Mods.NONE

  return bits
}

/**
 * The mods a slot is played with: whatever the organiser typed, or - when they typed nothing -
 * whatever the slot name implies, so a pool imported as "HD1"/"DT2" comes out rated under its own
 * mods without anyone filling in a second field. A name that says nothing ("Map 3") leaves it plain.
 */
export function modsFor(typed: string, label: string): string {
  const explicit = typed.trim()
  if (explicit !== '') return formatMods(parseMods(explicit))

  return formatMods(modsFromSlotLabel(label) ?? Mods.NONE)
}

/**
 * The mods a freemod score is *scored* under, rather than the ones it was played with.
 *
 * Seeding normalises mods away: HD, HR, DT and the rest are compared at face value, because osu!'s
 * own multipliers already pay for them. Only EZ is worth a tournament multiplier - it costs far more
 * score than it gives back - and EZHD is worth telling apart from plain EZ, since HD pays part of it
 * back. So an EZ run keeps `EZ` plus its HD bit and loses everything else (`EZDT` scores as `EZ`,
 * `EZHDDT` as `EZHD`), and a run without EZ normalises to no mods at all.
 */
export const normalizeMods = (mods: number): number =>
  (mods & Mods.EZ) === 0 ? Mods.NONE : Mods.EZ | (mods & Mods.HD)
