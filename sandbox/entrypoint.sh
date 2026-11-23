#!/bin/sh
# Start the browser server in the background, then keep the container alive.
node /opt/opal/browser-server.mjs >/tmp/browser.log 2>&1 &
exec sleep infinity
