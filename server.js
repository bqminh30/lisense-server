const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const APP_ID = 'amz-us-app';
const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || 'dev-admin-token');
const MONGODB_URI = String(process.env.MONGODB_URI || '').trim();
const MONGODB_DB_NAME = String(process.env.MONGODB_DB_NAME || 'amz_license').trim();

const rootDir = __dirname;
const keysDir = path.join(rootDir, 'keys');
const privateKeyPath = path.join(keysDir, 'private.pem');
const publicKeyPath = path.join(keysDir, 'public.pem');

let mongoClientPromise = global.__amzLicenseMongoClientPromise;
let mongoDbPromise = global.__amzLicenseMongoDbPromise;
let indexesPromise = global.__amzLicenseMongoIndexesPromise;

function ensureDirs() {
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

function normalizeCode(value) {
  return String(value || '').trim();
}

function normalizePem(value) {
  return String(value || '')
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/^['"]|['"]$/g, '');
}

function buildCodeDoc(input) {
  const now = input.createdAt || Date.now();
  return {
    code: normalizeCode(input.code),
    appId: String(input.appId || APP_ID).trim(),
    durationMs: Number(input.durationMs || 0),
    note: String(input.note || '').trim(),
    createdAt: now,
    boundMachineId: normalizeCode(input.boundMachineId || input.machineId) || null,
    used: Boolean(input.used),
    usedAt: input.usedAt || null,
    usedBy: input.usedBy || null,
    activation: input.activation || null
  };
}

function signLicense(privateKey, payload) {
  const normalizedPrivateKey = normalizePem(privateKey);
  if (!normalizedPrivateKey) {
    throw new Error('PRIVATE_KEY_MISSING');
  }

  try {
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(payloadB64, 'utf8');
    signer.end();
    const signatureB64 = signer.sign(normalizedPrivateKey).toString('base64');
    return { payloadB64, signatureB64 };
  } catch (error) {
    throw new Error('LICENSE_PRIVATE_KEY_PEM_INVALID_FORMAT');
  }
}

async function getMongoClient() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI_MISSING');
  }

  if (!mongoClientPromise) {
    const client = new MongoClient(MONGODB_URI);
    mongoClientPromise = client.connect();
    global.__amzLicenseMongoClientPromise = mongoClientPromise;
  }

  return mongoClientPromise;
}

async function getMongoDb() {
  if (!mongoDbPromise) {
    mongoDbPromise = getMongoClient().then((client) => client.db(MONGODB_DB_NAME));
    global.__amzLicenseMongoDbPromise = mongoDbPromise;
  }

  return mongoDbPromise;
}

async function getCodesCollection() {
  const db = await getMongoDb();
  return db.collection('codes');
}

async function ensureIndexes() {
  if (!indexesPromise) {
    indexesPromise = (async () => {
      const collection = await getCodesCollection();
      await collection.createIndex({ code: 1 }, { unique: true });
    })();
    global.__amzLicenseMongoIndexesPromise = indexesPromise;
  }

  return indexesPromise;
}

async function listCodes() {
  await ensureIndexes();
  const collection = await getCodesCollection();
  return collection.find({}).sort({ createdAt: -1 }).toArray();
}

async function loadCode(code) {
  await ensureIndexes();
  const collection = await getCodesCollection();
  return collection.findOne({ code: normalizeCode(code) });
}

