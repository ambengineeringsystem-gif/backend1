const { buildClient } = require('../lib/s3');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key is required' });

  if (process.env.API_KEY) {
    const got = req.headers['x-api-key'] || req.headers['api-key'];
    if (!got || got !== process.env.API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { s3, bucket } = buildClient(process.env);
    const get = new GetObjectCommand({ Bucket: bucket, Key: key });
    const url = await getSignedUrl(s3, get, { expiresIn: 3600 });
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.json({ url });
  } catch (err) {
    console.error('presign-download error', err);
    return res.status(500).json({ error: String(err) });
  }
};