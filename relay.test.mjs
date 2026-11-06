import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createRelay } from "./server.mjs";

test("多人控制、后加入对齐、分P隔离、接管、断线与校验", async () => {
  const { server, wss, rooms } = createRelay();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `ws://127.0.0.1:${server.address().port}/ws`,
    clients = [];
  async function client(video = "BV1xx411c7mD:1", room = "test-room-123456") {
    const ws = new WebSocket(url);
    clients.push(ws);
    const inbox = [];
    ws.on("message", (x) => inbox.push(JSON.parse(x)));
    await once(ws, "open");
    ws.send(JSON.stringify({ type: "join", room, video }));
    async function get(type, predicate = () => true) {
      for (let n = 0; n < 200; n++) {
        const i = inbox.findIndex((m) => m.type === type && predicate(m));
        if (i >= 0) return inbox.splice(i, 1)[0];
        await new Promise((r) => setTimeout(r, 5));
      }
      throw Error("timeout " + type);
    }
    const joined = await get("joined");
    return { ws, get, joined, send: (m) => ws.send(JSON.stringify(m)) };
  }
  try {
    const a = await client();
    a.send({ type: "state", reason: "init", time: 10, paused: true, rate: 1 });
    await a.get("state");
    const b = await client(),
      c = await client();
    assert.equal(b.joined.state.time, 10);
    assert.equal(c.joined.count, 3);
    b.send({
      type: "state",
      reason: "seeked",
      time: 123,
      paused: false,
      rate: 1.5,
    });
    const changed = await a.get("state");
    assert.equal(changed.state.time, 123);
    assert.equal(changed.leader, b.joined.id);
    await c.get("state");
    a.send({ type: "state", reason: "tick", time: 999, paused: true, rate: 1 });
    const d = await client();
    assert.ok(d.joined.state.time >= 123 && d.joined.state.time < 126);
    const other = await client("BV1xx411c7mD:2");
    assert.equal(other.joined.state, null);
    assert.equal(other.joined.count, 1);
    b.send({
      type: "state",
      reason: "pause",
      time: 125,
      paused: true,
      rate: 1.5,
    });
    assert.equal((await c.get("state")).state.paused, true);
    b.ws.close();
    await a.get("presence", (m) => m.leader === a.joined.id);
    c.send({
      type: "state",
      reason: "ratechange",
      time: 125,
      paused: true,
      rate: 2,
    });
    assert.equal((await a.get("state")).state.rate, 1.5);
    assert.equal((await a.get("state")).state.rate, 2);
    const bad = new WebSocket(url);
    clients.push(bad);
    await once(bad, "open");
    bad.send(JSON.stringify({ type: "join", room: "short", video: "BV123:1" }));
    const [code] = await once(bad, "close");
    assert.equal(code, 1008);
    const wrong = new WebSocket(url, { origin: "https://evil.example" });
    wrong.on("error", () => {});
    const [, response] = await once(wrong, "unexpected-response");
    assert.equal(response.statusCode, 401);
    wrong.terminate();
  } finally {
    for (const ws of clients) ws.terminate();
    for (const ws of wss.clients) ws.terminate();
    await new Promise((r) => wss.close(r));
    await new Promise((r) => server.close(r));
  }
  assert.equal(rooms.size, 0);
});
