import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  formatDay,
  formatUzs,
  type EarningRow,
  type EarningTotals,
  type ImportPreview,
} from "@taxi/shared";
import { Ban, CalendarCheck, Download, Plus, Upload } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import {
  DriverPicker,
  ExportButton,
  Money,
  ReasonDialog,
  todayIso,
  useFinanceSettings,
  useInvalidateFinance,
  yesterdayIso,
} from "@/components/finance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, ErrorState, Loading } from "@/components/ui/data-state";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormError } from "@/components/ui/form-error";
import { Pagination } from "@/components/ui/pagination";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAggregators } from "@/lib/queries";
import { useFormMutation } from "@/lib/use-form-mutation";

const PAGE_SIZE = 50;
const weekAgo = () => new Date(Date.now() + 5 * 3_600_000 - 6 * 86_400_000).toISOString().slice(0, 10);

export function EarningsPage() {
  const { can } = useAuth();
  const aggs = useAggregators();
  const settings = useFinanceSettings();
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(todayIso);
  const [aggregatorId, setAggregatorId] = useState("");
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<"add" | "import" | "accrue" | null>(null);
  const [voiding, setVoiding] = useState<EarningRow | null>(null);
  const invalidate = useInvalidateFinance();

  const query = { from, to, aggregatorId, status, page, pageSize: PAGE_SIZE };
  const list = useQuery({
    queryKey: ["earnings", query],
    queryFn: () => api<{ items: EarningRow[]; total: number; totals: EarningTotals }>("/earnings", { query }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex w-[calc(50%-0.375rem)] flex-col gap-1 text-xs text-muted sm:w-40">
          Sanadan
          <Input id="from" type="date" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} />
        </label>
        <label className="flex w-[calc(50%-0.375rem)] flex-col gap-1 text-xs text-muted sm:w-40">
          Sanagacha
          <Input id="to" type="date" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} />
        </label>
        <Select aria-label="Agregator" className="w-[calc(50%-0.375rem)] sm:w-40" value={aggregatorId} onChange={(e) => (setAggregatorId(e.target.value), setPage(1))}>
          <option value="">Barcha agregatorlar</option>
          {aggs.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Holat" className="w-[calc(50%-0.375rem)] sm:w-40" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="active">Amaldagilar</option>
          <option value="voided">Bekor qilinganlar</option>
          <option value="all">Hammasi</option>
        </Select>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <ExportButton path="/earnings/export" query={{ from, to, aggregatorId, status }} />
          {can("settlements.prepare") && settings.data?.subscriptionEnabled && (
            <Button variant="secondary" onClick={() => setDialog("accrue")}>
              <CalendarCheck className="h-4 w-4" /> Obunani hisoblash
            </Button>
          )}
          {can("imports.run") && (
            <>
              <Button variant="secondary" onClick={() => setDialog("import")}>
                <Upload className="h-4 w-4" /> CSV yuklash
              </Button>
              <Button onClick={() => setDialog("add")}>
                <Plus className="h-4 w-4" /> Tushum kiritish
              </Button>
            </>
          )}
        </div>
      </div>

      {list.data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Card className="hidden p-4 sm:block">
            <div className="text-xs text-muted">Yozuvlar</div>
            <div className="tabular mt-1 text-xl font-semibold">{list.data.totals.count}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted">Haydovchilar tushumi</div>
            <Money className="mt-1 block text-xl font-semibold" value={list.data.totals.grossAmount} />
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted">Park komissiyasi</div>
            <Money className="mt-1 block text-xl font-semibold text-primary" value={list.data.totals.commissionAmount} />
          </Card>
        </div>
      )}

      <Card className="overflow-hidden">
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <Empty title="Bu davrda tushum kiritilmagan" hint={can("imports.run") ? "Qo'lda kiriting yoki CSV fayl yuklang" : undefined} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-bg text-left text-xs text-muted uppercase">
                  <tr>
                    <th className="px-4 py-2 font-medium">Sana</th>
                    <th className="px-4 py-2 font-medium">Haydovchi</th>
                    <th className="px-4 py-2 font-medium">Agregator</th>
                    <th className="px-4 py-2 text-right font-medium">Tushum</th>
                    <th className="px-4 py-2 text-right font-medium">Komissiya</th>
                    <th className="px-4 py-2 font-medium">Kiritdi</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.data.items.map((e) => (
                    <tr key={e.id} className={e.status === "voided" ? "text-muted line-through decoration-muted/50" : ""}>
                      <td className="tabular px-4 py-2.5 whitespace-nowrap">{formatDay(e.workDate)}</td>
                      <td className="px-4 py-2.5">
                        <Link className="hover:underline" to={`/drivers/${e.driver.id}`}>
                          {e.driver.fullName}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">{e.aggregator.name}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Money value={e.grossAmount} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money value={e.commissionAmount} />
                        <div className="text-xs text-muted">{Number(e.commissionRatePercent)}%</div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted">
                        {e.createdBy}
                        {e.source === "csv" && <Badge className="ml-1">CSV</Badge>}
                        {e.voidReason && <div className="no-underline">Bekor: {e.voidReason}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {e.status === "active" && can("settlements.approve") && (
                          <Button variant="ghost" size="icon" onClick={() => setVoiding(e)} aria-label={`${e.driver.fullName}: bekor qilish`}>
                            <Ban className="h-4 w-4" />
                          </Button>
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

      {dialog === "add" && <EarningDialog onClose={() => setDialog(null)} />}
      {dialog === "import" && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog === "accrue" && <AccrueDialog onClose={() => setDialog(null)} />}
      {voiding && (
        <ReasonDialog
          title="Tushumni bekor qilish"
          description={`${voiding.driver.fullName}, ${formatDay(voiding.workDate)}: ${formatUzs(voiding.grossAmount)}. Yozuv o'chmaydi, bekor qilingan deb belgilanadi. To'g'ri summani keyin qaytadan kiriting.`}
          confirmLabel="Bekor qilish"
          onConfirm={async (reason) => {
            await api(`/earnings/${voiding.id}/void`, { method: "POST", body: { reason } });
            await invalidate();
            toast.success("Tushum bekor qilindi");
          }}
          onClose={() => setVoiding(null)}
        />
      )}
    </div>
  );
}

function AggregatorSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const aggs = useAggregators();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Tanlang</option>
      {aggs.data?.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </Select>
  );
}

function EarningDialog({ onClose }: { onClose: () => void }) {
  const invalidate = useInvalidateFinance();
  const aggs = useAggregators();
  const [driver, setDriver] = useState<{ id: string; fullName: string } | null>(null);
  const [aggregatorId, setAggregatorId] = useState(aggs.data?.length === 1 ? aggs.data[0]!.id : "");
  const [workDate, setWorkDate] = useState(yesterdayIso);
  const [grossAmount, setGrossAmount] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(0);
  const m = useFormMutation(
    () =>
      api<EarningRow & { commissionAmount: string }>("/earnings", {
        method: "POST",
        body: { driverId: driver?.id, aggregatorId, workDate, grossAmount, note: note || null },
      }),
    async (row) => {
      await invalidate();
      toast.success(`Saqlandi. Komissiya: ${formatUzs(row.commissionAmount)}`);
      // Stay open for the next driver of the same day: that is how a day is entered.
      setDriver(null);
      setGrossAmount("");
      setNote("");
      setSaved((n) => n + 1);
    },
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Kunlik tushum kiritish"
      description="Haydovchining bir kunlik umumiy tushumi. Komissiya shu kungi stavka bo'yicha avtomatik hisoblanadi."
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate(undefined);
        }}
      >
        <Field id="earnDriver" label="Haydovchi" error={m.fieldErrors.driverId}>
          <DriverPicker key={saved} id="earnDriver" value={driver} onChange={setDriver} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="earnAgg" label="Agregator" error={m.fieldErrors.aggregatorId}>
            <AggregatorSelect id="earnAgg" value={aggregatorId} onChange={setAggregatorId} />
          </Field>
          <Field id="earnDate" label="Ish kuni" error={m.fieldErrors.workDate}>
            <Input id="earnDate" type="date" max={todayIso()} value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
          </Field>
        </div>
        <Field id="earnAmount" label="Tushum, so'm" error={m.fieldErrors.grossAmount}>
          <Input
            id="earnAmount"
            inputMode="decimal"
            placeholder="350 000"
            value={grossAmount}
            onChange={(e) => setGrossAmount(e.target.value)}
            aria-invalid={!!m.fieldErrors.grossAmount}
          />
        </Field>
        <Field id="earnNote" label="Izoh (ixtiyoriy)">
          <Input id="earnNote" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <FormError message={m.formError} />
        <FormActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            {saved ? "Yopish" : "Bekor qilish"}
          </Button>
          <Button type="submit" loading={m.isPending} disabled={!driver || !aggregatorId || !grossAmount.trim()}>
            Saqlash
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}

const TEMPLATE = "sana;agregator_id;summa\n2026-10-23;12345;350000\n2026-10-23;67890;280000\n";

const STATUS_LABEL = {
  valid: { label: "Kiritiladi", tone: "success" },
  invalid: { label: "Xato", tone: "danger" },
  unknown_driver: { label: "Haydovchi topilmadi", tone: "warning" },
  duplicate: { label: "Allaqachon bor", tone: "neutral" },
} as const;

function ImportDialog({ onClose }: { onClose: () => void }) {
  const invalidate = useInvalidateFinance();
  const aggs = useAggregators();
  const [aggregatorId, setAggregatorId] = useState(aggs.data?.length === 1 ? aggs.data[0]!.id : "");
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const check = useFormMutation(
    () => api<ImportPreview>("/earnings/import/preview", { method: "POST", body: { aggregatorId, fileName: file!.name, content: file!.content } }),
    (p) => setPreview(p),
  );
  const commit = useFormMutation(
    () =>
      api<{ imported: number }>("/earnings/import/commit", {
        method: "POST",
        body: { aggregatorId, fileName: file!.name, content: file!.content, sha256: preview!.sha256 },
      }),
    async (r) => {
      await invalidate();
      toast.success(`${r.imported} ta qator kiritildi`);
      onClose();
    },
  );

  const download = () => {
    const url = URL.createObjectURL(new Blob(["﻿" + TEMPLATE], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "kunlik-tushum-namuna.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title="CSV fayldan tushum yuklash"
      description="Har qatorda bitta haydovchining bir kunlik tushumi: sana, agregator ID (yoki telefon) va summa. Avval tekshiriladi, keyin faqat to'g'ri qatorlar kiritiladi."
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="impAgg" label="Agregator">
            <AggregatorSelect id="impAgg" value={aggregatorId} onChange={(v) => (setAggregatorId(v), setPreview(null))} />
          </Field>
          <Field id="impFile" label="Fayl (.csv)">
            <Input
              id="impFile"
              type="file"
              accept=".csv,text/csv"
              className="pt-1.5"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setPreview(null);
                setFile(f ? { name: f.name, content: await f.text() } : null);
              }}
            />
          </Field>
        </div>
        <button type="button" className="inline-flex items-center gap-1 text-sm text-primary underline" onClick={download}>
          <Download className="h-4 w-4" /> Namuna faylni yuklab olish
        </button>

        {preview && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 text-sm">
              {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((k) => (
                <Badge key={k} tone={STATUS_LABEL[k].tone}>
                  {STATUS_LABEL[k].label}: {preview.counts[k]}
                </Badge>
              ))}
            </div>
            <p className="text-sm">
              Kiritiladi: <Money value={preview.totals.grossAmount} /> tushum, <Money value={preview.totals.commissionAmount} /> komissiya.
            </p>
            <div className="max-h-72 overflow-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-neutral-bg text-left text-muted">
                  <tr>
                    <th className="px-2 py-1.5">Qator</th>
                    <th className="px-2 py-1.5">Holat</th>
                    <th className="px-2 py-1.5">Haydovchi</th>
                    <th className="px-2 py-1.5">Sana</th>
                    <th className="px-2 py-1.5 text-right">Summa</th>
                    <th className="px-2 py-1.5">Izoh</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.map((r) => (
                    <tr key={r.rowNumber}>
                      <td className="tabular px-2 py-1.5">{r.rowNumber}</td>
                      <td className="px-2 py-1.5">
                        <Badge tone={STATUS_LABEL[r.status].tone}>{STATUS_LABEL[r.status].label}</Badge>
                      </td>
                      <td className="px-2 py-1.5">{r.driver?.fullName ?? <span className="text-muted">{r.identifier || "—"}</span>}</td>
                      <td className="tabular px-2 py-1.5">{r.workDate ? formatDay(r.workDate) : "—"}</td>
                      <td className="px-2 py-1.5 text-right">{r.grossAmount ? <Money value={r.grossAmount} /> : "—"}</td>
                      <td className="px-2 py-1.5 text-muted">{r.errors.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <FormError message={preview ? commit.formError : check.formError} />
        <FormActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          {preview ? (
            <Button loading={commit.isPending} disabled={preview.counts.valid === 0} onClick={() => commit.mutate(undefined)}>
              {preview.counts.valid} ta qatorni kiritish
            </Button>
          ) : (
            <Button loading={check.isPending} disabled={!aggregatorId || !file} onClick={() => check.mutate(undefined)}>
              Tekshirish
            </Button>
          )}
        </FormActions>
      </div>
    </Dialog>
  );
}

function AccrueDialog({ onClose }: { onClose: () => void }) {
  const invalidate = useInvalidateFinance();
  const settings = useFinanceSettings();
  const [date, setDate] = useState(yesterdayIso);
  const m = useFormMutation(
    () => api<{ charged: number }>("/finance/accrue-subscriptions", { method: "POST", body: { date } }),
    async (r) => {
      await invalidate();
      toast.success(r.charged ? `${r.charged} ta haydovchiga obuna yozildi` : "Bu kun uchun obuna allaqachon yozilgan");
      onClose();
    },
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Kunlik obunani hisoblash"
      description={`Tanlangan kun uchun ${settings.data?.subscriptionDailyAmount ? formatUzs(settings.data.subscriptionDailyAmount) : ""} obuna yoziladi. Oldin yozilganlarga qayta yozilmaydi. Haydovchining hozirgi holati hisobga olinadi.`}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate(undefined);
        }}
      >
        <Field id="accrueDate" label="Kun" error={m.fieldErrors.date}>
          <Input id="accrueDate" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <FormError message={m.formError} />
        <FormActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={m.isPending}>
            Hisoblash
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
