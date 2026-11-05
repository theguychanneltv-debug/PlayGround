(() => {
  const canvas = document.querySelector('#court');
  const ctx = canvas.getContext('2d');
  const overlay = document.querySelector('#overlay');
  const playButton = document.querySelector('#playButton');
  const shootButton = document.querySelector('#shootButton');
  const scoreEl = document.querySelector('#score');
  const timerEl = document.querySelector('#timer');
  const streakEl = document.querySelector('#streak');
  const bestEl = document.querySelector('#best');
  const feedback = document.querySelector('#feedback');
  const soundButton = document.querySelector('#soundButton');
  const soundIcon = document.querySelector('#soundIcon');
  const W = 420, H = 570;
  const ball = { x: 210, y: 465 };
  const hoop = { x: 210, y: 152 };
  let state = 'ready', score = 0, streak = 0, timeLeft = 60;
  let best = Number(localStorage.getItem('buckets-best') || 0);
  let pointer = null, dragging = false, shot = null, lastFrame = 0, soundOn = false;
  let lastAim = { x: hoop.x, y: hoop.y };
  bestEl.textContent = String(best).padStart(2, '0');

  function roundedRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  }
  function court() {
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#d58a50'); bg.addColorStop(.52, '#c87943'); bg.addColorStop(1, '#b96738');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // Warm maple planks
    for (let y = 0; y < H; y += 46) {
      ctx.fillStyle = y % 92 === 0 ? 'rgba(255,215,155,.055)' : 'rgba(83,38,19,.045)';
      ctx.fillRect(0, y, W, 45);
      ctx.strokeStyle = 'rgba(83,42,22,.15)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y + 45); ctx.lineTo(W, y + 45); ctx.stroke();
      const offset = (Math.floor(y / 46) % 2) * 55;
      for (let x = offset; x < W; x += 110) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 45); ctx.stroke();
      }
    }
    // Court markings
    ctx.strokeStyle = 'rgba(255,239,210,.67)'; ctx.lineWidth = 2.2;
    ctx.strokeRect(20, 20, 380, 530);
    ctx.beginPath(); ctx.moveTo(20, 215); ctx.lineTo(400, 215); ctx.stroke();
    ctx.beginPath(); ctx.arc(210, 215, 54, 0, Math.PI, true); ctx.stroke();
    ctx.beginPath(); ctx.arc(210, 215, 8, 0, Math.PI * 2); ctx.stroke();
    // Key and restricted area
    ctx.strokeRect(116, 20, 188, 168);
    ctx.beginPath(); ctx.arc(210, 188, 68, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(210, 188, 68, Math.PI, Math.PI * 2); ctx.stroke();
    // Three point arc
    ctx.beginPath(); ctx.arc(210, 154, 174, .18, Math.PI - .18); ctx.stroke();
    // Hoop/backboard detail
    ctx.fillStyle = 'rgba(40,39,30,.25)'; roundedRect(167, 47, 86, 7, 2); ctx.fill();
    ctx.fillStyle = '#ece6d3'; roundedRect(165, 42, 90, 6, 2); ctx.fill();
    ctx.strokeStyle = '#6e3925'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(186, 48); ctx.lineTo(234, 48); ctx.stroke();
    ctx.strokeStyle = '#f2eee0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(210, 63, 24, 8, 0, 0, Math.PI * 2); ctx.stroke();
    // Net
    ctx.strokeStyle = 'rgba(255,244,221,.67)'; ctx.lineWidth = 1;
    for (let i = -3; i <= 3; i++) {
      const x = 210 + i * 6;
      ctx.beginPath(); ctx.moveTo(210 + i * 7.5, 65); ctx.lineTo(x, 84); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(190, 70); ctx.lineTo(230, 70); ctx.moveTo(194, 77); ctx.lineTo(226, 77); ctx.stroke();
    // Subtle court labels
    ctx.fillStyle = 'rgba(255,241,213,.38)'; ctx.font = '500 8px "DM Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText('BUCKETS // 01', 27, 38);
    ctx.textAlign = 'right'; ctx.fillText('HOME COURT', 393, 38);
  }
  function drawPlayer() {
    // Player shadow
    ctx.fillStyle = 'rgba(51,26,17,.24)'; ctx.beginPath(); ctx.ellipse(ball.x, ball.y + 44, 30, 8, 0, 0, Math.PI * 2); ctx.fill();
    // Legs / sneakers
    ctx.strokeStyle = '#e6d9bb'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(198, 443); ctx.lineTo(193, 459); ctx.moveTo(222, 443); ctx.lineTo(227, 459); ctx.stroke();
    ctx.strokeStyle = '#282c26'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(192, 459); ctx.lineTo(184, 460); ctx.moveTo(228, 459); ctx.lineTo(236, 460); ctx.stroke();
    // Jersey silhouette
    ctx.fillStyle = '#253228'; ctx.beginPath(); ctx.moveTo(193, 407); ctx.lineTo(227, 407); ctx.lineTo(236, 443); ctx.lineTo(184, 443); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d7e99c'; ctx.fillRect(205, 411, 10, 4);
    ctx.fillStyle = '#dfaa7d'; ctx.beginPath(); ctx.arc(210, 397, 12, 0, Math.PI * 2); ctx.fill();
    // Headband and arm lines
    ctx.fillStyle = '#f36b35'; ctx.fillRect(199, 390, 22, 4);
    ctx.strokeStyle = '#dfaa7d'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(193, 413); ctx.lineTo(181, 425); ctx.moveTo(227, 413); ctx.lineTo(238, 424); ctx.stroke();
  }
  function drawBall(x, y, radius = 13, rotate = 0) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rotate);
    ctx.fillStyle = '#eb6b32'; ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#4d3023'; ctx.lineWidth = Math.max(1.2, radius * .11);
    ctx.beginPath(); ctx.arc(0, 0, radius * .97, -.95, .95); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, radius * .97, Math.PI - .95, Math.PI + .95); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-radius, 0); ctx.quadraticCurveTo(0, radius * .35, radius, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-radius, 0); ctx.quadraticCurveTo(0, -radius * .35, radius, 0); ctx.stroke();
    ctx.restore();
  }
  function drawAim() {
    if (!dragging || !pointer) return;
    const dx = pointer.x - ball.x, dy = pointer.y - ball.y;
    const len = Math.hypot(dx, dy) || 1;
    const endX = ball.x + dx / len * Math.min(len, 375), endY = ball.y + dy / len * Math.min(len, 375);
    ctx.save();
    ctx.setLineDash([6, 7]); ctx.strokeStyle = 'rgba(244,255,207,.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ball.x, ball.y); ctx.quadraticCurveTo((ball.x + endX) / 2 - 25, (ball.y + endY) / 2, endX, endY); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = '#d6fa8b'; ctx.beginPath(); ctx.arc(endX, endY, 5, 0, Math.PI * 2); ctx.fill();
    const power = Math.min(100, Math.round(len / 3.2));
    ctx.fillStyle = 'rgba(19,24,17,.8)'; roundedRect(16, 503, 94, 31, 4); ctx.fill();
    ctx.fillStyle = '#c8f169'; ctx.font = '500 8px "DM Mono", monospace'; ctx.textAlign = 'left'; ctx.fillText(`POWER ${String(power).padStart(2, '0')}%`, 25, 516);
    ctx.fillStyle = '#48513f'; roundedRect(25, 522, 75, 3, 2); ctx.fill();
    ctx.fillStyle = '#c8f169'; roundedRect(25, 522, 75 * power / 100, 3, 2); ctx.fill();
    ctx.restore();
  }
  function drawShot(now) {
    if (!shot) return;
    const p = Math.min(1, (now - shot.started) / 720);
    const x = shot.from.x + (shot.to.x - shot.from.x) * p;
    const y = shot.from.y + (shot.to.y - shot.from.y) * p - Math.sin(p * Math.PI) * 126;
    drawBall(x, y, 13 - p * 3, p * 6);
    if (p >= 1 && !shot.resolved) {
      shot.resolved = true;
      window.setTimeout(() => { if (shot && shot.resolved) shot = null; }, 180);
    }
  }
  function render(now = performance.now()) {
    court();
    drawPlayer();
    if (shot) drawShot(now); else drawBall(ball.x, ball.y, 13, now / 500);
    drawAim();
    if (state === 'ready') {
      ctx.fillStyle = 'rgba(22,27,19,.62)'; roundedRect(16, 503, 129, 31, 4); ctx.fill();
      ctx.fillStyle = '#e9e9d8'; ctx.font = '500 8px "DM Mono", monospace'; ctx.textAlign = 'left'; ctx.fillText('READY WHEN YOU ARE', 25, 522);
    }
    requestAnimationFrame(render);
  }
  function startGame() {
    score = 0; streak = 0; timeLeft = 60; shot = null; pointer = null;
    scoreEl.textContent = '00'; streakEl.textContent = '0'; timerEl.innerHTML = '60<span class="seconds">s</span>';
    state = 'playing'; overlay.classList.add('hidden'); shootButton.disabled = false;
    lastFrame = performance.now();
  }
  function endGame() {
    state = 'over'; shootButton.disabled = true;
    overlay.classList.remove('hidden');
    const card = document.querySelector('#overlayCard');
    card.innerHTML = `<div class="overlay-icon">${score >= best ? '🏆' : '⏱️'}</div><p class="eyebrow">FINAL SCORE · ${score} POINTS</p><h2>${score >= best && score > 0 ? 'NEW<br><span>RECORD.</span>' : 'RUN IT<br><span>BACK.</span>'}</h2><p class="overlay-copy">${score >= best && score > 0 ? 'That court is yours. A new personal best.' : 'The clock ran out. Lace up and take another run.'}</p><button class="play-button" id="playAgain"><span>PLAY AGAIN</span><b>↗</b></button><span class="overlay-foot">BEST RUN · ${String(best).padStart(2, '0')} POINTS</span>`;
    document.querySelector('#playAgain').addEventListener('click', startGame);
  }
  function tick(now) {
    if (state === 'playing') {
      const elapsed = (now - lastFrame) / 1000;
      if (elapsed >= 1) {
        timeLeft = Math.max(0, timeLeft - Math.floor(elapsed));
        lastFrame = now;
        timerEl.innerHTML = `${timeLeft}<span class="seconds">s</span>`;
        timerEl.classList.toggle('urgent', timeLeft <= 10);
        if (timeLeft <= 0) endGame();
      }
    }
    requestAnimationFrame(tick);
  }
  function showFeedback(text, sub = '', miss = false) {
    feedback.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    feedback.classList.remove('show', 'miss'); void feedback.offsetWidth;
    if (miss) feedback.classList.add('miss'); feedback.classList.add('show');
  }
  function playSound(good) {
    if (!soundOn) return;
    try {
      const audio = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = good ? 660 : 180;
      gain.gain.setValueAtTime(.08, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .22);
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .23);
      oscillator.onended = () => audio.close();
    } catch (_) { /* Audio is optional. */ }
  }
  function shoot(target) {
    if (state !== 'playing' || shot) return;
    const dx = target.x - ball.x, dy = target.y - ball.y;
    const len = Math.hypot(dx, dy);
    if (len < 26) { showFeedback('AIM UP', 'DRAG TOWARD THE HOOP', true); return; }
    const baseX = hoop.x - ball.x, baseY = hoop.y - ball.y;
    const angle = Math.acos(Math.max(-1, Math.min(1, (dx * baseX + dy * baseY) / (len * Math.hypot(baseX, baseY))))) * 180 / Math.PI;
    const power = len / Math.hypot(baseX, baseY);
    const made = angle < 11 && power > .69 && power < 1.38;
    const swish = made && angle < 3.2 && power > .86 && power < 1.15;
    let end = { x: hoop.x + (target.x - (ball.x + (hoop.y - ball.y) * dx / dy)), y: 90 };
    if (!Number.isFinite(end.x)) end.x = hoop.x + 70;
    end.x = Math.max(35, Math.min(385, end.x));
    if (made) end.x = hoop.x + (angle < 6 ? 0 : (dx > 0 ? 8 : -8));
    else if (Math.abs(end.x - hoop.x) < 10) end.x += dx >= 0 ? 35 : -35;
    shot = { from: { ...ball }, to: end, started: performance.now(), resolved: false };
    lastAim = { ...target };
    window.setTimeout(() => {
      if (state !== 'playing') return;
      if (made) {
        streak++;
        const points = 2 + (streak % 3 === 0 ? 1 : 0);
        score += points; scoreEl.textContent = String(score).padStart(2, '0');
        streakEl.textContent = String(streak);
        if (score > best) { best = score; bestEl.textContent = String(best).padStart(2, '0'); localStorage.setItem('buckets-best', String(best)); }
        showFeedback(swish ? 'SWISH!' : 'BUCKET!', points > 2 ? `+${points} POINTS · STREAK BONUS` : `+${points} POINTS`);
      } else {
        streak = 0; streakEl.textContent = '0'; showFeedback(angle > 17 ? 'OFF LINE' : 'NO GOOD', 'RESET YOUR AIM', true);
      }
      playSound(made);
      window.setTimeout(() => { if (state === 'playing') shot = null; }, 360);
    }, 690);
  }
  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * W / rect.width, y: (event.clientY - rect.top) * H / rect.height };
  }
  canvas.addEventListener('pointerdown', event => {
    if (state !== 'playing' || shot) return;
    const pos = canvasPoint(event);
    if (Math.hypot(pos.x - ball.x, pos.y - ball.y) > 82 && pos.y < 380) return;
    event.preventDefault(); canvas.setPointerCapture(event.pointerId); pointer = pos; dragging = true;
  });
  canvas.addEventListener('pointermove', event => { if (dragging) { pointer = canvasPoint(event); lastAim = pointer; } });
  canvas.addEventListener('pointerup', event => {
    if (!dragging) return;
    pointer = canvasPoint(event); dragging = false; shoot(pointer); pointer = null;
  });
  canvas.addEventListener('pointercancel', () => { dragging = false; pointer = null; });
  playButton.addEventListener('click', startGame);
  shootButton.addEventListener('click', () => shoot(lastAim));
  document.querySelector('#resetButton').addEventListener('click', () => {
    state = 'ready'; score = 0; streak = 0; timeLeft = 60; shot = null;
    scoreEl.textContent = '00'; streakEl.textContent = '0'; timerEl.innerHTML = '60<span class="seconds">s</span>';
    shootButton.disabled = true;
    const card = document.querySelector('#overlayCard');
    card.innerHTML = '<div class="overlay-icon">🏀</div><p class="eyebrow">YOUR COURT IS READY</p><h2>FIND YOUR<br><span>RHYTHM.</span></h2><p class="overlay-copy">Drag from the ball toward the hoop. Find your line, then let it fly.</p><button class="play-button" id="playButton"><span>TIP OFF</span><b>↗</b></button><span class="overlay-foot">60 SECONDS · MAKE EVERY SHOT COUNT</span>';
    document.querySelector('#playButton').addEventListener('click', startGame);
    overlay.classList.remove('hidden');
  });
  soundButton.addEventListener('click', () => {
    soundOn = !soundOn; soundIcon.textContent = soundOn ? '♫' : '♪'; soundButton.classList.toggle('sound-on', soundOn);
    soundButton.setAttribute('aria-label', soundOn ? 'Mute sound' : 'Enable sound');
  });
  canvas.addEventListener('keydown', event => {
    if (event.code === 'Space' && state === 'playing') { event.preventDefault(); shoot(lastAim); }
  });
  requestAnimationFrame(render); requestAnimationFrame(tick);
})();
