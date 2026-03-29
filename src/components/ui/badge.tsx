import * as React from 'react'

const Badge = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & {}>(
  ({ className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
      {...props}
    />
  ),
)
Badge.displayName = 'Badge'

export { Badge }
