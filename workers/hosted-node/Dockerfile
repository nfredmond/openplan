FROM node:24-bookworm-slim

# Chromium runs inside this dedicated container as the node user. The wrapper
# disables its separate sandbox because managed containers cannot create it.
# This container receives only server-authored report HTML, not public browsing.
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && printf '#!/bin/sh\nexec /usr/bin/chromium --no-sandbox "$@"\n' > /usr/local/bin/openplan-chromium \
    && chmod 755 /usr/local/bin/openplan-chromium
WORKDIR /app/openplan
COPY openplan/package.json openplan/package-lock.json ./
COPY openplan/vendor ./vendor
RUN npm ci --include=dev
COPY openplan/tsconfig.json ./
COPY openplan/src ./src
COPY openplan/scripts ./scripts
COPY workers/planner_agent_connector /app/workers/planner_agent_connector
COPY workers/hosted-node/supervise.mjs /app/supervise.mjs
ENV NODE_ENV=production
ENV CHROME_EXECUTABLE_PATH=/usr/local/bin/openplan-chromium
# Mounted volumes start root-owned. Only this service's /data mount is adjusted.
CMD ["sh", "-c", "mkdir -p /data && chown node:node /data && exec runuser -u node -- node /app/supervise.mjs"]
