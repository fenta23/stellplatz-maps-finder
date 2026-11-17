/** Type id of the built-in "Friedhof (Wasser)" category. */
export const CEMETERY_TYPE_ID = 'cemetery'

/** Winter = 1 November to 31 March (months are 1-based). */
export const WINTER_START_MONTH = 11
export const WINTER_END_MONTH = 3

const TEXT_ALL_YEAR = 'Meist Wasserhahn vorhanden – keine geprüfte Trinkwasserqualität.'
const TEXT_WINTER = 'Im Winter ist das Wasser oft abgestellt.'
const ROW_WINTER = 'Wasser im Winter oft abgestellt'

function isWinter(date: Date): boolean {
  const month = date.getMonth() + 1 // local time
  return month >= WINTER_START_MONTH || month <= WINTER_END_MONTH
}

export function cemeteryWaterHint(date: Date): { readonly text: string; readonly winterText: string | null; readonly winter: boolean } {
  const winter = isWinter(date)
  return { text: TEXT_ALL_YEAR, winterText: winter ? TEXT_WINTER : null, winter }
}

/** Short hint for list rows; only in winter. */
export function cemeteryRowHint(date: Date): string | undefined {
  return isWinter(date) ? ROW_WINTER : undefined
}
