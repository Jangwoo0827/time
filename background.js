// Timer state lives in storage so it survives service-worker restarts.
// timer: { mode: 'focus'|'break', focusMin, breakMin, endAt, remainingMs, running }
const DEFAULT = { mode: 'focus', focusMin: 25, breakMin: 5, endAt: null, remainingMs: 25 * 60000, running: false };

async function getTimer() {
  const { timer } = await chrome.storage.local.get('timer');
  return { ...DEFAULT, ...timer };
}
const setTimer = (timer) => chrome.storage.local.set({ timer });

const remaining = (t) => (t.running ? Math.max(0, t.endAt - Date.now()) : t.remainingMs);
const fullMs = (t) => (t.mode === 'focus' ? t.focusMin : t.breakMin) * 60000;

async function updateBadge(t) {
  t = t || (await getTimer());
  const ms = remaining(t);
  if (!t.running && ms === fullMs(t)) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  // Badge fits ~4 chars: minutes when >= 1 min, seconds in the last minute.
  const text = ms >= 60000 ? String(Math.ceil(ms / 60000)) : `${Math.ceil(ms / 1000)}s`;
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
  chrome.notifications.create('done-' + Date.now(), {
    type: 'basic',
    iconUrl: 'icons/128.png',
    title: wasFocus ? '집중 시간 종료' : '휴식 시간 종료',
    message: wasFocus
      ? `집중 시간이 끝났습니다! ${t.breakMin}분 동안 휴식하세요.`
      : `휴식이 끝났습니다! 다시 ${t.focusMin}분 집중해볼까요?`,
    priority: 2,
    requireInteraction: true,
  });
  // Flip to the other mode, ready to start.
  const next = { ...t, mode: wasFocus ? 'break' : 'focus', running: false, endAt: null };
  next.remainingMs = fullMs(next);
  await setTimer(next);
  await chrome.action.setBadgeText({ text: '✓' });
  await chrome.action.setBadgeBackgroundColor({ color: '#30a46c' });
}

chrome.alarms.onAlarm.addListener(async (a) => {
  const t = await getTimer();
  if (a.name === 'end' || (t.running && t.endAt <= Date.now())) return finish();
  await updateBadge(t);
  if (t.running && t.endAt - Date.now() < 70000) fastTick();
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
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

chrome.notifications.onClicked.addListener((id) => chrome.notifications.clear(id));

async function restore() {
  const t = await getTimer();
  if (t.running && t.endAt <= Date.now()) return finish();
  await setTimer(t);
  await schedule(t);
  await updateBadge(t);
}
chrome.runtime.onStartup.addListener(restore);
chrome.runtime.onInstalled.addListener(restore);
