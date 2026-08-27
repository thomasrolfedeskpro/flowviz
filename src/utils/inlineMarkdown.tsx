import type { ReactNode } from 'react'

/**
 * The smallest useful inline formatter: `**bold**`, `*italic*` and `` `code` ``.
 * Authors write emphasis in plain text and get it rendered — no block syntax,
 * no links, no HTML, so nothing author-supplied can inject markup.
 */
const TOKEN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g

export function inlineMarkdown(text: string, codeClass?: string): ReactNode[] {
  return text.split(TOKEN).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={i} className={codeClass}>{part.slice(1, -1)}</code>
    }
    return part
  })
}
