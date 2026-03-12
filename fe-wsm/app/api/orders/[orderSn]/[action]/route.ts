import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth";

type ActionParams = {
  orderSn: string;
  action: string;
};

type BackendActionResponse = {
  message?: string | string[];
};

// Normalizes backend message variants into a single display string.
function resolveMessage(message: string | string[] | undefined, fallback: string) {
  if (!message) return fallback;
  if (Array.isArray(message)) return message.join(", ");
  return message;
}

// Resolves backend API base URL from server/runtime environment variables.
function getApiBaseUrl() {
  const raw = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  return raw?.replace(/\/+$/, "") ?? "";
}

// Validates and maps route action segment to supported backend order actions.
function toBackendAction(action: string) {
  const normalized = action.trim().toLowerCase();
  if (
    normalized === "pick" ||
    normalized === "pack" ||
    normalized === "ship" ||
    normalized === "sync"
  ) {
    return normalized;
  }

  return null;
}

// Proxies order action requests (pick/pack/ship/sync) to the backend API.
export async function POST(
  _request: NextRequest,
  context: { params: Promise<ActionParams> },
) {
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

  const { orderSn, action } = await context.params;
  const backendAction = toBackendAction(action);
  if (!backendAction || !orderSn?.trim()) {
    return NextResponse.json({ message: "Invalid order action request." }, { status: 400 });
  }

  const endpoint = `${apiBaseUrl}/orders/${encodeURIComponent(orderSn)}/${backendAction}`;

  try {
    const backendResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    let payload: BackendActionResponse | Record<string, unknown> | null = null;
    try {
      payload = (await backendResponse.json()) as
        | BackendActionResponse
        | Record<string, unknown>;
    } catch {
      payload = null;
    }

    if (!backendResponse.ok) {
      return NextResponse.json(
        { message: resolveMessage((payload as BackendActionResponse | null)?.message, "Order action failed.") },
        { status: backendResponse.status || 500 },
      );
    }

    return NextResponse.json(payload ?? { ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ message: "Unable to reach order service." }, { status: 503 });
  }
}
