import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const submodulePath = path.join(repoRoot, "src-useq");

function git(args, cwd = repoRoot) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function getPinnedCommit() {
  const entry = git(["ls-tree", "HEAD", "src-useq"]);
  const match = entry.match(/^160000 commit ([0-9a-f]{40})\s+src-useq$/);
  if (!match) {
    throw new Error(`Unable to read src-useq gitlink from HEAD: ${entry}`);
  }
  return match[1];
}

const pinnedCommit = getPinnedCommit();
const checkedOutCommit = git(["rev-parse", "HEAD"], submodulePath);
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], submodulePath);
const remote = git(["config", "--file", ".gitmodules", "--get", "submodule.src-useq.url"]);
const dirty = git(["status", "--short"], submodulePath).length > 0;

process.stdout.write(`${JSON.stringify({
  path: "src-useq",
  remote,
  pinnedCommit,
  checkedOutCommit,
  branch,
  dirty,
}, null, 2)}\n`);
