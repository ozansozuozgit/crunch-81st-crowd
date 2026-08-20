import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which("node"), "Node.js is required for dashboard runtime contract tests")
class DashboardRuntimeContracts(unittest.TestCase):
    def test_context_states_and_invalid_typed_values(self):
        subprocess.run(
            ["node", "tests/dashboard_context_runtime.js"],
            cwd=ROOT,
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
