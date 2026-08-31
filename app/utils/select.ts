/**
 * Sentinels for select options that stand for "nothing".
 *
 * A `USelect` refuses an empty string as an option value - it reserves that for "cleared, show the
 * placeholder" - so the options that mean *no column* and *every round* carry a marker instead, and
 * the handlers turn it back into `null` on the way out.
 */
export const SELECT_NONE = '__none__'
export const SELECT_ALL = '__all__'

/** What a select's value means once the sentinel is stripped off. */
export const selectValue = (value: unknown): string | null => {
  const text = String(value)

  return text === SELECT_NONE || text === '' ? null : text
}
