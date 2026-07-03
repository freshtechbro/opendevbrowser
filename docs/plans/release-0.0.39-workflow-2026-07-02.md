# Release 0.0.39 Workflow Plan

Goal: release OpenDevBrowser `0.0.39` to npm and GitHub Releases with evidence-backed local and external release proof.

## Task 1 - Prepare Versioned Release Surface
Reasoning: Release commands must run from source metadata that already matches the target version.
What to do: Align package metadata, extension metadata, changelog, runbooks, docs pointers, and the active evidence ledger for `0.0.39`.
How:
1. Run `npm version 0.0.39 --no-git-tag-version`.
2. Run `npm run extension:sync` and `npm run version:check`.
3. Update release docs, changelog compare links, and evidence pointers from `0.0.38` to `0.0.39`.
Files impacted: `package.json`, `package-lock.json`, `extension/package.json`, `extension/manifest.json`, `CHANGELOG.md`, `README.md`, `docs/**/*.md`, `src/cli/AGENTS.md`.
Acceptance criteria:
- [ ] `npm run version:check` reports `0.0.39`.
- [ ] Documentation drift checks accept `docs/RELEASE_0.0.39_EVIDENCE.md` as the active ledger.

## Task 2 - Run Local Release Gates
Reasoning: Release prep must be proven before protected merge and external publishing.
What to do: Run the local release gate matrix from `docs/RELEASE_RUNBOOK.md`.
How:
1. Run version, docs drift, zombie audit, Chrome compliance, skill validators, help commands, lint, typecheck, build, test, extension build, extension pack, and npm pack.
2. Record command results and package evidence in the release ledger.
Files impacted: `docs/RELEASE_0.0.39_EVIDENCE.md`; ignored generated outputs under `coverage/`, `dist/`, `extension/dist/`, tarball and zip artifacts.
Acceptance criteria:
- [ ] All required local gates pass.
- [ ] Release evidence records any unavailable formatter or deferred strict live lanes explicitly.

## Task 3 - Merge Release Prep
Reasoning: npm and GitHub release surfaces should be produced from protected `main`, not an unmerged branch.
What to do: Commit the release-prep diff, push, open a PR, wait for required checks, merge, and update local `main`.
How:
1. Review and stage only release-prep tracked files.
2. Commit with a scoped Conventional Commit message.
3. Push `codex/release-0.0.39`, open PR, watch checks, merge, and fast-forward local `main`.
Files impacted: git branch `codex/release-0.0.39`, release PR, protected `main`.
Acceptance criteria:
- [ ] PR checks pass.
- [ ] Local `main` equals `origin/main` after merge.

## Task 4 - Publish npm And GitHub Release
Reasoning: The user explicitly requested npm and GitHub release, using local npm auth.
What to do: Publish npm locally, verify registry installation, dispatch the GitHub release workflow with npm publishing disabled, and verify assets.
How:
1. Verify `opendevbrowser@0.0.39` is absent from npm before publish.
2. Run `npm publish --access public`.
3. Run registry-consumer smoke for `0.0.39`.
4. Dispatch `.github/workflows/release-public.yml` with `release_ref=main`, `release_tag=v0.0.39`, `publish_npm=false`, `publish_github_release=true`, `draft_release=false`, and `run_release_live_gates=false`.
5. Wait for workflow success, verify the GitHub release, download assets, and validate checksum.
Files impacted: npm registry, GitHub release `v0.0.39`, ignored `artifacts/release/v0.0.39/registry-consumer-smoke.json`.
Acceptance criteria:
- [ ] npm `latest` is `0.0.39`.
- [ ] Registry consumer smoke passes.
- [ ] GitHub release `v0.0.39` exists with extension zip and checksum assets.
- [ ] Checksum verification passes.

## Task 5 - Land Final Evidence And Close
Reasoning: Live publish proof is only known after external release surfaces exist and should be preserved through protected review.
What to do: Update evidence with live npm and GitHub proof, land a protected evidence PR if tracked files changed, and verify final state.
How:
1. Patch `docs/RELEASE_0.0.39_EVIDENCE.md` with npm, workflow, release, checksum, and final git proof.
2. If tracked files changed, commit, push an evidence branch, open PR, wait checks, merge, and fast-forward local `main`.
3. Verify no tracked dirty files remain beyond intended preserved untracked docs.
Files impacted: `docs/RELEASE_0.0.39_EVIDENCE.md`, optional evidence PR, final `main`.
Acceptance criteria:
- [ ] Evidence PR is merged or no tracked evidence diff remains.
- [ ] Final npm and GitHub release checks still pass.
- [ ] `main == origin/main`.
