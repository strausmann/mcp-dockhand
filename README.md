# MCP Dockhand

[![CI](https://github.com/strausmann/mcp-dockhand/actions/workflows/ci.yml/badge.svg)](https://github.com/strausmann/mcp-dockhand/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io-blue)](https://github.com/strausmann/mcp-dockhand/pkgs/container/mcp-dockhand)

An MCP (Model Context Protocol) server that exposes the Dockhand API as MCP tools. Manage your entire Docker infrastructure through AI assistants.

**API coverage:** 88.7% of in-scope Dockhand endpoints (282/318) have an MCP tool — see [`docs/coverage.md`](docs/coverage.md) for the full, auto-updated breakdown by area.

[Dockhand](https://github.com/fnsys/dockhand) is a Docker management server that connects to multiple Docker hosts via Hawser agents. This MCP server provides full programmatic access to all Dockhand features.

## Features

- **280+ MCP Tools** covering the Dockhand API — see [`docs/coverage.md`](docs/coverage.md) for exact, auto-updated coverage
- **Streamable HTTP Transport** (MCP Spec 2025-03-26) for Docker container hosting
- **Session-based Auth** with auto-relogin on 401
- **SSE Support** for deploy operations (start, stop, down, restart)
- **Environment Filter** enforced on all container/stack/image/network/volume endpoints
- **Docker Ready** with multi-stage build, non-root user, and health checks

## Quick Start

### Docker (recommended)

```bash
docker run -d \
  --name mcp-dockhand \
  -p 8080:8080 \
  -e DOCKHAND_URL=https://your-dockhand-server.com \
  -e DOCKHAND_USERNAME=your-username \
  -e DOCKHAND_PASSWORD=your-password \
  ghcr.io/strausmann/mcp-dockhand:latest
```

### Docker Compose

```yaml
services:
  mcp-dockhand:
    image: ghcr.io/strausmann/mcp-dockhand:latest
    container_name: mcp-dockhand
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - DOCKHAND_URL=https://your-dockhand-server.com
      - DOCKHAND_USERNAME=your-username
      - DOCKHAND_PASSWORD=your-password
```

### From Source

```bash
git clone https://github.com/strausmann/mcp-dockhand.git
cd mcp-dockhand
npm install
npm run build
DOCKHAND_URL=https://your-server.com DOCKHAND_USERNAME=admin DOCKHAND_PASSWORD=secret npm start
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DOCKHAND_URL` | Yes | - | Dockhand server URL |
| `DOCKHAND_USERNAME` | Yes | - | Dockhand username |
| `DOCKHAND_PASSWORD` | Yes | - | Dockhand password |
| `MCP_PORT` | No | `8080` | Port for the MCP server |
| `MCP_SESSION_TTL_SECONDS` | No | `1800` | Inactivity timeout before a retained MCP session is expired |
| `MCP_SESSION_CLEANUP_INTERVAL_SECONDS` | No | `300` | Interval for removing expired sessions (clamped to the session TTL) |
| `MCP_MAX_SESSIONS` | No | `0` | Maximum retained sessions; `0` keeps the existing unlimited behavior |
| `MCP_HOST` | No | `0.0.0.0` | Listen address. Kept as the wildcard address by default so the published Docker port (`-p 8080:8080` / `docker-compose.yml`) keeps working; see [Securing the transport](#securing-the-transport) for the recommended way to protect the endpoint instead of binding loopback-only |
| `MCP_ALLOWED_HOSTS` | No | *(unset — Host check disabled)* | Comma-separated `Host` header allowlist for `/mcp` (DNS-rebinding protection). **Opt-in**: unset means no Host check at all (pre-existing behavior, so existing deployments aren't broken by an update). Recommended once you set it up — see [Securing the transport](#securing-the-transport) |
| `MCP_ALLOWED_ORIGINS` | No | *(unset — Origin check disabled)* | Comma-separated `Origin` header allowlist for `/mcp`. Opt-in, same as above. Only enforced when a caller actually sends an `Origin` header at all (non-browser MCP clients typically don't) |
| `MCP_AUTH_TOKEN` | No | *(unset — endpoint unauthenticated)* | Shared secret required as `Authorization: Bearer <token>` on every `/mcp` request. Opt-in; recommended once the endpoint is reachable beyond your own loopback — see [Securing the transport](#securing-the-transport) |
| `LOG_LEVEL` | No | `info` | `error`, `warn`, `info` or `debug`. `debug` adds one line per Dockhand request (method, endpoint template, status, duration). For requests through the client the duration spans the full response body and a `bytes` body-size field is added; the login and self-check probes (which bootstrap the client and so can't route through it) log time-to-headers without a `bytes` field. Never a path segment or a parameter value. An unrecognised value warns and falls back to `info`. |
| `TRUSTED_PROXIES` | No | _(empty)_ | Comma-separated addresses or CIDRs allowed to set `X-Forwarded-For` / `X-Real-IP`, e.g. `10.0.0.0/8, 100.64.0.0/10`. Empty means the headers are ignored and the peer address is used. |

### Securing the transport

`/mcp` binds `0.0.0.0:8080` by default (see `MCP_HOST` above), and out of the box — with none of
`MCP_ALLOWED_HOSTS`, `MCP_ALLOWED_ORIGINS`, or `MCP_AUTH_TOKEN` set — it accepts **any** request
with **no** Host/Origin check and **no** authentication. This is the same behavior mcp-dockhand
has always had, kept as the default deliberately: enabling a check by default would reject
requests from any client that doesn't reach the server as `localhost`/`127.0.0.1` (a LAN IP, a
reverse proxy, a Docker network alias), breaking existing deployments on a routine update.

**You should turn this on** once `/mcp` is reachable beyond your own machine's loopback interface
— the server holds one Dockhand admin credential and every tool call acts with that identity, so
anyone who can open an MCP session controls Docker (container exec, host bind-mounts via
`create_container`, file read/write, stored git credentials). With no protection configured, the
server logs a `[security] WARNING` at startup as a reminder. Three independent, all-opt-in layers
are available:

1. **Host allowlist (`MCP_ALLOWED_HOSTS`).** Once set to a non-empty value, every request to
   `/mcp` — `POST`, `GET`, and `DELETE` — is rejected with `403` unless its `Host` header matches
   the allowlist. This is the primary defense against
   [DNS-rebinding](https://en.wikipedia.org/wiki/DNS_rebinding): a malicious web page cannot make
   the operator's browser reach the server under a Host value the allowlist accepts. Set it to
   however your client actually reaches the server — `localhost:8080`/`127.0.0.1:8080` for the
   documented local setup, or, if you connect directly by address rather than through
   `localhost` (including the mcp-proxy remote-server setup below), the exact `host:port` your
   client sends, e.g. `100.100.50.40:8222`. Get this wrong and every request is rejected with
   `403 Invalid Host header` — check the message, it echoes the Host value it saw.
2. **Origin allowlist (`MCP_ALLOWED_ORIGINS`).** Once set, any request that *does* send an
   `Origin` header not in the list is rejected with `403`. A missing `Origin` header always passes
   (the SDK's own MCP client and most non-browser tooling never send one), so this is only useful
   if a browser-based client talks to `/mcp` directly; the Host allowlist above is what actually
   stops DNS-rebinding.
3. **Bearer token (`MCP_AUTH_TOKEN`).** Once set, every `/mcp` request must carry
   `Authorization: Bearer <token>` or is rejected with `401`; the comparison is constant-time.
   Recommended alongside the Host allowlist for any deployment reachable from more than the
   operator's own machine.

```bash
# .env — recommended configuration once /mcp is reachable beyond loopback
MCP_ALLOWED_HOSTS=dock-mcp.internal.example.com
# or, connecting directly by address instead of a hostname:
#MCP_ALLOWED_HOSTS=100.100.50.40:8222
MCP_AUTH_TOKEN=<a long random secret, e.g. `openssl rand -hex 32`>
```

## Securing the server with CrowdSec

The server writes an nginx-format access line to **stdout** for every request,
including the ones it rejects, while the structured application log goes to
**stderr**. CrowdSec parses the access lines with its stock collections — no custom
parser required.

Add an acquisition file on the host running your CrowdSec agent:

```yaml
source: docker
container_name:
  - mcp-dockhand
labels:
  type: docker
  program: nginx-mcp
```

**Both labels are required, and neither fails loudly if you forget it.**
`type: docker` enables `crowdsecurity/docker-logs`, which unwraps Docker's JSON
envelope. `program: nginx-mcp` enables `crowdsecurity/nginx-logs`, which matches on
`program` starting with `nginx` — the `-mcp` suffix keeps this source distinguishable
from your other nginx sources. With one label missing the chain simply produces
nothing, and nothing reports it.

Once wired up, the stock scenarios apply:

| Scenario | What it means here |
|---|---|
| `LePresidente/http-generic-401-bf` | Repeated `401` on `/mcp` — someone is guessing `MCP_AUTH_TOKEN` |
| `crowdsecurity/http-dos-swithcing-ua` | Request floods with rotating user agents |

A `403` is worth watching too: it means a request failed the `MCP_ALLOWED_HOSTS` or
`MCP_ALLOWED_ORIGINS` check, which is what a DNS-rebinding attempt looks like from
here.

> **The stock 401 scenario only counts `POST`.** Its filter is
> `evt.Parsed.verb == 'POST'` — one literal, not a list. This server serves `POST`, `GET`
> and `DELETE` on `/mcp`, and the bearer check runs ahead of all three, so a wrong token
> on `GET /mcp` or `DELETE /mcp` returns `401` exactly like `POST` does — and
> `LePresidente/http-generic-401-bf` never counts those. Someone guessing
> `MCP_AUTH_TOKEN` over `GET /mcp` is invisible to it.
>
> This is a property of the upstream scenario, shared with every nginx deployment that
> uses it — not something this server's log format can fix. To close it, add a local
> scenario that drops the `verb` filter, or matches the three methods this server
> answers on. Until then, treat the row above as "repeated `401` on **`POST`** `/mcp`".

> **Set `TRUSTED_PROXIES` before you enable this.**
> Behind a reverse proxy every request arrives from the proxy's address. Without
> `TRUSTED_PROXIES` that address is what gets logged — so the first ban CrowdSec
> issues takes out the proxy, and with it every user behind it. Set it to the
> address or subnet your proxy talks from.
>
> The setting is equally deliberate in the other direction: the forwarding headers
> are only honoured from a peer on that list. Trusting them unconditionally would let
> any direct caller name an arbitrary third party and have them banned.

**One expected side effect:** the structured JSON lines share the container's log
stream and carry the same `program` label, so they fail the nginx pattern and count
as `unparsed` in `cscli metrics`. That is noise, not a fault — no alert, no decision.

## MCP Client Configuration

### Claude Desktop / Claude Code

Add to your MCP settings:

```json
{
  "mcpServers": {
    "dockhand": {
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

> **If the server enforces a bearer token** (`MCP_AUTH_TOKEN` set — see
> [Securing the transport](#securing-the-transport)), the client must send it as an
> `Authorization` header, or every request is rejected with `401`. In Claude Code's
> `.mcp.json`, add a `headers` block — reference an environment variable so the token
> never lives in the (often version-controlled) config file:
>
> ```json
> {
>   "mcpServers": {
>     "dockhand": {
>       "type": "http",
>       "url": "http://your-server:8080/mcp",
>       "headers": { "Authorization": "Bearer ${DOCKHAND_MCP_TOKEN}" }
>     }
>   }
> }
> ```
>
> **Send the token only over an encrypted transport.** A bearer over plain `http://` on a
> shared network can be sniffed — terminate TLS at a reverse proxy, or reach the server over
> a WireGuard/Tailscale/VPN link (the app-layer HTTP is then encrypted by the tunnel).
>
> Export `DOCKHAND_MCP_TOKEN` in the environment Claude Code is launched from (e.g. from a
> gitignored `.env` you `source` before starting). The `Host`/`host:port` you connect to
> must also be in the server's `MCP_ALLOWED_HOSTS` if that allowlist is set. For **Claude
> Desktop** (native config has no `headers` field), pass the token through the mcp-proxy
> workaround below — mcp-proxy forwards an `Authorization` header via its own
> environment/args.

#### Claude Desktop with a remote server (mcp-proxy)

Claude Desktop can fail to connect to a **remote** mcp-dockhand server (not
`localhost`) using the native `"url"` config above, even though the endpoint
itself is reachable. The symptom is a generic `"not a valid MCP server"` error
in Claude Desktop, while a plain browser/`curl` request to the same URL
correctly returns `{"error":"Invalid or missing session ID"}`. This is a known
limitation of Claude Desktop with remote Streamable HTTP servers, not a
mcp-dockhand bug.

**Workaround:** wrap the connection with
[mcp-proxy](https://github.com/sparfenyuk/mcp-proxy), which translates
Streamable HTTP to stdio — a transport Claude Desktop handles reliably:

```json
{
  "mcpServers": {
    "dockhand": {
      "command": "/path/to/mcp-proxy",
      "args": ["--transport", "streamablehttp", "http://your-server:8080/mcp"]
    }
  }
}
```

All tools load and work correctly through the proxy. Thanks to
[@deadrubberboy](https://github.com/deadrubberboy) for reporting this and
sharing the workaround ([#90](https://github.com/strausmann/mcp-dockhand/issues/90)).

## Tool Reference

### Containers (27 tools)

| Tool | Description |
|------|-------------|
| `list_containers` | List all containers in an environment |
| `get_container` | Get container details |
| `inspect_container` | Docker inspect (full details) |
| `get_container_logs` | Get container logs |
| `get_container_stats` | Get resource usage stats |
| `get_container_top` | Get running processes |
| `start_container` | Start a container |
| `stop_container` | Stop a container |
| `restart_container` | Restart a container |
| `pause_container` | Pause a container |
| `unpause_container` | Unpause a container |
| `rename_container` | Rename a container |
| `update_container` | Update container settings |
| `create_container` | Create a new container |
| `get_container_shells` | List available shells |
| `exec_container` | Create a terminal exec session (execId + WS connectionInfo); does NOT run a one-shot command or return output — no such endpoint exists in the Dockhand API |
| `list_container_files` | Browse files inside container |
| `get_container_file_content` | Read file from container |
| `create_container_file` | Create an empty file or directory in container (no content — use `write_container_file_content` for that) |
| `delete_container_file` | Delete file in container |
| `rename_container_file` | Rename file in container |
| `chmod_container_file` | Change file permissions |
| `check_container_updates` | Check for image updates |
| `get_pending_updates` | Get pending updates |
| `batch_update_containers` | Batch update containers |
| `execute_batch` | Run a bulk lifecycle operation (start/stop/restart/remove/etc.) across containers, images, volumes, networks, or stacks |
| `get_container_sizes` | Get container disk sizes |
| `get_containers_stats` | Get aggregated stats |

### Stacks (21 tools)

| Tool | Description |
|------|-------------|
| `list_stacks` | List all stacks |
| `get_stack` | Get stack details |
| `create_stack` | Create and optionally deploy a stack |
| `start_stack` | Start a stack (compose up) |
| `stop_stack` | Stop a stack (compose stop) |
| `restart_stack` | Restart a stack |
| `down_stack` | Take down a stack (compose down) |
| `delete_stack` | Delete a stack |
| `get_stack_compose` | Read compose file |
| `update_stack_compose` | Update compose file |
| `get_stack_env` | Read environment variables |
| `update_stack_env` | Update environment variables (**merge** by default — safe for partial updates; use `mode="replace"` to overwrite all) |
| `get_stack_env_raw` | Read raw .env file |
| `validate_stack_env` | Validate env variables |
| `scan_stacks` | Scan filesystem for stacks |
| `adopt_stack` | Adopt an untracked stack |
| `relocate_stack` | Move stack to new path |
| `get_stack_sources` | Get stack sources |
| `get_stack_base_path` | Get base path |
| `get_stack_path_hints` | Get path suggestions |
| `validate_stack_path` | Validate a stack path |

### Images (9 tools)

| Tool | Description |
|------|-------------|
| `list_images` | List all images |
| `get_image` | Get image details |
| `get_image_history` | Get image layer history |
| `tag_image` | Tag an image |
| `remove_image` | Remove an image |
| `pull_image` | Pull an image |
| `push_image` | Push an image |
| `scan_image` | Vulnerability scan (Trivy/Grype) |
| `export_image` | Export image as tarball |

### Environments (18 tools)

| Tool | Description |
|------|-------------|
| `list_environments` | List all environments |
| `get_environment` | Get environment details |
| `create_environment` | Create an environment |
| `update_environment` | Update an environment |
| `delete_environment` | Delete an environment |
| `test_environment` | Test connection |
| `test_environment_connection` | Test without saving |
| `detect_docker_socket` | Auto-detect socket |
| `get_environment_timezone` | Get timezone |
| `set_environment_timezone` | Set timezone |
| `get_environment_update_check` | Get update-check settings |
| `set_environment_update_check` | Set update-check settings |
| `get_environment_image_prune` | Get image prune settings |
| `set_environment_image_prune` | Set image prune settings |
| `list_environment_notifications` | List notifications |
| `create_environment_notification` | Create notification |
| `get_environment_notification` | Get notification |
| `delete_environment_notification` | Delete notification |

### Networks (7 tools)

| Tool | Description |
|------|-------------|
| `list_networks` | List all networks |
| `get_network` | Get network details |
| `inspect_network` | Inspect network |
| `create_network` | Create a network |
| `remove_network` | Remove a network |
| `connect_container_to_network` | Connect container |
| `disconnect_container_from_network` | Disconnect container |

### Volumes (9 tools)

| Tool | Description |
|------|-------------|
| `list_volumes` | List all volumes |
| `get_volume` | Get volume details |
| `inspect_volume` | Inspect volume |
| `browse_volume` | Browse files in volume |
| `get_volume_file_content` | Read file from volume |
| `release_volume_browse` | Release browse session |
| `clone_volume` | Clone a volume |
| `export_volume` | Export volume |
| `remove_volume` | Remove volume (destructive) |

### Git Stacks (15 tools)

| Tool | Description |
|------|-------------|
| `list_git_stacks` | List Git-based stacks |
| `get_git_stack` | Get Git stack details |
| `deploy_git_stack` | Deploy a Git stack (SSE) |
| `sync_git_stack` | Sync with remote repo |
| `test_git_stack` | Test Git connection |
| `get_git_stack_env_files` | Get env files |
| `trigger_git_webhook` | Trigger webhook |
| `get_git_webhook` | Get webhook details |
| `list_git_credentials` | List Git credentials |
| `create_git_credential` | Create Git credential |
| `get_git_credential` | Get credential details |
| `update_git_credential` | Update credential |
| `delete_git_credential` | Delete credential |
| `list_git_repositories` | List Git repositories |
| `create_git_repository` | Create repository config |

### Dashboard & Activity (8 tools)

| Tool | Description |
|------|-------------|
| `get_dashboard_stats` | Get dashboard statistics |
| `get_dashboard_preferences` | Get display preferences |
| `set_dashboard_preferences` | Set display preferences |
| `get_activity_feed` | Get activity feed |
| `get_container_activity` | Container activity |
| `get_activity_events` | Activity events |
| `get_activity_stats` | Activity statistics |
| `get_merged_logs` | Merged logs from containers |

### Auth & Hawser (12 tools)

| Tool | Description |
|------|-------------|
| `get_auth_session` | Check session status |
| `get_auth_providers` | List auth providers |
| `get_auth_settings` | Get auth settings |
| `create_oidc_provider` | Create OIDC provider |
| `get_oidc_provider` | Get OIDC provider |
| `test_oidc_provider` | Test OIDC provider |
| `create_ldap_provider` | Create LDAP provider |
| `get_ldap_provider` | Get LDAP provider |
| `test_ldap_provider` | Test LDAP provider |
| `list_hawser_tokens` | List Hawser tokens |
| `create_hawser_token` | Create Hawser token |
| `revoke_hawser_token` | Revoke Hawser token |

### Audit (4 tools)

| Tool | Description |
|------|-------------|
| `get_audit_log` | Get audit log |
| `get_audit_events` | Get audit event types |
| `get_audit_users` | Audit data by user |
| `export_audit_log` | Export audit log |

### Notifications (8 tools)

| Tool | Description |
|------|-------------|
| `list_notifications` | List notifications |
| `create_notification` | Create notification |
| `get_notification` | Get notification |
| `update_notification` | Update notification |
| `delete_notification` | Delete notification |
| `test_notification` | Test notification |
| `test_notification_config` | Test without saving |
| `trigger_test_notification` | Trigger a real test event for a given event type + payload |

### Registries (10 tools)

| Tool | Description |
|------|-------------|
| `list_registries` | List registries |
| `create_registry` | Add registry |
| `get_registry` | Get registry details |
| `update_registry` | Update registry |
| `delete_registry` | Delete registry |
| `set_default_registry` | Set as default |
| `search_registry` | Search registry |
| `get_registry_catalog` | Get catalog |
| `get_registry_image` | Get image from registry |
| `get_registry_tags` | Get image tags |

### System & Settings (19 tools)

| Tool | Description |
|------|-------------|
| `health_check` | Server health |
| `health_check_database` | Database health |
| `get_host_info` | Host information |
| `get_system_info` | System information |
| `get_system_disk` | Disk usage |
| `list_system_files` | List system files |
| `get_system_file_content` | Read system file |
| `get_changelog` | Changelog |
| `get_dependencies` | Dependencies |
| `get_general_settings` | General settings |
| `update_general_settings` | Update settings |
| `get_theme_settings` | Theme settings |
| `update_theme_settings` | Update theme |
| `get_scanner_settings` | Scanner settings |
| `update_scanner_settings` | Update scanner |
| `get_license` | License info |
| `activate_license` | Activate license by name and key |
| `get_prometheus_metrics` | Prometheus metrics |
| `prune_all` | Prune all resources |

### Users, Roles & Preferences (20 tools)

| Tool | Description |
|------|-------------|
| `list_users` | List users |
| `create_user` | Create user |
| `get_user` | Get user details |
| `update_user` | Update user |
| `delete_user` | Delete user |
| `get_user_mfa_status` | MFA status |
| `enable_user_mfa` | Enable MFA |
| `disable_user_mfa` | Disable MFA |
| `get_user_roles` | Get user roles |
| `add_user_role` | Assign one role to a user (no bulk-replace) |
| `remove_user_role` | Unassign one role from a user |
| `list_roles` | List roles |
| `create_role` | Create role with name + permissions object |
| `get_role` | Get role |
| `update_role` | Update role |
| `delete_role` | Delete role |
| `get_profile` | Get own profile |
| `update_profile` | Update own profile |
| `get_favorites` | Get favorites |
| `set_favorites` | Set favorites |
| `list_config_sets` | List config sets |

### Schedules (9 tools)

| Tool | Description |
|------|-------------|
| `list_schedules` | List schedules |
| `get_schedule_settings` | Get settings |
| `update_schedule_settings` | Update settings |
| `get_schedule_executions` | Execution history |
| `get_schedule_execution` | Execution details |
| `get_schedule` | Get schedule |
| `run_schedule_now` | Run immediately |
| `toggle_schedule` | Enable/disable |
| `toggle_system_schedule` | Toggle system schedule |

### Auto-Update (3 tools)

| Tool | Description |
|------|-------------|
| `get_auto_update_settings` | Get all auto-update settings |
| `get_container_auto_update` | Get container auto-update |
| `set_container_auto_update` | Set auto-update policy |

### Self-help / meta tools (6 tools)

Diagnostics for **this MCP server itself**, distinct from the Dockhand API tools above —
useful for a client or operator asking "is *this server* healthy and correctly configured?"
rather than "is Dockhand healthy?". None of these six take any input arguments, and none of
them wrap a single Dockhand endpoint the way the tables above do (`get_tool_manifest` and
`get_runtime_stats` call no Dockhand endpoint at all) — see `src/tools/meta.ts`.

| Tool | Description |
|------|-------------|
| `get_server_info` | This server's own version, git SHA, build date, uptime, MCP protocol version, and the Dockhand URL/server version it's connected to |
| `check_for_update` | Compares this server's running version against the latest GitHub release (TTL-cached) |
| `get_tool_manifest` | Lists every registered tool with its Dockhand `{method, path}`, plus the pinned Dockhand OpenAPI commit/version this server's tools were generated against |
| `self_check` | End-to-end diagnostic: Dockhand reachability, credential validity, and a live, per-environment reachability check (`POST /api/environments/{id}/test`, run in parallel with a 5s per-environment timeout) plus Hawser-agent-connected status, in one call |
| `validate_config` | Checks that the required `DOCKHAND_URL`/`DOCKHAND_USERNAME`/`DOCKHAND_PASSWORD` env vars are present and that they authenticate successfully |
| `get_runtime_stats` | In-process counters for this server: total/per-tool call and error counts, uptime, and the last error's tool/message/timestamp |

**Notes:**

- `check_for_update` needs outbound network access to `api.github.com` (GitHub's releases
  API) — it will degrade to `updateAvailable: null` rather than fail if that's unreachable.
- **No meta tool exposes any secret value.** `validate_config` reports only whether the
  required env vars are *present* (booleans) and whether they *authenticate* (a boolean +
  the raw HTTP status code, e.g. `200`/`401`) — never the credential values themselves.
  `self_check` reports auth validity the same way. `get_runtime_stats`' `lastError` carries
  only a tool name, an error message, and a timestamp — never call arguments or response
  payloads. **That error message is not fully opaque, though:** for a failed Dockhand API
  call it can embed a slice of the upstream HTTP status and response body (via
  `DockhandClient`'s own `Dockhand API error: ... returned <status>: <body>` message), and
  it is echoed to whichever MCP client next calls `get_runtime_stats` — not necessarily the
  one that hit the original error. It never includes request bodies or credential values,
  and it is truncated to 500 characters (with an ellipsis marker) before being stored, so an
  oversized upstream response is never echoed wholesale.

## Important Notes

### update_stack_env — Merge vs Replace Semantics

The Dockhand REST endpoint `PUT /api/stacks/{name}/env` has **replace-semantics**: submitting a partial list of variables silently deletes all other variables from the stack. A single-variable update would wipe everything else.

To prevent accidental data loss, this MCP tool defaults to **merge mode**:

1. It fetches the current variable list via `GET /api/stacks/{name}/env`.
2. It merges the incoming variables by key (new values overwrite existing ones on key collision).
3. It writes the full combined list back via `PUT`.

```
# Safe partial update — only MY_VAR changes, all others preserved
update_stack_env(environmentId=1, name="my-stack", variables=[{key: "MY_VAR", value: "new"}])

# Explicit full replacement — all other variables are deleted
update_stack_env(environmentId=1, name="my-stack", variables=[...], mode="replace")
```

Use `mode="replace"` only when you intentionally want to replace the entire variable set.

### Environment ID is Required

Most Docker resource endpoints (containers, stacks, images, networks, volumes) require an `environmentId` parameter. This maps to the `?env=<id>` query parameter in the Dockhand API. Without it, endpoints return empty arrays.

### SSE Responses

Deploy operations (start, stop, down, restart, compose update with restart) return Server-Sent Events. The MCP server automatically parses these and returns the final result.

### Authentication

The server uses session-based cookie authentication. It automatically:
- Logs in on first request
- Stores the session cookie in memory
- Re-authenticates on 401 responses
- Handles session timeout (24h)

### Troubleshooting

Start with `LOG_LEVEL=debug`. Every Dockhand request then appears with its endpoint,
status code and duration, and every line of a single call shares one
`call` identifier — `grep` for it to get the whole sequence. The `req` identifier
ties those lines back to the access line that started them, and `sid` covers
everything one client did across its whole session. For requests through the client, `ms` is the full request
duration — it spans the response body being read, not just the time until the
response headers arrived, so it reflects what a slow or stalled streamed
response (e.g. a deploy's SSE output) actually cost — and `bytes` is the size of the
body that was actually read. (The login and self-check probes bootstrap the client and can't route through it, so their lines log time-to-headers without a `bytes` field.) A failed Dockhand request additionally logs a
`warn` line carrying `errType` — the exception name (e.g. `TimeoutError`, `TypeError`),
a bounded vocabulary rather than free text — so you can filter failures by error
type. That warn line fires both when the request itself failed before any
response arrived, and when a response body's read failed partway through (e.g.
an SSE stream hitting its timeout mid-stream) — either way `ms` reflects how
long it took to fail.

## Development

```bash
# Install dependencies
npm install

# Type check
npm run typecheck

# Build
npm run build

# Run in development mode
DOCKHAND_URL=https://your-server.com \
DOCKHAND_USERNAME=admin \
DOCKHAND_PASSWORD=secret \
npm run dev
```

### Linting

There is currently no `npm run lint` script. `typescript-eslint` (the only maintained
ESLint/TypeScript integration) does not yet support the pinned `typescript@^7.0.2`
devDependency — it refuses to run at all against TS 7.0 (hard runtime error, not just a
peer-dependency warning): see
[typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940).
Re-add `eslint` + `typescript-eslint` as devDependencies once that's resolved upstream —
`tsc --noEmit` (via `npm run typecheck`) is the only static check enforced today.

## License

[MIT](LICENSE)
