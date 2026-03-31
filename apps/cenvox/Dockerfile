FROM node:20-alpine

WORKDIR /app

# 1. Copy root package.json and lockfile (workspace definitions)
COPY package.json package-lock.json ./

# 2. Copy workspace package manifests so npm can resolve workspace deps
COPY packages/ ./packages/
COPY apps/cenvox/package.json ./apps/cenvox/package.json

# 3. Install all dependencies (resolves @cenvox/tokens via workspace)
RUN npm ci --workspace=@cenvox/landing --include-workspace-root

# 4. Copy the landing page app source
COPY apps/cenvox/ ./apps/cenvox/

WORKDIR /app/apps/cenvox

EXPOSE 5174

CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5174"]
