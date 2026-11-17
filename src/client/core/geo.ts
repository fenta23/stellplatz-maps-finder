export interface LatLon {
  readonly lat: number
  readonly lon: number
}

const EARTH_RADIUS_M = 6_371_000

/** Great-circle distance (Luftlinie) between two points in metres. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLon = Math.sin(dLon / 2)
  const chord =
    sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLon * sinDLon
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(chord))
}
