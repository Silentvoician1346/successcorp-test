"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

type MarketplaceOrder = {
  order_sn: string;
  shop_id: string;
  status: string;
  shipping_status: string;
  total_amount: number;
};

type MarketplaceOrderListResponse = {
  message?: string | string[];
  data?: MarketplaceOrder[];
};

function resolveMessage(message: string | string[] | undefined, fallback: string) {
  if (!message) return fallback;
  if (Array.isArray(message)) return message.join(", ");
  return message;
}

async function fetchMarketplaceOrders() {
  const response = await fetch("/api/marketplace/orders", { cache: "no-store" });

  let payload: MarketplaceOrderListResponse | null = null;
  try {
    payload = (await response.json()) as MarketplaceOrderListResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(resolveMessage(payload?.message, "Unable to fetch marketplace order list."));
  }

  return payload?.data ?? [];
}

export default function OrdersList() {
  const {
    data: orders = [],
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["marketplace-orders"],
    queryFn: fetchMarketplaceOrders,
  });

  useEffect(() => {
    if (!isLoading && !isError) {
      console.log("Marketplace order list:", orders);
    }
  }, [orders, isLoading, isError]);

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Marketplace Order Fetch</p>
          <p className="text-sm text-muted-foreground">
            Fetches `GET /order/list` from marketplace API and logs response in browser console.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="w-full md:w-auto"
        >
          {isFetching ? "Fetching..." : "Refetch"}
        </Button>
      </div>

      <div className="mt-4">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading marketplace orders...</p> : null}
        {isError ? (
          <p className="text-sm text-destructive">
            {(error as Error)?.message ?? "Failed to fetch marketplace orders."}
          </p>
        ) : null}
        {!isLoading && !isError ? (
          <p className="text-sm text-muted-foreground">
            Fetched {orders.length} orders. Open DevTools Console to inspect full payload.
          </p>
        ) : null}
      </div>
    </section>
  );
}
