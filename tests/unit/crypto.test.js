import { describe, expect, it } from "vitest";

import {
  base64ToBytes,
  buildRecoveryKeyFile,
  bytesToBase64,
  createKeyId,
  createLegacyKeyId,
  decryptPayloadWithKey,
  encryptMarkdown,
  encryptedDocumentFormat,
  importMasterKey,
  masterKeyByteLength,
  parseEncryptedDocument,
  parseRecoveryKeyFile,
  recoveryKeyFormat,
} from "../../lib/crypto.js";

// Fixed synthetic keys. Never use a real user key in tests.
const keyA = new Uint8Array(masterKeyByteLength).fill(7);
const keyB = new Uint8Array(masterKeyByteLength).map((_, index) => (index * 31 + 11) % 256);

describe("base64 helpers", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);

    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });

  it("handles payloads larger than the chunk size", () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17).map((_, index) => index % 256);

    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });
});

describe("createKeyId", () => {
  // Regression: identifiers used to be the raw first 12 bytes of the master
  // key, so every encrypted file published 96 bits of key material.
  it("never contains a prefix of the raw key", async () => {
    const id = await createKeyId(keyA);
    const rawPrefix = bytesToBase64(keyA.slice(0, 12)).replace(/[+/=]/g, "");

    expect(id).not.toBe(rawPrefix);
    expect(bytesToBase64(keyA)).not.toContain(id);
  });

  it("is deterministic and distinct per key", async () => {
    expect(await createKeyId(keyA)).toBe(await createKeyId(keyA));
    expect(await createKeyId(keyA)).not.toBe(await createKeyId(keyB));
  });

  it("is domain separated from a plain hash of the key", async () => {
    const plainDigest = await crypto.subtle.digest("SHA-256", keyA);
    const plainId = bytesToBase64(new Uint8Array(plainDigest).slice(0, 12)).replace(/[+/=]/g, "");

    expect(await createKeyId(keyA)).not.toBe(plainId);
  });

  it("keeps the legacy form available for older documents", () => {
    expect(createLegacyKeyId(keyA)).toBe(bytesToBase64(keyA.slice(0, 12)).replace(/[+/=]/g, ""));
  });
});

describe("parseEncryptedDocument", () => {
  it("returns null for ordinary markdown", () => {
    expect(parseEncryptedDocument("# Heading\n\ntext")).toBeNull();
    expect(parseEncryptedDocument("")).toBeNull();
  });

  it("returns null for JSON that is not an envelope", () => {
    expect(parseEncryptedDocument('{"hello":"world"}')).toBeNull();
    expect(parseEncryptedDocument("{ not valid json")).toBeNull();
  });

  it("throws when the envelope is recognised but unusable", () => {
    expect(() => parseEncryptedDocument(JSON.stringify({ format: encryptedDocumentFormat, cipher: "AES-GCM" }))).toThrow(
      /unsupported format/i,
    );
  });
});

describe("encryption round trip", () => {
  it("encrypts and decrypts markdown", async () => {
    const cryptoKey = await importMasterKey(keyA);
    const keyId = await createKeyId(keyA);
    const envelope = await encryptMarkdown(cryptoKey, keyId, "# secret\n\nbody");
    const payload = parseEncryptedDocument(envelope);

    expect(payload.version).toBe(2);
    expect(payload.keyId).toBe(keyId);
    expect(await decryptPayloadWithKey(cryptoKey, payload)).toBe("# secret\n\nbody");
  });

  it("uses a fresh IV for every document", async () => {
    const cryptoKey = await importMasterKey(keyA);
    const keyId = await createKeyId(keyA);
    const first = parseEncryptedDocument(await encryptMarkdown(cryptoKey, keyId, "same text"));
    const second = parseEncryptedDocument(await encryptMarkdown(cryptoKey, keyId, "same text"));

    expect(first.iv).not.toBe(second.iv);
    expect(first.data).not.toBe(second.data);
  });

  it("does not leak the plaintext into the envelope", async () => {
    const cryptoKey = await importMasterKey(keyA);
    const envelope = await encryptMarkdown(cryptoKey, await createKeyId(keyA), "TOPSECRETMARKER");

    expect(envelope).not.toContain("TOPSECRETMARKER");
  });

  it("rejects the wrong key", async () => {
    const payload = parseEncryptedDocument(
      await encryptMarkdown(await importMasterKey(keyA), await createKeyId(keyA), "body"),
    );

    await expect(decryptPayloadWithKey(await importMasterKey(keyB), payload)).rejects.toThrow();
  });

  it("detects tampered ciphertext", async () => {
    const cryptoKey = await importMasterKey(keyA);
    const payload = parseEncryptedDocument(await encryptMarkdown(cryptoKey, await createKeyId(keyA), "body"));
    const bytes = base64ToBytes(payload.data);

    bytes[0] ^= 0xff;

    await expect(decryptPayloadWithKey(cryptoKey, { ...payload, data: bytesToBase64(bytes) })).rejects.toThrow();
  });
});

describe("parseRecoveryKeyFile", () => {
  // Regression: an unvalidated key used to be uploaded to Google Drive before
  // anything checked it, so importing the wrong file destroyed the real key.
  it.each([
    ["not JSON at all", "hello there", /not valid JSON/i],
    ["a different format", JSON.stringify({ format: "something-else", key: "AAAA" }), /not a supported/i],
    ["a missing key field", JSON.stringify({ format: recoveryKeyFormat }), /not a supported/i],
    ["invalid base64", JSON.stringify({ format: recoveryKeyFormat, key: "!!!!" }), /not valid base64/i],
    [
      "a key of the wrong length",
      JSON.stringify({ format: recoveryKeyFormat, key: bytesToBase64(new Uint8Array(16)) }),
      /128 bits.*256 bits/i,
    ],
  ])("rejects %s", async (_label, text, message) => {
    await expect(parseRecoveryKeyFile(text)).rejects.toThrow(message);
  });

  it("accepts a well-formed key and returns usable material", async () => {
    const result = await parseRecoveryKeyFile(buildRecoveryKeyFile(keyA, await createKeyId(keyA)));

    expect([...result.bytes]).toEqual([...keyA]);

    const payload = parseEncryptedDocument(await encryptMarkdown(result.cryptoKey, "id", "body"));
    expect(await decryptPayloadWithKey(await importMasterKey(keyA), payload)).toBe("body");
  });
});

describe("buildRecoveryKeyFile", () => {
  it("writes the documented format", async () => {
    const record = JSON.parse(buildRecoveryKeyFile(keyA, await createKeyId(keyA), "user@example.com"));

    expect(record.format).toBe(recoveryKeyFormat);
    expect(record.email).toBe("user@example.com");
    expect([...base64ToBytes(record.key)]).toEqual([...keyA]);
  });
});
