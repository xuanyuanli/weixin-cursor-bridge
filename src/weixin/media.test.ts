import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import {
  aes128EcbDecrypt,
  assertCdnUrl,
  cdnDownloadUrl,
  collectTextItems,
  guessImageExt,
  listImageItems,
  parseAesKey,
} from "./media.js";

describe("weixin media", () => {
  it("parses hex and base64 AES keys", () => {
    const key = randomBytes(16);
    assert.deepEqual(parseAesKey(key.toString("hex")), key);
    assert.deepEqual(parseAesKey(key.toString("base64")), key);
  });

  it("decrypts AES-128-ECB PKCS7", () => {
    const key = randomBytes(16);
    const plain = Buffer.from("hello-image");
    const cipher = createCipheriv("aes-128-ecb", key, null);
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    assert.deepEqual(aes128EcbDecrypt(ct, key), plain);
  });

  it("builds CDN url and rejects unknown hosts", () => {
    const url = cdnDownloadUrl("abc+def");
    assert.match(url, /encrypted_query_param=abc%2Bdef$/);
    assert.equal(assertCdnUrl("https://novac2c.cdn.weixin.qq.com/c2c/x").hostname, "novac2c.cdn.weixin.qq.com");
    assert.throws(() => assertCdnUrl("https://evil.example/x"));
  });

  it("guesses jpeg/png and collects text plus image items", () => {
    assert.equal(guessImageExt(Buffer.from([0xff, 0xd8, 0xff, 0x00])), ".jpg");
    assert.equal(guessImageExt(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), ".png");
    const items = [
      { type: 1, text_item: { text: "看看这个问题" } },
      { type: 2, image_item: { aeskey: "aa".repeat(16), media: { encrypt_query_param: "p" } } },
    ];
    assert.equal(collectTextItems(items), "看看这个问题");
    assert.equal(listImageItems(items).length, 1);
  });
});
