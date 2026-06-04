const { MongoClient } = require('mongodb');

const APP_ID = 'amz-us-app';
const MONGODB_URI = String(process.env.MONGODB_URI || '').trim();
const MONGODB_DB_NAME = String(process.env.MONGODB_DB_NAME || 'amz_license').trim();

function parseDurationMs(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;

  const direct = Number(raw);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const match = raw.match(/^(\d+)\s*(h|d|w|m)$/);
  if (!match) return null;

  const n = Number(match[1]);
  const unit = match[2];
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

function buildCodeDoc(input) {
  const now = Date.now();
  return {
    code: normalizeCode(input.code),
    appId: String(input.appId || APP_ID).trim(),
    durationMs: Number(input.durationMs || 0),
    note: String(input.note || '').trim(),
    createdAt: now,
    used: false,
    usedAt: null,
    usedBy: null,
    activation: null
  };
}

async function getCollection() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI_MISSING');
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB_NAME);
  const collection = db.collection('codes');
  await collection.createIndex({ code: 1 }, { unique: true });
  return { client, collection };
}

function usage() {
  console.log('Usage: node license-server/tools/create-code.js <CODE> <DURATION> [NOTE]');
  console.log('Examples:');
  console.log('  node license-server/tools/create-code.js 123Abc 12h');
  console.log('  node license-server/tools/create-code.js 888XYZ 3d "client A"');
  process.exit(1);
}

async function main() {
  const code = String(process.argv[2] || '').trim();
  const durationArg = String(process.argv[3] || '').trim();
  const note = String(process.argv.slice(4).join(' ') || '').trim();

  if (!code || !durationArg) usage();

  const durationMs = parseDurationMs(durationArg);
  if (!durationMs) {
    console.error('Invalid duration. Use values like 12h, 3d, 1m, or milliseconds.');
    process.exit(1);
  }

  const { client, collection } = await getCollection();
  try {
    const existing = await collection.findOne({ code });
    if (existing) {
      console.error(`Code already exists: ${code}`);
      process.exit(1);
    }

    const doc = buildCodeDoc({
      code,
      appId: APP_ID,
      durationMs,
      note
    });

    await collection.insertOne(doc);

    console.log(`Created code: ${code}`);
    console.log(`Duration: ${durationArg} (${durationMs} ms)`);
    if (note) console.log(`Note: ${note}`);
    console.log(`Database: ${MONGODB_DB_NAME}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
