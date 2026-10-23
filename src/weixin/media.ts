import { createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";
const CDN_HOSTS = new Set([
  "novac2c.cdn.weixin.qq.com",
  "ilinkai.weixin.qq.com",
  "wx.qlogo.cn",
  "thirdwx.qlogo.cn",
  "res.wx.qq.com",
  "mmbiz.qpic.cn",
  "mmbiz.qlogo.cn",
]);

export const IMAGE_FAIL_LINE = "（图片下载失败，请重发或把文字贴过来）";

type ImageItem = {
  aeskey?: string;
  cdn_url?: string;
  media?: {
    encrypt_query_param?: string;
    aes_key?: string;
    full_url?: string;
  };
};

/**
 * AES-128 key from iLink: 32-char hex, or base64 of 16 bytes / 32-char hex.
 */
export function parseAesKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{32}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 16) {
    return decoded;
  }
  if (decoded.length === 32) {
    const text = decoded.toString("ascii");
    if (/^[0-9a-fA-F]{32}$/.test(text)) {
      return Buffer.from(text, "hex");
    }
  }
  throw new Error("unexpected aes_key format");
}

export function aes128EcbDecrypt(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function cdnDownloadUrl(encryptedQueryParam: string): string {
  const q = encodeURIComponent(encryptedQueryParam);
  return `${CDN_BASE}/download?encrypted_query_param=${q}`;
}

export function assertCdnUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`disallowed media scheme ${parsed.protocol}`);
  }
  if (!parsed.hostname || !CDN_HOSTS.has(parsed.hostname)) {
    throw new Error(`media host not allowed: ${parsed.hostname || "-"}`);
  }
  return parsed;
}

export function guessImageExt(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return ".jpg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return ".png";
  }
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString("ascii").startsWith("GIF")) {
    return ".gif";
  }
  if (bytes.length >= 12 && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return ".webp";
  }
  return ".jpg";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

export function collectTextItems(items: Array<Record<string, unknown>>): string {
  const parts: string[] = [];
  for (const item of items) {
    if (Number(item.type) !== 1) {
      continue;
    }
    const textItem = asRecord(item.text_item);
    const text = typeof textItem?.text === "string" ? textItem.text.trim() : "";
    if (text) {
      parts.push(text);
    }
  }
  return parts.join("\n\n").trim();
}

export function listImageItems(items: Array<Record<string, unknown>>): ImageItem[] {
  const out: ImageItem[] = [];
  for (const item of items) {
    if (Number(item.type) !== 2) {
      continue;
    }
    const imageItem = asRecord(item.image_item) ?? {};
    const media = asRecord(imageItem.media);
    out.push({
      aeskey: typeof imageItem.aeskey === "string" ? imageItem.aeskey : undefined,
      cdn_url: typeof imageItem.cdn_url === "string" ? imageItem.cdn_url : undefined,
      media: media
        ? {
            encrypt_query_param:
              typeof media.encrypt_query_param === "string"
                ? media.encrypt_query_param
                : undefined,
            aes_key: typeof media.aes_key === "string" ? media.aes_key : undefined,
            full_url: typeof media.full_url === "string" ? media.full_url : undefined,
          }
        : undefined,
    });
  }
  return out;
}

function resolveAesKey(item: ImageItem): Buffer | undefined {
  if (item.aeskey) {
    return parseAesKey(item.aeskey);
  }
  if (item.media?.aes_key) {
    return parseAesKey(item.media.aes_key);
  }
  return undefined;
}

async function fetchBytes(url: string, timeoutMs: number): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`CDN HTTP ${String(res.status)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download one iLink image item and write it under `inboxDir`.
 */
export async function saveInboundImage(
  item: ImageItem,
  inboxDir: string,
  timeoutMs = 30_000,
): Promise<string> {
  const encrypted = item.media?.encrypt_query_param;
  const fullUrl = item.media?.full_url || item.cdn_url;
  let url: string;
  if (encrypted) {
    url = cdnDownloadUrl(encrypted);
  } else if (fullUrl) {
    assertCdnUrl(fullUrl);
    url = fullUrl;
  } else {
    throw new Error("image item has no url");
  }

  let raw = await fetchBytes(url, timeoutMs);
  const key = resolveAesKey(item);
  if (key) {
    raw = aes128EcbDecrypt(raw, key);
  }
  if (raw.length === 0) {
    throw new Error("empty image");
  }

  mkdirSync(inboxDir, { recursive: true });
  const name = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}${guessImageExt(raw)}`;
  const dest = join(inboxDir, name);
  writeFileSync(dest, raw);
  return dest;
}
