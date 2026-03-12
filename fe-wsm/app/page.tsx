import { redirect } from "next/navigation";
import { getAccessTokenFromCookies } from "@/lib/auth";

export default async function RootPage() {
  const token = await getAccessTokenFromCookies();
  redirect(token ? "/dashboard" : "/login");
}
