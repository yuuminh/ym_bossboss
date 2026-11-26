// Boss Alarm — bot Discord: tới giờ boss thì tự vào voice room đọc "Ca sáu có boss", ding khi boss ra.
// Đọc cùng Google Sheet với trang web. Chạy: npm install  →  điền .env  →  npm start
try { await import("dotenv/config"); } catch (e) { /* chưa cài dotenv thì dùng biến môi trường của máy */ }
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

process.env.TZ = process.env.TZ || "Asia/Ho_Chi_Minh";   // giờ trong sheet là giờ VN, dù máy chạy bot ở đâu

/* ====================== CẤU HÌNH (đọc từ .env) ====================== */
const env = (k, d) => ((process.env[k] ?? "").trim() || d);
const bool = (k, d) => { const v = env(k, ""); return v ? /^(1|true|yes|on)$/i.test(v) : d; };
const clamp = (n, a, b) => Math.min(b, Math.max(a, Number.isFinite(n) ? n : a));
const CFG = {
  token: env("DISCORD_TOKEN", ""),
  channelId: env("VOICE_CHANNEL_ID", ""),
  sheetId: env("SHEET_ID", "1_1G2sCGX63sY6g01B2qBoGOu2WfmNDl3p7Yx_DzYsMc"),
  gid: env("GID", "1206146091"),
  colGroup: env("COL_GROUP", "B"), colName: env("COL_NAME", "E"), colTime: env("COL_TIME", "G"),
  warn: clamp(+env("WARN_SECONDS", 60), 5, 600),
  refresh: clamp(+env("REFRESH_SECONDS", 30), 10, 600),
  graceMs: clamp(+env("GRACE_MINUTES", 10), 1, 60) * 60000,
  speed: clamp(+env("SPEED", 1.5), 0.5, 2),
  volume: clamp(+env("VOLUME", 1), 0, 2),
  saySv: bool("SAY_SERVER", true),
  sayName: bool("SAY_NAME", false),
  spawn: env("SPAWN_SOUND", "ding").toLowerCase(),   // ding | ting | voice | off
  servers: env("SERVERS", "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
  bossWord: env("BOSS_WORD", "boss"),
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOUNDS = path.join(HERE, "sounds");
const CACHE = path.join(HERE, "cache");
const pad = (n) => String(n).padStart(2, "0");
const stamp = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const log = (...a) => console.log(`[${stamp()}]`, ...a);

/* ====================== ĐỌC GOOGLE SHEET (giống trang web) ====================== */
function colIndex(letter) {
  let n = 0;
  for (const c of letter.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Đọc NGÀY + giờ từ chữ: "22/11 23:26:00", "23:26:00 22/11", "2026-11-22 23:26:00"...
function parseFullDate(text) {
  const s = (text || "").trim();
  if (!s) return null;
  let y, mo, d, h, mi, se, m;
  if ((m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/))) {
    [y, mo, d, h, mi, se] = [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0)];
  } else if ((m = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/))) {
    [d, mo, y, h, mi, se] = [+m[1], +m[2], m[3] ? +m[3] : null, +m[4], +m[5], +(m[6] || 0)];
  } else if ((m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/))) {
    [h, mi, se, d, mo, y] = [+m[1], +m[2], +(m[3] || 0), +m[4], +m[5], m[6] ? +m[6] : null];
  } else return null;
  if (y != null && y < 100) y += 2000;
  const now = Date.now();
  let t;
  if (y == null) {
    y = new Date().getFullYear();
    t = new Date(y, mo - 1, d, h, mi, se).getTime();
    if (t < now - 180 * 86400000) t = new Date(y + 1, mo - 1, d, h, mi, se).getTime();
    else if (t > now + 180 * 86400000) t = new Date(y - 1, mo - 1, d, h, mi, se).getTime();
  } else t = new Date(y, mo - 1, d, h, mi, se).getTime();
  return Number.isNaN(t) ? null : t;
}

