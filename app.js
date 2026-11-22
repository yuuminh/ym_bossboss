"use strict";

/* ================= CẤU HÌNH — CHỈ SỬA PHẦN NÀY ================= */
const CONFIG = {
  // Tài khoản đăng nhập. Lưu dạng mã băm (không lưu mật khẩu thô).
  // Tạo dòng mới bằng trang hash.html rồi dán vào đây. Thêm nhiều tài khoản được.
  USERS: [
    { user: "admin", hash: "1b2d5e686c285637feccee12ed51b6378f5b86021c18285950d81f39308ff6ec" },   // mật khẩu tạm: boss123 → ĐỔI NGAY
  ],

  // ID nằm trong link sheet: docs.google.com/spreadsheets/d/<SHEET_ID>/edit#gid=<GID>
  SHEET_ID: "1_1G2sCGX63sY6g01B2qBoGOu2WfmNDl3p7Yx_DzYsMc",
  GID: "34062309",                 // số sau "gid=" trong link (tab chứa bảng boss)

  // Cột trong sheet (theo chữ cái ở đầu bảng)
  COL_GROUP: "B",           // SV (T7, L2, K6, L7...)
  COL_NAME:  "E",           // Tên boss
  COL_TIME:  "G",           // Tgian hồi sinh (dạng 12:42:00)
  COL_DEATH: "I",           // Giờ chết gần nhất (dạng 21/11 04:42:00)

  CALL_PHRASE: "Boss Boss!", // câu hô (giọng nữ tiếng Anh, hô 2 lần như file ALRMCLOCK)
  WARN_SECONDS: 60,         // báo trước bao nhiêu giây (đổi được trên trang)
  REFRESH_SECONDS: 30,      // bao lâu tải lại sheet 1 lần
  LOOKAHEAD_MINUTES: 120,   // chỉ hiện boss ra trong bao nhiêu phút tới (120 = 2 tiếng, 0 = hiện HẾT danh sách)
  PASSED_GRACE_MINUTES: 10, // mặc định: boss đã ra vẫn ở đầu bảng bao nhiêu phút (chọn 5/10/15 ngay trên trang)
};
/* =============================================================== */

const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, "0");

const saved = JSON.parse(localStorage.getItem("bossAlarm") || "{}");
const settings = {
  warn: saved.warn ?? CONFIG.WARN_SECONDS,
  voice: saved.voiceOn ?? false,       // ô tick "Đọc tên boss" (mặc định tắt: chỉ hô "Boss Boss")
  beep: saved.beep ?? true,            // nay là: hô "Boss boss"
  dingKind: saved.dingKind ?? "ding",   // kiểu âm báo khi boss ra: ding | ting | voice
  ding: saved.dingOn ?? false,         // ô tick "Bật âm báo khi boss ra": ding ding đúng lúc boss ra
  voiceName: saved.voiceName ?? "",
  hidden: new Set(saved.hidden ?? []),
  muted: new Set(saved.muted ?? []),   // boss bị tắt chuông (lưu theo tên)
  voiceByBoss: saved.voiceByBoss ?? {},    // giọng riêng từng boss: { "T7-Katan": "tên giọng" }
  voiceByGroup: saved.voiceByGroup ?? {},  // giọng riêng từng server: { T7: "tên giọng" }
  grace: saved.grace ?? CONFIG.PASSED_GRACE_MINUTES,   // boss đã ra, ngắt khỏi đầu bảng sau bao nhiêu phút
  volume: saved.volume ?? 100,                          // âm lượng 0-100
  look: saved.look ?? CONFIG.LOOKAHEAD_MINUTES,         // hiện boss ra trong bao nhiêu phút tới (0 = tất cả trong ngày)
  // màu từng server: { T7: "#44c173", ... }. Bản màu mặc định mới (colorsV=3) sẽ thay màu cũ 1 lần
  colors: saved.colorsV === 3 ? (saved.colors ?? {}) : {},
  hideDone: saved.hideDone ?? false,                    // bấm tiêu đề "Đếm ngược": loại bỏ boss đã ra
  pins: saved.pins ?? {},                             // boss được "neo" 📌: { key: {name, group, h, m, s, death, t} }
  panel: saved.panel ?? true,                           // khung Cài đặt đang mở hay thu gọn
};

// Bảng màu mặc định, mỗi server được gán 1 màu khác nhau (đổi được bằng ô chọn màu trên nút server)
const PALETTE = ["#4f8cff", "#ff8a4c", "#3ecf8e", "#e86bd0", "#f2c94c", "#9b7bff", "#2bc4d9", "#ff6b6b"];

// Màu mặc định theo tên server
const DEFAULT_COLORS = {
  K6: "#d0437c", K6XL: "#ea9999",
  L2: "#de8f3f", L2XL: "#f6b26b",
  L7: "#2c85d8", L7XL: "#49cae4",
  T7: "#44c173",
};

function colorOf(g) {
  if (!settings.colors[g]) {
    const used = new Set(Object.values(settings.colors));
    settings.colors[g] = DEFAULT_COLORS[g.toUpperCase()] ||
      PALETTE.find((c) => !used.has(c)) || PALETTE[Object.keys(settings.colors).length % PALETTE.length];
    saveSettings();
  }
  return settings.colors[g];
}
function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function textOn(hex) {   // chữ đen hay trắng cho dễ đọc trên nền màu này
  const [r, g, b] = hexRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111" : "#fff";
}
function saveSettings() {
  localStorage.setItem("bossAlarm", JSON.stringify({
    warn: settings.warn, beep: settings.beep,
    voiceOn: settings.voice,
    dingOn: settings.ding,
    dingKind: settings.dingKind,
    voiceName: settings.voiceName,
    grace: settings.grace,
    volume: settings.volume,
    look: settings.look,
    colors: settings.colors,
    colorsV: 3,
    pins: settings.pins,
    hideDone: settings.hideDone,
    panel: settings.panel,
    hidden: [...settings.hidden],
    muted: [...settings.muted],
    voiceByBoss: settings.voiceByBoss,
    voiceByGroup: settings.voiceByGroup,
  }));
}

