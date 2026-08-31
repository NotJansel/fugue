/** Number, money and time formatting, all following the language the dashboard is set to. */
export function useFormat() {
  const { lang } = useLang()

  const locale = computed(() => lang.value === 'de' ? 'de-DE' : 'en-GB')

  /** Bids and purses. The tournament's unit is the euro, as the Discord card has always said. */
  const money = (value: number | null | undefined): string =>
    value == null ? '—' : `${new Intl.NumberFormat(locale.value).format(value)} €`

  const number = (value: number | null | undefined, digits = 0): string =>
    value == null
      ? '—'
      : new Intl.NumberFormat(locale.value, { minimumFractionDigits: digits, maximumFractionDigits: digits })
          .format(value)

  /** `4:31`, the way every osu! client writes a map's length. */
  const duration = (seconds: number | null | undefined): string => {
    if (seconds == null) return '—'

    const minutes = Math.floor(seconds / 60)

    return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
  }

  const dateTime = (epochMillis: number | null | undefined): string =>
    epochMillis == null
      ? '—'
      : new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(epochMillis)

  return { money, number, duration, dateTime, locale }
}
