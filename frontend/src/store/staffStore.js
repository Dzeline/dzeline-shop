import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useStaffStore = create(
  persist(
    (set) => ({
      currentStaff: null,
      setStaff: (staff) => set({ currentStaff: staff }),
      logout: () => set({ currentStaff: null }),
    }),
    {
      name: "dzeline-staff-session",
      version: 1,
    }
  )
);
