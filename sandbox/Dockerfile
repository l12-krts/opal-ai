# Opal agent sandbox: one container per agent, with a real Chromium, a shell and a workspace.
# The Playwright image ships Chromium, Node and an unprivileged `pwuser`.
FROM mcr.microsoft.com/playwright:v1.65.1-noble

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    OPAL_BROWSER_PORT=7777

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv git curl jq ripgrep unzip zip less nano tree ca-certificates \
      sqlite3 poppler-utils ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# Python for data work, images and documents. Ubuntu's system Python refuses pip installs
# (PEP 668), so everything lives in a venv that agents own and can `pip install` into.
# /etc/profile resets PATH for login shells (the terminal tool runs `bash -lc`), so the venv
# goes on PATH through profile.d as well as ENV.
COPY requirements.txt /tmp/opal-requirements.txt
RUN python3 -m venv /opt/py \
 && /opt/py/bin/pip install --no-cache-dir -r /tmp/opal-requirements.txt \
 && rm /tmp/opal-requirements.txt \
 && chown -R pwuser:pwuser /opt/py \
 && printf 'export PATH="/opt/py/bin:$PATH"\nexport NPM_CONFIG_PREFIX="$HOME/.npm-global"\nexport PATH="$HOME/.npm-global/bin:$PATH"\n' > /etc/profile.d/opal.sh
ENV PATH="/opt/py/bin:$PATH"

# Node packages agents reach for often, installed globally so `require`/`import` finds them
# from any folder via NODE_PATH.
RUN npm install -g --no-audit --no-fund typescript tsx sharp xlsx csv-parse csv-stringify cheerio marked \
 && npm cache clean --force \
 && printf 'export NODE_PATH="%s"\n' "$(npm root -g)" >> /etc/profile.d/opal.sh

WORKDIR /opt/opal
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY browser-server.mjs browser-client.mjs entrypoint.sh ./
RUN chmod 755 entrypoint.sh \
 && ln -s /opt/opal/browser-client.mjs /usr/local/bin/opal-browser \
 && chmod 755 browser-client.mjs \
 && mkdir -p /workspace \
 && chown -R pwuser:pwuser /workspace

USER pwuser
WORKDIR /workspace
ENTRYPOINT ["/opt/opal/entrypoint.sh"]
