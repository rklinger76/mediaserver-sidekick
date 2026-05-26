FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
ENV DEFAULT_EXPORT_DIR=/exports

COPY package.json ./
COPY src ./src
COPY public ./public

RUN mkdir -p /app/data /exports && chown -R node:node /app /exports

USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
