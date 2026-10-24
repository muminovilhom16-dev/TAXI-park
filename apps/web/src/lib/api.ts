import type { ApiError } from "@taxi/shared";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
  }

  /** Field errors keyed by path, for forms. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.details ?? []).map((d) => [d.path, d.message]));
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (token: string | null) => {
  csrfToken = token;
};

type Options = { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; query?: Record<string, unknown> };

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      credentials: "same-origin",
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiRequestError(0, "network", "Server bilan aloqa yo'q. Internetni tekshiring");
  }

  if (res.ok) return (await res.json()) as T;
  const payload = (await res.json().catch(() => null)) as ApiError | null;
  throw new ApiRequestError(
    res.status,
    payload?.error.code ?? "unknown",
    payload?.error.message ?? `Xato: ${res.status}`,
    payload?.error.details as ApiRequestError["details"],
  );
}

export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : "Noma'lum xato yuz berdi";
