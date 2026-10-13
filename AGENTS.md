# Repository Guidelines

## Project Structure & Module Organization

- `frontend/`: Next.js App Router web application. Routes live in `frontend/app/`, shared UI in `frontend/components/`, API helpers in `frontend/lib/`, and static files in `frontend/public/`.
- `backend/`: Express API. Routes and services are in `backend/src/`; operational scripts are in `backend/scripts/`.
- `miniprogram/`: native WeChat Mini Program. Keep pages under `pages/`, reusable widgets under `components/`, HTTP calls under `services/`, and normalization helpers under `utils/`.
- `database/schema.sql` defines PostgreSQL; `test-data/` contains local seeds and fixtures.
- `docs/` holds PRDs, designs, and incident notes. Read the relevant root README first.

## Build, Test, and Development Commands

```bash
npm run install:all       # install backend and frontend dependencies
npm run dev               # start API on :3000 and web app on :3001
npm run db:init           # initialize the local PostgreSQL schema
npm start --prefix backend
npm run build --prefix frontend
```

Open `miniprogram/` in WeChat DevTools. Run production builds only when the change or request requires one.

## Coding Style & Naming Conventions

Use ES modules, two-space indentation, semicolons, and single quotes in JavaScript. Name React components in `PascalCase`, variables in `camelCase`, and constants in `UPPER_SNAKE_CASE`. Put page-private styles in colocated `*.module.css`; reserve `frontend/app/design-system.css` for shared patterns. Mini Program pages retain the `index.js`, `index.wxml`, `index.wxss`, and `index.json` quartet. Route Mini Program HTTP traffic through `services/request.js`.

## Testing Guidelines

No automated test runner or coverage threshold is configured. Validate the smallest affected surface: use `node --check` for backend scripts, exercise API paths locally, and inspect UI changes in the browser or WeChat DevTools. Record manual scenarios in the pull request. Do not claim device or production verification unless performed.

## Commit & Pull Request Guidelines

History uses short, imperative subjects, usually Chinese, with occasional prefixes such as `fix:`. Keep commits focused, for example `修复小程序播放器横屏控制条`. Pull requests should state scope, affected clients, configuration or schema changes, verification, and risks. Link the issue or PRD; include before/after screenshots for visual changes.

## Security & Configuration

Never commit secrets, real account data, or production `.env` files. Keep API base URLs and credentials in the established configuration layer. Treat cleanup, reset, storage, and seed scripts as destructive: confirm the target environment before running them.
