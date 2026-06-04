# Vercel License Server

This folder is ready to deploy to Vercel as a separate project.

## Endpoints

- `GET /api/health`
- `GET /api/public-key`
- `POST /api/activate`
- `GET /api/admin/codes`
- `POST /api/admin/codes`

## Required env vars

- `ADMIN_TOKEN`
- `LICENSE_PRIVATE_KEY_PEM`
- `LICENSE_PUBLIC_KEY_PEM`
- `BLOB_READ_WRITE_TOKEN`

## Deploy

1. Create a new Vercel project.
2. Set the root directory to `license-server/vercel`.
3. Add the environment variables above.
4. Deploy.

## Create a code by API

```bash
curl -X POST "https://your-project.vercel.app/api/admin/codes" ^
  -H "Content-Type: application/json" ^
  -H "x-admin-token: your-admin-token" ^
  -d "{\"code\":\"123abc\",\"duration\":\"12h\",\"note\":\"client A\"}"
```

## Activate a code

```bash
curl -X POST "https://your-project.vercel.app/api/activate" ^
  -H "Content-Type: application/json" ^
  -d "{\"appId\":\"amz-us-app\",\"code\":\"123abc\",\"machineId\":\"abc\",\"hostname\":\"PC\",\"platform\":\"win32\"}"
```
