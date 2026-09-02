# syntax=docker/dockerfile:1

# Один Dockerfile на три образа: `server` (API и воркер) и `web` (статика за nginx).
#
# API и воркер живут в ОДНОМ образе не из экономии: воркер импортирует конфигурацию,
# сборку соединений, хранилище и провайдеров из `@workflow/api`. Разные образы означали бы
# две сборки одного и того же кода, которые расходятся при первом же рассинхроне тегов.
# Разделяет их только команда: `node apps/api/dist/server.js` против
# `node apps/worker/dist/index.js`.

# --- база ------------------------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# без этого corepack спрашивает подтверждение на скачивание pnpm и висит вечно
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# --- манифесты -------------------------------------------------------------
# Отдельный слой ради кэша: правка кода его не инвалидирует, поэтому `pnpm install`
# переиспользуется. Копируются именно манифесты, а не весь репозиторий.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
# версия pnpm берётся из `packageManager` в package.json — второй копии версии в репозитории нет
RUN corepack install

# --- зависимости для сборки ------------------------------------------------
# Полная установка вместе с devDependencies. Этот слой в рантайм-образ не едет.
FROM manifests AS deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# --- компиляция ------------------------------------------------------------
FROM deps AS build
COPY . .
# порядок contracts → core → api → worker pnpm выводит из workspace-зависимостей сам
RUN pnpm --filter "@workflow/api..." --filter "@workflow/worker..." build

# --- только прод-зависимости -----------------------------------------------
# Отдельная установка вместо чистки предыдущей: `--prod` тут решает, что попадёт
# в рантайм, а фильтр отсекает ещё и зависимости фронтенда — в серверном образе
# им делать нечего.
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@workflow/api..." --filter "@workflow/worker..."

# --- рантайм API и воркера -------------------------------------------------
FROM base AS server
ENV NODE_ENV=production

# Каталог хранилища создаётся заранее и с нужным владельцем: docker инициализирует
# пустой именованный том содержимым и правами этого пути образа. Без chown том
# достался бы root, а процесс работает от `node` и не смог бы писать картинки.
RUN mkdir -p /app/data/files && chown -R node:node /app/data

# node_modules pnpm — дерево симлинков на `.pnpm`; ссылки относительные, поэтому
# переживают копирование, если сохранить раскладку каталогов один в один
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/packages/contracts/node_modules packages/contracts/node_modules
COPY --from=prod-deps /app/packages/core/node_modules packages/core/node_modules
COPY --from=prod-deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=prod-deps /app/apps/worker/node_modules apps/worker/node_modules

# манифесты нужны и в рантайме: по ним node резолвит `main` и `exports` workspace-пакетов
COPY package.json pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/

COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist

# SQL-миграции не компилируются, но нужны рантайму: `runMigrations` читает их
# из `apps/api/drizzle` относительно собственного файла
COPY apps/api/drizzle apps/api/drizzle

USER node
EXPOSE 3000
# команда по умолчанию — API; воркер запускается тем же образом с другой командой
CMD ["node", "apps/api/dist/server.js"]

# --- сборка фронтенда ------------------------------------------------------
FROM build AS web-build
# VITE_* вшиваются в бандл на этапе сборки, а не читаются в рантайме. Поэтому
# адрес API здесь сознательно НЕ задаётся: `API_BASE_URL` по умолчанию `/api`,
# то есть относительный, и один и тот же бандл работает на любом хосте —
# запросы уводит на бэкенд nginx, раздающий эту же статику.
RUN pnpm --filter @workflow/web build

# --- раздача фронтенда -----------------------------------------------------
FROM nginx:1.29-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
