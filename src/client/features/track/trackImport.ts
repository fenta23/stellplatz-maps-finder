import { simplify, trackLengthM } from './trackGeometry.js'
import { TrackImportError } from './trackErrors.js'
import {
  DEFAULT_CORRIDOR_M, MAX_LENGTH_M, MAX_POINTS, SIMPLIFY_TOLERANCE_M,
  type ImportedTrack, type Track, type TrackPoint,
} from './trackTypes.js'

const round5 = (v: number) => Math.round(v * 1e5) / 1e5

function roundAndDedupe(points: readonly TrackPoint[]): TrackPoint[] {
  const out: TrackPoint[] = []
  for (const [lat, lon] of points) {
    const r: TrackPoint = [round5(lat), round5(lon)]
    const last = out[out.length - 1]
    if (!last || last[0] !== r[0] || last[1] !== r[1]) out.push(r)
  }
  return out
}

/** Turn raw imported points into the track that is shown and persisted. */
export function prepareTrack(imported: ImportedTrack, corridorM = DEFAULT_CORRIDOR_M): Track {
  if (imported.points.length < 2) throw new TrackImportError('no-points')
  const lengthM = Math.round(trackLengthM(imported.points))
  if (lengthM > MAX_LENGTH_M) throw new TrackImportError('track-too-long')

  let tolerance = SIMPLIFY_TOLERANCE_M
  let points = roundAndDedupe(simplify(imported.points, tolerance))
  while (points.length > MAX_POINTS) {
    tolerance *= 2
    points = roundAndDedupe(simplify(points, tolerance))
  }
  if (points.length < 2) throw new TrackImportError('no-points')

  return {
    name: imported.name.trim() || 'Route',
    source: imported.source,
    points,
    lengthM,
    corridorM,
  }
}
