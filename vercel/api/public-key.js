import { json } from './_lib.js';

export default {
  fetch() {
    const publicKey = String(process.env.LICENSE_PUBLIC_KEY_PEM || '').trim();
    if (!publicKey) {
      return json({ ok: false, error: 'PUBLIC_KEY_MISSING' }, { status: 500 });
    }

    return json({
      ok: true,
      publicKey
    });
  }
};
