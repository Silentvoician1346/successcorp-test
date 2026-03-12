"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type SyncOrdersResponse = {
  message?: string | string[];
  summary?: {
    fetched?: number;
    created?: number;
    updated?: number;
    skipped?: number;
  } | null;
};

function resolveMessage(message: string | string[] | undefined, fallback: string) {
  if (!message) return fallback;
  if (Array.isArray(message)) return message.join(", ");
  return message;
}

async function syncOrders() {
  const response = await fetch("/api/orders", {
    method: "POST",
    cache: "no-store",
  });

  let payload: SyncOrdersResponse | null = null;
  try {
    payload = (await response.json()) as SyncOrdersResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    console.error("[sync] Failed response", {
      status: response.status,
      payload,
    });
    throw new Error(resolveMessage(payload?.message, "Failed to sync orders."));
  }

  return payload;
}

export default function SyncOrdersButton() {
  const queryClient = useQueryClient();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const { mutate, isPending } = useMutation({
    mutationFn: syncOrders,
    onSuccess: (payload) => {
      toast.success(resolveMessage(payload?.message, "Orders synchronized."), {
        position: "top-center",
      });
      setIsConfirmOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to sync orders.";
      console.error("[sync] Mutation error", error);
      toast.error(message);
    },
  });

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="text-white hover:bg-white/15 hover:text-white"
        aria-label="Sync orders"
        onClick={() => setIsConfirmOpen(true)}
        disabled={isPending}
      >
        <RefreshCw aria-hidden="true" className={`h-5 w-5 ${isPending ? "animate-spin" : ""}`} />
      </Button>
      {isConfirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!isPending) {
              setIsConfirmOpen(false);
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-xl bg-background p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-foreground">Confirm Sync</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Are you sure you want to sync WMS database with Marketplace database?
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="destructive"
                onClick={() => setIsConfirmOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="button" onClick={() => mutate()} disabled={isPending}>
                {isPending ? "Syncing..." : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
