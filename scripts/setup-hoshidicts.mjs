#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  commandExists,
  ensureDictionaryFolders,
  hoshidictsBinaryPath,
  repoRoot,
  requireCommands,
  run,
} from "./local-service-utils.mjs";

const installPath = path.join(repoRoot, "hoshidicts-local");
const srcPath = path.join(installPath, "src");
const buildPath = path.join(installPath, "build");
const serverSource = path.join(repoRoot, "scripts", "hoshidicts-http-server.cpp");
const localServerSource = path.join(installPath, "moku-hoshidicts-http.cpp");
const wrapperCmake = path.join(installPath, "CMakeLists.txt");
const commit = "be5cdd4b1b6cba28858919fe28a00396d285a865";

requireCommands(["git", "cmake"]);

fs.mkdirSync(installPath, { recursive: true });

if (!fs.existsSync(path.join(srcPath, ".git"))) {
  run("git", ["clone", "--recurse-submodules", "https://github.com/1Selxo/hoshidicts.git", srcPath]);
} else {
  run("git", ["-C", srcPath, "fetch", "--all", "--tags"]);
  run("git", ["-C", srcPath, "submodule", "update", "--init", "--recursive"]);
}

run("git", ["-C", srcPath, "checkout", commit]);
run("git", ["-C", srcPath, "submodule", "update", "--init", "--recursive"]);

fs.copyFileSync(serverSource, localServerSource);

fs.writeFileSync(
  wrapperCmake,
  `cmake_minimum_required(VERSION 3.22.1)
project(moku_hoshidicts_http LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_subdirectory(src hoshidicts-build)

add_executable(moku-hoshidicts-http
  moku-hoshidicts-http.cpp
)

target_compile_features(moku-hoshidicts-http PRIVATE cxx_std_23)
target_link_libraries(moku-hoshidicts-http PRIVATE hoshidicts)

if(WIN32)
  target_link_libraries(moku-hoshidicts-http PRIVATE ws2_32)
endif()
`,
  "utf8",
);

const dictRoot = path.join(installPath, "dictionaries");
ensureDictionaryFolders(dictRoot);

const configureArgs = ["-S", installPath, "-B", buildPath];
if (commandExists("ninja")) {
  configureArgs.push("-G", "Ninja");
}
if (commandExists("g++")) {
  configureArgs.push("-DCMAKE_CXX_COMPILER=g++");
}

run("cmake", configureArgs);
run("cmake", ["--build", buildPath, "--target", "moku-hoshidicts-http"]);

console.log("");
console.log("hoshidicts adapter built:");
console.log(`  ${hoshidictsBinaryPath(installPath)}`);
console.log("Dictionary folders:");
console.log(`  Term:      ${path.join(dictRoot, "Term")}`);
console.log(`  Frequency: ${path.join(dictRoot, "Frequency")}`);
console.log(`  Pitch:     ${path.join(dictRoot, "Pitch")}`);
console.log("");
console.log("Start it with:");
console.log("  corepack pnpm dict:dev");
console.log("");
console.log("To use an existing dictionary root:");
console.log("  MOKU_HOSHIDICTS_DATA_DIR=/path/to/Dictionaries corepack pnpm dict:dev");
