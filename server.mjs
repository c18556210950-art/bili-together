import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";

export function createRelay() {
  const validVideo = (v) =>
    typeof v === "string" &&
    /^((BV[0-9A-Za-z]+|av[0-9]+):[1-9][0-9]*|ep[0-9]+)$/.test(v);
  const rooms = new Map();
  const server = http.createServer(async (req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end('{"ok":true}');
    }
    const file =
      path === "/bili-together.user.js"
        ? "bili-together.user.js"
        : path === "/"
          ? "index.html"
          : null;
    if (!file) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      "Content-Type": file.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(await readFile(new URL(file, import.meta.url)));
  });
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 4096,
    perMessageDeflate: false,
    verifyClient: ({ origin }) =>
      !origin || /^https:\/\/(www\.)?bilibili\.com$/.test(origin),
  });
  function send(ws, msg) {
    if (ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 65536) return ws.terminate();
      ws.send(JSON.stringify(msg));
    }
  }
  function broadcast(room, msg) {
    for (const ws of room.clients) send(ws, msg);
  }
  function snapshot(room) {
    if (!room.state) return null;
    return {
      ...room.state,
      time:
        room.state.time +
        (room.state.paused
          ? 0
          : ((Date.now() - room.state.at) / 1000) * room.state.rate),
      at: Date.now(),
    };
  }
  function presence(room) {
    broadcast(room, {
      type: "presence",
      count: room.clients.size,
      leader: room.leader,
    });
  }
  wss.on("connection", (ws) => {
    ws.id = randomUUID();
    ws.alive = true;
    ws.on("pong", () => (ws.alive = true));
    const joinTimeout = setTimeout(() => ws.close(1008, "Join timeout"), 10000);
    ws.on("message", (raw) => {
      const now = Date.now();
      if (now - (ws.window || 0) > 1000) {
        ws.window = now;
        ws.messages = 0;
      }
      if (++ws.messages > 20) return ws.close(1008, "Rate limit");
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return ws.close(1008, "Invalid JSON");
      }
      if (!m || typeof m !== "object") return;
      if (m.type === "ping")
        return send(ws, { type: "pong", sent: m.sent, now });
      if (m.type === "join" && !ws.room) {
        if (
          typeof m.room !== "string" ||
          !/^[A-Za-z0-9_-]{12,80}$/.test(m.room) ||
          typeof m.video !== "string" ||
          !/^((BV[0-9A-Za-z]+|av[0-9]+):[1-9][0-9]*|ep[0-9]+)$/.test(m.video)
        )
          return ws.close(1008, "Invalid room/video");
        const follow = m.follow === true;
        const key = follow ? "follow|" + m.room : m.room + "|" + m.video;
        let room = rooms.get(key);
        if (!room) {
          if (rooms.size >= 500) return ws.close(1013, "Busy");
          room = {
            clients: new Set(),
            state: null,
            leader: ws.id,
            revision: 0,
            key,
            follow,
          };
          rooms.set(key, room);
        }
        if (room.clients.size >= 30) return ws.close(1008, "Room full");
        clearTimeout(joinTimeout);
        room.clients.add(ws);
        ws.room = room;
        ws.video = m.video;
        if (follow && m.navigate === true && room.state?.video !== m.video) {
          room.leader = ws.id;
          room.state = {
            video: m.video,
            time: 0,
            paused: true,
            rate: 1,
            at: now,
          };
          room.revision++;
          broadcast(room, {
            type: "state",
            state: room.state,
            leader: room.leader,
            from: ws.id,
            revision: room.revision,
          });
        }
        send(ws, {
          type: "joined",
          id: ws.id,
          leader: room.leader,
          count: room.clients.size,
          state: snapshot(room),
          revision: room.revision,
          now,
        });
        presence(room);
        return;
      }
      const room = ws.room;
      if (!room) return;
      if (m.type === "state") {
        if (
          room.follow &&
          (!validVideo(m.video) || (room.state && m.video !== room.state.video))
        )
          return;
        if (
          !Number.isFinite(m.time) ||
          m.time < 0 ||
          m.time > 604800 ||
          typeof m.paused !== "boolean" ||
          !Number.isFinite(m.rate) ||
          m.rate < 0.1 ||
          m.rate > 16
        )
          return;
        if (m.reason === "tick" && room.leader !== ws.id) return;
        if (
          m.reason !== "tick" &&
          !["play", "pause", "seeked", "ratechange", "init"].includes(m.reason)
        )
          return;
        if (m.reason === "init" && room.state) return;
        room.leader = ws.id;
        room.state = { time: m.time, paused: m.paused, rate: m.rate, at: now };
        if (room.follow) room.state.video = m.video;
        room.revision++;
        broadcast(room, {
          type: "state",
          state: room.state,
          leader: room.leader,
          from: ws.id,
          revision: room.revision,
        });
      }
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      clearTimeout(joinTimeout);
      const room = ws.room;
      if (!room) return;
      room.clients.delete(ws);
      if (!room.clients.size) rooms.delete(room.key);
      else {
        if (room.leader === ws.id)
          room.leader = room.clients.values().next().value.id;
        presence(room);
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, 25000);
  heartbeat.unref();
  server.on("close", () => clearInterval(heartbeat));
  return { server, wss, rooms };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createRelay();
  server.listen(
    Number(process.env.PORT || 18770),
    process.env.HOST || "127.0.0.1",
    () => console.log("Bili Together ready"),
  );
}
