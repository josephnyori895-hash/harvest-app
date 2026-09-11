// Reusable UI Components for Enhanced Styling

export function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`card-spiritual rounded-2xl p-4 backdrop-blur-xl ${className}`}>
      {children}
    </div>
  )
}

export function PremiumButton({ children, onClick, disabled = false, variant = 'primary' }: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const variants = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost'
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${variants[variant]} disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  )
}

export function PremiumInput({
  placeholder,
  value,
  onChange,
  type = 'text',
  icon,
}: {
  placeholder?: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  type?: string
  icon?: React.ReactNode
}) {
  return (
    <div className="relative">
      {icon && <div className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-400">{icon}</div>}
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className={`input-premium ${icon ? 'pl-10' : ''}`}
      />
    </div>
  )
}

export function Badge({ children, variant = 'member' }: { children: React.ReactNode; variant?: 'admin' | 'leader' | 'member' | 'verified' | 'worship' }) {
  const variants = {
    admin: 'badge-admin',
    leader: 'badge-leader',
    member: 'badge-member',
    verified: 'badge-verified',
    worship: 'badge-worship'
  }
  return <span className={variants[variant]}>{children}</span>
}

export function LoadingSkeletons() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="skeleton-avatar" />
      <div className="space-y-2">
        <div className="skeleton-text w-3/4" />
        <div className="skeleton-text w-1/2" />
      </div>
    </div>
  )
}

export function HarvestGradient({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-gradient-church ${className}`}>
      {children}
    </div>
  )
}
