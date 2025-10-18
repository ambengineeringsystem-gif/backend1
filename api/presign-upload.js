const { buildClient } = require('../lib/s3');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const mime = require('mime-types');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { key, contentType } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key is required' });

  // Optional simple API key guard: set API_KEY env var in Vercel and client must send 'x-api-key' header
  if (process.env.API_KEY) {
    const got = req.headers['x-api-key'] || req.headers['api-key'];
    if (!got || got !== process.env.API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { s3, bucket } = buildClient(process.env);
    const put = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType || mime.lookup(key) || 'application/octet-stream' });
    const url = await getSignedUrl(s3, put, { expiresIn: 3600 });
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.json({ url });
  } catch (err) {
    console.error('presign-upload error', err);
    return res.status(500).json({ error: String(err) });
  }
};