// 1 ô của sheet → { s: chữ hiển thị, t: mili-giây nếu ô có sẵn NGÀY }
function cellOf(c) {
  if (!c) return { s: "", t: null };
  const v = c.v;
  let s = c.f != null ? String(c.f) : (v == null || Array.isArray(v) ? "" : String(v));
  let t = null;
  if (typeof v === "string" && v.startsWith("Date(")) {
    const n = (v.match(/\d+/g) || []).map(Number);
    if (n[0] >= 2000 && n.length >= 6) t = new Date(n[0], n[1], n[2], n[3], n[4], n[5]).getTime();
    if (!s && n.length >= 6) s = `${n[3]}:${pad(n[4])}:${pad(n[5])}`;
  } else if (Array.isArray(v) && !s) {
    s = `${v[0]}:${pad(v[1] || 0)}:${pad(v[2] || 0)}`;
  }
  return { s: s.trim(), t };
}

async function fetchSheetRows() {
  const base = `https://docs.google.com/spreadsheets/d/${CFG.sheetId}/gviz/tq?gid=${CFG.gid}&_=${Date.now()}`;
  try {
    const res = await fetch(base + "&tqx=out:json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const txt = await res.text();
    const j = JSON.parse(txt.slice(txt.indexOf("(") + 1, txt.lastIndexOf(")")));
    if (j.status === "error" || !j.table) throw new Error("gviz json error");
    return j.table.rows.map((r) => (r.c || []).map(cellOf));
  } catch (e) { /* thử lại bằng CSV */ }
  const res = await fetch(base + "&tqx=out:csv", { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status + " (sheet đã chia sẻ 'Bất kỳ ai có đường liên kết' chưa?)");
  return parseCSV(await res.text()).map((r) => r.map((s) => ({ s: (s || "").trim(), t: null })));
}

// Server lấy từ tên boss: phần trước dấu "-" cuối cùng. "T7-Cruma" → T7
function groupOf(name, fallback) {
  const i = name.lastIndexOf("-");
  const g = i > 0 ? name.slice(0, i).trim() : "";
  return g || fallback || "?";
}

async function loadBosses() {
  const rows = await fetchSheetRows();
  const iG = colIndex(CFG.colGroup), iN = colIndex(CFG.colName), iT = colIndex(CFG.colTime);
  const empty = { s: "", t: null };
  const out = [];
  for (const r of rows) {
    const cT = r[iT] || empty;
    const name = (r[iN] || empty).s;
    const grp = (r[iG] || empty).s;
    if (!name) continue;
    let t = cT.t;
    if (t == null) t = parseFullDate(cT.s);
    let h, mi, se;
    if (t != null) {
      const d = new Date(t); h = d.getHours(); mi = d.getMinutes(); se = d.getSeconds();
    } else {
      const m = cT.s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (!m) continue;                       // boss chưa có giờ → bỏ qua
      [h, mi, se] = [+m[1], +m[2], +(m[3] || 0)];
    }
    out.push({ group: groupOf(name, grp), name, h, m: mi, s: se, t });
  }
  return out;
}

// Thời điểm boss ra: có ngày thì dùng đúng ngày đó; chỉ có giờ thì lấy lần gần nhất (qua quá hạn thì sang ngày mai)
function targetOf(b, now) {
  if (b.t != null) return new Date(b.t);
  const t = new Date(now);
  t.setHours(b.h, b.m, b.s, 0);
  if (t - now < -CFG.graceMs) t.setDate(t.getDate() + 1);
  return t;
}

/* ====================== CÂU ĐỌC ====================== */
// Cách đọc tên boss (phần sau dấu "-"). Không có trong danh sách thì đọc nguyên chữ. Muốn sửa / thêm cứ thêm 1 dòng.
const PRONOUNCE = {
  "Andras": "an đrát",
  "Behemoth": "be he mót",
   "Chertuba": "chê tu ba",
  "Core Susceptor": "xê bảy",
  "Cruma Ô Uế": "xê bốn",
  "Gương của sự lãng quên": "Gương",
  "Hysilome": "Hiệp sỉ lợn",
  "Katan": "xê sáu",
  "Kelsus": "kêu xớt",
  "Orfen": "O phen",
  "Pan Dra'eed": "pan đờ ré",
  "Phoenix": "Phe nít",
  "Quái đột biến Cruma": "Đầm cờ-ru-ma",
  "Randor": "ran đo",
  "Savan": "kiến hai",
   "Selu": "xê lu",
  "Talkin": "lệ tổ",
  "Tempest": "tem pét",
  "Thanatos": "tha na tót",
  "Timiniel": "ti mi neo",
};
// so khớp không phân biệt hoa/thường, dấu, kiểu dấu nháy
const normName = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/[’‘`´]/g, "'").toLowerCase().replace(/\s+/g, " ").trim();
const PRON_MAP = new Map(Object.entries(PRONOUNCE).map(([k, v]) => [normName(k), v]));

// K6 → "Ca sáu", T7XL → "Tê bảy xâm lược" (không khớp dạng chữ+số thì trả về null)
function serverWords(group) {
  const letters = { K: "Ca", T: "Tê", L: "Lờ" };
  const digits = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
  const g = String(group || "").replace(/[\s-]+/g, "").toUpperCase();
  const m = g.match(/^([A-Z]+?)(\d+)(XL)?$/);
  if (!m) return null;
  const [, l, d, xl] = m;
  const say = [...l].map((c) => letters[c] || c).join(" ");
  return `${say} ${[...d].map((x) => digits[+x]).join(" ")}${xl ? " xâm lược" : ""}`;
}

// "T7-Katan" → "Tê bảy xê sáu"; "K6XL-Andras" → "Ca sáu xâm lược an đrát"
function spokenName(name) {
  name = String(name || "");
  const i = name.lastIndexOf("-");
  const group = i > 0 ? name.slice(0, i).trim() : "";
  const boss = (i > 0 ? name.slice(i + 1) : name).trim();
  const bossSay = PRON_MAP.get(normName(boss)) || boss;
  const gs = group ? (serverWords(group) || group) : "";
  return `${gs} ${bossSay}`.trim();
}


// "T7" → "Tê bảy" + " có boss"
function serverPhrase(group) {
  const w = serverWords(group);
  return `${w || String(group || "").replace(/-/g, " ")} có ${CFG.bossWord}`;
}

/* ====================== ÂM THANH ====================== */
// Tự tạo file ding / ting (không cần tải file âm thanh nào)
function makeWav(file, hits, total) {
  const sr = 48000, n = Math.floor(sr * total);
  const pcm = Buffer.alloc(n * 2);
  for (const { at, dur, freq } of hits) {
    const s0 = Math.floor(at * sr), len = Math.floor(dur * sr);
    for (let i = 0; i < len && s0 + i < n; i++) {
      const t = i / sr;
      const amp = Math.exp((-6 * t) / dur) * Math.min(1, i / 200);
      const v = Math.round(Math.sin(2 * Math.PI * freq * t) * amp * 0.6 * 32767);
      const idx = (s0 + i) * 2;
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, pcm.readInt16LE(idx) + v)), idx);
    }
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}

function ensureSounds() {
  fs.mkdirSync(SOUNDS, { recursive: true });
  fs.mkdirSync(CACHE, { recursive: true });
  const ding = path.join(SOUNDS, "ding.wav"), ting = path.join(SOUNDS, "ting.wav");
  if (!fs.existsSync(ding)) makeWav(ding, [{ at: 0, dur: 0.8, freq: 880 }, { at: 0.9, dur: 0.8, freq: 880 }], 1.8);
  if (!fs.existsSync(ting)) makeWav(ting, [{ at: 0, dur: 0.45, freq: 1760 }, { at: 0.3, dur: 0.45, freq: 1760 }], 0.9);
  return { ding, ting };
}

// Giọng tiếng Việt của Google Dịch (cách không chính thức, cần mạng). Tải 1 lần rồi lưu lại trong thư mục cache.
async function ttsFile(text) {
  const f = path.join(CACHE, crypto.createHash("sha1").update(text).digest("hex") + ".mp3");
  if (fs.existsSync(f)) return f;
  const url = "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=vi&q=" + encodeURIComponent(text);
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" } });
  if (!res.ok) throw new Error("Google Dịch trả về HTTP " + res.status);
  fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  return f;
}

/* ====================== KẾT NỐI DISCORD VOICE ====================== */
let V = null;            // thư viện voice (nạp khi chạy bot)
let prism = null;
let connection = null;
let player = null;
let sounds = null;

async function connectVoice(client) {
  const channel = await client.channels.fetch(CFG.channelId);
  if (!channel || !channel.guild || !channel.isVoiceBased()) throw new Error("VOICE_CHANNEL_ID không phải kênh voice");
  if (connection) { try { connection.destroy(); } catch (e) {} }
  connection = V.joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });
  connection.on(V.VoiceConnectionStatus.Disconnected, async () => {
    try {   // bị kéo sang phòng khác / mất mạng ngắn thì tự nối lại
      await Promise.race([
        V.entersState(connection, V.VoiceConnectionStatus.Signalling, 5000),
        V.entersState(connection, V.VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch (e) {
      log("Mất kết nối voice, thử vào lại sau 5 giây…");
      setTimeout(() => connectVoice(client).catch((err) => log("Không vào lại được:", err.message)), 5000);
    }
  });
  await V.entersState(connection, V.VoiceConnectionStatus.Ready, 30_000);
  connection.subscribe(player);
  log(`✅ Đã vào voice: #${channel.name} (${channel.guild.name})`);
}

// Phát 1 file (mp3/wav), đợi phát xong mới trả về
async function playFile(file, speed = 1) {
  if (!connection || connection.state.status !== V.VoiceConnectionStatus.Ready) {
    try { await V.entersState(connection, V.VoiceConnectionStatus.Ready, 8000); } catch (e) { log("⚠️ Chưa vào được voice, bỏ qua âm thanh này"); return; }
  }
  const args = ["-analyzeduration", "0", "-loglevel", "0", "-i", file];
  if (speed !== 1) args.push("-af", `atempo=${speed}`);
  args.push("-f", "s16le", "-ar", "48000", "-ac", "2");
  const ff = new prism.FFmpeg({ args });
  const res = V.createAudioResource(ff, { inputType: V.StreamType.Raw, inlineVolume: true });
  if (res.volume) res.volume.setVolume(CFG.volume);
  player.play(res);
  try {
    await V.entersState(player, V.AudioPlayerStatus.Playing, 10_000);
    await V.entersState(player, V.AudioPlayerStatus.Idle, 60_000);
  } catch (e) { player.stop(true); }
}

async function say(text) {
  try { await playFile(await ttsFile(text), CFG.speed); }
  catch (e) { log("⚠️ Không đọc được bằng Google Dịch:", e.message, "→ phát tiếng ding thay"); await playFile(sounds.ding); }
}

// Hàng đợi: các âm thanh phát lần lượt, không đè nhau
const queue = [];
let busy = false;
function enqueue(job) { queue.push(job); pump(); }
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    try { await job(); } catch (e) { log("⚠️ Lỗi phát âm thanh:", e.message); }
  }
  busy = false;
}

