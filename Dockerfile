FROM node:22-slim

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package*.json ./
COPY server/prisma ./prisma/

RUN npm ci
RUN npx prisma generate

COPY server/ .
RUN npm run build

EXPOSE 8080

CMD ["node", "dist/index.js"]
