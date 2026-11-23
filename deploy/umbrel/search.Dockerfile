# SearXNG with Opal's settings baked in. Portainer bind mounts don't survive app restarts,
# so the config ships inside the image. Build context: searxng/
FROM searxng/searxng:latest
COPY settings.yml /etc/searxng/settings.yml
