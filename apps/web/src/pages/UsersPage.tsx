import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDateTime, ROLE_CODES, ROLE_NAMES, type Paginated, type RoleCode, type UserRow } from "@taxi/shared";
import { KeyRound, Pencil, Plus, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, ErrorState, Loading } from "@/components/ui/data-state";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced } from "@/lib/hooks";

const PAGE_SIZE = 25;

export function UsersPage() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [active, setActive] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const search = useDebounced(q, 300);

  const list = useQuery({
    queryKey: ["users", { search, role, active, page }],
    queryFn: () =>
      api<Paginated<UserRow>>("/users", { query: { q: search, role, active, page, pageSize: PAGE_SIZE } }),
    placeholderData: keepPreviousData,
  });

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted" aria-hidden />
          <Input
            aria-label="Qidirish"
            placeholder="Ism yoki login bo'yicha qidirish"
            className="pl-9"
            value={q}
            onChange={(e) => resetPage(setQ)(e.target.value)}
          />
        </div>
        <Select aria-label="Rol" className="w-44" value={role} onChange={(e) => resetPage(setRole)(e.target.value)}>
          <option value="">Barcha rollar</option>
          {ROLE_CODES.map((r) => (
            <option key={r} value={r}>
              {ROLE_NAMES[r]}
            </option>
          ))}
        </Select>
        <Select aria-label="Holat" className="w-36" value={active} onChange={(e) => resetPage(setActive)(e.target.value)}>
          <option value="">Barchasi</option>
          <option value="true">Faol</option>
          <option value="false">Faol emas</option>
        </Select>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Xodim qo'shish
        </Button>
      </div>

      <Card className="overflow-hidden">
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <Empty title="Xodim topilmadi" hint={q || role || active ? "Filtrlarni o'zgartirib ko'ring" : undefined} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-bg text-left text-xs text-muted uppercase">
                  <tr>
                    <th className="px-4 py-2 font-medium">Xodim</th>
                    <th className="px-4 py-2 font-medium">Rol</th>
                    <th className="px-4 py-2 font-medium">Telefon</th>
                    <th className="px-4 py-2 font-medium">Holat</th>
                    <th className="px-4 py-2 font-medium">Oxirgi kirish</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.data.items.map((u) => (
                    <tr key={u.id}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{u.fullName}</div>
                        <div className="text-xs text-muted">{u.login}</div>
                      </td>
                      <td className="px-4 py-2.5">{u.role.name}</td>
                      <td className="tabular px-4 py-2.5">{u.phone ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={u.isActive ? "success" : "neutral"}>{u.isActive ? "Faol" : "Faol emas"}</Badge>
                      </td>
                      <td className="tabular px-4 py-2.5 text-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "—"}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => setEditing(u)} aria-label={`${u.fullName}: tahrirlash`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setResetting(u)} aria-label={`${u.fullName}: parolni tiklash`}>
                            <KeyRound className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      {editing && <EditUserDialog user={editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function useUserMutation<V>(fn: (v: V) => Promise<unknown>, onDone: () => void, success: string) {
  const qc = useQueryClient();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: fn,
    onMutate: () => {
      setFieldErrors({});
      setFormError(null);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["users"] });
      toast.success(success);
      onDone();
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.details) setFieldErrors(err.fieldErrors());
      setFormError(errorMessage(err));
    },
  });
  return { ...m, fieldErrors, formError };
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
      {message}
    </p>
  ) : null;
}

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const empty = { fullName: "", login: "", phone: "", roleCode: "operator" as RoleCode, password: "" };
  const [form, setForm] = useState(empty);
  const close = () => {
    setForm(empty);
    onOpenChange(false);
  };
  const m = useUserMutation(
    () => api("/users", { method: "POST", body: { ...form, phone: form.phone || null } }),
    close,
    "Xodim qo'shildi",
  );
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())} title="Yangi xodim">
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          m.mutate(undefined);
        }}
      >
        <Field id="fullName" label="Ism va familiya" error={m.fieldErrors.fullName}>
          <Input id="fullName" value={form.fullName} onChange={set("fullName")} aria-invalid={!!m.fieldErrors.fullName} />
        </Field>
        <Field id="newLogin" label="Login" error={m.fieldErrors.login} hint="Lotin harflari, raqamlar, nuqta yoki chiziqcha">
          <Input id="newLogin" autoComplete="off" value={form.login} onChange={set("login")} aria-invalid={!!m.fieldErrors.login} />
        </Field>
        <Field id="phone" label="Telefon (ixtiyoriy)" error={m.fieldErrors.phone}>
          <Input id="phone" inputMode="tel" placeholder="+998 90 123 45 67" value={form.phone} onChange={set("phone")} />
        </Field>
        <Field id="role" label="Rol">
          <Select id="role" value={form.roleCode} onChange={set("roleCode")}>
            {ROLE_CODES.map((r) => (
              <option key={r} value={r}>
                {ROLE_NAMES[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="newPassword" label="Boshlang'ich parol" error={m.fieldErrors.password} hint="Kamida 10 ta belgi">
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set("password")}
            aria-invalid={!!m.fieldErrors.password}
          />
        </Field>
        <FormError message={m.formError} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={close}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={m.isPending}>
            Saqlash
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditUserDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const { user: me } = useAuth();
  const self = me?.id === user.id;
  const [form, setForm] = useState({
    fullName: user.fullName,
    phone: user.phone ?? "",
    roleCode: user.role.code,
    isActive: user.isActive,
  });
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const m = useUserMutation(
    () =>
      api(`/users/${user.id}`, {
        method: "PATCH",
        body: {
          fullName: form.fullName,
          phone: form.phone || null,
          ...(!self && { roleCode: form.roleCode, isActive: form.isActive }),
        },
      }),
    onClose,
    "O'zgarishlar saqlandi",
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Deactivation signs the person out at once; ask before doing it.
    if (user.isActive && !form.isActive && !confirmDeactivate) {
      setConfirmDeactivate(true);
      return;
    }
    m.mutate(undefined);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Xodimni tahrirlash" description={user.login}>
      <form className="space-y-3" onSubmit={submit}>
        <Field id="editName" label="Ism va familiya" error={m.fieldErrors.fullName}>
          <Input id="editName" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </Field>
        <Field id="editPhone" label="Telefon" error={m.fieldErrors.phone}>
          <Input id="editPhone" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field id="editRole" label="Rol" hint={self ? "O'z rolingizni o'zgartira olmaysiz" : undefined}>
          <Select
            id="editRole"
            disabled={self}
            value={form.roleCode}
            onChange={(e) => setForm({ ...form, roleCode: e.target.value as RoleCode })}
          >
            {ROLE_CODES.map((r) => (
              <option key={r} value={r}>
                {ROLE_NAMES[r]}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={self}
            checked={form.isActive}
            onChange={(e) => {
              setConfirmDeactivate(false);
              setForm({ ...form, isActive: e.target.checked });
            }}
          />
          Faol (tizimga kira oladi)
        </label>
        {confirmDeactivate && (
          <p role="alert" className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
            Xodim darhol tizimdan chiqariladi va qayta kira olmaydi. Tasdiqlash uchun yana "Saqlash" tugmasini bosing.
          </p>
        )}
        <FormError message={m.formError} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" variant={confirmDeactivate ? "danger" : "primary"} loading={m.isPending}>
            Saqlash
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const m = useUserMutation(
    () => api(`/users/${user.id}/reset-password`, { method: "POST", body: { password } }),
    onClose,
    "Parol yangilandi",
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Parolni tiklash"
      description={`${user.fullName} barcha qurilmalardan chiqariladi.`}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate(undefined);
        }}
      >
        <Field id="resetPassword" label="Yangi parol" error={m.fieldErrors.password} hint="Kamida 10 ta belgi">
          <Input id="resetPassword" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <FormError message={m.formError} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={m.isPending} disabled={!password}>
            Parolni o'rnatish
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
