#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  parseCliArgs,
  repoRoot,
  requireCommands,
  run,
} from "./local-service-utils.mjs";

const args = parseCliArgs(process.argv.slice(2), {
  engine: "lens",
  ip: "127.0.0.1",
  port: "3000",
  debug: false,
});

const serverPath = path.join(repoRoot, "ocr-server-local");
const entryPath = path.join(serverPath, "server.py");

if (!fs.existsSync(entryPath)) {
  throw new Error("OCR server is not set up yet. Run: corepack pnpm setup:ocr");
}

if (!["lens", "oneocr"].includes(String(args.engine))) {
  throw new Error("Invalid OCR engine. Use --engine lens or --engine oneocr");
}

requireCommands(["uv"]);

const uvArgs = ["run", "server.py", "--engine", String(args.engine)];
if (args.debug) {
  uvArgs.push("--debug");
}

console.log(`Starting Moku OCR server with ${args.engine} at http://${args.ip}:${args.port}`);
run("uv", uvArgs, {
  cwd: serverPath,
  env: {
    ...process.env,
    MANGATAN_OCR_IP: String(args.ip),
    MANGATAN_OCR_PORT: String(args.port),
  },
});
