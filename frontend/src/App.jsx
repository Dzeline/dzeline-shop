import { useState, useEffect } from "react";
import ProductList from "./components/ProductList";
import Cart from "./components/Cart";
import PinLogin from "./components/PinLogin";
import SetupWizard from "./components/SetupWizard";
import SettingsScreen from "./components/SettingsScreen";
import StaffManagement from "./components/StaffManagement";
import StockReceiving from "./components/StockReceiving";
import DailySummary from "./components/DailySummary";
import TransactionHistory from "./components/TransactionHistory";
import InventoryScreen from "./components/InventoryScreen";
import SuppliersScreen from "./components/SuppliersScreen";
import EtimsModal from "./components/EtimsModal";
import { useOnline } from "./utils/useOnline";
import { useCartStore } from "./store/cartStore";
import { useStaffStore } from "./store/staffStore";
import { useSettingsStore } from "./store/settingsStore";
import { useNavStore } from "./store/navStore";
import { usePermissions } from "./hooks/usePermissions";
import { FEATURES, ROLE_LABELS } from "./utils/permissions";
import { dbHelpers } from "./services/db";
import { syncService } from "./services/sync";
import { setApiKey } from "./utils/apiHeaders";
import { useRegisterSW } from "virtual:pwa-register/react";

const HEADER_THEMES = [
  "linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)",
  "linear-gradient(135deg, #0d9488 0%, #0891b2 100%)",
  "linear-gradient(135deg, #e11d48 0%, #db2777 100%)",
  "linear-gradient(135deg, #b45309 0%, #d97706 100%)",
  "linear-gradient(135deg, #1d4ed8 0%, #0284c7 100%)",
  "linear-gradient(135deg, #7e22ce 0%, #c026d3 100%)",
];

function getHeaderGradient(staff) {
  if (!staff || staff.role === "admin") return HEADER_THEMES[0];
  return HEADER_THEMES[((staff.id - 2) % (HEADER_THEMES.length - 1)) + 1];
}

const PANEL_TITLES = {
  products: "Products",
  cart: "Cart",
  stock: { inventory: "Inventory", receiving: "Stock Receiving", suppliers: "Suppliers" },
  reports: { summary: "Daily Summary", history: "Transactions" },
  settings: { shop: "Shop Settings", staff: "Staff", etims: "eTIMS / KRA" },
};

function getPanelTitle(panel, sub) {
  const t = PANEL_TITLES[panel];
  if (!t) return "";
  if (typeof t === "string") return t;
  return t[sub] ?? "";
}

function SubTabBar({ options, labels, active, onChange }) {
  return (
    <div className="bg-gray-900 border-b border-gray-800 px-4 py-2 shrink-0">
      <div className="flex gap-1 bg-gray-800 p-1 rounded-xl">
        {options.map((opt, i) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all btn-press ${
              active === opt
                ? "bg-white text-primary shadow-sm"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {labels[i]}
          </button>
        ))}
      </div>
    </div>
  );
}

function StockPanel({ sub, navigateSub, currentStaffId }) {
  return (
    <div className="flex flex-col h-full">
      <SubTabBar
        options={["inventory", "receiving", "suppliers"]}
        labels={["Inventory", "Receiving", "Suppliers"]}
        active={sub}
        onChange={navigateSub}
      />
      <div className="flex-1 min-h-0">
        {sub === "inventory" && <InventoryScreen />}
        {sub === "receiving" && <StockReceiving currentStaffId={currentStaffId} onClose={() => navigateSub("inventory")} />}
        {sub === "suppliers" && <SuppliersScreen />}
      </div>
    </div>
  );
}

function ReportsPanel({ sub, navigateSub }) {
  const { can } = usePermissions();
  return (
    <div className="flex flex-col h-full">
      <SubTabBar
        options={["summary", "history"]}
        labels={["Summary", "History"]}
        active={sub}
        onChange={navigateSub}
      />
      <div className="flex-1 min-h-0">
        {sub === "summary" && <DailySummary />}
        {sub === "history" && <TransactionHistory canVoid={can(FEATURES.VOID_SALES)} />}
      </div>
    </div>
  );
}

