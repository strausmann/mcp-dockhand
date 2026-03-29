# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `download_container_file`: Download files from containers (returns tar archive as base64)
- `upload_container_file`: Upload files to containers (multipart form upload)

### Fixed

- `create_environment`: Add `host` and `port` parameters for hawser-standard mode (#4, PR #15)
- `update_environment`: Add `host` and `port` parameters
- `test_environment_connection`: Add `host` and `port` parameters

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
