import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MeResponse, Permission, SessionUser } from "@taxi/shared";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { api, ApiRequestError, setCsrfToken } from "./api";

type AuthValue = {
  user: SessionUser | null;
  loading: boolean;
  can: (...perms: Permission[]) => boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

async function fetchMe(): Promise<MeResponse | null> {
  try {
    const me = await api<MeResponse>("/auth/me");
    setCsrfToken(me.csrfToken);
    return me;
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) {
      setCsrfToken(null);
      return null;
    }
    throw err;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 60_000, retry: false });

  const login = useCallback(
    async (loginName: string, password: string) => {
      await api("/auth/login", { method: "POST", body: { login: loginName, password } });
      const me = await fetchMe();
      // Drop another user's cached data, but keep the "me" query that observers hold.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      qc.setQueryData(["me"], me);
    },
    [qc],
  );

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    setCsrfToken(null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    qc.setQueryData(["me"], null);
  }, [qc]);

  const value = useMemo<AuthValue>(() => {
    const user = me.data?.user ?? null;
    return {
      user,
      loading: me.isPending,
      // UI convenience only: the server checks every request again.
      can: (...perms) => !!user && perms.every((p) => user.permissions.includes(p)),
      login,
      logout,
    };
  }, [me.data, me.isPending, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