function SettingsPanel({ sub, navigateSub, currentStaffId }) {
  const { can } = usePermissions();

  const availableSubs = [
    can(FEATURES.SETTINGS) && { id: "shop",  label: "Shop" },
    can(FEATURES.SETTINGS) && { id: "staff", label: "Staff" },
    can(FEATURES.ETIMS)    && { id: "etims", label: "eTIMS" },
  ].filter(Boolean);

  // If the current sub isn't accessible, redirect to first allowed one
  const activeSub = availableSubs.find((t) => t.id === sub)
    ? sub
    : availableSubs[0]?.id ?? "shop";

  return (
    <div className="flex flex-col h-full">
      {availableSubs.length > 1 && (
        <SubTabBar
          options={availableSubs.map((t) => t.id)}
          labels={availableSubs.map((t) => t.label)}
          active={activeSub}
          onChange={navigateSub}
        />
      )}
      <div className="flex-1 min-h-0">
        {activeSub === "shop"  && can(FEATURES.SETTINGS) && <SettingsScreen />}
        {activeSub === "staff" && can(FEATURES.SETTINGS) && <StaffManagement currentStaffId={currentStaffId} />}
        {activeSub === "etims" && can(FEATURES.ETIMS)    && <EtimsModal />}
      </div>
    </div>
  );
}

