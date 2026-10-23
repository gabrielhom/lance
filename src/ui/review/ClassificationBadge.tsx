import { BookOpen, Check, Star, ThumbsUp, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { Classification } from '../../domain/types'
import { CLASSIFICATION_LABEL } from '../labels'

type Glyph = { text: string } | { icon: typeof Star }
const GLYPH: Readonly<Record<Classification, Glyph>> = {
  brilliant: { text: '!!' },
  great: { text: '!' },
  best: { icon: Star },
  excellent: { icon: ThumbsUp },
  good: { icon: Check },
  book: { icon: BookOpen },
  inaccuracy: { text: '?!' },
  mistake: { text: '?' },
  blunder: { text: '??' },
  miss: { icon: X },
}
/** Yellow and orange badges take dark glyphs so the glyph stays legible. */
const DARK_GLYPH: ReadonlySet<Classification> = new Set(['inaccuracy', 'mistake'])

export function ClassificationBadge({ kind, size = 20, labelled = false, style }: { kind: Classification; size?: number; labelled?: boolean; style?: CSSProperties }) {
  const g = GLYPH[kind]
  const fg = DARK_GLYPH.has(kind) ? '#1b1b1f' : '#ffffff'
  return (
    <span
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? CLASSIFICATION_LABEL[kind] : undefined}
      aria-hidden={labelled ? undefined : true}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: `var(--badge-${kind})`,
        color: fg,
        fontWeight: 800,
        fontSize: size * 0.56,
        lineHeight: 1,
        letterSpacing: '-0.04em',
        flex: 'none',
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        ...style,
      }}
    >
      {'text' in g ? g.text : <g.icon size={size * 0.62} strokeWidth={3} aria-hidden />}
    </span>
  )
}
