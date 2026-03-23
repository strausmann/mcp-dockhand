# MCP Dockhand

[![CI](https://github.com/strausmann/mcp-dockhand/actions/workflows/ci.yml/badge.svg)](https://github.com/strausmann/mcp-dockhand/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io-blue)](https://github.com/strausmann/mcp-dockhand/pkgs/container/mcp-dockhand)

An MCP (Model Context Protocol) server that exposes **130+ Dockhand API endpoints** as MCP tools. Manage your entire Docker infrastructure through AI assistants.

[Dockhand](https://github.com/fnsys/dockhand) is a Docker management server that connects to multiple Docker hosts via Hawser agents. This MCP server provides full programmatic access to all Dockhand features.

## Features

- **130+ MCP Tools** covering all Dockhand API endpoints
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
| `LOG_LEVEL` | No | `info` | Log level |

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
| `list_container_files` | Browse files inside container |
| `get_container_file_content` | Read file from container |
| `create_container_file` | Create file in container |
| `delete_container_file` | Delete file in container |
| `rename_container_file` | Rename file in container |
| `chmod_container_file` | Change file permissions |
| `check_container_updates` | Check for image updates |
| `get_pending_updates` | Get pending updates |
| `batch_update_containers` | Batch update containers |
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
| `update_stack_env` | Update environment variables |
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
| `trigger_test_notification` | Trigger test event |

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
| `activate_license` | Activate license |
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
| `set_user_roles` | Set user roles |
| `list_roles` | List roles |
| `create_role` | Create role |
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

## Important Notes

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

## License

[MIT](LICENSE)
