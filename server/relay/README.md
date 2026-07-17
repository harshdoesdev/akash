# akash multiplayer relay

Plain-WebSocket presence rooms + anonymous pilot identity. One t4g.nano does
everything; CloudFront provides the free TLS hostname the browser needs
(itch.io serves the game over https, so the socket must be wss).

## Architecture

```
browser ──wss/https──▶ CloudFront (d1pksxqb8ts7db.cloudfront.net, free TLS)
                          │  http, port 8765 (SG admits CloudFront + SSH only)
                          ▼
                    EC2 t4g.nano "akash-relay" (us-east-1, EIP 3.95.74.17)
                    node 22 · systemd unit akash-relay
                    ├─ /api/auth/*  better-auth (anonymous + bearer) on
                    │               sqlite via drizzle (data/akash.db)
                    ├─ /ws-ticket   session → single-use 30s HMAC ticket
                    └─ /ws          rooms; ticket consumed at HTTP upgrade
```

- **Auth model**: the session token never rides a ws URL. Clients mint a
  single-use, 30-second ticket over HTTPS (one DB lookup there), and the
  upgrade handler verifies + consumes it — bad tickets die as HTTP 401
  before a socket exists. Identity (user id, name, color) is embedded in
  the ticket from the authenticated user record, never taken from the wire.
- **CloudFront strips `Authorization`** when caching is disabled, so clients
  send the bearer token as `x-auth-token`; the server shims it back.
- **Rooms** are world codes. One live connection per user per room (a new
  one supersedes the old). Poses are presence-only, nothing persists;
  restarting the relay just empties the sky.

## AWS resources (account 545063353013, us-east-1)

| thing            | id                                       |
| ---------------- | ---------------------------------------- |
| instance         | `i-07caa156d2cc449dc` (t4g.nano, AL2023) |
| elastic ip       | `eipalloc-0dc7e84b1a9815977` → 3.95.74.17 |
| security group   | `sg-0ecc3bd91cd709f31` (22 world, 8765 CloudFront prefix list only) |
| cloudfront       | `E1G8E5BGI73GRA` → d1pksxqb8ts7db.cloudfront.net |
| key pair         | `akash-relay` → `~/.ssh/akash-relay.pem` |

Cost ≈ $7.4/mo (nano $3.06 + 8 GB gp3 $0.64 + public IPv4 $3.65 +
CloudFront free tier).

## Deploy

```sh
bash server/relay/deploy.sh          # scp sources, npm install, restart
```

Secrets live in `/opt/akash-relay/.env` on the box (BETTER_AUTH_SECRET is
minted once by deploy.sh; deleting it invalidates every session).
`user-data.sh` is the cloud-init bootstrap used when creating a fresh box.

## Local dev

```sh
cd server/relay && npm install
DB_PATH=/tmp/akash-dev.db node server.js         # relay on :8765
VITE_AKASH_RELAY=http://127.0.0.1:8765 npm run dev   # game against it
```
