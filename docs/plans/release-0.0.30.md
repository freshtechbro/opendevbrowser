# Release 0.0.30 Plan

## Task 1 - Prepare Release Metadata
Reasoning: the release needs one version authority across npm, extension metadata, docs, and evidence before publishing.
What to do: bump the project from `0.0.29` to `0.0.30` and document the release scope.
How:
1. Update root package metadata and lockfile to `0.0.30`.
2. Run `npm run extension:sync` so extension metadata matches the root package version.
3. Update release-facing docs that point at the current tarball or release evidence ledger.
Files impacted: `package.json`, `package-lock.json`, `extension/manifest.json`, `extension/package.json`, `docs/CLI.md`, `docs/FIRST_RUN_ONBOARDING.md`, `docs/ARCHITECTURE.md`, `docs/README.md`, `docs/AGENTS.md`, `CHANGELOG.md`, `docs/RELEASE_0.0.30_EVIDENCE.md`.
Acceptance criteria:
- [ ] `npm run version:check` passes for `0.0.30`.
- [ ] Docs reference `docs/RELEASE_0.0.30_EVIDENCE.md` as the active release ledger.

## Task 2 - Run Local Release Gates
Reasoning: publishing should only happen after the same local gates required by the runbook pass on the exact release tree.
What to do: execute release runbook preflight gates and package proof.
How:
1. Run version, audit, docs drift, Chrome compliance, skill asset, help, lint, typecheck, test, build, extension build, extension pack, and npm pack gates.
2. Record command outcomes in the release evidence doc.
3. Keep generated local artifacts out of commits unless the release evidence doc explicitly references ignored output paths.
Files impacted: `docs/RELEASE_0.0.30_EVIDENCE.md`, generated ignored artifacts under `artifacts/`, `coverage/`, and packaging outputs.
Acceptance criteria:
- [ ] Mandatory local release gates pass.
- [ ] `npm pack --pack-destination /tmp` produces `opendevbrowser-0.0.30.tgz`.
- [ ] `opendevbrowser-extension.zip` and checksum are produced for GitHub release assets.

## Task 3 - Publish Release
Reasoning: the public package and GitHub release must be produced from a committed, tagged release tree.
What to do: commit the implementation and release prep, push the branch, merge or otherwise publish from the release commit, then publish `v0.0.30`.
How:
1. Commit focused implementation, tests, docs, and release metadata with the required trailer.
2. Push the release branch.
3. Ensure `main` contains the release commit before tagging.
4. Create and push `v0.0.30`.
5. Monitor `.github/workflows/release-public.yml`.
Files impacted: git history, GitHub Actions release workflow, npm registry, GitHub releases.
Acceptance criteria:
- [ ] Tag `v0.0.30` exists on the release commit.
- [ ] npm `opendevbrowser@0.0.30` is published.
- [ ] GitHub release `v0.0.30` is published with extension zip and checksum assets.

## Task 4 - Verify and Record Post-Release Proof
Reasoning: release success is the registry and GitHub state plus fresh consumer proof, not only a successful tag push.
What to do: verify npm, run registry consumer smoke, verify GitHub release assets, and update evidence.
How:
1. Run `npm view opendevbrowser version dist-tags --json`.
2. Run `node scripts/registry-consumer-smoke.mjs --version 0.0.30 --output artifacts/release/v0.0.30/registry-consumer-smoke.json`.
3. Verify the GitHub release URL and uploaded assets.
4. Update `docs/RELEASE_0.0.30_EVIDENCE.md` with final proof.
Files impacted: `docs/RELEASE_0.0.30_EVIDENCE.md`, `artifacts/release/v0.0.30/registry-consumer-smoke.json`.
Acceptance criteria:
- [ ] npm latest is `0.0.30`.
- [ ] Registry consumer smoke passes for `0.0.30`.
- [ ] GitHub release URL and asset names are recorded.
