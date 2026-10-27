# HA core 0212 release implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Release the Paseo runtime 0.2.2 HA add-on from PR #24 only after the approved 0212 core is public and the exact HAOS candidate passes provider and persistence acceptance.

**Architecture:** Keep PR #24 as the Paseo-only 0.2.9 line. Stage the approved core digest in the HA wrapper without changing its state paths or release workflow. Publish no stable image until GHCR and HAOS gates pass; sequence the Omnigent PR #23 afterward under a new version.

**Tech Stack:** Home Assistant add-on metadata, Docker, GitHub Actions, GHCR, Bash, Python, Node.js.

---

### Task 1: Stage the reviewed core pin

**Files:** `Dockerfile`, `build.yaml`, `.github/workflows/build.yml`, `.github/scripts/verify-public-core.py`, `tests/verify-public-core.test.py`, `tests/validate.py`, `tests/core-base.test.mjs`, `README.md`, `CHANGELOG.md`, `docs/paseo-runtime-0.2.2.md`.

1. Run `.github/scripts/pin-core.sh 20261027.0212 sha256:dde1a88f9c35f6588b9c61e8088dabfb8b337dddf3d4c9c998f1488bd38b3351` in the isolated HA worktree.
2. Update current release text to describe the staged pin and the publication gate. Keep historical 0.2.8 notes unchanged.
3. Add an anonymous GHCR tag-to-digest gate before PR smoke and public candidate builds. Test matching, missing and mismatched manifests locally without registry writes.
4. Run `git diff --check`, `bash tests/pin-core.test.sh`, `python3 tests/validate.py`, `node --test tests/core-base.test.mjs` and the complete `./tests/run.sh`.
5. Commit the draft source. Do not merge it while the public core tag is unavailable.

### Task 2: Rebuild from the public core

1. Confirm anonymous `crane digest ghcr.io/woowtech/open-design-core:20261027.0212` equals the approved digest and that the published image is amd64 with the asserted Claude Code, Codex, Pi and OpenCode versions.
2. Run exact-head PR validate, container/browser smoke and amd64 build against that core. Do not bypass an image-pull failure.
3. Dispatch `.github/workflows/build.yml` on the review branch with `candidate_core_image` set to the public tag plus digest; download `ha-candidate-receipt` and verify its source, core, runtime 0.2.2 and candidate manifest digest.

### Task 3: Native HAOS acceptance

1. Upgrade the dedicated HAOS instance through its canonical add-on repository entry from stable 0.2.8 to the newly built candidate, preserving the slug and `/data`.
2. Check plugin card and setup page through authenticated Ingress, Claude Code official GUI authorization, model catalog and two real conversation turns.
3. Check manual stop/start, cold backup/restore, retained project/conversation IDs and runtime reconstruction. Keep evidence tied to the exact new candidate digest.

### Task 4: Ordered stable publication

1. Resolve the two open 0.2.9 PRs: land Paseo PR #24 first after its gates, then rebase Omnigent PR #23 and bump its version. Confirm current main and PR heads before merging.
2. Merge only through the repository PR ruleset. Verify the main release workflow, immutable `0.2.9` image, `v0.2.9` Release/tag, Store catalog and stable HAOS upgrade.
3. If publication fails, use a fresh version-bump PR; never overwrite the published tag.
