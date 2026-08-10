# MCP-Dockhand — Body-Contract-Findings

> **Auto-generiert** von `scripts/generate-body-contract-doc.mjs` — nicht von Hand editieren.
> Wird täglich vom Workflow `.github/workflows/api-schema-sync.yml` neu erzeugt und bei
> Änderung committet. Grundlage: `docs/dockhand-openapi.json` (Body-Contract-Quelle,
> siehe `scripts/fetch-openapi.mjs`) gegen die registrierten Zod-Shapes unserer MCP-Tools.

> **ADVISORY — kein CI-Gate.** Diese Findings beeinflussen keinen Exit-Code. Phase P1 des
> Body-Contract-Validierungs-Plans ist bewusst informativ; die Beförderung ins Gate (mindestens
> `BODY_PARAM_MISSING_REQUIRED`) ist Phase P2, nach einer FP-freien Voll-Sweep-Triage.

**Erzeugt:** 2026-08-10T13:22:38.678Z

## Zusammenfassung

| Typ | Anzahl | Bedeutung |
|-----|--------|-----------|
| BODY_PARAM_MISSING_REQUIRED | 38 | Ein laut OpenAPI-Contract required Body-Feld wird vom Tool nicht als required gesendet — der Aufruf kann am echten Endpunkt fehlschlagen (siehe #142). |
| BODY_PARAM_UNKNOWN | 13 | Das Tool sendet ein Body-Feld, das der OpenAPI-Contract nicht kennt (nach Ausschluss der Query-/Path-Parameter der Operation). |
| UNTYPED_PASSTHROUGH | 42 | Das Tool hat ein untypisiertes `z.record(...)`-Feld (z.B. `settings`), obwohl der Endpunkt einen aufgelösten Contract hat — statisch nicht vollständig prüfbar. |
| BODY_CONTRACT_UNRESOLVED | 35 | Für diesen body-tragenden Endpunkt liegt (noch) kein OpenAPI-Contract vor (fehlende `@openapi`-JSDoc-Annotation im Dockhand-Fork). |

## BODY_PARAM_MISSING_REQUIRED (38)

Ein laut OpenAPI-Contract required Body-Feld wird vom Tool nicht als required gesendet — der Aufruf kann am echten Endpunkt fehlschlagen (siehe #142).

| Tool | HTTP | Pfad | Feld | Datei |
|------|------|------|------|-------|
| `activate_license` | POST | `/api/license` | `name` | system.ts:138 |
| `activate_license` | POST | `/api/license` | `key` | system.ts:138 |
| `add_label` | POST | `/api/labels` | `action` | labels.ts:25 |
| `adopt_stack` | POST | `/api/stacks/adopt` | `stacks` | stacks.ts:465 |
| `create_config_set` | POST | `/api/config-sets` | `name` | users.ts:250 |
| `create_container_file` | POST | `/api/containers/{containerId}/files/create` | `type` | containers.ts:337 |
| `create_environment_notification` | POST | `/api/environments/{environmentId}/notifications` | `notificationId` | environments.ts:236 |
| `create_git_stack` | POST | `/api/git/stacks` | `stackName` | git-stacks.ts:231 |
| `create_ldap_provider` | POST | `/api/auth/ldap` | `name` | auth.ts:65 |
| `create_ldap_provider` | POST | `/api/auth/ldap` | `serverUrl` | auth.ts:65 |
| `create_ldap_provider` | POST | `/api/auth/ldap` | `baseDn` | auth.ts:65 |
| `create_notification` | POST | `/api/notifications` | `type` | notifications.ts:25 |
| `create_notification` | POST | `/api/notifications` | `name` | notifications.ts:25 |
| `create_oidc_provider` | POST | `/api/auth/oidc` | `name` | auth.ts:37 |
| `create_oidc_provider` | POST | `/api/auth/oidc` | `issuerUrl` | auth.ts:37 |
| `create_oidc_provider` | POST | `/api/auth/oidc` | `clientId` | auth.ts:37 |
| `create_oidc_provider` | POST | `/api/auth/oidc` | `clientSecret` | auth.ts:37 |
| `create_oidc_provider` | POST | `/api/auth/oidc` | `redirectUri` | auth.ts:37 |
| `create_registry` | POST | `/api/registries` | `name` | registries.ts:25 |
| `create_registry` | POST | `/api/registries` | `url` | registries.ts:25 |
| `create_role` | POST | `/api/roles` | `permissions` | users.ts:114 |
| `create_template_source` | POST | `/api/templates/sources` | `name` | templates.ts:41 |
| `create_template_source` | POST | `/api/templates/sources` | `url` | templates.ts:41 |
| `create_volume` | POST | `/api/volumes` | `name` | volumes.ts:116 |
| `list_batch_operations` | POST | `/api/batch` | `operation` | system.ts:193 |
| `list_batch_operations` | POST | `/api/batch` | `entityType` | system.ts:193 |
| `list_batch_operations` | POST | `/api/batch` | `items` | system.ts:193 |
| `remove_stack_env_vars` | PUT | `/api/stacks/{name}/env` | `variables` | stacks.ts:389 |
| `remove_stack_env_vars` | PUT | `/api/stacks/{name}/env/raw` | `content` | stacks.ts:397 |
| `set_favorite_groups` | POST | `/api/preferences/favorite-groups` | `action` | users.ts:212 |
| `set_favorites` | POST | `/api/preferences/favorites` | `action` | users.ts:191 |
| `set_git_stack_env_files` | POST | `/api/git/stacks/{stackId}/env-files` | `path` | git-stacks.ts:265 |
| `set_grid_preferences` | POST | `/api/preferences/grid` | `gridId` | users.ts:232 |
| `set_sidebar_preferences` | POST | `/api/preferences/sidebar` | `order` | preferences.ts:24 |
| `set_sidebar_preferences` | POST | `/api/preferences/sidebar` | `hidden` | preferences.ts:24 |
| `set_user_roles` | POST | `/api/users/{userId}/roles` | `roleId` | users.ts:93 |
| `test_notification_config` | POST | `/api/notifications/test` | `type` | notifications.ts:65 |
| `trigger_test_notification` | POST | `/api/notifications/trigger-test` | `eventType` | notifications.ts:72 |

## BODY_PARAM_UNKNOWN (13)

Das Tool sendet ein Body-Feld, das der OpenAPI-Contract nicht kennt (nach Ausschluss der Query-/Path-Parameter der Operation).

| Tool | HTTP | Pfad | Feld | Datei |
|------|------|------|------|-------|
| `activate_license` | POST | `/api/license` | `licenseKey` | system.ts:138 |
| `adopt_stack` | POST | `/api/stacks/adopt` | `name` | stacks.ts:465 |
| `adopt_stack` | POST | `/api/stacks/adopt` | `composePath` | stacks.ts:465 |
| `adopt_stack` | POST | `/api/stacks/adopt` | `envPath` | stacks.ts:465 |
| `adopt_stack` | POST | `/api/stacks/adopt` | `sourceDir` | stacks.ts:465 |
| `create_container_file` | POST | `/api/containers/{containerId}/files/create` | `content` | containers.ts:337 |
| `create_environment` | POST | `/api/environments` | `url` | environments.ts:93 |
| `create_user` | POST | `/api/users` | `roles` | users.ts:33 |
| `remove_stack_env_vars` | PUT | `/api/stacks/{name}/env` | `keys` | stacks.ts:389 |
| `remove_stack_env_vars` | PUT | `/api/stacks/{name}/env/raw` | `keys` | stacks.ts:397 |
| `set_container_auto_update` | POST | `/api/auto-update/{containerName}` | `policy` | auto-update.ts:37 |
| `set_user_roles` | POST | `/api/users/{userId}/roles` | `roles` | users.ts:93 |
| `test_environment_connection` | POST | `/api/environments/test` | `url` | environments.ts:161 |

## UNTYPED_PASSTHROUGH (42)

Das Tool hat ein untypisiertes `z.record(...)`-Feld (z.B. `settings`), obwohl der Endpunkt einen aufgelösten Contract hat — statisch nicht vollständig prüfbar.

| Tool | HTTP | Pfad | Feld | Datei |
|------|------|------|------|-------|
| `create_config_set` | POST | `/api/config-sets` | - | users.ts:250 |
| `create_container` | POST | `/api/containers` | - | containers.ts:284 |
| `create_environment_notification` | POST | `/api/environments/{environmentId}/notifications` | - | environments.ts:236 |
| `create_git_credential` | POST | `/api/git/credentials` | - | git-stacks.ts:98 |
| `create_git_stack` | POST | `/api/git/stacks` | - | git-stacks.ts:231 |
| `create_ldap_provider` | POST | `/api/auth/ldap` | - | auth.ts:65 |
| `create_network` | POST | `/api/networks` | - | networks.ts:60 |
| `create_notification` | POST | `/api/notifications` | - | notifications.ts:25 |
| `create_oidc_provider` | POST | `/api/auth/oidc` | - | auth.ts:37 |
| `create_registry` | POST | `/api/registries` | - | registries.ts:25 |
| `create_template_compose` | POST | `/api/templates/compose` | - | templates.ts:25 |
| `create_template_source` | POST | `/api/templates/sources` | - | templates.ts:41 |
| `create_volume` | POST | `/api/volumes` | - | volumes.ts:116 |
| `set_dashboard_preferences` | POST | `/api/dashboard/preferences` | - | dashboard.ts:29 |
| `set_environment_image_prune` | POST | `/api/environments/{environmentId}/image-prune` | - | environments.ts:219 |
| `set_environment_update_check` | POST | `/api/environments/{environmentId}/update-check` | - | environments.ts:202 |
| `set_git_stack_env_files` | POST | `/api/git/stacks/{stackId}/env-files` | - | git-stacks.ts:265 |
| `set_grid_preferences` | POST | `/api/preferences/grid` | - | users.ts:232 |
| `set_sidebar_preferences` | POST | `/api/preferences/sidebar` | - | preferences.ts:24 |
| `test_notification_config` | POST | `/api/notifications/test` | - | notifications.ts:65 |
| `test_registry` | POST | `/api/registries/test` | - | registries.ts:113 |
| `update_auth_settings` | PUT | `/api/auth/settings` | - | auth.ts:202 |
| `update_config_set` | PUT | `/api/config-sets/{configSetId}` | - | users.ts:267 |
| `update_container` | POST | `/api/containers/{containerId}/update` | - | containers.ts:255 |
| `update_container_runtime` | POST | `/api/containers/{containerId}/update-runtime` | - | containers.ts:522 |
| `update_environment` | PUT | `/api/environments/{environmentId}` | - | environments.ts:133 |
| `update_environment_notification` | PUT | `/api/environments/{environmentId}/notifications/{notificationId}` | - | environments.ts:267 |
| `update_general_settings` | POST | `/api/settings/general` | - | system.ts:97 |
| `update_git_credential` | PUT | `/api/git/credentials/{credentialId}` | - | git-stacks.ts:129 |
| `update_git_repository` | PUT | `/api/git/repositories/{repositoryId}` | - | git-stacks.ts:284 |
| `update_git_stack` | PUT | `/api/git/stacks/{stackId}` | - | git-stacks.ts:241 |
| `update_ldap_provider` | PUT | `/api/auth/ldap/{providerId}` | - | auth.ts:155 |
| `update_notification` | PUT | `/api/notifications/{notificationId}` | - | notifications.ts:42 |
| `update_oidc_provider` | PUT | `/api/auth/oidc/{providerId}` | - | auth.ts:179 |
| `update_profile` | PUT | `/api/profile` | - | users.ts:156 |
| `update_profile_preferences` | PUT | `/api/profile/preferences` | - | users.ts:172 |
| `update_registry` | PUT | `/api/registries/{registryId}` | - | registries.ts:42 |
| `update_role` | PUT | `/api/roles/{roleId}` | - | users.ts:131 |
| `update_scanner_settings` | POST | `/api/settings/scanner` | - | system.ts:120 |
| `update_schedule_settings` | PUT | `/api/schedules/settings` | - | schedules.ts:32 |
| `update_template_source` | PUT | `/api/templates/sources` | - | templates.ts:52 |
| `update_user` | PUT | `/api/users/{userId}` | - | users.ts:50 |

## BODY_CONTRACT_UNRESOLVED (35)

Für diesen body-tragenden Endpunkt liegt (noch) kein OpenAPI-Contract vor (fehlende `@openapi`-JSDoc-Annotation im Dockhand-Fork).

| Tool | HTTP | Pfad | Feld | Datei |
|------|------|------|------|-------|
| `check_container_updates` | POST | `/api/containers/check-updates` | - | containers.ts:421 |
| `deploy_git_repository` | POST | `/api/git/repositories/{repositoryId}/deploy` | - | git-stacks.ts:174 |
| `deploy_git_stack` | POST | `/api/git/stacks/{stackId}/deploy` | - | git-stacks.ts:30 |
| `deploy_git_stack_stream` | POST | `/api/git/stacks/{stackId}/deploy-stream` | - | git-stacks.ts:255 |
| `logout` | POST | `/api/auth/logout` | - | auth.ts:210 |
| `pause_container` | POST | `/api/containers/{containerId}/pause` | - | containers.ts:184 |
| `prune_all` | POST | `/api/prune/all` | - | system.ts:156 |
| `prune_containers` | POST | `/api/prune/containers` | - | system.ts:163 |
| `prune_images` | POST | `/api/prune/images` | - | system.ts:170 |
| `prune_networks` | POST | `/api/prune/networks` | - | system.ts:177 |
| `prune_volumes` | POST | `/api/prune/volumes` | - | system.ts:184 |
| `receive_git_webhook` | POST | `/api/git/webhook/{webhookId}` | - | git-stacks.ts:308 |
| `release_volume_browse` | POST | `/api/volumes/{volumeName}/browse/release` | - | volumes.ts:75 |
| `restart_container` | POST | `/api/containers/{containerId}/restart` | - | containers.ts:174 |
| `restart_stack` | POST | `/api/stacks/{name}/restart` | - | stacks.ts:76 |
| `run_schedule_now` | POST | `/api/schedules/{type}/{scheduleId}/run` | - | schedules.ts:56 |
| `scan_all_vulnerabilities` | POST | `/api/vulnerabilities/scan-all` | - | vulnerabilities.ts:45 |
| `set_default_registry` | POST | `/api/registries/{registryId}/default` | - | registries.ts:56 |
| `start_container` | POST | `/api/containers/{containerId}/start` | - | containers.ts:154 |
| `start_stack` | POST | `/api/stacks/{name}/start` | - | stacks.ts:56 |
| `stop_container` | POST | `/api/containers/{containerId}/stop` | - | containers.ts:164 |
| `stop_stack` | POST | `/api/stacks/{name}/stop` | - | stacks.ts:66 |
| `sync_git_repository` | POST | `/api/git/repositories/{repositoryId}/sync` | - | git-stacks.ts:181 |
| `sync_git_stack` | POST | `/api/git/stacks/{stackId}/sync` | - | git-stacks.ts:37 |
| `test_environment` | POST | `/api/environments/{environmentId}/test` | - | environments.ts:147 |
| `test_git_repository` | POST | `/api/git/repositories/{repositoryId}/test` | - | git-stacks.ts:188 |
| `test_git_stack` | POST | `/api/git/stacks/{stackId}/test` | - | git-stacks.ts:44 |
| `test_ldap_provider` | POST | `/api/auth/ldap/{providerId}/test` | - | auth.ts:79 |
| `test_notification` | POST | `/api/notifications/{notificationId}/test` | - | notifications.ts:56 |
| `test_oidc_provider` | POST | `/api/auth/oidc/{providerId}/test` | - | auth.ts:51 |
| `toggle_schedule` | POST | `/api/schedules/{type}/{scheduleId}/toggle` | - | schedules.ts:66 |
| `toggle_system_schedule` | POST | `/api/schedules/system/{scheduleId}/toggle` | - | schedules.ts:73 |
| `trigger_environment_image_prune` | PUT | `/api/environments/{environmentId}/image-prune` | - | environments.ts:276 |
| `unpause_container` | POST | `/api/containers/{containerId}/unpause` | - | containers.ts:194 |
| `upload_container_file` | POST | `/api/containers/{containerId}/files/upload` | - | containers.ts:412 |

