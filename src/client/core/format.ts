const decimal = (n: number) => n.toFixed(1).replace('.', ',')

/**
 * Distance of a place from an imported route, shared by the route list and the POI detail panel:
 * "an der Route" (rounds to < 10 m), "60 m abseits" (10 m steps below 1 km), "1,2 km abseits".
 */
export function formatRouteOffset(offsetM: number): string {
  const rounded = Math.round(offsetM / 10) * 10
  if (rounded < 10) return 'an der Route'
  return rounded < 1000 ? `${rounded} m abseits` : `${decimal(offsetM / 1000)} km abseits`
}