/* ====================== VÒNG LẶP BÁO ====================== */
let bosses = [];
const warned = new Set();
const spawned = new Set();

function check() {
  const now = new Date();
  const toWarn = [], toSpawn = [];
  for (const b of bosses) {
    if (CFG.servers.length && !CFG.servers.includes(b.group.toUpperCase())) continue;
    const target = targetOf(b, now);
    const remaining = Math.round((target - now) / 1000);
    const key = `${b.name}|${target.toDateString()}|${b.h}:${b.m}:${b.s}`;
    if (remaining > 0 && remaining <= CFG.warn && !warned.has(key)) { warned.add(key); toWarn.push(b); }
    if (remaining <= 0 && remaining > -30 && !spawned.has(key)) { spawned.add(key); toSpawn.push(b); }
  }
  if (warned.size > 1000) warned.clear();
  if (spawned.size > 1000) spawned.clear();

  if (toWarn.length && (CFG.saySv || CFG.sayName)) {
    log("⏰ Sắp ra:", toWarn.map((b) => b.name).join(", "));
    if (CFG.saySv) for (const g of new Set(toWarn.map((b) => b.group))) enqueue(() => say(serverPhrase(g)));
    if (CFG.sayName) for (const b of toWarn) enqueue(() => say(spokenName(b.name)));
  }
  if (toSpawn.length && CFG.spawn !== "off") {
    log("🔔 Boss ra:", toSpawn.map((b) => b.name).join(", "));
    if (CFG.spawn === "voice") enqueue(() => say("Boss ra"));
    else enqueue(() => playFile(CFG.spawn === "ting" ? sounds.ting : sounds.ding));
  }
}

