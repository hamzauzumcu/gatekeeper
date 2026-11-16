import { resolveEmoji, type CustomEmoji } from '@/lib/presence'
import { cn } from '@/lib/utils'

// A Slack status emoji: the character for standard emoji, the workspace image
// for custom ones, and the raw :shortcode: when neither is known (e.g. before
// the emoji:read scope is granted).
export default function SlackEmoji({
  code,
  custom,
  className,
}: {
  code: string | null
  custom?: CustomEmoji
  className?: string
}) {
  if (!code) return null
  const e = resolveEmoji(code, custom)
  if (!e) return <span className={cn('text-muted-foreground', className)}>{code}</span>
  if ('url' in e) {
    return (
      <img
        src={e.url}
        alt={code}
        title={code}
        className={cn('inline-block size-[1.15em] shrink-0 align-[-0.2em] object-contain', className)}
      />
    )
  }
  return (
    <span className={className} title={code}>
      {e.char}
    </span>
  )
}
