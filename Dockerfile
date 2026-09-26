# --- stage 1: build the TypeScript wrapper ---
FROM node:20-alpine AS ts-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- stage 2: runtime ---
# No Go toolchain needed at all: we grab the official prebuilt
# interactsh-client binary from its GitHub release instead of compiling it
# from source, which avoids Go-version compatibility issues entirely.
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache curl unzip \
  && LATEST_URL=$(curl -s https://api.github.com/repos/projectdiscovery/interactsh/releases/latest \
       | grep "browser_download_url" \
       | grep "linux_amd64.zip" \
       | head -n1 \
       | cut -d '"' -f4) \
  && echo "Downloading $LATEST_URL" \
  && curl -L -o /tmp/interactsh-client.zip "$LATEST_URL" \
  && unzip -o /tmp/interactsh-client.zip -d /usr/local/bin interactsh-client \
  && rm /tmp/interactsh-client.zip \
  && chmod +x /usr/local/bin/interactsh-client \
  && apk del curl unzip

COPY package*.json ./
RUN npm install --omit=dev
COPY --from=ts-builder /app/dist ./dist

ENV PORT=8080
ENV INTERACTSH_BINARY=/usr/local/bin/interactsh-client
EXPOSE 8080

CMD ["node", "dist/server.js"]
