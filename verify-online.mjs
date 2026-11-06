import { WebSocket } from "ws";
import { once } from "node:events";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const base = "https://wilder.asia/bili-together",
  result = {};
for (const path of ["/", "/health", "/bili-together.user.js"]) {
  const r = await fetch(base + path);
  assert.equal(r.status, 200);
  const text = await r.text();
  result[path] = { status: r.status, bytes: Buffer.byteLength(text) };
  if (path.endsWith(".js"))
    assert.equal(
      createHash("sha256").update(text).digest("hex"),
      createHash("sha256")
        .update(readFileSync(new URL("bili-together.user.js", import.meta.url)))
        .digest("hex"),
    );
}
const room = randomBytes(12).toString("hex"),
  sockets = [];
async function client(options = {}) {
  const ws = new WebSocket(base.replace("https:", "wss:") + "/ws", {
    origin: "https://www.bilibili.com",
  });
  sockets.push(ws);
  const inbox = [];
  ws.on("message", (raw) => inbox.push(JSON.parse(raw)));
  await once(ws, "open");
  async function get(type) {
    for (let n = 0; n < 200; n++) {
      const i = inbox.findIndex((m) => m.type === type);
      if (i >= 0) return inbox.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error("timeout " + type);
  }
  ws.send(
    JSON.stringify({ type: "join", room, video: "BV1xx411c7mD:1", ...options }),
  );
  return { ws, get, joined: await get("joined") };
}
try {
  const a = await client();
  a.ws.send(
    JSON.stringify({
      type: "state",
      reason: "init",
      time: 42,
      paused: true,
      rate: 1,
    }),
  );
  await a.get("state");
  const b = await client(),
    c = await client();
  assert.equal(c.joined.count, 3);
  assert.equal(c.joined.state.time, 42);
  b.ws.send(
    JSON.stringify({
      type: "state",
      reason: "seeked",
      time: 130,
      paused: false,
      rate: 1.5,
    }),
  );
  assert.equal((await a.get("state")).state.time, 130);
  assert.equal((await c.get("state")).state.rate, 1.5);
  result.websocket = { connections: 3, lateJoin: true, multiwaySync: true };
  const f = await client({ follow: true });
  f.ws.send(
    JSON.stringify({
      type: "state",
      reason: "init",
      video: "BV1xx411c7mD:1",
      time: 12,
      paused: true,
      rate: 1,
    }),
  );
  await f.get("state");
  const g = await client({ follow: true, video: "ep12345" });
  assert.equal(g.joined.state.video, "BV1xx411c7mD:1");
  const switcher = await client({
    follow: true,
    navigate: true,
    video: "BV18wxY63Erp:2",
  });
  assert.equal((await f.get("state")).state.video, "BV18wxY63Erp:2");
  assert.equal((await g.get("state")).state.video, "BV18wxY63Erp:2");
  assert.equal(switcher.joined.state.video, "BV18wxY63Erp:2");
  result.continuousSync = { crossVideoJoin: true, switchBroadcast: true };
} finally {
  for (const s of sockets) s.close();
}
result.checkedAt = new Date().toISOString();
writeFileSync(
  new URL("online-checks.json", import.meta.url),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
