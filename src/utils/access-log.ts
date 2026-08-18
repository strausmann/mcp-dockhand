/**
 * nginx "combined" access lines on stdout.
 *
 * Why this format and not JSON: crowdsecurity/nginx-logs already parses it, so an
 * operator gets bruteforce detection, GeoIP enrichment and the standard HTTP
 * scenarios by adding an acquisition file — no custom parser to write and keep
 * working. Verified end to end with `cscli explain` against the live LAPI.
 *
 * The two appended fields (req=, sid=) are tolerated by the grok — checked with a
 * plain line, with a trailing duration and with two full UUIDs, all parsing green.
 * They are what ties an access line to the structured log on stderr. The suffix is
 * only appended when at least one of the two is present, so a line with neither
 * stays byte-for-byte the plain combined format that was verified against CrowdSec.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// C0 control characters plus DEL. Written with hex escapes rather than raw bytes so
// the source stays readable in a diff.
const CONTROL_CHARS = new RegExp('[\\x00-\\x1f\\x7f]', 'g');

// Everything `%{WORD}` (`\b\w+\b`) cannot match. See wordSafeMethod().
const NON_WORD_CHARS = new RegExp('[^A-Za-z0-9_]', 'g');

const UTF8 = new TextEncoder();

export interface AccessLogFields {
  ip: string;
  time: Date;
  method: string;
  /** May arrive with a query string; it is stripped before it is written. */
  path: string;
  httpVersion: string;
  status: number;
  bytes: number;
  referer?: string;
  userAgent?: string;
  req?: string;
  sid?: string;
}

/** nginx $time_local, always UTC so the line is unambiguous wherever it is read. */
function formatTime(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${pad(at.getUTCDate())}/${MONTHS[at.getUTCMonth()]}/${at.getUTCFullYear()}:` +
    `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())} +0000`
  );
}

/**
 * Strips C0 control characters and DEL. Only the unquoted `ip` field still needs
 * this — inside a quoted field a control character is encoded rather than removed
 * (see escapeLikeNginx), which is both lossless and safe.
 */
function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, ' ');
}

/** nginx writes `\xNN` with uppercase hex; matching it keeps the two comparable. */
function hexEscape(byte: number): string {
  return `\\x${byte.toString(16).toUpperCase().padStart(2, '0')}`;
}

/**
 * Escapes a field the way nginx itself does, because that is the only escaping the
 * consumer understands.
 *
 * crowdsecurity/nginx-logs reads every quoted field with `%{NOTDQUOTE}`, which is
 * defined as `[^"]*`. It has no concept of an escape sequence: the first raw `"`
 * inside a field is the field's end, full stop, and a `\"` is a backslash followed
 * by that end. A line carrying one does not parse at all — confirmed with
 * `cscli explain` against the live LAPI, where a referer of `"` makes the whole line
 * a parser failure while the same line with `\x22` parses green. A request that does
 * not parse produces no event, no bucket and no decision: one header would have taken
 * its sender out of CrowdSec entirely.
 *
 * That is not a gap in the parser. Real nginx never emits a raw quote inside a field,
 * so the parser never needed to handle one: ngx_http_log_module escapes `"` as `\x22`,
 * `\` as `\x5C`, and every C0 control character, DEL and byte >= 0x80 as `\xNN`.
 * Emitting the same thing keeps every field bounded by construction.
 *
 * Note what that makes moot: there is no backslash-ordering question here, because no
 * raw quote is ever written for a backslash to interact with. An earlier version of
 * this file reasoned carefully about that ordering — correctly, but for grok's
 * `QUOTEDSTRING`, which is not the rule this consumer applies.
 */
function escapeLikeNginx(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) as number;

    if (code === 0x22 || code === 0x5c || code < 0x20 || code === 0x7f) {
      out += hexEscape(code);
    } else if (code <= 0x7e) {
      out += char;
    } else if (code <= 0xff) {
      // Node decodes header bytes as latin-1, so a code unit in this range IS the byte
      // that arrived on the wire — the same one nginx would have escaped.
      out += hexEscape(code);
    } else {
      // Not reachable from an HTTP header, but a direct caller can hand us one. nginx
      // escapes bytes, so encode the character the way the wire would have carried it.
      for (const byte of UTF8.encode(char)) out += hexEscape(byte);
    }
  }
  return out;
}

function quoted(value: string | undefined): string {
  if (!value) return '"-"';
  return `"${escapeLikeNginx(value)}"`;
}

/**
 * The verb reaches `%{WORD}` in the grok, which is `\b\w+\b` and cannot match a
 * hyphen. `M-SEARCH` is the one method in Node's `http.METHODS` that contains one, and
 * llhttp rejects arbitrary custom verbs, so that single method is the whole exposure —
 * but it is enough: verified against the live LAPI, such a line still parses, yet
 * `LePresidente/http-generic-401-bf` does not fire for it. Repeated 401s on that verb
 * are then invisible to the bruteforce scenario while `401` versus `404` still answers
 * whether a token was right.
 *
 * Replaced rather than encoded, deliberately: `M\x2DSEARCH` fails just the same,
 * because `%{WORD}` still cannot reach the space that follows.
 */
function wordSafeMethod(method: string): string {
  return method.replace(NON_WORD_CHARS, '_');
}

/**
 * Both correlation fields are UUIDs by contract, so anything else is not a value to
 * be cleaned up — it is a value that was never ours.
 *
 * `sid` comes straight from the caller-supplied `mcp-session-id` header, and unlike
 * referer and user-agent it is written BARE: no quotes to escape into, nothing to
 * bound it. Without this it can put arbitrary printable text, unbalanced quotes and a
 * plausible-looking second `req=`/`sid=` pair into the tail of a line CrowdSec reads,
 * and an ~8 KB header makes an ~8 KB line. A whole forged LINE stays out of reach for
 * a different reason — Node's HTTP parser rejects CR and LF in a header value — but
 * that is the parser's guarantee, not this function's.
 *
 * Rejected rather than stripped, deliberately. A mangled value still LOOKS like an
 * identifier, so it would send whoever greps for it after a session that never
 * existed; `-` says plainly that nothing usable arrived. The cap is on top of the
 * character rule because 64 valid characters in a row are just as unhelpful.
 */
const IDENTIFIER = new RegExp('^[A-Za-z0-9-]{1,64}$');

function identifierOrDash(value: string | undefined): string {
  if (value === undefined) return '-';
  return IDENTIFIER.test(value) ? value : '-';
}

/**
 * `status`/`bytes` reach a `%{NUMBER}` grok field. A non-finite value (the realistic
 * path: a multi-value header collapsing to an array before it's coerced) would print
 * the literal text "NaN" there and break parsing for that line.
 */
function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function formatAccessLine(fields: AccessLogFields): string {
  const target = fields.path.split('?')[0];
  const request = quoted(`${wordSafeMethod(fields.method)} ${target} HTTP/${fields.httpVersion}`);

  // nginx never quotes this field and CrowdSec's grok expects it bare, so it isn't
  // run through quoted() — but a newline in it is still cheap to strip here rather
  // than trust that resolveClientIp() (Task 4) never hands one back.
  const ip = stripControlChars(fields.ip);

  let line =
    `${ip} - - [${formatTime(fields.time)}] ${request} ` +
    `${finiteOrZero(fields.status)} ${finiteOrZero(fields.bytes)} ` +
    `${quoted(fields.referer)} ${quoted(fields.userAgent)}`;

  if (fields.req !== undefined || fields.sid !== undefined) {
    line += ` req=${identifierOrDash(fields.req)} sid=${identifierOrDash(fields.sid)}`;
  }

  return line;
}
