import { describe, it, expect } from 'vitest'
import {
  buildGoogleMapsPoiLink, buildPark4nightPoiLink, detectNavPlatform, buildNavLink,
} from './externalLinks.js'

describe('buildGoogleMapsPoiLink', () => {
  it('points at Google Maps with the destination coordinates', () => {
    const url = buildGoogleMapsPoiLink({ lat: 48.123, lon: 11.456 })
    expect(url).toContain('google.com/maps/search/')
    expect(url).toContain('48.123')
    expect(url).toContain('11.456')
  })

  it('includes the POI name (URL-encoded) so Maps selects the matching place', () => {
    const url = buildGoogleMapsPoiLink({ lat: 48.1, lon: 11.5 }, 'Stellplatz am See')
    expect(url).toContain(encodeURIComponent('Stellplatz am See 48.1,11.5'))
  })

  it('falls back to coordinates only when no name is given', () => {
    const url = buildGoogleMapsPoiLink({ lat: 48.1, lon: 11.5 }, '   ')
    expect(url).toContain(encodeURIComponent('48.1,11.5'))
    expect(url).not.toContain('+')
  })
})

describe('buildPark4nightPoiLink', () => {
  it('deep-links to the place detail page when ref:park4night is present', () => {
    const url = buildPark4nightPoiLink({ lat: 48.1, lon: 11.5 }, 'Stellplatz am See', '12345')
    expect(url).toBe('https://park4night.com/lieu/12345/')
  })

  it('falls back to a search link with lat/lng, z=15, and name', () => {
    const url = buildPark4nightPoiLink({ lat: 48.123, lon: 11.456 }, 'Stellplatz am See')
    expect(url).toContain('park4night.com/en/search')
    expect(url).toContain('lat=48.123')
    expect(url).toContain('lng=11.456')
    expect(url).toContain('z=15')
    expect(url).toContain('q=Stellplatz+am+See')
  })

  it('omits q param when name is empty', () => {
    const url = buildPark4nightPoiLink({ lat: 48.1, lon: 11.5 }, '   ')
    expect(url).toContain('park4night.com/en/search')
    expect(url).toContain('lat=48.1')
    expect(url).toContain('lng=11.5')
    expect(url).toContain('z=15')
    expect(url).not.toContain('q=')
  })

  it('omits q param when name is undefined', () => {
    const url = buildPark4nightPoiLink({ lat: 48.1, lon: 11.5 })
    expect(url).toContain('lat=48.1')
    expect(url).toContain('lng=11.5')
    expect(url).not.toContain('q=')
  })
})

describe('detectNavPlatform', () => {
  it('returns apple for iPhone/iPad/Mac user agents', () => {
    expect(detectNavPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 'iPhone')).toBe('apple')
    expect(detectNavPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel')).toBe('apple')
  })
  it('returns google for Android/Windows/Linux', () => {
    expect(detectNavPlatform('Mozilla/5.0 (Linux; Android 14)', 'Linux armv8l')).toBe('google')
    expect(detectNavPlatform('Mozilla/5.0 (Windows NT 10.0)', 'Win32')).toBe('google')
  })
})

describe('buildNavLink', () => {
  const to = { lat: 48.1, lon: 11.5 }
  it('builds a Google directions link with destination only', () => {
    expect(buildNavLink(to, 'google')).toBe('https://www.google.com/maps/dir/?api=1&destination=48.1,11.5')
  })
  it('builds an Apple Maps link with destination only', () => {
    expect(buildNavLink(to, 'apple')).toBe('https://maps.apple.com/?daddr=48.1,11.5')
  })
  it('sets neither origin nor travel mode', () => {
    for (const p of ['google', 'apple'] as const) {
      expect(buildNavLink(to, p)).not.toMatch(/origin|saddr|travelmode|dirflg/)
    }
  })
  it('detects the platform from navigator when none is given', () => {
    expect(buildNavLink(to)).toMatch(/maps\.apple\.com|google\.com\/maps\/dir/)
  })
})
