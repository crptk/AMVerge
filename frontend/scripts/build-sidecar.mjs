// build-sidecar.mjs
//
// This script builds the Python backend using PyInstaller, bundles required binaries (ffmpeg, ffprobe),
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

function getRustTargetTriple() {
  if (process.platform === "win32") return "x86_64-pc-windows-msvc";
  if (process.platform === "darwin") {
    return process.arch === "arm64"
      ? "aarch64-apple-darwin"
      : "x86_64-apple-darwin";
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

async function main() {
  const isWindows = process.platform === "win32";
  const triple = getRustTargetTriple();

  // fetching all the file paths necessary for building to dist
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const frontendDir = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(frontendDir, "..");
  const backendDir = path.join(repoRoot, "backend");

  const pythonExe = isWindows
    ? path.join(backendDir, "venv", "Scripts", "python.exe")
    : path.join(backendDir, "venv", "bin", "python");

  const distDir = path.join(backendDir, "dist", "backend_script");
  const tauriSidecarDir = path.join(
    frontendDir,
    "src-tauri",
    "bin",
    `backend_script-${triple}`
  );

  // PyInstaller --add-binary separator is ";" on Windows, ":" on macOS/Linux
  const sep = isWindows ? ";" : ":";
  const ffmpegBin = isWindows ? "bin/ffmpeg.exe" : "bin/ffmpeg";
  const ffprobeBin = isWindows ? "bin/ffprobe.exe" : "bin/ffprobe";

  /*
  after all file paths are found, we:
  1) Delete the entire distDir directory (backend_script directory)
  2) Run the command to build the new backend folder using PyInstaller
  3) Delete the old contents of sidecar directory and recreate the new one with new build folder
  */
  await fs.rm(distDir, { recursive: true, force: true });

  const pyinstallerArgs = [
    "-m",
    "PyInstaller",
    "app.py",
    "--onedir",
    "--clean",
    "--noconfirm",
    "--name",
    "backend_script",
    "--add-binary",
    `${ffmpegBin}${sep}.`,
    "--add-binary",
    `${ffprobeBin}${sep}.`,
  ];

  // --noconsole hides the Windows console window. On macOS it produces a .app
  // bundle instead of a plain binary, which Tauri cannot invoke as a sidecar.
  if (isWindows) {
    pyinstallerArgs.push("--noconsole");
  }

  run(pythonExe, pyinstallerArgs, { cwd: backendDir });

  await fs.rm(tauriSidecarDir, { recursive: true, force: true });
  await fs.mkdir(tauriSidecarDir, { recursive: true });
  await fs.cp(distDir, tauriSidecarDir, { recursive: true });

  // sanity check: verify expected onedir layout exists
  const exeName = isWindows ? "backend_script.exe" : "backend_script";
  const exePath = path.join(tauriSidecarDir, exeName);
  const baseLib = path.join(tauriSidecarDir, "_internal", "base_library.zip");

  try {
    const exeStat = await fs.stat(exePath);
    if (!exeStat.isFile()) throw new Error(`${exeName} is not a file`);
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
