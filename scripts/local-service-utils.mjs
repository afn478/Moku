import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptsDir, "..");

export function commandExists(command) {
  const checker = process.platform === "win32" ? "where" : "sh";
  const args = process.platform === "win32" ? [command] : ["-c", `command -v ${command}`];
  const result = spawnSync(checker, args, { stdio: "ignore" });
  return result.status === 0;
}

export function requireCommands(commands) {
  const missing = commands.filter((command) => !commandExists(command));
  if (missing.length > 0) {
    throw new Error(`Missing required command(s): ${missing.join(", ")}`);
  }
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
}

export function assertInside(parent, child) {
  const parentPath = path.resolve(parent);
  const childPath = path.resolve(child);
  const relative = path.relative(parentPath, childPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to touch path outside ${parentPath}: ${childPath}`);
  }
  return childPath;
}

export function parseCliArgs(argv, defaults = {}) {
  const out = { ...defaults };
  const rest = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    if (inlineValue !== undefined) {
      out[key] = inlineValue;
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }

  out._ = rest;
  return out;
}

export function hoshidictsBinaryPath(installPath) {
  const candidates = [
    path.join(installPath, "build", process.platform === "win32" ? "moku-hoshidicts-http.exe" : "moku-hoshidicts-http"),
    path.join(installPath, "build", "moku-hoshidicts-http"),
    path.join(installPath, "build", "moku-hoshidicts-http.exe"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

export function platformDictionaryRoot() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Dictionaries");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Dictionaries");
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "Dictionaries");
}

export function countImportedDictionaries(root) {
  const counts = { term: 0, frequency: 0, pitch: 0 };
  const groups = [
    ["Term", "term"],
    ["Frequency", "frequency"],
    ["Pitch", "pitch"],
  ];

  for (const [folder, key] of groups) {
    const dir = path.join(root, folder);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dictPath = path.join(dir, entry.name);
      if (fs.existsSync(path.join(dictPath, ".hoshidicts_1")) && fs.existsSync(path.join(dictPath, "index.json"))) {
        counts[key] += 1;
      }
    }
  }

  return counts;
}

export function hasImportedDictionaries(root) {
  const counts = countImportedDictionaries(root);
  return counts.term + counts.frequency + counts.pitch > 0;
}

export function defaultDictionaryDataDir(installPath) {
  if (process.env.MOKU_HOSHIDICTS_DATA_DIR) {
    return path.resolve(process.env.MOKU_HOSHIDICTS_DATA_DIR);
  }

  const repoLocal = path.join(installPath, "dictionaries");
  if (hasImportedDictionaries(repoLocal)) {
    return repoLocal;
  }

  const platformRoot = platformDictionaryRoot();
  if (hasImportedDictionaries(platformRoot)) {
    return platformRoot;
  }

  return repoLocal;
}

export function ensureDictionaryFolders(root) {
  for (const folder of ["Term", "Frequency", "Pitch"]) {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
  }
}
