# Sandbox image: the whole pi process for unattended runs (docs/sandbox.md). Built by `pitcrew box build`.
# Base pinned by digest (node:24-bookworm-slim, pulled 2026-11-11). Bump: pull, edit the digest, rebuild.
FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

RUN apt-get update \
 && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep jq build-essential python3 \
 && rm -rf /var/lib/apt/lists/*

# Pinned packages (box/package-lock.json, integrity-checked). Install scripts never run.
WORKDIR /opt/pitcrew-box
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
 && ln -s /opt/pitcrew-box/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js /usr/local/bin/pi \
 && pi --version && npm cache clean --force

COPY settings.json entrypoint.sh egress-proxy.mjs ./

# The base image's `node` user has uid 1000; rename it to `agent`. Its home is a tmpfs at run time.
RUN usermod -l agent -d /home/agent -m node && groupmod -n agent node \
 && mkdir -p /work /opt/pitcrew && chown agent:agent /work

ENV HOME=/home/agent CLAUDE_CONFIG_DIR=/home/agent/.claude PI_GUARD_STRICT=1 \
    npm_config_cache=/tmp/.npm XDG_CACHE_HOME=/tmp/.cache XDG_CONFIG_HOME=/tmp/.config \
    DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 NODE_USE_ENV_PROXY=1
USER 1000:1000
WORKDIR /work
ENTRYPOINT ["/opt/pitcrew-box/entrypoint.sh"]
CMD ["pi"]
