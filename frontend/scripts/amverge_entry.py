"""PyInstaller entry point for bundling the AMVerge CLI as the app sidecar.

Kept in the app repo (not the CLI repo) so packaging never requires modifying
the CLI. It simply invokes the CLI's Typer app, so the frozen ``amverge`` exe
behaves exactly like the ``amverge`` console script:

    amverge backend <video> <output_dir> <scene_detection_method> <import_method>
"""

from amverge.cli import app

if __name__ == "__main__":
    app()
