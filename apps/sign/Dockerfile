FROM node:20-alpine

WORKDIR /app

# 1. Copy root package.json and lockfile (workspace definitions)
COPY package.json package-lock.json ./

# 2. Copy workspace package manifests so npm can resolve workspace deps
COPY packages/ ./packages/
COPY apps/sign/package.json ./apps/sign/package.json

# 3. Install all dependencies (resolves @cenvox/tokens via workspace)
RUN npm ci --workspace=@cenvox/sign --include-workspace-root

# 4. Copy the frontend app source
COPY apps/sign/ ./apps/sign/

WORKDIR /app/apps/sign

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]
