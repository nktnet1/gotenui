import type * as React from 'react'
import { cn } from '../../lib/utils'

export function Card({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      data-slot="card"
      className={cn(
        'rounded-2xl border border-slate-200/80 bg-white shadow-[0_6px_40px_rgba(15,23,42,.035)]',
        className,
      )}
      {...props}
    />
  )
}
export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn('border-b border-slate-100 px-6 py-5', className)}
      {...props}
    />
  )
}
export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('p-6', className)} {...props} />
}
