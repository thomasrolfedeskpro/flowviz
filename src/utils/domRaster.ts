/**
 * Drawing the live DOM onto a canvas, so an export can show the app rather than
 * only the 3D view.
 *
 * Browsers have no "rasterise this element" API. The one route that needs no
 * dependency is the one SVG already defines: a `<foreignObject>` holding XHTML
 * renders inside an `<img>`, and an `<img>` draws onto a 2D context.
 *
 * That SVG is its own document, so nothing the page links to travels with it.
 * The page's stylesheets are therefore copied in as text and the theme tokens
 * are resolved onto the wrapper, because the `:root` they sit on has no
 * counterpart inside the foreignObject. No external resource is ever fetched —
 * affordable here only because the app uses system fonts and inline SVG icons.
 */

const XHTML = 'http://www.w3.org/1999/xhtml'
const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * An SVG image never runs its animations: it rasterises at time zero, which is
 * where a fade-in is still invisible. A still wants the resting state, so every
 * animation and transition is switched off rather than caught mid-entrance.
 */
const FREEZE = '*,*::before,*::after{animation:none !important;transition:none !important}'

/** Every rule the page applies, as one stylesheet the clone can carry. */
function collectCss(): string {
  const out: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      // A cross-origin sheet won't hand over its rules. Nothing here is served
      // from elsewhere, so this is a guard rather than a code path.
      continue
    }
    for (const rule of Array.from(rules)) out.push(rule.cssText)
  }
  out.push(FREEZE)
  return out.join('\n')
}

/** Theme tokens live on `<html>`, which the clone does not have. */
function themeTokens(): string {
  const style = getComputedStyle(document.documentElement)
  const decls: string[] = []
  for (const name of Array.from(style)) {
    if (name.startsWith('--')) decls.push(`${name}:${style.getPropertyValue(name)}`)
  }
  return decls.join(';')
}

/** `cloneNode` copies markup, not state, and these three live only in state. */
function copyFieldValue(source: Element, clone: Element): void {
  if (source instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
    clone.setAttribute('value', source.value)
    if (source.checked) clone.setAttribute('checked', '')
  } else if (source instanceof HTMLTextAreaElement) {
    clone.textContent = source.value
  } else if (source instanceof HTMLSelectElement && clone instanceof HTMLSelectElement) {
    for (let i = 0; i < clone.options.length; i++) {
      if (i === source.selectedIndex) clone.options[i].setAttribute('selected', '')
      else clone.options[i].removeAttribute('selected')
    }
  }
}

/** A cloned scroll container starts at the top, so shift its contents instead. */
function copyScroll(source: Element, clone: Element): void {
  if (!source.scrollTop && !source.scrollLeft) return
  const first = clone.firstElementChild
  if (!(first instanceof HTMLElement)) return
  const own = getComputedStyle(source.firstElementChild!)
  first.style.marginTop  = `${parseFloat(own.marginTop) - source.scrollTop}px`
  first.style.marginLeft = `${parseFloat(own.marginLeft) - source.scrollLeft}px`
}

/**
 * Walk both trees together, fixing up what `cloneNode` cannot carry.
 *
 * Returns the clone of `canvas`, whose ancestors then have to stop painting a
 * background: the WebGL frame is drawn underneath this layer, and `#root` is
 * opaque.
 */
function reconcile(
  source: Element,
  clone:  Element,
  canvas: Element,
  omit:   Set<Element>,
  drop:   Element[],
): Element | null {
  // Collected rather than removed here: the walk pairs the two trees by child
  // index, and removing a node mid-walk would shift its siblings out of step.
  if (omit.has(source)) {
    drop.push(clone)
    return null
  }
  let found: Element | null = source === canvas ? clone : null
  copyFieldValue(source, clone)
  copyScroll(source, clone)
  const kids = source.children
  for (let i = 0; i < kids.length; i++) {
    const hit = reconcile(kids[i], clone.children[i], canvas, omit, drop)
    if (hit) found = hit
  }
  return found
}

/**
 * The page as it looks right now, as an image ready to draw onto a canvas.
 *
 * `deviceWidth`/`deviceHeight` set the bitmap the SVG rasterises into, while
 * the viewBox stays in CSS pixels — so text is drawn at export resolution
 * rather than scaled up from screen resolution afterwards.
 */
export function rasterizeViewport(
  canvas: HTMLCanvasElement,
  deviceWidth: number,
  deviceHeight: number,
  /** Live elements to leave out of the capture, with their subtrees. */
  omit: Iterable<Element> = [],
): Promise<HTMLImageElement> {
  const root = document.getElementById('root')
  if (!root) throw new Error('Nothing on screen to capture')

  const width  = window.innerWidth
  const height = window.innerHeight

  const clone = root.cloneNode(true) as Element
  const drop: Element[] = []
  // Anything opaque above the canvas would hide the WebGL frame under it.
  for (
    let el = reconcile(root, clone, canvas, new Set(omit), drop);
    el;
    el = el.parentElement
  ) {
    if (el instanceof HTMLElement) el.style.background = 'transparent'
  }
  for (const el of drop) el.remove()

  const wrapper = document.createElementNS(XHTML, 'div')
  wrapper.setAttribute('style', `${themeTokens()};width:${width}px;height:${height}px;position:relative`)
  const style = document.createElementNS(XHTML, 'style')
  style.textContent = collectCss()
  wrapper.append(style, clone)

  const fo = document.createElementNS(SVG_NS, 'foreignObject')
  fo.setAttribute('x', '0')
  fo.setAttribute('y', '0')
  fo.setAttribute('width', String(width))
  fo.setAttribute('height', String(height))
  fo.appendChild(wrapper)

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('xmlns', SVG_NS)
  svg.setAttribute('width', String(deviceWidth))
  svg.setAttribute('height', String(deviceHeight))
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.appendChild(fo)

  // The SVG is parsed as XML, so the markup has to be serialised as XML too —
  // unclosed tags and bare ampersands are fatal there, not forgiving as in HTML.
  const markup = new XMLSerializer().serializeToString(svg)
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not render the page layer'))
    img.src = url
  })
}
