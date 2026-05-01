# -*- mode: python ; coding: utf-8 -*-
import sys

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[
        (('bin/ffmpeg.exe' if sys.platform.startswith('win') else 'bin/ffmpeg'), '.'),
        (('bin/ffprobe.exe' if sys.platform.startswith('win') else 'bin/ffprobe'), '.'),
    ],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='backend_script',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    # Keep console hidden on Windows, visible on macOS/Linux to avoid .app sidecar issues.
    console=not sys.platform.startswith('win'),
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='backend_script',
)
