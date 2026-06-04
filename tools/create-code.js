const fs = require('fs');
const path = require('path');

const APP_ID = 'amz-us-app';
const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const codesPath = path.join(dataDir, 'codes.json');

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

function loadCodes() {
  if (!fs.existsSync(codesPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(codesPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveCodes(codes) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(codesPath, JSON.stringify(codes, null, 2), 'utf8');
}

function usage() {
  console.log('Usage: node license-server/tools/create-code.js <CODE> <DURATION> [NOTE]');
  console.log('Examples:');
  console.log('  node license-server/tools/create-code.js 123Abc 12h');
  console.log('  node license-server/tools/create-code.js 123Abc 3d "client A"');
  process.exit(1);
}

const code = String(process.argv[2] || '').trim();
const durationArg = String(process.argv[3] || '').trim();
const note = String(process.argv.slice(4).join(' ') || '').trim();

if (!code || !durationArg) usage();

const durationMs = parseDurationMs(durationArg);
if (!durationMs) {
  console.error('Invalid duration. Use values like 12h, 3d, 1m, or milliseconds.');
  process.exit(1);
}

const codes = loadCodes();
if (codes.some((item) => String(item.code || '').trim() === code)) {
  console.error(`Code already exists: ${code}`);
  process.exit(1);
}

codes.push({
  code,
  appId: APP_ID,
  durationMs,
  note,
  createdAt: Date.now(),
  used: false,
  usedAt: null,
  usedBy: null,
  activation: null
});

saveCodes(codes);

console.log(`Created code: ${code}`);
console.log(`Duration: ${durationArg} (${durationMs} ms)`);
if (note) console.log(`Note: ${note}`);
console.log(`Saved to: ${codesPath}`);
