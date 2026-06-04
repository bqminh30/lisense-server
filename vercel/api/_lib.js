import crypto from 'crypto';
import { put, list } from '@vercel/blob';

export const APP_ID = 'amz-us-app';
export const CODE_PREFIX = 'amz-license/codes';
export const BLOB_ACCESS_MODE = String(process.env.BLOB_ACCESS_MODE || 'public').trim() === 'private' ? 'private' : 'public';

export function json(data, init = {}) {
  return Response.json(data, {
    status: init.status || 200,
    headers: {
      'Cache-Control': 'no-store',
      ...(init.headers || {})
    }
  });
}

export function getBlobReadWriteToken() {
  return String(process.env.BLOB_READ_WRITE_TOKEN || '').trim();
}

export function requireAdmin(request) {
  return String(request.headers.get('x-admin-token') || '') === String(process.env.ADMIN_TOKEN || '');
}

export function normalizeCode(value) {
  return String(value || '').trim();
}

export function codePath(code) {
  return `${CODE_PREFIX}/${normalizeCode(code)}.json`;
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
  const map = {
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    m: 30 * 24 * 60 * 60 * 1000
  };

  return n * map[unit];
}

export function signLicense(privateKeyPem, payload) {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(payloadB64, 'utf8');
  signer.end();
  const signatureB64 = signer.sign(privateKeyPem).toString('base64');
  return { payloadB64, signatureB64 };
}

export async function readBlobJson(pathname) {
  const page = await list({
    prefix: pathname,
    limit: 1
  });
  const blob = (page.blobs || []).find((item) => item.pathname === pathname);
  if (!blob || !blob.downloadUrl) return null;
  const headers = {};
  const token = getBlobReadWriteToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const text = await (await fetch(blob.downloadUrl, { headers })).text();
  return JSON.parse(text);
}

export async function writeBlobJson(pathname, value) {
  await put(pathname, JSON.stringify(value, null, 2), {
    access: BLOB_ACCESS_MODE,
    contentType: 'application/json',
    overwrite: true
  });
}

export async function loadCode(code) {
  try {
    return await readBlobJson(codePath(code));
  } catch (error) {
    return null;
  }
}

export async function saveCode(codeData) {
  await writeBlobJson(codePath(codeData.code), codeData);
}

export async function listCodes() {
  const items = [];
  let cursor;

  do {
    const page = await list({
      prefix: `${CODE_PREFIX}/`,
      limit: 100,
      cursor
    });

    for (const blob of page.blobs || []) {
      try {
        const headers = {};
        const token = getBlobReadWriteToken();
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
        const text = await (await fetch(blob.downloadUrl, { headers })).text();
        items.push(JSON.parse(text));
      } catch (_) {}
    }

    cursor = page.cursor;
  } while (cursor);

  return items;
}
