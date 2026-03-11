import { NextResponse } from "next/server";

type MarketplaceOrderListResponse = {
  message?: string | string[];
  data?: unknown[];
};

function resolveMessage(message: string | string[] | undefined, fallback: string) {
  if (!message) return fallback;
  if (Array.isArray(message)) return message.join(", ");
  return message;
}

function normalizeBaseUrl(raw: string) {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}

function getMarketplaceBaseUrl() {
  return normalizeBaseUrl(
    process.env.MARKETPLACE_URL ?? process.env.NEXT_PUBLIC_MARKETPLACE_URL ?? "",
  );
}

export async function GET() {
  const marketplaceBaseUrl = getMarketplaceBaseUrl();
  if (!marketplaceBaseUrl) {
    return NextResponse.json(
      {
        message:
          "Marketplace URL is missing. Set MARKETPLACE_URL (or NEXT_PUBLIC_MARKETPLACE_URL).",
      },
      { status: 500 },
    );
  }

  const accessToken = process.env.MARKETPLACE_ACCESS_TOKEN?.trim() ?? "";
  if (!accessToken) {
    return NextResponse.json(
      {
        message: "Marketplace access token is missing. Set MARKETPLACE_ACCESS_TOKEN in FE env.",
      },
      { status: 500 },
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };

  const clientId = process.env.MARKETPLACE_CLIENT_ID?.trim();
  if (clientId) {
    headers["x-client-id"] = clientId;
  }

  const clientSecret = process.env.MARKETPLACE_CLIENT_SECRET?.trim();
  if (clientSecret) {
    headers["x-client-secret"] = clientSecret;
  }

  try {
    const marketplaceResponse = await fetch(`${marketplaceBaseUrl}/order/list`, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    let payload: MarketplaceOrderListResponse | null = null;
    try {
      payload = (await marketplaceResponse.json()) as MarketplaceOrderListResponse;
    } catch {
      payload = null;
    }

    if (!marketplaceResponse.ok) {
      return NextResponse.json(
        { message: resolveMessage(payload?.message, "Marketplace order list call failed.") },
        { status: marketplaceResponse.status || 502 },
      );
    }

    return NextResponse.json(payload ?? { data: [] }, { status: 200 });
  } catch {
    return NextResponse.json(
      { message: "Unable to reach marketplace API." },
      { status: 503 },
    );
  }
}
