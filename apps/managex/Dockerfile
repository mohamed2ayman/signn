FROM node:20-alpine

WORKDIR /app

# 1. Copy root package.json and lockfile (workspace definitions)
COPY package.json package-lock.json ./

# 2. Copy workspace package manifests so npm can resolve workspace deps
COPY packages/ ./packages/
COPY apps/managex/package.json ./apps/managex/package.json

# 3. Install all dependencies (resolves @managex/tokens via workspace)
RUN npm ci --workspace=@managex/landing --include-workspace-root

# 4. Copy the landing page app source
COPY apps/managex/ ./apps/managex/

WORKDIR /app/apps/managex

EXPOSE 5175

CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5175"]
