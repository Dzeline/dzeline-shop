/**
 * Desktop navigation rail (>= lg). The bottom tab bar in App.jsx stays the
 * navigation below that width — both render the same `tabs` array, so a tab
 * added or permission-gated in one place appears correctly in both.
 */
function SideNavItem({ label, icon, active, badge, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors duration-150 btn-press ${
        active
          ? "bg-primary/15 text-primary font-bold"
          : "text-gray-400 hover:text-gray-200 hover:bg-white/5 font-medium"
      }`}
    >
      <span className="relative shrink-0">
        {icon}
        {badge ? (
          <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-4 h-4 flex items-center justify-center px-1 leading-none">
            {badge > 99 ? "99+" : String(badge)}
          </span>
        ) : null}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export default function SideNav({ tabs, panel, onNavigate, shopName, isOnline }) {
  return (
    <nav className="hidden lg:flex flex-col w-60 shrink-0 bg-gray-950 border-r border-white/5">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/5">
        <img
          src="/Dzeline.svg"
          alt=""
          className="w-9 h-9 rounded-xl object-cover shrink-0"
        />
        <div className="min-w-0">
          <p className="font-bold text-white text-sm truncate leading-tight">
            {shopName || "Dzeline Shop"}
          </p>
          <p className="text-[11px] text-gray-400 leading-tight mt-0.5">Point of Sale</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {tabs.map((tab) => (
          <SideNavItem
            key={tab.id}
            label={tab.label}
            icon={tab.icon}
            active={panel === tab.id}
            badge={tab.badge}
            onClick={() => onNavigate(tab.id)}
          />
        ))}
      </div>

      {/* Connection state — the header dot is small and easy to miss on a
          large screen, where this rail is always visible anyway. */}
      <div className="px-5 py-4 border-t border-white/5 flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? "bg-green-400" : "bg-red-400"}`}
        />
        <span className="text-[11px] font-medium text-gray-400">
          {isOnline ? "Online" : "Offline — saving locally"}
        </span>
      </div>
    </nav>
  );
}