async function refresh() {
  try {
    bosses = await loadBosses();
    log(`📄 Đọc sheet: ${bosses.length} boss có giờ`);
  } catch (e) { log("⚠️ Không đọc được sheet:", e.message); }
}

/* ====================== CHẠY ====================== */
async function main() {
  // Chế độ kiểm tra: node index.js --sheet  → chỉ đọc sheet, in danh sách boss sắp ra, không cần Discord
  if (process.argv.includes("--sheet")) {
    const list = await loadBosses();
    const now = new Date();
    const rows = list
      .map((b) => ({ ...b, target: targetOf(b, now) }))
      .map((b) => ({ ...b, sec: Math.round((b.target - now) / 1000) }))
      .sort((a, b) => a.sec - b.sec)
      .filter((b) => b.sec > -CFG.graceMs / 1000)
      .slice(0, 15);
    console.log(`Đọc được ${list.length} boss có giờ. 15 boss gần nhất (bây giờ là ${stamp()}):`);
    for (const b of rows) console.log(`  ${b.name.padEnd(22)} ${pad(b.target.getHours())}:${pad(b.target.getMinutes())}:${pad(b.target.getSeconds())}  (${b.sec > 0 ? "còn " + b.sec + "s" : "đã ra"})  → "${serverPhrase(b.group)}"`);
    return;
  }

  if (!CFG.token || !CFG.channelId || CFG.token.startsWith("dán_")) {
    console.error("Thiếu DISCORD_TOKEN hoặc VOICE_CHANNEL_ID trong file .env");
    process.exit(1);
  }

  const { Client, Events, GatewayIntentBits } = await import("discord.js");
  V = await import("@discordjs/voice");
  prism = (await import("prism-media")).default;
  sounds = ensureSounds();
  player = V.createAudioPlayer({ behaviors: { noSubscriber: V.NoSubscriberBehavior.Play } });
  player.on("error", (e) => log("⚠️ Lỗi player:", e.message));

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  client.once(Events.ClientReady, async () => {
    log(`🤖 Bot đăng nhập: ${client.user.tag}`);
    try { await connectVoice(client); } catch (e) { log("❌ Không vào được voice:", e.message); }
    await refresh();
    setInterval(refresh, CFG.refresh * 1000);
    setInterval(check, 1000);
    log(`Đang theo dõi. Báo trước ${CFG.warn}s, tốc độ đọc x${CFG.speed}, âm khi boss ra: ${CFG.spawn}`);
  });
  process.on("SIGINT", () => { try { connection?.destroy(); } catch (e) {} client.destroy(); process.exit(0); });
  await client.login(CFG.token);
}

main().catch((e) => { console.error(e); process.exit(1); });
