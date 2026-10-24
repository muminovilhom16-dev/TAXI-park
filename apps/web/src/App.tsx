import type { Permission } from "@taxi/shared";
import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { Loading } from "@/components/ui/data-state";
import { useAuth } from "@/lib/auth";
import { AggregatorsPage } from "@/pages/AggregatorsPage";
import { AuditPage } from "@/pages/AuditPage";
import { DriverPage } from "@/pages/DriverPage";
import { DebtsPage } from "@/pages/DebtsPage";
import { DriversPage } from "@/pages/DriversPage";
import { EarningsPage } from "@/pages/EarningsPage";
import { FinanceSettingsPage } from "@/pages/FinanceSettingsPage";
import { HomePage } from "@/pages/HomePage";
import { LoginPage } from "@/pages/LoginPage";
import { PaymentsPage } from "@/pages/PaymentsPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { UsersPage } from "@/pages/UsersPage";
import { VehiclesPage } from "@/pages/VehiclesPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function RequirePermission({ perm, children }: { perm: Permission | Permission[]; children: ReactNode }) {
  const { can } = useAuth();
  const ok = (Array.isArray(perm) ? perm : [perm]).some((p) => can(p));
  return ok ? children : <Message title="Ruxsat yo'q" text="Bu sahifani ko'rish uchun ruxsatingiz yo'q." />;
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className="py-16 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{text}</p>
      <Link to="/" className="mt-4 inline-block text-sm text-primary underline">
        Bosh sahifaga qaytish
      </Link>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route
          path="drivers"
          element={
            <RequirePermission perm={["drivers.read_all", "drivers.read_assigned"]}>
              <DriversPage />
            </RequirePermission>
          }
        />
        <Route
          path="drivers/:id"
          element={
            <RequirePermission perm={["drivers.read_all", "drivers.read_assigned"]}>
              <DriverPage />
            </RequirePermission>
          }
        />
        <Route
          path="vehicles"
          element={
            <RequirePermission perm="drivers.read_all">
              <VehiclesPage />
            </RequirePermission>
          }
        />
        <Route
          path="aggregators"
          element={
            <RequirePermission perm={["aggregators.manage", "drivers.read_all"]}>
              <AggregatorsPage />
            </RequirePermission>
          }
        />
        <Route
          path="earnings"
          element={
            <RequirePermission perm="finance.read">
              <EarningsPage />
            </RequirePermission>
          }
        />
        <Route
          path="debts"
          element={
            <RequirePermission perm="finance.read">
              <DebtsPage />
            </RequirePermission>
          }
        />
        <Route
          path="payments"
          element={
            <RequirePermission perm="finance.read">
              <PaymentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="finance-settings"
          element={
            <RequirePermission perm="finance.read">
              <FinanceSettingsPage />
            </RequirePermission>
          }
        />
        <Route
          path="users"
          element={
            <RequirePermission perm="users.manage">
              <UsersPage />
            </RequirePermission>
          }
        />
        <Route
          path="audit"
          element={
            <RequirePermission perm="audit.read">
              <AuditPage />
            </RequirePermission>
          }
        />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<Message title="Sahifa topilmadi" text="Bunday sahifa mavjud emas." />} />
      </Route>
    </Routes>
  );
}
