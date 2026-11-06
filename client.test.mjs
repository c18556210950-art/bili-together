import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

function harness(
  url = "https://www.bilibili.com/video/BV1xx411c7mD/?p=1",
  session = new Map(),
  extension = false,
) {
  const elements = new Map(),
    timers = [],
    connections = [],
    timeouts = [],
    created = [];
  const el = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: "",
        textContent: "",
        hidden: true,
        append() {},
      });
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
    chrome: {
      storage: {
        local: {
          get: async () => ({ autoHide: false }),
          set: async (values) => {
            context.extensionSettings = {
              ...context.extensionSettings,
              ...values,
            };
          },
        },
      },
      runtime: {
        id: "test-extension",
        onMessage: {
          addListener: (fn) => {
            context.extensionListener = fn;
          },
        },
      },
    },
    navigator: {
      clipboard: {
        writeText: async (text) => {
          if (context.clipboardError) throw Error("clipboard denied");
          context.copied = text;
        },
      },
    },
    console,
    location: {
      href: url,
      hash: new URL(url).hash,
      assign: (url) => {
        context.navigation = url;
      },
    },
    sessionStorage: {
      getItem: (k) => session.get(k) || null,
      setItem: (k, v) => session.set(k, v),
      removeItem: (k) => session.delete(k),
    },
    GM_getValue: (key, fallback) => fallback,
    GM_setValue: () => {},
    GM_setClipboard: (text) => {
      context.copied = text;
    },
    document: {
      documentElement: { append() {} },
      getElementById: () => null,
      createElement: () => {
        const element = {
          style: {},
          addEventListener() {},
          attachShadow: () => ({
            querySelector: el,
            append() {},
            set innerHTML(x) {},
          }),
        };
        created.push(element);
        return element;
      },
      querySelector: (selector) =>
        selector === "video"
          ? video
          : context.titleHref
            ? { getAttribute: () => context.titleHref }
            : null,
    },
    setInterval: (fn, ms) => {
      timers.push({ fn, ms });
    },
    setTimeout: (fn, ms) => {
      timeouts.push({ fn, ms });
      return timeouts.length;
    },
    clearTimeout: () => {},
  };
  const ready = vm.runInNewContext(
    readFileSync(
      new URL(
        extension ? "extension/content.js" : "bili-together.user.js",
        import.meta.url,
      ),
      "utf8",
    ),
    context,
  );
  return { el, timers, connections, timeouts, created, video, context, ready };
}

