import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useNavStore } from "./navStore";

export const useStaffStore = create(
  persist(
    (set) => ({
      currentStaff: null,
      setStaff: (staff) => set({ currentStaff: staff }),
      logout: () => {
        useNavStore.getState().navigate("products");
        set({ currentStaff: null });
      },
    }),
    {
      name: "dzeline-staff-session",
      version: 1,
    }
  )
);
