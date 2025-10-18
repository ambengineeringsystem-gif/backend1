Vercel presign API for Mega Drive S3

This folder contains serverless endpoints suitable for deployment to Vercel (or Netlify) that generate presigned S3 URLs for uploads and downloads. Keep your secrets in Vercel's Environment Variables.

Endpoints

- POST /api/presign-upload
  - Body: { key: string, contentType?: string }
  - Returns: { url }
- POST /api/presign-download
  - Body: { key: string }
  - Returns: { url }
- GET /api/list
  - Returns: { items: [{ Key, Size, LastModified }] }
- POST /api/delete
  - Body: { key }
  - Returns: { ok: true }
- GET /api/health
  - Quick health check (confirms env vars)

Environment variables (set in Vercel project settings)

- AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY
- S3_ENDPOINT (e.g. https://s3.eu-central-1.s4.mega.io)
- BUCKET (your bucket name)
- AWS_REGION (optional)
- S3_FORCE_PATH_STYLE (optional, defaults to 'true')
- API_KEY (optional) - if set, clients must include x-api-key header with this value

Client example (from the browser)

POST /api/presign-upload
- fetch('/api/presign-upload', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': '...' }, body: JSON.stringify({ key: 'attachments/card123/file.pdf', contentType: 'application/pdf' }) })

Security notes

- Don't commit credentials into git. Use Vercel environment variables.
- If you want extra protection, enable `API_KEY` and only allow requests with the key.
- Consider adding additional per-user authorization in a production app.

Deploying

- Push this folder to a GitHub repo and in Vercel create a new project using the repo. Set the root to `vercel_api` if you're deploying from a monorepo.
- Add environment variables in Vercel project settings and deploy.
