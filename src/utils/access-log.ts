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

/** Strips C0 control characters and DEL — the one substitution every field gets. */
function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, ' ');
}

/**
 * A user agent or referer is attacker-controlled. Without the control-character strip
 * a newline in one ends the line and starts a forged one in a stream CrowdSec reads.
 *
 * Backslashes are escaped BEFORE quotes, not after. Escaping only the quote leaves a
 * pre-existing backslash untouched, so a value ending in `\"` becomes `\\"` in the
 * output; grok's `QUOTEDSTRING` reads `\\` as one escaped backslash and then treats
 * the quote that follows as the field's real, unescaped close — the field ends one
 * character early and everything after it is misread as content outside the quotes.
 * Escaping the backslash first turns that same input into `\\\"`, which the same
 * parser reads back as backslash-then-quote: the field closes in the right place.
 */
function quoted(value: string | undefined): string {
  if (!value) return '"-"';
  const safe = stripControlChars(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${safe}"`;
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
  const request = quoted(`${fields.method} ${target} HTTP/${fields.httpVersion}`);

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
