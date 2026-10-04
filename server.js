// Oracle Club — Vice President election server.
// Zero dependencies: Node >= 22.13 (built-in node:sqlite).
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

export const CANDIDATES = [
  { id: 'remass-ashmawi', name: 'Remass Ashmawi' },
  { id: 'abdulaziz-alqayn', name: 'Abdulaziz Alqayn' },
  { id: 'ahmed-alghmdi', name: 'Ahmed Alghmdi' },
  { id: 'mohammed-justanieah', name: 'Mohammed Justanieah' },
  { id: 'maher-bajaber', name: 'Maher Bajaber' },
];
const CANDIDATE_IDS = new Set(CANDIDATES.map((c) => c.id));

await mkdir(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'votes.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS votes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate   TEXT NOT NULL,
    device_id   TEXT NOT NULL UNIQUE,
    client_id   TEXT NOT NULL UNIQUE,
    fingerprint TEXT,
    ip_hash     TEXT,
    user_agent  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT OR IGNORE INTO settings (key, value) VALUES ('voting_open', '1');
`);

const q = {
  byDevice: db.prepare('SELECT candidate FROM votes WHERE device_id = ? OR client_id = ? LIMIT 1'),
  insert: db.prepare(
    'INSERT INTO votes (candidate, device_id, client_id, fingerprint, ip_hash, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  tally: db.prepare('SELECT candidate, COUNT(*) AS votes FROM votes GROUP BY candidate'),
  total: db.prepare('SELECT COUNT(*) AS n FROM votes'),
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
};

const votingOpen = () => q.getSetting.get('voting_open')?.value === '1';

// ---------- helpers ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((p) => p.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
  );
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

const isUuid = (s) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
const sha = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 32);

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

function deviceCookie(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  let id = cookies.ovid;
  if (!isUuid(id)) {
    id = randomUUID();
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `ovid=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`);
  }
  return id;
}

function isAdmin(req) {
  if (!ADMIN_KEY) return false;
  const given = Buffer.from(String(req.headers['x-admin-key'] || ''));
  const want = Buffer.from(ADMIN_KEY);
  return given.length === want.length && timingSafeEqual(given, want);
}

function results() {
  const counts = Object.fromEntries(q.tally.all().map((r) => [r.candidate, r.votes]));
  return {
    open: votingOpen(),
    total: q.total.get().n,
    candidates: CANDIDATES.map((c) => ({ ...c, votes: counts[c.id] || 0 })),
  };
}

// ---------- routes ----------
async function handleApi(req, res, url) {
  if (url.pathname === '/api/status' && req.method === 'GET') {
    const deviceId = deviceCookie(req, res);
    const clientId = url.searchParams.get('cid') || '';
    const row = q.byDevice.get(deviceId, isUuid(clientId) ? clientId : deviceId);
    return json(res, 200, { open: votingOpen(), voted: !!row, candidate: row?.candidate || null, candidates: CANDIDATES });
  }

  if (url.pathname === '/api/vote' && req.method === 'POST') {
    const deviceId = deviceCookie(req, res);
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid request.' }); }
    const { candidate, clientId, fingerprint } = body;

    if (!votingOpen()) return json(res, 403, { error: 'Voting is closed.' });
    if (!CANDIDATE_IDS.has(candidate)) return json(res, 400, { error: 'Unknown candidate.' });
    if (!isUuid(clientId)) return json(res, 400, { error: 'Invalid device.' });

    const existing = q.byDevice.get(deviceId, clientId);
    if (existing) return json(res, 409, { error: 'This device has already voted.', candidate: existing.candidate });

    try {
      q.insert.run(
        candidate, deviceId, clientId,
        typeof fingerprint === 'string' ? fingerprint.slice(0, 64) : null,
        sha(clientIp(req)),
        String(req.headers['user-agent'] || '').slice(0, 300)
      );
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return json(res, 409, { error: 'This device has already voted.' });
      throw e;
    }
    return json(res, 200, { ok: true, candidate });
  }

  if (url.pathname === '/api/results' && req.method === 'GET') {
    if (!isAdmin(req)) return json(res, 401, { error: 'Unauthorized.' });
    return json(res, 200, results());
  }

  if (url.pathname === '/api/admin/voting' && req.method === 'POST') {
    if (!isAdmin(req)) return json(res, 401, { error: 'Unauthorized.' });
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid request.' }); }
    q.setSetting.run('voting_open', body.open ? '1' : '0');
    return json(res, 200, results());
  }

  return json(res, 404, { error: 'Not found.' });
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '/results') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  res.end(await readFile(file));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, res, url);
    res.writeHead(405).end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: 'Server error.' });
  }
});

server.listen(PORT, () => {
  console.log(`Oracle VP election running on :${PORT} (db: ${DATA_DIR}/votes.db)`);
  if (!ADMIN_KEY) console.warn('ADMIN_KEY is not set — results dashboard is disabled.');
});
