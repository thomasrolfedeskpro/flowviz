/**
 * How a packet's payload is presented.
 *
 * The payload used to be `JSON.stringify(data, null, 2)` in a monospace block,
 * whatever the flow was about. That is honest for a card authorisation, which
 * really is a message with fields, and forced everywhere else: a raindrop
 * described in braces and quotes, with its unit smuggled into the key name
 * because a key-value pair was the only shape on offer. Measured across the
 * flows in this repo, `drop_diameter_mm`, `pO2_mmHg`, `power_w` and
 * `fall_speed_m_s` are all doing that.
 *
 * So the payload is read rather than dumped: scalars become labelled facts with
 * their unit lifted out of the key, a string payload is prose, and an author who
 * genuinely wants the message form asks for it.
 */

export interface Fact {
  label: string
  value: string
  unit?: string
  /** True when the value is a nested object or array, kept as compact JSON
   *  because there is no honest flat rendering of one. */
  nested?: boolean
}

export type PacketBody =
  | { kind: 'empty' }
  /** A sentence the author wrote. */
  | { kind: 'prose'; text: string }
  | { kind: 'facts'; facts: Fact[] }
  /** Verbatim JSON, because the payload is a message. */
  | { kind: 'raw'; json: string }

/**
 * Units, keyed by the trailing `_`-delimited segment of a field name.
 *
 * An allow-list, not a pattern. The corpus has 526 distinct payload keys and
 * the ones ending in a short segment are mostly *not* units — `cart_id`,
 * `auth_code`, `entry_mode`, `redirect_uri`, `hs_code`, `retry_in`,
 * `park_lane`, `pool_size`. Anything clever enough to catch `_mm` would mangle
 * those, so only these are ever treated as a unit, and everything else stays
 * part of the label.
 */
const UNITS: Record<string, string> = {
  // time
  ms: 'ms', s: 's', sec: 's', secs: 's', min: 'min', mins: 'min', h: 'h', hr: 'h',
  // length
  mm: 'mm', cm: 'cm', m: 'm', km: 'km',
  // volume
  ml: 'ml', l: 'L',
  // mass
  mg: 'mg', g: 'g', kg: 'kg', t: 't',
  // power and energy
  w: 'W', kw: 'kW', mw: 'MW', wh: 'Wh', kwh: 'kWh', mwh: 'MWh',
  // current, voltage, resistance
  a: 'A', ma: 'mA', v: 'V', kv: 'kV', mv: 'mV', ohm: 'Ω',
  // data
  b: 'B', kb: 'kB', mb: 'MB', gb: 'GB', tb: 'TB',
  kib: 'KiB', mib: 'MiB', gib: 'GiB',
  bps: 'bps', kbps: 'kbps', mbps: 'Mbps',
  // pressure
  mmhg: 'mmHg', kpa: 'kPa', bar: 'bar', psi: 'psi',
  // temperature
  c: '°C', f: '°F', k: 'K',
  // frequency and rate
  hz: 'Hz', khz: 'kHz', rpm: 'rpm', pph: 'pph', pct: '%',
  // angle
  deg: '°',
}

/** Compound units written as two segments, e.g. `fall_speed_m_s`. */
const COMPOUND_UNITS: Record<string, string> = {
  m_s: 'm/s', km_h: 'km/h', m_s2: 'm/s²', l_min: 'L/min', kg_m3: 'kg/m³',
}

/**
 * Segments to set in capitals rather than sentence case.
 *
 * Small and drawn from what the flows actually contain. Getting this wrong is
 * cosmetic — "Mti" instead of "MTI" — so it is not worth a long list or any
 * cleverness.
 */
const ACRONYMS = new Set([
  'id', 'ids', 'url', 'uri', 'api', 'sql', 'ip', 'tls', 'ttl', 'dns', 'http', 'https',
  'json', 'xml', 'csv', 'html', 'css', 'jwt', 'pnr', 'mpan', 'mti', 'pan', 'mawb',
  'uld', 'pax', 'cif', 'hs', 'mcc', 'bin', 'eta', 'sla', 'crud', 'db', 'cpu', 'gpu',
  'ram', 'os', 'ui', 'ux', 'pdf', 'svg', 'png', 'jpg', 'gif', 'usd', 'gbp', 'eur',
])

/**
 * Keys safe to rewrite: a plain identifier of letters, digits and underscores.
 *
 * Deliberately narrow. Dotted OpenTelemetry attributes (`http.status_code`,
 * `db.statement`), headers (`x-forwarded-for`), class names
 * (`DeskproMessenger\Client`) and expressions (`find(code)`) are all real names
 * that someone would grep for, and prettifying them would be a lie.
 */
const REWRITABLE = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*$/

/** Sentence case, unless the segment is an acronym or already mixed case. */
function segmentText(segment: string, isFirst: boolean): string {
  const lower = segment.toLowerCase()
  if (ACRONYMS.has(lower)) return segment.toUpperCase()
  // `pO2`, `pCO2` carry meaning in their capitals; leave anything mixed alone.
  if (segment !== lower) return segment
  return isFirst ? segment.charAt(0).toUpperCase() + segment.slice(1) : segment
}

/** A field name split into what to show and the unit it was carrying. */
export function labelAndUnit(key: string): { label: string; unit?: string } {
  if (!REWRITABLE.test(key)) return { label: key }

  const parts = key.split('_')

  let unit: string | undefined
  if (parts.length >= 3) {
    const pair = `${parts.at(-2)}_${parts.at(-1)}`.toLowerCase()
    if (COMPOUND_UNITS[pair]) {
      unit = COMPOUND_UNITS[pair]
      parts.splice(-2, 2)
    }
  }
  if (!unit && parts.length >= 2) {
    const last = parts.at(-1)!.toLowerCase()
    if (UNITS[last]) {
      unit = UNITS[last]
      parts.pop()
    }
  }

  return {
    label: parts.map((p, i) => segmentText(p, i === 0)).join(' '),
    unit,
  }
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

export function packetBody(data: unknown, format?: 'raw'): PacketBody {
  if (data === null || data === undefined) return { kind: 'empty' }

  // A string payload is a sentence: the natural form for a flow that is not
  // about messages at all.
  if (typeof data === 'string') {
    const text = data.trim()
    return text ? { kind: 'prose', text } : { kind: 'empty' }
  }

  if (typeof data !== 'object') return { kind: 'prose', text: String(data) }

  if (format === 'raw' || Array.isArray(data)) {
    return { kind: 'raw', json: JSON.stringify(data, null, 2) }
  }

  const entries = Object.entries(data as Record<string, unknown>)
  if (entries.length === 0) return { kind: 'empty' }

  const facts = entries.map(([key, value]) => {
    const { label, unit } = labelAndUnit(key)
    const isNested = typeof value === 'object' && value !== null
    return {
      label,
      // Nested values keep their braces — flattening an object into a fact row
      // would either lose it or invent a shape it does not have.
      value: isNested ? JSON.stringify(value) : scalarText(value),
      ...(unit && !isNested ? { unit } : {}),
      ...(isNested ? { nested: true } : {}),
    }
  })

  return { kind: 'facts', facts }
}
