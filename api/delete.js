const { buildClient, DeleteObjectCommand } = require('../lib/s3');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key is required' });
  try {
    const { s3, bucket } = buildClient(process.env);
    const cmd = new DeleteObjectCommand({ Bucket: bucket, Key: key });
    await s3.send(cmd);
    return res.json({ ok: true });
  } catch (err) {
    console.error('delete error', err);
    return res.status(500).json({ error: String(err) });
  }
};
