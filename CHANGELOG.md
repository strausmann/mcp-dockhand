# MCP-Dockhand Changelog

All notable changes to **MCP-Dockhand** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
