import { useQuery } from "@tanstack/react-query";
import { formatDateTime, formatDay, type DriverFinance } from "@taxi/shared";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { Money, PaymentDialog } from "@/components/finance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, Loading } from "@/components/ui/data-state";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const STATUS_BADGE: Record<string, { label: string; tone: "neutral" | "warning" | "danger" } | undefined> = {
  voided: { label: "bekor qilingan", tone: "neutral" },
  pending: { label: "tasdiq kutilmoqda", tone: "warning" },
  rejected: { label: "rad etilgan", tone: "danger" },
};

export function DriverFinanceCard({ driver }: { driver: { id: string; fullName: string } }) {
  const { can } = useAuth();
  const [paying, setPaying] = useState(false);
  const q = useQuery({
    queryKey: ["driver-finance", driver.id],
    queryFn: () => api<DriverFinance>(`/finance/drivers/${driver.id}`),
  });

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Moliya</h3>
        {can("payments.write") && (
          <Button variant="ghost" size="sm" onClick={() => setPaying(true)}>
            <Wallet className="h-4 w-4" /> To'lov qabul qilish
          </Button>
        )}
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Qoldiq (qarz)</dt>
              <dd className="text-lg font-semibold">
                <Money value={q.data.balance} signed className={Number(q.data.balance) > 0 ? "text-danger" : ""} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Hisoblangan</dt>
              <dd>
                <Money value={q.data.charged} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">To'langan</dt>
              <dd>
                <Money value={q.data.paid} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Tasdiq kutmoqda</dt>
              <dd>
                <Money value={q.data.pendingPayments} />
              </dd>
            </div>
          </dl>
          {q.data.ledger.length === 0 ? (
            <p className="text-sm text-muted">Hali moliyaviy yozuv yo'q</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {q.data.ledger.slice(0, 30).map((e) => {
                const badge = STATUS_BADGE[e.status];
                return (
                  <li key={`${e.kind}-${e.id}`} className={`flex items-start justify-between gap-3 py-2 ${e.status === "voided" ? "text-muted" : ""}`}>
                    <div>
                      <div>
                        {e.label} {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
                      </div>
                      <div className="tabular text-xs text-muted">
                        {e.date.length > 10 ? formatDateTime(e.date) : formatDay(e.date)}
                        {e.note && ` · ${e.note}`}
                      </div>
                    </div>
                    <Money
                      value={e.amount}
                      className={
                        e.kind === "earning"
                          ? "text-muted"
                          : e.kind === "charge" || e.amount.startsWith("-")
                            ? "text-danger"
                            : "text-success"
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">
            Qizil: haydovchiga yozilgan summa. Yashil: to'lov. Kulrang: tushum (qarzga ta'sir qilmaydi).
          </p>
        </>
      )}
      {paying && <PaymentDialog driver={driver} onClose={() => setPaying(false)} />}
    </Card>
  );
}
