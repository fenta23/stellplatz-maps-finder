import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/utils.ts'
import { handleHealth } from './healthHandler.ts'
import { handleOverpass } from './overpassHandler.ts'
import { handleGeocode } from './geocodeHandler.ts'
import { handleNearby } from './nearbyHandler.ts'
import { handleMapillary } from './mapillaryHandler.ts'
import { handleNotes } from './notesHandler.ts'
import { handleAi } from './aiHandler.ts'

serve(async (req) => {
  const url = new URL(req.url)
  const path = url.pathname
  const method = req.method
  const origin = req.headers.get('origin')

  // CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  try {
    if (path === '/api/health' && method === 'GET') return handleHealth(origin)

    if (path === '/api/overpass') {
      if (method !== 'POST') return methodNotAllowed(origin)
      return await handleOverpass(req, origin)
    }

    if (path === '/api/geocode') {
      if (method !== 'GET') return methodNotAllowed(origin)
      return await handleGeocode(req, origin)
    }

    if (path === '/api/nearby') {
      if (method !== 'GET') return methodNotAllowed(origin)
      return await handleNearby(req, origin)
    }

    if (path === '/api/mapillary') {
      if (method !== 'GET') return methodNotAllowed(origin)
      return await handleMapillary(req, origin)
    }

    if (path === '/api/notes') {
      if (method !== 'GET') return methodNotAllowed(origin)
      return await handleNotes(req, origin)
    }

    if (path === '/api/ai') {
      if (method !== 'POST') return methodNotAllowed(origin)
      return await handleAi(req, origin)
    }

    return errorResponse('Not found', 404, origin)
  } catch (err) {
    console.error('Unhandled error:', err)
    return errorResponse('Internal server error', 500, origin)
  }
})

function methodNotAllowed(origin: string | null): Response {
  return errorResponse('Method not allowed', 405, origin)
}
