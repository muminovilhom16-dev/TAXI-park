import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  CRM_STATUSES,
  CRM_STATUS_LABELS,
  formatDay,
  type DriverListItem,
  type Paginated,
} from "@taxi/shared";
import { ArrowDown, ArrowUp, ChevronsUpDown, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { CrmStatusBadge, formatPhone, formatPlate } from "@/components/crm";
import { DriverFormDialog } from "@/components/DriverFormDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, ErrorState, Loading } from "@/components/ui/data-state";
import { Input, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced } from "@/lib/hooks";
import { useAggregators, useStaffOptions } from "@/lib/queries";

const PAGE_SIZE = 25;
type Sort = "name" | "registeredOn" | "status";

export function DriversPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  // Filters live in the URL so a filtered list can be bookmarked or shared.
  const [params, setParams] = useSearchParams();
  const get = (k: string, d = "") => params.get(k) ?? d;
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  const [q, setQ] = useState(get("q"));
  const search = useDebounced(q, 300);
  const page = Number(get("page", "1"));
  const sort = get("sort", "name") as Sort;
  const dir = get("dir", "asc");
  const [creating, setCreating] = useState(false);

  const aggregators = useAggregators();
  const staff = useStaffOptions();
  const query = {
    q: search,
    status: get("status"),
    manager: get("manager"),
    aggregatorId: get("aggregator"),
    archived: get("archived", "false"),
    sort,
    dir,
    page,
    pageSize: PAGE_SIZE,
  };
  const list = useQuery({
    queryKey: ["drivers", query],
    queryFn: () => api<Paginated<DriverListItem>>("/drivers", { query }),
    placeholderData: keepPreviousData,
  });

  const sortBy = (s: Sort) => set({ sort: s, dir: sort === s && dir === "asc" ? "desc" : "asc" });
  const SortIcon = ({ s }: { s: Sort }) =>
    sort !== s ? <ChevronsUpDown className="h-3 w-3" /> : dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  const Th = ({ s, children }: { s: Sort; children: string }) => (
    <th className="px-4 py-2 font-medium" aria-sort={sort === s ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button className="inline-flex items-center gap-1 uppercase hover:text-text" onClick={() => sortBy(s)}>
        {children}
        <SortIcon s={s} />
      </button>
    </th>
  );
  const filtered = !!(search || get("status") || get("manager") || get("aggregator") || get("archived"));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted" aria-hidden />
          <Input
            aria-label="Qidirish"
            placeholder="Ism, telefon, davlat raqami yoki agregator ID"
            className="pl-9"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              set({ q: e.target.value });
            }}
          />
        </div>
        <Select aria-label="Holat" className="w-[calc(50%-0.375rem)] sm:w-48" value={get("status")} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Barcha holatlar</option>
          {CRM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CRM_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        {can("drivers.read_all") && (
          <Select aria-label="Menejer" className="w-[calc(50%-0.375rem)] sm:w-44" value={get("manager")} onChange={(e) => set({ manager: e.target.value })}>
            <option value="">Barcha menejerlar</option>
            <option value="none">Menejersiz</option>
            {staff.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </Select>
        )}
        <Select aria-label="Agregator" className="w-[calc(50%-0.375rem)] sm:w-40" value={get("aggregator")} onChange={(e) => set({ aggregator: e.target.value })}>
          <option value="">Barcha agregatorlar</option>
          {aggregators.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Arxiv" className="w-[calc(50%-0.375rem)] sm:w-36" value={get("archived", "false")} onChange={(e) => set({ archived: e.target.value === "false" ? "" : e.target.value })}>
          <option value="false">Faol ro'yxat</option>
          <option value="true">Arxiv</option>
          <option value="all">Hammasi</option>
        </Select>
        {can("drivers.write") && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Haydovchi qo'shish
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <Empty
            title={filtered ? "Haydovchi topilmadi" : "Hali haydovchi yo'q"}
            hint={filtered ? "Filtrlarni o'zgartirib ko'ring" : can("drivers.write") ? "Birinchi haydovchini qo'shing" : undefined}
          />
        ) : (
          <>
            {/* Phones get a compact list; the table needs room for its columns. */}
            <ul className="divide-y divide-border sm:hidden">
              {list.data.items.map((d) => (
                <li key={d.id}>
                  <Link to={`/drivers/${d.id}`} className="block px-4 py-3 hover:bg-neutral-bg/60">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">
                        {d.lastName} {d.firstName}
                      </span>
                      <CrmStatusBadge status={d.crmStatus} />
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                      <span className="tabular">{formatPhone(d.phone)}</span>
                      {d.vehicle && <span className="tabular">{formatPlate(d.vehicle.plateNumber)}</span>}
                      {d.accounts.length === 0 && <span className="text-warning">bog'lanmagan</span>}
                      {d.archivedAt && <span>arxivda</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead className="bg-neutral-bg text-left text-xs text-muted uppercase">
                  <tr>
                    <Th s="name">Haydovchi</Th>
                    <Th s="status">Holat</Th>
                    <th className="px-4 py-2 font-medium">Avtomobil</th>
                    <th className="px-4 py-2 font-medium">Agregator</th>
                    <th className="px-4 py-2 font-medium">Menejer</th>
                    <Th s="registeredOn">Ro'yxatdan o'tgan</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.data.items.map((d) => (
                    <tr
                      key={d.id}
                      className="cursor-pointer hover:bg-neutral-bg/60"
                      onClick={() => navigate(`/drivers/${d.id}`)}
                    >
                      <td className="px-4 py-2.5">
                        <Link to={`/drivers/${d.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                          {d.lastName} {d.firstName}
                        </Link>
                        <div className="tabular text-xs text-muted">{formatPhone(d.phone)}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          <CrmStatusBadge status={d.crmStatus} />
                          {d.archivedAt && <span className="text-xs text-muted">arxivda</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        {d.vehicle ? (
                          <>
                            <div className="tabular">{formatPlate(d.vehicle.plateNumber)}</div>
                            <div className="text-xs text-muted">{d.vehicle.model}</div>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {d.accounts.length ? (
                          d.accounts.map((a) => (
                            <div key={a.aggregatorName + a.externalDriverId} className="text-xs">
                              {a.aggregatorName}: <span className="tabular">{a.externalDriverId}</span>
                            </div>
                          ))
                        ) : (
                          <span className="text-xs text-warning">bog'lanmagan</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">{d.manager?.fullName ?? <span className="text-muted">—</span>}</td>
                      <td className="tabular px-4 py-2.5 text-muted">{formatDay(d.registeredOn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => set({ page: String(p) })} />
          </>
        )}
      </Card>

      <DriverFormDialog open={creating} onClose={() => setCreating(false)} onSaved={(d) => navigate(`/drivers/${d.id}`)} />
    </div>
  );
}
