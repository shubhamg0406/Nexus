import crypto from 'crypto';

type EncryptedBlob = {
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
};

function getEncryptionKey() {
  const raw =
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.CONNECTED_ACCOUNTS_ENCRYPTION_KEY?.trim() ||
    process.env.SETTINGS_ENCRYPTION_KEY?.trim();

  if (!raw) {
    throw new Error('Missing INTEGRATION_TOKEN_ENCRYPTION_KEY (or CONNECTED_ACCOUNTS_ENCRYPTION_KEY / SETTINGS_ENCRYPTION_KEY).');
  }

  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptJson(value: unknown): EncryptedBlob {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const serialized = JSON.stringify(value);
  const ciphertext = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptJson<T>(blob: unknown): T {
  if (!blob || typeof blob !== 'object') {
    throw new Error('Encrypted blob missing.');
  }

  const candidate = blob as Partial<EncryptedBlob>;
  if (candidate.alg !== 'aes-256-gcm' || !candidate.iv || !candidate.tag || !candidate.ciphertext) {
    throw new Error('Encrypted blob malformed.');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(candidate.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(candidate.tag, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(candidate.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');

  return JSON.parse(plaintext) as T;
}
