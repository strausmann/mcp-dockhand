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

/**
 * A user agent or referer is attacker-controlled. Without this a newline in one ends
 * the line and starts a forged one in a stream CrowdSec reads.
 */
function quoted(value: string | undefined): string {
  if (!value) return '"-"';
  const safe = value.replace(CONTROL_CHARS, ' ').replace(/"/g, '\\"');
  return `"${safe}"`;
}

export function formatAccessLine(fields: AccessLogFields): string {
  const target = fields.path.split('?')[0];
  const request = quoted(`${fields.method} ${target} HTTP/${fields.httpVersion}`);

  let line =
    `${fields.ip} - - [${formatTime(fields.time)}] ${request} ` +
    `${fields.status} ${fields.bytes} ${quoted(fields.referer)} ${quoted(fields.userAgent)}`;

  if (fields.req !== undefined || fields.sid !== undefined) {
    line += ` req=${fields.req ?? '-'} sid=${fields.sid ?? '-'}`;
  }

  return line;
}
