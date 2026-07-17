// better-auth wiring: anonymous sessions over a sqlite db via drizzle.
// Anonymous auth gives every browser a stable, token-protected user id —
// pilot identity (name/color) lives on the user record, so nobody can wear
// someone else's name by just claiming it on the wire.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { betterAuth } = require('better-auth');
const { drizzleAdapter } = require('better-auth/adapters/drizzle');
const { anonymous, bearer } = require('better-auth/plugins');
const schema = require('./schema');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'akash.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.exec(schema.DDL);

const db = drizzle(sqlite, { schema });

const auth = betterAuth({
  baseURL: process.env.AUTH_BASE_URL || 'https://d1pksxqb8ts7db.cloudfront.net',
  secret: process.env.BETTER_AUTH_SECRET || 'dev-only-secret-change-me',
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  plugins: [anonymous(), bearer()],
  user: {
    additionalFields: {
      color: { type: 'string', required: false, input: true },
    },
  },
  trustedOrigins: [
    'http://localhost:5173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4173',
    'https://html.itch.zone',
    'https://itch.io',
  ],
  advanced: {
    disableCSRFCheck: false,
  },
});

module.exports = { auth };
