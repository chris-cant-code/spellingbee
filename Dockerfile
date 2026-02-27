FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN mkdir -p /data
ENV DATABASE_PATH=/data/spellingbee.db
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
