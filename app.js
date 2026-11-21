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

  CALL_PHRASE: "Boss boss", // câu hô trước khi đọc tên boss (sửa cách viết nếu nghe chưa đúng ý)
  WARN_SECONDS: 60,         // báo trước bao nhiêu giây (đổi được trên trang)
  REFRESH_SECONDS: 30,      // bao lâu tải lại sheet 1 lần
  LOOKAHEAD_MINUTES: 180,   // chỉ hiện boss sắp ra trong bao nhiêu phút
  PASSED_GRACE_MINUTES: 5,  // boss đã ra vẫn hiện thêm bao nhiêu phút
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
  muted: new Set(saved.muted ?? []),   // boss bị tick "không đọc" (lưu theo tên)
};
function saveSettings() {
  localStorage.setItem("bossAlarm", JSON.stringify({
    warn: settings.warn, voice: settings.voice, beep: settings.beep,
    voiceName: settings.voiceName,
    hidden: [...settings.hidden],
    muted: [...settings.muted],
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
    state.error = "Chưa có link Google Sheet — dán link vào ô phía trên rồi bấm Lưu";
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
        group: (r[iG] || "").trim() || "?",
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
function viVoices() {
  if (!("speechSynthesis" in window)) return [];
  return speechSynthesis.getVoices().filter((v) => /^vi/i.test(v.lang));
}

function pickVoice() {
  const list = viVoices();
  return list.find((v) => v.name === settings.voiceName) || list[0] || null;
}

function fillVoices() {
  const sel = $("#voiceSel");
  const list = viVoices();
  if (!list.length) {
    sel.innerHTML = `<option>(máy chưa có giọng Việt)</option>`;
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  sel.innerHTML = list.map((v) => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join("");
  sel.value = pickVoice().name;
}

if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = fillVoices;

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.lang = v ? v.lang : "vi-VN";
  u.rate = 1;
  u.volume = 1;
  speechSynthesis.speak(u);
}

function warnPhrase(s) {
  return s % 60 === 0 ? `${s / 60} phút` : `${s} giây`;
}

function spokenName(name) {
  return name.replace(/-/g, " ");
}

function announce(names) {
  // "Boss boss. T7 Katan" — câu hô thay cho tiếng bíp, rồi đọc tên boss
  const parts = [];
  if (settings.beep) parts.push(CONFIG.CALL_PHRASE);
  if (settings.voice) parts.push(names.map(spokenName).join(", "));
  if (parts.length) speak(parts.join(". "));
}

/* ---------------- Vòng lặp mỗi giây ---------------- */
function fmt(sec) {
  const a = Math.abs(sec);
  const h = Math.floor(a / 3600), m = Math.floor((a % 3600) / 60), s = a % 60;
  return (sec < 0 ? "-" : "") + (h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`);
}

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function tick() {
  const now = new Date();
  $("#clock").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const graceMs = CONFIG.PASSED_GRACE_MINUTES * 60000;
  const items = [];
  for (const b of state.bosses) {
    if (settings.hidden.has(b.group)) continue;
    const target = new Date(now);
    target.setHours(b.h, b.m, b.s, 0);
    if (target - now < -graceMs) target.setDate(target.getDate() + 1); // đã qua lâu → lần ra kế tiếp (mai)
    const remaining = Math.round((target - now) / 1000);
    items.push({ ...b, target, remaining, key: `${b.name}|${target.toDateString()}|${b.h}:${b.m}:${b.s}` });
  }
  items.sort((a, b) => a.remaining - b.remaining);

  // Báo động
  const toAnnounce = [];
  for (const it of items) {
    if (it.remaining <= settings.warn && it.remaining > -30 && !state.alerted.has(it.key)) {
      state.alerted.add(it.key);
      if (!settings.muted.has(it.name)) toAnnounce.push(it.name);
    }
  }
  if (toAnnounce.length && state.enabled) announce(toAnnounce);

  // Hiển thị
  const maxSec = CONFIG.LOOKAHEAD_MINUTES * 60;
  const visible = items.filter((i) => i.remaining <= maxSec);
  const tb = $("#list");
  const rowClass = (i) =>
    (i.remaining < 0 ? "passed" : i.remaining <= settings.warn ? "imminent" : i.remaining <= 300 ? "soon" : "") +
    (settings.muted.has(i.name) ? " mutedrow" : "");
  const msg = state.error ||
    (!visible.length ? `Không có boss nào ra trong ${CONFIG.LOOKAHEAD_MINUTES} phút tới` : null);
  if (msg) {
    tb.innerHTML = `<tr><td class="empty" colspan="5">${esc(msg)}</td></tr>`;
    state.sig = "";
  } else {
    // Chỉ dựng lại bảng khi danh sách đổi; còn lại chỉ cập nhật số đếm ngược
    // (để click vào ô tick không bị mất do bảng bị vẽ lại mỗi giây)
    const sig = visible.map((i) => i.key + (settings.muted.has(i.name) ? "1" : "0")).join("#");
    if (sig !== state.sig) {
      state.sig = sig;
      tb.innerHTML = visible.map((i) => {
        const at = `${pad(i.h)}:${pad(i.m)}:${pad(i.s)}`;
        return `<tr class="${rowClass(i)}">
          <td class="name">${esc(i.name)}</td>
          <td class="num">${at}</td>
          <td class="num cd">${i.remaining < 0 ? "đã ra" : fmt(i.remaining)}</td>
          <td class="num death">${esc(i.death)}</td>
          <td class="mute"><input type="checkbox" data-name="${esc(i.name)}" ${settings.muted.has(i.name) ? "checked" : ""}></td>
        </tr>`;
      }).join("");
    } else {
      visible.forEach((i, idx) => {
        const tr = tb.rows[idx];
        tr.className = rowClass(i);
        tr.cells[2].textContent = i.remaining < 0 ? "đã ra" : fmt(i.remaining);
      });
    }
  }

  // Tiêu đề tab
  const next = visible.find((i) => i.remaining >= 0);
  document.title = next ? `${fmt(next.remaining)} ${next.name}` : "Boss Alarm";

  // Dọn key cũ
  if (state.alerted.size > 500) state.alerted.clear();

  $("#status").textContent = state.lastFetch
    ? `Cập nhật sheet lúc ${state.lastFetch.toLocaleTimeString("vi-VN")} · ${state.bosses.length} boss`
    : "Đang tải sheet…";
}

/* ---------------- UI ---------------- */
function renderFilters() {
  const box = $("#filters");
  box.innerHTML = [...state.groups].sort().map((g) =>
    `<span class="chip ${settings.hidden.has(g) ? "" : "active"}" data-g="${esc(g)}">${esc(g)}</span>`
  ).join("");
}

$("#filters").addEventListener("click", (e) => {
  const g = e.target.dataset.g;
  if (!g) return;
  settings.hidden.has(g) ? settings.hidden.delete(g) : settings.hidden.add(g);
  saveSettings();
  renderFilters();
  tick();
});

$("#list").addEventListener("change", (e) => {
  const name = e.target.dataset && e.target.dataset.name;
  if (!name) return;
  e.target.checked ? settings.muted.add(name) : settings.muted.delete(name);
  saveSettings();
  tick();
});

$("#enableBtn").addEventListener("click", enableAudio);
$("#testBtn").addEventListener("click", () => {
  if (!state.enabled) enableAudio();
  announce(["T7-Cruma Ô Uế"]);
});

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
