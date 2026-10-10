import * as LabelPrimitive from '@radix-ui/react-label'
import type * as React from 'react'
import { cn } from '#/lib/utils'

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'block text-[13px] font-semibold text-slate-700 dark:text-slate-200',
        className,
      )}
      {...props}
    />
  )
}
