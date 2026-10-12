# StudyFlow web: the built student app plus a reverse proxy to Django, on one origin.
# Built by `docker compose build`, which passes the API image as the `django` context
# (compose.yaml `additional_contexts`) so its collected static files can be copied.
# Standalone: docker build --build-context django=docker-image://studyflow-django-app frontend
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
# Django's login page and admin need their CSS/JS; gunicorn serves no static files.
COPY --from=django /app/static /usr/share/nginx/django-static
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
    CMD wget -q --spider http://127.0.0.1/ || exit 1
