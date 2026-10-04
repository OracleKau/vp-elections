# Oracle Club — VP Elections

One-page voting site for the Oracle Club KAU Vice-President election. Zero-dependency Node server with SQLite (built-in `node:sqlite`).

## Run locally
```bash
ADMIN_KEY=change-me npm start   # http://localhost:3000
```

## Deploy on Coolify
- Build pack: **Dockerfile** · Port: **3000**
- Env: `ADMIN_KEY=<secret>` (required for the results dashboard)
- Persistent storage: mount a volume at **`/app/data`** (holds `votes.db`), or votes are lost on redeploy.

## Pages
- `/` — ballot
- `/results` — live results + open/close voting (asks for `ADMIN_KEY`)

## One vote per device
Each device gets an HttpOnly cookie **and** a localStorage ID, and both are unique in the DB, so a vote is blocked if either one matches. A hashed IP and a browser fingerprint are stored for audit only. They don't block votes, because everyone on venue Wi-Fi shares an IP and identical phones share fingerprints. A private/incognito window starts with no cookie or ID, so it can vote again. That's the limit of device-based voting without logins.

## Candidates
Edit `CANDIDATES` in `server.js`.
