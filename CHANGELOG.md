# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `download_container_file`: Download files from containers (returns tar archive as base64)
- `upload_container_file`: Upload files to containers (multipart form upload)
- `upload_container_file`: Add `encoding` parameter (`utf-8` | `base64`) for binary file support (#30)
- `update_environment`: Accept optional `connectionType` parameter to skip redundant GET request (#30)
- Vitest test suite with path encoding validation and tool registration tests
- CI: Tests run on every push and PR

### Fixed

- `create_environment`: Add `host` and `port` parameters for hawser-standard mode (#4, PR #15)
- `update_environment`: Add `host` and `port` parameters
- `test_environment_connection`: Add `host` and `port` parameters
- `update_environment`: Skip GET request when `connectionType` is provided (performance, #30)
- `upload_container_file`: Decode base64 content before upload for binary files (#30)
- `validate-mcp-tools`: Per-interpolation `encodePath` check instead of string-level match (#30)
- `create_git_credential`, `update_git_credential`, `create_git_repository`: Merge `additionalConfig` before explicit fields so explicit params always win (#30)
- `extract-dockhand-api`: Deterministic schema output — skip write when only `generatedAt` changed (#30)
- `dockhand-client`: Refactor `getRaw`/`postMultipart` to reuse shared `requestRaw()` auth logic (#30)

## [1.0.0] - 2026-03-29

### Added

- Initial release with 130+ MCP tools for Dockhand Docker Management
- **Container Management** (27 tools): list, inspect, logs, stats, files, updates, pause, rename
- **Stack Management** (21 tools): compose, env, scanning, deploy, relocate, adopt
- **Image Management** (9 tools): pull, push, tag, scan, export, history
- **Network Management** (7 tools): create, inspect, connect/disconnect, prune
- **Volume Management** (9 tools): browse, clone, export, file content
- **Git Stack Management** (15 tools): deploy, sync, webhooks, credentials, repositories
- **Environment Management** (18 tools): connection test, timezone, notifications, pruning
- **Auth & Hawser** (12 tools): OIDC, LDAP, session, tokens
- **Audit** (4 tools): logging, events, export
- **Notifications** (8 tools): create, test, trigger
- **Registry** (10 tools): catalog, search, tags
- **System** (19 tools): health, disk, license, Prometheus metrics
- **Users & Roles** (20 tools): MFA, profiles, favorites, roles, RBAC
- **Schedules** (9 tools): execution, automation
- **Auto-Update** (3 tools): container update policies
- Streamable HTTP transport (MCP Spec 2025-03-26)
- Multi-session support with Factory Pattern and automatic cleanup
- Session-based authentication with auto-relogin on 401
- Environment filter on all endpoints for security
- URL encoding for path injection prevention
- Docker image with multi-stage build, non-root user, healthcheck
- Dependabot configuration (npm, GitHub Actions, Docker)
- GitHub Actions CI (typecheck) and Release (GHCR) workflows
- Issue templates (Bug Report, Feature Request, API Change)
- API Change Detection workflow (weekly, Mondays 06:00 UTC)
- API baseline with 173 tracked Dockhand endpoints

### Fixed

- Multi-session bug "Already connected to a transport" (#1)

[Unreleased]: https://github.com/strausmann/mcp-dockhand/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/strausmann/mcp-dockhand/releases/tag/v1.0.0