function StaffPill({ staff, onLogout }) {
  const [open, setOpen] = useState(false);
  const isAdmin = staff.role === "admin";
  const roleLabel = ROLE_LABELS[staff.role] ?? "Staff";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 bg-white/10 hover:bg-white/20 active:bg-white/30 rounded-full pl-2 pr-3 py-1.5 transition-all duration-150 active:scale-95"
      >
        <div className="w-6 h-6 rounded-full bg-white/30 flex items-center justify-center text-xs font-bold">
          {staff.name.charAt(0).toUpperCase()}
        </div>
        <span className="text-xs font-semibold max-w-20 truncate">{staff.name}</span>
        {isAdmin && <span className="text-yellow-300 text-xs">★</span>}
      </button>

      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px] transition-opacity duration-300 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={() => setOpen(false)}
      />

      <div
        className={`fixed top-0 right-0 bottom-0 z-50 w-64 bg-gray-900 border-l border-gray-800 rounded-l-3xl shadow-2xl flex flex-col overflow-hidden transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center gap-3 px-4 py-5 border-b border-gray-800">
          <div className="w-10 h-10 rounded-2xl bg-linear-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-base shrink-0">
            {staff.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-sm truncate">{staff.name}</p>
            <p className="text-xs text-gray-500">{roleLabel}{isAdmin ? " ★" : ""}</p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-800 text-gray-500 transition btn-press shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1" />

        <div className="px-3 py-4 border-t border-gray-800">
          <button
            onClick={() => { setOpen(false); onLogout(); }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium text-red-400 hover:bg-red-500/10 active:bg-red-500/20 btn-press"
          >
            <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
}

function NavTab({ label, icon, active, badge, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 py-3 flex flex-col items-center gap-1 relative transition-colors duration-150"
    >
      {active && (
        <span className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 rounded-full bg-primary" />
      )}
      <div className={`relative transition-all duration-200 ${active ? "text-primary scale-110" : "text-gray-500"}`}>
        {icon}
        {badge ? (
          <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-4 h-4 flex items-center justify-center px-1 leading-none">
            {badge > 99 ? "99+" : String(badge)}
          </span>
        ) : null}
      </div>
      <span className={`text-[11px] transition-all duration-200 ${active ? "font-bold text-primary" : "font-normal text-gray-500"}`}>
        {label}
      </span>
    </button>
  );
}

function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="fixed top-0 inset-x-0 z-80 flex items-center justify-between gap-3 bg-indigo-600 text-white text-sm font-medium px-4 py-2.5 shadow-lg">
      <span>App update available</span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="shrink-0 bg-white text-indigo-700 font-bold text-xs px-3 py-1.5 rounded-lg hover:bg-indigo-50 active:scale-95 transition"
      >
        Refresh now
      </button>
    </div>
  );
}

function App() {
  const [setupReady, setSetupReady] = useState(null);
  const isOnline = useOnline();
  const loadSettings = useSettingsStore((s) => s.load);
  const shopName = useSettingsStore((s) => s.shopName);
  const itemCount = useCartStore((state) => state.getItemCount());
  const currentStaff = useStaffStore((s) => s.currentStaff);
  const logout = useStaffStore((s) => s.logout);
  const { panel, sub, navigate, navigateSub } = useNavStore();
  const { can } = usePermissions();

  useEffect(() => {
    dbHelpers.isSetupComplete().then(async (done) => {
      setSetupReady(done);
      if (done) {
        loadSettings();
        const key = await dbHelpers.getApiKey();
        if (key) setApiKey(key);
      }
    });
  }, [loadSettings]);

  useEffect(() => {
    if (isOnline) {
      syncService.pushUnsynced().catch(() => {});
      syncService.resumePendingStkChecks().catch(() => {});
      syncService.reconcileSmsVerifications().catch(() => {});
    }
  }, [isOnline]);

  if (setupReady === null) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-3"
        style={{
          background:
            "linear-gradient(160deg, #0f172a 0%, #1e1b4b 38%, #312e81 68%, #4338ca 100%)",
        }}
      >
        <div className="animate-fade-logo flex flex-col items-center gap-3">
          <div
            className="w-20 h-20 rounded-3xl flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, rgba(99,102,241,0.45), rgba(37,99,235,0.45))",
              boxShadow:
                "0 12px 48px rgba(99,102,241,0.4), inset 0 1px 0 rgba(255,255,255,0.15)",
            }}
          >
            <svg width="38" height="38" viewBox="0 0 48 46" fill="none">
              <path
                fill="white"
                d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"
              />
            </svg>
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Dzeline</h1>
            <p className="text-white/45 text-sm mt-0.5">Point of Sale</p>
          </div>
        </div>
        <div className="flex gap-1.5 mt-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!setupReady) {
    return (
      <SetupWizard
        onComplete={() => {
          setSetupReady(true);
          loadSettings();
        }}
      />
    );
  }

  if (!currentStaff) {
    return <PinLogin />;
  }

  const panelTitle = getPanelTitle(panel, sub);

  const tabs = [
    {
      id: "products",
      label: "Products",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      ),
    },
    {
      id: "cart",
      label: "Cart",
      badge: itemCount > 0 ? itemCount : null,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5 6h13M7 13l-1-4m9 10a1 1 0 100 2 1 1 0 000-2zm-6 0a1 1 0 100 2 1 1 0 000-2z" />
        </svg>
      ),
    },
    ...(can(FEATURES.STOCK)
      ? [
          {
            id: "stock",
            label: "Stock",
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" />
              </svg>
            ),
          },
        ]
      : []),
    ...(can(FEATURES.REPORTS)
      ? [
          {
            id: "reports",
            label: "Reports",
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            ),
          },
        ]
      : []),
    ...((can(FEATURES.SETTINGS) || can(FEATURES.ETIMS))
      ? [
          {
            id: "settings",
            label: "Settings",
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="h-screen flex flex-col bg-gray-900 overflow-hidden">
      <UpdateBanner />

      {/* Header */}
      <header
        className="sticky-header shrink-0 text-white px-4 py-3"
        style={{ background: getHeaderGradient(currentStaff) }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight leading-tight">{shopName}</h1>
            {panelTitle && (
              <p className="text-white/50 text-xs">{panelTitle}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`w-2.5 h-2.5 rounded-full ring-2 ring-white/20 ${isOnline ? "bg-green-400" : "bg-red-400"}`}
              title={isOnline ? "Online" : "Offline"}
            />
            <StaffPill staff={currentStaff} onLogout={logout} />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {panel === "products" && (
          <div className="h-full overflow-y-auto">
            <ProductList />
          </div>
        )}
        {panel === "cart" && (
          <div className="h-full overflow-y-auto">
            <Cart onNewSale={() => navigate("products")} />
          </div>
        )}
        {panel === "stock" && can(FEATURES.STOCK) && (
          <StockPanel sub={sub} navigateSub={navigateSub} currentStaffId={currentStaff.id} />
        )}
        {panel === "reports" && can(FEATURES.REPORTS) && (
          <ReportsPanel sub={sub} navigateSub={navigateSub} />
        )}
        {(panel === "settings") && (can(FEATURES.SETTINGS) || can(FEATURES.ETIMS)) && (
          <SettingsPanel sub={sub} navigateSub={navigateSub} currentStaffId={currentStaff.id} />
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="shrink-0 bg-gray-950/95 backdrop-blur-md border-t border-white/5 flex shadow-2xl pb-safe">
        {tabs.map((tab) => (
          <NavTab
            key={tab.id}
            label={tab.label}
            icon={tab.icon}
            active={panel === tab.id}
            badge={tab.badge}
            onClick={() => navigate(tab.id)}
          />
        ))}
      </nav>
    </div>
  );
}

export default App;
