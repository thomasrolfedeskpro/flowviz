import { describe, it, expect } from 'vitest'
import { packetBody, labelAndUnit } from '@/utils/packetBody'

describe('labelAndUnit', () => {
  it('lifts a unit out of the field name', () => {
    expect(labelAndUnit('drop_diameter_mm')).toEqual({ label: 'Drop diameter', unit: 'mm' })
    expect(labelAndUnit('duration_ms')).toEqual({ label: 'Duration', unit: 'ms' })
    expect(labelAndUnit('weight_kg')).toEqual({ label: 'Weight', unit: 'kg' })
    expect(labelAndUnit('import_kwh')).toEqual({ label: 'Import', unit: 'kWh' })
    expect(labelAndUnit('temperature_c')).toEqual({ label: 'Temperature', unit: '°C' })
  })

  it('handles a compound unit written as two segments', () => {
    expect(labelAndUnit('fall_speed_m_s')).toEqual({ label: 'Fall speed', unit: 'm/s' })
  })

  it('keeps capitals that carry meaning', () => {
    expect(labelAndUnit('pO2_mmHg')).toEqual({ label: 'pO2', unit: 'mmHg' })
    expect(labelAndUnit('pCO2_mmHg')).toEqual({ label: 'pCO2', unit: 'mmHg' })
  })

  it('sets known acronyms in capitals', () => {
    expect(labelAndUnit('cart_id').label).toBe('Cart ID')
    expect(labelAndUnit('redirect_uri').label).toBe('Redirect URI')
    expect(labelAndUnit('db_ms')).toEqual({ label: 'DB', unit: 'ms' })
  })

  /**
   * The whole reason units are an allow-list. Every one of these ends in a
   * short segment that a pattern would happily eat: 526 payload keys in this
   * repo and most of the short endings are not units at all.
   */
  it.each([
    'cart_id', 'auth_code', 'entry_mode', 'redirect_uri', 'hs_code', 'retry_in',
    'park_lane', 'pool_size', 'response_type', 'acquirer_ref', 'affected_rows',
    'rows_read', 'sample_rate', 'span_name', 'value_date', 'storage_loc',
    'winning_bid', 'clearance_fee', 'passes_go', 'linked_to', 'reported_by',
    'block_time', 'expires_in', 'hold_bags', 'exit_code', 'save_path',
  ])('does not invent a unit for %s', (key) => {
    expect(labelAndUnit(key).unit).toBeUndefined()
  })

  it('leaves real identifiers alone', () => {
    for (const key of [
      'http.status_code', 'db.statement', 'span.kind', 'x-forwarded-for',
      'X-DP-UUID', 'find(code)', 'window.__Deskpro.code',
    ]) {
      expect(labelAndUnit(key)).toEqual({ label: key })
    }
  })

  it('does not strip a unit when it is the whole name', () => {
    // "ms" alone is the field, not a unit qualifying something else.
    expect(labelAndUnit('ms')).toEqual({ label: 'Ms' })
    expect(labelAndUnit('amount')).toEqual({ label: 'Amount' })
  })
})

describe('packetBody', () => {
  it('reads an object as facts', () => {
    const body = packetBody({ drop_diameter_mm: 2.1, fall_speed_m_s: 6.5, event_total_mm: 18 })
    expect(body).toEqual({
      kind: 'facts',
      facts: [
        { label: 'Drop diameter', value: '2.1', unit: 'mm' },
        { label: 'Fall speed',    value: '6.5', unit: 'm/s' },
        { label: 'Event total',   value: '18',  unit: 'mm' },
      ],
    })
  })

  it('reads a string as prose', () => {
    expect(packetBody('2.1 mm drops falling at 6.5 m/s')).toEqual({
      kind: 'prose', text: '2.1 mm drops falling at 6.5 m/s',
    })
  })

  it('spells out booleans and nulls', () => {
    const body = packetBody({ approved: true, sampled: false, reason: null })
    expect(body.kind).toBe('facts')
    if (body.kind !== 'facts') return
    expect(body.facts.map((f) => f.value)).toEqual(['yes', 'no', '—'])
  })

  it('keeps a nested value as compact JSON, marked as such', () => {
    const body = packetBody({ table: 'Orders', item: { id: 'ord_9c1e', status: 'PENDING' } })
    if (body.kind !== 'facts') throw new Error('expected facts')
    expect(body.facts[0]).toEqual({ label: 'Table', value: 'Orders' })
    expect(body.facts[1]).toEqual({
      label: 'Item',
      value: '{"id":"ord_9c1e","status":"PENDING"}',
      nested: true,
    })
  })

  it('never puts a unit on a nested value', () => {
    const body = packetBody({ limit_mib: { soft: 1, hard: 2 } })
    if (body.kind !== 'facts') throw new Error('expected facts')
    expect(body.facts[0].unit).toBeUndefined()
    expect(body.facts[0].nested).toBe(true)
  })

  it('gives verbatim JSON when the author asks for it', () => {
    const body = packetBody({ mti: '0100', amount: '48.20' }, 'raw')
    expect(body.kind).toBe('raw')
    if (body.kind !== 'raw') return
    expect(body.json).toBe('{\n  "mti": "0100",\n  "amount": "48.20"\n}')
  })

  it('reports nothing to show for an absent or empty payload', () => {
    expect(packetBody(undefined).kind).toBe('empty')
    expect(packetBody(null).kind).toBe('empty')
    expect(packetBody({}).kind).toBe('empty')
    expect(packetBody('   ').kind).toBe('empty')
  })

  it('falls back to JSON for a top-level array', () => {
    expect(packetBody([1, 2]).kind).toBe('raw')
  })
})
