import { json, requireAdmin, parseDurationMs, loadCode, saveCode, listCodes } from '../_lib.js';

export default {
  async fetch(request) {
    try {
      if (!requireAdmin(request)) {
        return json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
      }

      if (request.method === 'GET') {
        const codes = await listCodes();
        return json({ ok: true, codes });
      }

      if (request.method !== 'POST') {
        return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
      }

      const body = await request.json().catch(() => ({}));
      const code = String(body.code || '').trim();
      const durationMs = parseDurationMs(body.durationMs || body.duration || body.plan);
      const note = String(body.note || '').trim();
      const boundMachineId = String(body.boundMachineId || body.machineId || '').trim();

      if (!code) {
        return json({ ok: false, error: 'CODE_REQUIRED' }, { status: 400 });
      }
      if (!durationMs) {
        return json({ ok: false, error: 'DURATION_REQUIRED' }, { status: 400 });
      }

      const existing = await loadCode(code);
      if (existing) {
        return json({ ok: false, error: 'CODE_ALREADY_EXISTS' }, { status: 409 });
      }

      const codeData = {
        code,
        appId: 'amz-us-app',
        durationMs,
        note,
        boundMachineId: boundMachineId || null,
        createdAt: Date.now(),
        used: false,
        usedAt: null,
        usedBy: null,
        activation: null
      };

      const created = await saveCode(codeData);

      return json({ ok: true, code: created }, { status: 201 });
    } catch (error) {
      console.error('admin/codes failed:', error);
      if (error?.code === 11000) {
        return json({ ok: false, error: 'CODE_ALREADY_EXISTS' }, { status: 409 });
      }
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
