import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

function relativeTime(from: Date, to: Date) {
  const seconds = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000))
  if (seconds < 60) return `${seconds} sec ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

export default function BuildBadge() {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const builtAt = new Date(__BUILD_INFO__.builtAt)

  // Tick every second while the tooltip is open so "3 sec ago" stays live.
  useEffect(() => {
    if (!open) return
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [open])

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <span className="cursor-default font-mono text-[10px] leading-none text-muted-foreground">
          v{__BUILD_INFO__.version}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start">
        <p>Deployed {relativeTime(builtAt, now)}</p>
        <p className="text-muted-foreground">
          {__BUILD_INFO__.sha} ·{' '}
          {builtAt.toLocaleString(navigator.language, { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}
