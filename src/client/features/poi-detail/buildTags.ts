import type { OsmPoi } from '@/features/pois/OverpassClient.js'
import { bool, typeLabel, ACCESS_LABELS, PARKING_LABELS, SURFACE_LABELS, WIFI_LABELS, DOG_LABELS } from './poiLabels.js'

export interface TagRow {
  readonly label: string
  readonly value: string
  readonly href?: string
}

export function buildTags(poi: OsmPoi): TagRow[] {
  const t = poi.tags
  const rows: TagRow[] = []
  const add = (label: string, value: string | undefined) => { if (value) rows.push({ label, value }) }
  const addLink = (label: string, href: string, value: string) => rows.push({ label, value, href })

  add('Filter', typeLabel(poi.type))
  add('Zugang', ACCESS_LABELS[t['access'] ?? ''] ?? t['access'])
  add('Öffnungszeiten', t.opening_hours)

  if (poi.type === 'parking') {
    add('Parkplatztyp', PARKING_LABELS[t['parking'] ?? ''] ?? t['parking'])
    add('Belag', SURFACE_LABELS[t['surface'] ?? ''] ?? t['surface'])
    add('Beleuchtet', bool(t['lit']))
    add('Überdacht', bool(t['covered']))
    add('Bewacht', bool(t['supervised']))
    if (t['maxheight']) add('Max. Höhe', t['maxheight'] + ' m')
    if (t['maxweight']) add('Max. Gewicht', t['maxweight'] + ' t')
    add('Park & Ride', bool(t['park_ride']))
    add('E-Ladesäule', bool(t['capacity:charging']))
  }

  if (poi.type === 'camper' || poi.type === 'campsite') {
    add('Strom', bool(t['electricity'] ?? t['power_supply']))
    add('Trinkwasser', bool(t['drinking_water']))
    add('Dusche', bool(t['shower']))
    add('Toilette', bool(t['toilets']))
    add('Entsorgungsstation', bool(t['sanitary_dump_station'] ?? t['motorhome_dump_station']))
    add('WLAN', WIFI_LABELS[t['internet_access'] ?? ''] ?? bool(t['internet_access']))
    add('Hunde', DOG_LABELS[t['dog'] ?? ''] ?? bool(t['dog']))
    add('Wohnwagen', bool(t['caravans']))
    add('Zelte', bool(t['tents']))
    add('Nur Gruppen', bool(t['group_only']))
    if (t['stars']) add('Sterne', '★'.repeat(Number(t['stars'])))
  }

  add('Gebühr', t.fee === 'yes' ? 'Ja' : t.fee === 'no' ? 'Nein' : t.fee)
  add('Preis', t['charge'])
  add('Max. Aufenthalt', t['maxstay'])
  add('Kapazität', t.capacity)

  if (t.phone) addLink('Telefon', `tel:${t.phone}`, t.phone)
  if (t.email) addLink('E-Mail', `mailto:${t.email}`, t.email)
  if (t.website) addLink('Website', t.website, 'Öffnen')

  const addrParts = [
    t['addr:street'] && t['addr:housenumber']
      ? `${t['addr:street']} ${t['addr:housenumber']}`
      : t['addr:street'],
    t['addr:postcode'] && t['addr:city']
      ? `${t['addr:postcode']} ${t['addr:city']}`
      : t['addr:city'],
  ].filter(Boolean) as string[]
  if (addrParts.length) add('Adresse', addrParts.join(', '))

  add('Betreiber', t.operator)
  if (t.description) add('Beschreibung', t.description)

  return rows
}
