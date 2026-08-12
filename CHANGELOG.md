# MCP-Dockhand Changelog

All notable changes to **MCP-Dockhand** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.13.0](https://github.com/strausmann/mcp-dockhand/compare/v1.12.0...v1.13.0) (2026-08-12)

### Features

* add self-help / meta tools (server info, update check, tool manifest, diagnostics) ([#186](https://github.com/strausmann/mcp-dockhand/issues/186)) ([b9891bf](https://github.com/strausmann/mcp-dockhand/commit/b9891bf95cd4a75c0460b8a5d5a5a28888f237a8)), references [#116](https://github.com/strausmann/mcp-dockhand/issues/116)
* **security:** opt-in Host/Origin allowlist and bearer auth for /mcp transport ([#188](https://github.com/strausmann/mcp-dockhand/issues/188)) ([25b5e5b](https://github.com/strausmann/mcp-dockhand/commit/25b5e5bfc4e3e7d85bcf09c2e0a7b123bbcaf1de))

## [1.12.0](https://github.com/strausmann/mcp-dockhand/compare/v1.11.0...v1.12.0) (2026-08-11)

### ⚠ BREAKING CHANGES

* **tools:** list_batch_operations renamed to execute_batch; set_user_roles split into add_user_role + remove_user_role; set_git_stack_env_files removed (read-only, redundant). Also: activate_license/create_role/trigger_test_notification/create_container_file body-field fixes; explicit envFilePath on create_git_stack/update_git_stack.

### Features

* **api:** add advisory CROSSREF_UNRESOLVED check to the MCP tool validator ([06fde06](https://github.com/strausmann/mcp-dockhand/commit/06fde0672915e661c51d7cd602f5b5ec045388f6)), references [#57](https://github.com/strausmann/mcp-dockhand/issues/57)
* **api:** derive slim MCP tool descriptions from OpenAPI operations ([d37b986](https://github.com/strausmann/mcp-dockhand/commit/d37b986189ea1b60605244a30dff8dddb32c3fee)), references [#57](https://github.com/strausmann/mcp-dockhand/issues/57)
* **api:** promote BODY_PARAM_MISSING_REQUIRED to a hard CI gate ([50609fd](https://github.com/strausmann/mcp-dockhand/commit/50609fd6adce3f40f8ea7518d2a0afc868bf0557)), references [#57](https://github.com/strausmann/mcp-dockhand/issues/57)
* **ci:** publish committed docs/coverage.md, drop dead coverage-tracker ([#165](https://github.com/strausmann/mcp-dockhand/issues/165)) ([d9aa7c8](https://github.com/strausmann/mcp-dockhand/commit/d9aa7c8f0fee5cc5506f6376ca1c5bfc5df4a423))
* **docs:** add omission registry for deliberately un-mirrored endpoints ([69b06c8](https://github.com/strausmann/mcp-dockhand/commit/69b06c868f24fb54d269dd5d62c43f20ec8fd0da)), references [#164](https://github.com/strausmann/mcp-dockhand/issues/164) [#57](https://github.com/strausmann/mcp-dockhand/issues/57)
* **validate:** body-contract checks (advisory) via OpenApiContractSource ([#166](https://github.com/strausmann/mcp-dockhand/issues/166)) ([2ce6093](https://github.com/strausmann/mcp-dockhand/commit/2ce60939f0f90e7258aefb4861185888803e44e2)), references [#57](https://github.com/strausmann/mcp-dockhand/issues/57)

### Bug Fixes

* **api:** correct shared-endpoint tool descriptions and lock in cross-ref parity ([cbbc9c9](https://github.com/strausmann/mcp-dockhand/commit/cbbc9c9892eb9e080476c8e79360ebc6fb3fff79)), references [#57](https://github.com/strausmann/mcp-dockhand/issues/57)
* hard-fail body-contract collector crash, drop unrunnable lint script ([25325aa](https://github.com/strausmann/mcp-dockhand/commit/25325aa75619f06c351bec16e8163d8e9e108676)), closes [#173](https://github.com/strausmann/mcp-dockhand/issues/173) [#176](https://github.com/strausmann/mcp-dockhand/issues/176)
* **tools:** correct 9 real body-contract bugs found by the validator ([#169](https://github.com/strausmann/mcp-dockhand/issues/169)) ([7960ec4](https://github.com/strausmann/mcp-dockhand/commit/7960ec4a492b93d389c3188a0cc09aa3bb8c2af9))
* **tools:** correct body field names for 5 tools (guaranteed 400) ([#168](https://github.com/strausmann/mcp-dockhand/issues/168)) ([1bbbdf9](https://github.com/strausmann/mcp-dockhand/commit/1bbbdf91fa239479f7c8364432c7382e9b238cd0)), closes [#167](https://github.com/strausmann/mcp-dockhand/issues/167)
* **validate:** suppress body-contract false-positives (passthrough + computed-body whitelist) ([#170](https://github.com/strausmann/mcp-dockhand/issues/170)) ([a48a71d](https://github.com/strausmann/mcp-dockhand/commit/a48a71d8729ff52c33485b810e7305f00ffd03ea)), references [#57](https://github.com/strausmann/mcp-dockhand/issues/57)

### Code Refactoring

* **tools:** derive descriptions from the spec, drop hand-written text ([80a24e9](https://github.com/strausmann/mcp-dockhand/commit/80a24e92c48c93bcdf2e648b47f25d37a9384024)), references [#57](https://github.com/strausmann/mcp-dockhand/issues/57)

### Documentation

* **tools:** name accepted in-place fields for update_container_runtime ([#163](https://github.com/strausmann/mcp-dockhand/issues/163)) ([e335713](https://github.com/strausmann/mcp-dockhand/commit/e335713df582f76a65673ae0c6d028051e1b46bd)), closes [#155](https://github.com/strausmann/mcp-dockhand/issues/155)

## [1.11.0](https://github.com/strausmann/mcp-dockhand/compare/v1.10.0...v1.11.0) (2026-08-10)

### Features

* **tools:** extend validate-mcp-tools.mjs with query-param diff ([59ec907](https://github.com/strausmann/mcp-dockhand/commit/59ec90705d227bd924ea58b31423ceeaa649b696)), references [#81](https://github.com/strausmann/mcp-dockhand/issues/81) [#95](https://github.com/strausmann/mcp-dockhand/issues/95)

### Bug Fixes

* **auth:** normalize base URL for login + surface tool errors ([#159](https://github.com/strausmann/mcp-dockhand/issues/159)) ([600a25d](https://github.com/strausmann/mcp-dockhand/commit/600a25d2a37959c70fe43ad920aa1f7d259601cc)), closes [#116](https://github.com/strausmann/mcp-dockhand/issues/116) [#116](https://github.com/strausmann/mcp-dockhand/issues/116), references [#116](https://github.com/strausmann/mcp-dockhand/issues/116)
* **docker:** healthcheck uses 127.0.0.1 to avoid IPv6 localhost failure on Alpine ([#158](https://github.com/strausmann/mcp-dockhand/issues/158)) ([af6c513](https://github.com/strausmann/mcp-dockhand/commit/af6c513f1dfac248eb4e4b40acea88607d72019d)), closes [#92](https://github.com/strausmann/mcp-dockhand/issues/92) [#84](https://github.com/strausmann/mcp-dockhand/issues/84)
* **registries:** align get_registry_catalog with the real /api/registry/catalog contract ([6511cf2](https://github.com/strausmann/mcp-dockhand/commit/6511cf2350bb5bc37f09f31981cb389188b095fd)), closes [#147](https://github.com/strausmann/mcp-dockhand/issues/147) [#150](https://github.com/strausmann/mcp-dockhand/issues/150)
* **registries:** align search_registry with the real /api/registry/search contract ([62d7799](https://github.com/strausmann/mcp-dockhand/commit/62d7799817006f13ab441f6e4a222a0123d5a633)), closes [#146](https://github.com/strausmann/mcp-dockhand/issues/146)
* **release:** keep package version in sync via @semantic-release/npm (npmPublish:false) ([15c5f3a](https://github.com/strausmann/mcp-dockhand/commit/15c5f3a915a25eb288215eec38dff4353ab24174)), closes [#139](https://github.com/strausmann/mcp-dockhand/issues/139)
* **release:** relax conventional-changelog-writer override to ^9.2.0 ([7c15fd4](https://github.com/strausmann/mcp-dockhand/commit/7c15fd4ab9888fc8d24c1adf58db1aefc3829efa)), closes [#139](https://github.com/strausmann/mcp-dockhand/issues/139), references [semantic-release/release-notes-generator#1021](https://github.com/semantic-release/release-notes-generator/issues/1021)
* **tools:** align exec_container with the real Docker-exec-instance contract ([ec79b47](https://github.com/strausmann/mcp-dockhand/commit/ec79b47207d46e538659f94d692d3af70d72d287)), closes [#81](https://github.com/strausmann/mcp-dockhand/issues/81), references [#81](https://github.com/strausmann/mcp-dockhand/issues/81) [#81](https://github.com/strausmann/mcp-dockhand/issues/81)
* **tools:** correct image-prune settings and trigger HTTP methods ([#141](https://github.com/strausmann/mcp-dockhand/issues/141)) ([6bfce61](https://github.com/strausmann/mcp-dockhand/commit/6bfce61919f1afd47ab3eb44bf86dc6ac1176602)), closes [#138](https://github.com/strausmann/mcp-dockhand/issues/138)
* **tools:** correct required/optional query params for 6 tools ([#153](https://github.com/strausmann/mcp-dockhand/issues/153)) ([bffc498](https://github.com/strausmann/mcp-dockhand/commit/bffc4980c784e34df93ef8c2955c7b17ebb237b7)), closes [#152](https://github.com/strausmann/mcp-dockhand/issues/152)
* **tools:** required/optional-aware query-param check, no manual triage ([7e79e54](https://github.com/strausmann/mcp-dockhand/commit/7e79e544e0138aa23eb8a3169b45aee67152312c)), references [#148](https://github.com/strausmann/mcp-dockhand/issues/148)
* **tools:** update_container — optional settings, explicit fields, reject unknown keys ([#154](https://github.com/strausmann/mcp-dockhand/issues/154)) ([65a71b2](https://github.com/strausmann/mcp-dockhand/commit/65a71b2919691955418f83ce2b0f69480a34b8a1)), closes [#142](https://github.com/strausmann/mcp-dockhand/issues/142)

### Documentation

* **readme:** document mcp-proxy workaround for Claude Desktop (remote) ([#157](https://github.com/strausmann/mcp-dockhand/issues/157)) ([cef7aaf](https://github.com/strausmann/mcp-dockhand/commit/cef7aaf6ef3dd36da1b0b15d7d866aa216aa56a2)), closes [#90](https://github.com/strausmann/mcp-dockhand/issues/90)

## [1.10.0](https://github.com/strausmann/mcp-dockhand/compare/v1.9.1...v1.10.0) (2026-08-09)

### Features

* **server:** bound Streamable HTTP session lifecycle ([4166a6d](https://github.com/strausmann/mcp-dockhand/commit/4166a6d9d7b7508ac989726666ce10d32c501302))

### Bug Fixes

* **release:** migrate presetConfig.types hidden-Feld zu effect (ccc@10) ([40f0719](https://github.com/strausmann/mcp-dockhand/commit/40f071957ae3f9711d881de5d034cd9c0a58c862))
* **release:** render changelog on ccc@10 via conventional-changelog-writer@9 override ([6a49c1b](https://github.com/strausmann/mcp-dockhand/commit/6a49c1b387cc4d974c365e80416d85c9d0d47911)), references [#113](https://github.com/strausmann/mcp-dockhand/issues/113) [semantic-release/release-notes-generator#1021](https://github.com/semantic-release/release-notes-generator/issues/1021)
* **server:** protect founding session from eviction; run DELETE cleanup ([85b3f29](https://github.com/strausmann/mcp-dockhand/commit/85b3f29b134d213767d2a9502ac0eda12b747ef1)), references [#133](https://github.com/strausmann/mcp-dockhand/issues/133)
* **tools:** align stack, system and favorites API contracts ([#131](https://github.com/strausmann/mcp-dockhand/issues/131)) ([1dc0b31](https://github.com/strausmann/mcp-dockhand/commit/1dc0b3183c1ead878f3261698a0de50bf35e0a8c))
* **tools:** send pull/build/forceRecreate body from deploy_stack ([#117](https://github.com/strausmann/mcp-dockhand/issues/117)) ([99e42a9](https://github.com/strausmann/mcp-dockhand/commit/99e42a92dd1fae68a7b461a3a0b636271d70cf23))

## [1.9.1](https://github.com/strausmann/mcp-dockhand/compare/v1.9.0...v1.9.1) (2026-07-19)

### Bug Fixes

* **tools:** route isSecret:false vars to .env in update_stack_env ([#109](https://github.com/strausmann/mcp-dockhand/issues/109)) ([#110](https://github.com/strausmann/mcp-dockhand/issues/110)) ([b637efb](https://github.com/strausmann/mcp-dockhand/commit/b637efb50d4f1042bc73d6b528f1325eab44d80e)), closes [#105](https://github.com/strausmann/mcp-dockhand/issues/105) [#105](https://github.com/strausmann/mcp-dockhand/issues/105) [#105](https://github.com/strausmann/mcp-dockhand/issues/105) [#105](https://github.com/strausmann/mcp-dockhand/issues/105)

### Documentation

* **release:** backfill v1.9.0 changelog entry ([#108](https://github.com/strausmann/mcp-dockhand/issues/108)) ([c4d49af](https://github.com/strausmann/mcp-dockhand/commit/c4d49afa53716ca1b2235e302211d3aef9131057))

### CI/CD

* **release:** restore @semantic-release/git and changelog plugins ([#107](https://github.com/strausmann/mcp-dockhand/issues/107)) ([e02ae91](https://github.com/strausmann/mcp-dockhand/commit/e02ae9171a5359997fd98812afe24e37c2a7836b))

## [1.9.0](https://github.com/strausmann/mcp-dockhand/compare/v1.8.3...v1.9.0) (2026-07-17)

### Features

* **tools:** stack-env ergonomics — summary/hint, remove_stack_env_vars, collision check ([#105](https://github.com/strausmann/mcp-dockhand/issues/105)) ([b18d5ca](https://github.com/strausmann/mcp-dockhand/commit/b18d5cacd66abf10980f01be83702a595995b05e))

### CI/CD

* **deps:** add lockfile-integrity gate (npm ci in node:22-alpine) ([#104](https://github.com/strausmann/mcp-dockhand/issues/104)) ([9f0da7c](https://github.com/strausmann/mcp-dockhand/commit/9f0da7cba2c7675a47f6c26d60e995adc98774a5)), closes [#69](https://github.com/strausmann/mcp-dockhand/issues/69)
* **release:** drop @semantic-release/git and changelog plugins ([#106](https://github.com/strausmann/mcp-dockhand/issues/106)) ([bdecb01](https://github.com/strausmann/mcp-dockhand/commit/bdecb01a2a4a6b5b0247c831135cbc559d8f76ba))

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
