import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

test("客户端接收状态不回传、用户拖动接管、自动播放受阻与手动恢复", async () => {
  const elements = new Map(),
    timers = [],
    connections = [];
  const el = (id) => {
    if (!elements.has(id))
      elements.set(id, { value: "", textContent: "", hidden: true });
    return elements.get(id);
  };
  class Video extends EventTarget {
    constructor() {
      super();
      this.currentTime = 5;
      this.paused = true;
      this.playbackRate = 1;
      this.duration = 600;
      this.readyState = 4;
      this.seeking = false;
      this.ended = false;
      this.fail = false;
    }
    play() {
      if (this.fail) return Promise.reject(new Error("autoplay"));
      this.paused = false;
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
      this.dispatchEvent(new Event("pause"));
    }
  }
  const video = new Video();
  class WS {
    constructor() {
      this.readyState = 1;
      this.sent = [];
      connections.push(this);
    }
    send(s) {
      this.sent.push(JSON.parse(s));
    }
    close() {
      this.readyState = 3;
    }
    message(m) {
      this.onmessage({ data: JSON.stringify(m) });
    }
  }
  const context = {
    URL,
    URLSearchParams,
    Uint8Array,
    crypto: globalThis.crypto,
    Date,
    Math,
    Number,
    performance,
    WebSocket: WS,
    location: {
      href: "https://www.bilibili.com/video/BV1xx411c7mD/?p=1",
      hash: "",
    },
    GM_getValue: () => "",
    GM_setValue: () => {},
    GM_setClipboard: () => {},
    document: {
      documentElement: { append() {} },
      createElement: () => ({
        style: {},
        attachShadow: () => ({ querySelector: el, set innerHTML(x) {} }),
      }),
      querySelector: () => video,
    },
    setInterval: (fn, ms) => {
      timers.push({ fn, ms });
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  vm.runInNewContext(
    readFileSync(new URL("bili-together.user.js", import.meta.url), "utf8"),
    context,
  );
  el("#room").value = "test-room-123456";
  el("#join").onclick();
  const ws = connections[0];
  ws.onopen();
  assert.equal(ws.sent[0].video, "BV1xx411c7mD:1");
  ws.message({
    type: "joined",
    id: "a",
    leader: "b",
    revision: 1,
    count: 3,
    now: Date.now(),
    state: { time: 50, paused: false, rate: 1.5, at: Date.now() },
  });
  await Promise.resolve();
  assert.ok(video.currentTime >= 50 && video.currentTime < 51);
  assert.equal(video.paused, false);
  assert.equal(ws.sent.filter((x) => x.type === "state").length, 0);
  video.dispatchEvent(new Event("seeked"));
  assert.equal(ws.sent.filter((x) => x.type === "state").length, 0);
  video.currentTime = 150;
  video.dispatchEvent(new Event("seeked"));
  assert.equal(ws.sent.at(-1).reason, "seeked");
  assert.equal(ws.sent.at(-1).time, 150);
  video.pause();
  video.fail = true;
  ws.message({
    type: "state",
    from: "b",
    leader: "b",
    revision: 2,
    state: { time: 170, paused: false, rate: 1, at: Date.now() },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(el("#resume").hidden, false);
  video.fail = false;
  await el("#resume").onclick();
  assert.equal(video.paused, false);
  assert.equal(el("#resume").hidden, true);
  el("#leave").onclick();
  assert.equal(ws.readyState, 3);
});
