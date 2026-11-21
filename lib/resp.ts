// Redis wire protocol (RESP2), just enough for our commands: encode a command, parse replies from a byte stream.
// Pure (no imports) so it can be unit-tested. Used by lib/redis-tcp.ts when REDIS_URL points at a plain Redis.

export type Reply = string | number | null | Reply[] | RedisError;
export class RedisError extends Error {}

export function encode(args: (string | number)[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const a of args) {
    const b = Buffer.from(String(a));
    parts.push(Buffer.from(`$${b.length}\r\n`), b, Buffer.from("\r\n"));
  }
  return Buffer.concat(parts);
}

/** Parses one reply starting at `at`. Returns the reply and the offset after it, or null if the buffer is incomplete. */
export function parse(buf: Buffer, at = 0): { value: Reply; next: number } | null {
  const eol = buf.indexOf("\r\n", at);
  if (eol < 0) return null;
  const type = String.fromCharCode(buf[at]);
  const line = buf.toString("utf8", at + 1, eol);
  const after = eol + 2;
  switch (type) {
    case "+": return { value: line, next: after };
    case "-": return { value: new RedisError(line), next: after };
    case ":": return { value: Number(line), next: after };
    case "$": {
      const n = Number(line);
      if (n < 0) return { value: null, next: after };
      if (buf.length < after + n + 2) return null;
      return { value: buf.toString("utf8", after, after + n), next: after + n + 2 };
    }
    case "*": {
      const n = Number(line);
      if (n < 0) return { value: null, next: after };
      const out: Reply[] = [];
      let pos = after;
      for (let i = 0; i < n; i++) {
        const r = parse(buf, pos);
        if (!r) return null;
        out.push(r.value);
        pos = r.next;
      }
      return { value: out, next: pos };
    }
    default:
      throw new Error(`resp: unexpected reply type ${JSON.stringify(type)}`);
  }
}