test("客户端接收状态不回传、用户拖动接管、自动播放受阻与手动恢复", async () => {
  const { el, connections, timeouts, created, video } = harness();
  const mini = created.find((x) => x.id === "mini");
  assert.ok(mini);
  assert.equal(mini.hidden, true);
  timeouts.find((x) => x.ms === 5000).fn();
  assert.equal(el("section").hidden, true);
  assert.equal(mini.hidden, false);
  mini.onclick();
  assert.equal(el("section").hidden, false);
  assert.equal(mini.hidden, true);
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

test("稍后再看与普通页使用同一视频房间，邀请不包含私人列表参数", () => {
  const { el, connections, context, timers, video } = harness(
    "https://www.bilibili.com/list/watchlater?oid=117556929169055&bvid=BV1jcxX6CEyK&p=2",
  );
  context.titleHref = "//www.bilibili.com/video/BV1jcxX6CEyK";
  el("#room").value = "test-room-123456";
  el("#join").onclick();
  const ws = connections[0];
  ws.onopen();
  assert.equal(ws.sent[0].video, "BV1jcxX6CEyK:2");
  ws.message({
    type: "joined",
    id: "a",
    leader: "a",
    revision: 0,
    count: 1,
    now: Date.now(),
    state: null,
  });
  el("#copy").onclick();
  assert.equal(
    context.copied,
    "https://www.bilibili.com/video/BV1jcxX6CEyK/?p=2#btroom=test-room-123456",
  );
  // 标题先变化、地址尚未变化时不得继续发送旧视频状态。
  context.titleHref = "//www.bilibili.com/video/BV18wxY63Erp";
  const count = ws.sent.length;
  video.currentTime = 0;
  video.dispatchEvent(new Event("seeked"));
  assert.equal(ws.sent.length, count);
  timers.find((x) => x.ms === 700).fn();
  assert.equal(ws.readyState, 3);
  context.location.href =
    "https://www.bilibili.com/list/watchlater?bvid=BV18wxY63Erp";
  timers.find((x) => x.ms === 700).fn();
  connections[1].onopen();
  assert.equal(connections[1].sent[0].video, "BV18wxY63Erp:1");
  assert.equal(connections[1].sent[0].room, "test-room-123456");
});

test("旧稍后再看链接和未选择视频的列表页", () => {
  const legacy = harness("https://www.bilibili.com/watchlater/#/av12345/p2");
  legacy.el("#room").value = "test-room-123456";
  legacy.el("#join").onclick();
  legacy.connections[0].onopen();
  assert.equal(legacy.connections[0].sent[0].video, "av12345:2");
  const empty = harness("https://www.bilibili.com/list/watchlater");
  empty.el("#room").value = "test-room-123456";
  empty.el("#join").onclick();
  assert.equal(empty.connections.length, 0);
  assert.match(empty.el("#status").textContent, /等待视频/);
});

test("持续同步收到换片只跳转一次、跨页面恢复、退出后不再跟随", () => {
  const session = new Map();
  const first = harness(
    "https://www.bilibili.com/video/BV1xx411c7mD/#btroom=test-room-123456&btfollow=1",
    session,
  );
  const ws = first.connections[0];
  ws.onopen();
  assert.equal(ws.sent[0].follow, true);
  ws.message({
    type: "joined",
    id: "a",
    leader: "b",
    revision: 1,
    count: 2,
    now: Date.now(),
    state: {
      video: "BV18wxY63Erp:2",
      time: 7,
      paused: true,
      rate: 1,
      at: Date.now(),
    },
  });
  assert.equal(
    first.context.navigation,
    "https://www.bilibili.com/video/BV18wxY63Erp/?p=2#btroom=test-room-123456&btfollow=1",
  );
  const next = harness(first.context.navigation, session);
  next.connections[0].onopen();
  assert.equal(next.connections[0].sent[0].navigate, false); // 远程跳转不反向发起换片
  const local = harness(
    "https://www.bilibili.com/video/BV1jcxX6CEyK/",
    session,
  );
  local.connections[0].onopen();
  assert.equal(local.connections[0].sent[0].navigate, true);
  local.el("#leave").onclick();
  assert.equal(session.has("bt-session"), false);
  const after = harness(
    "https://www.bilibili.com/video/BV1xx411c7mD/",
    session,
  );
  assert.equal(after.connections.length, 0);
});

test("独立扩展无需 GM API：保存设置、加入房间、工具栏展开、复制失败处理及持续换片", async () => {
  const h = harness(
    "https://www.bilibili.com/list/watchlater?bvid=BV1jcxX6CEyK",
    new Map(),
    true,
  );
  delete h.context.GM_getValue;
  delete h.context.GM_setValue;
  delete h.context.GM_setClipboard;
  await h.ready;
  assert.equal(h.el("#auto-hide").checked, false);
  h.el("#follow").checked = true;
  h.el("#follow").onchange();
  h.el("#room").value = "test-room-123456";
  h.el("#join").onclick();
  const ws = h.connections[0];
  ws.onopen();
  assert.equal(ws.sent[0].follow, true);
  assert.equal(h.context.extensionSettings.room, "test-room-123456");
  ws.message({
    type: "joined",
    id: "a",
    leader: "a",
    revision: 0,
    count: 1,
    now: Date.now(),
    state: null,
  });
  h.el("#copy").onclick();
  await new Promise((r) => setImmediate(r));
  assert.match(h.context.copied, /video\/BV1jcxX6CEyK/);
  assert.match(h.context.copied, /btfollow=1/);
  h.context.clipboardError = true;
  h.el("#copy").onclick();
  await new Promise((r) => setImmediate(r));
  assert.match(h.el("#status").textContent, /复制失败/);
  h.el("section").hidden = true;
  let reply;
  h.context.extensionListener(
    { type: "bt-show-panel" },
    { id: "test-extension" },
    (r) => (reply = r),
  );
  assert.equal(reply.ok, true);
  assert.equal(h.el("section").hidden, false);
  ws.message({
    type: "state",
    from: "b",
    leader: "b",
    revision: 2,
    state: { video: "ep12345", time: 0, paused: true, rate: 1, at: Date.now() },
  });
  assert.equal(
    h.context.navigation,
    "https://www.bilibili.com/bangumi/play/ep12345#btroom=test-room-123456&btfollow=1",
  );
  const manifest = JSON.parse(
    readFileSync(new URL("extension/manifest.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage", "clipboardWrite"]);
  for (const value of Object.values(manifest.icons))
    assert.ok(
      readFileSync(new URL("extension/" + value, import.meta.url)).length > 0,
    );
});
