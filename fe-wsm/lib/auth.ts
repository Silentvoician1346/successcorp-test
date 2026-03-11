import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const AUTH_COOKIE_NAME = "wms_access_token";
const THIRTY_DAYS_IN_SECONDS = 60 * 60 * 24 * 30;

export async function getAccessTokenFromCookies() {
  return (await cookies()).get(AUTH_COOKIE_NAME)?.value ?? null;
}

export async function requireAccessToken() {
  const token = await getAccessTokenFromCookies();

  if (!token) {
    redirect("/login");
  }

  return token;
}

export function getAccessTokenCookieOptions(rememberMe: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(rememberMe ? { maxAge: THIRTY_DAYS_IN_SECONDS } : {}),
  };
}
