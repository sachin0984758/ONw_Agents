from __future__ import annotations

import asyncio
import json
import shutil
import os
import sys
import tempfile
import unittest
from pathlib import Path

from mcp import Client
from mcp.client.stdio import StdioServerParameters

from agent_env.core import AgentToolError, LocalAgent, parse_github_directory_url
from agent_env.github import GitHubClient
from agent_env.server import create_server


SKILL_URL = "https://github.com/example/skills/tree/main/skills/demo-skill"


class FakeGitHub:
    def __init__(self):
        self.files = {
            "skills/demo-skill/SKILL.md": b"---\nname: demo-skill\ndescription: Safe fixture for dry-run install tests.\n---\n# Demo Skill\nDo not execute files.\n",
            "skills/demo-skill/references/guide.md": b"# Guide\nReference text.\n",
            "skills/demo-skill/scripts/never-run.py": b"raise RuntimeError('This fixture must never run')\n",
        }

    def list_directory(self, owner: str, repo: str, ref: str, path: str) -> list[dict]:
        if path == "skills/demo-skill":
            return [
                {"type": "file", "path": "skills/demo-skill/SKILL.md", "size": len(self.files["skills/demo-skill/SKILL.md"]), "download_url": "https://raw.githubusercontent.com/example/skills/main/skills/demo-skill/SKILL.md"},
                {"type": "dir", "path": "skills/demo-skill/references"},
                {"type": "dir", "path": "skills/demo-skill/scripts"},
            ]
        if path == "skills/demo-skill/references":
            key = "skills/demo-skill/references/guide.md"
        elif path == "skills/demo-skill/scripts":
            key = "skills/demo-skill/scripts/never-run.py"
        else:
            return []
        return [{"type": "file", "path": key, "size": len(self.files[key]), "download_url": "https://raw.githubusercontent.com/example/skills/main/" + key}]

    def download(self, url: str, owner: str, repo: str, ref: str, expected_path: str) -> bytes:
        path = urlparse_path(url)
        return self.files[path]


def urlparse_path(url: str) -> str:
    return "/".join(url.split("/")[6:])


class AgentEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        shutil.copytree(Path(__file__).resolve().parents[1] / "skills" / "test-skill", self.root / "skills" / "test-skill")
        self.agent = LocalAgent(self.root, github=FakeGitHub())

    def tearDown(self):
        self.temp.cleanup()

    def test_skill_listing_and_reading_include_supporting_markdown(self):
        skills = self.agent.list_skills()
        self.assertEqual([item["name"] for item in skills], ["test-skill"])
        self.assertIn("harmless example", skills[0]["description"])
        data = self.agent.read_skill("test-skill", supporting_paths=["references/notes.md"])
        self.assertIn("UNTRUSTED THIRD-PARTY CONTENT", data["warning"])
        self.assertEqual({doc["path"] for doc in data["documents"]}, {"SKILL.md", "references/notes.md"})

    def test_workspace_path_restrictions_and_overwrite_confirmation(self):
        for path in ("../outside.txt", "a/../../outside.txt", "C:/Windows/win.ini", "/etc/passwd", "NUL.txt", "a:stream"):
            with self.subTest(path=path), self.assertRaises(AgentToolError):
                self.agent.write_workspace_file(path, "blocked")
        target = self.agent.workspace / "notes" / "todo.txt"
        self.assertIn("Created", self.agent.write_workspace_file("notes/todo.txt", "first"))
        self.assertEqual(self.agent.read_workspace_file("notes/todo.txt"), "first")
        with self.assertRaisesRegex(AgentToolError, "Approval"):
            self.agent.write_workspace_file("notes/todo.txt", "second")
        self.agent.write_workspace_file("notes/todo.txt", "second", confirm_overwrite=True)
        self.assertEqual(target.read_text(encoding="utf-8"), "second")
        with tempfile.TemporaryDirectory() as outside:
            link = self.agent.workspace / "outside-link"
            try:
                os.symlink(outside, link, target_is_directory=True)
            except (OSError, NotImplementedError):
                return
            with self.assertRaisesRegex(AgentToolError, "links and junctions"):
                self.agent.write_workspace_file("outside-link/escape.txt", "blocked")

    def test_project_skills_directory_cannot_be_redirected_outside(self):
        with tempfile.TemporaryDirectory() as root_name, tempfile.TemporaryDirectory() as outside:
            root = Path(root_name)
            try:
                os.symlink(outside, root / "skills", target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("This Windows account does not allow creating directory symlinks.")
            with self.assertRaisesRegex(AgentToolError, "symbolic link or junction"):
                LocalAgent(root)

    def test_github_url_validation_rejects_other_hosts_and_traversal(self):
        parsed = parse_github_directory_url(SKILL_URL)
        self.assertEqual((parsed.owner, parsed.repo, parsed.ref, parsed.path), ("example", "skills", "main", "skills/demo-skill"))
        for url in (
            "http://github.com/example/skills/tree/main/skills/demo-skill",
            "https://evil.example/example/skills/tree/main/skills/demo-skill",
            "https://github.com/example/skills/tree/main/skills/%2e%2e/secrets",
            "https://github.com/example/skills/blob/main/skills/demo-skill/SKILL.md",
            "https://github.com@example.org/example/skills/tree/main/skill",
        ):
            with self.subTest(url=url), self.assertRaises(AgentToolError):
                parse_github_directory_url(url)

    def test_github_download_url_must_match_exact_expected_file(self):
        client = GitHubClient()
        with self.assertRaisesRegex(AgentToolError, "download URL"):
            client.download(
                "https://raw.githubusercontent.com/example/skills/main/skills/other/SKILL.md",
                "example",
                "skills",
                "main",
                "skills/demo-skill/SKILL.md",
            )

    def test_dry_run_lists_files_without_writing_or_running_scripts(self):
        result = self.agent.install_skill_from_github(SKILL_URL, dry_run=True)
        self.assertTrue(result["dry_run"])
        self.assertFalse(result["installed"])
        self.assertIn("scripts/never-run.py", [item["path"] for item in result["files"]])
        self.assertFalse((self.root / "skills" / "demo-skill" / "scripts").exists())
        self.assertFalse((self.root / "skills" / "demo-skill").exists())

    def test_install_requires_approval_never_executes_downloaded_scripts(self):
        with self.assertRaisesRegex(AgentToolError, "Approval required"):
            self.agent.install_skill_from_github(SKILL_URL)
        result = self.agent.install_skill_from_github(SKILL_URL, confirm_install=True)
        self.assertTrue(result["installed"])
        installed = self.root / "skills" / "demo-skill"
        self.assertTrue((installed / "SKILL.md").is_file())
        self.assertTrue((installed / "scripts" / "never-run.py").is_file())
        self.assertFalse((installed / "execution-proof.txt").exists())
        with self.assertRaisesRegex(AgentToolError, "never replaces"):
            self.agent.install_skill_from_github(SKILL_URL, confirm_install=True)

    def test_node_project_inspection_and_fixed_action_approval(self):
        project = self.agent.workspace / "projects" / "sample"
        project.mkdir(parents=True)
        (project / "package.json").write_text(json.dumps({"name": "sample", "scripts": {"build": "echo unsafe"}, "dependencies": {"vite": "1"}}), encoding="utf-8")
        (project / "src").mkdir()
        (project / "src" / "main.js").write_text("export {}", encoding="utf-8")
        info = self.agent.inspect_project("projects/sample")
        self.assertEqual(info["name"], "sample")
        self.assertIn("src/main.js", info["source_files"])
        self.assertFalse(info["dependencies_installed"])
        with self.assertRaisesRegex(AgentToolError, "Approval required"):
            self.agent.run_project_action("projects/sample", "build")
        with self.assertRaisesRegex(AgentToolError, "Allowed actions"):
            self.agent.run_project_action("projects/sample", "echo bad", confirm_execution=True)
        with self.assertRaisesRegex(AgentToolError, "path must not contain"):
            self.agent.inspect_project("../outside")

    def test_game_plan_conditional_skills_edit_search_and_restart_state(self):
        result = self.agent.create_game_plan("games/puzzle", "A small 2D puzzle game about rotating mirrors to guide light.", genre="puzzle")
        self.assertEqual(result["genre"], "puzzle")
        self.assertIn("web-game-development", result["skills_to_load"])
        self.assertNotIn("web-3d-game-development", result["skills_to_load"])
        self.assertNotIn("game-physics", result["skills_to_load"])
        for filename in ("GAME_DESIGN.md", "TECHNICAL_DESIGN.md", "TASK_PLAN.md", "ACCEPTANCE_TESTS.md"):
            self.assertTrue((self.agent.workspace / "games" / "puzzle" / filename).is_file())
        with self.assertRaisesRegex(AgentToolError, "Approval required"):
            self.agent.create_game_plan("games/puzzle", "replacement concept")
        status = self.agent.update_game_task("games/puzzle", "G1", "in_progress", "Checking project files")
        self.assertEqual(status["overall_status"], "in_progress")
        restarted = LocalAgent(self.root, github=FakeGitHub())
        persisted = restarted.get_game_task("games/puzzle")
        self.assertEqual(persisted["tasks"][0]["status"], "in_progress")
        self.assertEqual(persisted["history"][-1]["note"], "Checking project files")

        self.agent.write_workspace_file("games/puzzle/src/game.js", "export const score = 0;\n")
        with self.assertRaisesRegex(AgentToolError, "Approval required"):
            self.agent.edit_workspace_file("games/puzzle/src/game.js", "score = 0", "score = 1")
        self.agent.edit_workspace_file("games/puzzle/src/game.js", "score = 0", "score = 1", confirm_edit=True)
        hits = self.agent.search_workspace("score = 1", path="games/puzzle")
        self.assertEqual(hits[0]["path"], "games/puzzle/src/game.js")

    def test_project_inspection_is_read_only_and_detects_godot(self):
        project = self.agent.workspace / "games" / "godot"
        project.mkdir(parents=True)
        marker = project / "project.godot"
        marker.write_text("config_version=5\n", encoding="utf-8")
        before = marker.read_bytes()
        info = self.agent.inspect_project("games/godot")
        self.assertIn("godot", info["project_types"])
        self.assertEqual(info["runner_support"], [])
        self.assertEqual(marker.read_bytes(), before)

    def test_real_mcp_client_invokes_tools_and_surfaces_restrictions(self):
        server = create_server(self.agent)

        async def exercise():
            project = self.agent.workspace / "projects" / "sample"
            project.mkdir(parents=True)
            (project / "package.json").write_text('{"name":"sample"}', encoding="utf-8")
            async with Client(server) as client:
                tools = await client.list_tools()
                names = {tool.name for tool in tools.tools}
                self.assertEqual(names, {"install_skill_from_github", "list_skills", "read_skill", "read_workspace_file", "write_workspace_file", "edit_workspace_file", "search_workspace", "list_workspace_files", "inspect_project", "run_project_action", "create_game_plan", "get_game_task", "update_game_task"})
                listed = await client.call_tool("list_skills", {})
                self.assertFalse(listed.is_error)
                self.assertIn("test-skill", listed.content[0].text)
                read = await client.call_tool("read_skill", {"name": "test-skill", "supporting_paths": ["references/notes.md"]})
                self.assertFalse(read.is_error)
                self.assertIn("UNTRUSTED THIRD-PARTY CONTENT", read.content[0].text)
                denied = await client.call_tool("read_workspace_file", {"path": "../outside.txt"})
                self.assertTrue(denied.is_error)
                inspected = await client.call_tool("inspect_project", {"project_path": "projects/sample"})
                self.assertFalse(inspected.is_error)
                self.assertIn('"name": "sample"', inspected.content[0].text)
                written = await client.call_tool("write_workspace_file", {"path": "mcp-created.txt", "content": "via MCP"})
                self.assertFalse(written.is_error)
                self.assertEqual(self.agent.read_workspace_file("mcp-created.txt"), "via MCP")
                preview = await client.call_tool("install_skill_from_github", {"url": SKILL_URL, "dry_run": True})
                self.assertFalse(preview.is_error)
                self.assertIn('"installed": false', preview.content[0].text)
                unapproved = await client.call_tool("run_project_action", {"project_path": "projects/sample", "action": "build"})
                self.assertTrue(unapproved.is_error)

        asyncio.run(exercise())

    def test_stdio_server_launches_and_serves_mcp_tools(self):
        workspace = self.root / "workspace"
        workspace.mkdir(exist_ok=True)
        (workspace / "hello.txt").write_text("stdio works", encoding="utf-8")
        project_root = Path(__file__).resolve().parents[1]
        child_env = dict(os.environ)
        child_env["LOCAL_AGENT_HOME"] = str(self.root)
        child_env["AGENT_WORKSPACE"] = str(workspace)
        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "agent_env.server"],
            cwd=project_root,
            env=child_env,
        )

        async def exercise():
            async with Client(params, read_timeout_seconds=10) as client:
                tools = await client.list_tools()
                names = {tool.name for tool in tools.tools}
                self.assertTrue({"write_workspace_file", "inspect_project", "run_project_action", "list_workspace_files", "create_game_plan", "get_game_task", "update_game_task", "edit_workspace_file", "search_workspace"}.issubset(names))
                result = await client.call_tool("read_workspace_file", {"path": "hello.txt"})
                self.assertFalse(result.is_error)
                self.assertIn("stdio works", result.content[0].text)

        asyncio.run(exercise())


if __name__ == "__main__":
    unittest.main(verbosity=2)
