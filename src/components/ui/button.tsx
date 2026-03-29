import * as React from 'react'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'destructive' | 'ghost' | 'primary'
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'default', asChild, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none'

    const variants = {
      default: '!bg-violet-600 !text-white hover:!bg-violet-700 focus:ring-violet-500',
      primary: '!bg-violet-600 !text-white hover:!bg-violet-700 focus:ring-violet-500',
      outline: '!border !border-zinc-300 !bg-white hover:!bg-zinc-100 !text-zinc-900 focus:ring-zinc-500',
      destructive: '!bg-red-600 !text-white hover:!bg-red-700 focus:ring-red-500',
      ghost: 'hover:!bg-zinc-100 !text-zinc-900 focus:ring-zinc-500',
    }

    const classes = `${baseStyles} ${variants[variant]} ${className}`

    if (asChild && React.isValidElement(props.children)) {
      return React.cloneElement(props.children as React.ReactElement<{ className?: string; ref?: React.Ref<unknown> }>, {
        className: `${classes} ${(props.children as React.ReactElement<{ className?: string }>).props.className || ''}`.trim(),
        ref,
      })
    }

    return (
      <button
        ref={ref}
        className={classes}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button }
