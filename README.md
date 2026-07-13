# 타일 서바이벌 (Survival Tile)

Real-time multiplayer "last tile standing" browser game built on Phaser 3 + Socket.io. Players spawn on a grid of hex tiles that collapse when stepped on; survivors advance through a tournament bracket that culminates in boss fights.

## Quick start

```
npm install
npm run build   # NODE_OPTIONS=--openssl-legacy-provider npm run build   (Node 17+)
npm start
```

`PORT` controls the listen port (defaults to an OS-assigned port if unset). `ADMIN_PASSWORD` controls the admin password (defaults to `3927`) — entering it on the login screen unlocks starting the tournament, adding test bots, and the multi-room admin dashboard.

## Development

```
npm run client   # webpack --watch for the client bundle
npm run server   # webpack --watch for the server bundle, restarts on change
npm run lint     # eslint
```

See `CLAUDE.md` for full architecture notes (server-authoritative design, tournament bracket model, socket protocol, admin mode, deployment).
