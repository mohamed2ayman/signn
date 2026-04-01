#!/bin/sh
# Rebuild native binaries (bcrypt) for the container's Linux architecture.
# This is a no-op when host and container match (Mac/Linux).
# On Windows hosts, the volume-mounted node_modules contains Windows binaries
# that crash inside the Linux container — this rebuild fixes that.
npm rebuild bcrypt --quiet 2>/dev/null || true

exec "$@"
