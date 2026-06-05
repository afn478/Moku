import { lookupDictionaryText, type HoshiLookupResult } from "$lib/components/reader/lib/dictionary";

export interface DictionaryLookupAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
  isVertical: boolean;
}

type LookupStatus = "idle" | "loading" | "ready" | "empty" | "error";

export const dictionaryLookupState = $state({
  open: false,
  status: "idle" as LookupStatus,
  query: "",
  anchor: null as DictionaryLookupAnchor | null,
  results: [] as HoshiLookupResult[],
  error: null as string | null,
  requestId: 0,
});

function normalizeQuery(text: string): string {
  return text.replace(/\u200B/g, "").trim();
}

export function closeDictionaryLookup() {
  dictionaryLookupState.open = false;
  dictionaryLookupState.status = "idle";
  dictionaryLookupState.error = null;
}

export function openDictionaryLookup(text: string, anchor: DictionaryLookupAnchor) {
  const query = normalizeQuery(text);
  if (!query) return;

  const requestId = dictionaryLookupState.requestId + 1;
  dictionaryLookupState.requestId = requestId;
  dictionaryLookupState.open = true;
  dictionaryLookupState.status = "loading";
  dictionaryLookupState.query = query;
  dictionaryLookupState.anchor = anchor;
  dictionaryLookupState.results = [];
  dictionaryLookupState.error = null;

  lookupDictionaryText({ text: query })
    .then((results) => {
      if (dictionaryLookupState.requestId !== requestId) return;
      dictionaryLookupState.results = results;
      dictionaryLookupState.status = results.length > 0 ? "ready" : "empty";
    })
    .catch((err) => {
      if (dictionaryLookupState.requestId !== requestId) return;
      dictionaryLookupState.status = "error";
      dictionaryLookupState.error = err instanceof Error ? err.message : "Dictionary lookup failed";
    });
}

export function retryDictionaryLookup() {
  const anchor = dictionaryLookupState.anchor;
  const query = dictionaryLookupState.query;
  if (!anchor || !query) return;
  openDictionaryLookup(query, anchor);
}
