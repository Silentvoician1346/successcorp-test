import { redirect } from "next/navigation";
import { getAccessTokenFromCookies } from "@/lib/auth";
import LoginForm from "./login-form";

export default async function LoginPage() {
  const token = await getAccessTokenFromCookies();

  if (token) {
    redirect("/dashboard");
  }

  return <LoginForm />;
}
