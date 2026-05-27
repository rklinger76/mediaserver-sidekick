FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
ENV DEFAULT_EXPORT_DIR=/exports
ENV DEFAULT_BACKUP_DIR=/backups
ENV PUID=1000
ENV PGID=1000

RUN apk add --no-cache su-exec

COPY package.json ./
COPY src ./src
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /app/data /exports /backups \
  && chown -R node:node /app /exports /backups

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
