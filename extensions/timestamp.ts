import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Custom timestamp extension — cache-safe, highly configurable.
 *
 * Injects current time as plain text into messages (default: tail-safe, no cache break).
 * Optionally can also inject into system prompt (TS_SYSTEM_PROMPT=1) — WARNING: breaks prefix cache.
 *
 * Config via env vars:
 *   TS_ENABLE       - "0" to disable entirely (default: 1)
 *   TS_FORMAT       - "iso" (default), "us", "full", or custom via TS_TEMPLATE
 *   TS_TEMPLATE     - Custom format: {date} {time} {dow} {tz} {seconds}
 *   TS_TZ           - Timezone name (default: system local, e.g. Asia/Singapore)
 *   TS_HOURS24      - "1" for 24-hour (default), "0" for 12-hour am/pm
 *   TS_INCLUDE_YEAR - "1" include year (default), "0" omit
 *   TS_POSITION     - "begin" (default) or "end" — where to place tag in message
 *   TS_PREFIX       - Prefix inside brackets, e.g. "now:" → [now: 2026-11-25 09:43] (default: "")
 *   TS_TZ_LABEL     - Timezone abbreviation to append, e.g. "SGT" (default: "")
 *   TS_DOW          - "1" to include day of week (Mon, Tue...) (default: 0)
 *   TS_SECONDS      - "1" to include seconds (default: 0)
 *   TS_MIN_GAP      - Min minutes between injections (default: 0 = every message)
 *   TS_ROLES        - "user" (default), "assistant", or "both" — which roles get tagged
 *   TS_SYSTEM_PROMPT - "1" to ALSO append to system prompt (default: 0).
 *                      WARNING: Breaks prefix cache. Use with TS_MIN_GAP >= 15.
 */

type Rec = Record<string, unknown>;

const ENABLE = (process.env.TS_ENABLE ?? "1") !== "0";
const FORMAT = process.env.TS_FORMAT ?? "iso";
const TEMPLATE = process.env.TS_TEMPLATE || "";
const TZ = process.env.TS_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
const HOURS24 = (process.env.TS_HOURS24 ?? "1") === "1";
const INCLUDE_YEAR = (process.env.TS_INCLUDE_YEAR ?? "1") === "1";
const POSITION = (process.env.TS_POSITION ?? "begin") === "end" ? "end" : "begin";
const PREFIX = process.env.TS_PREFIX ?? "";
const TZ_LABEL = process.env.TS_TZ_LABEL ?? "";
const DOW = (process.env.TS_DOW ?? "0") === "1";
const SECONDS = (process.env.TS_SECONDS ?? "0") === "1";
const MIN_GAP_MINUTES = parseInt(process.env.TS_MIN_GAP ?? "0", 10);
const ROLES = process.env.TS_ROLES ?? "user"; // "user" | "assistant" | "both"
const SYSTEM_PROMPT = (process.env.TS_SYSTEM_PROMPT ?? "0") === "1";

// Warn if system prompt injection enabled without a gap
if (SYSTEM_PROMPT && MIN_GAP_MINUTES < 15) {
  console.warn(`[timestamp] TS_SYSTEM_PROMPT=1 with TS_MIN_GAP=${MIN_GAP_MINUTES} will break prefix cache frequently. Consider TS_MIN_GAP>=15.`);
}

let lastInjectTime = 0;

// Strip regex for idempotency — matches [timestamp tag] at beginning or end of content
const TS_STRIP_END = /\n\[[^\]\n]{3,60}\]\s*$/;
const TS_STRIP_BEGIN = /^\[[^\]\n]{3,60}\]\n?/;

function getParts(now: Date): Record<string, string> {
  const get = (locale: string, opts: Intl.DateTimeFormatOptions) => {
    const parts = new Intl.DateTimeFormat(locale, { timeZone: TZ, ...opts }).formatToParts(now);
    return (t: string) => parts.find(p => p.type === t)?.value ?? "";
  };

  // Date parts
  const dateGet = get("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
  const year = dateGet("year");
  const month = dateGet("month");
  const day = dateGet("day");
  const dateStr = `${INCLUDE_YEAR ? year : year.slice(-2)}-${month}-${day}`;

  // Time parts
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: "2-digit", minute: "2-digit", hour12: !HOURS24,
    ...(SECONDS ? { second: "2-digit" } : {}),
  };
  const timeGet = get("en-CA", timeOpts);
  let timeStr = `${timeGet("hour")}:${timeGet("minute")}`;
  if (SECONDS) timeStr += `:${timeGet("second")}`;
  if (!HOURS24) {
    const period = timeGet("dayPeriod");
    if (period) timeStr += period.toLowerCase();
  }

  // Day of week
  let dowStr = "";
  if (DOW) {
    const dowGet = get("en-US", { weekday: "short" });
    dowStr = dowGet("weekday");
  }

  return { dateStr, timeStr, dowStr, tzLabel: TZ_LABEL };
}

