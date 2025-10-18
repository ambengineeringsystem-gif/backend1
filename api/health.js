const { buildClient } = require('../lib/s3');
module.exports = async (req, res) => {
  try {
    buildClient(process.env);
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
