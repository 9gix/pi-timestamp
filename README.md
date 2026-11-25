# @9gix/pi-timestamp

Cache-safe timestamp injection for [pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).

Injects the current wall-clock time into messages **just-in-time** (tail/head-safe — no prefix-cache break), so the model always knows what time it is. Optionally also injects into the system prompt, and fully configurable via environment variables.

## Install

```bash
pi install npm:@9gix/pi-timestamp
```

Or from git:

```bash
pi install git:github.com/9gix/pi-timestamp
```

## How it works

On every `before_provider_request`, the extension formats the current time as a short bracketed tag, e.g.:

```
[2026-11-25 09:43 SGT]
```

and applies it to the last eligible message in the outgoing payload:

- **Chat API** (`payload.messages`): tagged on the last user/assistant text message.
- **Responses API** (`payload.input`): tagged on the last user/assistant item.
- Tool results and tool-call-only assistant turns are skipped.
- The tag is idempotent — a stale tag is stripped before a fresh one is applied, so repeated requests don't stack tags.

By default this only touches the last message, keeping the conversation prefix identical across requests — **the prompt prefix cache stays intact**.

## Configuration

All settings are read from environment variables when the extension loads.

| Variable | Default | Description |
| --- | --- | --- |
| `TS_ENABLE` | `1` | Set to `0` to disable entirely. |
| `TS_FORMAT` | `iso` | `iso`, `us`, `full`, or a custom template via `TS_TEMPLATE`. |
| `TS_TEMPLATE` | – | Custom format with placeholders: `{date} {time} {dow} {tz}`. Overrides `TS_FORMAT`. |
| `TS_TZ` | system local | IANA timezone name, e.g. `Asia/Singapore`. |
| `TS_HOURS24` | `1` | `0` for 12-hour am/pm. |
| `TS_INCLUDE_YEAR` | `1` | `0` to show a two-digit year. |
| `TS_POSITION` | `begin` | `end` to place the tag at the tail of the message instead of the head. |
| `TS_PREFIX` | – | Label inside the brackets, e.g. `now:` → `[now: 2026-11-25 09:43]`. |
| `TS_TZ_LABEL` | – | Timezone abbreviation to append, e.g. `SGT`. |
| `TS_DOW` | `0` | `1` to include the day of week (Mon, Tue, …). |
| `TS_SECONDS` | `0` | `1` to include seconds. |
| `TS_MIN_GAP` | `0` | Minimum minutes between injections (`0` = every request). |
| `TS_ROLES` | `user` | `user`, `assistant`, or `both` — which roles get tagged. |
| `TS_SYSTEM_PROMPT` | `0` | `1` to **also** append `[Current time: …]` to the system message. |

### ⚠️ System prompt injection

`TS_SYSTEM_PROMPT=1` rewrites the system message on every injection, which **breaks the prefix cache**. If you use it, set `TS_MIN_GAP` to at least `15` so the system prompt changes only rarely (the extension prints a warning otherwise).

## Examples

```bash
# Singapore time, 24h, at the tail of user messages
TS_TZ=Asia/Singapore TS_TZ_LABEL=SGT TS_POSITION=end pi

# Day of week + seconds, tag at the head
TS_DOW=1 TS_SECONDS=1 pi

# Custom template
TS_TEMPLATE="{dow} {date} {time} {tz}" pi

# Rare system-prompt refresh for long sessions
TS_SYSTEM_PROMPT=1 TS_MIN_GAP=30 pi
```

## Development

```bash
npm install
npm run check   # type-check
pi -e ./extensions/timestamp.ts
```

## License

[MIT](./LICENSE)
