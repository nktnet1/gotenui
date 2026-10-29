// biome-ignore-all lint/a11y/useSemanticElements: The focusable wrapper cannot be a native button because it contains a disabled native button.
import type { ReactElement, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip'
import { cn } from '#/lib/utils'

/** Keep explanations accessible when the actual button is disabled. */
export function ButtonTooltip({
  children,
  description,
  disabled = false,
  wrapperClassName,
}: {
  children?: ReactElement
  description?: ReactNode
  disabled?: boolean
  wrapperClassName?: string
}) {
  if (!description || !children) return children ?? null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? (
          <span
            role="button"
            aria-disabled="true"
            aria-label={typeof description === 'string' ? description : undefined}
            tabIndex={0}
            className={cn(
              'inline-flex cursor-not-allowed rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
              wrapperClassName,
            )}
          >
            {children}
          </span>
        ) : (
          children
        )}
      </TooltipTrigger>
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  )
}
