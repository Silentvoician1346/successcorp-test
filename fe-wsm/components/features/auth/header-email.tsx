"use client";

import { useSyncExternalStore } from "react";
import { useAuthStore } from "@/stores/auth-store";

function usePersistHydrated() {
  return useSyncExternalStore(
    (onStoreChange) => {
      const unsubscribeHydrate = useAuthStore.persist.onHydrate(() => {
        onStoreChange();
      });
      const unsubscribeFinish = useAuthStore.persist.onFinishHydration(() => {
        onStoreChange();
      });

      return () => {
        unsubscribeHydrate();
        unsubscribeFinish();
      };
    },
    () => useAuthStore.persist.hasHydrated(),
    () => false,
  );
}

export default function HeaderEmail() {
  const email = useAuthStore((state) => state.email);
  const hydrated = usePersistHydrated();

  if (!hydrated) {
    return <div className="h-5 w-36 animate-pulse rounded bg-white/20" aria-hidden="true" />;
  }

  return (
    <p className="max-w-55 truncate text-sm font-semibold text-white" title={email ?? undefined}>
      {email ?? ""}
    </p>
  );
}
