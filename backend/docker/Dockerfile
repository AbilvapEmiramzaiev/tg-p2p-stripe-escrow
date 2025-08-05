FROM node:18-alpine
WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production && npm cache clean --force

RUN addgroup -g 1001 -S nodejs && \
    adduser -S botuser -u 1001

COPY . .

RUN chown -R botuser:nodejs /app
USER botuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

CMD ["npm", "start"]