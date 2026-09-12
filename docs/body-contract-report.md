# MCP-Dockhand — Body-Contract-Findings

> **Auto-generiert** von `scripts/generate-body-contract-doc.mjs` — nicht von Hand editieren.
> Wird täglich vom Workflow `.github/workflows/api-schema-sync.yml` neu erzeugt und bei
> Änderung committet. Grundlage: `docs/dockhand-openapi.json` (Body-Contract-Quelle,
> siehe `scripts/fetch-openapi.mjs`) gegen die registrierten Zod-Shapes unserer MCP-Tools.

> **ADVISORY — kein CI-Gate.** Dieses Dokument selbst löst keinen Exit-Code aus. Seit Task
> P2.2 ist `BODY_PARAM_MISSING_REQUIRED` (nach FP-freier Voll-Sweep-Triage, Task P2.1) ein
> hartes Gate in `scripts/validate-mcp-tools.mjs` (Exit 1 + Auto-Issue) — hier weiterhin nur
> zur Übersicht gelistet. Die übrigen drei Typen bleiben vollständig advisory.

**Erzeugt:** 2026-09-12T17:15:13.042Z

## Zusammenfassung

| Typ | Anzahl | Bedeutung |
|-----|--------|-----------|
| BODY_PARAM_UNKNOWN | 11 | Das Tool sendet ein Body-Feld, das der OpenAPI-Contract nicht kennt (nach Ausschluss der Query-/Path-Parameter der Operation). |
| UNTYPED_PASSTHROUGH | 53 | Das Tool hat ein untypisiertes `z.record(...)`-Feld (z.B. `settings`), obwohl der Endpunkt einen aufgelösten Contract hat — statisch nicht vollständig prüfbar. |
| BODY_CONTRACT_UNRESOLVED | 39 | Für diesen body-tragenden Endpunkt liegt (noch) kein OpenAPI-Contract vor (fehlende `@openapi`-JSDoc-Annotation im Dockhand-Fork). |

## BODY_PARAM_UNKNOWN (11)

Das Tool sendet ein Body-Feld, das der OpenAPI-Contract nicht kennt (nach Ausschluss der Query-/Path-Parameter der Operation).

| Tool | HTTP | Pfad | Feld | Datei |
|------|------|------|------|-------|
| `activate_license` | POST | `/api/license` | `licenseKey` | system.ts:194 |
| `adopt_stack` | POST | `/api/stacks/adopt` | `name` | stacks.ts:747 |
| `adopt_stack` | POST | `/api/stacks/adopt` | `composePath` | stacks.ts:747 |
| `adopt_stack` | POST | `/api/stacks/adopt` | `envPath` | stacks.ts:747 |
| `adopt_stack` | POST | `/api/stacks/adopt` | `sourceDir` | stacks.ts:747 |
| `create_environment` | POST | `/api/environments` | `url` | environments.ts:157 |
| `create_user` | POST | `/api/users` | `roles` | users.ts:33 |
| `remove_stack_env_vars` | PUT | `/api/stacks/{name}/env` | `keys` | stacks.ts:672 |
| `remove_stack_env_vars` | PUT | `/api/stacks/{name}/env/raw` | `keys` | stacks.ts:680 |
| `set_container_auto_update` | POST | `/api/auto-update/{containerName}` | `policy` | auto-update.ts:37 |
| `test_environment_connection` | POST | `/api/environments/test` | `url` | environments.ts:225 |

## UNTYPED_PASSTHROUGH (53)

Das Tool hat ein untypisiertes `z.record(...)`-Feld (z.B. `settings`), obwohl der Endpunkt einen aufgelösten Contract hat — statisch nicht vollständig prüfbar.

