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

function getBuildTargetTriple() {
  return (
    getArgValue("--target") ||
    process.env.SIDECAR_TARGET_TRIPLE ||
    process.env.TAURI_ENV_TARGET_TRIPLE ||
    process.env.CARGO_BUILD_TARGET ||
    getRustTargetTriple()
  );
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
  const triple = getBuildTargetTriple();

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const frontendDir = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(frontendDir, "..");

  // CLI checkout: AMVERGE_CLI_DIR override, else the in-repo ./AMVerge-CLI clone.
  const cliDir = process.env.AMVERGE_CLI_DIR || path.join(repoRoot, "AMVerge-CLI");

  // Production builds install the CLI into an isolated build venv (not the
  // editable dev venv), so the bundle is a clean, reproducible pip install.
  // AMVERGE_BUILD_VENV can point at an existing venv to reuse it.
  const buildVenvDir =
    process.env.AMVERGE_BUILD_VENV || path.join(cliDir, ".venv-build");
  const venvBin = isWindows ? "Scripts" : "bin";
  const buildPython = isWindows
    ? path.join(buildVenvDir, venvBin, "python.exe")
    : path.join(buildVenvDir, venvBin, "python");

  // PyInstaller entry: a tiny launcher kept in the app repo so the CLI repo is
  // never modified just to be packaged. It imports amverge from the CLI venv.
  const entryScript = path.join(scriptDir, "amverge_entry.py");

  // ffmpeg/ffprobe still ship inside the sidecar _internal (both the CLI and Rust
  // resolve them there). FFMPEG_BIN_DIR overrides; default is the legacy
  // backend/bin — relocate these out of backend/ before deleting that folder.
  const ffmpegBinDir = process.env.FFMPEG_BIN_DIR || path.join(repoRoot, "backend", "bin");

  const distDir = path.join(cliDir, "dist", "amverge");

  const tauriSidecarDir = path.join(
    frontendDir,
    "src-tauri",
    "bin",
    `amverge-${triple}`
  );

  const sep = isWindows ? ";" : ":";
  const ffmpegBin = path.join(ffmpegBinDir, isWindows ? "ffmpeg.exe" : "ffmpeg");
  const ffprobeBin = path.join(ffmpegBinDir, isWindows ? "ffprobe.exe" : "ffprobe");

  // --- Provision the build venv and install the CLI via pip ------------------
  const basePython = process.env.PYTHON || (isWindows ? "python" : "python3");
  const extras = process.env.AMVERGE_CLI_EXTRAS || "ml,dev";
  // Default install source: the local CLI checkout (so prod ships current code).
  // Override with AMVERGE_CLI_INSTALL_SPEC (e.g. "amverge[ml]" for the PyPI release).
  const installSpec =
    process.env.AMVERGE_CLI_INSTALL_SPEC || `${cliDir}[${extras}]`;
  // CUDA torch wheel index (Windows GPU). Empty string skips the explicit torch
  // install (macOS uses the default CPU wheel pulled by the [ml] extra).
  const torchIndexUrl =
    process.env.AMVERGE_TORCH_INDEX_URL ??
    (isWindows ? "https://download.pytorch.org/whl/cu128" : "");
  const neluxSpec =
    process.env.AMVERGE_NELUX_SPEC ||
    "git+https://github.com/NevermindNilas/Nelux.git";

  let buildPythonExists = false;
  try {
    buildPythonExists = (await fs.stat(buildPython)).isFile();
  } catch {
    buildPythonExists = false;
  }
  if (!buildPythonExists) {
    // A venv's python can bootstrap another venv, so basePython may be the dev
    // interpreter or a system one on PATH (override with PYTHON).
    run(basePython, ["-m", "venv", buildVenvDir]);
  }

  run(buildPython, ["-m", "pip", "install", "--upgrade", "pip"]);
  // CLI itself (regular, non-editable) + extras: ml pulls torch/transnetv2,
  // dev pulls pyinstaller. --upgrade so each build picks up the latest CLI code.
  run(buildPython, ["-m", "pip", "install", "--upgrade", installSpec]);
  // GPU torch: the [ml] extra resolves a CPU wheel on Windows, so override it
  // with the CUDA build for prod. Skipped when torchIndexUrl is empty.
  if (torchIndexUrl) {
    run(buildPython, [
      "-m", "pip", "install", "--upgrade",
      "torch", "--index-url", torchIndexUrl,
    ]);
  }
  // nelux is Windows-only (NVDEC GPU decode); other platforms fall back to the
  // CLI's FFmpeg parallel decode and don't need it.
  if (isWindows) {
    run(buildPython, ["-m", "pip", "install", "--upgrade", neluxSpec]);
  }
  // ---------------------------------------------------------------------------

  await fs.rm(distDir, { recursive: true, force: true });

  const pyinstallerArgs = [
    "-m",
    "PyInstaller",
    entryScript,
    "--onedir",
    "--clean",
    "--noconfirm",
    "--name",
    "amverge",
    "--add-binary",
    `${ffmpegBin}${sep}.`,
    "--add-binary",
    `${ffprobeBin}${sep}.`,
    // nelux ships a native extension plus its own FFmpeg DLLs (nelux.libs via
    // delvewheel); collect-all grabs the package, binaries, and data together.
    "--collect-all",
    "nelux",
    // transnetv2-pytorch ships model weights as package data files.
    "--collect-data",
    "transnetv2_pytorch",
  ];

  if (process.platform === "darwin") {
    if (triple === "x86_64-apple-darwin") {
      pyinstallerArgs.push("--target-arch", "x86_64");
    } else if (triple === "aarch64-apple-darwin") {
      pyinstallerArgs.push("--target-arch", "arm64");
    }
  }

  if (isWindows) {
    pyinstallerArgs.push("--noconsole");
  }

  let cmd = buildPython;
  let args = pyinstallerArgs;

  if (process.platform === "darwin" && triple === "x86_64-apple-darwin") {
    cmd = "arch";
    args = ["-x86_64", buildPython, ...pyinstallerArgs];
  }

  run(cmd, args, { cwd: cliDir });

  await fs.rm(tauriSidecarDir, { recursive: true, force: true });
  await fs.mkdir(tauriSidecarDir, { recursive: true });
  await fs.cp(distDir, tauriSidecarDir, { recursive: true });

  const exeName = isWindows ? "amverge.exe" : "amverge";
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