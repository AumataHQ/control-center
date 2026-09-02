# Control Center on a server. The app has no login of its own, so the published
# port is the access boundary — see deploy/truenas/compose.yaml, which binds it
# to one Tailscale address rather than every interface.

FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Inside the container 0.0.0.0 means this container only; the host publishes the
# port on a single address.
ENV HOSTNAME=0.0.0.0
ENV CONTROL_CENTER_DATA_DIR=/data

RUN addgroup -g 1001 -S newsroom \
 && adduser -u 1001 -S newsroom -G newsroom \
 && mkdir -p /data && chown newsroom:newsroom /data && chmod 700 /data

COPY --from=build --chown=newsroom:newsroom /app/.next/standalone ./
COPY --from=build --chown=newsroom:newsroom /app/.next/static ./.next/static

USER newsroom
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>r.json()).then(p=>process.exit(p.service==='control-center'?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
