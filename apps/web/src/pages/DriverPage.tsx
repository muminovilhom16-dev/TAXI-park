import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CRM_STATUSES,
  CRM_STATUS_LABELS,
  STATUSES_REQUIRING_REASON,
  formatDateTime,
  formatDay,
  type CrmStatus,
  type DriverDetail,
  type Paginated,
  type VehicleRow,
} from "@taxi/shared";
import { Archive, ArchiveRestore, ArrowLeft, Car, Link2, Pencil, RefreshCcw, Unlink } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { CrmStatusBadge, formatPhone, formatPlate, LicenseBadge } from "@/components/crm";
import { DriverFormDialog } from "@/components/DriverFormDialog";
import { DriverFinanceCard } from "@/components/DriverFinanceCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, Loading } from "@/components/ui/data-state";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormError } from "@/components/ui/form-error";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAggregators } from "@/lib/queries";
import { useFormMutation } from "@/lib/use-form-mutation";

type Dialogs = "edit" | "status" | "archive" | "account" | "vehicle" | null;

export function DriverPage() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialogs>(null);

  const q = useQuery({ queryKey: ["driver", id], queryFn: () => api<DriverDetail>(`/drivers/${id}`) });

  // Every action returns the fresh profile; put it straight into the cache.
  const saved = async (d: DriverDetail, message: string) => {
    qc.setQueryData(["driver", id], d);
    await qc.invalidateQueries({ queryKey: ["drivers"] });
    await qc.invalidateQueries({ queryKey: ["dashboard"] });
    toast.success(message);
    setDialog(null);
  };

  if (q.isPending) return <Loading />;
  if (q.isError) {
    const notFound = q.error instanceof ApiRequestError && q.error.status === 404;
    return (
      <ErrorState
        message={notFound ? "Haydovchi topilmadi yoki uni ko'rishga ruxsatingiz yo'q" : errorMessage(q.error)}
        onRetry={notFound ? undefined : () => q.refetch()}
      />
    );
  }
  const d = q.data;
  const writable = can("drivers.write") && !d.archivedAt;

  return (
    <div className="space-y-4">
      <Link to="/drivers" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Haydovchilar
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            {d.lastName} {d.firstName}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <CrmStatusBadge status={d.crmStatus} />
            {d.archivedAt && <Badge tone="neutral">Arxivda · {formatDateTime(d.archivedAt)}</Badge>}
            <span className="tabular">{formatPhone(d.phone)}</span>
          </div>
        </div>
        {can("drivers.write") && (
          <div className="flex flex-wrap gap-2">
            {writable && (
              <>
                <Button variant="secondary" onClick={() => setDialog("edit")}>
                  <Pencil className="h-4 w-4" /> Tahrirlash
                </Button>
                <Button variant="secondary" onClick={() => setDialog("status")}>
                  <RefreshCcw className="h-4 w-4" /> Holatni o'zgartirish
                </Button>
              </>
            )}
            {d.archivedAt ? (
              <UnarchiveButton id={d.id} onDone={(x) => saved(x, "Haydovchi arxivdan chiqarildi")} />
            ) : (
              <Button variant="secondary" onClick={() => setDialog("archive")}>
                <Archive className="h-4 w-4" /> Arxivlash
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold">Asosiy ma'lumotlar</h3>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Qo'shimcha aloqa">{d.extraContact ?? "—"}</Row>
            <Row label="Pasport">
              {d.piiHidden ? <span className="text-muted">Ko'rish uchun ruxsat yo'q</span> : (d.passportNumber ?? "—")}
            </Row>
            <Row label="Guvohnoma">
              <span className="flex flex-wrap items-center gap-2">
                {d.licenseNumber ?? "—"} <LicenseBadge status={d.licenseStatus} />
              </span>
            </Row>
            <Row label="Amal qilish muddati">{d.licenseExpiresOn ? formatDay(d.licenseExpiresOn) : "—"}</Row>
            <Row label="Ro'yxatdan o'tgan">{formatDay(d.registeredOn)}</Row>
            <Row label="Mas'ul menejer">{d.manager?.fullName ?? <span className="text-warning">Biriktirilmagan</span>}</Row>
          </dl>
          {d.note && <p className="mt-3 rounded-md bg-neutral-bg p-3 text-sm whitespace-pre-wrap">{d.note}</p>}
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Avtomobil</h3>
            {writable && can("drivers.read_all") && (
              <Button variant="ghost" size="sm" onClick={() => setDialog("vehicle")}>
                <Car className="h-4 w-4" /> {d.vehicle ? "Almashtirish" : "Biriktirish"}
              </Button>
            )}
          </div>
          {d.vehicle ? (
            <div className="space-y-2">
              <div className="tabular text-lg font-semibold">{formatPlate(d.vehicle.plateNumber)}</div>
              <div className="text-sm text-muted">{[d.vehicle.make, d.vehicle.model].filter(Boolean).join(" ")}</div>
              {writable && can("drivers.read_all") && (
                <UnassignVehicleButton id={d.id} onDone={(x) => saved(x, "Avtomobil bo'shatildi")} />
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">Biriktirilmagan</p>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Agregator hisoblari</h3>
          {writable && (
            <Button variant="ghost" size="sm" onClick={() => setDialog("account")}>
              <Link2 className="h-4 w-4" /> ID bog'lash
            </Button>
          )}
        </div>
        {d.allAccounts.length === 0 ? (
          <p className="text-sm text-warning">
            Agregatorga bog'lanmagan. Hisobot importida bu haydovchining qatorlari tanilmaydi.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted uppercase">
                <tr>
                  <th className="py-1 pr-4 font-medium">Agregator</th>
                  <th className="py-1 pr-4 font-medium">Tashqi ID</th>
                  <th className="py-1 pr-4 font-medium">Agregatordagi holat</th>
                  <th className="py-1 pr-4 font-medium">Bog'langan</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.allAccounts.map((a) => (
                  <tr key={a.id} className={a.unlinkedAt ? "text-muted" : ""}>
                    <td className="py-2 pr-4">{a.aggregator.name}</td>
                    <td className="tabular py-2 pr-4">{a.externalDriverId}</td>
                    <td className="py-2 pr-4">{a.externalStatus ?? "—"}</td>
                    <td className="tabular py-2 pr-4">
                      {formatDateTime(a.linkedAt)}
                      {a.unlinkedAt && ` — ${formatDateTime(a.unlinkedAt)} uzilgan`}
                    </td>
                    <td className="py-2 text-right">
                      {writable && !a.unlinkedAt && (
                        <UnlinkButton driverId={d.id} accountId={a.id} onDone={(x) => saved(x, "Hisob uzildi")} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Holat tarixi</h3>
          <ol className="space-y-3">
            {d.statusHistory.map((h) => (
              <li key={h.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {h.fromStatus && (
                    <>
                      <CrmStatusBadge status={h.fromStatus} /> →
                    </>
                  )}
                  <CrmStatusBadge status={h.toStatus} />
                </div>
                <div className="mt-1 text-xs text-muted">
                  {formatDateTime(h.createdAt)} · {h.changedBy?.fullName ?? "Tizim"}
                </div>
                {h.reason && <div className="mt-1">{h.reason}</div>}
              </li>
            ))}
          </ol>
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Avtomobillar tarixi</h3>
          {d.vehicleHistory.length === 0 ? (
            <p className="text-sm text-muted">Hali avtomobil biriktirilmagan</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {d.vehicleHistory.map((v) => (
                <li key={v.id}>
                  <span className="tabular font-medium">{formatPlate(v.vehicle.plateNumber)}</span> · {v.vehicle.model}
                  <div className="tabular text-xs text-muted">
                    {formatDateTime(v.assignedFrom)} — {v.assignedTo ? formatDateTime(v.assignedTo) : "hozirgacha"}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {can("finance.read") && <DriverFinanceCard driver={{ id: d.id, fullName: `${d.lastName} ${d.firstName}` }} />}

      {dialog === "edit" && (
        <DriverFormDialog open driver={d} onClose={() => setDialog(null)} onSaved={(x) => qc.setQueryData(["driver", id], x)} />
      )}
      {dialog === "status" && <StatusDialog driver={d} onClose={() => setDialog(null)} onDone={(x) => saved(x, "Holat o'zgartirildi")} />}
      {dialog === "archive" && <ArchiveDialog driver={d} onClose={() => setDialog(null)} onDone={(x) => saved(x, "Haydovchi arxivlandi")} />}
      {dialog === "account" && <AccountDialog driver={d} onClose={() => setDialog(null)} onDone={(x) => saved(x, "Agregator ID bog'landi")} />}
      {dialog === "vehicle" && <VehicleDialog driver={d} onClose={() => setDialog(null)} onDone={(x) => saved(x, "Avtomobil biriktirildi")} />}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-1.5 sm:block sm:border-0 sm:py-0">
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function StatusDialog({ driver, onClose, onDone }: { driver: DriverDetail; onClose: () => void; onDone: (d: DriverDetail) => void }) {
  const options = CRM_STATUSES.filter((s) => s !== driver.crmStatus);
  const [status, setStatus] = useState<CrmStatus>(options[0]!);
  const [reason, setReason] = useState("");
  const needsReason = STATUSES_REQUIRING_REASON.includes(status);
  const m = useFormMutation(
    () => api<DriverDetail>(`/drivers/${driver.id}/status`, { method: "POST", body: { status, reason: reason || null } }),
    onDone,
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Holatni o'zgartirish" description={`Hozir: ${CRM_STATUS_LABELS[driver.crmStatus]}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate(undefined);
        }}
      >
        <Field id="newStatus" label="Yangi holat">
          <Select id="newStatus" value={status} onChange={(e) => setStatus(e.target.value as CrmStatus)}>
            {options.map((s) => (
              <option key={s} value={s}>
                {CRM_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="reason" label={needsReason ? "Sabab (majburiy)" : "Sabab (ixtiyoriy)"} error={m.fieldErrors.reason}>
          <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!m.fieldErrors.reason} />
        </Field>
        <FormError message={m.formError} />
        <FormActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={m.isPending} disabled={needsReason && !reason.trim()}>
            Saqlash
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}

function ArchiveDialog({ driver, onClose, onDone }: { driver: DriverDetail; onClose: () => void; onDone: (d: DriverDetail) => void }) {
  const [reason, setReason] = useState("");
  const m = useFormMutation(() => api<DriverDetail>(`/drivers/${driver.id}/archive`, { method: "POST", body: { reason } }), onDone);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Haydovchini arxivlash"
      description="Haydovchi o'chirilmaydi: barcha tarix saqlanadi. Biriktirilgan avtomobil bo'shatiladi, telefon raqami boshqa haydovchiga berilishi mumkin bo'ladi."
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate(undefined);
        }}
      >
        <Field id="archiveReason" label="Sabab" error={m.fieldErrors.reason}>
          <Input id="archiveReason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <FormError message={m.formError} />
        <FormActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" variant="danger" loading={m.isPending} disabled={reason.trim().length < 3}>
            Arxivlash
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}

function AccountDialog({ driver, onClose, onDone }: { driver: DriverDetail; onClose: () => void; onDone: (d: DriverDetail) => void }) {
  const aggregators = useAggregators();
  const [aggregatorId, setAggregatorId] = useState("");
  const [externalDriverId, setExternalDriverId] = useState("");
  const m = useFormMutation(
    () =>
      api<DriverDetail>(`/drivers/${driver.id}/accounts`, {
        method: "POST",
        body: { aggregatorId, externalDriverId },
      }),
    onDone,
  );
  const active = aggregators.data?.filter((a) => a.isActive) ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Agregator ID bog'lash" description="Hisobot importida shu ID orqali qatorlar haydovchiga bog'lanadi.">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate(undefined);
        }}
      >
        <Field id="aggregator" label="Agregator" error={m.fieldErrors.aggregatorId}>
          <Select id="aggregator" value={aggregatorId} onChange={(e) => setAggregatorId(e.target.value)}>
            <option value="">Tanlang</option>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        {aggregators.isSuccess && active.length === 0 && (
          <p className="text-sm text-warning">Faol agregator yo'q. Avval "Agregatorlar" bo'limida qo'shing.</p>
        )}
        <Field id="externalId" label="Agregatordagi haydovchi ID" error={m.fieldErrors.externalDriverId}>
          <Input id="externalId" value={externalDriverId} onChange={(e) => setExternalDriverId(e.target.value)} />
        </Field>
        <FormError message={m.formError} />
        <FormActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={m.isPending} disabled={!aggregatorId || !externalDriverId.trim()}>
            Bog'lash
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}

function VehicleDialog({ driver, onClose, onDone }: { driver: DriverDetail; onClose: () => void; onDone: (d: DriverDetail) => void }) {
  const free = useQuery({
    queryKey: ["vehicles", { assigned: "false" }],
    queryFn: () => api<Paginated<VehicleRow>>("/vehicles", { query: { assigned: "false", pageSize: 100 } }),
  });
  const [vehicleId, setVehicleId] = useState("");
  const m = useFormMutation(
    () => api<DriverDetail>(`/drivers/${driver.id}/vehicle`, { method: "PUT", body: { vehicleId } }),
    onDone,
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Avtomobil biriktirish"
      description={driver.vehicle ? `Hozirgi ${formatPlate(driver.vehicle.plateNumber)} bo'shatiladi.` : undefined}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate(undefined);
        }}
      >
        <Field id="vehicle" label="Bo'sh avtomobillar">
          <Select id="vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Tanlang</option>
            {free.data?.items.map((v) => (
              <option key={v.id} value={v.id}>
                {formatPlate(v.plateNumber)} · {v.model}
              </option>
            ))}
          </Select>
        </Field>
        {free.isSuccess && free.data.items.length === 0 && (
          <p className="text-sm text-muted">
            Bo'sh avtomobil yo'q. <Link to="/vehicles" className="underline">Avtomobillar</Link> bo'limida qo'shing.
          </p>
        )}
        <FormError message={m.formError} />
        <FormActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={m.isPending} disabled={!vehicleId}>
            Biriktirish
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}

/** A button that asks once, then runs; used for small reversible actions. */
function ConfirmButton({
  label,
  confirmLabel,
  icon,
  run,
}: {
  label: string;
  confirmLabel: string;
  icon: ReactNode;
  run: () => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={armed ? "danger" : "ghost"}
      size="sm"
      loading={busy}
      onBlur={() => setArmed(false)}
      onClick={async () => {
        if (!armed) return setArmed(true);
        setBusy(true);
        try {
          await run();
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
    >
      {icon}
      {armed ? confirmLabel : label}
    </Button>
  );
}

function UnlinkButton({ driverId, accountId, onDone }: { driverId: string; accountId: string; onDone: (d: DriverDetail) => void }) {
  return (
    <ConfirmButton
      label="Uzish"
      confirmLabel="Tasdiqlang"
      icon={<Unlink className="h-4 w-4" />}
      run={async () => onDone(await api<DriverDetail>(`/drivers/${driverId}/accounts/${accountId}/unlink`, { method: "POST" }))}
    />
  );
}

function UnassignVehicleButton({ id, onDone }: { id: string; onDone: (d: DriverDetail) => void }) {
  return (
    <ConfirmButton
      label="Bo'shatish"
      confirmLabel="Tasdiqlang"
      icon={<Car className="h-4 w-4" />}
      run={async () => onDone(await api<DriverDetail>(`/drivers/${id}/vehicle`, { method: "DELETE" }))}
    />
  );
}

function UnarchiveButton({ id, onDone }: { id: string; onDone: (d: DriverDetail) => void }) {
  return (
    <ConfirmButton
      label="Arxivdan chiqarish"
      confirmLabel="Tasdiqlang"
      icon={<ArchiveRestore className="h-4 w-4" />}
      run={async () => onDone(await api<DriverDetail>(`/drivers/${id}/unarchive`, { method: "POST" }))}
    />
  );
}
