import { json } from './_lib.js';

export default {
  fetch() {
    return json({
      ok: true,
      appId: 'amz-us-app',
      storage: 'vercel-blob'
    });
  }
};
