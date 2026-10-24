import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  formatUzs,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type DriverListItem,
  type FinanceSettings,
  type Paginated,
} from "@taxi/shared";
import { FileDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { formatPhone } from "@/components/crm";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormError } from "@/components/ui/form-error";
import { api, apiUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced } from "@/lib/hooks";
import { useFormMutation } from "@/lib/use-form-mutation";
import { cn } from "@/lib/utils";

export function Money({ value, className, signed }: { value: string; className?: string; signed?: boolean }) {
  const negative = value.startsWith("-");
  return (
    <span className={cn("tabular whitespace-nowrap", signed && negative && "text-success", className)}>
      {formatUzs(value)}
    </span>
  );
}

export function useFinanceSettings() {
  const { can } = useAuth();
  return useQuery({
    queryKey: ["finance", "settings"],
    queryFn: () => api<FinanceSettings>("/finance/settings"),
    enabled: can("finance.read"),
    staleTime: 30_000,
  });
}

/** Invalidates every query whose numbers move when money moves. */
export function useInvalidateFinance() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [["earnings"], ["debts"], ["payments"], ["driver-finance"], ["dashboard"]].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );
}

// Calendar days in Tashkent time (UTC+5), as the API counts them.
export const todayIso = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
export const yesterdayIso = () => new Date(Date.now() + 5 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);

// crypto.randomUUID needs a secure context; getRandomValues works everywhere.
function randomKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Search-as-you-type driver selector over the drivers the user may see. */
export function DriverPicker({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: { id: string; fullName: string } | null;
  onChange: (d: { id: string; fullName: string } | null) => void;
  invalid?: boolean;
}) {
  const [q, setQ] = useState("");
  const search = useDebounced(q, 250);
  const results = useQuery({
    queryKey: ["drivers", "picker", search],
    queryFn: () => api<Paginated<DriverListItem>>("/drivers", { query: { q: search, pageSize: 8, archived: "false" } }),
    enabled: !value && search.trim().length >= 2,
  });
  if (value) {
    return (
      <div className="flex h-9 items-center justify-between rounded-md border border-border px-3 text-sm">
        <span className="font-medium">{value.fullName}</span>
        <button type="button" className="text-xs text-primary underline" onClick={() => onChange(null)}>
          O'zgartirish
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted" aria-hidden />
      <Input
        id={id}
        className="pl-9"
        placeholder="Ism, telefon yoki agregator ID (kamida 2 belgi)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-invalid={invalid}
        autoComplete="off"
      />
      {search.trim().length >= 2 && (
        <ul className="mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-surface text-sm shadow-sm" role="listbox">
          {results.isPending ? (
            <li className="px-3 py-2 text-muted">Qidirilmoqda…</li>
          ) : results.data?.items.length ? (
            results.data.items.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="w-full px-3 py-2 text-left hover:bg-neutral-bg"
                  onClick={() => onChange({ id: d.id, fullName: `${d.lastName} ${d.firstName}` })}
                >
                  {d.lastName} {d.firstName}
                  <span className="tabular ml-2 text-xs text-muted">{formatPhone(d.phone)}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-muted">Topilmadi</li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Records a driver's payment toward their debt. It counts once approved. */
export function PaymentDialog({
  driver,
  onClose,
}: {
  driver?: { id: string; fullName: string } | null;
  onClose: () => void;
}) {
  const invalidate = useInvalidateFinance();
  // One key per opened form: a double click or a retried request records one payment.
  const idempotencyKey = useMemo(randomKey, []);
  const [picked, setPicked] = useState(driver ?? null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("cash");
  const [note, setNote] = useState("");
  const m = useFormMutation(
    () =>
      api("/payments", {
        method: "POST",
        body: { driverId: picked?.id, amount, paymentMethod: method, note: note || null, idempotencyKey },
      }),
    async () => {
      await invalidate();
      toast.success("To'lov kiritildi. U tasdiqlangach qarzdan ayriladi");
      onClose();
    },
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="To'lov qabul qilish"
      description="Haydovchi parkka to'lagan pul. Boshqa xodim tasdiqlagandan keyin qarzdan ayriladi."
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate(undefined);
        }}
      >
        <Field id="payDriver" label="Haydovchi" error={m.fieldErrors.driverId}>
          <DriverPicker id="payDriver" value={picked} onChange={setPicked} invalid={!!m.fieldErrors.driverId} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="payAmount" label="Summa, so'm" error={m.fieldErrors.amount}>
            <Input
              id="payAmount"
              inputMode="decimal"
              placeholder="50 000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={!!m.fieldErrors.amount}
            />
          </Field>
          <Field id="payMethod" label="To'lov usuli">
            <Select id="payMethod" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              {PAYMENT_METHODS.map((p) => (
                <option key={p} value={p}>
                  {PAYMENT_METHOD_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field id="payNote" label="Izoh (ixtiyoriy)">
          <Input id="payNote" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <FormError message={m.formError} />
        <FormActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={m.isPending} disabled={!picked || !amount.trim()}>
            Saqlash
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}

/** Asks for a written reason, then runs a void/reverse/reject style action. */
export function ReasonDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const m = useFormMutation(() => onConfirm(reason.trim()), onClose);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title} description={description}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate(undefined);
        }}
      >
        <Field id="reason" label="Sabab" error={m.fieldErrors.reason}>
          <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <FormError message={m.formError} />
        <FormActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" variant="danger" loading={m.isPending} disabled={reason.trim().length < 3}>
            {confirmLabel}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}

/** Downloads a CSV export; shown only with the export right. */
export function ExportButton({ path, query }: { path: string; query?: Record<string, unknown> }) {
  const { can } = useAuth();
  if (!can("reports.export")) return null;
  return (
    <Button variant="secondary" asChild>
      <a href={apiUrl(path, query)} download>
        <FileDown className="h-4 w-4" /> Excel (CSV)
      </a>
    </Button>
  );
}
