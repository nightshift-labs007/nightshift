// Redis wire protocol encoder/parser (lib/resp.ts), used for a plain Redis such as Railway's. Run: npm test
import assert from "node:assert/strict";
import test from "node:test";
import { encode, parse, RedisError } from "../lib/resp.ts";

test("encodes a command as an array of bulk strings", () => {
  assert.equal(encode(["SET", "k", 5]).toString(), "*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$1\r\n5\r\n");
  assert.equal(encode(["SET", "é", "x"]).toString("latin1").includes("$2\r\n"), true, "length is in bytes, not characters");
});

test("parses every reply type", () => {
  const b = (s) => Buffer.from(s);
  assert.deepEqual(parse(b("+OK\r\n")), { value: "OK", next: 5 });
  assert.equal(parse(b(":42\r\n")).value, 42);
  assert.equal(parse(b("$-1\r\n")).value, null);
  assert.equal(parse(b("$5\r\nhello\r\n")).value, "hello");
  assert.equal(parse(b("$0\r\n\r\n")).value, "");
  assert.deepEqual(parse(b("*3\r\n$1\r\na\r\n$-1\r\n:7\r\n")).value, ["a", null, 7]);
  assert.deepEqual(parse(b("*0\r\n")).value, []);
  const e = parse(b("-ERR wrong type\r\n")).value;
  assert.ok(e instanceof RedisError && e.message === "ERR wrong type");
});

test("waits for a complete reply, and parses several in a row", () => {
  assert.equal(parse(Buffer.from("$5\r\nhel")), null);
  assert.equal(parse(Buffer.from("*2\r\n$1\r\na\r\n")), null);
  const buf = Buffer.from("+OK\r\n:1\r\n$2\r\nhi\r\n");
  const r1 = parse(buf), r2 = parse(buf, r1.next), r3 = parse(buf, r2.next);
  assert.deepEqual([r1.value, r2.value, r3.value, r3.next], ["OK", 1, "hi", buf.length]);
  assert.equal(parse(Buffer.from("$4\r\na\r\nb\r\n")).value, "a\r\nb", "binary-safe bulk strings");
});
