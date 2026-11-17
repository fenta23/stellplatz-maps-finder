/** Title/subtitle of a track-panel row: the name over the type label, or just the type label without a name. */
export function trackRowTexts(name: string | undefined, typeLabel: string): { readonly title: string; readonly subtitle: string } {
  const n = name?.trim()
  return n ? { title: n, subtitle: typeLabel } : { title: typeLabel, subtitle: '' }
}
