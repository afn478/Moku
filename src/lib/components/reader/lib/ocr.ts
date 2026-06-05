import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { settingsState } from "$lib/state/settings.svelte";

export type OcrTextOrientation = "smart" | "forceHorizontal" | "forceVertical";
export type OcrOverlayMode = "hover" | "always";

export interface OcrBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrLine {
  text: string;
  tightBoundingBox: OcrBoundingBox;
  orientation?: number;
  font_size?: number;
  confidence?: number;
  forcedOrientation?: "horizontal" | "vertical" | "auto";
  isMerged?: boolean;
}

type FetchLike = typeof fetch;

const resultCache = new Map<string, Promise<OcrLine[]>>();
let serverCooldownUntil = 0;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function trimTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function getOcrServerUrl(): string {
  return trimTrailingSlash(settingsState.settings.readerOcrServerUrl || "http://127.0.0.1:3000");
}

function appendImageAuth(params: URLSearchParams) {
  const mode = settingsState.settings.serverAuthMode ?? "NONE";
  if (mode !== "BASIC_AUTH" && mode !== "SIMPLE_LOGIN") return;

  const user = settingsState.settings.serverAuthUser?.trim() ?? "";
  const pass = settingsState.settings.serverAuthPass ?? "";
  if (!user) return;

  params.set("user", user);
  params.set("pass", pass);
}

function normalizeOcrLine(value: unknown): OcrLine | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<OcrLine>;
  const box = item.tightBoundingBox;
  if (!box || typeof box !== "object") return null;
  if (typeof item.text !== "string" || !item.text.trim()) return null;

  const normalizedBox = box as Partial<OcrBoundingBox>;
  const x = Number(normalizedBox.x);
  const y = Number(normalizedBox.y);
  const width = Number(normalizedBox.width);
  const height = Number(normalizedBox.height);

  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }

  return {
    ...item,
    text: item.text.trim(),
    tightBoundingBox: {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      width: Math.max(0, Math.min(1, width)),
      height: Math.max(0, Math.min(1, height)),
    },
  };
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  const fetcher: FetchLike = isTauriRuntime() ? tauriFetch as FetchLike : fetch;
  return fetcher(url, init);
}

async function requestJson<T>(url: string, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("OCR request timed out")), timeoutMs);
  });

  try {
    const res = await Promise.race([request(url), timedOut]);
    if (!res.ok) throw new Error(`OCR HTTP ${res.status}`);
    return await res.json() as T;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function getOcrResults(imageUrl: string, context: string): Promise<OcrLine[]> {
  if (!imageUrl) return [];

  const now = Date.now();
  if (serverCooldownUntil > now) {
    throw new Error("OCR server is cooling down after a failed request");
  }

  const serverUrl = getOcrServerUrl();
  const params = new URLSearchParams({
    url: imageUrl,
    context,
  });
  appendImageAuth(params);

  const requestUrl = `${serverUrl}/ocr?${params.toString()}`;
  const cacheKey = requestUrl;
  const cached = resultCache.get(cacheKey);
  if (cached) return cached;

  const promise = requestJson<unknown>(requestUrl, 45_000)
    .then((json) => {
      if (!Array.isArray(json)) throw new Error("OCR server returned a non-array response");
      return json.map(normalizeOcrLine).filter((line): line is OcrLine => line !== null);
    })
    .catch((err) => {
      resultCache.delete(cacheKey);
      serverCooldownUntil = Date.now() + 5_000;
      throw err;
    });

  resultCache.set(cacheKey, promise);
  return promise;
}

export function preloadOcr(imageUrl: string, context: string): void {
  if (!(settingsState.settings.readerOcrEnabled ?? false)) return;
  void getOcrResults(imageUrl, context).catch(() => {});
}

export async function checkOcrServer(): Promise<boolean> {
  try {
    const data = await requestJson<{ status?: string }>(getOcrServerUrl(), 5_000);
    return data.status === "running";
  } catch {
    return false;
  }
}

export function clearOcrCache(): void {
  resultCache.clear();
  serverCooldownUntil = 0;
}
