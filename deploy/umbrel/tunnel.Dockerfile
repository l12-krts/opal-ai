# Tailscale node "opal" that publishes Opal over HTTPS with Tailscale Funnel.
# Build context: deploy/umbrel/
FROM tailscale/tailscale:v1.104.2
COPY serve.json /config/serve.json
