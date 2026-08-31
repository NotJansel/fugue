/**
 * Minimal RFC 4180 CSV reader.
 *
 * Google Sheets exports are well-formed but do contain quoted fields with embedded commas and
 * newlines (team names, comments), so a naive `split(',')` is not enough. Pulling in a CSV library
 * for the ~50 lines this needs isn't worth the dependency.
 *
 * Rows are returned exactly as they appear, including blank ones - callers decide what to skip.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let index = 0

  const endField = () => {
    row.push(field)
    field = ''
  }

  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (index < input.length) {
    const char = input[index]

    if (inQuotes && char === '"' && input[index + 1] === '"') {
      // "" inside a quoted field is a literal quote.
      field += '"'
      index++
    } else if (char === '"') {
      inQuotes = !inQuotes
    } else if (!inQuotes && char === ',') {
      endField()
    } else if (!inQuotes && (char === '\n' || char === '\r')) {
      // Treat CRLF as a single break.
      if (char === '\r' && input[index + 1] === '\n') index++
      endRow()
    } else {
      field += char
    }

    index++
  }

  // A trailing newline shouldn't produce a phantom row, but unterminated content must be kept.
  if (field !== '' || row.length > 0) endRow()

  return rows
}
