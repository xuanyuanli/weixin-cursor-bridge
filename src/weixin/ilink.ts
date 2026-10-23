import { randomBytes, randomUUID } from "node:crypto";
import qrcodeTerminal from "qrcode-terminal";
import { info } from "../log.js";
import { writeJson } from "../store.js";

const DEFAULT_BASE = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION = "1.0.3";
const LONG_POLL_MS = 35_000;
const SHORT_MS = 15_000;

export type Credentials = {
  botToken: string;
  baseUrl: string;
  botId?: string;
  userId?: string;
};

export type WeixinInbound = {
  fromUserId: string;
  text: string;
  contextToken?: string;
};

type ApiResp = {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  [key: string]: unknown;
};

function randomWechatUin(): string {
  const value = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), "utf8").toString("base64");
}

function baseInfo(): { channel_version: string } {
  return { channel_version: CHANNEL_VERSION };
}

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
  };
  if (token) {
    h.Authorization = `Bearer ${token}`;
  }
  return h;
}

function joinUrl(base: string, endpoint: string): string {
  const root = base.endsWith("/") ? base : `${base}/`;
  return new URL(endpoint, root).toString();
}

async function apiPost(
  baseUrl: string,
  endpoint: string,
  body: Record<string, unknown>,
  token?: string,
  timeoutMs = SHORT_MS,
): Promise<ApiResp> {
  const bodyStr = JSON.stringify(body);
  const hdrs = headers(token);
  hdrs["Content-Length"] = String(Buffer.byteLength(bodyStr, "utf8"));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(joinUrl(baseUrl, endpoint), {
      method: "POST",
      headers: hdrs,
      body: bodyStr,
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: ApiResp = {};
    if (text) {
      try {
        parsed = JSON.parse(text) as ApiResp;
      } catch {
        throw new Error(`${endpoint} non-JSON ${res.status}: ${text.slice(0, 200)}`);
      }
    }
    if (!res.ok) {
      throw new Error(`${endpoint} HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const ret = parsed.ret ?? parsed.errcode ?? 0;
    if (ret !== 0) {
      const err = new Error(
        `${endpoint} ret=${String(ret)} ${parsed.errmsg ?? ""}`.trim(),
      );
      (err as Error & { ret: number }).ret = Number(ret);
      throw err;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function apiGet(
  url: string,
  extraHeaders: Record<string, string>,
  timeoutMs = LONG_POLL_MS,
): Promise<ApiResp> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: extraHeaders, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`GET ${url} HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return text ? (JSON.parse(text) as ApiResp) : {};
  } finally {
    clearTimeout(timer);
  }
}

function extractText(msg: Record<string, unknown>): string {
  const items = msg.item_list as Array<Record<string, unknown>> | undefined;
  if (!items?.length) {
    return "";
  }
  for (const item of items) {
    if (item.type === 1) {
      const textItem = item.text_item as { text?: string } | undefined;
      if (textItem?.text) {
        return textItem.text;
      }
    }
  }
  return "";
}

/**
 * QR login. Persists credentials to `destPath`.
 */
export async function loginWithQr(destPath: string): Promise<Credentials> {
  let qrBody: ApiResp;
  try {
    qrBody = await apiPost(DEFAULT_BASE, "ilink/bot/get_bot_qrcode?bot_type=3", {
      local_token_list: [],
      base_info: baseInfo(),
    });
  } catch {
    const res = await fetch(`${DEFAULT_BASE}/ilink/bot/get_bot_qrcode?bot_type=3`);
    qrBody = (await res.json()) as ApiResp;
  }

  const qrcode = String(qrBody.qrcode ?? "");
  const img = String(qrBody.qrcode_img_content ?? qrcode);
  if (!qrcode) {
    throw new Error("get_bot_qrcode returned no qrcode");
  }

  info("请用微信扫描二维码登录");
  qrcodeTerminal.generate(img, { small: true });
  if (img.startsWith("http")) {
    info(img);
  }

  for (;;) {
    let status: ApiResp;
    try {
      status = await apiGet(
        `${DEFAULT_BASE}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
        { "iLink-App-ClientVersion": "1" },
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        continue;
      }
      throw err;
    }
    const st = String(status.status ?? "wait");
    if (st === "confirmed") {
      const creds: Credentials = {
        botToken: String(status.bot_token ?? ""),
        baseUrl: String(status.baseurl ?? DEFAULT_BASE),
        botId: status.ilink_bot_id ? String(status.ilink_bot_id) : undefined,
        userId: status.ilink_user_id ? String(status.ilink_user_id) : undefined,
      };
      if (!creds.botToken) {
        throw new Error("confirmed without bot_token");
      }
      writeJson(destPath, creds);
      info(`登录成功 user=${creds.userId ?? "-"}`);
      return creds;
    }
    if (st === "expired") {
      throw new Error("二维码已过期，请重启再扫");
    }
  }
}

export type UpdatesCursor = { get_updates_buf: string };

/**
 * One getupdates long-poll. Returns inbound user texts and the next cursor.
 */
export async function pollUpdates(
  creds: Credentials,
  buf: string,
): Promise<{ nextBuf: string; messages: WeixinInbound[]; sessionExpired: boolean }> {
  try {
    const resp = await apiPost(
      creds.baseUrl,
      "ilink/bot/getupdates",
      { get_updates_buf: buf, base_info: baseInfo() },
      creds.botToken,
      LONG_POLL_MS + 5_000,
    );
    const nextBuf =
      typeof resp.get_updates_buf === "string" && resp.get_updates_buf
        ? resp.get_updates_buf
        : buf;
    const rawMsgs = (resp.msgs as Array<Record<string, unknown>> | undefined) ?? [];
    const messages: WeixinInbound[] = [];
    for (const msg of rawMsgs) {
      if (Number(msg.message_type) !== 1) {
        continue;
      }
      const text = extractText(msg);
      const fromUserId = String(msg.from_user_id ?? "");
      if (!fromUserId || !text) {
        continue;
      }
      messages.push({
        fromUserId,
        text,
        contextToken: msg.context_token ? String(msg.context_token) : undefined,
      });
    }
    return { nextBuf, messages, sessionExpired: false };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { nextBuf: buf, messages: [], sessionExpired: false };
    }
    const ret = (err as { ret?: number }).ret;
    if (ret === -14) {
      return { nextBuf: "", messages: [], sessionExpired: true };
    }
    throw err;
  }
}

/**
 * Send one text. Requires a stored context_token for that user.
 */
export async function sendText(
  creds: Credentials,
  toUserId: string,
  text: string,
  contextToken: string,
): Promise<void> {
  await apiPost(
    creds.baseUrl,
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: toUserId,
        client_id: randomUUID(),
        message_type: 2,
        message_state: 2,
        context_token: contextToken,
        item_list: [{ type: 1, text_item: { text } }],
      },
      base_info: baseInfo(),
    },
    creds.botToken,
  );
}

/**
 * Best-effort typing indicator. Failures are ignored.
 */
export async function sendTyping(
  creds: Credentials,
  toUserId: string,
  contextToken: string,
): Promise<void> {
  try {
    const cfg = await apiPost(
      creds.baseUrl,
      "ilink/bot/getconfig",
      { base_info: baseInfo() },
      creds.botToken,
    );
    const ticket = String(cfg.typing_ticket ?? "");
    if (!ticket) {
      return;
    }
    await apiPost(
      creds.baseUrl,
      "ilink/bot/sendtyping",
      {
        typing_ticket: ticket,
        to_user_id: toUserId,
        context_token: contextToken,
        base_info: baseInfo(),
      },
      creds.botToken,
    );
  } catch {
    // optional
  }
}

export function isSessionExpired(err: unknown): boolean {
  return (err as { ret?: number }).ret === -14;
}
