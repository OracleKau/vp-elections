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
- `/results`: live results, the list of who voted (search, remove one vote, clear all), and open/close voting. Asks for `ADMIN_KEY`. Removing a vote lets that person vote again.

## One vote per device
Voters must enter their full name (first + last); the same name can only vote once (case-insensitive). Each device also gets an HttpOnly cookie **and** a localStorage ID, and both are unique in the DB, so a vote is blocked if either one matches. A hashed IP and a browser fingerprint are stored for audit only. They don't block votes, because everyone on venue Wi-Fi shares an IP and identical phones share fingerprints. A private/incognito window starts with no cookie or ID, so it can vote again, but it still needs a name that hasn't voted, and every name shows up on `/results`.

## Candidates
Edit `CANDIDATES` in `server.js`.
