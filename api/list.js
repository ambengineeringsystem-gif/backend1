const { buildClient, ListObjectsV2Command } = require('../lib/s3');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { s3, bucket } = buildClient(process.env);
    const cmd = new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000 });
    const data = await s3.send(cmd);
    const items = (data.Contents || []).map(o => ({ Key: o.Key, Size: o.Size, LastModified: o.LastModified }));
    return res.json({ items });
  } catch (err) {
    console.error('list error', err);
    return res.status(500).json({ error: String(err) });
  }
};
