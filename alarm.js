// Shown by background.js when the timer ends. The timer has already flipped to
// the next mode, so `timer.mode` is what "바로 시작" will start.
const fmt = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return [h && `${h}시간`, m && `${m}분`, s && `${s}초`].filter(Boolean).join(' ');
};

chrome.storage.local.get('timer').then(({ timer }) => {
  const toBreak = timer.mode === 'break';
  const next = fmt(toBreak ? timer.breakSec : timer.focusSec);
  document.getElementById('title').textContent = toBreak ? '집중 시간 종료!' : '휴식 시간 종료!';
  document.getElementById('msg').textContent = toBreak
    ? `집중 시간이 끝났습니다! ${next} 동안 휴식하세요.`
    : `휴식이 끝났습니다! 다시 ${next} 집중해볼까요?`;
  document.getElementById('next').textContent = toBreak ? '휴식 시작' : '집중 시작';
});

// Alarm-clock beeping: 4 quick beeps, pause, repeat.
const ctx = new AudioContext();
function beeps() {
  const t0 = ctx.currentTime;
  for (let i = 0; i < 4; i++) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, t0 + i * 0.15);
    g.gain.setValueAtTime(0, t0 + i * 0.15 + 0.08);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + i * 0.15);
    o.stop(t0 + i * 0.15 + 0.1);
  }
}
beeps();
const beepTimer = setInterval(beeps, 1000);
setTimeout(() => clearInterval(beepTimer), 60000); // stop sound after 1 min

const close = async (cmd) => {
  await chrome.runtime.sendMessage({ cmd });
  window.close();
};
document.getElementById('next').onclick = () => close('start');
document.getElementById('off').onclick = () => close('dismiss');
