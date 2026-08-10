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
USER mcp
EXPOSE 8080
# Use 127.0.0.1 explicitly, not localhost: on Alpine/musl, BusyBox wget
# resolves "localhost" to the IPv6 loopback (::1) first, but the server
# only binds the IPv4 wildcard address (0.0.0.0), so every probe against
# "localhost" fails with "Connection refused" even though the server is
# healthy (fixes #92, #84).
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "dist/index.js"]
