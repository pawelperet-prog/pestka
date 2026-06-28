import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, History, Settings, X } from "lucide-react";
import { useBle } from "@/lib/ble";

const tabs = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/history", label: "Historia", icon: History },
  { to: "/settings", label: "Ustawienia", icon: Settings },
] as const;

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { escapedAlarm, dismissAlarm, supported } = useBle();

  return (
    <div className="min-h-screen flex justify-center">
      <div className="w-full max-w-[430px] flex flex-col min-h-screen relative">
        {escapedAlarm && (
          <div className="sticky top-0 z-50 flash-danger text-destructive-foreground px-4 py-3 flex items-center justify-between font-semibold shadow-lg">
            <span>🚨 UWAGA: Pies uciekł! Obroża pika!</span>
            <button onClick={dismissAlarm} aria-label="Zamknij" className="ml-3 opacity-90 hover:opacity-100">
              <X size={18} />
            </button>
          </div>
        )}

        {!supported && (
          <div className="m-4 rounded-2xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            Twoja przeglądarka nie obsługuje Web Bluetooth. Użyj Chrome lub Edge na Androidzie / desktopie.
          </div>
        )}

        <main className="flex-1 px-4 pt-4 pb-28">
          <Outlet />
        </main>

        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] border-t border-border bg-card/95 backdrop-blur z-40">
          <ul className="grid grid-cols-3">
            {tabs.map((t) => {
              const active = pathname === t.to;
              const Icon = t.icon;
              return (
                <li key={t.to}>
                  <Link
                    to={t.to}
                    className={`flex flex-col items-center gap-1 py-3 text-xs transition-colors ${
                      active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon size={20} />
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
