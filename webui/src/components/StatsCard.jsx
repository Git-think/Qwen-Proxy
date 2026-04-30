export default function StatsCard({ title, value, icon, color = 'accent' }) {
  const colorMap = {
    accent: 'from-accent-primary/20 to-accent-secondary/20 border-accent-primary/20 text-accent-glow',
    emerald: 'from-emerald-500/20 to-emerald-600/20 border-emerald-500/20 text-emerald-400',
    amber: 'from-amber-500/20 to-amber-600/20 border-amber-500/20 text-amber-400',
    red: 'from-red-500/20 to-red-600/20 border-red-500/20 text-red-400',
  }

  const iconColorMap = {
    accent: 'text-accent-glow',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
  }

  return (
    <div className={`glass-card p-5 bg-gradient-to-br ${colorMap[color]} hover:scale-[1.02] transition-all duration-200`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{title}</p>
          <p className="mt-2 text-3xl font-bold font-display">{value}</p>
        </div>
        <div className={`p-3 rounded-xl bg-white/[0.05] ${iconColorMap[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}