| Tool | HTTP | Pfad | Feld | Datei |
|------|------|------|------|-------|
| `create_backup_config` | POST | `/api/backup/configs` | `destinationId`, `targetName` | backup-configs.ts:110 |
| `create_backup_destination` | POST | `/api/backup/destinations` | `name`, `repository`, `password` | backup-destinations.ts:79 |
| `create_config_set` | POST | `/api/config-sets` | `name` | users.ts:281 |
| `create_container` | POST | `/api/containers` | `name`, `image` | containers.ts:308 |
| `create_environment_notification` | POST | `/api/environments/{environmentId}/notifications` | `notificationId` | environments.ts:317 |
| `create_git_credential` | POST | `/api/git/credentials` | `name` | git-stacks.ts:156 |
| `create_git_stack` | POST | `/api/git/stacks` | `stackName` | git-stacks.ts:324 |
| `create_ldap_provider` | POST | `/api/auth/ldap` | `name`, `serverUrl`, `baseDn` | auth.ts:65 |
| `create_network` | POST | `/api/networks` | `name` | networks.ts:60 |
| `create_notification` | POST | `/api/notifications` | `type`, `name` | notifications.ts:25 |
| `create_oidc_provider` | POST | `/api/auth/oidc` | `name`, `issuerUrl`, `clientId`, `clientSecret`, `redirectUri` | auth.ts:37 |
| `create_registry` | POST | `/api/registries` | `name`, `url` | registries.ts:25 |
| `create_role` | POST | `/api/roles` | `name`, `permissions` | users.ts:145 |
| `create_secret_provider` | POST | `/api/secret-providers` | `name`, `type`, `config` | secret-providers.ts:64 |
| `create_template_compose` | POST | `/api/templates/compose` | `template` | templates.ts:25 |
| `create_template_source` | POST | `/api/templates/sources` | `name`, `url` | templates.ts:41 |
| `create_volume` | POST | `/api/volumes` | `name` | volumes.ts:116 |
| `receive_git_webhook` | POST | `/api/git/webhook/{webhookId}` | - | git-stacks.ts:394 |
| `set_dashboard_preferences` | POST | `/api/dashboard/preferences` | - | dashboard.ts:29 |
| `set_environment_image_prune` | POST | `/api/environments/{environmentId}/image-prune` | - | environments.ts:300 |
| `set_environment_update_check` | POST | `/api/environments/{environmentId}/update-check` | - | environments.ts:283 |
| `set_grid_preferences` | POST | `/api/preferences/grid` | `gridId` | users.ts:263 |
| `set_sidebar_preferences` | POST | `/api/preferences/sidebar` | `order`, `hidden` | preferences.ts:24 |
| `test_backup_destination_inline` | POST | `/api/backup/destinations/test` | - | backup-destinations.ts:199 |
| `test_notification_config` | POST | `/api/notifications/test` | `type` | notifications.ts:65 |
| `test_registry` | POST | `/api/registries/test` | - | registries.ts:124 |
| `test_secret_provider` | POST | `/api/secret-providers/{id}/test` | - | secret-providers.ts:116 |
| `test_secret_provider_config` | POST | `/api/secret-providers/test` | `type`, `config` | secret-providers.ts:126 |
| `update_auth_settings` | PUT | `/api/auth/settings` | - | auth.ts:202 |
| `update_backup_config` | PUT | `/api/backup/configs/{configId}` | - | backup-configs.ts:138 |
| `update_backup_destination` | PUT | `/api/backup/destinations/{destinationId}` | - | backup-destinations.ts:118 |
| `update_config_set` | PUT | `/api/config-sets/{configSetId}` | - | users.ts:298 |
| `update_container` | POST | `/api/containers/{containerId}/update` | - | containers.ts:279 |
| `update_container_runtime` | POST | `/api/containers/{containerId}/update-runtime` | - | containers.ts:546 |
| `update_environment` | PUT | `/api/environments/{environmentId}` | - | environments.ts:197 |
| `update_environment_notification` | PUT | `/api/environments/{environmentId}/notifications/{notificationId}` | - | environments.ts:348 |
| `update_general_settings` | POST | `/api/settings/general` | - | system.ts:112 |
| `update_git_credential` | PUT | `/api/git/credentials/{credentialId}` | - | git-stacks.ts:187 |
| `update_git_repository` | PUT | `/api/git/repositories/{repositoryId}` | - | git-stacks.ts:370 |
| `update_git_stack` | PUT | `/api/git/stacks/{stackId}` | - | git-stacks.ts:337 |
| `update_ldap_provider` | PUT | `/api/auth/ldap/{providerId}` | - | auth.ts:155 |
| `update_notification` | PUT | `/api/notifications/{notificationId}` | - | notifications.ts:42 |
| `update_oidc_provider` | PUT | `/api/auth/oidc/{providerId}` | - | auth.ts:179 |
| `update_profile` | PUT | `/api/profile` | - | users.ts:187 |
| `update_profile_preferences` | PUT | `/api/profile/preferences` | - | users.ts:203 |
| `update_registry` | PUT | `/api/registries/{registryId}` | - | registries.ts:42 |
| `update_role` | PUT | `/api/roles/{roleId}` | - | users.ts:162 |
| `update_scanner_settings` | POST | `/api/settings/scanner` | - | system.ts:175 |
| `update_schedule_settings` | PUT | `/api/schedules/settings` | - | schedules.ts:32 |
| `update_secret_provider` | PUT | `/api/secret-providers/{id}` | - | secret-providers.ts:83 |
| `update_template_source` | PUT | `/api/templates/sources` | `id` | templates.ts:52 |
| `update_user` | PUT | `/api/users/{userId}` | - | users.ts:50 |
| `validate_stack_compose` | POST | `/api/stacks/{name}/validate` | `compose` | stacks.ts:936 |

