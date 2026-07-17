# MCP-Dockhand Changelog

All notable changes to **MCP-Dockhand** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.3](https://github.com/strausmann/mcp-dockhand/compare/v1.8.2...v1.8.3) (2026-07-17)

### Bug Fixes

* **deps:** regenerate lockfile so node:22-alpine npm ci is consistent ([#103](https://github.com/strausmann/mcp-dockhand/issues/103)) ([8678b33](https://github.com/strausmann/mcp-dockhand/commit/8678b33ceb258c75bc30817e6dd4849c9307faf5)), closes [#69](https://github.com/strausmann/mcp-dockhand/issues/69)

## [1.8.2](https://github.com/strausmann/mcp-dockhand/compare/v1.8.1...v1.8.2) (2026-07-17)

### Bug Fixes

* **deps:** sync package-lock with semantic-release conventional-commits deps ([#102](https://github.com/strausmann/mcp-dockhand/issues/102)) ([ee930ae](https://github.com/strausmann/mcp-dockhand/commit/ee930ae5f3da0de2fa0ca67287b120496e37309f))

## [1.8.1](https://github.com/strausmann/mcp-dockhand/compare/v1.8.0...v1.8.1) (2026-07-16)

### Bug Fixes

* **ci:** pin artifact actions to v7 (upload-artifact has no v8) ([#101](https://github.com/strausmann/mcp-dockhand/issues/101)) ([9b9ed9f](https://github.com/strausmann/mcp-dockhand/commit/9b9ed9f636445be6ddaacece01048d02d4f5a857)), closes [#100](https://github.com/strausmann/mcp-dockhand/issues/100)

## [1.8.0](https://github.com/strausmann/mcp-dockhand/compare/v1.7.0...v1.8.0) (2026-07-16)

### Features

* **tools:** close MCP API coverage gap — 19 new tools (MISSING_TOOL: 20 → 0) ([#94](https://github.com/strausmann/mcp-dockhand/issues/94)) ([a31c4e0](https://github.com/strausmann/mcp-dockhand/commit/a31c4e06ed89462918c2b7c4269469bc8c4f7490)), closes [#82](https://github.com/strausmann/mcp-dockhand/issues/82)

### Bug Fixes

* **ci:** align upload-artifact to v8 to match download-artifact ([#100](https://github.com/strausmann/mcp-dockhand/issues/100)) ([d499a5f](https://github.com/strausmann/mcp-dockhand/commit/d499a5fae867364b5ac26f2db8e581352449d389)), closes [#68](https://github.com/strausmann/mcp-dockhand/issues/68)
* **ci:** event-agnostic timestamp for OCI image.created label ([#98](https://github.com/strausmann/mcp-dockhand/issues/98)) ([048a650](https://github.com/strausmann/mcp-dockhand/commit/048a6505c1b3f86a1b65f80087ed26aaa57dabcb)), closes [#97](https://github.com/strausmann/mcp-dockhand/issues/97)
* **ci:** run releases nightly + on demand, not on every push to main ([#97](https://github.com/strausmann/mcp-dockhand/issues/97)) ([d896927](https://github.com/strausmann/mcp-dockhand/commit/d89692789d9dbbe1ae72826ee6f0be4636c61993))

## [1.7.0](https://github.com/strausmann/mcp-dockhand/compare/v1.6.2...v1.7.0) (2026-07-16)

### Features

* **ci:** auto-update sticky coverage tracker on every schema sync ([#61](https://github.com/strausmann/mcp-dockhand/issues/61)) ([2ca6254](https://github.com/strausmann/mcp-dockhand/commit/2ca62548625d9c26abb8364fb03e277fa5a19862)), closes [#60](https://github.com/strausmann/mcp-dockhand/issues/60)

## [1.6.2](https://github.com/strausmann/mcp-dockhand/compare/v1.6.1...v1.6.2) (2026-07-16)

### Bug Fixes

* **stacks:** update_stack_env defaults to merge-semantic to prevent variable data loss ([#82](https://github.com/strausmann/mcp-dockhand/issues/82)) ([1544621](https://github.com/strausmann/mcp-dockhand/commit/15446219c568c6cc691ed5a15fb6de124fd03fd8))

## [1.6.1](https://github.com/strausmann/mcp-dockhand/compare/v1.6.0...v1.6.1) (2026-07-16)

### Bug Fixes

* **ci:** amd64-only docker smoke build to stop 6h QEMU hangs ([#93](https://github.com/strausmann/mcp-dockhand/issues/93)) ([737e367](https://github.com/strausmann/mcp-dockhand/commit/737e367b0e4700404a3e366fdd27ebde81b7e52e)), closes [#82](https://github.com/strausmann/mcp-dockhand/issues/82) [#61](https://github.com/strausmann/mcp-dockhand/issues/61) [#76](https://github.com/strausmann/mcp-dockhand/issues/76) [#77](https://github.com/strausmann/mcp-dockhand/issues/77) [#66](https://github.com/strausmann/mcp-dockhand/issues/66)

## [1.6.0](https://github.com/strausmann/mcp-dockhand/compare/v1.5.0...v1.6.0) (2026-05-16)

### Features

* **tools:** close MCP API coverage gap — 44 new tools ([#64](https://github.com/strausmann/mcp-dockhand/issues/64)) ([e0e7057](https://github.com/strausmann/mcp-dockhand/commit/e0e70572d079bb3fd1bf73803f2bd203e36b430c)), closes [#58](https://github.com/strausmann/mcp-dockhand/issues/58) [#62](https://github.com/strausmann/mcp-dockhand/issues/62)

## [1.5.0](https://github.com/strausmann/mcp-dockhand/compare/v1.4.0...v1.5.0) (2026-05-16)

### Features

* **tools:** audit and expand all 222 MCP tool descriptions for AI disambiguation ([#63](https://github.com/strausmann/mcp-dockhand/issues/63)) ([b337e4c](https://github.com/strausmann/mcp-dockhand/commit/b337e4c05adb4087d4683d610832ad6504b7d59e)), closes [#60](https://github.com/strausmann/mcp-dockhand/issues/60) [#58](https://github.com/strausmann/mcp-dockhand/issues/58)

## [1.4.0](https://github.com/strausmann/mcp-dockhand/compare/v1.3.0...v1.4.0) (2026-05-16)

### Features

* **ci:** publish multi-arch (amd64 + arm64) Docker images on release ([#59](https://github.com/strausmann/mcp-dockhand/issues/59)) ([7390d6a](https://github.com/strausmann/mcp-dockhand/commit/7390d6af9b74cb32e545ec5d42ac58376b21b081)), closes [#54](https://github.com/strausmann/mcp-dockhand/issues/54) [#54](https://github.com/strausmann/mcp-dockhand/issues/54)

## [1.3.0](https://github.com/strausmann/mcp-dockhand/compare/v1.2.0...v1.3.0) (2026-05-16)

### Features

* **stacks:** add update_stack_env_raw + remove non-functional rawContent param ([#58](https://github.com/strausmann/mcp-dockhand/issues/58)) ([9166310](https://github.com/strausmann/mcp-dockhand/commit/9166310690dc30fdc42a9919d1dc0a11642b2986)), closes [#57](https://github.com/strausmann/mcp-dockhand/issues/57) [#56](https://github.com/strausmann/mcp-dockhand/issues/56) [#25](https://github.com/strausmann/mcp-dockhand/issues/25)

## [1.2.0](https://github.com/strausmann/mcp-dockhand/compare/v1.1.1...v1.2.0) (2026-03-29)

### Features

* migrate to Zod v4 and TypeScript 6 ([#34](https://github.com/strausmann/mcp-dockhand/issues/34)) ([9efda1b](https://github.com/strausmann/mcp-dockhand/commit/9efda1b8d676cb9e7e58044fad36c9c5aa0f029d)), closes [#13](https://github.com/strausmann/mcp-dockhand/issues/13)

## [1.1.1](https://github.com/strausmann/mcp-dockhand/compare/v1.1.0...v1.1.1) (2026-03-29)

### Bug Fixes

* **ci:** add Husky + commitlint for commit message validation ([ed6ef6f](https://github.com/strausmann/mcp-dockhand/commit/ed6ef6f79e61831ce7efd8457cf3b22f04730d6d))

## [1.1.0](https://github.com/strausmann/mcp-dockhand/compare/v1.0.0...v1.1.0) (2026-03-29)

### Features

* **containers:** add download_container_file and upload_container_file tools ([#23](https://github.com/strausmann/mcp-dockhand/issues/23)), closes [#18](https://github.com/strausmann/mcp-dockhand/issues/18)
* **tests:** add Vitest test suite with path encoding and tool registration tests ([#24](https://github.com/strausmann/mcp-dockhand/issues/24)), closes [#19](https://github.com/strausmann/mcp-dockhand/issues/19)
* **ci:** automated Dockhand API schema sync and MCP tool validation ([#25](https://github.com/strausmann/mcp-dockhand/issues/25))
* **ci:** add semantic-release with auto CHANGELOG, GitHub Release, and GHCR Docker build

### Bug Fixes

* **environments:** add host/port parameters for hawser-standard mode ([#15](https://github.com/strausmann/mcp-dockhand/issues/15)), closes [#4](https://github.com/strausmann/mcp-dockhand/issues/4)
* **environments:** extract resolveHostPort helper, add connectionType gate, fix port defaults ([#21](https://github.com/strausmann/mcp-dockhand/issues/21)), closes [#20](https://github.com/strausmann/mcp-dockhand/issues/20)
* **security:** apply encodePath consistently on all 128 path parameters ([#22](https://github.com/strausmann/mcp-dockhand/issues/22)), closes [#16](https://github.com/strausmann/mcp-dockhand/issues/16)
* **api:** correct HTTP methods for 21 MCP tools to match Dockhand API ([#31](https://github.com/strausmann/mcp-dockhand/issues/31)), closes [#27](https://github.com/strausmann/mcp-dockhand/issues/27)
* **tools:** replace generic config/settings with typed parameters ([#29](https://github.com/strausmann/mcp-dockhand/issues/29)), closes [#17](https://github.com/strausmann/mcp-dockhand/issues/17)
* **tests:** improve test precision for tool registration and environment scope ([#28](https://github.com/strausmann/mcp-dockhand/issues/28)), closes [#26](https://github.com/strausmann/mcp-dockhand/issues/26)
* **review:** address consolidated review findings from PRs #21-#29 ([#32](https://github.com/strausmann/mcp-dockhand/issues/32)), closes [#30](https://github.com/strausmann/mcp-dockhand/issues/30)

### Documentation

* add CLAUDE.md, Copilot and Gemini review instructions
* update review instructions — verify against upstream Dockhand/Hawser source

## [1.0.0](https://github.com/strausmann/mcp-dockhand/releases/tag/v1.0.0) (2026-03-29)

### Features

* Initial release with 130+ MCP tools for Dockhand Docker Management
* **Container Management** (27 tools): list, inspect, logs, stats, files, updates, pause, rename
* **Stack Management** (21 tools): compose, env, scanning, deploy, relocate, adopt
* **Image Management** (9 tools): pull, push, tag, scan, export, history
* **Network Management** (7 tools): create, inspect, connect/disconnect, prune
* **Volume Management** (9 tools): browse, clone, export, file content
* **Git Stack Management** (15 tools): deploy, sync, webhooks, credentials, repositories
* **Environment Management** (18 tools): connection test, timezone, notifications, pruning
* **Auth & Hawser** (12 tools): OIDC, LDAP, session, tokens
* **Audit** (4 tools): logging, events, export
* **Notifications** (8 tools): create, test, trigger
* **Registry** (10 tools): catalog, search, tags
* **System** (19 tools): health, disk, license, Prometheus metrics
* **Users & Roles** (20 tools): MFA, profiles, favorites, roles, RBAC
* **Schedules** (9 tools): execution, automation
* **Auto-Update** (3 tools): container update policies
* Streamable HTTP transport (MCP Spec 2025-03-26)
* Multi-session support with Factory Pattern and automatic cleanup
* Session-based authentication with auto-relogin on 401
* Environment filter on all endpoints for security
* Docker image with multi-stage build, non-root user, healthcheck

### Bug Fixes

* Multi-session bug "Already connected to a transport" ([#1](https://github.com/strausmann/mcp-dockhand/issues/1))
