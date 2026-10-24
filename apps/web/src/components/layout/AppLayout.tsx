import type { Permission } from "@taxi/shared";
import { CarTaxiFront, Home, LogOut, Menu, ScrollText, UserCircle, Users, X } from "lucide-react";
import { useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }>; perm?: Permission };

// Only modules that work are listed; later modules appear as they ship.
export const NAV: NavItem[] = [
  { to: "/", label: "Bosh sahifa", icon: Home },
  { to: "/users", label: "Xodimlar", icon: Users, perm: "users.manage" },
  { to: "/audit", label: "Audit tarixi", icon: ScrollText, perm: "audit.read" },
  { to: "/profile", label: "Profil", icon: UserCircle },
];

export function AppLayout() {
  const { user, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const items = NAV.filter((n) => !n.perm || can(n.perm));
  const current = items.find((n) => (n.to === "/" ? location.pathname === "/" : location.pathname.startsWith(n.to)));

  const nav = (
    <nav className="flex flex-col gap-1 p-3" aria-label="Asosiy menyu">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
              isActive ? "bg-primary/10 font-medium text-primary" : "text-text hover:bg-neutral-bg",
            )
          }
        >
          <Icon className="h-4 w-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  const brand = (
    <div className="flex h-14 items-center gap-2 border-b border-border px-4 font-semibold">
      <CarTaxiFront className="h-5 w-5 text-primary" aria-hidden />
      Taxi Park
    </div>
  );

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface md:block">
        {brand}
        {nav}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-surface shadow-lg">
            <div className="flex items-center justify-between pr-2">
              {brand}
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Menyuni yopish">
                <X className="h-4 w-4" />
              </Button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-4">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="Menyuni ochish">
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="truncate text-base font-semibold">{current?.label ?? ""}</h1>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right text-sm leading-tight sm:block">
              <div className="font-medium">{user?.fullName}</div>
              <div className="text-xs text-muted">{user?.role.name}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await logout();
                navigate("/login", { replace: true });
              }}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Chiqish</span>
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
