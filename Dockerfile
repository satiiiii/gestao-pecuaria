FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "src/server.mjs"]
