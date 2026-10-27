# SANAD server image: builds the web app, then runs the API and serves the app from one small container.
# Data lives in /data (mount a volume); see docs/DEPLOYMENT.md for the environment settings.
ARG BASE=node:22-alpine
FROM ${BASE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM ${BASE}
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    SANAD_DATA=/data/sanad.json
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY tsconfig.json ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "server/index.ts"]
