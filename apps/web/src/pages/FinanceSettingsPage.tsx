import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  COMMISSION_COLLECTION_LABELS,
  COMMISSION_COLLECTION_MODES,
  formatDay,
  formatUzs,
  SUBSCRIPTION_CHARGE_MODE_LABELS,
  SUBSCRIPTION_CHARGE_MODES,
  type CommissionCollectionMode,
  type CommissionPolicyRow,
  type FinanceSettings,
  type SubscriptionChargeMode,
} from "@taxi/shared";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { todayIso, useFinanceSettings } from "@/components/finance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, Loading } from "@/components/ui/data-state";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormError } from "@/components/ui/form-error";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAggregators } from "@/lib/queries";
import { useFormMutation } from "@/lib/use-form-mutation";

export function FinanceSettingsPage() {
  const { can } = useAuth();
  const settings = useFinanceSettings();
  const policies = useQuery({
    queryKey: ["commission-policies"],
    queryFn: () => api<{ items: CommissionPolicyRow[] }>("/commission-policies").then((r) => r.items),
  });
  const [addingRate, setAddingRate] = useState(false);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Komissiya stavkasi</h3>
          {can("commission.manage") && (
            <Button size="sm" variant="secondary" onClick={() => setAddingRate(true)}>
              <Plus className="h-4 w-4" /> Yangi stavka
            </Button>
          )}
        </div>
        <p className="mb-3 text-sm text-muted">
          Haydovchining kunlik tushumidan olinadi. Stavka o'zgarsa, eski kunlar eski stavkada qoladi: har bir yozuv o'z stavkasini
          saqlaydi.
        </p>
        {policies.isPending ? (
          <Loading />
        ) : policies.isError ? (
          <ErrorState message={errorMessage(policies.error)} onRetry={() => policies.refetch()} />
        ) : policies.data.length === 0 ? (
          <p className="rounded-md bg-warning-bg p-3 text-sm text-warning">
            Stavka kiritilmagan. Usiz kunlik tushum kiritib bo'lmaydi.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted uppercase">
              <tr>
                <th className="py-1 pr-3 font-medium">Agregator</th>
                <th className="py-1 pr-3 font-medium">Stavka</th>
                <th className="py-1 font-medium">Amal qiladi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {policies.data.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 pr-3">{p.aggregator}</td>
                  <td className="tabular py-2 pr-3 font-medium">{Number(p.ratePercent)}%</td>
                  <td className="tabular py-2">
                    {formatDay(p.validFrom)} — {p.validTo ? formatDay(p.validTo) : <Badge tone="success">hozir</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">Kunlik obuna va komissiyani yig'ish</h3>
        {settings.isPending ? (
          <Loading />
        ) : settings.isError ? (
          <ErrorState message={errorMessage(settings.error)} onRetry={() => settings.refetch()} />
        ) : (
          <SettingsForm settings={settings.data} editable={can("settings.manage")} />
        )}
      </Card>
      {addingRate && <RateDialog onClose={() => setAddingRate(false)} />}
    </div>
  );
}

function SettingsForm({ settings, editable }: { settings: FinanceSettings; editable: boolean }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(settings.subscriptionDailyAmount ? formatUzs(settings.subscriptionDailyAmount, { withCurrency: false }) : "");
  const [mode, setMode] = useState<SubscriptionChargeMode | "">(settings.subscriptionChargeMode ?? "");
  const [collection, setCollection] = useState<CommissionCollectionMode>(settings.commissionCollection);
  const m = useFormMutation(
    () =>
      api<FinanceSettings>("/finance/settings", {
        method: "PUT",
        body: { subscriptionDailyAmount: amount.trim() || null, subscriptionChargeMode: mode || null, commissionCollection: collection },
      }),
    async () => {
      await qc.invalidateQueries({ queryKey: ["finance"] });
      await qc.invalidateQueries({ queryKey: ["debts"] });
      toast.success("Sozlamalar saqlandi");
    },
  );
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate(undefined);
      }}
    >
      {!settings.subscriptionEnabled && (
        <p className="rounded-md bg-warning-bg p-3 text-sm text-warning">
          Obuna summasi yoki hisoblash tartibi kiritilmagan, shuning uchun obuna hisoblanmayapti.
        </p>
      )}
      <fieldset disabled={!editable} className="space-y-3">
        <Field id="subAmount" label="Kunlik obuna, so'm" error={m.fieldErrors.subscriptionDailyAmount} hint="Bo'sh qoldirilsa, obuna hisoblanmaydi">
          <Input id="subAmount" inputMode="decimal" placeholder="50 000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id="subMode" label="Obuna qaysi kunlari yoziladi">
          <Select id="subMode" value={mode} onChange={(e) => setMode(e.target.value as SubscriptionChargeMode | "")}>
            <option value="">Tanlanmagan</option>
            {SUBSCRIPTION_CHARGE_MODES.map((m) => (
              <option key={m} value={m}>
                {SUBSCRIPTION_CHARGE_MODE_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="collection" label="Park komissiyasini kim to'laydi">
          <Select id="collection" value={collection} onChange={(e) => setCollection(e.target.value as CommissionCollectionMode)}>
            {COMMISSION_COLLECTION_MODES.map((m) => (
              <option key={m} value={m}>
                {COMMISSION_COLLECTION_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>
      <p className="text-xs text-muted">
        Birinchi tartibda obuna holati "Faol" bo'lgan haydovchilarga har kuni avtomatik yoziladi. Ikkinchisida tushum
        kiritilganda yoziladi. O'zgarish faqat keyingi yozuvlarga ta'sir qiladi.
      </p>
      {editable ? (
        <>
          <FormError message={m.formError} />
          <FormActions>
            <Button type="submit" loading={m.isPending}>
              Saqlash
            </Button>
          </FormActions>
        </>
      ) : (
        <p className="text-xs text-muted">Faqat egasi o'zgartira oladi.</p>
      )}
    </form>
  );
}

function RateDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const aggs = useAggregators();
  const [aggregatorId, setAggregatorId] = useState(aggs.data?.length === 1 ? aggs.data[0]!.id : "");
  const [ratePercent, setRatePercent] = useState("10");
  const [validFrom, setValidFrom] = useState(todayIso);
  const m = useFormMutation(
    () => api("/commission-policies", { method: "POST", body: { aggregatorId, ratePercent, validFrom } }),
    async () => {
      await qc.invalidateQueries({ queryKey: ["commission-policies"] });
      toast.success("Stavka saqlandi");
      onClose();
    },
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Yangi komissiya stavkasi"
      description="Tanlangan sanadan boshlab amal qiladi. Oldingi stavka shu sanada yopiladi, oldingi kunlarning hisobi o'zgarmaydi."
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate(undefined);
        }}
      >
        <Field id="rateAgg" label="Agregator" error={m.fieldErrors.aggregatorId}>
          <Select id="rateAgg" value={aggregatorId} onChange={(e) => setAggregatorId(e.target.value)}>
            <option value="">Tanlang</option>
            {aggs.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="rate" label="Stavka, %" error={m.fieldErrors.ratePercent}>
            <Input id="rate" inputMode="decimal" value={ratePercent} onChange={(e) => setRatePercent(e.target.value)} />
          </Field>
          <Field id="rateFrom" label="Qaysi sanadan" error={m.fieldErrors.validFrom}>
            <Input id="rateFrom" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
        </div>
        <FormError message={m.formError} />
        <FormActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={m.isPending} disabled={!aggregatorId}>
            Saqlash
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
