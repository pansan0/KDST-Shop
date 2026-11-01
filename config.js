// Loads .env (if present) without extra dependencies, then exposes typed config.
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
module.exports = {
  PORT: Number(env.PORT) || 3000,
  SESSION_SECRET: env.SESSION_SECRET || 'dev-only-change-this-secret',
  COOKIE_SECURE: env.COOKIE_SECURE === '1',
  ADMIN_INVITE_CODE: env.ADMIN_INVITE_CODE || '',
  ADMIN_EMAIL: env.ADMIN_EMAIL || 'admin@inkfold.local',
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || 'admin12345',
  SEED_DEMO: env.SEED_DEMO !== '0',
  DATA_DIR: path.resolve(__dirname, env.DATA_DIR || 'storage'),
  MAX_PDF_MB: Number(env.MAX_PDF_MB) || 200,
  MAX_IMAGE_MB: Number(env.MAX_IMAGE_MB) || 20,
};
