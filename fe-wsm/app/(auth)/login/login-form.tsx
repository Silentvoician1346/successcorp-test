"use client";

import { Poppins } from "next/font/google";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { useAuthStore } from "@/stores/auth-store";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const RIGHT_PANEL_TOASTER_ID = "right-panel-toaster";
const EMAIL_MAX_LENGTH = 254;

type LoginResponse = {
  user?: {
    id?: string;
    email?: string;
    role?: string;
    name?: string | null;
  };
  message?: string | string[];
};

function getEmailError(rawEmail: string): string | null {
  const value = rawEmail.trim();

  if (!value) return "Email address is required.";
  if (rawEmail !== value) return "Email address cannot start or end with spaces.";
  if (value.length > EMAIL_MAX_LENGTH) return "Email address is too long.";
  if (value.includes(" ")) return "Email address cannot contain spaces.";

  const atCount = (value.match(/@/g) ?? []).length;
  if (atCount !== 1) return "Email address must contain a single @ symbol.";

  const [local, domain] = value.split("@");
  if (!local) return "Email username is missing before @.";
  if (!domain) return "Email domain is missing after @.";

  if (local.startsWith(".") || local.endsWith(".")) {
    return "Email username cannot start or end with a dot.";
  }
  if (local.includes("..")) {
    return "Email username cannot contain consecutive dots.";
  }

  if (domain.includes("..")) {
    return "Email domain cannot contain consecutive dots.";
  }
  if (!domain.includes(".")) {
    return "Email domain must include a dot (e.g. company.com).";
  }

  const labels = domain.split(".");
  if (labels.some((label) => label.length === 0)) {
    return "Email domain contains an empty section.";
  }
  if (labels.some((label) => label.startsWith("-") || label.endsWith("-"))) {
    return "Email domain labels cannot start or end with a hyphen.";
  }

  const emailPattern = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
  if (!emailPattern.test(value)) return "Please enter a valid email format.";

  return null;
}

function getPasswordError(rawPassword: string): string | null {
  if (!rawPassword) return "Password is required.";
  if (rawPassword !== rawPassword.trim()) {
    return "Password cannot start or end with spaces.";
  }
  if (rawPassword.length < 6) return "Password must be at least 6 characters.";
  return null;
}

function resolveApiMessage(payload: LoginResponse | null, fallback: string) {
  if (!payload?.message) return fallback;
  if (Array.isArray(payload.message)) return payload.message.join(", ");
  return payload.message;
}

