import { Mods, modRate } from './mods'

/**
 * A beatmap's difficulty settings, as the slot is played.
 *
 * The legacy API hands these back *raw* whatever `mods` is asked for - only `difficultyrating` comes
 * back adjusted - so everything the pool shows beside a modded star rating has to be worked out here,
 * or the numbers would describe a different map than the rating beside them does.
 *
 * Every field is optional because they come out of a JSON response a field at a time; a map missing
 * one still shows the rest rather than nothing.
 */
export interface BeatmapDifficulty {
  cs?: number | null
  ar?: number | null
  od?: number | null
  hp?: number | null
  bpm?: number | null
  lengthSeconds?: number | null
}

const HR_SCALE = 1.4
const HR_CS_SCALE = 1.3
const EZ_SCALE = 0.5
/** The game caps every setting HR raises at 10 - AR 8 under HR is AR 10, not AR 11.2. */
const MAX_SETTING = 10
const NO_RATE_CHANGE = 1

/** AR is a curve with a knee at 5: a flatter millisecond-per-point slope below it, steeper above. */
const AR_KNEE = 5
const AR_KNEE_MS = 1200
const AR_ZERO_MS = 1800
const AR_SLOW_STEP = 120
const AR_FAST_STEP = 150

/** OD is a straight line: the "300" window runs from 80ms at OD 0 to 20ms at OD 10. */
const OD_ZERO_MS = 80
const OD_STEP = 6

/** Two decimals is finer than anything shows, and keeps the persisted pool readable. */
const rounded = (value: number): number => Math.round(value * 100) / 100

/** Milliseconds an approach circle is visible for, which is what AR actually names. */
const preemptOf = (ar: number): number =>
  ar <= AR_KNEE ? AR_ZERO_MS - ar * AR_SLOW_STEP : AR_KNEE_MS - (ar - AR_KNEE) * AR_FAST_STEP

const approachRateOf = (preempt: number): number =>
  preempt > AR_KNEE_MS ? (AR_ZERO_MS - preempt) / AR_SLOW_STEP : AR_KNEE + (AR_KNEE_MS - preempt) / AR_FAST_STEP

/** Milliseconds either side of a note that still count as a 300, which is what OD names. */
const hitWindowOf = (od: number): number => OD_ZERO_MS - od * OD_STEP

const overallDifficultyOf = (window: number): number => (OD_ZERO_MS - window) / OD_STEP

const scale = (value: number | null | undefined, factor: number, cap: number): number | null =>
  value == null ? null : rounded(Math.min(value * factor, cap))

/**
 * The same map under `mods` - a v1 bitmask, already cut down by `difficultyMask`.
 *
 * The two halves work differently, which is the whole subtlety here:
 *
 * HR and EZ scale the *settings*. HR multiplies CS by 1.3 and AR, OD and HP by 1.4; EZ halves all
 * four. All four cap at 10, the way the game caps them - AR 8 under HR is AR 10, not AR 11.2.
 *
 * DT and HT touch none of the four. They change how much *time* the player gets, so AR and OD are
 * converted into the millisecond windows they actually stand for, scaled by the rate, and read back
 * as numbers. That is why they come out *above* 10 (AR 9 under DT is AR 10.33, uncapped: the clock is
 * not a setting) while CS and HP, which are not times, do not move at all.
 *
 * Both apply in that order for combinations like HRDT, matching the game. The AR and OD conversions
 * are osu!standard's; this tournament is osu!standard, and other modes spell OD's windows differently.
 */
export function withMods(difficulty: BeatmapDifficulty, mods: number): BeatmapDifficulty {
  let scaled = difficulty

  if ((mods & Mods.HR) !== 0) {
    scaled = {
      ...difficulty,
      cs: scale(difficulty.cs, HR_CS_SCALE, MAX_SETTING),
      ar: scale(difficulty.ar, HR_SCALE, MAX_SETTING),
      od: scale(difficulty.od, HR_SCALE, MAX_SETTING),
      hp: scale(difficulty.hp, HR_SCALE, MAX_SETTING)
    }
  } else if ((mods & Mods.EZ) !== 0) {
    scaled = {
      ...difficulty,
      cs: scale(difficulty.cs, EZ_SCALE, MAX_SETTING),
      ar: scale(difficulty.ar, EZ_SCALE, MAX_SETTING),
      od: scale(difficulty.od, EZ_SCALE, MAX_SETTING),
      hp: scale(difficulty.hp, EZ_SCALE, MAX_SETTING)
    }
  }

  const rate = modRate(mods)
  if (rate === NO_RATE_CHANGE) return scaled

  return {
    ...scaled,
    ar: scaled.ar == null ? null : rounded(approachRateOf(preemptOf(scaled.ar) / rate)),
    od: scaled.od == null ? null : rounded(overallDifficultyOf(hitWindowOf(scaled.od) / rate)),
    bpm: scaled.bpm == null ? null : rounded(scaled.bpm * rate),
    lengthSeconds: scaled.lengthSeconds == null ? null : Math.round(scaled.lengthSeconds / rate)
  }
}
