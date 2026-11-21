"use strict";

/* ================= CẤU HÌNH — CHỈ SỬA PHẦN NÀY ================= */
const CONFIG = {
  // Tài khoản đăng nhập. Lưu dạng mã băm (không lưu mật khẩu thô).
  // Tạo dòng mới bằng trang hash.html rồi dán vào đây. Thêm nhiều tài khoản được.
  USERS: [
    { user: "admin", hash: "1b2d5e686c285637feccee12ed51b6378f5b86021c18285950d81f39308ff6ec" },   // mật khẩu tạm: boss123 → ĐỔI NGAY
  ],

  // ID nằm trong link sheet: docs.google.com/spreadsheets/d/<SHEET_ID>/edit#gid=<GID>
  SHEET_ID: "DAN_ID_SHEET_VAO_DAY",
  GID: "0",                 // số sau "gid=" trong link (tab chứa bảng boss)

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
  voice: saved.voice ?? true,
  beep: saved.beep ?? true,            // nay là: hô "Boss boss"
  voiceName: saved.voiceName ?? "",
  hidden: new Set(saved.hidden ?? []),
  muted: new Set(saved.muted ?? []),   // boss bị tắt chuông (lưu theo tên)
  voiceByBoss: saved.voiceByBoss ?? {},    // giọng riêng từng boss: { "T7-Katan": "tên giọng" }
  voiceByGroup: saved.voiceByGroup ?? {},  // giọng riêng từng server: { T7: "tên giọng" }
  grace: saved.grace ?? CONFIG.PASSED_GRACE_MINUTES,   // boss đã ra, ngắt khỏi đầu bảng sau bao nhiêu phút
  volume: saved.volume ?? 100,                          // âm lượng 0-100
  look: saved.look ?? CONFIG.LOOKAHEAD_MINUTES,         // hiện boss ra trong bao nhiêu phút tới (0 = tất cả trong ngày)
  colors: saved.colors ?? {},                           // màu từng server: { T7: "#ff6b6b", ... }
  panel: saved.panel ?? true,                           // khung Cài đặt đang mở hay thu gọn
};

// Bảng màu mặc định, mỗi server được gán 1 màu khác nhau (đổi được bằng ô chọn màu trên nút server)
const PALETTE = ["#4f8cff", "#ff8a4c", "#3ecf8e", "#e86bd0", "#f2c94c", "#9b7bff", "#2bc4d9", "#ff6b6b"];

function colorOf(g) {
  if (!settings.colors[g]) {
    const used = new Set(Object.values(settings.colors));
    settings.colors[g] = PALETTE.find((c) => !used.has(c)) || PALETTE[Object.keys(settings.colors).length % PALETTE.length];
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
    warn: settings.warn, voice: settings.voice, beep: settings.beep,
    voiceName: settings.voiceName,
    grace: settings.grace,
    volume: settings.volume,
    look: settings.look,
    colors: settings.colors,
    panel: settings.panel,
    hidden: [...settings.hidden],
    muted: [...settings.muted],
    voiceByBoss: settings.voiceByBoss,
    voiceByGroup: settings.voiceByGroup,
  }));
}

const state = {
  bosses: [],            // [{group, name, h, m, s}]
  groups: new Set(),
  alerted: new Set(),
  audio: null,
  enabled: false,
  lastFetch: null,
  error: null,
};

/* ---------------- Link Google Sheet (lưu trong trình duyệt) ---------------- */
function getSheet() {
  try {
    const s = JSON.parse(localStorage.getItem("bossSheet") || "null");
    if (s && s.id) return s;
  } catch (e) {}
  if (!CONFIG.SHEET_ID.startsWith("DAN_ID")) return { id: CONFIG.SHEET_ID, gid: CONFIG.GID };
  return null;
}

