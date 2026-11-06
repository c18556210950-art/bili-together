import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

test("扩展工具栏只给当前标签页发消息，未运行时提示刷新", async () => {
  let click,
    closed = false,
    fail = false;
  const status = { textContent: "" };
  const context = {
    document: {
      querySelector: (selector) =>
        selector === "#status"
          ? status
          : { addEventListener: (event, fn) => (click = fn) },
    },
    window: { close: () => (closed = true) },
    chrome: {
      tabs: {
        query: async () => [{ id: 7 }],
        sendMessage: async (id, message) => {
          assert.equal(id, 7);
          assert.equal(message.type, "bt-show-panel");
          if (fail) throw Error("not installed");
          return { ok: true };
        },
      },
    },
  };
  vm.runInNewContext(
    readFileSync(new URL("extension/popup.js", import.meta.url), "utf8"),
    context,
  );
  await click();
  assert.equal(closed, true);
  closed = false;
  fail = true;
  await click();
  assert.equal(closed, false);
  assert.match(status.textContent, /刷新/);
});
