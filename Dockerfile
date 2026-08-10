FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN addgroup -g 1001 mcp && adduser -u 1001 -G mcp -D mcp
COPY --from=build /app/package*.json ./
# --ignore-scripts skips the `prepare` hook that runs `husky` (a devDependency
# excluded by --omit=dev). Runtime install needs no install-side scripts.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
# src/openapi/spec-loader.ts (compiled to dist/openapi/spec-loader.js) reads
# docs/dockhand-openapi.json at runtime, resolved relative to its own compiled
# location — src/openapi/describe-tool.ts (via registerTool(), src/utils/tool-helper.ts)
# derives every MCP tool's description from it at registration time (P3 Task 5). Without
# this file the server still starts and serves fine, but every tool description falls
# back to the generic default and each tool logs a startup advisory — copy it alongside
# dist/ so the real, spec-derived descriptions are what actually ships.
COPY --from=build /app/docs/dockhand-openapi.json ./docs/dockhand-openapi.json
USER mcp
EXPOSE 8080
# Use 127.0.0.1 explicitly, not localhost: on Alpine/musl, BusyBox wget
# resolves "localhost" to the IPv6 loopback (::1) first, but the server
# only binds the IPv4 wildcard address (0.0.0.0), so every probe against
# "localhost" fails with "Connection refused" even though the server is
# healthy (fixes #92, #84).
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "dist/index.js"]
