# Changelog

## v2025.9

- Update OpenAPI specs.

## v2025.8.1

- Added richer token/session surfaces across `MCPServer`, `StaticTools`, and OAuth middleware, including OTP/session manager ports, refresh token reporting, and new OAuth login/logout tools on STDIO transports.
- Introduced streamable HTTP transport support with server‐mode detection, OAuth route wiring, base URL + `ADVERTISED_*` config, and exposed HTTP server status helpers.
- Expanded docs, test utilities, and example servers; reorganized docs into `docs/`, updated `env.example`, and added `tests/` with coverage for static/OpenAPI tools.
- Migrated the toolchain to pnpm, added ESLint + updated `tsconfig`, refreshed `package.json` scripts/version, and removed legacy `package-lock.json`.
- Improved logging (OpenAPI tools debug output), refactored core structure, and reordered `UserContext` fields to align with the new protocol version.
- Fixed test server env var usage and guarded streamable server startup with mode checks.
