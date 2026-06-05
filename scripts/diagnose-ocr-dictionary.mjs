#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  commandExists,
  countImportedDictionaries,
  defaultDictionaryDataDir,
  hoshidictsBinaryPath,
  parseCliArgs,
  platformDictionaryRoot,
  repoRoot,
} from "./local-service-utils.mjs";

const args = parseCliArgs(process.argv.slice(2), {
  ocrUrl: "http://127.0.0.1:3000",
  dictionaryUrl: "http://127.0.0.1:3031",
});

const hoshidictsInstallPath = path.join(repoRoot, "hoshidicts-local");

function requestJson(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        let json = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json, body });
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timed out after ${timeoutMs}ms`));
    });
    req.on("error", (error) => {
      resolve({ ok: false, error: error.message });
    });
  });
}

function printCommandStatus() {
  const commands = ["git", "uv", "cmake", "ninja", "g++"];
  console.log("Tooling:");
  for (const command of commands) {
    console.log(`  ${command}: ${commandExists(command) ? "found" : "missing"}`);
  }
}

function printLocalInstalls() {
  const ocrEntry = path.join(repoRoot, "ocr-server-local", "server.py");
  const dictBinary = hoshidictsBinaryPath(hoshidictsInstallPath);

  console.log("Local service installs:");
  console.log(`  OCR server: ${fs.existsSync(ocrEntry) ? ocrEntry : "missing"}`);
  console.log(`  hoshidicts adapter: ${fs.existsSync(dictBinary) ? dictBinary : "missing"}`);
}

function printDictionaryRoot(label, root) {
  const counts = countImportedDictionaries(root);
  console.log(`  ${label}: ${root}`);
  console.log(`    term=${counts.term} frequency=${counts.frequency} pitch=${counts.pitch}`);
}

async function printEndpointStatus(name, url) {
  const result = await requestJson(url);
  if (!result.ok) {
    console.log(`  ${name}: unavailable at ${url}${result.error ? ` (${result.error})` : ""}`);
    return null;
  }

  console.log(`  ${name}: ${result.json?.status ?? `HTTP ${result.status}`} at ${url}`);
  return result.json;
}

console.log("Moku OCR/dictionary diagnostics");
console.log("");
printCommandStatus();
console.log("");
printLocalInstalls();
console.log("");

console.log("Dictionary roots:");
printDictionaryRoot("repo local", path.join(hoshidictsInstallPath, "dictionaries"));
printDictionaryRoot("platform", platformDictionaryRoot());
printDictionaryRoot("selected default", defaultDictionaryDataDir(hoshidictsInstallPath));
if (process.env.MOKU_HOSHIDICTS_DATA_DIR) {
  printDictionaryRoot("env MOKU_HOSHIDICTS_DATA_DIR", process.env.MOKU_HOSHIDICTS_DATA_DIR);
}
console.log("");

console.log("Endpoints:");
const ocrStatus = await printEndpointStatus("OCR", String(args.ocrUrl));
const dictStatus = await printEndpointStatus("Dictionary", String(args.dictionaryUrl));

if (dictStatus) {
  console.log(`  Dictionary data root in service: ${dictStatus.dataRoot ?? "unknown"}`);
  console.log(`  Loaded terms: ${(dictStatus.termDictionaries ?? []).join(", ") || "none"}`);
  console.log(`  Loaded frequencies: ${(dictStatus.frequencyDictionaries ?? []).join(", ") || "none"}`);
  console.log(`  Loaded pitches: ${(dictStatus.pitchDictionaries ?? []).join(", ") || "none"}`);
  if (Array.isArray(dictStatus.errors) && dictStatus.errors.length > 0) {
    console.log(`  Load errors: ${dictStatus.errors.join("; ")}`);
  }
}

console.log("");
console.log("Next checks:");
if (!ocrStatus) {
  console.log("  OCR is not reachable. Run `corepack pnpm setup:ocr`, then `corepack pnpm ocr:dev`.");
}
if (!dictStatus) {
  console.log("  Dictionary is not reachable. Run `corepack pnpm setup:hoshidicts`, then `corepack pnpm dict:dev`.");
}
if (dictStatus && Array.isArray(dictStatus.termDictionaries) && dictStatus.termDictionaries.length === 0) {
  console.log("  Dictionary service is running but has no term dictionaries loaded.");
}
