import { useQueryClient } from "@tanstack/react-query";
import {
  INTEGRATION_LABELS,
  INTEGRATION_STATUSES,
  MONEY_FLOW_LABELS,
  MONEY_FLOW_MODELS,
  type AggregatorRow,
  type MoneyFlowModel,
} from "@taxi/shared";
import { AlertTriangle, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, ErrorState, Loading } from "@/components/ui/data-state";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormError } from "@/components/ui/form-error";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAggregators } from "@/lib/queries";
import { useFormMutation } from "@/lib/use-form-mutation";

export function AggregatorsPage() {
  const { can } = useAuth();
  const list = useAggregators();
  const [editing, setEditing] = useState<AggregatorRow | "new" | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Pul oqimi modeli kim kimga qarzdor ekanini belgilaydi. U tasdiqlanmaguncha hisob-kitoblar avtomatik tasdiqlanmaydi.
          Uni faqat park egasi o'zgartira oladi.
        </p>
        {can("aggregators.manage") && (
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Agregator qo'shish
          </Button>
        )}
      </div>
      <Card className="overflow-hidden">
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : list.data.length === 0 ? (
          <Empty title="Agregator qo'shilmagan" hint="Masalan: Yandex Go yoki MyTaxi" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-bg text-left text-xs text-muted uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Agregator</th>
                  <th className="px-4 py-2 font-medium">Pul oqimi</th>
                  <th className="px-4 py-2 font-medium">Integratsiya</th>
                  <th className="px-4 py-2 text-right font-medium">Bog'langan haydovchilar</th>
                  <th className="px-4 py-2 font-medium">Holat</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.data.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-muted">{a.code}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      {a.moneyFlowModel === "unconfirmed" ? (
                        <Badge tone="warning">
                          <AlertTriangle className="mr-1 h-3 w-3" /> Tasdiqlanmagan
                        </Badge>
                      ) : (
                        MONEY_FLOW_LABELS[a.moneyFlowModel]
                      )}
                    </td>
                    <td className="px-4 py-2.5">{INTEGRATION_LABELS[a.integrationStatus]}</td>
                    <td className="tabular px-4 py-2.5 text-right">{a.linkedDrivers}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={a.isActive ? "success" : "neutral"}>{a.isActive ? "Faol" : "Faol emas"}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {can("aggregators.manage") && (
                        <Button variant="ghost" size="icon" onClick={() => setEditing(a)} aria-label={`${a.name}: tahrirlash`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <AggregatorDialog aggregator={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AggregatorDialog({ aggregator, onClose }: { aggregator?: AggregatorRow; onClose: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    code: aggregator?.code ?? "",
    name: aggregator?.name ?? "",
    isActive: aggregator?.isActive ?? true,
    moneyFlowModel: aggregator?.moneyFlowModel ?? ("unconfirmed" as MoneyFlowModel),
    integrationStatus: aggregator?.integrationStatus ?? "file_import",
    note: aggregator?.note ?? "",
  });
  const [confirmFlow, setConfirmFlow] = useState(false);
  const flowChanged = form.moneyFlowModel !== (aggregator?.moneyFlowModel ?? "unconfirmed");
  const canFlow = can("settings.manage");

  const m = useFormMutation(
    () => {
      const body = {
        name: form.name,
        isActive: form.isActive,
        integrationStatus: form.integrationStatus,
        note: form.note || null,
        ...(flowChanged && { moneyFlowModel: form.moneyFlowModel }),
      };
      return aggregator
        ? api(`/aggregators/${aggregator.id}`, { method: "PATCH", body })
        : api("/aggregators", { method: "POST", body: { ...body, code: form.code } });
    },
    async () => {
      await qc.invalidateQueries({ queryKey: ["aggregators"] });
      toast.success("Saqlandi");
      onClose();
    },
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={aggregator ? "Agregatorni tahrirlash" : "Yangi agregator"}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (flowChanged && !confirmFlow) return setConfirmFlow(true);
          m.mutate(undefined);
        }}
      >
        {!aggregator && (
          <Field id="aggCode" label="Kod" error={m.fieldErrors.code} hint="Ichki qisqa nom, masalan: yandex">
            <Input id="aggCode" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
        )}
        <Field id="aggName" label="Nomi" error={m.fieldErrors.name}>
          <Input id="aggName" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field
          id="aggFlow"
          label="Pul oqimi modeli"
          hint={canFlow ? "Agregator shartnomasi bo'yicha tekshirib tanlang" : "Faqat park egasi o'zgartira oladi"}
        >
          <Select
            id="aggFlow"
            disabled={!canFlow}
            value={form.moneyFlowModel}
            onChange={(e) => {
              setConfirmFlow(false);
              setForm({ ...form, moneyFlowModel: e.target.value as MoneyFlowModel });
            }}
          >
            {MONEY_FLOW_MODELS.map((f) => (
              <option key={f} value={f}>
                {MONEY_FLOW_LABELS[f]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="aggIntegration" label="Ma'lumot olish usuli">
          <Select
            id="aggIntegration"
            value={form.integrationStatus}
            onChange={(e) => setForm({ ...form, integrationStatus: e.target.value as typeof form.integrationStatus })}
          >
            {INTEGRATION_STATUSES.filter((s) => s !== "api").map((s) => (
              <option key={s} value={s}>
                {INTEGRATION_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Faol
        </label>
        <Field id="aggNote" label="Izoh">
          <Input id="aggNote" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        {confirmFlow && (
          <p role="alert" className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
            Pul oqimi modeli o'zgaradi. Bu keyingi hisob-kitoblarda kim kimga qarzdor ekanini belgilaydi va auditga yoziladi.
            Tasdiqlash uchun yana "Saqlash" tugmasini bosing.
          </p>
        )}
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
