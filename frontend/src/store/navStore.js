import { create } from "zustand";

const DEFAULT_SUB = {
  stock: "inventory",
  reports: "summary",
  settings: "shop",
};

export const useNavStore = create((set) => ({
  panel: "products",
  sub: null,
  navigate(panel, sub) {
    set({ panel, sub: sub ?? DEFAULT_SUB[panel] ?? null });
  },
  navigateSub(sub) {
    set({ sub });
  },
}));
