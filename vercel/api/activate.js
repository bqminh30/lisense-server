import { json, claimCodeForActivation, signLicense } from './_lib.js';

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

      const privateKeyPem = String(process.env.LICENSE_PRIVATE_KEY_PEM || '').trim();
      if (!privateKeyPem) {
        return json({ ok: false, error: 'PRIVATE_KEY_MISSING' }, { status: 500 });
      }

      const claim = await claimCodeForActivation(code, machineId, hostname, platform);

      if (claim.status === 'not_found') {
        return json({ ok: false, error: 'CODE_NOT_FOUND' }, { status: 404 });
      }
      if (claim.status === 'app_mismatch') {
        return json({ ok: false, error: 'CODE_APP_MISMATCH' }, { status: 400 });
      }
      if (claim.status === 'already_used') {
        return json({
          ok: false,
          error: 'CODE_ALREADY_USED',
          usedAt: claim.current?.usedAt || null,
          usedBy: claim.current?.usedBy || null
        }, { status: 409 });
      }
      if (claim.status !== 'claimed' || !claim.code) {
        return json({ ok: false, error: 'ACTIVATION_CONFLICT' }, { status: 409 });
      }

      const payload = {
        appId: 'amz-us-app',
        codeId: claim.code.code,
        machineId,
        issuedAt: claim.code.activation.issuedAt,
        expiresAt: claim.code.activation.expiresAt,
        hostname,
        platform
      };

      const license = signLicense(privateKeyPem, payload);

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
