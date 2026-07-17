// akash multiplayer relay — plain WebSocket rooms + anonymous auth.
// CloudFront terminates TLS on its free *.cloudfront.net subdomain and
// proxies here over plain HTTP, so this binds 0.0.0.0 (the security group
// only admits CloudFront + SSH).
//
// HTTP:
//   GET  /                      health
//   ANY  /api/auth/*            better-auth (anonymous sign-in, sessions,
//                               update-user). CloudFront strips Authorization
//                               when caching is disabled, so clients send the
//                               bearer token as x-auth-token; shimmed below.
//   POST /ws-ticket             session → single-use, 30s, HMAC-signed
//                               connection ticket carrying {uid, name, color}
// WebSocket (JSON text frames):
//   connect  ws(s)://host/ws?room=<worldCode>&ticket=<ticket>
//   server → {t:'hello', id, peers:[{id, p, name, color}...]}  (p may be null)
//   server → {t:'join', id, name, color}           someone arrived
//   client → [x, y, z, yaw, pitch, roll]           pose, ~10Hz while flying
//   server → {t:'p', id, p:[...]}                  someone's pose, fanned out
//   server → {t:'bye', id}                         someone left
//
// Auth model (the standard ticket pattern for websockets): the session token
// only ever travels in headers over HTTPS. To open a socket the client mints
// a ticket — one session lookup there, none in the ws path — and the ticket
// is verified and CONSUMED at the HTTP upgrade, so a bad one is a plain 401
// before any socket exists, and a logged one is already useless.
// Identity comes from the ticket (i.e. the authenticated user record), never
// from the wire, and each user gets one live connection per room (a new one
// supersedes the old). Poses are presence-only: no authority, no persistence.
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { toNodeHandler } = require('better-auth/node');
const { auth } = require('./auth');

const TICKET_SECRET = crypto.createHash('sha256')
  .update(`akash-ws-ticket:${process.env.BETTER_AUTH_SECRET || 'dev-only-secret-change-me'}`)
  .digest();
const TICKET_TTL_MS = 30_000;
const usedTickets = new Map(); // jti → expiry, swept periodically

function mintTicket(user) {
  const payload = Buffer.from(JSON.stringify({
    uid: user.id,
    name: user.name === 'Anonymous' ? '' : (user.name || '').trim().slice(0, 14),
    color: /^#[0-9a-f]{6}$/i.test(user.color || '') ? user.color.toLowerCase() : null,
    exp: Date.now() + TICKET_TTL_MS,
    jti: crypto.randomBytes(9).toString('base64url'),
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', TICKET_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function consumeTicket(ticket) {
  const [payload, sig] = String(ticket || '').split('.');
  if (!payload || !sig) return null;
  const want = crypto.createHmac('sha256', TICKET_SECRET).update(payload).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(want, got)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url')); } catch { return null; }
  if (!data.uid || data.exp < Date.now() || usedTickets.has(data.jti)) return null;
  usedTickets.set(data.jti, data.exp);
  return data;
}

const PORT = process.env.PORT || 8765;
const MAX_ROOM = 24;      // pilots per sky
const MAX_MSG = 512;      // bytes; poses are ~60
const REAP_MS = 60_000;   // no pose and no pong for this long → gone

const rooms = new Map(); // room → Map<connId, {ws, uid, pose, seen, name, color}>
const authHandler = toNodeHandler(auth);

const CORS_HEADERS = {
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-auth-token',
  'access-control-expose-headers': 'set-auth-token',
  'access-control-max-age': '86400',
};

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('access-control-allow-origin', origin);
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  // CloudFront eats Authorization; clients send x-auth-token instead.
  if (req.headers['x-auth-token'] && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.headers['x-auth-token']}`;
  }
  if (req.url.startsWith('/api/auth/')) {
    return authHandler(req, res);
  }
  if (req.url === '/ws-ticket' && req.method === 'POST') {
    auth.api.getSession({ headers: new Headers(req.headers) })
      .then((session) => {
        if (!session?.user) {
          res.writeHead(401, { 'content-type': 'application/json' });
          return res.end('{"error":"no session"}');
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ticket: mintTicket(session.user) }));
      })
      .catch(() => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":"ticket mint failed"}');
      });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('akash relay ok\n');
});

// noServer: the upgrade is gated by ticket verification — invalid tickets
// get an HTTP 401 and never become a socket.
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://relay');
  const roomKey = (url.searchParams.get('room') || '').slice(0, 64);
  const ident = consumeTicket(url.searchParams.get('ticket'));
  if (url.pathname !== '/ws' || !roomKey || !ident) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, roomKey, ident);
  });
});

function broadcast(room, exceptId, msg) {
  const data = JSON.stringify(msg);
  for (const [id, peer] of room) {
    if (id !== exceptId && peer.ws.readyState === 1) peer.ws.send(data);
  }
}

wss.on('connection', (ws, roomKey, ident) => {
  const { uid, name, color } = ident;

  let room = rooms.get(roomKey);
  if (!room) rooms.set(roomKey, (room = new Map()));

  // Each connection is its own drone (two tabs = two drones — identity is
  // still ticket-authenticated, which is the part that matters). A small
  // per-pilot cap keeps one browser from filling a sky.
  let mine = 0;
  for (const peer of room.values()) if (peer.uid === uid) mine++;
  if (mine >= 3) return ws.close(4002, 'too many tabs');
  if (room.size >= MAX_ROOM) return ws.close(4001, 'room full');

  const id = `${uid.slice(0, 8)}:${crypto.randomBytes(3).toString('hex')}`;
  const me = { ws, uid, pose: null, seen: Date.now(), name, color };
  room.set(id, me);

  ws.send(JSON.stringify({
    t: 'hello',
    id,
    peers: [...room].filter(([pid]) => pid !== id)
      .map(([pid, p]) => ({ id: pid, p: p.pose, name: p.name, color: p.color })),
  }));
  broadcast(room, id, { t: 'join', id, name, color });

  ws.on('message', (buf, isBinary) => {
    if (isBinary) return;
    let pose;
    try { pose = JSON.parse(buf); } catch { return; }
    if (!Array.isArray(pose) || pose.length !== 6 || !pose.every(Number.isFinite)) return;
    me.pose = pose;
    me.seen = Date.now();
    broadcast(room, id, { t: 'p', id, p: pose });
  });

  ws.on('pong', () => { me.seen = Date.now(); });

  ws.on('close', () => {
    room.delete(id);
    if (room.size === 0) rooms.delete(roomKey);
    else broadcast(room, id, { t: 'bye', id });
  });

  ws.on('error', () => ws.terminate());
});

// Keepalive + reaper: ping everyone, drop the silent, sweep dead tickets.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const peer of room.values()) {
      if (now - peer.seen > REAP_MS) peer.ws.terminate();
      else if (peer.ws.readyState === 1) peer.ws.ping();
    }
  }
  for (const [jti, exp] of usedTickets) {
    if (exp < now) usedTickets.delete(jti);
  }
}, 25_000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`akash relay listening on ${PORT}`);
});
