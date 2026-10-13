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

## Mini Program Cross-Platform UI Rules

Treat Android and iOS as separate native renderers, especially inside `video`, `cover-view`, `cover-image`, `slider`, and fullscreen layers:

- Do not mix `rpx` and fixed `px` inside one fullscreen control tree. Use fixed `px` for landscape fullscreen descendants and explicitly account for `env(safe-area-inset-*)`; keep `rpx` for ordinary page layout.
- Do not use Unicode glyphs as player icons. Use local PNG assets or simple, tested primitives. Native-layer overlays must keep popups as direct children of the control layer, never absolutely positioned inside a flex button group.
- Do not rely on `overflow: visible` for iOS `cover-view`. Size fullscreen popup and control-layer bounds together so every popup edge remains inside its native overlay parent; prefer a compact single-row option layout in landscape.
- Do not measure elements nested inside native `video` with `createSelectorQuery()` as the only source of geometry. Provide deterministic viewport/safe-area fallback coordinates for seek and popup placement.
- Keep playback controls reachable after auto-hide; fullscreen must not rely on a video tap being dispatched back to the page to restore controls. In-player menus such as speed selection must be tested in both windowed and fullscreen modes.
- Before merging Mini Program UI changes, run a matrix on WeChat DevTools plus one iPhone and one Android device: windowed/fullscreen, notch/safe area, tap and drag, keyboard/input, popup open/close, and rotation. Static checks do not count as device verification.

## Commit & Pull Request Guidelines

History uses short, imperative subjects, usually Chinese, with occasional prefixes such as `fix:`. Keep commits focused, for example `修复小程序播放器横屏控制条`. Pull requests should state scope, affected clients, configuration or schema changes, verification, and risks. Link the issue or PRD; include before/after screenshots for visual changes.

## Security & Configuration

Never commit secrets, real account data, or production `.env` files. Keep API base URLs and credentials in the established configuration layer. Treat cleanup, reset, storage, and seed scripts as destructive: confirm the target environment before running them.
