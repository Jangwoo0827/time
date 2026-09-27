const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const send = (cmd, extra = {}) => chrome.runtime.sendMessage({ cmd, ...extra });

// ---------- tabs ----------
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.id === name));
  chrome.storage.local.set({ tab: name });
}
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

// ---------- timer (state owned by background.js) ----------
let timer = null;
const CIRC = 2 * Math.PI * 52;
$('bar').style.strokeDasharray = CIRC;

function renderTimer() {
  if (!timer) return;
  const ms = timer.running ? Math.max(0, timer.endAt - Date.now()) : timer.remainingMs;
  const s = Math.ceil(ms / 1000);
  $('tDisplay').textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  const full = (timer.mode === 'focus' ? timer.focusMin : timer.breakMin) * 60000;
  $('bar').style.strokeDashoffset = CIRC * (1 - ms / full);
  $('tStart').textContent = timer.running ? '일시정지' : ms < full ? '계속' : '시작';
  document.body.classList.toggle('rest', timer.mode === 'break');
  document.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === timer.mode));
  if (document.activeElement !== $('focusMin')) $('focusMin').value = timer.focusMin;
  if (document.activeElement !== $('breakMin')) $('breakMin').value = timer.breakMin;
}

$('tStart').onclick = async () => { timer = await send(timer.running ? 'pause' : 'start'); renderTimer(); };
$('tReset').onclick = async () => { timer = await send('reset'); renderTimer(); };
document.querySelectorAll('.modes button').forEach((b) => {
  b.onclick = async () => { timer = await send('config', { patch: { mode: b.dataset.mode } }); renderTimer(); };
});
for (const key of ['focusMin', 'breakMin']) {
  $(key).onchange = async () => {
    const v = Math.min(180, Math.max(1, parseInt($(key).value, 10) || 1));
    timer = await send('config', { patch: { [key]: v } });
    renderTimer();
  };
}
chrome.storage.onChanged.addListener((c) => { if (c.timer) { timer = c.timer.newValue; renderTimer(); } });

// ---------- stopwatch (timestamps in storage, so it keeps counting while the popup is closed) ----------
let sw = { running: false, startAt: 0, elapsed: 0, laps: [] };
const swNow = () => (sw.running ? sw.elapsed + Date.now() - sw.startAt : sw.elapsed);
const fmtSw = (ms) => {
  const cs = Math.floor(ms / 10);
  const h = Math.floor(cs / 360000);
  const body = `${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
  return h ? `${h}:${body}` : body;
};
const saveSw = () => chrome.storage.local.set({ sw });

function renderSw() {
  $('swDisplay').textContent = fmtSw(swNow());
  $('swStart').textContent = sw.running ? '일시정지' : sw.elapsed ? '계속' : '시작';
}
function renderLaps() {
  $('laps').innerHTML = '';
  sw.laps.forEach((t, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>랩 ${i + 1}</span><span>+${fmtSw(t - (sw.laps[i - 1] || 0))}</span><span>${fmtSw(t)}</span>`;
    $('laps').prepend(li);
  });
}
$('swStart').onclick = () => {
  if (sw.running) { sw.elapsed = swNow(); sw.running = false; }
  else { sw.startAt = Date.now(); sw.running = true; }
  saveSw(); renderSw();
};
$('swLap').onclick = () => { if (sw.running) { sw.laps.push(swNow()); saveSw(); renderLaps(); } };
$('swReset').onclick = () => {
  sw = { running: false, startAt: 0, elapsed: 0, laps: [] };
  saveSw(); renderSw(); renderLaps();
};

// ---------- clock ----------
function renderClock() {
  const d = new Date();
  $('clockTime').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  $('clockDate').textContent = d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
}

// ---------- init ----------
(async () => {
  const st = await chrome.storage.local.get(['timer', 'sw', 'tab']);
  if (st.sw) sw = st.sw;
  timer = st.timer || (await send('reset'));
  showTab(st.tab || 'timer');
  renderTimer(); renderSw(); renderLaps(); renderClock();
  const loop = () => { renderTimer(); if (sw.running) renderSw(); renderClock(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();
