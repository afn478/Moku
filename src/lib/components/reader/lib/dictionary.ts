import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { settingsState } from "$lib/state/settings.svelte";

export interface HoshiTransformGroup {
  name: string;
  description: string;
}

export interface HoshiFrequency {
  value: number;
  displayValue: string;
}

export interface HoshiGlossaryEntry {
  dictName: string;
  glossary: string;
  definitionTags: string;
  termTags: string;
}

export interface HoshiFrequencyEntry {
  dictName: string;
  frequencies: HoshiFrequency[];
}

export interface HoshiPitchEntry {
  dictName: string;
  pitchPositions: number[];
}

export interface HoshiTermResult {
  expression: string;
  reading: string;
  rules: string;
  glossaries: HoshiGlossaryEntry[];
  frequencies: HoshiFrequencyEntry[];
  pitches: HoshiPitchEntry[];
}

export interface HoshiLookupResult {
  matched: string;
  deinflected: string;
  process: HoshiTransformGroup[];
  term: HoshiTermResult;
  preprocessorSteps: number;
}

export interface DictionaryLookupRequest {
  text: string;
  maxResults?: number;
  scanLength?: number;
  language?: string;
}

type FetchLike = typeof fetch;

const lookupCache = new Map<string, Promise<HoshiLookupResult[]>>();
let serverCooldownUntil = 0;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function trimTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function array<T>(value: unknown, mapper: (item: unknown) => T | null): T[] {
  return Array.isArray(value) ? value.map(mapper).filter((item): item is T => item !== null) : [];
}

function normalizeTransform(value: unknown): HoshiTransformGroup | null {
  const item = asRecord(value);
  if (!item) return null;
  return {
    name: str(item.name),
    description: str(item.description),
  };
}

function normalizeFrequency(value: unknown): HoshiFrequency | null {
  const item = asRecord(value);
  if (!item) return null;
  return {
    value: num(item.value),
    displayValue: str(item.displayValue ?? item.display_value),
  };
}

function normalizeGlossary(value: unknown): HoshiGlossaryEntry | null {
  const item = asRecord(value);
  if (!item) return null;
  return {
    dictName: str(item.dictName ?? item.dictionary),
    glossary: str(item.glossary ?? item.content),
    definitionTags: str(item.definitionTags),
    termTags: str(item.termTags),
  };
}

function normalizeFrequencyEntry(value: unknown): HoshiFrequencyEntry | null {
  const item = asRecord(value);
  if (!item) return null;
  return {
    dictName: str(item.dictName ?? item.dictionary),
    frequencies: array(item.frequencies, normalizeFrequency),
  };
}

function normalizePitchEntry(value: unknown): HoshiPitchEntry | null {
  const item = asRecord(value);
  if (!item) return null;
  return {
    dictName: str(item.dictName ?? item.dictionary),
    pitchPositions: Array.isArray(item.pitchPositions)
      ? item.pitchPositions.map((value) => num(value)).filter(Number.isFinite)
      : [],
  };
}

function normalizeTerm(value: unknown, fallback: Record<string, unknown>): HoshiTermResult {
  const term = asRecord(value) ?? fallback;
  const rawRules = term.rules;
  const rules = Array.isArray(rawRules) ? rawRules.map((rule) => str(rule)).filter(Boolean).join(" ") : str(rawRules);

  return {
    expression: str(term.expression),
    reading: str(term.reading),
    rules,
    glossaries: array(term.glossaries, normalizeGlossary),
    frequencies: array(term.frequencies, normalizeFrequencyEntry),
    pitches: array(term.pitches, normalizePitchEntry),
  };
}

export function normalizeLookupResult(value: unknown): HoshiLookupResult | null {
  const item = asRecord(value);
  if (!item) return null;

  const term = normalizeTerm(item.term, item);
  if (!term.expression && !term.reading) return null;

  return {
    matched: str(item.matched),
    deinflected: str(item.deinflected),
    process: array(item.process ?? item.deinflectionTrace, normalizeTransform),
    term,
    preprocessorSteps: num(item.preprocessorSteps ?? item.preprocessor_steps),
  };
}

function normalizeLookupResponse(value: unknown): HoshiLookupResult[] {
  const root = asRecord(value);
  const items = Array.isArray(value) ? value : root?.results;
  return array(items, normalizeLookupResult);
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  const fetcher: FetchLike = isTauriRuntime() ? tauriFetch as FetchLike : fetch;
  return fetcher(url, init);
}

async function requestJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("Dictionary request timed out")), timeoutMs);
  });

  try {
    const res = await Promise.race([request(url, init), timedOut]);
    if (!res.ok) throw new Error(`Dictionary HTTP ${res.status}`);
    return await res.json() as T;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function getDictionaryServerUrl(): string {
  return trimTrailingSlash(settingsState.settings.readerDictionaryServerUrl || "http://127.0.0.1:3031");
}

export function dictionaryLookupDefaults(): Required<Pick<DictionaryLookupRequest, "maxResults" | "scanLength" | "language">> {
  return {
    maxResults: Math.max(1, Math.min(50, settingsState.settings.readerDictionaryMaxResults ?? 16)),
    scanLength: Math.max(1, Math.min(64, settingsState.settings.readerDictionaryScanLength ?? 16)),
    language: (settingsState.settings.readerDictionaryLanguage ?? "ja").trim() || "ja",
  };
}

export async function lookupDictionaryText(requestBody: DictionaryLookupRequest): Promise<HoshiLookupResult[]> {
  const text = requestBody.text.trim();
  if (!text) return [];

  const now = Date.now();
  if (serverCooldownUntil > now) {
    throw new Error("Dictionary server is cooling down after a failed request");
  }

  const defaults = dictionaryLookupDefaults();
  const body = {
    text,
    maxResults: requestBody.maxResults ?? defaults.maxResults,
    scanLength: requestBody.scanLength ?? defaults.scanLength,
    language: requestBody.language ?? defaults.language,
  };
  const serverUrl = getDictionaryServerUrl();
  const cacheKey = `${serverUrl}:${body.language}:${body.maxResults}:${body.scanLength}:${body.text}`;
  const cached = lookupCache.get(cacheKey);
  if (cached) return cached;

  const promise = requestJson<unknown>(
    `${serverUrl}/lookup`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    20_000,
  )
    .then(normalizeLookupResponse)
    .catch((err) => {
      lookupCache.delete(cacheKey);
      serverCooldownUntil = Date.now() + 3_000;
      throw err;
    });

  lookupCache.set(cacheKey, promise);
  return promise;
}

export async function checkDictionaryServer(): Promise<boolean> {
  try {
    const data = await requestJson<{ status?: string }>(getDictionaryServerUrl(), { method: "GET" }, 5_000);
    return data.status === "running";
  } catch {
    return false;
  }
}

export function clearDictionaryCache(): void {
  lookupCache.clear();
  serverCooldownUntil = 0;
}

export function glossaryToPlainText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return trimmed;

  try {
    return structuredContentToText(JSON.parse(trimmed)).replace(/[ \t]+\n/g, "\n").trim() || trimmed;
  } catch {
    return trimmed;
  }
}

function structuredContentToText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(structuredContentToText).filter(Boolean).join(" ");

  const item = asRecord(value);
  if (!item) return "";
  if (typeof item.text === "string") return item.text;
  if (item.tag === "br") return "\n";
  if (item.tag === "li") return `\n- ${structuredContentToText(item.content)}`;
  if (item.tag === "ul" || item.tag === "ol") return `\n${structuredContentToText(item.content)}`;
  if (item.content !== undefined) return structuredContentToText(item.content);
  return "";
}