function parseSheetLink(text) {
  const t = (text || "").trim();
  const m = t.match(/\/d\/([\w-]+)/);
  const id = m ? m[1] : (/^[\w-]{25,}$/.test(t) ? t : null);
  if (!id) return null;
  const g = t.match(/[#&?]gid=(\d+)/);
  return { id, gid: g ? g[1] : "0" };
}

function sheetUrl(s) {
  return `https://docs.google.com/spreadsheets/d/${s.id}/edit#gid=${s.gid}`;
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

async function loadSheet() {
  const sh = getSheet();
  if (!sh) {
    state.bosses = [];
    state.error = "Chưa có link Google Sheet — bấm Ẩn/Hiện, dán link vào rồi bấm Lưu";
    return;
  }
  const url = `https://docs.google.com/spreadsheets/d/${sh.id}/gviz/tq?tqx=out:csv&gid=${sh.gid}&_=${Date.now()}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const rows = parseCSV(await res.text());
    const iG = colIndex(CONFIG.COL_GROUP), iN = colIndex(CONFIG.COL_NAME), iT = colIndex(CONFIG.COL_TIME);
    const iD = colIndex(CONFIG.COL_DEATH);
    const bosses = [];
    for (const r of rows) {
      const t = (r[iT] || "").trim();
      const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      const name = (r[iN] || "").trim();
      if (!m || !name) continue;
      bosses.push({
        group: groupOf(name, (r[iG] || "").trim()),
        name,
        h: +m[1], m: +m[2], s: +(m[3] || 0),
        death: (r[iD] || "").trim(),
      });
    }
    state.bosses = bosses;
    state.groups = new Set(bosses.map((b) => b.group));
    state.lastFetch = new Date();
    state.error = bosses.length ? null : "Đọc được sheet nhưng không thấy dòng nào có giờ hợp lệ (kiểm tra cột/GID)";
    renderFilters();
  } catch (e) {
    state.error = "Không tải được sheet: " + e.message + " — kiểm tra đã chia sẻ 'Bất kỳ ai có đường liên kết' chưa";
  }
}

/* ---------------- Âm thanh ---------------- */
function enableAudio() {
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
    `<label class="colorpick" style="color:${colorOf(g)}">${esc(g)} ` +
    `<select data-gvoice="${esc(g)}">${voiceOptions(settings.voiceByGroup[g], "Mặc định")}</select></label>`
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

// Chữ hiển thị ở cột Đếm ngược: "Còn 5 phút", "Còn 1 giờ 4 phút", "Đã ra 3 phút"
function fmtCountdown(sec) {
  if (sec < 0) {
    const m = Math.floor(-sec / 60);
    return m < 1 ? "Vừa ra" : `Đã ra ${m} phút`;
  }
  if (sec < 60) return `Còn ${sec} giây`;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h) return m ? `Còn ${h} giờ ${m} phút` : `Còn ${h} giờ`;
  return `Còn ${m} phút`;
}

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function tick() {
  const now = new Date();
  $("#clock").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const graceMs = settings.grace * 60000;
  const items = [];
  for (const b of state.bosses) {
    if (settings.hidden.has(b.group)) continue;
    const target = new Date(now);
    target.setHours(b.h, b.m, b.s, 0);
    if (target - now < -graceMs) target.setDate(target.getDate() + 1); // đã qua lâu → lần ra kế tiếp (mai)
    const remaining = Math.round((target - now) / 1000);
    items.push({
      ...b, target, remaining,
      tomorrow: target.getDate() !== now.getDate(),
      key: `${b.name}|${target.toDateString()}|${b.h}:${b.m}:${b.s}`,
    });
  }
  items.sort((a, b) => a.remaining - b.remaining);

  // Báo động
  const toAnnounce = [];
  for (const it of items) {
    if (it.remaining <= settings.warn && it.remaining > -30 && !state.alerted.has(it.key)) {
      state.alerted.add(it.key);
      if (!settings.muted.has(it.name)) toAnnounce.push({ name: it.name, group: it.group });
    }
  }
  if (toAnnounce.length && state.enabled) announce(toAnnounce);

  // Hiển thị
  const maxSec = settings.look * 60;
  // Boss đã ra quá thời gian "ngắt" (5/10/15 phút) thì bị cắt khỏi bảng; boss chưa quá thì vẫn giữ.
  // (Boss đã quá giờ nhảy sang giờ ra của ngày mai, chỉ hiện lại khi còn trong khoảng báo trước.)
  const visible = items.filter((i) => (maxSec > 0 ? i.remaining <= maxSec : !i.tomorrow));
  const tb = $("#list");
  const rowClass = (i) =>
    (i.remaining < 0 ? "passed" : i.remaining <= settings.warn ? "imminent" : i.remaining <= 300 ? "soon" : "") +
    (settings.muted.has(i.name) ? " mutedrow" : "");
  const msg = state.error ||
    (!visible.length ? (maxSec > 0 ? `Không có boss nào ra trong ${settings.look / 60} tiếng tới (đổi ở ô "Hiện trước" trong Ẩn/Hiện)` : "Chưa có boss nào (kiểm tra link sheet hoặc đang ẩn hết server)") : null);
  if (msg) {
    tb.innerHTML = `<tr><td class="empty" colspan="5">${esc(msg)}</td></tr>`;
    state.sig = "";
  } else {
    // Chỉ dựng lại bảng khi danh sách đổi; còn lại chỉ cập nhật số đếm ngược
    // (để click vào ô tick không bị mất do bảng bị vẽ lại mỗi giây)
    const sig = visible.map((i) => i.key + (settings.muted.has(i.name) ? "1" : "0") + (settings.voiceByBoss[i.name] || "")).join("#");
    if (sig !== state.sig) {
      state.sig = sig;
      tb.innerHTML = visible.map((i) => {
        const at = `${pad(i.h)}:${pad(i.m)}:${pad(i.s)}`;
        const c = colorOf(i.group);   // màu chữ của server (trùng màu nút server)
        const off = settings.muted.has(i.name);
        const vsel = settings.voiceByBoss[i.name];
        return `<tr class="${rowClass(i)}">
          <td class="name" style="color:${c}">${esc(i.name)}</td>
          <td class="ctl">
            <button class="bell${off ? " off" : ""}" data-name="${esc(i.name)}" title="${off ? "Đang TẮT chuông — bấm để bật lại" : "Đang bật chuông — bấm để tắt báo boss này"}">${off ? "🔕" : "🔔"}</button>
            <span class="vbtn${vsel ? " set" : ""}" title="Chọn giọng đọc riêng cho boss này">🎙<select data-bvoice="${esc(i.name)}">${voiceOptions(vsel, "Theo server / mặc định")}</select></span>
          </td>
          <td class="num">${at}${i.tomorrow ? ' <span class="muted small">mai</span>' : ""}</td>
          <td class="num cd">${fmtCountdown(i.remaining)}</td>
          <td class="num death">${esc(i.death)}</td>
        </tr>`;
      }).join("");
    } else {
      visible.forEach((i, idx) => {
        const tr = tb.rows[idx];
        tr.className = rowClass(i);
        tr.cells[3].textContent = fmtCountdown(i.remaining);
      });
    }
  }

  // Tiêu đề tab
  const next = visible.find((i) => i.remaining >= 0);
  document.title = next ? `${fmt(next.remaining)} ${next.name}` : "Boss Alarm";

  // Dọn key cũ
  if (state.alerted.size > 500) state.alerted.clear();

  $("#status").textContent = state.lastFetch
    ? `Cập nhật sheet lúc ${state.lastFetch.toLocaleTimeString("vi-VN")} · hiện ${visible.length}/${state.bosses.length} boss`
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

// Bấm chuông 🔔 sau tên boss: tắt / bật báo cho boss đó
$("#list").addEventListener("click", (e) => {
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

// Đọc thử ngay khi vừa chọn giọng, để nghe luôn
function previewVoice(bossName, group, voiceName) {
  if (!state.enabled || !("speechSynthesis" in window)) return;
  const sample = bossName || state.bosses.find((b) => b.group === group)?.name || "T7-Katan";
  const g = group || (state.bosses.find((b) => b.name === bossName) || {}).group;
  speechSynthesis.cancel();
  speak(spokenName(sample), voiceFor({ name: bossName || "", group: g }));
}

$("#enableBtn").addEventListener("click", enableAudio);
$("#testBtn").addEventListener("click", () => {
  if (!state.enabled) enableAudio();
  announce([{ name: "T7-Cruma Ô Uế", group: "T7" }]);
});

$("#volRange").value = String(settings.volume);
$("#volVal").textContent = settings.volume + "%";
$("#volRange").addEventListener("input", (e) => {
  settings.volume = +e.target.value;
  $("#volVal").textContent = settings.volume + "%";
  saveSettings();
});
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
$("#beepChk").checked = settings.beep;
$("#beepChk").addEventListener("change", (e) => { settings.beep = e.target.checked; saveSettings(); });

/* ---------------- Ô dán link sheet ---------------- */
function fillSheetBox() {
  const s = getSheet();
  $("#sheetLink").value = s ? sheetUrl(s) : "";
}

async function saveSheet() {
  const s = parseSheetLink($("#sheetLink").value);
  const msg = $("#sheetMsg");
  if (!s) {
    msg.textContent = "❌ Link không đúng";
    msg.className = "err small";
    return;
  }
  localStorage.setItem("bossSheet", JSON.stringify(s));
  state.alerted.clear();
  state.sig = "";
  msg.textContent = "Đang tải…";
  msg.className = "muted small";
  await loadSheet();
  tick();
  if (state.error) {
    msg.textContent = "❌ " + state.error;
    msg.className = "err small";
  } else {
    msg.textContent = `✅ Đã lưu, đọc được ${state.bosses.length} boss`;
    msg.className = "ok small";
  }
}

$("#sheetSave").addEventListener("click", saveSheet);
$("#sheetLink").addEventListener("keydown", (e) => { if (e.key === "Enter") saveSheet(); });

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
  fillSheetBox();
  if (!getSheet()) setPanel(true);   // chưa có link sheet thì tự mở khung Ẩn/Hiện
  loadSheet().then(tick);
  setInterval(loadSheet, CONFIG.REFRESH_SECONDS * 1000);
  setInterval(tick, 1000);
}

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
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
