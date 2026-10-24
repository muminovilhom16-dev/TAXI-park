import { useQueryClient } from "@tanstack/react-query";
import {
  LICENSE_STATUSES,
  LICENSE_STATUS_LABELS,
  tashkentToday,
  type DriverDetail,
  type DuplicateMatch,
  type LicenseStatus,
} from "@taxi/shared";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormError } from "@/components/ui/form-error";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStaffOptions } from "@/lib/queries";
import { useFormMutation } from "@/lib/use-form-mutation";

type FormState = {
  lastName: string;
  firstName: string;
  phone: string;
  extraContact: string;
  passportNumber: string;
  licenseNumber: string;
  licenseStatus: LicenseStatus;
  licenseExpiresOn: string;
  registeredOn: string;
  managerId: string;
  note: string;
};

function initial(d?: DriverDetail): FormState {
  return {
    lastName: d?.lastName ?? "",
    firstName: d?.firstName ?? "",
    phone: d?.phone ?? "",
    extraContact: d?.extraContact ?? "",
    passportNumber: d?.passportNumber ?? "",
    licenseNumber: d?.licenseNumber ?? "",
    licenseStatus: d?.licenseStatus ?? "unknown",
    licenseExpiresOn: d?.licenseExpiresOn ?? "",
    registeredOn: d?.registeredOn ?? tashkentToday(),
    managerId: d?.manager?.id ?? "",
    note: d?.note ?? "",
  };
}

export function DriverFormDialog({
  open,
  driver,
  onClose,
  onSaved,
}: {
  open: boolean;
  driver?: DriverDetail;
  onClose: () => void;
  onSaved?: (d: DriverDetail) => void;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const staff = useStaffOptions();
  const [form, setForm] = useState<FormState>(() => initial(driver));
  const [dupes, setDupes] = useState<DuplicateMatch[]>([]);
  const editing = !!driver;
  const pii = can("drivers.pii.read");

  const close = () => {
    setForm(initial(driver));
    setDupes([]);
    onClose();
  };

  const m = useFormMutation(
    () => {
      const body = {
        lastName: form.lastName,
        firstName: form.firstName,
        phone: form.phone,
        extraContact: form.extraContact || null,
        licenseNumber: form.licenseNumber || null,
        licenseStatus: form.licenseStatus,
        licenseExpiresOn: form.licenseExpiresOn || null,
        registeredOn: form.registeredOn,
        note: form.note || null,
        ...(pii && { passportNumber: form.passportNumber || null }),
        ...(can("drivers.read_all") && { managerId: form.managerId || null }),
      };
      return editing
        ? api<DriverDetail>(`/drivers/${driver.id}`, { method: "PATCH", body })
        : api<DriverDetail>("/drivers", { method: "POST", body });
    },
    async (saved) => {
      await qc.invalidateQueries({ queryKey: ["drivers"] });
      await qc.invalidateQueries({ queryKey: ["driver", saved.id] });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(editing ? "O'zgarishlar saqlandi" : "Haydovchi qo'shildi");
      close();
      onSaved?.(saved);
    },
  );

  // A 409 carries the clashing drivers; show them next to the phone field.
  const conflictMatches =
    m.error instanceof ApiRequestError && m.error.status === 409
      ? ((m.error.details as { matches?: DuplicateMatch[] } | undefined)?.matches ?? [])
      : [];
  const shown = conflictMatches.length ? conflictMatches : dupes;

  async function checkPhone() {
    if (form.phone.replace(/\D/g, "").length < 9) return setDupes([]);
    const r = await api<{ matches: DuplicateMatch[] }>("/drivers/duplicates", {
      query: { phone: form.phone, excludeId: driver?.id },
    }).catch(() => ({ matches: [] }));
    setDupes(r.matches);
  }

  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const err = m.fieldErrors;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title={editing ? "Haydovchini tahrirlash" : "Yangi haydovchi"}>
      <form
        className="max-h-[70vh] space-y-3 overflow-y-auto pr-1"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          m.mutate(undefined);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="lastName" label="Familiya" error={err.lastName}>
            <Input id="lastName" value={form.lastName} onChange={set("lastName")} aria-invalid={!!err.lastName} />
          </Field>
          <Field id="firstName" label="Ism" error={err.firstName}>
            <Input id="firstName" value={form.firstName} onChange={set("firstName")} aria-invalid={!!err.firstName} />
          </Field>
        </div>
        <Field id="driverPhone" label="Telefon" error={err.phone}>
          <Input
            id="driverPhone"
            inputMode="tel"
            placeholder="+998 90 123 45 67"
            value={form.phone}
            onChange={set("phone")}
            onBlur={checkPhone}
            aria-invalid={!!err.phone}
          />
        </Field>
        {shown.length > 0 && (
          <div role="alert" className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
            Bu raqam boshqa haydovchida bor:{" "}
            {shown.map((d, i) => (
              <span key={d.driver.id}>
                {i > 0 && ", "}
                <Link className="underline" to={`/drivers/${d.driver.id}`} onClick={close}>
                  {d.driver.fullName}
                </Link>
                {d.driver.archived && " (arxivda)"}
              </span>
            ))}
          </div>
        )}
        <Field id="extraContact" label="Qo'shimcha aloqa (ixtiyoriy)" error={err.extraContact}>
          <Input id="extraContact" value={form.extraContact} onChange={set("extraContact")} />
        </Field>
        {pii ? (
          <Field id="passport" label="Pasport (ixtiyoriy)" error={err.passportNumber} hint="Faqat zarur bo'lsa kiriting">
            <Input id="passport" value={form.passportNumber} onChange={set("passportNumber")} />
          </Field>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="licenseNumber" label="Guvohnoma raqami" error={err.licenseNumber}>
            <Input id="licenseNumber" value={form.licenseNumber} onChange={set("licenseNumber")} />
          </Field>
          <Field id="licenseStatus" label="Guvohnoma holati">
            <Select id="licenseStatus" value={form.licenseStatus} onChange={set("licenseStatus")}>
              {LICENSE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LICENSE_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="licenseExpiresOn" label="Amal qilish muddati" error={err.licenseExpiresOn}>
            <Input id="licenseExpiresOn" type="date" value={form.licenseExpiresOn} onChange={set("licenseExpiresOn")} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="registeredOn" label="Ro'yxatdan o'tgan sana" error={err.registeredOn}>
            <Input id="registeredOn" type="date" value={form.registeredOn} onChange={set("registeredOn")} />
          </Field>
          {can("drivers.read_all") && (
            <Field id="managerId" label="Mas'ul menejer">
              <Select id="managerId" value={form.managerId} onChange={set("managerId")}>
                <option value="">Biriktirilmagan</option>
                {staff.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <Field id="note" label="Izoh" error={err.note}>
          <textarea
            id="note"
            className="min-h-20 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            value={form.note}
            onChange={set("note")}
          />
        </Field>
        <FormError message={m.formError} />
        <FormActions>
          <Button type="button" variant="secondary" onClick={close}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={m.isPending}>
            Saqlash
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