## BODY_CONTRACT_UNRESOLVED (39)

Für diesen body-tragenden Endpunkt liegt (noch) kein OpenAPI-Contract vor (fehlende `@openapi`-JSDoc-Annotation im Dockhand-Fork).

| Tool | HTTP | Pfad | Feld | Datei |
|------|------|------|------|-------|
| `check_container_updates` | POST | `/api/containers/check-updates` | - | containers.ts:445 |
| `deploy_git_repository` | POST | `/api/git/repositories/{repositoryId}/deploy` | - | git-stacks.ts:264 |
| `deploy_git_stack` | POST | `/api/git/stacks/{stackId}/deploy` | - | git-stacks.ts:88 |
| `deploy_git_stack_stream` | POST | `/api/git/stacks/{stackId}/deploy-stream` | - | git-stacks.ts:351 |
| `init_backup_destination` | POST | `/api/backup/destinations/{destinationId}/init` | - | backup-destinations.ts:132 |
| `load_image` | POST | `/api/images/load` | - | images.ts:40 |
| `logout` | POST | `/api/auth/logout` | - | auth.ts:210 |
| `pause_container` | POST | `/api/containers/{containerId}/pause` | - | containers.ts:208 |
| `prune_all` | POST | `/api/prune/all` | - | system.ts:212 |
| `prune_containers` | POST | `/api/prune/containers` | - | system.ts:219 |
| `prune_images` | POST | `/api/prune/images` | - | system.ts:226 |
| `prune_networks` | POST | `/api/prune/networks` | - | system.ts:233 |
| `prune_volumes` | POST | `/api/prune/volumes` | - | system.ts:240 |
| `release_volume_browse` | POST | `/api/volumes/{volumeName}/browse/release` | - | volumes.ts:75 |
| `restart_container` | POST | `/api/containers/{containerId}/restart` | - | containers.ts:198 |
| `restart_stack` | POST | `/api/stacks/{name}/restart` | - | stacks.ts:78 |
| `run_backup_config` | POST | `/api/backup/configs/{configId}/run` | - | backup-configs.ts:152 |
| `run_schedule_now` | POST | `/api/schedules/{type}/{scheduleId}/run` | - | schedules.ts:56 |
| `scan_all_vulnerabilities` | POST | `/api/vulnerabilities/scan-all` | - | vulnerabilities.ts:45 |
| `set_default_registry` | POST | `/api/registries/{registryId}/default` | - | registries.ts:56 |
| `start_container` | POST | `/api/containers/{containerId}/start` | - | containers.ts:178 |
| `start_stack` | POST | `/api/stacks/{name}/start` | - | stacks.ts:58 |
| `stop_backup_config` | POST | `/api/backup/configs/{configId}/stop` | - | backup-configs.ts:159 |
| `stop_container` | POST | `/api/containers/{containerId}/stop` | - | containers.ts:188 |
| `stop_stack` | POST | `/api/stacks/{name}/stop` | - | stacks.ts:68 |
| `sync_git_repository` | POST | `/api/git/repositories/{repositoryId}/sync` | - | git-stacks.ts:271 |
| `sync_git_stack` | POST | `/api/git/stacks/{stackId}/sync` | - | git-stacks.ts:95 |
| `test_backup_destination` | POST | `/api/backup/destinations/{destinationId}/test` | - | backup-destinations.ts:166 |
| `test_environment` | POST | `/api/environments/{environmentId}/test` | - | environments.ts:211 |
| `test_git_repository` | POST | `/api/git/repositories/{repositoryId}/test` | - | git-stacks.ts:278 |
| `test_git_stack` | POST | `/api/git/stacks/{stackId}/test` | - | git-stacks.ts:102 |
| `test_ldap_provider` | POST | `/api/auth/ldap/{providerId}/test` | - | auth.ts:79 |
| `test_notification` | POST | `/api/notifications/{notificationId}/test` | - | notifications.ts:56 |
| `test_oidc_provider` | POST | `/api/auth/oidc/{providerId}/test` | - | auth.ts:51 |
| `toggle_schedule` | POST | `/api/schedules/{type}/{scheduleId}/toggle` | - | schedules.ts:66 |
| `toggle_system_schedule` | POST | `/api/schedules/system/{scheduleId}/toggle` | - | schedules.ts:73 |
| `trigger_environment_image_prune` | PUT | `/api/environments/{environmentId}/image-prune` | - | environments.ts:357 |
| `unpause_container` | POST | `/api/containers/{containerId}/unpause` | - | containers.ts:218 |
| `upload_container_file` | POST | `/api/containers/{containerId}/files/upload` | - | containers.ts:436 |

