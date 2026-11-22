import { CEMETERY_TYPE_ID, cemeteryRowHint } from '@/features/poi-detail/cemeteryHint.js'

/** Title/subtitle of a route-panel row: the name over the type label, or just the type label without a name. Cemeteries get a winter hint. */
export function routeRowTexts(
  name: string | undefined,
  typeLabel: string,
  opts: { readonly type?: string; readonly now?: Date } = {},
): { readonly title: string; readonly subtitle: string; readonly hint?: string } {
  const n = name?.trim()
  const base = n ? { title: n, subtitle: typeLabel } : { title: typeLabel, subtitle: '' }
  const hint = opts.type === CEMETERY_TYPE_ID ? cemeteryRowHint(opts.now ?? new Date()) : undefined
  return hint ? { ...base, hint } : base
}
