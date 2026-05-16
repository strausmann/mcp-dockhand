# Design: Multi-arch (amd64 + arm64) Docker Images via Native Runners

**Date:** 2026-05-16
**Status:** Approved
**Tracking issue:** [#54](https://github.com/strausmann/mcp-dockhand/issues/54)
**Author:** Brainstormed via superpowers:brainstorming (compact pass — user pre-approved the native-runner pattern).

## Goal

Publish `ghcr.io/strausmann/mcp-dockhand` images for both `linux/amd64` and
`linux/arm64` from a single semantic-release run, so users on ARM-based
Docker hosts (Raspberry Pi, AWS Graviton, Apple Silicon Linux VMs, etc.)
can `docker pull` the same tags they get on amd64.

## Why native runners over QEMU

QEMU emulation works but is slow: an arm64 build of this Node 22 + TypeScript
image takes 3–5 min under QEMU vs ~30 s natively. Since 2025-01, GitHub
offers `ubuntu-24.04-arm` runners free for public repos — running each leg
natively is the right call when available, especially because this repo's
release pipeline is on the critical path (semantic-release blocks on it).

The label-printer-hub repo uses the exact same pattern; this design
re-applies it.

## Architecture

Two-phase pipeline in `release.yml`'s `docker` job:

```
┌── Phase 1: build per arch on its native runner (parallel) ──┐
│                                                              │
│  build-amd64                       build-arm64               │
│  runner: ubuntu-24.04              runner: ubuntu-24.04-arm  │
│  docker buildx build --platform linux/amd64                  │
│    → push by digest (no tag, just blob)                      │
│  upload digest artifact                                      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌── Phase 2: merge manifest (single job) ─────────────────────┐
│                                                              │
│  download both digest artifacts                              │
│  docker buildx imagetools create                             │
│    -t ghcr.io/.../mcp-dockhand:1.3.0                         │
│    -t ghcr.io/.../mcp-dockhand:1.3                           │
│    -t ghcr.io/.../mcp-dockhand:1                             │
│    -t ghcr.io/.../mcp-dockhand:latest                        │
│    ghcr.io/.../mcp-dockhand@sha256:<amd64>                   │
│    ghcr.io/.../mcp-dockhand@sha256:<arm64>                   │
│  verify multi-arch manifest                                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Why two phases:
- Phase 1 builds run in parallel — total time = max(amd64, arm64), not sum
- Phase 2 stitches the manifest without re-building — buildx imagetools
  composes manifest lists from already-pushed digests
- No QEMU anywhere → no emulation overhead

## Workflow file changes

### `.github/workflows/release.yml` — `docker` job replaced

Current `docker` job (single-arch):
```yaml
jobs:
  docker:
    needs: release
    if: needs.release.outputs.new_release_published == 'true'
    runs-on: ubuntu-latest
    steps:
      - checkout
      - setup buildx
      - login ghcr
      - extract tags
      - build-push-action (no platforms → linux/amd64 only)
```

New shape — two jobs:

```yaml
jobs:
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
    steps:
      - checkout @ release tag
      - setup buildx
      - login ghcr
      - compute lowercase image ref (GitHub repo name has caps, OCI demands lower)
      - build & push-by-digest with platform=${{ matrix.platform }}
      - upload digest artifact named digest-${{ matrix.arch }}

  docker-merge:
    needs: [release, docker-build]
    if: needs.release.outputs.new_release_published == 'true'
    runs-on: ubuntu-24.04
    steps:
      - download both digest artifacts
      - compute lowercase image ref
      - setup buildx
      - login ghcr
      - extract version tags (latest, version, major.minor, major)
      - docker buildx imagetools create with all tags from per-arch digests
      - verify manifest has both linux/amd64 and linux/arm64
```

### `.github/workflows/ci.yml` — `docker` smoke-test job extended

Current:
```yaml
docker:
  runs-on: ubuntu-latest
  needs: build
  steps:
    - uses: actions/checkout@v4
    - name: Build Docker image
      run: docker build -t mcp-dockhand:test .
```

New (multi-arch smoke, no push):
```yaml
docker:
  runs-on: ubuntu-latest
  needs: build
  steps:
    - uses: actions/checkout@v4
    - uses: docker/setup-qemu-action@v3   # for cross-build smoke
    - uses: docker/setup-buildx-action@v3
    - name: Build Docker image (multi-arch smoke)
      uses: docker/build-push-action@v6
      with:
        context: .
        platforms: linux/amd64,linux/arm64
        push: false
        cache-from: type=gha
```

Reason CI uses QEMU here (not native): PR builds happen frequently,
spinning up an ARM runner for every PR is overkill. The smoke-test
exists to catch Dockerfile breakage — QEMU is sufficient for a "does it
build" check. The release pipeline alone needs the native speed.

### Image manifest verification

Add a verification step after `imagetools create`:

```yaml
- name: Verify multi-arch manifest
  run: |
    set -euo pipefail
    for TAG in latest ${VERSION} ${MAJOR}.${MINOR} ${MAJOR}; do
      echo "Inspecting ghcr.io/${LOWER_REPO}:${TAG}..."
      ARCHS=$(docker buildx imagetools inspect "ghcr.io/${LOWER_REPO}:${TAG}" --raw \
        | jq -r '.manifests[].platform | "\(.os)/\(.architecture)"' | sort -u)
      echo "  architectures: $(echo "$ARCHS" | tr '\n' ' ')"
      echo "$ARCHS" | grep -q "linux/amd64" || { echo "::error::missing amd64 on $TAG"; exit 1; }
      echo "$ARCHS" | grep -q "linux/arm64" || { echo "::error::missing arm64 on $TAG"; exit 1; }
    done
```

## OCI labels — unchanged

The existing labels block in `build-push-action` stays — they remain
per-image labels and are baked into each platform manifest the same
way. The merge step copies them along.

## Dockerfile changes

**None.** `node:22-alpine` is multi-arch out of the box (Docker Hub
publishes manifests for amd64/arm64/arm/v7/ppc64le/s390x). The
multi-stage build, `apk add`s, `npm ci`, and `tsc` all work on both arches
without source-level changes. Verified by reading the Dockerfile —
no architecture-specific binaries or paths.

## Out of scope

- `linux/arm/v7` (32-bit ARM) — older Raspberry Pi pre-4. Add if user
  requests; not a blocker for #54 which says "arm64 devices".
- Dependabot config update for the GHCR image tags — not relevant, this
  is build-side.
- Caching strategy beyond GHA cache. The existing `cache-from: type=gha`
  already works.

## Acceptance criteria

1. `release.yml` builds and pushes both `linux/amd64` and `linux/arm64`
   for every release.
2. All tags (`latest`, `<version>`, `<major>.<minor>`, `<major>`) point
   at multi-arch manifest lists.
3. `docker buildx imagetools inspect <tag>` shows both platforms.
4. `docker pull --platform linux/arm64 ghcr.io/strausmann/mcp-dockhand:latest`
   succeeds on an arm64 host (Apple Silicon, RPi4+, Graviton, etc.).
5. `ci.yml`'s `docker` smoke job builds both platforms via QEMU on PR (no
   push) — catches Dockerfile regressions on the non-host arch.
6. Native runners are used for `release.yml` (no QEMU in the release
   pipeline — speed-critical path).
7. Release total wall-clock time stays under 5 min (current ~2 min for
   amd64-only; arm64 native ~30s parallel adds ~30s to phase 1, plus
   ~30s for the merge phase = ~3 min total).

## References

- [Issue #54](https://github.com/strausmann/mcp-dockhand/issues/54)
- Label-Printer-Hub `docker-publish.yml` (canonical 2-phase native-runner pattern)
- [GitHub native ARM runners announcement (2025-01)](https://github.blog/changelog/2025-01-16-linux-arm64-hosted-runners-now-available-for-free-in-public-repositories-public-preview/)
- [docker/build-push-action push-by-digest docs](https://docs.docker.com/build/ci/github-actions/multi-platform/#distribute-build-across-multiple-runners)
