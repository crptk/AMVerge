// build-sidecar.mjs

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

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
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
  const triple = getArgValue("--target") || getRustTargetTriple();

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

  const sep = isWindows ? ";" : ":";
  const ffmpegBin = isWindows ? "bin/ffmpeg.exe" : "bin/ffmpeg";
  const ffprobeBin = isWindows ? "bin/ffprobe.exe" : "bin/ffprobe";

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

  if (isWindows) {
    pyinstallerArgs.push("--noconsole");
  }

  let cmd = pythonExe;
  let args = pyinstallerArgs;

  if (process.platform === "darwin" && triple === "x86_64-apple-darwin") {
    cmd = "arch";
    args = ["-x86_64", pythonExe, ...pyinstallerArgs];
  }

  run(cmd, args, { cwd: backendDir });

  await fs.rm(tauriSidecarDir, { recursive: true, force: true });
  await fs.mkdir(tauriSidecarDir, { recursive: true });
  await fs.cp(distDir, tauriSidecarDir, { recursive: true });

  const exeName = isWindows ? "backend_script.exe" : "backend_script";
  const exePath = path.join(tauriSidecarDir, exeName);
  const baseLib = path.join(tauriSidecarDir, "_internal", "base_library.zip");
  const ffmpegName = isWindows ? "ffmpeg.exe" : "ffmpeg";
  const ffprobeName = isWindows ? "ffprobe.exe" : "ffprobe";
  const internalDir = path.join(tauriSidecarDir, "_internal");

  async function ensureInternalTool(toolName) {
    const internalPath = path.join(internalDir, toolName);
    const rootPath = path.join(tauriSidecarDir, toolName);

    try {
      const stat = await fs.stat(internalPath);
      if (stat.isFile()) return internalPath;
    } catch {
      // Continue to root fallback.
    }

    try {
      const rootStat = await fs.stat(rootPath);
      if (rootStat.isFile()) {
        await fs.mkdir(internalDir, { recursive: true });
        await fs.copyFile(rootPath, internalPath);
        return internalPath;
      }
    } catch {
      // Missing in both root and _internal.
    }

    return null;
  }

  try {
    const exeStat = await fs.stat(exePath);
    if (!exeStat.isFile()) throw new Error(`${exeName} is not a file`);

    const baseStat = await fs.stat(baseLib);
    if (!baseStat.isFile()) throw new Error("base_library.zip is not a file");

    const ffmpegPath = await ensureInternalTool(ffmpegName);
    if (!ffmpegPath) throw new Error("ffmpeg sidecar binary is missing");

    const ffprobePath = await ensureInternalTool(ffprobeName);
    if (!ffprobePath) throw new Error("ffprobe sidecar binary is missing");
  } catch {
    throw new Error(
      `Sidecar sync finished, but required files are missing. Expected ${exePath}, ${baseLib}, and ffmpeg/ffprobe in either root or _internal of ${tauriSidecarDir}.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});