import importlib.util
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch


REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / "scripts" / "heartbeat_codex_runner.py"
SPEC = importlib.util.spec_from_file_location("heartbeat_codex_runner", MODULE_PATH)
runner = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)


class HeartbeatCodexRunnerTests(unittest.TestCase):
    def test_should_attempt_issue_close_when_completed_even_if_issue_closed_false(self) -> None:
        self.assertTrue(runner.should_attempt_issue_close({"status": "completed", "issue_closed": False}))

    def test_should_not_attempt_issue_close_for_open_blocked_result(self) -> None:
        self.assertFalse(runner.should_attempt_issue_close({"status": "blocked", "issue_closed": False}))

    def test_close_issue_if_needed_closes_saved_completed_result(self) -> None:
        open_issue = {"id": "bd-1", "status": "open"}
        closed_issue = {"id": "bd-1", "status": "closed"}
        with (
            patch.object(runner, "show_issue", side_effect=[open_issue, closed_issue]) as show_issue,
            patch.object(runner, "run_cmd") as run_cmd,
        ):
            issue_state = runner.close_issue_if_needed(
                "bd-1",
                {
                    "status": "completed",
                    "issue_closed": False,
                    "summary": "Finished the work.",
                },
            )

        self.assertEqual(issue_state["status"], "closed")
        show_issue.assert_called()
        run_cmd.assert_called_once_with(
            ["bd", "close", "bd-1", "--reason", "Finished the work.", "--json"]
        )

    def test_load_saved_issue_result_accepts_any_valid_result_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = pathlib.Path(tmpdir) / "result.json"
            path.write_text('{"status":"needs_followup","summary":"x"}', encoding="utf-8")
            loaded = runner.load_saved_issue_result(path)
        self.assertEqual(loaded["status"], "needs_followup")

    def test_build_issue_resume_error_includes_artifact_path(self) -> None:
        message = runner.build_issue_resume_error(
            "bd-1",
            2,
            pathlib.Path("/tmp/run/issues/bd-1"),
            {"status": "completed", "summary": "Done", "notes": "bd unavailable"},
            bd_status="open",
            close_error="database offline",
        )
        self.assertIn("bd-1", message)
        self.assertIn("/tmp/run/issues/bd-1", message)
        self.assertIn("database offline", message)
        self.assertIn("Resume from wave 2 phase execute_issues", message)


if __name__ == "__main__":
    unittest.main()
