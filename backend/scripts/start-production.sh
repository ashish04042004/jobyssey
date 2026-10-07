#!/bin/sh
# Single-instance hosts without a pre-deploy step (Render free): apply pending
# migrations, then hand the process over to the API so it receives SIGTERM.
set -e
./node_modules/.bin/prisma migrate deploy
exec node src/server.js
