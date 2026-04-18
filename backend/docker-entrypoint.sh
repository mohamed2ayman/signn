#!/bin/sh
# Rebuild native binaries (bcrypt, etc.) for the container's Linux architecture.
# This is a no-op when host and container arch match; fixes Windows host binaries.
npm rebuild bcrypt --quiet 2>/dev/null || true

# Auto-run migrations + seeds on every container start.
# Ensures the schema is always up-to-date and default users always exist,
# even after a fresh DB reset or first-time setup.
echo "[entrypoint] Running migrations and seeds..."
npm run migration:run 2>&1 | grep -E "\[seed\]|Migration|Error|error" || true
echo "[entrypoint] Startup complete — launching server."

exec "$@"
