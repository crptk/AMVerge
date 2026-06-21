"""Backend utility package.

This package intentionally avoids re-exporting deprecated modules.
Import concrete helpers directly from their current modules, e.g.
`from backend.utils.general_utils import ...` or
`from backend.utils.binaries import ...`.
"""

__all__: list[str] = []