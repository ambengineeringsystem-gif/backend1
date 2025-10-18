const { S3Client, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

function buildClient(env) {
  const { S3_ENDPOINT, BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE } = env;
  if (!S3_ENDPOINT || !BUCKET || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    throw new Error('Missing required S3 env vars');
  }
  const forcePathStyle = (S3_FORCE_PATH_STYLE || 'true').toLowerCase() === 'true';
  const s3 = new S3Client({
    endpoint: S3_ENDPOINT,
    region: AWS_REGION || 'eu-central-1',
    credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
    forcePathStyle,
  });
  return { s3, bucket: BUCKET };
}

module.exports = { buildClient, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand };
