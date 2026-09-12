import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) throw new Error('R2 is not configured');
  return new S3Client({ region: 'auto', endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY } });
}

export async function presignUpload(key: string, contentType: string, bytes: number) {
  const max = Number(process.env.MAX_UPLOAD_BYTES ?? 1073741824);
  if (bytes <= 0 || bytes > max) throw new Error('File exceeds upload limit');
  const command = new PutObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key, ContentType: contentType });
  return getSignedUrl(client(), command, { expiresIn: 900 });
}

export async function presignDownload(key: string, filename: string) {
  const command = new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key, ResponseContentDisposition: `attachment; filename="${filename.replace(/[\"\\\r\n]/g, '_')}"` });
  return getSignedUrl(client(), command, { expiresIn: 900 });
}
