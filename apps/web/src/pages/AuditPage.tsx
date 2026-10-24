import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatDateTime, type AuditLogRow, type Paginated } from "@taxi/shared";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Empty, ErrorState, Loading } from "@/components/ui/data-state";
import { Input, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { api, errorMessage } from "@/lib/api";

const PAGE_SIZE = 50;

// Human labels for the actions written so far; unknown actions show their code.
const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Tizimga kirish",
  "auth.logout": "Tizimdan chiqish",
  "auth.change_password": "Parolni o'zgartirish",
  "user.create": "Xodim yaratildi",
  "user.update": "Xodim o'zgartirildi",
  "user.reset_password": "Parol tiklandi",
  "access.denied": "Ruxsatsiz urinish",
};

const RESULT: Record<AuditLogRow["result"], { label: string; tone: "success" | "warning" | "danger" }> = {
  success: { label: "Muvaffaqiyatli", tone: "success" },
  failure: { label: "Xato", tone: "warning" },
  denied: { label: "Rad etildi", tone: "danger" },
};

/** Start of a Tashkent calendar day (UTC+5) as an ISO instant. */
const tashkentDay = (d: string, plusDays = 0) =>
  new Date(Date.parse(`${d}T00:00:00+05:00`) + plusDays * 86_400_000).toISOString();

export function AuditPage() {
  const [action, setAction] = useState("");
  const [result, setResult] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["audit", { action, result, from, to, page }],
    queryFn: () =>
      api<Paginated<AuditLogRow>>("/audit-logs", {
        query: {
          action,
          result,
          from: from ? tashkentDay(from) : undefined,
          to: to ? tashkentDay(to, 1) : undefined,
          page,
          pageSize: PAGE_SIZE,
        },
      }),
    placeholderData: keepPreviousData,
  });

  const filter = (set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select aria-label="Amal" className="w-56" value={action} onChange={filter(setAction)}>
          <option value="">Barcha amallar</option>
          {Object.entries(ACTION_LABELS).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </Select>
        <Select aria-label="Natija" className="w-44" value={result} onChange={filter(setResult)}>
          <option value="">Barcha natijalar</option>
          {Object.entries(RESULT).map(([code, r]) => (
            <option key={code} value={code}>
              {r.label}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted">
          dan
          <Input type="date" className="w-40" value={from} onChange={filter(setFrom)} aria-label="Sanadan" />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          gacha
          <Input type="date" className="w-40" value={to} onChange={filter(setTo)} aria-label="Sanagacha" />
        </label>
      </div>

      <Card className="overflow-hidden">
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <Empty title="Yozuvlar yo'q" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-bg text-left text-xs text-muted uppercase">
                  <tr>
                    <th className="w-8 px-2 py-2" />
                    <th className="px-4 py-2 font-medium">Vaqt</th>
                    <th className="px-4 py-2 font-medium">Xodim</th>
                    <th className="px-4 py-2 font-medium">Amal</th>
                    <th className="px-4 py-2 font-medium">Obyekt</th>
                    <th className="px-4 py-2 font-medium">Natija</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.data.items.map((row) => {
                    const open = expanded === row.id;
                    const r = RESULT[row.result];
                    return (
                      <Fragment key={row.id}>
                        <tr>
                          <td className="px-2 py-2">
                            <button
                              className="rounded p-1 text-muted hover:bg-neutral-bg"
                              onClick={() => setExpanded(open ? null : row.id)}
                              aria-expanded={open}
                              aria-label="Tafsilotlar"
                            >
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </td>
                          <td className="tabular px-4 py-2 whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
                          <td className="px-4 py-2">{row.actor?.fullName ?? <span className="text-muted">Tizim / noma'lum</span>}</td>
                          <td className="px-4 py-2">{ACTION_LABELS[row.action] ?? row.action}</td>
                          <td className="px-4 py-2 text-muted">
                            {row.entityType}
                            {row.entityId ? ` · ${row.entityId.slice(0, 40)}` : ""}
                          </td>
                          <td className="px-4 py-2">
                            <Badge tone={r.tone}>{r.label}</Badge>
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-neutral-bg/50">
                            <td />
                            <td colSpan={5} className="px-4 py-3">
                              <div className="grid gap-3 md:grid-cols-2">
                                <Snapshot title="Oldin" value={row.before} />
                                <Snapshot title="Keyin" value={row.after} />
                              </div>
                              <p className="mt-2 text-xs text-muted">IP: {row.ip ?? "—"}</p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

function Snapshot({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted">{title}</div>
      <pre className="max-h-64 overflow-auto rounded-md border border-border bg-surface p-2 text-xs">
        {value == null ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
