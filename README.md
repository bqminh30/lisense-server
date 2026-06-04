# License Server Sample

This is a minimal one-time license server for the AmzUS app.

## Run

```bash
node license-server/server.js
```

Default port: `8787`

## Create a code

```bash
node license-server/tools/create-code.js 123Abc 12h
node license-server/tools/create-code.js 888XYZ 3d "client A"
```

Supported durations:

- `12h`
- `1d`
- `3d`
- `1m`
- raw milliseconds, for example `43200000`

## Endpoint

- `GET /health`
- `GET /api/health`
- `GET /public-key`
- `GET /api/public-key`
- `POST /activate`
- `POST /api/activate`
- `GET /admin/codes`
- `GET /api/admin/codes`
- `POST /admin/codes`
- `POST /api/admin/codes`

## Local testing

1. Start the server.
2. Create a code.
3. Point the client app to the server with:

```bash
set AMZ_LICENSE_SERVER_URL=http://127.0.0.1:8787
```

The client will automatically look for the public key at:

- `src/data/license_public.pem`
- `license-server/keys/public.pem`

## Admin token

Default admin token for the sample server:

`dev-admin-token`

You can override it:

```bash
set ADMIN_TOKEN=your-secret
```
