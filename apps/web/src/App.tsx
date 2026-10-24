import type { Permission } from "@taxi/shared";
import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { Loading } from "@/components/ui/data-state";
import { useAuth } from "@/lib/auth";
import { AuditPage } from "@/pages/AuditPage";
import { HomePage } from "@/pages/HomePage";
import { LoginPage } from "@/pages/LoginPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { UsersPage } from "@/pages/UsersPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function RequirePermission({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { can } = useAuth();
  return can(perm) ? children : <Message title="Ruxsat yo'q" text="Bu sahifani ko'rish uchun ruxsatingiz yo'q." />;
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
