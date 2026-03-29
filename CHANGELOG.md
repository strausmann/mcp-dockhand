# MCP-Dockhand Changelog

All notable changes to **MCP-Dockhand** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0](https://github.com/strausmann/mcp-dockhand/compare/v1.0.0...v1.1.0) (2026-03-29)

### Features

* add download_container_file and upload_container_file tools ([#23](https://github.com/strausmann/mcp-dockhand/issues/23)) ([2c9c001](https://github.com/strausmann/mcp-dockhand/commit/2c9c0018a1061c094e9fb5e8caefe876e3935ecd)), closes [#18](https://github.com/strausmann/mcp-dockhand/issues/18)
* add semantic-release with auto CHANGELOG, GitHub Release, and GHCR Docker build\n\nReplaces manual tag-based release.yml workflow.\nOn every push to main, semantic-release analyzes commits and:\n- Determines version bump (feat→minor, fix→patch)\n- Generates CHANGELOG.md\n- Creates GitHub Release with tag\n- Triggers Docker build + push to GHCR\n\nBased on dockhand-guardian release configuration." ([0e3fd26](https://github.com/strausmann/mcp-dockhand/commit/0e3fd262179009cd1667098da88095e327eab4d1))
* add Vitest test suite with path encoding and tool registration tests ([#24](https://github.com/strausmann/mcp-dockhand/issues/24)) ([b075694](https://github.com/strausmann/mcp-dockhand/commit/b075694d609938a4ae50cc779d5947c7cee11256)), closes [#19](https://github.com/strausmann/mcp-dockhand/issues/19)
* automated Dockhand API schema sync and MCP tool validation ([#25](https://github.com/strausmann/mcp-dockhand/issues/25)) ([20abdea](https://github.com/strausmann/mcp-dockhand/commit/20abdea99178f3c9bee8c40533370027d0ef998c))

### Bug Fixes

* add host/port parameters to create/update/test environment for hawser-standard mode ([#15](https://github.com/strausmann/mcp-dockhand/issues/15)) ([feaa186](https://github.com/strausmann/mcp-dockhand/commit/feaa186dee76292180610e0ae4e2ce80ce862236)), closes [#4](https://github.com/strausmann/mcp-dockhand/issues/4)
* address consolidated review findings ([#30](https://github.com/strausmann/mcp-dockhand/issues/30)) ([#32](https://github.com/strausmann/mcp-dockhand/issues/32)) ([0962f39](https://github.com/strausmann/mcp-dockhand/commit/0962f398d9bef45fe872aa9e5fdaf41a45c246f5)), closes [21-#29](https://github.com/strausmann/21-/issues/29) [#33](https://github.com/strausmann/mcp-dockhand/issues/33)
* apply encodeURIComponent consistently on all path parameters ([#22](https://github.com/strausmann/mcp-dockhand/issues/22)) ([7321953](https://github.com/strausmann/mcp-dockhand/commit/7321953a3c827fb1e3bb0721d075ed2003e176c5)), closes [#16](https://github.com/strausmann/mcp-dockhand/issues/16)
* **ci:** add semantic-release dependencies and fix configuration ([35a7825](https://github.com/strausmann/mcp-dockhand/commit/35a7825f063964177412c936a28e048f9ad6dca8))
* correct HTTP methods for 21 MCP tools to match Dockhand API ([#31](https://github.com/strausmann/mcp-dockhand/issues/31)) ([ae032f2](https://github.com/strausmann/mcp-dockhand/commit/ae032f229d6c98c9ae4b75a64c5dfe0d6e5854f4)), closes [#27](https://github.com/strausmann/mcp-dockhand/issues/27)
* extract resolveHostPort helper, add connectionType gate, fix port defaults ([#21](https://github.com/strausmann/mcp-dockhand/issues/21)) ([22ea0b3](https://github.com/strausmann/mcp-dockhand/commit/22ea0b3b4a7008dc2c16c5a23282ea24bd585324)), closes [#15](https://github.com/strausmann/mcp-dockhand/issues/15) [#20](https://github.com/strausmann/mcp-dockhand/issues/20)
* improve test precision for tool registration and environment scope ([#28](https://github.com/strausmann/mcp-dockhand/issues/28)) ([332a7f3](https://github.com/strausmann/mcp-dockhand/commit/332a7f344348abed01f2de78b0e86ecdcca7832d)), closes [#26](https://github.com/strausmann/mcp-dockhand/issues/26)
* replace generic config/settings with typed parameters ([#29](https://github.com/strausmann/mcp-dockhand/issues/29)) ([dec8cd4](https://github.com/strausmann/mcp-dockhand/commit/dec8cd45faf6ed4fbeb3207bc52a95881682c210)), closes [#17](https://github.com/strausmann/mcp-dockhand/issues/17)

### Documentation

* Add CHANGELOG.md ([30b8eff](https://github.com/strausmann/mcp-dockhand/commit/30b8eff7c1e9d884364943fec2500b69db493fb1))
* Add CLAUDE.md, Copilot instructions, and test suite issue template ([c005bcd](https://github.com/strausmann/mcp-dockhand/commit/c005bcde3b5c6b70557255f04013f4c5855d5071))
* update review instructions — verify against upstream Dockhand/Hawser source ([094762b](https://github.com/strausmann/mcp-dockhand/commit/094762b62fab02ef32bf0e73c11bced572d2046a))
