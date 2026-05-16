# ARM64 Docker Images — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Build and publish multi-arch (linux/amd64 + linux/arm64) Docker images for mcp-dockhand using GitHub native ARM runners in the release pipeline and QEMU smoke-test in CI.

**Architecture:** Split `release.yml`'s `docker` job into a 2-phase pipeline — `docker-build` (matrix per arch on its native runner, push by digest) + `docker-merge` (manifest list assembly with `buildx imagetools create`). Extend `ci.yml`'s `docker` smoke-test to build both platforms via QEMU (no push).

**Tech Stack:** GitHub Actions, docker/setup-buildx-action, docker/build-push-action@v6, docker/setup-qemu-action.

**Issue:** [strausmann/mcp-dockhand#54](https://github.com/strausmann/mcp-dockhand/issues/54)

**Spec:** `/tmp/mcp-dockhand/docs/designs/2026-05-16-arm64-docker-images-design.md`

**Branch:** `feat/arm64-docker-images` (off main, spec + this plan committed)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `.github/workflows/release.yml` | Modify | Replace single `docker` job with `docker-build` matrix + `docker-merge` |
| `.github/workflows/ci.yml` | Modify | Extend `docker` smoke job to multi-arch via QEMU |
| `docs/designs/2026-05-16-arm64-docker-images-design.md` | Already created | Design spec |
| `docs/plans/2026-05-16-arm64-docker-images.md` | This file | Implementation plan |

---

## Task 1: Extend `ci.yml docker` smoke job to multi-arch

**File:** `/tmp/mcp-dockhand/.github/workflows/ci.yml`

The current `docker` job uses plain `docker build` for amd64 only. Switch to `docker/build-push-action` with QEMU + buildx for a multi-arch smoke check. No push — just verify both platforms build.

- [ ] **Step 1.1: Replace the `docker` job in `ci.yml`**

Find the existing job:

```yaml
  docker:
    runs-on: ubuntu-latest
    needs: build

    steps:
      - uses: actions/checkout@v4

      - name: Build Docker image
        run: docker build -t mcp-dockhand:test .
```

Replace with:

```yaml
  docker:
    runs-on: ubuntu-latest
    needs: build

    steps:
      - uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build Docker image (multi-arch smoke)
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: false
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 1.2: Commit**

```bash
cd /tmp/mcp-dockhand
git add .github/workflows/ci.yml
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" commit -m "$(cat <<'EOF'
ci(ci): smoke-test Docker build on both linux/amd64 and linux/arm64

Switches the PR docker job from a single-arch `docker build` to a
QEMU-backed buildx multi-platform build (no push). Catches
Dockerfile regressions on either architecture before code lands on
main. QEMU is acceptable here because PR builds are not on a release
critical path; the native-runner pattern in release.yml handles
the speed-sensitive publish step.

Refs #54
EOF
)"
```

---

## Task 2: Replace `release.yml docker` with 2-phase native-runner pipeline

**File:** `/tmp/mcp-dockhand/.github/workflows/release.yml`

The current single `docker` job stays in place conceptually but is split into `docker-build` (per-arch matrix on native runners, push by digest, upload digest as artifact) and `docker-merge` (download digests, assemble manifest list, push tags). All four tags (`latest`, `<version>`, `<major>.<minor>`, `<major>`) now point at a multi-arch manifest.

- [ ] **Step 2.1: Replace the entire `docker` job in `release.yml`**

The current `docker` job (in `release.yml`, after the `release` job, lines roughly 60-110) reads as a single ubuntu-latest job that does checkout + buildx + login + extract-tags + build-push-action.

Delete the existing `docker:` job block in its entirety and replace with these TWO jobs:

```yaml
  docker-build:
    needs: release
    if: needs.release.outputs.new_release_published == 'true'
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: linux/amd64
            runner: ubuntu-24.04
            arch: amd64
          - platform: linux/arm64
            runner: ubuntu-24.04-arm
            arch: arm64
    runs-on: ${{ matrix.runner }}
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          ref: v${{ needs.release.outputs.new_release_version }}

      - name: Compute lowercase image ref
        id: image
        env:
          REPO: ${{ github.repository }}
        run: |
          repo_lc="${REPO,,}"
          echo "ref=ghcr.io/${repo_lc}" >> "$GITHUB_OUTPUT"

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log into registry ghcr.io
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push by digest
        id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: ${{ matrix.platform }}
          push: true
          outputs: type=image,name=${{ steps.image.outputs.ref }},push-by-digest=true,name-canonical=true,push=true
          cache-from: type=gha,scope=${{ matrix.arch }}
          cache-to: type=gha,mode=max,scope=${{ matrix.arch }}
          labels: |
            org.opencontainers.image.title=MCP-Dockhand
            org.opencontainers.image.description=Model Context Protocol (MCP) Server for Dockhand Docker Management — 130+ tools for container, stack, image, network, and volume management.
            org.opencontainers.image.authors=Bjoern Strausmann
            org.opencontainers.image.url=https://github.com/${{ github.repository }}
            org.opencontainers.image.source=https://github.com/${{ github.repository }}
            org.opencontainers.image.version=${{ needs.release.outputs.new_release_version }}
            org.opencontainers.image.revision=${{ github.sha }}
            org.opencontainers.image.licenses=MIT

      - name: Export digest
        run: |
          mkdir -p /tmp/digests
          digest="${{ steps.build.outputs.digest }}"
          touch "/tmp/digests/${digest#sha256:}"

      - name: Upload digest artifact
        uses: actions/upload-artifact@v4
        with:
          name: digest-${{ matrix.arch }}
          path: /tmp/digests/*
          if-no-files-found: error
          retention-days: 1

  docker-merge:
    needs: [release, docker-build]
    if: needs.release.outputs.new_release_published == 'true'
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      packages: write

    steps:
      - name: Download digest artifacts
        uses: actions/download-artifact@v4
        with:
          pattern: digest-*
          path: /tmp/digests
          merge-multiple: true

      - name: Compute lowercase image ref
        id: image
        env:
          REPO: ${{ github.repository }}
        run: |
          repo_lc="${REPO,,}"
          echo "ref=ghcr.io/${repo_lc}" >> "$GITHUB_OUTPUT"

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log into registry ghcr.io
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract version tags
        id: version
        run: |
          VERSION="${{ needs.release.outputs.new_release_version }}"
          MAJOR=$(echo "$VERSION" | cut -d. -f1)
          MINOR=$(echo "$VERSION" | cut -d. -f2)
          echo "version=${VERSION}" >> "$GITHUB_OUTPUT"
          echo "major=${MAJOR}" >> "$GITHUB_OUTPUT"
          echo "minor=${MINOR}" >> "$GITHUB_OUTPUT"

      - name: Create manifest list and push
        working-directory: /tmp/digests
        env:
          IMAGE_REF: ${{ steps.image.outputs.ref }}
          VERSION: ${{ steps.version.outputs.version }}
          MAJOR: ${{ steps.version.outputs.major }}
          MINOR: ${{ steps.version.outputs.minor }}
        run: |
          set -euo pipefail
          # Build source manifest refs from the digest filenames
          src_args=()
          for d in *; do
            src_args+=( "${IMAGE_REF}@sha256:${d}" )
          done
          # Tags
          tag_args=(
            -t "${IMAGE_REF}:latest"
            -t "${IMAGE_REF}:${VERSION}"
            -t "${IMAGE_REF}:${MAJOR}.${MINOR}"
            -t "${IMAGE_REF}:${MAJOR}"
          )
          docker buildx imagetools create "${tag_args[@]}" "${src_args[@]}"

      - name: Verify multi-arch manifest
        env:
          IMAGE_REF: ${{ steps.image.outputs.ref }}
          VERSION: ${{ steps.version.outputs.version }}
          MAJOR: ${{ steps.version.outputs.major }}
          MINOR: ${{ steps.version.outputs.minor }}
        run: |
          set -euo pipefail
          fail=0
          for TAG in latest "${VERSION}" "${MAJOR}.${MINOR}" "${MAJOR}"; do
            echo "Inspecting ${IMAGE_REF}:${TAG}..."
            archs=$(docker buildx imagetools inspect "${IMAGE_REF}:${TAG}" --raw \
              | jq -r '.manifests[].platform | "\(.os)/\(.architecture)"' \
              | sort -u)
            echo "  architectures: $(echo "$archs" | tr '\n' ' ')"
            if ! echo "$archs" | grep -q "linux/amd64"; then
              echo "::error::Missing linux/amd64 in ${TAG}"
              fail=1
            fi
            if ! echo "$archs" | grep -q "linux/arm64"; then
              echo "::error::Missing linux/arm64 in ${TAG}"
              fail=1
            fi
          done
          exit "$fail"
```

- [ ] **Step 2.2: Verify YAML is syntactically valid**

Run:
```bash
cd /tmp/mcp-dockhand && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"
echo "exit=$?"
```

Expected: exit 0, no output (valid YAML).

- [ ] **Step 2.3: Verify only the docker job changed**

```bash
cd /tmp/mcp-dockhand && git diff --stat
```

Expected: exactly one file changed (`.github/workflows/release.yml`).

Run:
```bash
cd /tmp/mcp-dockhand && git diff -U2 .github/workflows/release.yml | head -100
```

Spot-check: the `release` job above `docker-build` is unchanged. The new `docker-build` and `docker-merge` replace the old `docker` job.

- [ ] **Step 2.4: Commit**

```bash
cd /tmp/mcp-dockhand
git add .github/workflows/release.yml
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" commit -m "$(cat <<'EOF'
feat(ci): publish multi-arch (amd64 + arm64) Docker images on release

Splits the release pipeline's docker job into a 2-phase native-runner
build:

  Phase 1 (docker-build): matrix per arch, each leg runs on its native
  GitHub runner (ubuntu-24.04 for amd64, ubuntu-24.04-arm for arm64).
  Builds push by digest only — no tag is created yet. Digest is
  uploaded as a job artifact for the merge phase.

  Phase 2 (docker-merge): downloads both digests, uses
  `docker buildx imagetools create` to assemble a multi-arch manifest
  list and tag it as :latest, :<version>, :<major>.<minor>, and
  :<major>. Verifies the manifest contains both platforms before
  declaring success.

Native runners avoid QEMU emulation overhead (arm64 build drops from
3-5 min to ~30 s parallel). End-to-end release stays well under the
prior amd64-only timing because both legs run in parallel.

Closes #54

Refs #54
EOF
)"
```

---

## Task 3: Verify and push

- [ ] **Step 3.1: Final state check**

```bash
cd /tmp/mcp-dockhand
git log --oneline main..HEAD
```

Expected (newest first):
```
<sha>  feat(ci): publish multi-arch (amd64 + arm64) Docker images on release
<sha>  ci(ci): smoke-test Docker build on both linux/amd64 and linux/arm64
<sha>  docs(ci): implementation plan for ARM64 Docker images
<sha>  docs(ci): design spec for ARM64 Docker images
```

Four commits total (two docs + one ci + one feat). If a commit was made for the design spec or this plan from the orchestrator's pre-task setup, that's fine — it's already on the branch.

- [ ] **Step 3.2: Confirm no Co-Authored-By trailers**

```bash
cd /tmp/mcp-dockhand && git log main..HEAD --pretty=format:'%b' | grep -i 'co-authored-by' || echo "clean (good)"
```

Expected: `clean (good)`.

- [ ] **Step 3.3: Hand off to orchestrator**

DO NOT push. DO NOT open the PR. The orchestrator handles those steps after the implementer's report.

## Spec Coverage Self-Review

| Spec section | Covered by task |
|---|---|
| § Architecture (2-phase pipeline) | Task 2 (both jobs) |
| § Workflow file changes — release.yml | Task 2 |
| § Workflow file changes — ci.yml | Task 1 |
| § Image manifest verification | Task 2 Step 2.1 (verify step) |
| § OCI labels unchanged | Task 2 (labels block preserved on the per-arch build) |
| § Dockerfile changes — none | No task (no file change needed) |
| § Out of scope (arm/v7, dependabot) | No task (explicitly excluded) |
| § Acceptance criteria 1-7 | Tasks 1 + 2 cover all seven |
