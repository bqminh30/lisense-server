const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP_ID = 'amz-us-app';
const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || 'dev-admin-token');

const rootDir = __dirname;
const dataDir = path.join(rootDir, 'data');
const keysDir = path.join(rootDir, 'keys');
const codesPath = path.join(dataDir, 'codes.json');
const privateKeyPath = path.join(keysDir, 'private.pem');
const publicKeyPath = path.join(keysDir, 'public.pem');

function ensureDirs() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(keysDir, { recursive: true });
}

function loadOrCreateKeyPair() {
  ensureDirs();

  if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
    return {
      privateKey: fs.readFileSync(privateKeyPath, 'utf8'),
      publicKey: fs.readFileSync(publicKeyPath, 'utf8')
    };
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  fs.writeFileSync(privateKeyPath, privateKey, 'utf8');
  fs.writeFileSync(publicKeyPath, publicKey, 'utf8');
  return { privateKey, publicKey };
}

function loadCodes() {
  ensureDirs();
  if (!fs.existsSync(codesPath)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(codesPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveCodes(codes) {
  ensureDirs();
  fs.writeFileSync(codesPath, JSON.stringify(codes, null, 2), 'utf8');
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body, null, 2));
}

function authAdmin(req) {
  return String(req.headers['x-admin-token'] || '') === ADMIN_TOKEN;
}

function findCode(codes, value) {
  return codes.find((item) => item.code === value);
}

function parseDurationMs(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;

  const directNumber = Number(raw);
  if (Number.isFinite(directNumber) && directNumber > 0) {
    return directNumber;
  }

  const match = raw.match(/^(\d+)\s*(h|d|w|m)$/);
  if (!match) return null;

  const n = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(n) || n <= 0) return null;

  const map = {
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    m: 30 * 24 * 60 * 60 * 1000
  };

  return n * map[unit];
}

function signLicense(privateKey, payload) {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(payloadB64, 'utf8');
  signer.end();
  const signatureB64 = signer.sign(privateKey).toString('base64');
  return { payloadB64, signatureB64 };
}

function normalizeCodeItem(item) {
  return {
    code: String(item.code || '').trim(),
    appId: String(item.appId || APP_ID).trim(),
    durationMs: Number(item.durationMs || 0),
    note: String(item.note || '').trim(),
    createdAt: item.createdAt || Date.now(),
    used: Boolean(item.used),
    usedAt: item.usedAt || null,
    usedBy: item.usedBy || null,
    activation: item.activation || null
  };
}

async function handleRequest(req, res, keys) {
  const { privateKey, publicKey } = keys;
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      appId: APP_ID,
      port: PORT
    });
  }

  if (req.method === 'GET' && url.pathname === '/public-key') {
    return sendJson(res, 200, {
      ok: true,
      publicKey
    });
  }

  if (req.method === 'GET' && url.pathname === '/admin/codes') {
    if (!authAdmin(req)) {
      return sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED' });
    }

    const codes = loadCodes().map(normalizeCodeItem);
    return sendJson(res, 200, {
      ok: true,
      codes
    });
  }

  if (req.method === 'POST' && url.pathname === '/admin/codes') {
    if (!authAdmin(req)) {
      return sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED' });
    }

    const body = await readJson(req);
    const code = String(body.code || '').trim();
    const durationMs = parseDurationMs(body.durationMs || body.duration || body.plan);
    const appId = String(body.appId || APP_ID).trim();
    const note = String(body.note || '').trim();

    if (!code) {
      return sendJson(res, 400, { ok: false, error: 'CODE_REQUIRED' });
    }
    if (!durationMs || durationMs <= 0) {
      return sendJson(res, 400, { ok: false, error: 'DURATION_REQUIRED' });
    }

    const codes = loadCodes().map(normalizeCodeItem);
    if (findCode(codes, code)) {
      return sendJson(res, 409, { ok: false, error: 'CODE_ALREADY_EXISTS' });
    }

    const item = normalizeCodeItem({
      code,
      appId,
      durationMs,
      note,
      createdAt: Date.now(),
      used: false,
      usedAt: null,
      usedBy: null,
      activation: null
    });

    codes.push(item);
    saveCodes(codes);

    return sendJson(res, 201, {
      ok: true,
      code: item
    });
  }

  if (req.method === 'POST' && url.pathname === '/activate') {
    const body = await readJson(req);
    const appId = String(body.appId || '').trim();
    const code = String(body.code || '').trim();
    const machineId = String(body.machineId || '').trim();
    const hostname = String(body.hostname || '').trim();
    const platform = String(body.platform || '').trim();

    if (appId !== APP_ID) {
      return sendJson(res, 400, { ok: false, error: 'APP_MISMATCH' });
    }
    if (!code || !machineId) {
      return sendJson(res, 400, { ok: false, error: 'CODE_AND_MACHINE_REQUIRED' });
    }

    const codes = loadCodes().map(normalizeCodeItem);
    const item = findCode(codes, code);

    if (!item) {
      return sendJson(res, 404, { ok: false, error: 'CODE_NOT_FOUND' });
    }
    if (item.appId && item.appId !== APP_ID) {
      return sendJson(res, 400, { ok: false, error: 'CODE_APP_MISMATCH' });
    }
    if (item.used) {
      return sendJson(res, 409, {
        ok: false,
        error: 'CODE_ALREADY_USED',
        usedAt: item.usedAt,
        usedBy: item.usedBy
      });
    }

    const now = Date.now();
    const payload = {
      appId: APP_ID,
      codeId: item.code,
      machineId,
      issuedAt: now,
      expiresAt: now + item.durationMs,
      hostname,
      platform
    };

    const license = signLicense(privateKey, payload);

    item.used = true;
    item.usedAt = now;
    item.usedBy = { machineId, hostname, platform };
    item.activation = {
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt
    };

    saveCodes(codes);

    return sendJson(res, 200, {
      ok: true,
      license,
      payload
    });
  }

  return sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
}

async function main() {
  const keys = loadOrCreateKeyPair();

  const server = http.createServer((req, res) => {
    handleRequest(req, res, keys).catch((error) => {
      console.error('Request error:', error);
      sendJson(res, 500, { ok: false, error: 'INTERNAL_ERROR' });
    });
  });

  server.listen(PORT, () => {
    console.log(`License server running on http://127.0.0.1:${PORT}`);
    console.log(`Admin token: ${ADMIN_TOKEN}`);
    console.log(`Public key saved to: ${publicKeyPath}`);
    console.log(`Codes file: ${codesPath}`);
  });
}

main().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});