function formatTimestamp(): string {
  const now = new Date();
  const p = getParts(now);

  let inner: string;

  if (TEMPLATE) {
    // Custom template with placeholders
    inner = TEMPLATE
      .replace(/\{date\}/g, p.dateStr)
      .replace(/\{time\}/g, p.timeStr)
      .replace(/\{dow\}/g, p.dowStr)
      .replace(/\{tz\}/g, p.tzLabel);
  } else {
    // Standard formats
    const parts: string[] = [];
    if (p.dowStr) parts.push(p.dowStr);
    parts.push(p.dateStr);
    parts.push(p.timeStr);
    if (p.tzLabel) parts.push(p.tzLabel);
    inner = parts.join(" ");
  }

  const prefix = PREFIX ? `${PREFIX} ` : "";
  return `[${prefix}${inner}]`;
}

function chatShouldInject(last: Rec): boolean {
  if (ROLES === "user" && last.role !== "user") return false;
  if (ROLES === "assistant" && last.role !== "assistant") return false;

  if (last.role === "user") {
    const content = last.content;
    if (Array.isArray(content) && content.some((b) => (b as Rec).type === "tool_result")) {
      return false;
    }
    return true;
  }
  if (last.role === "assistant") {
    const hasToolCalls = Array.isArray(last.tool_calls) && last.tool_calls.length > 0;
    const hasContent = last.content != null && last.content !== "";
    return !hasToolCalls && hasContent;
  }
  return false;
}

function responsesShouldInject(last: Rec): boolean {
  if (ROLES === "user" && last.role !== "user") return false;
  if (ROLES === "assistant" && last.role !== "assistant") return false;

  if (last.role === "user") return true;
  if (last.type === "message" && last.role === "assistant") {
    return Array.isArray(last.content) && last.content.length > 0;
  }
  return false;
}

export default function (pi: ExtensionAPI) {
  if (!ENABLE) return;

  pi.on("before_provider_request", (event: any) => {
    const now = Date.now();
    if (MIN_GAP_MINUTES > 0 && (now - lastInjectTime) < MIN_GAP_MINUTES * 60 * 1000) {
      return;
    }

    const payload = event.payload as Rec;

    // System prompt injection (optional, cache-breaking)
    if (SYSTEM_PROMPT) {
      // Some APIs put system prompt in messages[0], others have a separate system field
      const sysIdx = Array.isArray(payload.messages)
        ? (payload.messages as Rec[]).findIndex(m => m.role === "system")
        : -1;
      if (sysIdx >= 0) {
        const sysMsg = (payload.messages as Rec[])[sysIdx];
        if (typeof sysMsg.content === "string") {
          const tag = formatTimestamp();
          if (!sysMsg.content.includes(tag)) {
            sysMsg.content = sysMsg.content.replace(TS_STRIP_END, "").replace(TS_STRIP_BEGIN, "").trimEnd() + `\n\n[Current time: ${tag.replace(/^\[|\]$/g, "")}]`;
          }
        }
      }
    }

    // Message tail/head injection (cache-safe)
    const isResponses = Array.isArray(payload.input);
    const items = isResponses
      ? (payload.input as Rec[])
      : Array.isArray(payload.messages)
        ? (payload.messages as Rec[])
        : undefined;
    if (!items) return;

    const last = items[items.length - 1];
    if (!last) return;
    if (!(isResponses ? responsesShouldInject(last) : chatShouldInject(last))) return;

    lastInjectTime = now;
    const tag = formatTimestamp();

    const applyTag = (text: string): string => {
      let clean = text.replace(TS_STRIP_BEGIN, "").replace(TS_STRIP_END, "");
      return POSITION === "begin" ? `${tag}\n${clean}` : `${clean}\n${tag}`;
    };

    if (typeof last.content === "string") {
      last.content = applyTag(last.content);
    } else if (Array.isArray(last.content)) {
      const blocks = [...(last.content as Rec[])];
      const idx = blocks.length - 1;
      const lastBlock = blocks[idx] as { text?: unknown } | undefined;
      if (lastBlock && typeof lastBlock.text === "string") {
        blocks[idx] = { ...lastBlock, text: applyTag(String(lastBlock.text)) };
      } else if (POSITION === "begin" && blocks.length > 0) {
        const first = blocks[0] as { text?: unknown } | undefined;
        if (first && typeof first.text === "string") {
          blocks[0] = { ...first, text: `${tag}\n${first.text}` };
        } else {
          blocks.unshift({ type: isResponses ? "input_text" : "text", text: tag });
        }
      } else if (isResponses && last.role === "assistant") {
        blocks.push({ type: "output_text", text: `\n${tag}`, annotations: [] });
      } else if (isResponses) {
        blocks.push({ type: "input_text", text: `\n${tag}` });
      } else {
        blocks.push({ type: "text", text: `\n${tag}` });
      }
      last.content = blocks;
    }

    return event.payload;
  });
}
