import { useQuery } from "@tanstack/react-query";
import { PERIOD_LABELS, PERIODS, formatDay, formatUzs, type CrmStats, type FinanceStats, type Period } from "@taxi/shared";
import { Info } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/data-state";
import { Input, Select } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// Each card states exactly what it counts, matching apps/api/src/routes/dashboard.ts.
const CARDS: { key: keyof Omit<CrmStats, "period">; label: string; formula: string; link?: string; warnIfPositive?: boolean }[] = [
  { key: "totalDrivers", label: "Jami haydovchilar", formula: "Arxivda bo'lmagan barcha haydovchilar", link: "/drivers" },
  { key: "activeDrivers", label: "Faol", formula: "CRM holati \"Faol\" bo'lganlar", link: "/drivers?status=active" },
  { key: "newDrivers", label: "Yangi ro'yxatdan o'tgan", formula: "Ro'yxatdan o'tgan sanasi tanlangan davrga tushganlar" },
  {
    key: "inactiveDrivers",
    label: "Faol emas",
    formula: "Holati \"Vaqtincha to'xtatilgan\" yoki \"Faoliyatni tugatgan\" bo'lganlar",
  },
  { key: "withoutManager", label: "Menejersiz", formula: "Mas'ul menejer biriktirilmaganlar", link: "/drivers?manager=none", warnIfPositive: true },
  {
    key: "withoutAggregatorAccount",
    label: "Agregatorga bog'lanmagan",
    formula: "Hech bir agregatorda faol ID'si yo'qlar. Ularning hisobot qatorlari importda tanilmaydi",
    warnIfPositive: true,
  },
];

// Same rule: every figure says what it sums. Matches GET /api/dashboard/finance.
const FINANCE_CARDS: {
  key: keyof Omit<FinanceStats, "period">;
  label: string;
  formula: string;
  money?: boolean;
  link?: string;
  warnIfPositive?: boolean;
}[] = [
  { key: "commission", label: "Park komissiyasi", formula: "Davrdagi amaldagi kunlik tushumlarning komissiyasi yig'indisi", money: true, link: "/earnings" },
  { key: "grossEarnings", label: "Haydovchilar tushumi", formula: "Davrdagi amaldagi kunlik tushumlar yig'indisi", money: true, link: "/earnings" },
  { key: "subscriptionsCharged", label: "Hisoblangan obuna", formula: "Davr kunlariga yozilgan, bekor qilinmagan obunalar yig'indisi", money: true },
  {
    key: "paymentsReceived",
    label: "Qabul qilingan to'lovlar",
    formula: "Davrda kiritilgan va tasdiqlangan haydovchi to'lovlari, bekor qilinganlari ayirilgan",
    money: true,
    link: "/payments",
  },
  { key: "outstandingDebt", label: "Jami qarz (hozir)", formula: "Musbat qoldiqlar yig'indisi: hisoblangan summalar − tasdiqlangan to'lovlar", money: true, link: "/debts", warnIfPositive: true },
  { key: "debtors", label: "Qarzdorlar", formula: "Qoldig'i noldan katta haydovchilar soni", link: "/debts", warnIfPositive: true },
  { key: "pendingPayments", label: "Tasdiq kutayotgan to'lovlar", formula: "Hali tasdiqlanmagan va rad etilmagan to'lovlar soni", link: "/payments", warnIfPositive: true },
  {
    key: "missingEarningsYesterday",
    label: "Kechagi tushumi kiritilmagan",
    formula: "Holati \"Faol\", lekin kecha uchun birorta tushum kiritilmagan haydovchilar. Dam olgan bo'lishi ham mumkin",
    link: "/earnings",
    warnIfPositive: true,
  },
];

function StatCard({ label, formula, link, children, warn }: { label: string; formula: string; link?: string; warn?: boolean; children: ReactNode }) {
  const body = (
    <Card className={`h-full p-4 ${link ? "transition-colors hover:border-primary/50" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-muted">{label}</span>
        <span title={formula} aria-label={`Formula: ${formula}`} className="text-muted">
          <Info className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className={`tabular mt-2 text-xl font-semibold ${warn ? "text-warning" : ""}`}>{children}</div>
    </Card>
  );
  return link ? <Link to={link}>{body}</Link> : <div>{body}</div>;
}

export function HomePage() {
  const { user, can } = useAuth();
  const [period, setPeriod] = useState<Period>("this_month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const seesDrivers = can("drivers.read_all") || can("drivers.read_assigned");
  const ready = period !== "custom" || (from && to && from <= to);

  const seesFinance = can("finance.read");
  const finance = useQuery({
    queryKey: ["dashboard", "finance", { period, from, to }],
    queryFn: () => api<FinanceStats>("/dashboard/finance", { query: { period, from, to } }),
    enabled: seesFinance && !!ready,
  });

  const stats = useQuery({
    queryKey: ["dashboard", "crm", { period, from, to }],
    queryFn: () => api<CrmStats>("/dashboard/crm", { query: { period, from, to } }),
    enabled: seesDrivers && !!ready,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Assalomu alaykum, {user?.fullName}</h2>
          <p className="text-sm text-muted">
            {can("drivers.read_all") || !seesDrivers ? "" : "Faqat sizga biriktirilgan haydovchilar hisoblanadi. "}
            {stats.data && `Davr: ${formatDay(stats.data.period.from)} — ${formatDay(stats.data.period.to)}`}
          </p>
        </div>
        {(seesDrivers || seesFinance) && (
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Davr" className="w-40" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {PERIOD_LABELS[p]}
                </option>
              ))}
            </Select>
            {period === "custom" && (
              <>
                <Input type="date" aria-label="Sanadan" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
                <Input type="date" aria-label="Sanagacha" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
              </>
            )}
          </div>
        )}
      </div>

      {seesDrivers &&
        (stats.isError ? (
          <ErrorState message={errorMessage(stats.error)} onRetry={() => stats.refetch()} />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {CARDS.map((c) => {
              const value = stats.data?.[c.key];
              const warn = c.warnIfPositive && !!value;
              const body = (
                <Card className={`h-full p-4 ${c.link ? "transition-colors hover:border-primary/50" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs text-muted">{c.label}</span>
                    <span title={c.formula} aria-label={`Formula: ${c.formula}`} className="text-muted">
                      <Info className="h-3.5 w-3.5" />
                    </span>
                  </div>
                  <div className={`tabular mt-2 text-2xl font-semibold ${warn ? "text-warning" : ""}`}>
                    {value === undefined ? <span className="text-muted">…</span> : value.toLocaleString("ru-RU")}
                  </div>
                </Card>
              );
              return c.link ? (
                <Link key={c.key} to={c.link}>
                  {body}
                </Link>
              ) : (
                <div key={c.key}>{body}</div>
              );
            })}
          </div>
        ))}

      {seesFinance && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Moliya</h3>
          {finance.isError ? (
            <ErrorState message={errorMessage(finance.error)} onRetry={() => finance.refetch()} />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {FINANCE_CARDS.map((c) => {
                const value = finance.data?.[c.key];
                const positive = value !== undefined && Number(value) > 0;
                return (
                  <StatCard key={c.key} label={c.label} formula={c.formula} link={c.link} warn={c.warnIfPositive && positive}>
                    {value === undefined ? (
                      <span className="text-muted">…</span>
                    ) : c.money ? (
                      formatUzs(String(value))
                    ) : (
                      value.toLocaleString("ru-RU")
                    )}
                  </StatCard>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
