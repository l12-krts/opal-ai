"use client";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    if (body.error === "locked") window.location.assign(`/unlock?next=${encodeURIComponent(location.pathname)}`);
    else if (body.error === "unauthorized") window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
    throw new HttpError(401, body.error ?? "unauthorized", body.message ?? "Sign in required");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new HttpError(res.status, body.error ?? "error", body.message ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const fetcher = <T,>(url: string) => apiFetch<T>(url);
