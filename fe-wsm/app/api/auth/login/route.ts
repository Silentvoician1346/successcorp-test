import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, getAccessTokenCookieOptions } from "@/lib/auth";

type BackendLoginResponse = {
  accessToken?: string;
  user?: {
    id?: string;
    email?: string;
    role?: string;
    name?: string | null;
  };
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

export async function POST(request: Request) {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    return NextResponse.json(
      {
        message:
          "Authentication API base URL is missing. Set API_BASE_URL or NEXT_PUBLIC_API_BASE_URL.",
      },
      { status: 500 },
    );
  }

  let body: { email?: unknown; password?: unknown; rememberMe?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; password?: unknown; rememberMe?: unknown };
  } catch {
    return NextResponse.json({ message: "Invalid request body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const rememberMe = body.rememberMe === true;

  try {
    const backendResponse = await fetch(`${apiBaseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });

    let payload: BackendLoginResponse | null = null;
    try {
      payload = (await backendResponse.json()) as BackendLoginResponse;
    } catch {
      payload = null;
    }

    if (!backendResponse.ok || !payload?.accessToken) {
      return NextResponse.json(
        { message: resolveMessage(payload?.message, "Invalid email or password.") },
        { status: backendResponse.status || 401 },
      );
    }

    const response = NextResponse.json(
      {
        user: payload.user ?? null,
      },
      { status: 200 },
    );

    response.cookies.set(
      AUTH_COOKIE_NAME,
      payload.accessToken,
      getAccessTokenCookieOptions(rememberMe),
    );

    return response;
  } catch {
    return NextResponse.json(
      { message: "Unable to reach authentication service." },
      { status: 503 },
    );
  }
}
