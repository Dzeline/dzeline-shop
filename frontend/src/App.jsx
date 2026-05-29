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
import { dbHelpers } from "./services/db";
import { syncService } from "./services/sync";
import { setApiKey } from "./utils/apiHeaders";
import { useRegisterSW } from "virtual:pwa-register/react";

// Pastel header gradients — index 0 is always Admin
const HEADER_THEMES = [
  "linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)",  // Admin    — violet → indigo
  "linear-gradient(135deg, #0d9488 0%, #0891b2 100%)",  // Cashier  — teal → cyan
  "linear-gradient(135deg, #e11d48 0%, #db2777 100%)",  // Cashier  — rose → pink
  "linear-gradient(135deg, #b45309 0%, #d97706 100%)",  // Cashier  — amber → orange
  "linear-gradient(135deg, #1d4ed8 0%, #0284c7 100%)",  // Cashier  — blue → sky
  "linear-gradient(135deg, #7e22ce 0%, #c026d3 100%)",  // Cashier  — purple → fuchsia
];

function getHeaderGradient(staff) {
  if (!staff || staff.role === "admin") return HEADER_THEMES[0];
  return HEADER_THEMES[((staff.id - 2) % (HEADER_THEMES.length - 1)) + 1];
}

function SidebarItem({ icon, label, onClick, danger = false }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium btn-press ${
        danger
          ? "text-red-400 hover:bg-red-500/10 active:bg-red-500/20"
          : "text-gray-300 hover:bg-gray-800 active:bg-gray-700"
      }`}
    >
      <span className={`shrink-0 ${danger ? "text-red-500" : "text-gray-500"}`}>{icon}</span>
      {label}
    </button>
  );
}

function SidebarSection({ title, children }) {
  return (
    <div className="px-3 pb-1">
      <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-1 mb-1">{title}</p>
      {children}
    </div>
  );
}

function StaffMenu({ staff, onManage, onStockReceive, onInventory, onSuppliers, onDailySummary, onHistory, onSettings, onEtims, onLogout }) {
  const [open, setOpen] = useState(false);
  const isAdmin = staff.role === "admin";

  const close = (fn) => () => { fn(); setOpen(false); };

  const icons = {
    staff:    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
    stock:    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" /></svg>,
    inventory:<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>,
    suppliers:<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
    summary:  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
    history:  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>,
    settings: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
    etims:    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
    logout:   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>,
  };

  return (
    <>
      {/* Trigger button */}
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

      {/* Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px] transition-opacity duration-300 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={() => setOpen(false)}
      />

      {/* Sidebar panel — dark theme, rounded left edge */}
      <div
        className={`fixed top-0 right-0 bottom-0 z-50 w-72 bg-gray-900 border-l border-gray-800 rounded-l-3xl shadow-2xl flex flex-col overflow-hidden transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-gray-800">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-base shrink-0">
            {staff.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-sm truncate">{staff.name}</p>
            <p className="text-xs text-gray-500">{isAdmin ? "Administrator ★" : "Cashier"}</p>
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

        {/* Scrollable sections */}
        <div className="flex-1 overflow-y-auto py-3 space-y-4">
          <SidebarSection title="Sales">
            <SidebarItem icon={icons.summary}  label="Daily Summary"       onClick={close(onDailySummary)} />
            <SidebarItem icon={icons.history}  label="Transaction History" onClick={close(onHistory)} />
          </SidebarSection>

          {isAdmin && (
            <SidebarSection title="Operations">
              <SidebarItem icon={icons.stock}     label="Stock Receiving"  onClick={close(onStockReceive)} />
              <SidebarItem icon={icons.inventory} label="Inventory"        onClick={close(onInventory)} />
              <SidebarItem icon={icons.suppliers} label="Suppliers"        onClick={close(onSuppliers)} />
              <SidebarItem icon={icons.staff}     label="Staff Management" onClick={close(onManage)} />
            </SidebarSection>
          )}

          {isAdmin && (
            <SidebarSection title="Setup">
              <SidebarItem icon={icons.settings} label="Shop Settings" onClick={close(onSettings)} />
              <SidebarItem icon={icons.etims}    label="eTIMS / KRA"   onClick={close(onEtims)} />
            </SidebarSection>
          )}
        </div>

        {/* Logout pinned at bottom */}
        <div className="px-3 py-3 border-t border-gray-800">
          <SidebarItem icon={icons.logout} label="Sign Out" onClick={close(onLogout)} danger />
        </div>
      </div>
    </>
  );
}


