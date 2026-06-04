import { json, loadCode, saveCode, signLicense } from './_lib.js';

export default {
  async fetch(request) {
    try {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
      }

      const body = await request.json().catch(() => ({}));
      const appId = String(body.appId || '').trim();
      const code = String(body.code || '').trim();
      const machineId = String(body.machineId || '').trim();
      const hostname = String(body.hostname || '').trim();
      const platform = String(body.platform || '').trim();

      if (appId !== 'amz-us-app') {
        return json({ ok: false, error: 'APP_MISMATCH' }, { status: 400 });
      }
      if (!code || !machineId) {
        return json({ ok: false, error: 'CODE_AND_MACHINE_REQUIRED' }, { status: 400 });
      }

      const codeData = await loadCode(code);
      if (!codeData) {
        return json({ ok: false, error: 'CODE_NOT_FOUND' }, { status: 404 });
      }
      if (codeData.used) {
        return json({
          ok: false,
          error: 'CODE_ALREADY_USED',
          usedAt: codeData.usedAt,
          usedBy: codeData.usedBy
        }, { status: 409 });
      }

      const privateKeyPem = String(process.env.LICENSE_PRIVATE_KEY_PEM || '').trim();
      if (!privateKeyPem) {
        return json({ ok: false, error: 'PRIVATE_KEY_MISSING' }, { status: 500 });
      }

      const now = Date.now();
      const payload = {
        appId: 'amz-us-app',
        codeId: codeData.code,
        machineId,
        issuedAt: now,
        expiresAt: now + Number(codeData.durationMs || 0),
        hostname,
        platform
      };

      const license = signLicense(privateKeyPem, payload);

      codeData.used = true;
      codeData.usedAt = now;
      codeData.usedBy = { machineId, hostname, platform };
      codeData.activation = {
        issuedAt: payload.issuedAt,
        expiresAt: payload.expiresAt
      };

      await saveCode(codeData);

      return json({
        ok: true,
        license,
        payload
      });
    } catch (error) {
      console.error('activate failed:', error);
      return json(
        {
          ok: false,
          error: 'INTERNAL_ERROR',
          message: error?.message || String(error)
        },
        { status: 500 }
      );
    }
  }
};
