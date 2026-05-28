import { create } from "zustand";
import { dbHelpers } from "../services/db";

export const useSettingsStore = create((set, get) => ({
  loaded: false,
  shopName: "Dzeline Shop",
  town: "",
  phone: "",
  kraPin: "",
  kraRegistered: false,
  vatEnabled: true,
  vatRate: 0.16,
  mpesaTill: "",
  pochiNumber: "",
  currency: "KES",
  apiKey: "",

  async load() {
    if (get().loaded) return;
    const [s, apiKey] = await Promise.all([
      dbHelpers.getShopSettings(),
      dbHelpers.getApiKey(),
    ]);
    set({
      loaded: true,
      shopName:      s.shop_name    || "Dzeline Shop",
      town:          s.town         || "",
      phone:         s.phone        || "",
      kraPin:        s.kra_pin && s.kra_pin !== "NOT_REGISTERED" ? s.kra_pin : "",
      kraRegistered: !!s.kra_pin && s.kra_pin !== "NOT_REGISTERED",
      vatEnabled:    s.vat_enabled  !== "false",
      vatRate:       parseFloat(s.vat_rate) || 0.16,
      mpesaTill:     s.mpesa_till   || "",
      pochiNumber:   s.pochi_number || "",
      currency:      s.currency     || "KES",
      apiKey:        apiKey         || "",
    });
  },

  async reload() {
    set({ loaded: false });
    await get().load();
  },
}));
