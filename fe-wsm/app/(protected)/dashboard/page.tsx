import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Poppins } from "next/font/google";
import { Bell, LayoutDashboard, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AUTH_COOKIE_NAME, requireAccessToken } from "@/lib/auth";
import OrdersList from "@/app/services/orders/orders-list";
import SyncOrdersButton from "@/components/features/orders/sync-orders-button";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "700"],
});

export default async function DashboardPage() {
  async function signOut() {
    "use server";

    const cookieStore = await cookies();
    cookieStore.set(AUTH_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });

    redirect("/login");
  }

  await requireAccessToken();

  return (
    <main className="min-h-screen bg-background">
      <header className="h-20 w-full bg-primary text-white">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-6 sm:px-8 md:px-10">
          <div className="flex items-center gap-3">
            <LayoutDashboard aria-hidden="true" className="h-6 w-6" />
            <p className="text-xl font-semibold tracking-wide">WMSpaceIO</p>
          </div>

          <nav className="hidden items-center gap-8 md:flex">
            <span className="text-sm font-medium text-white/70">Inbound</span>
            <span className="border-b-2 border-white pb-1 text-sm font-semibold text-white">
              Outbound
            </span>
            <span className="text-sm font-medium text-white/70">Inventory</span>
            <span className="text-sm font-medium text-white/70">Settings</span>
          </nav>

          <div className="flex items-center gap-3">
            <SyncOrdersButton />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="text-white hover:bg-white/15 hover:text-white"
              aria-label="Open notifications"
            >
              <Bell aria-hidden="true" className="h-5 w-5" />
            </Button>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-semibold text-white">
              SA
            </div>
            <form action={signOut}>
              <Button
                type="submit"
                variant="ghost"
                className="bg-transparent text-white hover:bg-transparent hover:text-white"
              >
                <LogOut aria-hidden="true" className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      </header>

      <section className="p-6 sm:p-8 md:p-10">
        <div className="mx-auto max-w-6xl">
          <h1 className={`${poppins.className} text-[24px] leading-9 font-bold text-foreground`}>
            Outbound
          </h1>
          <p
            className={`${poppins.className} mt-2 text-[12px] leading-3.25 font-normal text-muted-foreground`}
          >
            Manage all outbound process
          </p>
          <OrdersList />
        </div>
      </section>
    </main>
  );
}
