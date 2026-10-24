import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Paginated, VehicleRow } from "@taxi/shared";
import { Archive, Pencil, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { formatPlate } from "@/components/crm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, ErrorState, Loading } from "@/components/ui/data-state";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormError } from "@/components/ui/form-error";
import { Pagination } from "@/components/ui/pagination";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced } from "@/lib/hooks";
import { useFormMutation } from "@/lib/use-form-mutation";

const PAGE_SIZE = 25;

export function VehiclesPage() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [assigned, setAssigned] = useState("");
  const [archived, setArchived] = useState("false");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<VehicleRow | "new" | null>(null);
  const [archiving, setArchiving] = useState<VehicleRow | null>(null);
  const search = useDebounced(q, 300);
  const query = { q: search, assigned, archived, page, pageSize: PAGE_SIZE };
  const list = useQuery({
    queryKey: ["vehicles", query],
    queryFn: () => api<Paginated<VehicleRow>>("/vehicles", { query }),
    placeholderData: keepPreviousData,
  });
  const writable = can("drivers.write");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted" aria-hidden />
          <Input
            aria-label="Qidirish"
            placeholder="Davlat raqami yoki model"
            className="pl-9"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select aria-label="Biriktirilganlik" className="w-[calc(50%-0.375rem)] sm:w-44" value={assigned} onChange={(e) => (setAssigned(e.target.value), setPage(1))}>
          <option value="">Hammasi</option>
          <option value="true">Haydovchida</option>
          <option value="false">Bo'sh</option>
        </Select>
        <Select aria-label="Arxiv" className="w-[calc(50%-0.375rem)] sm:w-36" value={archived} onChange={(e) => (setArchived(e.target.value), setPage(1))}>
          <option value="false">Faol ro'yxat</option>
          <option value="true">Arxiv</option>
        </Select>
        {writable && (
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Avtomobil qo'shish
          </Button>
        )}
      </div>
      <Card className="overflow-hidden">
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <Empty title="Avtomobil topilmadi" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-bg text-left text-xs text-muted uppercase">
                  <tr>
                    <th className="px-4 py-2 font-medium">Davlat raqami</th>
                    <th className="px-4 py-2 font-medium">Avtomobil</th>
                    <th className="px-4 py-2 font-medium">Haydovchi</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.data.items.map((v) => (
                    <tr key={v.id}>
                      <td className="tabular px-4 py-2.5 font-medium">{formatPlate(v.plateNumber)}</td>
                      <td className="px-4 py-2.5">
                        {[v.make, v.model].filter(Boolean).join(" ")}
                        <div className="text-xs text-muted">{[v.year, v.color].filter(Boolean).join(" · ") || "—"}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        {v.driver ? (
                          <Link className="hover:underline" to={`/drivers/${v.driver.id}`}>
                            {v.driver.fullName}
                          </Link>
                        ) : (
                          <span className="text-muted">Bo'sh</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {writable && !v.archivedAt && (
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => setEditing(v)} aria-label={`${v.plateNumber}: tahrirlash`}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {!v.driver && (
                              <Button variant="ghost" size="icon" onClick={() => setArchiving(v)} aria-label={`${v.plateNumber}: arxivlash`}>
                                <Archive className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        )}
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
      {editing && <VehicleDialog vehicle={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {archiving && <ArchiveVehicleDialog vehicle={archiving} onClose={() => setArchiving(null)} />}
    </div>
  );
}

function VehicleDialog({ vehicle, onClose }: { vehicle?: VehicleRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    plateNumber: vehicle ? formatPlate(vehicle.plateNumber) : "",
    make: vehicle?.make ?? "",
    model: vehicle?.model ?? "",
    year: vehicle?.year ? String(vehicle.year) : "",
    color: vehicle?.color ?? "",
    note: vehicle?.note ?? "",
  });
  const m = useFormMutation(
    () => {
      const body = { ...form, make: form.make || null, year: form.year || null, color: form.color || null, note: form.note || null };
      return vehicle ? api(`/vehicles/${vehicle.id}`, { method: "PATCH", body }) : api("/vehicles", { method: "POST", body });
    },
    async () => {
      await qc.invalidateQueries({ queryKey: ["vehicles"] });
      toast.success("Saqlandi");
      onClose();
    },
  );
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={vehicle ? "Avtomobilni tahrirlash" : "Yangi avtomobil"}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate(undefined);
        }}
      >
        <Field id="plate" label="Davlat raqami" error={m.fieldErrors.plateNumber} hint="Masalan: 01 A 123 BC">
          <Input id="plate" value={form.plateNumber} onChange={set("plateNumber")} aria-invalid={!!m.fieldErrors.plateNumber} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="make" label="Marka" error={m.fieldErrors.make}>
            <Input id="make" placeholder="Chevrolet" value={form.make} onChange={set("make")} />
          </Field>
          <Field id="model" label="Model" error={m.fieldErrors.model}>
            <Input id="model" placeholder="Cobalt" value={form.model} onChange={set("model")} aria-invalid={!!m.fieldErrors.model} />
          </Field>
          <Field id="year" label="Yil" error={m.fieldErrors.year}>
            <Input id="year" inputMode="numeric" value={form.year} onChange={set("year")} />
          </Field>
          <Field id="color" label="Rang">
            <Input id="color" value={form.color} onChange={set("color")} />
          </Field>
        </div>
        <Field id="vehNote" label="Izoh">
          <Input id="vehNote" value={form.note} onChange={set("note")} />
        </Field>
        <FormError message={m.formError} />
        <FormActions>
          <Button type="button" variant="secondary" onClick={onClose}>
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

function ArchiveVehicleDialog({ vehicle, onClose }: { vehicle: VehicleRow; onClose: () => void }) {
  const qc = useQueryClient();
  const m = useFormMutation(
    () => api(`/vehicles/${vehicle.id}/archive`, { method: "POST" }),
    async () => {
      await qc.invalidateQueries({ queryKey: ["vehicles"] });
      toast.success("Avtomobil arxivlandi");
      onClose();
    },
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Avtomobilni arxivlash"
      description={`${formatPlate(vehicle.plateNumber)} ro'yxatdan olinadi, tarixi saqlanadi.`}
    >
      <FormError message={m.formError} />
      <FormActions>
        <Button variant="secondary" onClick={onClose}>
          Bekor qilish
        </Button>
        <Button variant="danger" loading={m.isPending} onClick={() => m.mutate(undefined)}>
          Arxivlash
        </Button>
      </FormActions>
    </Dialog>
  );
}
