import { useQuery } from "@tanstack/react-query";
import type { AggregatorRow } from "@taxi/shared";
import { api } from "./api";
import { useAuth } from "./auth";

export function useAggregators() {
  return useQuery({
    queryKey: ["aggregators"],
    queryFn: () => api<{ items: AggregatorRow[] }>("/aggregators").then((r) => r.items),
    staleTime: 60_000,
  });
}

export type StaffOption = { id: string; fullName: string; roleCode: string };

/** Active staff for manager pickers; only loaded for roles that may assign. */
export function useStaffOptions() {
  const { can } = useAuth();
  return useQuery({
    queryKey: ["users", "options"],
    queryFn: () => api<{ items: StaffOption[] }>("/users/options").then((r) => r.items),
    enabled: can("drivers.read_all"),
    staleTime: 60_000,
  });
}
