/**
 * Encryption envelope and key material handling.
 *
 * Kept free of DOM and application state so the format, the key identifier
 * derivation, and the recovery-key validation rules can be unit tested
 * directly. Anything that mutates the active session lives in app.js.
 */

export const encryptedDocumentFormat = "lightmdreader-encrypted-v1";
export const recoveryKeyFormat = "lightmdreader-recovery-key-v1";
export const keyIdDomainLabel = "lightmdreader-key-id-v1";
export const masterKeyByteLength = 32;

export function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

/**
 * A domain-separated hash of the key, so the identifier stored in every
 * encrypted file reveals nothing about the key itself.
 *
 * This is a hint for "which key was this?", not authentication. AES-GCM is
 * what actually detects a wrong key or modified ciphertext.
 */
export async function createKeyId(bytes) {
  const label = new TextEncoder().encode(keyIdDomainLabel);
  const input = new Uint8Array(label.length + bytes.length);

  input.set(label, 0);
  input.set(bytes, label.length);

  const digest = await crypto.subtle.digest("SHA-256", input);

  return bytesToBase64(new Uint8Array(digest).slice(0, 12)).replace(/[+/=]/g, "");
}

/**
 * The identifier used before hashing: the first 12 bytes of the key itself.
 * Only used to recognise documents written by older versions.
 */
export function createLegacyKeyId(bytes) {
  return bytesToBase64(bytes.slice(0, 12)).replace(/[+/=]/g, "");
}

export async function importMasterKey(bytes) {
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/**
 * Returns the envelope when the text is one, null when it is ordinary
 * markdown, and throws only when it claims to be an envelope but is unusable.
 */
export function parseEncryptedDocument(text) {
  const trimmed = String(text ?? "").trim();

  if (!trimmed.startsWith("{")) return null;

  let payload;

  try {
    payload = JSON.parse(trimmed);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }

  if (payload?.format !== encryptedDocumentFormat) return null;

  if (payload.cipher !== "AES-GCM" || !payload.iv || !payload.data) {
    throw new Error("This encrypted document has an unsupported format.");
  }

  return payload;
}

export async function encryptMarkdown(cryptoKey, keyId, markdownText) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(markdownText);
  const encryptedBytes = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encodedText),
  );

  return `${JSON.stringify(
    {
      format: encryptedDocumentFormat,
      version: 2,
      cipher: "AES-GCM",
      keyIdAlgorithm: keyIdDomainLabel,
      keyId,
      iv: bytesToBase64(iv),
      data: bytesToBase64(encryptedBytes),
    },
    null,
    2,
  )}\n`;
}

export async function decryptPayloadWithKey(cryptoKey, payload) {
  const iv = base64ToBytes(payload.iv);
  const data = base64ToBytes(payload.data);
  const decryptedBytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, data);

  return new TextDecoder().decode(decryptedBytes);
}

/**
 * Parses and structurally validates a recovery key file.
 *
 * Deliberately performs no persistence and mutates nothing: an invalid file
 * must be rejected before any caller is in a position to overwrite a working
 * key with it.
 */
export async function parseRecoveryKeyFile(text) {
  let record;

  try {
    record = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON, so it is not a recovery key.");
  }

  if (record?.format !== recoveryKeyFormat || !record.key) {
    throw new Error("This is not a supported LightMDReader recovery key.");
  }

  let bytes;

  try {
    bytes = base64ToBytes(record.key);
  } catch {
    throw new Error("The key inside this recovery file is not valid base64.");
  }

  if (bytes.length !== masterKeyByteLength) {
    throw new Error(
      `This recovery key is ${bytes.length * 8} bits. LightMDReader keys are ${masterKeyByteLength * 8} bits.`,
    );
  }

  return { bytes, cryptoKey: await importMasterKey(bytes), record };
}

export function buildRecoveryKeyFile(keyBytes, keyId, email = "") {
  return `${JSON.stringify(
    {
      format: recoveryKeyFormat,
      keyId,
      email,
      createdAt: new Date().toISOString(),
      key: bytesToBase64(keyBytes),
    },
    null,
    2,
  )}\n`;
}
