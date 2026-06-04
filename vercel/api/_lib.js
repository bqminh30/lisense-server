import crypto from 'crypto';
import { MongoClient } from 'mongodb';

export const APP_ID = 'amz-us-app';
export const DB_NAME = String(process.env.MONGODB_DB_NAME || 'amz_license').trim();
export const CODES_COLLECTION = 'codes';

let mongoClientPromise = globalThis.__amzMongoClientPromise;
let mongoDbPromise = globalThis.__amzMongoDbPromise;
let indexesPromise = globalThis.__amzMongoIndexesPromise;

export function json(data, init = {}) {
  return Response.json(data, {
    status: init.status || 200,
    headers: {
      'Cache-Control': 'no-store',
      ...(init.headers || {})
    }
  });
}

export function requireAdmin(request) {
  return String(request.headers.get('x-admin-token') || '') === String(process.env.ADMIN_TOKEN || '');
}

export function parseDurationMs(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;

  const direct = Number(raw);
  if (Number.isFinite(direct) && direct > 0) return direct;

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

export function normalizeCode(value) {
  return String(value || '').trim();
}

export function signLicense(privateKeyPem, payload) {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(payloadB64, 'utf8');
  signer.end();
  const signatureB64 = signer.sign(privateKeyPem).toString('base64');
  return { payloadB64, signatureB64 };
}

export function buildCodeDoc(input) {
  const code = normalizeCode(input.code);
  const now = input.createdAt || Date.now();

  return {
    code,
    appId: String(input.appId || APP_ID).trim(),
    durationMs: Number(input.durationMs || 0),
    note: String(input.note || '').trim(),
    createdAt: now,
    used: Boolean(input.used),
    usedAt: input.usedAt || null,
    usedBy: input.usedBy || null,
    activation: input.activation || null
  };
}

export function toPublicCodeDoc(doc) {
  if (!doc) return null;
  const {
    _id,
    ...rest
  } = doc;

  return rest;
}

export async function getMongoClient() {
  const uri = String(process.env.MONGODB_URI || '').trim();
  if (!uri) {
    throw new Error('MONGODB_URI_MISSING');
  }

  if (!mongoClientPromise) {
    const client = new MongoClient(uri);
    mongoClientPromise = client.connect();
    globalThis.__amzMongoClientPromise = mongoClientPromise;
  }

  return mongoClientPromise;
}

export async function getMongoDb() {
  if (!mongoDbPromise) {
    mongoDbPromise = getMongoClient().then((client) => client.db(DB_NAME));
    globalThis.__amzMongoDbPromise = mongoDbPromise;
  }

  return mongoDbPromise;
}

export async function getCodesCollection() {
  const db = await getMongoDb();
  return db.collection(CODES_COLLECTION);
}

export async function ensureMongoIndexes() {
  if (!indexesPromise) {
    indexesPromise = (async () => {
      const collection = await getCodesCollection();
      await collection.createIndex({ code: 1 }, { unique: true });
    })();
    globalThis.__amzMongoIndexesPromise = indexesPromise;
  }

  return indexesPromise;
}

export async function loadCode(code) {
  await ensureMongoIndexes();
  const collection = await getCodesCollection();
  return collection.findOne({ code: normalizeCode(code) });
}

export async function listCodes() {
  await ensureMongoIndexes();
  const collection = await getCodesCollection();
  return collection.find({}).sort({ createdAt: -1 }).toArray();
}

export async function saveCode(codeData) {
  await ensureMongoIndexes();
  const collection = await getCodesCollection();
  const doc = buildCodeDoc(codeData);
  const result = await collection.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function claimCodeForActivation(code, machineId, hostname, platform) {
  await ensureMongoIndexes();
  const collection = await getCodesCollection();
  const normalizedCode = normalizeCode(code);
  const now = Date.now();
  const current = await collection.findOne({ code: normalizedCode });

  if (!current) {
    return { status: 'not_found' };
  }

  if (current.appId && current.appId !== APP_ID) {
    return { status: 'app_mismatch' };
  }

  if (current.used) {
    return {
      status: 'already_used',
      current
    };
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
        usedBy: { machineId, hostname, platform },
        activation
      }
    },
    {
      returnDocument: 'after'
    }
  );

  if (!result || !result.value) {
    const fresh = await collection.findOne({ code: normalizedCode });
    if (!fresh) {
      return { status: 'not_found' };
    }
    if (fresh.used) {
      return {
        status: 'already_used',
        current: fresh
      };
    }
    if (fresh.appId && fresh.appId !== APP_ID) {
      return { status: 'app_mismatch' };
    }
    return { status: 'conflict' };
  }

  return {
    status: 'claimed',
    code: result.value
  };
}