async function saveCode(codeData) {
  await ensureIndexes();
  const collection = await getCodesCollection();
  const doc = buildCodeDoc(codeData);
  const result = await collection.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function claimCode(code, machineId, hostname, platform) {
  await ensureIndexes();
  const collection = await getCodesCollection();
  const normalizedCode = normalizeCode(code);
  const normalizedMachineId = normalizeCode(machineId);
  const current = await collection.findOne({ code: normalizedCode });
  const now = Date.now();

  if (!current) return { status: 'not_found' };
  if (current.appId && current.appId !== APP_ID) return { status: 'app_mismatch' };
  if (current.boundMachineId && current.boundMachineId !== normalizedMachineId) {
    return { status: 'machine_mismatch', current };
  }
  if (current.activation?.expiresAt && Number(current.activation.expiresAt) <= now) {
    return { status: 'expired', current };
  }
  if (current.used) {
    if (current.usedBy?.machineId && current.usedBy.machineId === normalizedMachineId && current.activation) {
      return { status: 'reuse_same_machine', current };
    }
    return { status: 'already_used', current };
  }

  const activation = {
    issuedAt: now,
    expiresAt: now + Number(current.durationMs || 0)
  };

  const result = await collection.findOneAndUpdate(
    {
      code: normalizedCode,
      appId: APP_ID,
      used: false
    },
    {
      $set: {
        used: true,
        usedAt: now,
        usedBy: { machineId: normalizedMachineId, hostname, platform },
        activation
      }
    },
    { returnDocument: 'after' }
  );

  if (!result || !result.value) {
    const fresh = await collection.findOne({ code: normalizedCode });
    if (!fresh) return { status: 'not_found' };
    if (fresh.appId && fresh.appId !== APP_ID) return { status: 'app_mismatch' };
    if (fresh.boundMachineId && fresh.boundMachineId !== normalizedMachineId) {
      return { status: 'machine_mismatch', current: fresh };
    }
    if (fresh.activation?.expiresAt && Number(fresh.activation.expiresAt) <= now) {
      return { status: 'expired', current: fresh };
    }
    if (fresh.used) {
      if (fresh.usedBy?.machineId && fresh.usedBy.machineId === normalizedMachineId && fresh.activation) {
        return { status: 'reuse_same_machine', current: fresh };
      }
      return { status: 'already_used', current: fresh };
    }
    return { status: 'conflict' };
  }

  return { status: 'claimed', code: result.value };
}

async function handleRequest(req, res, keys) {
  const { privateKey, publicKey } = keys;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname.replace(/^\/api/, '') || '/';

  if (req.method === 'GET' && (pathname === '/health' || pathname === '/')) {
    return sendJson(res, 200, {
      ok: true,
      appId: APP_ID,
      port: PORT,
      storage: 'mongo'
    });
  }

  if (req.method === 'GET' && pathname === '/public-key') {
    return sendJson(res, 200, {
      ok: true,
      publicKey
    });
  }

  if (req.method === 'GET' && pathname === '/admin/codes') {
    if (!authAdmin(req)) {
      return sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED' });
    }

    const codes = await listCodes();
    return sendJson(res, 200, {
      ok: true,
      codes
    });
  }

  if (req.method === 'POST' && pathname === '/admin/codes') {
    if (!authAdmin(req)) {
      return sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED' });
    }

    const body = await readJson(req);
    const code = String(body.code || '').trim();
    const durationMs = parseDurationMs(body.durationMs || body.duration || body.plan);
    const appId = String(body.appId || APP_ID).trim();
    const note = String(body.note || '').trim();
    const boundMachineId = String(body.boundMachineId || body.machineId || '').trim();

    if (!code) {
      return sendJson(res, 400, { ok: false, error: 'CODE_REQUIRED' });
    }
    if (!durationMs) {
      return sendJson(res, 400, { ok: false, error: 'DURATION_REQUIRED' });
    }

    const existing = await loadCode(code);
    if (existing) {
      return sendJson(res, 409, { ok: false, error: 'CODE_ALREADY_EXISTS' });
    }

    try {
      const created = await saveCode({
        code,
        appId,
        durationMs,
        note,
        boundMachineId: boundMachineId || null
      });

      return sendJson(res, 201, {
        ok: true,
        code: created
      });
    } catch (error) {
      if (error?.code === 11000) {
        return sendJson(res, 409, { ok: false, error: 'CODE_ALREADY_EXISTS' });
      }
      throw error;
    }
  }

  if (req.method === 'POST' && pathname === '/activate') {
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

    const privateKeyPem = String(process.env.LICENSE_PRIVATE_KEY_PEM || '').trim();
    if (!privateKeyPem) {
      return sendJson(res, 500, { ok: false, error: 'PRIVATE_KEY_MISSING' });
    }

    const claim = await claimCode(code, machineId, hostname, platform);
    if (claim.status === 'not_found') {
      return sendJson(res, 404, { ok: false, error: 'CODE_NOT_FOUND' });
    }
    if (claim.status === 'app_mismatch') {
      return sendJson(res, 400, { ok: false, error: 'CODE_APP_MISMATCH' });
    }
    if (claim.status === 'machine_mismatch') {
      return sendJson(res, 400, {
        ok: false,
        error: 'CODE_MACHINE_MISMATCH',
        boundMachineId: claim.current?.boundMachineId || null,
        currentMachineId: machineId
      });
    }
    if (claim.status === 'expired') {
      return sendJson(res, 410, {
        ok: false,
        error: 'LICENSE_EXPIRED',
        expiresAt: claim.current?.activation?.expiresAt || null
      });
    }
    if (claim.status === 'already_used') {
      return sendJson(res, 409, {
        ok: false,
        error: 'CODE_ALREADY_USED',
        usedAt: claim.current?.usedAt || null,
        usedBy: claim.current?.usedBy || null
      });
    }
    if (claim.status === 'reuse_same_machine') {
      const payload = {
        appId: APP_ID,
        codeId: claim.current.code,
        machineId,
        issuedAt: claim.current.activation?.issuedAt,
        expiresAt: claim.current.activation?.expiresAt,
        hostname,
        platform
      };

      const license = signLicense(privateKeyPem, payload);

      return sendJson(res, 200, {
        ok: true,
        license,
        payload,
        reused: true
      });
    }
    if (claim.status !== 'claimed' || !claim.code) {
      return sendJson(res, 409, { ok: false, error: 'ACTIVATION_CONFLICT' });
    }

    const payload = {
      appId: APP_ID,
      codeId: claim.code.code,
      machineId,
      issuedAt: claim.code.activation.issuedAt,
      expiresAt: claim.code.activation.expiresAt,
      hostname,
      platform
    };

    const license = signLicense(privateKeyPem, payload);

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
      sendJson(res, 500, {
        ok: false,
        error: 'INTERNAL_ERROR',
        message: error?.message || String(error)
      });
    });
  });

  server.listen(PORT, () => {
    console.log(`License server running on http://127.0.0.1:${PORT}`);
    console.log(`Admin token: ${ADMIN_TOKEN}`);
    console.log(`Storage: mongo`);
    console.log(`Mongo DB: ${MONGODB_DB_NAME}`);
  });
}

main().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});