function UpdateBanner() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
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
  const [activeTab, setActiveTab] = useState("products");
  const [showStaffMgmt, setShowStaffMgmt] = useState(false);
  const [showStockReceiving, setShowStockReceiving] = useState(false);
  const [showDailySummary, setShowDailySummary] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [showSuppliers, setShowSuppliers] = useState(false);
  const [showEtims, setShowEtims] = useState(false);
  const [setupReady, setSetupReady] = useState(null); // null=checking, false=needs setup, true=done
  const isOnline = useOnline();

  const loadSettings = useSettingsStore((s) => s.load);
  const shopName = useSettingsStore((s) => s.shopName);

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

  const itemCount = useCartStore((state) => state.getItemCount());
  const currentStaff = useStaffStore((s) => s.currentStaff);
  const logout = useStaffStore((s) => s.logout);

  // Splash screen — shown while IndexedDB is checked on startup
  if (setupReady === null) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-3"
        style={{ background: "linear-gradient(160deg, #0f172a 0%, #1e1b4b 38%, #312e81 68%, #4338ca 100%)" }}
      >
        <div className="animate-fade-logo flex flex-col items-center gap-3">
          <div
            className="w-20 h-20 rounded-3xl flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, rgba(99,102,241,0.45), rgba(37,99,235,0.45))",
              boxShadow: "0 12px 48px rgba(99,102,241,0.4), inset 0 1px 0 rgba(255,255,255,0.15)",
            }}
          >
            <svg width="38" height="38" viewBox="0 0 48 46" fill="none">
              <path fill="white"
                d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"/>
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

  const isAdmin = currentStaff?.role === "admin";

  return (
    <div className="min-h-screen bg-gray-900">
      <UpdateBanner />
      {/* Header */}
      <header
        className="sticky-header text-white px-4 py-3"
        style={{ background: getHeaderGradient(currentStaff) }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight leading-tight">{shopName}</h1>
            <p className="text-white/50 text-xs">Point of Sale</p>
          </div>

          <div className="flex items-center gap-2">
            {/* Online/offline dot */}
            <div
              className={`w-2.5 h-2.5 rounded-full ring-2 ring-white/20 ${isOnline ? "bg-green-400" : "bg-red-400"}`}
              title={isOnline ? "Online" : "Offline"}
            />

            {/* Quick actions — visible in header */}
            {isAdmin && (
              <button
                onClick={() => setShowStockReceiving(true)}
                className="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition"
                title="Stock Receiving"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" />
                </svg>
              </button>
            )}
            <button
              onClick={() => setShowDailySummary(true)}
              className="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition"
              title="Daily Summary"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </button>

            <StaffMenu
              staff={currentStaff}
              onManage={() => setShowStaffMgmt(true)}
              onStockReceive={() => setShowStockReceiving(true)}
              onInventory={() => setShowInventory(true)}
              onSuppliers={() => setShowSuppliers(true)}
              onDailySummary={() => setShowDailySummary(true)}
              onHistory={() => setShowHistory(true)}
              onSettings={() => setShowSettings(true)}
              onEtims={() => setShowEtims(true)}
              onLogout={logout}
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pb-20">
        {activeTab === "products" && <ProductList />}
        {activeTab === "cart" && (
          <Cart onNewSale={() => setActiveTab("products")} />
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-gray-950/95 backdrop-blur-md border-t border-white/5 flex shadow-2xl pb-safe">
        {[
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
            badge: itemCount > 0 ? (itemCount > 99 ? "99+" : String(itemCount)) : null,
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5 6h13M7 13l-1-4m9 10a1 1 0 100 2 1 1 0 000-2zm-6 0a1 1 0 100 2 1 1 0 000-2z" />
              </svg>
            ),
          },
        ].map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex-1 py-3 flex flex-col items-center gap-1 relative transition-colors duration-150"
            >
              {/* Pill indicator */}
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 rounded-full bg-primary" />
              )}
              <div className={`relative transition-all duration-200 ${active ? "text-primary scale-110" : "text-gray-500"}`}>
                {tab.icon}
                {tab.badge && (
                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-4 h-4 flex items-center justify-center px-1 leading-none">
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className={`text-[11px] transition-all duration-200 ${active ? "font-bold text-primary" : "font-normal text-gray-500"}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Staff Management overlay */}
      {showStaffMgmt && (
        <StaffManagement
          currentStaffId={currentStaff.id}
          onClose={() => setShowStaffMgmt(false)}
        />
      )}

      {showStockReceiving && (
        <StockReceiving
          currentStaffId={currentStaff.id}
          onClose={() => setShowStockReceiving(false)}
        />
      )}

      {showDailySummary && (
        <DailySummary onClose={() => setShowDailySummary(false)} />
      )}

      {showHistory && (
        <TransactionHistory
          onClose={() => setShowHistory(false)}
          isAdmin={currentStaff?.role === "admin"}
        />
      )}

      {showSettings && (
        <SettingsScreen onClose={() => setShowSettings(false)} />
      )}

      {showInventory && (
        <InventoryScreen onClose={() => setShowInventory(false)} />
      )}

      {showSuppliers && (
        <SuppliersScreen onClose={() => setShowSuppliers(false)} />
      )}

      {showEtims && (
        <EtimsModal onClose={() => setShowEtims(false)} />
      )}
    </div>
  );
}

export default App;
