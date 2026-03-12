import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type AuthState = {
  email: string | null;
  setEmail: (email: string) => void;
  clearEmail: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      email: null,
      setEmail: (email) => set({ email }),
      clearEmail: () => set({ email: null }),
    }),
    {
      name: "wms-auth-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ email: state.email }),
    },
  ),
);
