import importlib.util
import json
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
    def test_codex_live_log_path_uses_output_stem(self) -> None:
        path = runner.codex_live_log_path(pathlib.Path("/tmp/run/wave-1/verification.json"))
        self.assertEqual(path, pathlib.Path("/tmp/run/wave-1/verification.live.log"))

    def test_format_codex_event_line_summarizes_agent_messages(self) -> None:
        line = json.dumps(
            {
                "type": "item.completed",
                "item": {
                    "type": "agent_message",
                    "status": "completed",
                    "text": "Inspecting the runtime contract and startup path before making changes.",
                },
            }
        )
        formatted = runner.format_codex_event_line(line)
        self.assertIn("item.completed: agent_message status=completed", formatted)
        self.assertIn("Inspecting the runtime contract", formatted)

    def test_format_codex_event_line_summarizes_command_completion(self) -> None:
        line = json.dumps(
            {
                "type": "item.completed",
                "item": {
                    "type": "command_execution",
                    "status": "completed",
                    "command": "/usr/bin/zsh -lc 'npm run typecheck'",
                    "exit_code": 0,
                },
            }
        )
        formatted = runner.format_codex_event_line(line)
        self.assertIn("item.completed: command status=completed exit=0", formatted)
        self.assertIn("npm run typecheck", formatted)

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

    def test_build_verify_prompt_uses_context_file_and_allows_open_parent_epic(self) -> None:
        prompt = runner.build_verify_prompt(
            {"branch": "codex/test"},
            pathlib.Path("/tmp/run"),
            1,
            pathlib.Path("/tmp/run/wave-1/verification.json"),
        )
        self.assertIn("/tmp/run/wave-1/verification-context.json", prompt)
        self.assertIn("parent wave epic may still be open", prompt)

    def test_close_wave_epic_if_ready_closes_parent_after_successful_verification(self) -> None:
        state = {
            "waves": {
                "1": {
                    "wave_epic_id": "bd-wave",
                    "phases": {},
                }
            }
        }
        with (
            patch.object(runner, "remaining_wave_issues", return_value=[]),
            patch.object(runner, "show_issue", return_value={"id": "bd-wave", "status": "open"}),
            patch.object(runner, "run_cmd") as run_cmd,
            patch.object(runner, "export_bd_state") as export_bd_state,
        ):
            runner.close_wave_epic_if_ready(
                state,
                pathlib.Path("/tmp/run"),
                1,
                {"status": "ready_for_next_wave", "summary": "Wave ready."},
            )

        run_cmd.assert_called_once_with(
            ["bd", "close", "bd-wave", "--reason", "Wave ready.", "--json"]
        )
        export_bd_state.assert_called_once()


if __name__ == "__main__":
    unittest.main()
