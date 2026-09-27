// Timer state lives in storage so it survives service-worker restarts.
// timer: { mode: 'focus'|'break', focusSec, breakSec, endAt, remainingMs, running }
const DEFAULT = { mode: 'focus', focusSec: 25 * 60, breakSec: 5 * 60, endAt: null, remainingMs: 25 * 60000, running: false };

async function getTimer() {
  const { timer } = await chrome.storage.local.get('timer');
  return { ...DEFAULT, ...timer };
}
const setTimer = (timer) => chrome.storage.local.set({ timer });

const remaining = (t) => (t.running ? Math.max(0, t.endAt - Date.now()) : t.remainingMs);
const fullMs = (t) => (t.mode === 'focus' ? t.focusSec : t.breakSec) * 1000;

async function updateBadge(t) {
  t = t || (await getTimer());
  const ms = remaining(t);
  if (!t.running && ms === fullMs(t)) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  // Badge fits ~4 chars: hours, then minutes, then seconds in the last minute.
  const text = ms >= 3600000 ? `${Math.floor(ms / 3600000)}h${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}`
    : ms >= 60000 ? String(Math.ceil(ms / 60000)) : `${Math.ceil(ms / 1000)}s`;
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({
    color: !t.running ? '#888888' : t.mode === 'focus' ? '#e5484d' : '#30a46c',
  });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
}

// chrome.alarms is clamped to 30 s, so the last minute is driven by 1 s setTimeouts
// (the popup/alarm wakes keep the worker alive long enough for that).
let fastTimer = null;
function fastTick() {
  clearTimeout(fastTimer);
  fastTimer = setTimeout(async () => {
    const t = await getTimer();
    if (t.running && t.endAt <= Date.now()) return finish();
    await updateBadge(t);
    if (t.running) fastTick();
  }, 1000);
}

async function schedule(t) {
  clearTimeout(fastTimer);
  await chrome.alarms.clearAll();
  if (!t.running) return;
  chrome.alarms.create('end', { when: t.endAt });
  chrome.alarms.create('tick', { periodInMinutes: 0.5 });
  if (t.endAt - Date.now() < 70000) fastTick();
}

async function finish() {
  const t = await getTimer();
  if (!t.running) return;
  clearTimeout(fastTimer);
  await chrome.alarms.clearAll();
  const wasFocus = t.mode === 'focus';
  // Flip to the other mode, ready to start.
  const next = { ...t, mode: wasFocus ? 'break' : 'focus', running: false, endAt: null };
  next.remainingMs = fullMs(next);
  await setTimer(next);
  await chrome.storage.local.set({ ringing: true });
  ring();
  await openAlarmWindow();
}

// ---------- pop-up alarm window, centered on the current browser window ----------
async function openAlarmWindow() {
  await closeAlarmWindow();
  const W = 420, H = 380;
  let left, top;
  try {
    const cur = await chrome.windows.getLastFocused();
    left = Math.round(cur.left + (cur.width - W) / 2);
    top = Math.round(cur.top + (cur.height - H) / 2);
  } catch {}
  const win = await chrome.windows.create({
    url: 'alarm.html', type: 'popup', focused: true, width: W, height: H, left, top,
  });
  await chrome.storage.local.set({ alarmWin: win.id });
  // Flashes the taskbar button too, in case another app is in front.
  chrome.windows.update(win.id, { drawAttention: true, focused: true });
}

async function closeAlarmWindow() {
  const { alarmWin } = await chrome.storage.local.get('alarmWin');
  if (alarmWin == null) return;
  await chrome.storage.local.set({ alarmWin: null });
  try { await chrome.windows.remove(alarmWin); } catch {}
}

// Closing the alarm window with X also silences the icon.
chrome.windows.onRemoved.addListener(async (id) => {
  const { alarmWin } = await chrome.storage.local.get('alarmWin');
  if (id !== alarmWin) return;
  await chrome.storage.local.set({ alarmWin: null });
  await stopRing();
});

