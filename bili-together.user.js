// ==UserScript==
// @name         B站一起看 · 多人同步
// @namespace    https://wilder.asia/bili-together/
// @version      1.1.0
// @author       c18556210950-art
// @license      MIT
// @homepageURL  https://github.com/c18556210950-art/bili-together
// @supportURL   https://github.com/c18556210950-art/bili-together/issues
// @description  多人同步播放、暂停、进度与倍速，支持稍后再看，面板自动隐藏
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/bangumi/play/*
// @match        https://www.bilibili.com/list/watchlater*
// @match        https://www.bilibili.com/medialist/play/watchlater*
// @match        https://www.bilibili.com/watchlater/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @run-at       document-idle
// @noframes
// @downloadURL  https://wilder.asia/bili-together/bili-together.user.js
// @updateURL    https://wilder.asia/bili-together/bili-together.user.js
// ==/UserScript==
(() => {
  "use strict";
  const endpoint = "wss://wilder.asia/bili-together/ws";
  let socket,
    video,
    videoKey = "",
    room = "",
    id = "",
    leader = "",
    joined = false,
    wanted = false,
    retry = 0,
    retryTimer,
    revision = 0,
    remote = null,
    expected = null,
    offset = 0,
    blocked = false,
    applying = 0,
    connectedAt = 0;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;right:18px;top:110px;z-index:2147483647";
  document.documentElement.append(host);
  const ui = host.attachShadow({ mode: "open" });
  ui.innerHTML = `<style>:host{font:14px system-ui;color:#e9e9f2}section{width:242px;background:#202334;border:1px solid #555b76;border-radius:14px;padding:14px;box-shadow:0 6px 24px #0005}header{display:flex;justify-content:space-between;align-items:center;font-weight:700}button{background:#ed76a1;border:0;border-radius:7px;padding:7px 10px;cursor:pointer;color:#251725}input{box-sizing:border-box;width:100%;margin:10px 0;padding:8px;background:#131625;border:1px solid #626783;border-radius:7px;color:white}p{line-height:1.5;font-size:12px;color:#bbc0d7;margin:8px 0}nav{display:flex;gap:6px;flex-wrap:wrap}#fold{background:transparent;color:#ccc;padding:2px}#resume{margin-top:8px;background:#99d5ff}small{display:block;margin-top:8px;color:#bbc0d7}</style><section><header>B站一起看 <button id="fold">收起</button></header><div id="body"><p>同一视频、同一分 P、同一邀请码即可同步。每个人都能控制。</p><input id="room" placeholder="粘贴邀请码" maxlength="80"><nav><button id="create">新建房间</button><button id="join">加入</button><button id="copy">复制邀请</button><button id="leave">退出</button></nav><small id="status">未加入</small><button id="resume" hidden>点击允许播放 / 重新对齐</button></div></section>`;
  const $ = (s) => ui.querySelector(s),
    status = (t) => ($("#status").textContent = t);
  const mini = document.createElement("button");
  mini.id = "mini";
  mini.textContent = "一起看";
  mini.title = "展开一起看面板";
  mini.hidden = true;
  ui.append(mini);
  const autoLabel = document.createElement("label");
  autoLabel.style.cssText = "display:block;margin-top:10px;font-size:12px";
  autoLabel.innerHTML =
    '<input id="auto-hide" type="checkbox" style="width:auto;margin:0 6px 0 0">闲置 5 秒自动隐藏';
  $("#body").append(autoLabel);
  $("#auto-hide").checked = GM_getValue("autoHide", true);
  let hideTimer,
    hovering = false;
  function collapse() {
    if (
      blocked ||
      ui.activeElement?.matches("input,textarea,select,:focus-visible")
    )
      return;
    $("section").hidden = true;
    mini.hidden = false;
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    if ($("#auto-hide").checked && !hovering)
      hideTimer = setTimeout(collapse, 5000);
  }
  function reveal() {
    $("section").hidden = false;
    $("#body").hidden = false;
    mini.hidden = true;
    scheduleHide();
  }
  mini.onmouseenter = mini.onclick = reveal;
  host.addEventListener("mouseenter", () => {
    hovering = true;
    reveal();
  });
  host.addEventListener("mouseleave", () => {
    hovering = false;
    scheduleHide();
  });
  host.addEventListener("focusin", () => clearTimeout(hideTimer));
  host.addEventListener("focusout", scheduleHide);
  $("#auto-hide").onchange = () => {
    GM_setValue("autoHide", $("#auto-hide").checked);
    scheduleHide();
  };
  scheduleHide();
  const fromHash = new URLSearchParams(location.hash.slice(1)).get("btroom");
  $("#room").value = fromHash || GM_getValue("room", "");
  $("#fold").onclick = () => {
    $("section").hidden = true;
    mini.hidden = false;
  };
  function key() {
    const u = new URL(location.href),
      bv = u.pathname.match(/\/video\/(BV[\da-z]+|av\d+)/i),
      ep = u.pathname.match(/\/bangumi\/play\/(ep\d+)/);
    if (isWatchlater(u)) {
      // 列表页通过 query 切换视频；只用当前标题链接兜底，不能误取推荐视频。
      const titleHref = document
        .querySelector("h1 a[href*='/video/']")
        ?.getAttribute("href");
      const titleURL = titleHref ? new URL(titleHref, u.origin) : null;
      const titleBV = titleURL?.pathname.match(
        /\/video\/(BV[\da-z]+|av\d+)/i,
      )?.[1];
      const queryBV = u.searchParams.get("bvid");
      // 切换期间标题与地址尚未一致时，先停止旧视频状态的发送。
      if (queryBV && titleBV && queryBV !== titleBV) return "";
      const hashVideo = u.hash.match(/\/(BV[\da-z]+|av\d+)(?:\/p(\d+))?/i);
      const current = queryBV || titleBV || hashVideo?.[1];
      const part =
        u.searchParams.get("p") ||
        titleURL?.searchParams.get("p") ||
        hashVideo?.[2] ||
        "1";
      return /^(BV[\da-z]+|av\d+)$/i.test(current || "") &&
        /^[1-9]\d*$/.test(part)
        ? current + ":" + part
        : "";
    }
    return bv
      ? bv[1] + ":" + (u.searchParams.get("p") || "1")
      : ep
        ? ep[1]
        : "";
  }
  function isWatchlater(u) {
    return /^\/(list\/watchlater|medialist\/play\/watchlater|watchlater)(\/|$)/.test(
      u.pathname,
    );
  }
  function send(m) {
    if (socket?.readyState === 1) socket.send(JSON.stringify(m));
  }
  function state(reason) {
    if (
      !joined ||
      !video ||
      video.readyState < 1 ||
      videoKey !== key() ||
      blocked
    )
      return;
    send({
      type: "state",
      reason,
      time: video.currentTime,
      paused: video.paused,
      rate: video.playbackRate,
    });
  }
  function invite() {
    let u = new URL(location.href);
    if (isWatchlater(u)) {
      // 对方无需拥有相同稍后再看列表；邀请打开当前视频的普通播放页。
      const current = key();
      if (!current) return "";
      const [bvid, part] = current.split(":");
      u = new URL("https://www.bilibili.com/video/" + bvid + "/");
      if (part !== "1") u.searchParams.set("p", part);
    }
    u.hash = new URLSearchParams({ btroom: room }).toString();
    return u.href;
  }
  function leave() {
    wanted = false;
    clearTimeout(retryTimer);
    const old = socket;
    socket = null;
    old?.close();
    joined = false;
    remote = expected = null;
    status("已退出");
  }
  function connect() {
    clearTimeout(retryTimer);
    const old = socket;
    socket = null;
    old?.close();
    joined = false;
    remote = expected = null;
    revision = 0;
    id = "";
    leader = "";
    blocked = false;
    videoKey = key();
    if (!videoKey) {
      status("等待视频加载；稍后再看需先登录并选择视频");
      return;
    }
    const ws = (socket = new WebSocket(endpoint));
    status("连接中…");
    ws.onopen = () => {
      if (ws !== socket) return;
      connectedAt = Date.now();
      send({ type: "join", room, video: videoKey });
      send({ type: "ping", sent: Date.now() });
    };
    ws.onmessage = (e) => {
      if (ws !== socket) return;
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type === "pong") {
        offset = m.now - (Date.now() + m.sent) / 2;
        return;
      }
      if (m.type === "joined") {
        offset = m.now - Date.now();
        joined = true;
        retry = 0;
        id = m.id;
        leader = m.leader;
        revision = m.revision;
        status(`已连接 · ${m.count} 人 · 所有人可控制`);
        if (m.state) {
          remote = m.state;
          apply(true);
        } else state("init");
      }
      if (m.type === "presence") {
        leader = m.leader;
        status(`已连接 · ${m.count} 人 · 所有人可控制`);
      }
      if (m.type === "state" && m.revision > revision) {
        revision = m.revision;
        leader = m.leader;
        if (m.from !== id) {
          remote = m.state;
          apply(false);
        } else remote = null;
      }
    };
    ws.onerror = () => status("连接失败，正在重试…");
    ws.onclose = (e) => {
      if (ws !== socket) return;
      joined = false;
      remote = expected = null;
      if (!wanted) return;
      if (e.code === 1008) {
        wanted = false;
        status("加入被拒绝：请检查邀请码或房间是否已满");
        return;
      }
      status("已断线，自动重连中…");
      retryTimer = setTimeout(
        connect,
        Math.min(15000, 1000 * 2 ** Math.min(retry++, 4)),
      );
    };
  }
  function join() {
    const value = $("#room").value.trim();
    if (!/^[A-Za-z0-9_-]{12,80}$/.test(value)) {
      status("邀请码需为 12–80 位字母、数字、下划线或短横线");
      return;
    }
    room = value;
    GM_setValue("room", room);
    wanted = true;
    connect();
  }
  $("#create").onclick = () => {
    $("#room").value = Array.from(
      crypto.getRandomValues(new Uint8Array(12)),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
    join();
  };
  $("#join").onclick = join;
  $("#leave").onclick = leave;
  $("#copy").onclick = () => {
    if (!joined) return status("请先加入或新建房间");
    const link = invite();
    if (!link) return status("视频切换中，请稍后复制邀请");
    GM_setClipboard(link);
    status("邀请链接已复制，发给朋友打开即可");
  };
  function target(s) {
    return (
      s.time +
      (s.paused ? 0 : (Math.max(0, Date.now() + offset - s.at) / 1000) * s.rate)
    );
  }
  function apply(force) {
    if (
      !remote ||
      !video ||
      video.readyState < 1 ||
      videoKey !== key() ||
      video.seeking
    )
      return;
    const s = remote,
      t = Math.min(
        target(s),
        Number.isFinite(video.duration)
          ? Math.max(0, video.duration - 0.05)
          : Infinity,
      );
    expected = {
      paused: s.paused,
      rate: s.rate,
      time: t,
      until: performance.now() + 2500,
    };
    applying++;
    try {
      if (Math.abs(video.currentTime - t) > (force ? 0.15 : 0.8))
        video.currentTime = t;
      if (video.playbackRate !== s.rate) video.playbackRate = s.rate;
      if (s.paused) {
        video.pause();
        blocked = false;
      } else if (video.paused && !blocked) {
        video
          .play()
          .then(() => {
            blocked = false;
            $("#resume").hidden = true;
          })
          .catch(() => {
            blocked = true;
            $("#resume").hidden = false;
            reveal();
            status("浏览器阻止自动播放，请点击允许播放");
          });
      }
    } finally {
      applying--;
    }
  }
  function onLocal(e) {
    if (!joined || videoKey !== key() || applying) return;
    if (expected && performance.now() < expected.until) {
      const matching =
        e.type === "seeked"
          ? Math.abs(video.currentTime - expected.time) < 1.5
          : e.type === "ratechange"
            ? video.playbackRate === expected.rate
            : video.paused === expected.paused;
      if (matching) return;
    }
    if (e.type === "pause" && (video.ended || video.readyState < 3)) return;
    blocked = false;
    $("#resume").hidden = true;
    remote = expected = null;
    state(e.type);
  }
  $("#resume").onclick = async () => {
    blocked = false;
    try {
      if (remote) {
        apply(true);
        if (!remote.paused) await video.play();
      } else await video.play();
      $("#resume").hidden = true;
    } catch {
      blocked = true;
    }
  };
  const events = ["play", "pause", "seeked", "ratechange"];
  function scan() {
    const v = document.querySelector("video");
    if (v !== video) {
      if (video) for (const e of events) video.removeEventListener(e, onLocal);
      video = v;
      if (video) {
        for (const e of events) video.addEventListener(e, onLocal);
        if (remote) apply(true);
        else if (joined && leader === id) state("init");
      }
    }
    if (wanted && key() !== videoKey) connect();
  }
  setInterval(scan, 700);
  scan();
  setInterval(() => {
    if (!joined) return;
    if (video?.seeking) return;
    if (leader === id && video) {
      if (video.readyState >= 3 || video.paused) state("tick");
    } else apply(false);
  }, 1000);
  setInterval(() => {
    if (joined) send({ type: "ping", sent: Date.now() });
    else if (socket?.readyState === 1 && Date.now() - connectedAt > 15000)
      socket.close();
  }, 10000);
  // 邀请链接自动入房；普通打开视频需手动加入，避免其他标签页意外控制。
  if (fromHash) join();
})();
