/**
 * Footer notes let authors emphasise a line ("**Slow step — 3,180 ms**").
 * The formatter handles only bold/italic/code, and must never emit raw markup.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { inlineMarkdown } from '@/utils/inlineMarkdown'

const html = (text: string) => renderToStaticMarkup(<>{inlineMarkdown(text)}</>)

describe('inlineMarkdown', () => {
  it('renders bold, italic and code', () => {
    expect(html('**Slow step — 3,180 ms**')).toBe('<strong>Slow step — 3,180 ms</strong>')
    expect(html('*18 channels*')).toBe('<em>18 channels</em>')
    expect(html('use `IN (...)`')).toBe('use <code>IN (...)</code>')
  })

  it('keeps surrounding plain text', () => {
    expect(html('a **b** c')).toBe('a <strong>b</strong> c')
  })

  it('leaves unmatched markers alone', () => {
    expect(html('2 * 3 = 6')).toBe('2 * 3 = 6')
    expect(html('**')).toBe('**')
  })

  it('escapes author-supplied HTML rather than rendering it', () => {
    expect(html('<img src=x onerror=alert(1)>')).not.toContain('<img')
  })
})
