import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export function ProfilePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", repeat: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const m = useMutation({
    mutationFn: () =>
      api("/auth/change-password", {
        method: "POST",
        body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
      }),
    onSuccess: async () => {
      setForm({ currentPassword: "", newPassword: "", repeat: "" });
      // The server issued a new session; pick up its CSRF token.
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Parol o'zgartirildi. Boshqa qurilmalardan chiqarildingiz");
    },
    onError: (err) => {
      setErrors(err instanceof ApiRequestError && err.details ? err.fieldErrors() : { form: errorMessage(err) });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    if (form.newPassword !== form.repeat) {
      setErrors({ repeat: "Parollar bir xil emas" });
      return;
    }
    m.mutate();
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">Ma'lumotlarim</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Ism</dt>
            <dd>{user?.fullName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Login</dt>
            <dd>{user?.login}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Rol</dt>
            <dd>{user?.role.name}</dd>
          </div>
        </dl>
      </Card>
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">Parolni o'zgartirish</h2>
        <form className="space-y-3" onSubmit={submit}>
          <Field id="current" label="Joriy parol">
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
            />
          </Field>
          <Field id="next" label="Yangi parol" error={errors.newPassword} hint="Kamida 10 ta belgi">
            <Input
              id="next"
              type="password"
              autoComplete="new-password"
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            />
          </Field>
          <Field id="repeat" label="Yangi parolni takrorlang" error={errors.repeat}>
            <Input
              id="repeat"
              type="password"
              autoComplete="new-password"
              value={form.repeat}
              onChange={(e) => setForm({ ...form, repeat: e.target.value })}
            />
          </Field>
          {errors.form && (
            <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
              {errors.form}
            </p>
          )}
          <Button type="submit" loading={m.isPending} disabled={!form.currentPassword || !form.newPassword}>
            Saqlash
          </Button>
        </form>
      </Card>
    </div>
  );
}
