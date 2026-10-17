# ITMC FenestrationOS web — static SPA served by nginx, /api proxied to the api service.
# Build context = repository root (the build syncs the DEMO catalogue from backend/app/seed).
FROM node:20-alpine AS build
WORKDIR /src
COPY backend/app/seed/demo_catalogue.json backend/app/seed/demo_catalogue.json
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY frontend frontend
RUN cd frontend && npm run build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