const state = {
  bosses: [],            // [{group, name, h, m, s}]
  noTime: [],            // boss chưa có giờ hợp lệ (cột G lỗi / trống)
  groups: new Set(),
  alerted: new Set(),
  dinged: new Set(),     // boss đã kêu ding ding lúc ra
  seen: (() => { try { return JSON.parse(localStorage.getItem("bossSeen") || "{}"); } catch (e) { return {}; } })(),
  seenSaved: 0,          // lần cuối ghi "boss đã thấy" vào trình duyệt
  itemsByKey: {},        // boss đang hiện trong bảng (để neo 📌)
  audio: null,
  enabled: false,
  lastFetch: null,
  error: null,
};

/* ---------------- Google Sheet mặc định (cấu hình ở CONFIG phía trên) ---------------- */
function getSheet() {
  return { id: CONFIG.SHEET_ID, gid: CONFIG.GID };
}

// Tên server lấy từ TÊN BOSS (cột E): phần đứng trước dấu "-" cuối cùng.
//   "T7-Cruma Ô Uế"  → T7        "K6-XL-Katan" → K6-XL
// Tên boss không có dấu "-" thì dùng cột B (SV) làm dự phòng.
function groupOf(name, fallback) {
  const i = name.lastIndexOf("-");
  const g = i > 0 ? name.slice(0, i).trim() : "";
  return g || fallback || "?";
}

/* ---------------- Đọc Google Sheet ---------------- */
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

// Đọc NGÀY + giờ từ chữ, ví dụ "22/11/2026 23:26:00", "22/11 23:26", "23:26:00 22/11", "2026-11-22 23:26:00".
// Không có năm thì lấy năm gần ngày hôm nay nhất. Trả về mili-giây hoặc null.
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

// 1 ô của sheet → { s: chữ hiển thị, t: mili-giây nếu ô có sẵn NGÀY (kể cả khi định dạng ô chỉ hiện giờ) }
function cellOf(c) {
  if (!c) return { s: "", t: null };
  const v = c.v;
  let s = c.f != null ? String(c.f) : (v == null || Array.isArray(v) ? "" : String(v));
  let t = null;
  if (typeof v === "string" && v.startsWith("Date(")) {
    const n = (v.match(/\d+/g) || []).map(Number);
    if (n[0] >= 2000 && n.length >= 6) t = new Date(n[0], n[1], n[2], n[3], n[4], n[5]).getTime();   // tháng trong "Date(...)" tính từ 0
    if (!s && n.length >= 6) s = `${n[3]}:${pad(n[4])}:${pad(n[5])}`;
  } else if (Array.isArray(v) && !s) {
    s = `${v[0]}:${pad(v[1] || 0)}:${pad(v[2] || 0)}`;   // chỉ có giờ trong ngày
  }
  return { s: s.trim(), t };
}

