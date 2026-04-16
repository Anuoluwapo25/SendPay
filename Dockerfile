FROM node:22-alpine
WORKDIR /app
COPY ai-agent-service/package*.json ./
RUN npm install
COPY ai-agent-service/ .
RUN npm run build
EXPOSE 3001
CMD ["node", "dist/index.js"]
