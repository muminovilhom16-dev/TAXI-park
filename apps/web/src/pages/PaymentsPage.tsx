import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatDateTime, formatUzs, PAYMENT_METHOD_LABELS, type PaymentRow } from "@taxi/shared";
import { Check, Undo2, Wallet, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Money, PaymentDialog, ReasonDialog, useInvalidateFinance } from "@/components/finance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, ErrorState, Loading } from "@/components/ui/data-state";
import { Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const PAGE_SIZE = 50;
const STATUS = {
  pending: { label: "Tasdiq kutilmoqda", tone: "warning" },
  approved: { label: "Tasdiqlangan", tone: "success" },
  rejected: { label: "Rad etilgan", tone: "danger" },
} as const;

export function PaymentsPage() {
  const { can, user } = useAuth();
  const invalidate = useInvalidateFinance();
  const [status, setStatus] = useState(can("payments.approve") ? "pending" : "all");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [reversing, setReversing] = useState<PaymentRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const query = { status, page, pageSize: PAGE_SIZE };
  const list = useQuery({
    queryKey: ["payments", query],
    queryFn: () => api<{ items: PaymentRow[]; total: number }>("/payments", { query }),
    placeholderData: keepPreviousData,
  });

  const decide = async (p: PaymentRow, action: "approve" | "reject") => {
    setBusy(p.id);
    try {
      await api(`/payments/${p.id}/${action}`, { method: "POST" });
      await invalidate();
      toast.success(action === "approve" ? "To'lov tasdiqlandi" : "To'lov rad etildi");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select aria-label="Holat" className="w-48" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="pending">Tasdiq kutilmoqda</option>
          <option value="approved">Tasdiqlangan</option>
          <option value="rejected">Rad etilgan</option>
          <option value="all">Hammasi</option>
        </Select>
        {can("payments.write") && (
          <Button className="sm:ml-auto" onClick={() => setCreating(true)}>
            <Wallet className="h-4 w-4" /> To'lov qabul qilish
          </Button>
        )}
      </div>
      <Card className="overflow-hidden">
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <Empty title={status === "pending" ? "Tasdiq kutayotgan to'lov yo'q" : "To'lov topilmadi"} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-bg text-left text-xs text-muted uppercase">
                  <tr>
                    <th className="px-4 py-2 font-medium">Vaqt</th>
                    <th className="px-4 py-2 font-medium">Haydovchi</th>
                    <th className="px-4 py-2 text-right font-medium">Summa</th>
                    <th className="px-4 py-2 font-medium">Holat</th>
                    <th className="px-4 py-2 font-medium">Kiritdi / tasdiqladi</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.data.items.map((p) => {
                    const own = p.createdBy.id === user?.id;
                    return (
                      <tr key={p.id}>
                        <td className="tabular px-4 py-2.5 whitespace-nowrap">{formatDateTime(p.occurredAt)}</td>
                        <td className="px-4 py-2.5">
                          {p.driver ? (
                            <Link className="hover:underline" to={`/drivers/${p.driver.id}`}>
                              {p.driver.fullName}
                            </Link>
                          ) : (
                            "—"
                          )}
                          <div className="text-xs text-muted">
                            {p.type === "adjustment"
                              ? "To'lovni bekor qilish"
                              : (PAYMENT_METHOD_LABELS[p.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] ?? p.paymentMethod)}
                            {p.note && ` · ${p.note}`}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium">
                          <Money value={p.direction === "in" ? p.amount : `-${p.amount}`} />
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone={STATUS[p.approvalStatus].tone}>{STATUS[p.approvalStatus].label}</Badge>
                          {p.reversed && <Badge className="ml-1">Bekor qilingan</Badge>}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted">
                          {p.createdBy.fullName}
                          {p.approvedBy && <div>{p.approvedBy}</div>}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-1">
                            {can("payments.approve") && p.approvalStatus === "pending" &&
                              (own ? (
                                <span className="text-xs text-muted">Boshqa xodim tasdiqlaydi</span>
                              ) : (
                                <>
                                  <Button size="sm" loading={busy === p.id} onClick={() => decide(p, "approve")}>
                                    <Check className="h-4 w-4" /> Tasdiqlash
                                  </Button>
                                  <Button size="sm" variant="ghost" disabled={busy === p.id} onClick={() => decide(p, "reject")} aria-label="Rad etish">
                                    <X className="h-4 w-4" />
                                  </Button>
                                </>
                              ))}
                            {can("payments.approve") && p.approvalStatus === "approved" && p.type === "driver_other_payment_in" && !p.reversed && (
                              <Button size="sm" variant="ghost" onClick={() => setReversing(p)}>
                                <Undo2 className="h-4 w-4" /> Bekor qilish
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {creating && <PaymentDialog onClose={() => setCreating(false)} />}
      {reversing && (
        <ReasonDialog
          title="Tasdiqlangan to'lovni bekor qilish"
          description={`${reversing.driver?.fullName ?? ""}: ${formatUzs(reversing.amount)}. To'lov o'chmaydi: teskari yozuv qo'shiladi va summa qarzga qaytadi.`}
          confirmLabel="Bekor qilish"
          onConfirm={async (reason) => {
            await api(`/payments/${reversing.id}/reverse`, { method: "POST", body: { reason } });
            await invalidate();
            toast.success("To'lov bekor qilindi");
          }}
          onClose={() => setReversing(null)}
        />
      )}
    </div>
  );
}
