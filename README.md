# Math Dungeon Online

Multiplayer classroom math RPG built with Node.js, Express and Socket.IO.

## Local run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Teacher panel: `http://localhost:3000/admin`

Default local admin key: `TEACHER-2026` unless `ADMIN_KEY` is set.

## Render

This repository is Render-ready. `package.json`, `render.yaml`, and `.node-version` are all at the repository root.

If creating the service manually:

- Runtime: Node
- Root Directory: leave blank
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- Environment Variable: `ADMIN_KEY` = your teacher key

Do not commit `.env` or `node_modules`.
