import { useQuery } from "@tanstack/react-query";
import { formatDay, type DebtRow } from "@taxi/shared";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { formatPhone } from "@/components/crm";
import { Money, PaymentDialog } from "@/components/finance";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, ErrorState, Loading } from "@/components/ui/data-state";
import { Select } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export function DebtsPage() {
  const { can } = useAuth();
  const [all, setAll] = useState("false");
  const [paying, setPaying] = useState<{ id: string; fullName: string } | null | undefined>(undefined);
  const list = useQuery({
    queryKey: ["debts", all],
    queryFn: () => api<{ items: DebtRow[]; totalDebt: string }>("/finance/debts", { query: { all } }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted" title="Barcha haydovchilarning musbat qoldiqlari yig'indisi">
            Jami qarz
          </div>
          {list.data ? (
            <Money className="mt-1 block text-2xl font-semibold text-danger" value={list.data.totalDebt} />
          ) : (
            <div className="mt-1 text-2xl text-muted">…</div>
          )}
          <p className="mt-1 max-w-sm text-xs text-muted">
            Qoldiq = hisoblangan obuna va boshqa summalar − tasdiqlangan to'lovlar. Kutilayotgan to'lovlar hali ayrilmagan.
          </p>
        </Card>
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Ro'yxat" className="w-48" value={all} onChange={(e) => setAll(e.target.value)}>
            <option value="false">Faqat qarzdorlar</option>
            <option value="true">Hisobi bor barcha haydovchilar</option>
          </Select>
          {can("payments.write") && (
            <Button onClick={() => setPaying(null)}>
              <Wallet className="h-4 w-4" /> To'lov qabul qilish
            </Button>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <Empty title="Qarzdor haydovchi yo'q" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-bg text-left text-xs text-muted uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Haydovchi</th>
                  <th className="px-4 py-2 text-right font-medium">Hisoblangan</th>
                  <th className="px-4 py-2 text-right font-medium">To'langan</th>
                  <th className="px-4 py-2 text-right font-medium">Qoldiq</th>
                  <th className="px-4 py-2 text-right font-medium">Kutilmoqda</th>
                  <th className="px-4 py-2 font-medium">Qachondan</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.data.items.map((d) => (
                  <tr key={d.driver.id}>
                    <td className="px-4 py-2.5">
                      <Link className="font-medium hover:underline" to={`/drivers/${d.driver.id}`}>
                        {d.driver.fullName}
                      </Link>
                      <div className="tabular text-xs text-muted">
                        {formatPhone(d.driver.phone)}
                        {d.driver.archived && " · arxivda"}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Money value={d.charged} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Money value={d.paid} />
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">
                      <Money value={d.balance} signed className={Number(d.balance) > 0 ? "text-danger" : ""} />
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted">
                      {Number(d.pendingPayments) > 0 ? <Money value={d.pendingPayments} /> : "—"}
                    </td>
                    <td className="tabular px-4 py-2.5 text-muted">{d.oldestUnpaidDate ? formatDay(d.oldestUnpaidDate) : "—"}</td>
                    <td className="px-4 py-2.5 text-right">
                      {can("payments.write") && (
                        <Button variant="ghost" size="sm" onClick={() => setPaying({ id: d.driver.id, fullName: d.driver.fullName })}>
                          To'lov
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
      {paying !== undefined && <PaymentDialog driver={paying} onClose={() => setPaying(undefined)} />}
    </div>
  );
}
