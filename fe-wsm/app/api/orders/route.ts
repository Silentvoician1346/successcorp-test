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

type BackendOrdersResponse = {
  orders?: BackendOrder[];
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

  const targetUrl = new URL(`${apiBaseUrl}/orders`);
  const wmsStatus = request.nextUrl.searchParams.get("wms_status");
  if (wmsStatus) {
    targetUrl.searchParams.set("wms_status", wmsStatus);
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
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ message: "Unable to reach order service." }, { status: 503 });
  }
}