// Lấy toàn bộ dòng của sheet. Ưu tiên JSON (đọc được ngày ẩn trong ô giờ), lỗi thì dùng CSV (chỉ có giờ).
async function fetchSheetRows(sh) {
  const base = `https://docs.google.com/spreadsheets/d/${sh.id}/gviz/tq?gid=${sh.gid}&_=${Date.now()}`;
  try {
    const res = await fetch(base + "&tqx=out:json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const txt = await res.text();
    const j = JSON.parse(txt.slice(txt.indexOf("(") + 1, txt.lastIndexOf(")")));
    if (j.status === "error" || !j.table) throw new Error("gviz json error");
    return { rows: j.table.rows.map((r) => (r.c || []).map(cellOf)), mode: "json" };
  } catch (e) { /* thử lại bằng CSV */ }
  const res = await fetch(base + "&tqx=out:csv", { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return { rows: parseCSV(await res.text()).map((r) => r.map((s) => ({ s: (s || "").trim(), t: null }))), mode: "csv" };
}

async function loadSheet() {
  const sh = getSheet();
  if (!sh) {
    state.bosses = [];
    state.error = "Chưa có link Google Sheet — kiểm tra SHEET_ID trong app.js";
    return;
  }
  try {
    const { rows, mode } = await fetchSheetRows(sh);
    const iG = colIndex(CONFIG.COL_GROUP), iN = colIndex(CONFIG.COL_NAME), iT = colIndex(CONFIG.COL_TIME);
    const iD = colIndex(CONFIG.COL_DEATH);
    const empty = { s: "", t: null };
    const bosses = [];
    const noTime = [];   // dòng có tên boss nhưng cột giờ lỗi/trống (#VALUE!, ...) — chỉ hiện khi chọn "Hiện trước: Tất cả"
    let dated = 0;
    for (const r of rows) {
      const cT = r[iT] || empty;
      const name = (r[iN] || empty).s;
      const grp = (r[iG] || empty).s;
      const death = (r[iD] || empty).s;
      if (!name) continue;
      // ngày: (1) ô G có sẵn ngày  (2) cột phụ  (3) chữ trong ô G có kèm ngày
      let t = cT.t;
      if (t == null) t = parseFullDate(cT.s);
      let h, mi, se;
      if (t != null) {
        const d = new Date(t); h = d.getHours(); mi = d.getMinutes(); se = d.getSeconds();
      } else {
        const m = cT.s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (!m) {
          if (name.includes("-")) noTime.push({ group: groupOf(name, grp), name, death });
          continue;
        }
        [h, mi, se] = [+m[1], +m[2], +(m[3] || 0)];
      }
      if (t != null) dated++;
      bosses.push({ group: groupOf(name, grp), name, h, m: mi, s: se, t, death });
    }
    state.bosses = bosses;
    state.noTime = noTime;
    state.dated = dated;
    state.mode = mode;
    state.groups = new Set(bosses.map((b) => b.group));   // chỉ server có boss đã có giờ
    state.lastFetch = new Date();
    state.error = bosses.length ? null : "Đọc được sheet nhưng không thấy dòng nào có giờ hợp lệ (kiểm tra cột/GID)";
    renderFilters();
  } catch (e) {
    state.error = "Không tải được sheet: " + e.message + " — kiểm tra đã chia sẻ 'Bất kỳ ai có đường liên kết' chưa";
  }
}

/* ---------------- Âm thanh ---------------- */
function enableAudio() {
  if (state.enabled) return;
  if (!state.audio) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    state.audio = new Ctx();
    // oscillator im lặng chạy nền để tab không bị trình duyệt làm chậm timer
    const osc = state.audio.createOscillator();
    const g = state.audio.createGain();
    g.gain.value = 0;
    osc.connect(g).connect(state.audio.destination);
    osc.start();
  }
  state.audio.resume();
  if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  if (navigator.wakeLock) navigator.wakeLock.request("screen").catch(() => {});
  state.enabled = true;
  const b = $("#enableBtn");
  b.textContent = "✅ Âm thanh đã bật";
  b.classList.remove("primary");
  b.classList.add("on");
}

// Trình duyệt chỉ cho phát tiếng sau 1 lần người dùng chạm/bấm vào trang.
// Nên âm thanh tự bật ở lần chạm / bấm phím / đăng nhập đầu tiên, không cần bấm nút "Bật âm thanh".
["pointerdown", "keydown", "touchstart"].forEach((ev) =>
  document.addEventListener(ev, () => enableAudio(), { capture: true, passive: true })
);

/* ---------------- Giọng đọc tiếng Việt ---------------- */
// Tất cả giọng trong máy, giọng tiếng Việt xếp lên đầu
function allVoices() {
  if (!("speechSynthesis" in window)) return [];
  const isVi = (v) => (/^vi/i.test(v.lang) ? 1 : 0);
  return speechSynthesis.getVoices().slice().sort((a, b) => isVi(b) - isVi(a) || a.name.localeCompare(b.name));
}

function findVoice(name) {
  return name ? allVoices().find((v) => v.name === name) || null : null;
}

// Giọng mặc định: giọng đã chọn ở ô "Giọng đọc tên", không có thì giọng Việt đầu tiên
function pickVoice() {
  const list = allVoices();
  return list.find((v) => v.name === settings.voiceName) || list.find((v) => /^vi/i.test(v.lang)) || null;
}

// Giọng cho 1 boss: giọng riêng của boss → giọng của server → giọng mặc định
function voiceFor(it) {
  return findVoice(settings.voiceByBoss[it.name]) || findVoice(settings.voiceByGroup[it.group]) || pickVoice();
}

function voiceOptions(selected, defaultLabel) {
  return `<option value="">${esc(defaultLabel)}</option>` + allVoices().map((v) =>
    `<option value="${esc(v.name)}"${v.name === selected ? " selected" : ""}>${esc(v.name)} (${esc(v.lang)})</option>`
  ).join("");
}

function fillVoices() {
  const sel = $("#voiceSel");
  const list = allVoices();
  if (!list.length) {
    sel.innerHTML = `<option>(máy chưa có giọng nào)</option>`;
    sel.disabled = true;
  } else {
    sel.disabled = false;
    sel.innerHTML = list.map((v) => `<option value="${esc(v.name)}">${esc(v.name)} (${esc(v.lang)})</option>`).join("");
    const cur = pickVoice();
    if (cur) sel.value = cur.name;
  }
  renderGroupVoices();
}

// Giọng riêng cho từng server (trong khung Ẩn/Hiện)
function renderGroupVoices() {
  const box = $("#groupVoices");
  if (!box) return;
  box.innerHTML = [...state.groups].sort().map((g) =>
    `<span class="colorpick" style="color:${colorOf(g)}">${esc(g)} ` +
    `<select data-gvoice="${esc(g)}">${voiceOptions(settings.voiceByGroup[g], "Mặc định")}</select>` +
    `<button class="btn mini" data-gplay="${esc(g)}" title="Nghe thử giọng của ${esc(g)}">▶</button></span>`
  ).join("") || '<span class="muted small">(có sheet rồi sẽ hiện)</span>';
}

if ("speechSynthesis" in window) {
  speechSynthesis.onvoiceschanged = () => { fillVoices(); state.sig = ""; if (started) tick(); };
}

function speak(text, voice) {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = voice || pickVoice();
  if (v) u.voice = v;
  u.lang = v ? v.lang : "vi-VN";
  u.rate = 1;
  u.volume = settings.volume / 100;
  speechSynthesis.speak(u);
}

function warnPhrase(s) {
  return s % 60 === 0 ? `${s / 60} phút` : `${s} giây`;
}

function spokenName(name) {
  return name.replace(/-/g, " ");
}

// Câu hô "Boss Boss!" — giống file ALRMCLOCK_v5: giọng nữ tiếng Anh, pitch cao
function englishFemaleVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  return voices.find((v) => /zira|samantha|karen|moira|susan|victoria|fiona|tessa/i.test(v.name)) || voices[0] || null;
}

function sayBoss() {
  const u = new SpeechSynthesisUtterance(CONFIG.CALL_PHRASE);
  u.lang = "en-US";
  const v = englishFemaleVoice();
  if (v) u.voice = v;
  u.pitch = 1.8;
  u.rate = 1.1;
  u.volume = settings.volume / 100;
  speechSynthesis.speak(u);
}

// Dự phòng nếu trình duyệt không có giọng nói: "ding ding"
function playDing() {
  const ctx = state.audio;
  if (!ctx) return;
  [0, 0.9].forEach((d) => {
    const t = ctx.currentTime + d;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    g.gain.setValueAtTime(Math.max(0.001, settings.volume / 100), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.8);
  });
}

// Âm báo lúc boss ra: "ding" | "ting" | "voice" (đọc "Boss ra")
function playChime(kind) {
  if (kind === "voice") {
    if ("speechSynthesis" in window) { speechSynthesis.resume(); speak("Boss ra"); }
    return;
  }
  if (kind !== "ting") return playDing();
  const ctx = state.audio;
  if (!ctx) return;
  [0, 0.3].forEach((d) => {            // ting ting: cao, ngắn, trong
    const t = ctx.currentTime + d;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 1760;
    g.gain.setValueAtTime(Math.max(0.001, settings.volume / 100), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.45);
  });
}

// items: [{ name, group }]
function announce(items) {
  const synth = "speechSynthesis" in window;
  if (synth) speechSynthesis.resume();
  if (settings.beep) {
    if (synth) { sayBoss(); sayBoss(); } else playDing();   // "Boss Boss! Boss Boss!"
  }
  // rồi đọc tên từng boss, mỗi boss bằng giọng riêng của nó (các câu tự xếp hàng nói lần lượt)
  if (settings.voice && synth) items.forEach((it) => speak(spokenName(it.name), voiceFor(it)));
}

/* ---------------- Vòng lặp mỗi giây ---------------- */
function fmt(sec) {
  const a = Math.abs(sec);
  const h = Math.floor(a / 3600), m = Math.floor((a % 3600) / 60), s = a % 60;
  return (sec < 0 ? "-" : "") + (h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`);
}

// Cột Đếm ngược: cả chữ lẫn số đổi màu theo thời gian còn lại
//   trên 15 phút → trắng · trên 5 phút → xám · dưới 5 phút → đỏ
//   đúng phút boss ra → "Đến giờ" (đỏ đậm); sang phút sau → "Đã ra N phút"
function cdLevel(i) {
  if (i.arrived) return "n";          // đang trong phút boss ra
  const sec = i.remaining;
  if (sec < 0) return "x";            // đã ra
  if (sec >= 900) return "w";         // trên 15 phút
  if (sec >= 300) return "m";         // 5 – 15 phút
  return "r";                         // dưới 5 phút
}

function fmtCountdown(i) {
  const sec = i.remaining;
  const n = (v) => `<span class="n">${v}</span>`;
  if (sec <= 0) {
    const t = i.elapsedMin;           // số phút (theo đồng hồ) kể từ phút boss ra
    if (t < 1) return "Đến giờ";
    const h = Math.floor(t / 60), m = t % 60;
    if (h) return m ? `Đã ra ${n(h)} giờ ${n(m)} phút` : `Đã ra ${n(h)} giờ`;
    return `Đã ra ${n(t)} phút`;
  }
  if (sec < 120) {                    // dưới 2 phút: hiện cả giây
    const m = Math.floor(sec / 60), s = sec % 60;
    return m ? `Còn ${n(m)} phút ${n(pad(s))} giây` : `Còn ${n(s)} giây`;
  }
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h) return m ? `Còn ${n(h)} giờ ${n(m)} phút` : `Còn ${n(h)} giờ`;
  return `Còn ${n(m)} phút`;
}

// Icon chuông màu trắng (SVG); tắt chuông thì xám mờ và có gạch chéo
const BELL_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 22a2.2 2.2 0 0 0 2.2-2.2H9.8A2.2 2.2 0 0 0 12 22zm6.8-6.2V11c0-3.1-1.7-5.7-4.6-6.4V4a2.2 2.2 0 1 0-4.4 0v.6C6.9 5.3 5.2 7.9 5.2 11v4.8L3 18v1h18v-1l-2.2-2.2z"/></svg>';
const BELL_OFF_SVG = BELL_SVG.replace("</svg>", '<path d="M3.5 3.5 20.5 20.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>');
function bellBtn(name, off) {
  return `<button class="bell${off ? " off" : ""}" data-name="${esc(name)}" title="${off ? "Đang TẮT chuông — bấm để bật lại" : "Đang bật chuông — bấm để tắt báo boss này"}">${off ? BELL_OFF_SVG : BELL_SVG}</button>`;
}

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Ghi nhớ boss đã thấy (để giữ lại dù sheet đổi dòng ngay lúc boss ra)
function saveSeen(force) {
  const t = Date.now();
  if (!force && t - state.seenSaved < 15000) return;
  state.seenSaved = t;
  try { localStorage.setItem("bossSeen", JSON.stringify(state.seen)); } catch (e) {}
}

function tick() {
  const now = new Date();
  const nowMs = now.getTime();
  $("#clock").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const graceMs = settings.grace * 60000;
  const items = [];
  const have = new Set();
  for (const b of state.bosses) {
    if (settings.hidden.has(b.group)) continue;
    let target, stale = false;
    if (b.t != null) {
      // sheet có NGÀY chính xác → dùng đúng ngày giờ đó, không đoán
      target = new Date(b.t);
      stale = target - now < -graceMs;   // đã ra quá thời gian ngắt mà sheet chưa cập nhật
    } else {
      // sheet chỉ có giờ → lấy lần gần nhất; đã qua quá thời gian ngắt thì sang giờ này của ngày mai
      target = new Date(now);
      target.setHours(b.h, b.m, b.s, 0);
      if (target - now < -graceMs) target.setDate(target.getDate() + 1);
    }
    const remaining = Math.round((target - now) / 1000);
    const it = {
      ...b, target, remaining, stale,
      tomorrow: target.getDate() !== now.getDate(),
      key: `${b.name}|${target.toDateString()}|${b.h}:${b.m}:${b.s}`,
    };
    items.push(it);
    have.add(it.key);
    // nhớ boss sắp ra (trong 2 tiếng) hoặc vừa ra, kèm lần cuối còn thấy trong sheet
    if (remaining <= 7200 && target - now >= -graceMs) {
      state.seen[it.key] = { name: b.name, group: b.group, h: b.h, m: b.m, s: b.s, death: b.death, t: target.getTime(), l: nowMs };
    }
  }
  items.sort((a, b) => (a.stale ? 1 : 0) - (b.stale ? 1 : 0) || a.remaining - b.remaining);

  // Báo động (chỉ boss đang có trong sheet)
  const toAnnounce = [];
  for (const it of items) {
    if (it.remaining <= settings.warn && it.remaining > -30 && !state.alerted.has(it.key)) {
      state.alerted.add(it.key);
      if (!settings.muted.has(it.name)) toAnnounce.push({ name: it.name, group: it.group });
    }
  }
  if (toAnnounce.length && state.enabled) announce(toAnnounce);

  // Âm báo "ding ding" đúng lúc boss ra (nếu có tick chọn)
  let dingNow = false;
  for (const it of items) {
    if (it.remaining <= 0 && it.remaining > -30 && !state.dinged.has(it.key)) {
      state.dinged.add(it.key);
      if (settings.ding && !settings.muted.has(it.name)) dingNow = true;
    }
  }
  if (dingNow && state.enabled) playChime(settings.dingKind);

  // Boss không còn trong sheet nhưng vẫn phải giữ:
  //  - boss đã neo 📌 → giữ đến khi bỏ neo
  //  - boss vừa ra mà sheet đổi dòng ngay lúc đó → giữ đủ thời gian "ngắt" (5/10/15 phút)
  const extras = [];
  const addExtra = (key, s, pinned) => {
    if (have.has(key) || settings.hidden.has(s.group)) return;
    have.add(key);
    extras.push({
      name: s.name, group: s.group, h: s.h, m: s.m, s: s.s, death: s.death || "",
      target: new Date(s.t), remaining: Math.round((s.t - nowMs) / 1000),
      tomorrow: false, ghost: true, key,
    });
  };
  for (const [key, s] of Object.entries(settings.pins)) {
    if (s.t < nowMs - 12 * 3600 * 1000) { delete settings.pins[key]; continue; }   // neo quá 12 tiếng thì tự bỏ
    addExtra(key, s, true);
  }
  for (const [key, s] of Object.entries(state.seen)) {
    const rem = s.t - nowMs;
    if (rem < -graceMs - 60000 && !settings.pins[key]) { delete state.seen[key]; continue; }   // quá hạn, dọn
    // chỉ giữ nếu boss đã tới giờ và trước đó sheet còn liệt kê nó sát giờ ra (tức là nó ra thật, không phải bị sửa/kill)
    if (rem <= 0 && rem >= -graceMs && s.l >= s.t - 60000) addExtra(key, s, false);
  }
  const all = items.concat(extras);
  // nhãn ngày cạnh giờ: "" = hôm nay, "mai" = ngày mai, còn lại hiện dd/mm
  const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
  const dayLabel = (d) => {
    const d0 = new Date(d); d0.setHours(0, 0, 0, 0);
    const diff = Math.round((d0 - today0) / 86400000);
    return diff === 0 ? "" : diff === 1 ? "mai" : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  };
  all.forEach((i) => {
    i.pinned = !!settings.pins[i.key];
    i.day = dayLabel(i.target);
    // phút (theo đồng hồ) đã trôi qua kể từ phút boss ra: 0 = đang đúng phút "Đến giờ", 1 = "Đã ra 1 phút"...
    i.elapsedMin = i.remaining <= 0 ? Math.floor(nowMs / 60000) - Math.floor(i.target.getTime() / 60000) : 0;
    i.arrived = i.remaining <= 0 && i.elapsedMin < 1;
  });
  // boss neo 📌 luôn nằm trên cùng (dù chưa ra), sau đó theo thời gian; boss quá hạn chưa cập nhật xuống cuối
  all.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.stale ? 1 : 0) - (b.stale ? 1 : 0) || a.remaining - b.remaining);
  state.itemsByKey = {};
  all.forEach((i) => { state.itemsByKey[i.key] = i; });
  saveSeen(false);

  // Hiển thị
  const maxSec = settings.look * 60;
  // Boss đã ra quá thời gian "ngắt" thì bị cắt khỏi bảng (trừ boss neo 📌); boss chưa quá thì vẫn giữ.
  // "Hiện trước: Tất cả" = hiện mọi boss, kể cả boss đã bị ngắt (nằm cuối bảng, giờ ra của ngày mai).
  // Bấm tiêu đề "Đếm ngược" → loại bỏ boss đã ra (boss neo 📌 và boss đang "Đến giờ" vẫn giữ)
  const doneGone = (i) => settings.hideDone && i.remaining < 0 && !i.arrived && !i.pinned;
  const visible = all.filter((i) => !doneGone(i) && (i.pinned || i.ghost || maxSec === 0 || (!i.stale && i.remaining <= maxSec)));
  const tb = $("#list");
  // dòng boss: sáng đến hết phút "Đến giờ"; sang phút sau mới nhạt đi (boss neo 📌 thì luôn sáng)
  const rowClass = (i) =>
    (i.arrived ? "imminent arrived" : i.remaining < 0 ? (i.pinned ? "" : "passed") : i.remaining <= settings.warn ? "imminent" : i.remaining <= 300 ? "soon" : "") +
    (i.pinned ? " pinned" : "");
  // "Hiện trước: Tất cả" → hiện luôn cả boss chưa có giờ (cột G lỗi / trống) ở cuối bảng
  const noTimeRows = [];   // boss chưa có giờ: ẩn hẳn, có giờ rồi sẽ tự hiện
  const msg = state.error ||
    (!visible.length && !noTimeRows.length ? (maxSec > 0 ? `Không có boss nào ra trong ${settings.look / 60} tiếng tới (đổi ở ô "Hiện trước" trong bảng cài đặt)` : "Chưa có boss nào (kiểm tra link sheet hoặc đang ẩn hết server)") : null);
  if (msg) {
    tb.innerHTML = `<tr><td class="empty" colspan="5">${esc(msg)}</td></tr>`;   // 5 cột: tên, time ra, đếm ngược, time chết, icon
    state.sig = "";
  } else {
    // Chỉ dựng lại bảng khi danh sách đổi; còn lại chỉ cập nhật số đếm ngược
    // (để click không bị mất do bảng bị vẽ lại mỗi giây)
    const sig = visible.map((i) => i.key + i.day +(settings.muted.has(i.name) ? "1" : "0") + (i.pinned ? "P" : "") + (settings.voiceByBoss[i.name] || "")).join("#") + "|" + noTimeRows.map((n) => n.name + (settings.muted.has(n.name) ? "1" : "0")).join("#");
    if (sig !== state.sig) {
      state.sig = sig;
      const noTimeHtml = noTimeRows.map((n) => {
        const off = settings.muted.has(n.name);
        return `<tr class="notime">
          <td class="name" style="color:${colorOf(n.group)}">${esc(n.name)}</td>
          <td class="num at">—</td>
          <td class="num cd lvl-x">Chưa có giờ</td>
          <td class="num death">${esc(n.death)}</td>
          <td class="ctl">${bellBtn(n.name, off)}</td>
        </tr>`;
      }).join("");
      tb.innerHTML = visible.map((i) => {
        const at = `${pad(i.h)}:${pad(i.m)}:${pad(i.s)}`;
        const c = colorOf(i.group);   // màu chữ của server (trùng màu nút server)
        const off = settings.muted.has(i.name);
        const vsel = settings.voiceByBoss[i.name];
        return `<tr class="${rowClass(i)}">
          <td class="name" style="color:${c}">${esc(i.name)}</td>
          <td class="num at">${at}${i.day ? ` <span class="muted small">${i.day}</span>` : ""}</td>
          <td class="num cd lvl-${cdLevel(i)}">${fmtCountdown(i)}</td>
          <td class="num death">${esc(i.death)}</td>
          <td class="ctl">
            ${bellBtn(i.name, off)}
            <button class="pin${i.pinned ? " on" : ""}" data-key="${esc(i.key)}" title="${i.pinned ? "Đang NEO — boss nằm trên cùng, không bị ngắt. Bấm để bỏ neo" : "Neo boss lên đầu bảng (không bị ngắt) để đánh sau"}">📌</button>
            <span class="vbtn${vsel ? " set" : ""}" title="Chọn giọng đọc riêng cho boss này">🎙<select data-bvoice="${esc(i.name)}">${voiceOptions(vsel, "Theo server / mặc định")}</select></span>
          </td>
        </tr>`;
      }).join("") + noTimeHtml;
    } else {
      visible.forEach((i, idx) => {
        const tr = tb.rows[idx];
        tr.className = rowClass(i);
        tr.cells[2].className = `num cd lvl-${cdLevel(i)}`;
        tr.cells[2].innerHTML = fmtCountdown(i);
      });
    }
  }

  // Tiêu đề tab
  const next = visible.find((i) => i.remaining >= 0);
  document.title = next ? `${fmt(next.remaining)} ${next.name}` : "Boss Alarm";

  // Dọn key cũ
  if (state.alerted.size > 500) state.alerted.clear();
  if (state.dinged.size > 500) state.dinged.clear();

  const nt = state.noTime.length;
  $("#status").textContent = state.lastFetch
    ? `Cập nhật sheet lúc ${state.lastFetch.toLocaleTimeString("vi-VN")} · hiện ${visible.length}/${state.bosses.length} boss có giờ` +
      ` · ${state.dated}/${state.bosses.length} boss có ngày` +
      (nt ? ` · ${nt} boss chưa có giờ (đang ẩn)` : "")
    : "Đang tải sheet…";
}

/* ---------------- UI ---------------- */
// Nút server nằm trên thanh tiêu đề: bấm để ẩn/hiện server đó. Màu nút = màu chữ tên boss trong bảng.
function chipStyle(g) {
  const c = colorOf(g);
  return settings.hidden.has(g)
    ? `border-color:${c};color:${c};background:transparent;opacity:.55`
    : `background:${c};border-color:${c};color:${textOn(c)}`;
}

function renderFilters() {
  $("#filters").innerHTML = [...state.groups].sort().map((g) =>
    `<span class="chip" data-g="${esc(g)}" style="${chipStyle(g)}">${esc(g)}</span>`
  ).join("");
  // Chọn màu từng server: nằm trong khung Ẩn/Hiện
  $("#colorPickers").innerHTML = [...state.groups].sort().map((g) =>
    `<span class="colorpick">${esc(g)} <input type="color" data-color="${esc(g)}" value="${colorOf(g)}">` +
    `<input type="text" class="hex" data-hex="${esc(g)}" value="${colorOf(g)}" maxlength="7" spellcheck="false" placeholder="#rrggbb" title="Dán mã màu hex, ví dụ #ff6b6b"></span>`
  ).join("");
  renderGroupVoices();
}

$("#filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  const g = chip && chip.dataset.g;
  if (!g) return;
  settings.hidden.has(g) ? settings.hidden.delete(g) : settings.hidden.add(g);
  saveSettings();
  renderFilters();
  tick();
});

// "#abc" / "ABC" / "#AABBCC" → "#aabbcc"; sai định dạng thì trả về null
function normHex(v) {
  let h = (v || "").trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(h)) h = h.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/.test(h) ? "#" + h : null;
}

function setGroupColor(g, hex, source) {
  settings.colors[g] = hex;
  saveSettings();
  const chip = $(`#filters .chip[data-g="${CSS.escape(g)}"]`);
  if (chip) chip.setAttribute("style", chipStyle(g));
  // đồng bộ 2 ô (ô chọn màu và ô gõ mã) với nhau
  const picker = $(`#colorPickers [data-color="${CSS.escape(g)}"]`);
  const text = $(`#colorPickers [data-hex="${CSS.escape(g)}"]`);
  if (picker && source !== "picker") picker.value = hex;
  if (text && source !== "text") text.value = hex;
  renderGroupVoices();
  state.sig = "";   // vẽ lại bảng để chữ tên boss đổi màu theo
  tick();
}

$("#colorPickers").addEventListener("input", (e) => {
  const d = e.target.dataset || {};
  if (d.color) {
    setGroupColor(d.color, e.target.value, "picker");
  } else if (d.hex) {
    const hex = normHex(e.target.value);
    e.target.classList.toggle("bad", !hex && e.target.value.trim() !== "");
    if (hex) setGroupColor(d.hex, hex, "text");   // gõ / dán đủ mã hợp lệ là áp dụng ngay
  }
});

// Rời ô gõ mã: chuẩn hóa lại cho gọn (hoặc trả về màu đang dùng nếu gõ sai)
$("#colorPickers").addEventListener("change", (e) => {
  const g = e.target.dataset && e.target.dataset.hex;
  if (!g) return;
  e.target.value = normHex(e.target.value) || settings.colors[g];
  e.target.classList.remove("bad");
});

/* ---------------- Ẩn / Hiện khung cài đặt ---------------- */
function setPanel(open) {
  settings.panel = open;
  $("#settings").hidden = !open;
  $("#settingsBtn").classList.toggle("on", open);
  saveSettings();
}
$("#settingsBtn").addEventListener("click", () => setPanel(!settings.panel));
setPanel(settings.panel);

// Bấm chuông 🔔 sau tên boss: tắt / bật báo cho boss đó.
// Bấm ghim 📌: neo boss lại, không bị ngắt (để đánh sau); bấm lần nữa để bỏ neo.
$("#list").addEventListener("click", (e) => {
  const pin = e.target.closest(".pin");
  if (pin) {
    const key = pin.dataset.key;
    if (settings.pins[key]) {
      delete settings.pins[key];
    } else {
      const it = state.itemsByKey[key];
      if (it) settings.pins[key] = { name: it.name, group: it.group, h: it.h, m: it.m, s: it.s, death: it.death, t: it.target.getTime() };
    }
    saveSettings();
    tick();
    return;
  }
  const bell = e.target.closest(".bell");
  if (!bell) return;
  const name = bell.dataset.name;
  settings.muted.has(name) ? settings.muted.delete(name) : settings.muted.add(name);
  saveSettings();
  tick();
});

// Chọn giọng riêng cho 1 boss (icon 🎙)
$("#list").addEventListener("change", (e) => {
  const name = e.target.dataset && e.target.dataset.bvoice;
  if (!name) return;
  if (e.target.value) settings.voiceByBoss[name] = e.target.value;
  else delete settings.voiceByBoss[name];
  saveSettings();
  tick();
  previewVoice(name, null, e.target.value);
});

// Chọn giọng riêng cho 1 server (trong khung Ẩn/Hiện)
$("#groupVoices").addEventListener("change", (e) => {
  const g = e.target.dataset && e.target.dataset.gvoice;
  if (!g) return;
  if (e.target.value) settings.voiceByGroup[g] = e.target.value;
  else delete settings.voiceByGroup[g];
  saveSettings();
  previewVoice(null, g, e.target.value);
});

// Bấm ▶ cạnh ô chọn giọng của server để nghe thử
$("#groupVoices").addEventListener("click", (e) => {
  const b = e.target.closest("[data-gplay]");
  if (b) previewVoice(null, b.dataset.gplay);
});

// Đọc thử ngay khi vừa chọn giọng, để nghe luôn
function previewVoice(bossName, group, voiceName) {
  if (!state.enabled) enableAudio();
  if (!("speechSynthesis" in window)) return;
  const sample = bossName || state.bosses.find((b) => b.group === group)?.name || "T7-Katan";
  const g = group || (state.bosses.find((b) => b.name === bossName) || {}).group;
  speechSynthesis.cancel();
  speak(spokenName(sample), voiceFor({ name: bossName || "", group: g }));
}

$("#enableBtn").addEventListener("click", enableAudio);
$("#testBtn").addEventListener("click", () => {
  enableAudio();
  announce([{ name: "T7-Cruma Ô Uế", group: "T7" }]);
});

$("#volRange").value = String(settings.volume);
$("#volVal").textContent = settings.volume + "%";
$("#volRange").addEventListener("input", (e) => {
  settings.volume = +e.target.value;
  $("#volVal").textContent = settings.volume + "%";
  saveSettings();
});
// Bấm tiêu đề cột "Đếm ngược": bật/tắt loại bỏ những boss đã ra khỏi bảng
function paintSortHeader() {
  const th = $("#sortCd");
  th.classList.toggle("active", settings.hideDone);
  $("#sortMark").textContent = settings.hideDone ? "▲" : "⇅";
  th.title = settings.hideDone ? "Đang ẨN boss đã ra (boss neo 📌 vẫn giữ). Bấm để hiện lại" : "Bấm để loại bỏ những boss đã ra";
}
$("#sortCd").addEventListener("click", () => {
  settings.hideDone = !settings.hideDone;
  saveSettings();
  paintSortHeader();
  state.sig = "";
  tick();
});
paintSortHeader();

$("#lookSel").value = String(settings.look);
if ($("#lookSel").value !== String(settings.look)) { settings.look = 120; $("#lookSel").value = "120"; }
$("#lookSel").addEventListener("change", (e) => { settings.look = +e.target.value; saveSettings(); state.sig = ""; tick(); });
$("#graceSel").value = String(settings.grace);
$("#graceSel").addEventListener("change", (e) => { settings.grace = +e.target.value; saveSettings(); tick(); });
$("#warnSelect").value = String(settings.warn);
$("#warnSelect").addEventListener("change", (e) => { settings.warn = +e.target.value; saveSettings(); });
fillVoices();
$("#voiceSel").addEventListener("change", (e) => { settings.voiceName = e.target.value; saveSettings(); });
$("#voiceChk").checked = settings.voice;
$("#voiceChk").addEventListener("change", (e) => { settings.voice = e.target.checked; saveSettings(); });
$("#dingChk").checked = settings.ding;
$("#dingChk").addEventListener("change", (e) => { settings.ding = e.target.checked; saveSettings(); if (e.target.checked) { enableAudio(); playChime(settings.dingKind); } });
$("#dingSel").value = settings.dingKind;
if ($("#dingSel").value !== settings.dingKind) { settings.dingKind = "ding"; $("#dingSel").value = "ding"; }
$("#dingSel").addEventListener("change", (e) => { settings.dingKind = e.target.value; saveSettings(); enableAudio(); playChime(settings.dingKind); });
$("#dingTest").addEventListener("click", () => { enableAudio(); playChime(settings.dingKind); });
$("#beepChk").checked = settings.beep;
$("#beepChk").addEventListener("change", (e) => { settings.beep = e.target.checked; saveSettings(); });

/* ---------------- Đăng nhập ---------------- */
// Lưu ý: GitHub Pages là web tĩnh nên đây chỉ là "khóa cửa" ở phía trình duyệt,
// ngăn người lạ vô tình vào dùng. Không phải bảo mật thật sự.
const AUTH_KEY = "bossAuth";

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function tryLogin(user, pass) {
  const u = user.trim().toLowerCase();
  const h = await sha256(u + ":" + pass);
  const ok = CONFIG.USERS.some((x) => x.user.toLowerCase() === u && x.hash === h);
  return ok ? h : null;
}

function hasSession() {
  try {
    const t = localStorage.getItem(AUTH_KEY);
    return !!t && CONFIG.USERS.some((x) => x.hash === t);
  } catch (e) { return false; }
}

let started = false;
function startApp() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  if (started) return;
  started = true;
  loadSheet().then(tick);
  setInterval(loadSheet, CONFIG.REFRESH_SECONDS * 1000);
  setInterval(tick, 1000);
}

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  enableAudio();   // bấm đăng nhập là 1 lần chạm → bật âm thanh luôn
  const err = $("#loginErr");
  err.textContent = "";
  try {
    const h = await tryLogin($("#u").value, $("#p").value);
    if (!h) { err.textContent = "Sai tài khoản hoặc mật khẩu"; return; }
    localStorage.setItem(AUTH_KEY, h);
    $("#p").value = "";
    startApp();
  } catch (e2) {
    err.textContent = "Trình duyệt không hỗ trợ đăng nhập (cần mở bằng https)";
  }
});

$("#logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(AUTH_KEY);
  location.reload();
});

if (hasSession()) startApp();
