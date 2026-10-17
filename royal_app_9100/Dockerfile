FROM node:18-alpine
WORKDIR /app
COPY . .
RUN npm init -y && npm install http path fs
CMD ["node", "shim_server.cjs"]
