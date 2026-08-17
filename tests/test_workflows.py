import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class WorkflowConfigurationTests(unittest.TestCase):
    def test_collect_workflow_is_a_ten_minute_safe_data_commit(self):
        workflow = (ROOT / ".github" / "workflows" / "collect.yml").read_text()

        for expected in (
            "name: Collect Crunch occupancy",
            'cron: "7,17,27,37,47,57 * * * *"',
            "workflow_dispatch:",
            "contents: write",
            "ubuntu-latest",
            "actions/checkout@v4",
            "actions/setup-python@v5",
            "python-version: \"3.12\"",
            "python -m unittest discover -v",
            "python scripts/collector.py",
            "git add -- docs/data/readings.csv",
            "data: record Crunch occupancy",
            "git push",
        ):
            self.assertIn(expected, workflow)

        self.assertIn('git diff --cached --quiet || {', workflow)

    def test_analyze_workflow_is_a_daily_safe_insights_commit(self):
        workflow = (ROOT / ".github" / "workflows" / "analyze.yml").read_text()

        for expected in (
            "name: Analyze crowd insights",
            'cron: "23 23 * * *"',
            "workflow_dispatch:",
            "contents: write",
            "ubuntu-latest",
            "actions/checkout@v4",
            "actions/setup-python@v5",
            "python-version: \"3.12\"",
            "python -m unittest discover -v",
            "python scripts/analyze.py",
            "git add -- docs/data/insights.json",
            "data: refresh crowd insights",
            "git push",
        ):
            self.assertIn(expected, workflow)

        self.assertIn('git diff --cached --quiet || {', workflow)


if __name__ == "__main__":
    unittest.main()
