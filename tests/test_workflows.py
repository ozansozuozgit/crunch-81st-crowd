import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHECKOUT_V4_2_2 = "11bd71901bbe5b1630ceea73d27597364c9af683"
SETUP_PYTHON_V5_6_0 = "a26af69be951a213d495a4c3e4e4022e16d87065"


class WorkflowConfigurationTests(unittest.TestCase):
    def test_collect_workflow_is_a_manual_archive_path_when_cloudflare_is_primary(self):
        workflow = (ROOT / ".github" / "workflows" / "collect.yml").read_text()

        for expected in (
            "name: Collect Crunch occupancy",
            "workflow_dispatch:",
            "contents: write",
            "ubuntu-latest",
            f"actions/checkout@{CHECKOUT_V4_2_2}",
            f"actions/setup-python@{SETUP_PYTHON_V5_6_0}",
            "python-version: \"3.12\"",
            "python -m pip install --requirement requirements.txt",
            "python -m unittest discover -v",
            "python scripts/collector.py",
            "git add -- docs/data/readings.csv",
            "data: record Crunch occupancy",
            'for attempt in 1 2 3; do',
            'git fetch origin "${GITHUB_REF_NAME}"',
            'git rebase "origin/${GITHUB_REF_NAME}"',
            'git push origin "HEAD:${GITHUB_REF_NAME}"',
            'sleep "$attempt"',
            'git diff --name-only --diff-filter=U',
            '[ "$conflicted_files" = "docs/data/readings.csv" ]',
            "python scripts/merge_readings.py docs/data/readings.csv",
            "GIT_EDITOR=true git rebase --continue",
            "git push",
        ):
            self.assertIn(expected, workflow)

        self.assertIn('git diff --cached --quiet || {', workflow)
        self.assertNotIn("schedule:", workflow)
        self.assertLess(
            workflow.index("python -m pip install --requirement requirements.txt"),
            workflow.index("python -m unittest discover -v"),
        )
        self.assertNotIn("actions/checkout@v4", workflow)
        self.assertNotIn("actions/setup-python@v5", workflow)
        self.assertNotIn("concurrency:", workflow)

    def test_analyze_workflow_is_a_manual_archive_path_when_cloudflare_is_primary(self):
        workflow = (ROOT / ".github" / "workflows" / "analyze.yml").read_text()

        for expected in (
            "name: Analyze crowd insights",
            "workflow_dispatch:",
            "contents: write",
            "ubuntu-latest",
            f"actions/checkout@{CHECKOUT_V4_2_2}",
            f"actions/setup-python@{SETUP_PYTHON_V5_6_0}",
            "python-version: \"3.12\"",
            "python -m pip install --requirement requirements.txt",
            "python -m unittest discover -v",
            "python scripts/sync_classes.py",
            "python scripts/analyze.py",
            "git add -- docs/data/classes.csv docs/data/classes_meta.json docs/data/insights.json",
            "data: refresh crowd context",
            'for attempt in 1 2 3; do',
            'git fetch origin "${GITHUB_REF_NAME}"',
            'git rebase "origin/${GITHUB_REF_NAME}"',
            'git push origin "HEAD:${GITHUB_REF_NAME}"',
            'sleep "$attempt"',
            'git diff --name-only --diff-filter=U',
            "docs/data/classes.csv",
            "docs/data/classes_meta.json",
            "docs/data/insights.json",
            "unexpected_files=",
            "git checkout --ours -- docs/data/classes.csv docs/data/classes_meta.json docs/data/insights.json",
            "GIT_EDITOR=true git rebase --continue",
            "git push",
        ):
            self.assertIn(expected, workflow)

        self.assertIn('git diff --cached --quiet || {', workflow)
        self.assertNotIn("schedule:", workflow)
        self.assertLess(
            workflow.index("python -m pip install --requirement requirements.txt"),
            workflow.index("python -m unittest discover -v"),
        )
        self.assertLess(
            workflow.index("python scripts/sync_classes.py"),
            workflow.index("python scripts/analyze.py"),
        )
        self.assertNotIn("actions/checkout@v4", workflow)
        self.assertNotIn("actions/setup-python@v5", workflow)
        self.assertNotIn("concurrency:", workflow)


if __name__ == "__main__":
    unittest.main()