// ---------- ringing alarm-clock icon ----------
// Draws an alarm clock tilted by `angle` degrees; bells/body in red, flashing
// yellow background and vibration marks while it rings.
function drawClock(size, angle, flash) {
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext('2d');
  const s = size / 32;
  if (flash) {
    g.fillStyle = '#ffd60a';
    g.beginPath(); g.arc(16 * s, 17 * s, 16 * s, 0, Math.PI * 2); g.fill();
  }
  g.translate(16 * s, 18 * s);
  g.rotate((angle * Math.PI) / 180);
  g.lineCap = 'round';
  // legs
  g.strokeStyle = '#1c1c1f'; g.lineWidth = 2.4 * s;
  g.beginPath(); g.moveTo(-7 * s, 8 * s); g.lineTo(-10 * s, 12 * s);
  g.moveTo(7 * s, 8 * s); g.lineTo(10 * s, 12 * s); g.stroke();
  // bells
  g.fillStyle = '#e5484d';
  g.beginPath(); g.arc(-8 * s, -9 * s, 5 * s, Math.PI, 0); g.fill();
  g.beginPath(); g.arc(8 * s, -9 * s, 5 * s, Math.PI, 0); g.fill();
  g.save(); g.rotate(-0.6); g.fillRect(-8.5 * s, -12 * s, 4 * s, 3 * s); g.restore();
  // body
  g.beginPath(); g.arc(0, 0, 11 * s, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(0, 0, 8 * s, 0, Math.PI * 2); g.fill();
  // hands
  g.strokeStyle = '#1c1c1f'; g.lineWidth = 2 * s;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -5.5 * s); g.moveTo(0, 0); g.lineTo(4 * s, 0); g.stroke();
  // vibration marks
  if (angle !== 0) {
    g.rotate((-angle * Math.PI) / 180);
    g.strokeStyle = '#e5484d'; g.lineWidth = 1.8 * s;
    const d = angle > 0 ? 1 : -1;
    g.beginPath();
    g.moveTo(d * 13 * s, -14 * s); g.lineTo(d * 15.5 * s, -16 * s);
    g.moveTo(d * 14 * s, -9 * s); g.lineTo(d * 16 * s, -10 * s);
    g.stroke();
  }
  return g.getImageData(0, 0, size, size);
}

// Burst of shakes, short rest, repeat — like a real alarm clock.
const FRAMES = [-18, 18, -18, 18, -18, 18, -18, 18, 0, 0, 0];
let ringTimer = null;
let ringStop = null;

function ring() {
  clearInterval(ringTimer);
  clearTimeout(ringStop);
  let i = 0;
  // Each setIcon call keeps the service worker alive while ringing.
  ringTimer = setInterval(() => {
    const a = FRAMES[i % FRAMES.length];
    const flash = Math.floor(i / FRAMES.length) % 2 === 0 ? a !== 0 : a === 0;
    chrome.action.setIcon({ imageData: { 16: drawClock(16, a, flash), 32: drawClock(32, a, flash) } });
    chrome.action.setBadgeText({ text: i % 4 < 2 ? '!!' : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#e5484d' });
    i++;
  }, 90);
  // Give up after 10 minutes if nobody opens the popup.
  ringStop = setTimeout(stopRing, 10 * 60000);
}

async function stopRing() {
  clearInterval(ringTimer);
  clearTimeout(ringStop);
  ringTimer = null;
  await chrome.storage.local.set({ ringing: false });
  closeAlarmWindow();
  await chrome.action.setIcon({ path: { 16: 'icons/16.png', 32: 'icons/32.png' } });
  await updateBadge();
}

chrome.alarms.onAlarm.addListener(async (a) => {
  const t = await getTimer();
  if (a.name === 'end' || (t.running && t.endAt <= Date.now())) return finish();
  await updateBadge(t);
  if (t.running && t.endAt - Date.now() < 70000) fastTick();
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.cmd === 'dismiss') {
      if (ringTimer || (await chrome.storage.local.get('ringing')).ringing) await stopRing();
      return reply(await getTimer());
    }
    if (ringTimer || (await chrome.storage.local.get('ringing')).ringing) await stopRing();
    let t = await getTimer();
    switch (msg.cmd) {
      case 'start':
        if (!t.running && t.remainingMs > 0) t = { ...t, running: true, endAt: Date.now() + t.remainingMs };
        break;
      case 'pause':
        if (t.running) t = { ...t, running: false, remainingMs: remaining(t), endAt: null };
        break;
      case 'reset':
        t = { ...t, running: false, endAt: null, remainingMs: fullMs(t) };
        break;
      case 'config':
        t = { ...t, ...msg.patch, running: false, endAt: null };
        t.remainingMs = fullMs(t);
        break;
    }
    await setTimer(t);
    await schedule(t);
    await updateBadge(t);
    reply(t);
  })();
  return true;
});

async function restore() {
  if ((await chrome.storage.local.get('ringing')).ringing) return ring();
  const t = await getTimer();
  if (t.running && t.endAt <= Date.now()) return finish();
  await setTimer(t);
  await schedule(t);
  await updateBadge(t);
}
chrome.runtime.onStartup.addListener(restore);
chrome.runtime.onInstalled.addListener(restore);
