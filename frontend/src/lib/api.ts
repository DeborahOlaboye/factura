import { errorMessage } from "./errors";

const BASE = "/backend";
const TOKEN_KEY = "factura.session";

export interface Session {
  token: string;
  wallet: `0x${string}`;
  expiresAt: number;
}

export function loadSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return s.expiresAt > Date.now() / 1000 + 60 ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) window.localStorage.setItem(TOKEN_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage blocked: the session lives only in memory for this tab
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  // The host's own 404 (not the agent's) means /backend isn't wired to a running agent.
  if (res.status === 404 && (body.error as { code?: string } | undefined)?.code === "NOT_FOUND") {
    throw new ApiError("Factura’s agent isn’t connected to this site yet (FACTURA_AGENT_URL).", 404);
  }
  if (!res.ok) {
    const reason = body.error !== undefined ? errorMessage(body.error) : res.status >= 500 ? "Factura’s agent isn’t reachable right now" : `Request failed (${res.status})`;
    throw new ApiError(reason, res.status);
  }
  return body as T;
}
