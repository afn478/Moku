#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertInside,
  repoRoot,
  requireCommands,
  run,
} from "./local-service-utils.mjs";

const sourceRepo = "https://github.com/1Selxo/Mangatan.git";
const sourceCommit = "c0dd60363f0b5fbf562d0608d1339fc109cc73cd";

const bundlePath = path.join(repoRoot, "ocr-server-local");
const tempRoot = path.join(os.tmpdir(), "moku-mangatan-ocr");
const clonePath = path.join(tempRoot, "Mangatan");

function replaceOrThrow(text, search, replacement) {
  if (!text.includes(search)) {
    throw new Error(`Could not patch OCR server; missing expected snippet: ${search}`);
  }
  return text.replace(search, replacement);
}

function patchOcrServer(serverPath) {
  let serverText = fs.readFileSync(serverPath, "utf8");

  serverText = replaceOrThrow(
    serverText,
    'IP_ADDRESS = "0.0.0.0"',
    'IP_ADDRESS = os.environ.get("MANGATAN_OCR_IP", "127.0.0.1")',
  );
  serverText = replaceOrThrow(
    serverText,
    "PORT = 3000",
    'PORT = int(os.environ.get("MANGATAN_OCR_PORT", "3000"))',
  );
  serverText = replaceOrThrow(
    serverText,
    'app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER',
    `app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

@app.after_request
def add_moku_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response`,
  );
  serverText = replaceOrThrow(
    serverText,
    'SERVER_URL_BASE = "http://127.0.0.1:3000"',
    'SERVER_URL_BASE = f"http://127.0.0.1:{PORT}"',
  );

  fs.writeFileSync(serverPath, serverText, "utf8");
}

requireCommands(["git", "uv"]);

fs.mkdirSync(tempRoot, { recursive: true });

if (fs.existsSync(clonePath)) {
  fs.rmSync(assertInside(tempRoot, clonePath), { recursive: true, force: true });
}

console.log("Cloning Mangatan OCR server source...");
run("git", ["clone", "--quiet", "--filter=blob:none", sourceRepo, clonePath]);
run("git", ["-C", clonePath, "checkout", "--quiet", sourceCommit]);

const sourceServerPath = path.join(clonePath, "ocr-server");
const sourceEntryPath = path.join(sourceServerPath, "server.py");
if (!fs.existsSync(sourceEntryPath)) {
  throw new Error(`Could not find Mangatan ocr-server/server.py at ${sourceServerPath}`);
}

if (fs.existsSync(bundlePath)) {
  fs.rmSync(assertInside(repoRoot, bundlePath), { recursive: true, force: true });
}
fs.cpSync(sourceServerPath, bundlePath, { recursive: true });
patchOcrServer(path.join(bundlePath, "server.py"));

console.log("Installing OCR server Python dependencies with uv...");
run("uv", ["sync", "--frozen", "--no-dev"], { cwd: bundlePath });

console.log("");
console.log("OCR server ready:");
console.log(`  ${bundlePath}`);
console.log("Run it with:");
console.log("  corepack pnpm ocr:dev");
