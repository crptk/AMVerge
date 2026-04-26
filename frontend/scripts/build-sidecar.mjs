// build-sidecar.mjs
//
// This script builds the Python backend using PyInstaller, bundles required binaries (ffmpeg.exe, ffprobe.exe),
// and copies the output into the Tauri sidecar bin directory for packaging with the desktop app.
// It ensures the Tauri app always includes the latest backend and dependencies for distribution.
// Keep in mind that this is only ran on "npm run tauri build"

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} exited with code ${result.status}`);
  }
}

async function main() {
  // fetching all the file paths necessary for building to dist
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const frontendDir = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(frontendDir, "..");
  const backendDir = path.join(repoRoot, "backend");

  const pythonExe =
    process.platform === "win32"
      ? path.join(backendDir, "venv", "Scripts", "python.exe")
      : path.join(backendDir, "venv", "bin", "python");

  const distDir = path.join(backendDir, "dist", "backend_script");
  const tauriSidecarDir = path.join(
    frontendDir,
    "src-tauri",
    "bin",
    "backend_script-x86_64-pc-windows-msvc"
  );

  /*
  after all file paths are found, we:
  1) Delete the entire distDir directory (backend_script directory)
  2) Run the command to build the new backend folder using PyInstaller
  3) Delete the old contents of sidecar directory and recreate the new one with new build folder
  */
  await fs.rm(distDir, { recursive: true, force: true });
  run(
    pythonExe,
    [
      "-m",
      "PyInstaller",
      "app.py",
      "--onedir",
      "--noconsole",
      "--clean",
      "--noconfirm",
      "--name",
      "backend_script",
      "--add-binary",
      "bin/ffmpeg.exe;.",
      "--add-binary",
      "bin/ffprobe.exe;.",
    ],
    { cwd: backendDir }
  );
  await fs.rm(tauriSidecarDir, { recursive: true, force: true });
  await fs.mkdir(tauriSidecarDir, { recursive: true });
  await fs.cp(distDir, tauriSidecarDir, { recursive: true });

  // sanity check: verify expected onedir layout exists
  const exePath = path.join(tauriSidecarDir, "backend_script.exe");
  const baseLib = path.join(tauriSidecarDir, "_internal", "base_library.zip");

  try {
    const exeStat = await fs.stat(exePath);
    if (!exeStat.isFile()) throw new Error("backend_script.exe is not a file");
    const baseStat = await fs.stat(baseLib);
    if (!baseStat.isFile()) throw new Error("base_library.zip is not a file");
  } catch {
    throw new Error(
      `Sidecar sync finished, but required files are missing. Expected ${exePath} and ${baseLib}.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
