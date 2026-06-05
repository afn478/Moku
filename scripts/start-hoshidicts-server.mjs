#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  defaultDictionaryDataDir,
  ensureDictionaryFolders,
  hoshidictsBinaryPath,
  parseCliArgs,
  repoRoot,
  run,
} from "./local-service-utils.mjs";

const args = parseCliArgs(process.argv.slice(2), {
  port: "3031",
  dataDir: "",
  language: "ja",
});

const installPath = path.join(repoRoot, "hoshidicts-local");
const binaryPath = hoshidictsBinaryPath(installPath);

if (!fs.existsSync(binaryPath)) {
  throw new Error("hoshidicts adapter is not built yet. Run: corepack pnpm setup:hoshidicts");
}

const dataDir = args.dataDir
  ? path.resolve(String(args.dataDir))
  : defaultDictionaryDataDir(installPath);

ensureDictionaryFolders(dataDir);

console.log(`Starting Moku hoshidicts server at http://127.0.0.1:${args.port}`);
console.log(`Dictionary root: ${dataDir}`);

run(binaryPath, [
  "--port", String(args.port),
  "--data-dir", dataDir,
  "--language", String(args.language),
]);
