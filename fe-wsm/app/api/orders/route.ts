import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth";

type BackendOrder = {
  order_sn: string;
  wms_status: string;
  marketplace_status: string | null;
  shipping_status: string | null;
  tracking_number: string | null;
  updated_at: string;
};

type BackendOrderItem = {
  sku: string;
  quantity: number;
  price: number;
};

type BackendOrderDetail = {
  order_sn: string;
  marketplace_status: string | null;
  shipping_status: string | null;
  wms_status: string;
  tracking_number: string | null;
  total_amount: number;
  created_at: string;
  updated_at: string;
  items: BackendOrderItem[];
};

type BackendSyncResponse = {
  message?: string | string[];
  summary?: {
    fetched?: number;
    created?: number;
    updated?: number;
    skipped?: number;
  };
};

type BackendOrdersResponse = {
  orders?: BackendOrder[];
  pagination?: {
    page?: number;
    page_size?: number;
    total?: number;
    total_pages?: number;
  };
  message?: string | string[];
};

type BackendOrderDetailResponse = {
  order?: BackendOrderDetail;
  message?: string | string[];
};

function resolveMessage(message: string | string[] | undefined, fallback: string) {
  if (!message) return fallback;
  if (Array.isArray(message)) return message.join(", ");
  return message;
}

function getApiBaseUrl() {
  const raw = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  return raw?.replace(/\/+$/, "") ?? "";
}

export async function GET(request: NextRequest) {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value ?? null;
  if (!token) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    return NextResponse.json(
      {
        message: "Orders API base URL is missing. Set API_BASE_URL or NEXT_PUBLIC_API_BASE_URL.",
      },
      { status: 500 },
    );
  }

  const orderSn = request.nextUrl.searchParams.get("order_sn")?.trim();
  if (orderSn) {
    try {
      const backendResponse = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(orderSn)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      let payload: BackendOrderDetailResponse | null = null;
      try {
        payload = (await backendResponse.json()) as BackendOrderDetailResponse;
      } catch {
        payload = null;
      }

      if (!backendResponse.ok) {
        return NextResponse.json(
          { message: resolveMessage(payload?.message, "Unable to fetch order detail.") },
          { status: backendResponse.status || 500 },
        );
      }

      return NextResponse.json(
        {
          order: payload?.order ?? null,
        },
        { status: 200 },
      );
    } catch {
      return NextResponse.json({ message: "Unable to reach order service." }, { status: 503 });
    }
  }

  const targetUrl = new URL(`${apiBaseUrl}/orders`);
  const filterKeys = [
    "wms_status",
    "marketplace_status",
    "shipping_status",
    "page",
    "page_size",
    "updated_at_order",
  ] as const;
  for (const key of filterKeys) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) {
      targetUrl.searchParams.set(key, value);
    }
  }

  try {
    const backendResponse = await fetch(targetUrl.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    let payload: BackendOrdersResponse | null = null;
    try {
      payload = (await backendResponse.json()) as BackendOrdersResponse;
    } catch {
      payload = null;
    }

    if (!backendResponse.ok) {
      return NextResponse.json(
        { message: resolveMessage(payload?.message, "Unable to fetch orders.") },
        { status: backendResponse.status || 500 },
      );
    }

    return NextResponse.json(
      {
        orders: payload?.orders ?? [],
        pagination: payload?.pagination ?? {
          page: 1,
          page_size: 10,
          total: 0,
          total_pages: 1,
        },
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ message: "Unable to reach order service." }, { status: 503 });
  }
}

export async function POST() {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value ?? null;
  if (!token) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    return NextResponse.json(
      {
        message: "Orders API base URL is missing. Set API_BASE_URL or NEXT_PUBLIC_API_BASE_URL.",
      },
      { status: 500 },
    );
  }

  try {
    const backendResponse = await fetch(`${apiBaseUrl}/orders/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    let payload: BackendSyncResponse | null = null;
    try {
      payload = (await backendResponse.json()) as BackendSyncResponse;
    } catch {
      payload = null;
    }

    if (!backendResponse.ok) {
      return NextResponse.json(
        { message: resolveMessage(payload?.message, "Unable to sync orders.") },
        { status: backendResponse.status || 500 },
      );
    }

    return NextResponse.json(
      {
        message: resolveMessage(payload?.message, "Orders synchronized."),
        summary: payload?.summary ?? null,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ message: "Unable to reach order service." }, { status: 503 });
  }
}