export default function LoginForm() {
  const router = useRouter();
  const setStoreEmail = useAuthStore((state) => state.setEmail);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function getToastTarget() {
    return { toasterId: RIGHT_PANEL_TOASTER_ID };
  }

  const emailError = getEmailError(email);
  const showEmailError = emailTouched && emailError;
  const passwordError = getPasswordError(password);
  const showPasswordError = passwordTouched && passwordError;

  async function onSubmitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailTouched(true);
    setPasswordTouched(true);
    setSubmitError(null);

    if (emailError || passwordError) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
          rememberMe,
        }),
      });

      let payload: LoginResponse | null = null;
      try {
        payload = (await response.json()) as LoginResponse;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw new Error(resolveApiMessage(payload, "Invalid email or password."));
      }

      const signedInEmail = payload?.user?.email?.trim() || email.trim();
      if (signedInEmail) {
        setStoreEmail(signedInEmail);
      }

      toast.success("Signed in successfully.", getToastTarget());
      router.replace("/dashboard");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to sign in. Check backend status and network connection.";
      setSubmitError(message);
      toast.error(message, getToastTarget());
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen w-full">
      <section className="grid min-h-screen w-full md:grid-cols-2">
        <aside className="hidden bg-primary text-white md:flex md:items-start md:justify-center md:p-14 lg:p-16">
          <div className="mt-32 max-w-md text-start">
            <div className="mb-16 flex items-center gap-4">
              <LayoutDashboard aria-hidden="true" className="h-16 w-16 text-white" />
              <span
                className={`${poppins.className} text-[36px] leading-16 font-normal text-white`}
              >
                WMSpaceIO
              </span>
            </div>
            <p
              className={`${poppins.className} text-[14px] leading-3.25 font-normal text-on-primary-muted`}
            >
              WSM Dashboard
            </p>
            <h2 className={`${poppins.className} mt-4 text-[48px] leading-16 font-bold`}>
              MANAGE YOUR ORDER WITH CLARITY
            </h2>
            <p
              className={`${poppins.className} mt-5 text-[14px] leading-5.5 font-semibold text-on-primary-muted`}
            >
              Track orders, manage orders, and streamline operations -- all in one place.
            </p>
          </div>
        </aside>

        <div className="relative flex mt-28 min-h-screen items-start bg-white p-6 sm:p-8 md:p-14 lg:p-16">
          <Toaster
            id={RIGHT_PANEL_TOASTER_ID}
            position="top-center"
            offset={24}
            richColors
            style={{ position: "absolute", zIndex: 30 }}
          />
          <div className="mx-auto w-full max-w-md">
            <header className="mb-8">
              <p className="text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase md:hidden">
                SuccessCorp WMS
              </p>
              <h1
                className={`${poppins.className} mt-2 text-[48px] leading-16 font-bold text-foreground`}
              >
                Welcome Back
              </h1>
              <p
                className={`${poppins.className} mt-1 text-[14px] leading-5.5 font-normal text-muted-foreground`}
              >
                Sign to your account to continue
              </p>
            </header>

            <form className="space-y-4" onSubmit={onSubmitLogin}>
              <div className="block">
                <Label
                  htmlFor="email"
                  className={`${poppins.className} mb-1 block text-[14px] leading-5.5 font-semibold text-foreground`}
                >
                  Email Address
                </Label>
                <Input
                  id="email"
                  className={`${poppins.className} h-auto w-full border-border px-3 py-2 text-[14px] leading-5.5 font-normal text-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 ${showEmailError ? "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20" : ""}`}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  autoComplete="email"
                  placeholder="you@company.com"
                  aria-invalid={Boolean(showEmailError)}
                  aria-describedby={showEmailError ? "email-error" : undefined}
                />
                {showEmailError ? (
                  <p
                    id="email-error"
                    className={`${poppins.className} mt-1 text-[13px] leading-5 font-normal text-destructive`}
                  >
                    {emailError}
                  </p>
                ) : null}
              </div>

              <div className="block">
                <Label
                  htmlFor="password"
                  className={`${poppins.className} mb-1 block text-[14px] leading-5.5 font-semibold text-foreground`}
                >
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    className={`${poppins.className} h-auto w-full border-border px-3 py-2 pr-11 text-[14px] leading-5.5 font-normal text-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 ${
                      showPasswordError
                        ? "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20"
                        : ""
                    }`}
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onBlur={() => setPasswordTouched(true)}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    aria-invalid={Boolean(showPasswordError)}
                    aria-describedby={showPasswordError ? "password-error" : undefined}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff aria-hidden="true" className="h-4 w-4" />
                    ) : (
                      <Eye aria-hidden="true" className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {showPasswordError ? (
                  <p
                    id="password-error"
                    className={`${poppins.className} mt-1 text-[13px] leading-5 font-normal text-destructive`}
                  >
                    {passwordError}
                  </p>
                ) : null}
              </div>

              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2">
                  <Checkbox
                    id="remember-me"
                    className="border-border data-checked:border-primary data-checked:bg-primary"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMe(checked === true)}
                  />
                  <Label
                    htmlFor="remember-me"
                    className={`${poppins.className} text-[14px] leading-5.5 font-normal text-foreground`}
                  >
                    Remember me
                  </Label>
                </div>

                <Button
                  type="button"
                  variant="link"
                  className={`${poppins.className} h-auto px-0 text-[14px] leading-5.5 font-semibold text-primary`}
                >
                  Forgot password?
                </Button>
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className={`${poppins.className} h-auto w-full rounded-lg bg-primary px-4 py-3 text-[14px] leading-5.5 font-semibold text-white hover:bg-(--primary-hover)`}
              >
                {isSubmitting ? "Signing in..." : "Sign in to Dashboard"}
              </Button>

              {submitError ? (
                <p
                  className={`${poppins.className} rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] leading-5 text-destructive`}
                >
                  {submitError}
                </p>
              ) : null}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button
                  type="button"
                  onClick={() => toast.success("Login successful.", getToastTarget())}
                  className={`${poppins.className} h-auto rounded-lg bg-(--success) px-3 py-2 text-[13px] leading-5 font-semibold text-white hover:bg-(--success)/90`}
                >
                  Success Toast
                </Button>
                <Button
                  type="button"
                  onClick={() =>
                    toast.warning("Your session is about to expire.", getToastTarget())
                  }
                  className={`${poppins.className} h-auto rounded-lg bg-amber-500 px-3 py-2 text-[13px] leading-5 font-semibold text-white hover:bg-amber-500/90`}
                >
                  Warning Toast
                </Button>
                <Button
                  type="button"
                  onClick={() =>
                    toast.error("Unable to sign in. Please try again.", getToastTarget())
                  }
                  className={`${poppins.className} h-auto rounded-lg bg-(--danger) py-2 text-[13px] leading-5 font-semibold text-white hover:bg-(--danger)/90`}
                >
                  Error Toast
                </Button>
              </div>

              <div className="flex items-center gap-3 py-1">
                <Separator className="flex-1 bg-border" />
                <span
                  className={`${poppins.className} text-[14px] leading-5.5 font-normal text-muted-foreground`}
                >
                  or
                </span>
                <Separator className="flex-1 bg-border" />
              </div>

              <Button
                type="button"
                variant="outline"
                className={`${poppins.className} h-auto w-full items-center justify-center gap-2 border-border bg-white px-4 py-3 text-[14px] leading-5.5 font-semibold text-foreground`}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                  <path
                    d="M21.805 12.23c0-.68-.06-1.334-.17-1.962H12.2v3.708h5.396a4.61 4.61 0 0 1-2 3.026v2.51h3.235c1.89-1.742 2.974-4.307 2.974-7.281Z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12.2 22c2.7 0 4.966-.895 6.621-2.426l-3.235-2.51c-.895.6-2.043.956-3.386.956-2.608 0-4.816-1.762-5.604-4.13H3.246v2.59A9.998 9.998 0 0 0 12.2 22Z"
                    fill="#34A853"
                  />
                  <path
                    d="M6.596 13.89a6.016 6.016 0 0 1 0-3.78V7.52H3.246a10 10 0 0 0 0 8.96l3.35-2.59Z"
                    fill="#FBBC04"
                  />
                  <path
                    d="M12.2 5.98c1.468 0 2.785.505 3.82 1.497l2.864-2.864C17.16 3.007 14.893 2 12.2 2A9.998 9.998 0 0 0 3.246 7.52l3.35 2.59c.788-2.368 2.996-4.13 5.604-4.13Z"
                    fill="#EA4335"
                  />
                </svg>
                Continue with Google
              </Button>
            </form>

            <div className="mt-6 flex items-center justify-center gap-2">
              <span
                className={`${poppins.className} text-[14px] leading-5.5 font-normal text-muted-foreground`}
              >
                Don&apos;t have an account?
              </span>
              <Button
                type="button"
                variant="link"
                className={`${poppins.className} h-auto px-0 text-[14px] leading-5.5 font-semibold text-primary`}
              >
                Sign up free
              </Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
