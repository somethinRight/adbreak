# Schedule Builder (Vite + React + Afterglow)

UI is built with the [Afterglow](https://afterglow.thebuilder.dk) shadcn registry (Base UI, CRT terminal theme).

## Setup

    npm install
    npx shadcn@latest add @afterglow/button @afterglow/input @afterglow/label @afterglow/textarea \
      @afterglow/select @afterglow/tabs @afterglow/card @afterglow/badge @afterglow/progress
    npm run dev

`components.json` already registers the `@afterglow` namespace and sets `tsx: true`, so the CLI copies
`.tsx` files into `src/components/ui/` and merges the theme into `src/index.css`.

Change the screen colour with `<html data-phosphor="orange">` (green, orange, yellow, cyan, blue, magenta, red, grey).

## Layout

- `src/schedule.ts` scheduling logic (no React). `buildRun(schedule, library)` returns the timed run.
- `src/library.ts` sample media library. Replace it with a fetch from your media server.
- `src/components/Pick.jsx` thin wrapper over Afterglow's Select taking `[{ value, label }]`.
