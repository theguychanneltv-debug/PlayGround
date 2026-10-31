import { LEVELS, PIG_INFO } from './levels.js';
import { SoundKit } from './audio.js';

const { Engine, Bodies, Body, Composite, Events } = Matter;

const W = 1600;
const H = 900;
const GROUND_Y = 820;
const STEP = 1000 / 60;
const ANCHOR = { x: 278, y: 676 };
const MAX_PULL = 158;
const LAUNCH_POWER = 0.128;
const SAVE_KEY = 'angry-pigs-swapped-v1';

const INK = '#3b2a18';
const CREAM = '#fff6df';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const MATERIALS = {
  wood: { hp: 72, density: 0.0018, friction: 0.72, restitution: 0.08, score: 50 },
  glass: { hp: 26, density: 0.0011, friction: 0.4, restitution: 0.16, score: 35 },
  stone: { hp: 155, density: 0.0032, friction: 0.82, restitution: 0.04, score: 75 },
};

const BIRD_STYLE = {
  red: { body: '#e94b3c', dark: '#b93228', belly: '#ffd6c7', wing: '#c73a2e' },
  blue: { body: '#4aa8e8', dark: '#2c7fba', belly: '#d8f1ff', wing: '#348fce' },
  yellow: { body: '#f5c542', dark: '#c9961d', belly: '#fff0b3', wing: '#d9a71f' },
  black: { body: '#42424e', dark: '#2a2a33', belly: '#9a9aa8', wing: '#33333c' },
};

function loadSave() {
  const fallback = { stars: {}, best: {}, muted: false, launched: false };
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return { ...fallback, ...raw, stars: { ...(raw.stars || {}) }, best: { ...(raw.best || {}) } };
  } catch {
    return fallback;
  }
}

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.audio = new SoundKit();
    this.save = loadSave();
    this.audio.muted = !!this.save.muted;

    this.state = 'title';
    this.levelIndex = 0;
    this.level = null;
    this.engine = null;
    this.score = 0;
    this.time = 0;
    this.last = performance.now();
    this.accum = 0;
    this.timeScale = 1;
    this.slowmoUntil = 0;
    this.shake = 0;
    this.dpr = 1;
    this.cw = 1;
    this.ch = 1;
    this.view = { scale: 1, ox: 0, oy: 0 };
    this.clouds = [];
    this.particles = [];
    this.popups = [];
    this.decor = [];
    this.toRemove = [];
    this.queue = [];
    this.usedPigs = 0;
    this.loadedPig = null;
    this.activePig = null;
    this.dragging = false;
    this.dragPointer = null;
    this.abilityUsed = false;
    this.eggRescued = false;
    this.winPending = false;
    this.losePending = false;
    this.turnEnding = false;
    this.allowPortrait = false;
    this.launchTime = 0;
    this.restTime = 0;
    this.lastThud = 0;
    this.toastTimer = 0;
    this.hintTimer = 0;
    this.pigTrail = [];
    this.attract = this.makeAttract();

    this.dom = {
      title: document.getElementById('titleScreen'),
      levels: document.getElementById('levelsScreen'),
      pause: document.getElementById('pauseScreen'),
      win: document.getElementById('winScreen'),
      lose: document.getElementById('loseScreen'),
      rotate: document.getElementById('rotateScreen'),
      hud: document.getElementById('hud'),
      levelGrid: document.getElementById('levelGrid'),
      progressLine: document.getElementById('progressLine'),
      hudLevelNum: document.getElementById('hudLevelNum'),
      hudLevelName: document.getElementById('hudLevelName'),
      scoreValue: document.getElementById('scoreValue'),
      ammo: document.getElementById('ammo'),
      toast: document.getElementById('toast'),
      abilityHint: document.getElementById('abilityHint'),
      abilityText: document.getElementById('abilityText'),
      winStars: document.getElementById('winStars'),
      winScore: document.getElementById('winScore'),
      winBest: document.getElementById('winBest'),
      winEgg: document.getElementById('winEgg'),
      loseTip: document.getElementById('loseTip'),
      nextBtn: document.getElementById('nextBtn'),
      playLabel: document.getElementById('playLabel'),
      loading: document.getElementById('loading'),
    };

    this.bindUI();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });

    this.makeClouds();
    this.updateSoundIcons();
    this.updatePlayLabel();
    this.buildLevelGrid();

    const done = () => this.dom.loading.classList.add('done');
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(done);
      setTimeout(done, 1400);
    } else {
      setTimeout(done, 500);
    }

    requestAnimationFrame((t) => this.frame(t));

    // Small debug hook used by the capture harness.
    window.__AP = {
      startLevel: (i) => this.startLevel(i),
      launch: (vx, vy) => this.debugLaunch(vx, vy),
      state: () => ({
        state: this.state,
        level: this.levelIndex,
        score: this.score,
        birds: this.birds ? this.birds.filter((b) => !b.game.dead).length : 0,
        pigs: this.queue.length,
      }),
      skipToWin: () => {
        if (!this.birds) return;
        this.birds.forEach((b) => { if (!b.game.dead) this.defeatBird(b); });
      },
      game: this,
    };
  }

  makeClouds() {
    const spots = [
      [130, 150, 1.15, 5], [420, 95, .8, 3.2], [760, 170, 1.05, 4.2],
      [1080, 110, .7, 2.6], [1380, 190, 1.2, 5.4], [1660, 130, .9, 3.6],
      [240, 270, .55, 2.1], [920, 265, .5, 1.7],
    ];
    this.clouds = spots.map(([x, y, s, sp], i) => ({ x, y, s, sp, seed: i * 3.7 }));
  }

  makeAttract() {
    return {
      pig: { x: 430, y: 690, r: 46, type: 'dash' },
      blocks: [
        { x: 1110, y: 750, w: 30, h: 140, m: 'stone', a: 0 },
        { x: 1320, y: 750, w: 30, h: 140, m: 'stone', a: 0 },
        { x: 1215, y: 668, w: 270, h: 26, m: 'wood', a: 0 },
        { x: 1130, y: 610, w: 24, h: 92, m: 'wood', a: 0 },
        { x: 1300, y: 610, w: 24, h: 92, m: 'wood', a: 0 },
        { x: 1215, y: 552, w: 250, h: 24, m: 'wood', a: 0 },
      ],
      birds: [
        { x: 1140, y: 636, type: 'red' },
        { x: 1290, y: 636, type: 'blue' },
        { x: 1215, y: 520, type: 'yellow' },
      ],
      egg: { x: 1215, y: 524 },
    };
  }

  // ---------------------------------------------------------------- UI

  bindUI() {
    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', (e) => { e.preventDefault(); this.audio.unlock(); this.audio.click(); fn(); });
    };

    on('playBtn', () => this.playFromMenu());
    on('levelsBtn', () => this.showLevels());
    on('levelsBackBtn', () => this.showTitle());
    on('homeBtn', () => this.showLevels());
    on('pauseBtn', () => this.pause());
    on('resumeBtn', () => this.resume());
    on('restartBtn', () => this.startLevel(this.levelIndex));
    on('pauseLevelsBtn', () => this.showLevels());
    on('winReplayBtn', () => this.startLevel(this.levelIndex));
    on('winLevelsBtn', () => this.showLevels());
    on('loseRetryBtn', () => this.startLevel(this.levelIndex));
    on('loseLevelsBtn', () => this.showLevels());
    on('nextBtn', () => {
      if (this.levelIndex + 1 < LEVELS.length) this.startLevel(this.levelIndex + 1);
      else this.showLevels();
    });
    on('portraitPlayBtn', () => {
      this.allowPortrait = true;
      this.resumeFromRotate();
    });

    document.querySelectorAll('.js-sound, #soundBtn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleSound();
      });
    });

    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
      }
      if (e.code === 'Space' && this.state === 'playing' && this.activePig) {
        e.preventDefault();
        this.triggerAbility();
      }
    });
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
  }

  toggleSound() {
    this.audio.unlock();
    this.save.muted = !this.save.muted;
    this.audio.setMuted(this.save.muted);
    this.persist();
    this.updateSoundIcons();
    if (!this.save.muted) this.audio.click();
  }

  updateSoundIcons() {
    const icon = this.save.muted ? '#icon-mute' : '#icon-sound';
    document.querySelectorAll('.js-sound use, #soundBtn use').forEach((use) => {
      use.setAttribute('href', icon);
    });
  }

  persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch { /* private mode */ }
  }

  updatePlayLabel() {
    const next = LEVELS.find((l) => !(this.save.stars[l.id] > 0));
    this.dom.playLabel.textContent = next && next.id > 1 ? 'CONTINUE' : 'PLAY';
  }

  playFromMenu() {
    let idx = LEVELS.findIndex((l) => !(this.save.stars[l.id] > 0));
    if (idx < 0) idx = 0;
    this.startLevel(idx);
  }

  showOnly(el) {
    [this.dom.title, this.dom.levels, this.dom.pause, this.dom.win, this.dom.lose, this.dom.rotate].forEach((s) => {
      s.classList.toggle('active', s === el);
    });
  }

  isPortrait() {
    return this.ch > this.cw * 1.05 && this.cw < 900;
  }

  showRotate() {
    if (this.state !== 'playing') return;
    this.state = 'rotate';
    this.hideAbilityHint();
    this.showOnly(this.dom.rotate);
    this.showHUD(false);
  }

  resumeFromRotate() {
    if (this.state !== 'rotate') return;
    this.state = 'playing';
    this.showOnly(null);
    this.showHUD(true);
    this.last = performance.now();
  }

  showHUD(show) {
    this.dom.hud.classList.toggle('active', show);
  }

  showTitle() {
    this.state = 'title';
    this.dragging = false;
    this.showOnly(this.dom.title);
    this.showHUD(false);
    this.hideAbilityHint();
    this.updatePlayLabel();
  }

  showLevels() {
    this.state = 'levels';
    this.dragging = false;
    this.showOnly(this.dom.levels);
    this.showHUD(false);
    this.hideAbilityHint();
    this.buildLevelGrid();
  }

  buildLevelGrid() {
    if (!this.dom.levelGrid) return;
    const grid = this.dom.levelGrid;
    grid.innerHTML = '';
    let done = 0;
    LEVELS.forEach((level, i) => {
      const stars = this.save.stars[level.id] || 0;
      if (stars > 0) done++;
      const unlocked = i === 0 || (this.save.stars[LEVELS[i - 1].id] || 0) > 0;
      const card = document.createElement('button');
      card.className = 'level-card' + (unlocked ? '' : ' locked');
      card.type = 'button';
      card.setAttribute('aria-label', unlocked ? `Level ${level.id}: ${level.name}` : `Level ${level.id} locked`);
      const art = `<svg class="card-art"><use href="#icon-${i % 2 ? 'egg' : 'pig'}"/></svg>`;
      const starSVG = [1, 2, 3].map((n) => `<svg class="${n <= stars ? 'on' : ''}"><use href="#icon-star"/></svg>`).join('');
      const lock = unlocked ? '' : `<svg class="card-lock"><use href="#icon-lock"/></svg>`;
      const badge = stars === 3 ? '<span class="card-badge">CLEARED</span>' : '';
      card.innerHTML = `
        ${art}${badge}
        <div>
          <div class="card-num">0${level.id}</div>
          <div class="card-name">${level.name}</div>
          <div class="card-sub">${level.sub}</div>
        </div>
        <div class="card-stars">${starSVG}</div>
        ${lock}
      `;
      if (unlocked) {
        card.addEventListener('click', () => { this.audio.unlock(); this.audio.click(); this.startLevel(i); });
      }
      grid.appendChild(card);
    });
    this.dom.progressLine.textContent = `${done} / ${LEVELS.length} nests crashed`;
  }

  showToast(html, ms = 2400) {
    this.dom.toast.innerHTML = html;
    this.dom.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.dom.toast.classList.remove('show'), ms);
  }

  showAbilityHint() {
    if (!this.activePig || this.abilityUsed) return;
    const info = PIG_INFO[this.activePig.game.type];
    this.dom.abilityText.textContent = `${info.name} · ${info.power}`;
    this.dom.abilityHint.dataset.type = this.activePig.game.type;
    this.dom.abilityHint.classList.add('show');
  }

  hideAbilityHint() {
    this.dom.abilityHint.classList.remove('show');
  }

  updateHud() {
    this.dom.hudLevelNum.textContent = String(this.levelIndex + 1);
    this.dom.hudLevelName.textContent = this.level ? this.level.name : '';
    this.dom.scoreValue.textContent = this.score.toLocaleString('en-US');
    this.dom.scoreValue.classList.remove('pop');
    void this.dom.scoreValue.offsetWidth;
    this.dom.scoreValue.classList.add('pop');
    if (!this.level) return;
    this.dom.ammo.innerHTML = this.level.pigs.map((type, i) => {
      const spent = i < this.usedPigs ? ' spent' : '';
      return `<span class="ammo-pig${spent}" data-type="${type}" title="${PIG_INFO[type].name}">
        <svg><use href="#icon-pig"/></svg><i class="pip"></i>
      </span>`;
    }).join('');
  }

  addScore(points, x, y, text = null, color = '#fff6df') {
    this.score += points;
    this.updateHud();
    if (x != null) this.popup(x, y, text || `+${points}`, color);
  }

  popup(x, y, text, color = CREAM) {
    this.popups.push({ x, y, text, color, life: 1.15, maxLife: 1.15, vy: -52, size: 26 });
  }

  // ---------------------------------------------------------------- Level setup

  startLevel(index) {
    this.levelIndex = clamp(index, 0, LEVELS.length - 1);
    this.level = LEVELS[this.levelIndex];
    this.buildLevel();
    this.state = 'playing';
    this.showOnly(null);
    this.showHUD(true);
    this.hideAbilityHint();
    this.dom.winStars.classList.remove('show');
    this.updateHud();
    if (this.isPortrait() && !this.allowPortrait) {
      this.showRotate();
      return;
    }
    setTimeout(() => {
      if (this.state === 'playing' && this.level) {
        this.showToast(`<b>${this.level.name}</b> &nbsp;·&nbsp; ${this.level.tip}`, 3600);
      }
    }, 420);
  }

  clearLevel() {
    if (this.engine) {
      Events.off(this.engine, 'collisionStart');
      Composite.clear(this.engine.world, false, true);
      Engine.clear(this.engine);
    }
    this.engine = null;
    this.birds = [];
    this.blocks = [];
    this.tnts = [];
    this.eggs = [];
    this.pigs = [];
    this.particles = [];
    this.popups = [];
    this.toRemove = [];
    this.pigTrail = [];
    this.activePig = null;
    this.loadedPig = null;
    this.dragging = false;
    this.dragPointer = null;
    this.eggRescued = false;
    this.winPending = false;
    this.losePending = false;
    this.turnEnding = false;
    this.abilityUsed = false;
    this.score = 0;
    this.timeScale = 1;
    this.accum = 0;
    this.shake = 0;
  }

  buildLevel() {
    this.clearLevel();
    const engine = Engine.create({ enableSleeping: false });
    engine.gravity.y = 1;
    engine.positionIterations = 10;
    engine.velocityIterations = 8;
    this.engine = engine;

    const ground = Bodies.rectangle(800, GROUND_Y + 110, 2600, 220, {
      isStatic: true, friction: 0.95, restitution: 0.02, label: 'ground',
    });
    ground.game = { kind: 'ground' };
    Composite.add(engine.world, ground);

    const lvl = this.level;
    lvl.blocks.forEach((s) => this.addBlock(s));
    lvl.tnt.forEach((s) => this.addTnt(s));
    lvl.birds.forEach((s) => this.addBird(s));
    if (lvl.egg) this.addEgg(lvl.egg);

    // Let the structure settle before the player sees it.
    for (let i = 0; i < 24; i++) Engine.update(engine, STEP);
    this.blocks.forEach((b) => { b.game.flash = 0; b.game.hp = b.game.maxHp; });

    Events.on(engine, 'collisionStart', (e) => this.onCollisions(e));

    this.queue = [...lvl.pigs];
    this.usedPigs = 0;
    this.loadNextPig();
    this.updateHud();
  }

  addBlock(s) {
    const mat = MATERIALS[s.m];
    const body = Bodies.rectangle(s.x, s.y, s.w, s.h, {
      density: mat.density,
      friction: mat.friction,
      frictionStatic: 1,
      restitution: mat.restitution,
      angle: s.a || 0,
      chamfer: { radius: Math.min(3, s.w / 4, s.h / 4) },
      label: 'block',
    });
    body.game = {
      kind: 'block', material: s.m, w: s.w, h: s.h,
      hp: mat.hp, maxHp: mat.hp, flash: 0, seed: Math.random() * 1000, dead: false,
    };
    this.blocks.push(body);
    Composite.add(this.engine.world, body);
  }

  addTnt(s) {
    const body = Bodies.rectangle(s.x, s.y, 52, 52, {
      density: 0.002, friction: 0.7, restitution: 0.08, chamfer: { radius: 3 }, label: 'tnt',
    });
    body.game = { kind: 'tnt', w: 52, h: 52, dead: false, flash: 0, seed: Math.random() * 1000 };
    this.tnts.push(body);
    Composite.add(this.engine.world, body);
  }

  addBird(s) {
    const body = Bodies.circle(s.x, s.y, 20, {
      density: 0.0018, friction: 0.95, frictionStatic: 1, frictionAir: 0.025,
      restitution: 0.04, label: 'bird',
    });
    body.game = { kind: 'bird', type: s.type, dead: false, seed: Math.random() * 10, flash: 0 };
    this.birds.push(body);
    Composite.add(this.engine.world, body);
  }

  addEgg(s) {
    const body = Bodies.circle(s.x, s.y, 16, {
      density: 0.0012, friction: 0.75, restitution: 0.08, label: 'egg',
    });
    body.game = { kind: 'egg', dead: false, seed: Math.random() * 10 };
    this.eggs.push(body);
    Composite.add(this.engine.world, body);
  }

  loadNextPig() {
    if (!this.queue.length) { this.loadedPig = null; return; }
    this.loadedPig = { type: this.queue[0], x: ANCHOR.x, y: ANCHOR.y, blink: Math.random() * 5 };
    this.abilityUsed = false;
    this.dragging = false;
    this.dragPointer = null;
    this.updateHud();
  }

  // ---------------------------------------------------------------- Input

  toWorld(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return { x: (x - this.view.ox) / this.view.scale, y: (y - this.view.oy) / this.view.scale };
  }

  onPointerDown(e) {
    this.audio.unlock();
    if (this.state !== 'playing') return;
    const p = this.toWorld(e);

    if (this.activePig && !this.abilityUsed) {
      this.triggerAbility();
      return;
    }
    if (!this.loadedPig || this.turnEnding) return;

    const near = dist(p, this.loadedPig) < 190;
    const launchZone = p.x > 0 && p.x < 720 && p.y > 330 && p.y < H;
    if (!near && !launchZone) return;

    this.dragging = true;
    this.dragPointer = e.pointerId;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.canvas.classList.add('dragging');
    this.audio.stretchStart();
    this.updateDrag(p);
  }

  onPointerMove(e) {
    if (!this.dragging || e.pointerId !== this.dragPointer) return;
    this.updateDrag(this.toWorld(e));
  }

  onPointerUp(e) {
    if (!this.dragging || (e.pointerId != null && e.pointerId !== this.dragPointer)) return;
    this.dragging = false;
    this.dragPointer = null;
    this.canvas.classList.remove('dragging');
    this.audio.stretchStop();
    if (!this.loadedPig) return;

    const pull = { x: ANCHOR.x - this.loadedPig.x, y: ANCHOR.y - this.loadedPig.y };
    const power = Math.hypot(pull.x, pull.y);
    if (power < 14) {
      this.loadedPig.x = ANCHOR.x;
      this.loadedPig.y = ANCHOR.y;
      return;
    }
    this.launch(pull);
  }

  updateDrag(p) {
    if (!this.loadedPig) return;
    let dx = p.x - ANCHOR.x;
    let dy = p.y - ANCHOR.y;
    const d = Math.hypot(dx, dy);
    if (d > MAX_PULL) { dx = dx / d * MAX_PULL; dy = dy / d * MAX_PULL; }
    this.loadedPig.x = ANCHOR.x + dx;
    this.loadedPig.y = ANCHOR.y + dy;
    const power = Math.hypot(dx, dy) / MAX_PULL;
    this.audio.stretchMove(power);
  }

  launch(pull) {
    if (!this.loadedPig) return;
    const held = this.loadedPig;
    const type = this.queue.shift();
    this.usedPigs++;
    const body = Bodies.circle(held.x, held.y, 26, {
      density: 0.0022, friction: 0.62, frictionStatic: 1, frictionAir: 0.0035,
      restitution: 0.34, label: 'pig',
    });
    body.game = {
      kind: 'pig', type, abilityUsed: false, dead: false, spent: false,
      launchTime: performance.now(), seed: Math.random() * 10, flash: 0,
    };
    Body.setVelocity(body, { x: pull.x * LAUNCH_POWER, y: pull.y * LAUNCH_POWER });
    Body.setAngularVelocity(body, pull.x * 0.0012);
    Composite.add(this.engine.world, body);

    this.pigs.push(body);
    this.activePig = body;
    this.loadedPig = null;
    this.abilityUsed = false;
    this.launchTime = performance.now();
    this.restTime = 0;
    this.turnEnding = false;
    this.pigTrail = [];
    this.audio.launch();
    this.shake = Math.max(this.shake, 5);
    this.spawnDust(held.x, held.y, 8, 0.6);
    this.updateHud();

    if (!this.save.launched) {
      this.save.launched = true;
      this.persist();
      setTimeout(() => {
        if (this.state === 'playing') this.showToast('Tap anywhere in the air to use your pig’s power!', 2800);
      }, 900);
    }
    setTimeout(() => {
      if (this.activePig && !this.abilityUsed) this.showAbilityHint();
    }, 520);
  }

  debugLaunch(vx, vy) {
    if (this.state !== 'playing' || !this.loadedPig) return;
    this.loadedPig.x = ANCHOR.x;
    this.loadedPig.y = ANCHOR.y;
    const pull = { x: vx / LAUNCH_POWER, y: vy / LAUNCH_POWER };
    this.launch(pull);
  }

  triggerAbility() {
    if (!this.activePig || this.abilityUsed || this.activePig.game.dead) return;
    const b = this.activePig;
    const type = b.game.type;
    this.abilityUsed = true;
    b.game.abilityUsed = true;
    this.hideAbilityHint();
    const v = b.velocity;

    if (type === 'dash') {
      const sp = Math.hypot(v.x, v.y) || 1;
      const dir = { x: v.x / sp, y: v.y / sp };
      const boost = Math.min(30, sp * 1.65 + 4);
      Body.setVelocity(b, { x: dir.x * boost, y: dir.y * boost - 0.6 });
      this.audio.boost();
      this.shake = Math.max(this.shake, 5);
      for (let i = 0; i < 14; i++) {
        this.particles.push({
          x: b.position.x - dir.x * 18, y: b.position.y - dir.y * 18,
          vx: -dir.x * rand(80, 280) + rand(-50, 50), vy: -dir.y * rand(80, 260) + rand(-50, 50),
          size: rand(3, 8), color: i % 3 ? '#8fd0ff' : '#ffffff', shape: 'spark',
          life: rand(.3, .6), maxLife: .6, rot: 0, vr: 0, gravity: 0, grow: 0,
        });
      }
    } else if (type === 'heavy') {
      Body.setDensity(b, 0.008);
      Body.setVelocity(b, { x: v.x * 0.9, y: v.y + 15 });
      this.audio.slam();
      this.shake = Math.max(this.shake, 9);
      this.spawnDust(b.position.x, b.position.y, 16, 1.2);
    } else if (type === 'bomb') {
      this.explode(b.position.x, b.position.y, 225, 1.15, b);
      this.removeBody(b);
      this.activePig = null;
      this.turnEnding = true;
      setTimeout(() => {
        this.turnEnding = false;
        this.afterTurn();
      }, 850);
    }
  }

  // ---------------------------------------------------------------- Collisions & damage

  onCollisions(e) {
    const now = performance.now();
    for (const pair of e.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      if (!a.game && !b.game) continue;
      const speed = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
      if (speed > 2) {
        this.collideOne(a, b, speed);
        this.collideOne(b, a, speed);
      }
      if (speed > 8.5 && now - this.lastThud > 95) {
        this.lastThud = now;
        this.audio.thud(Math.min(1.4, speed / 13));
        this.shake = Math.max(this.shake, Math.min(11, speed * 0.4));
        const mx = (a.position.x + b.position.x) / 2;
        const my = (a.position.y + b.position.y) / 2;
        if (Math.random() < 0.7) this.spawnDust(mx, my, 4, 0.55);
      }
    }
  }

  collideOne(target, other, speed) {
    const g = target.game;
    if (!g || g.dead) return;
    const otherKind = other.game ? other.game.kind : null;

    if (g.kind === 'bird') {
      if (speed > 6.2 || (otherKind === 'pig' && speed > 1.8) || (otherKind === 'tnt' && speed > 0.8)) {
        this.defeatBird(target);
      }
      return;
    }

    if (g.kind === 'block') {
      if (speed > 3.1) {
        const m = other.isStatic ? 7 : Math.min(other.mass || 2, 14);
        this.damageBlock(target, (speed - 2.2) * m * 1.55, other.position);
      }
      return;
    }

    if (g.kind === 'tnt') {
      if (speed > 2.1) this.explodeTnt(target);
      return;
    }

    if (g.kind === 'egg') {
      if (speed > 1.35 && otherKind !== 'egg') this.rescueEgg(target);
      return;
    }

    if (g.kind === 'pig' && speed > 12) {
      this.spawnDust(target.position.x, target.position.y, 3, 0.5);
    }
  }

  damageBlock(body, amount, from) {
    const g = body.game;
    if (!g || g.dead || amount <= 0) return;
    g.hp -= amount;
    g.flash = 1;
    if (amount > 18 && Math.random() < 0.45) {
      this.spawnDust(body.position.x, body.position.y, 2, 0.35);
    }
    if (g.hp <= 0) this.breakBlock(body);
  }

  breakBlock(body) {
    const g = body.game;
    if (!g || g.dead) return;
    g.dead = true;
    const mat = MATERIALS[g.material];
    this.addScore(mat.score, body.position.x, body.position.y - 8, `+${mat.score}`, '#ffe9bd');
    this.spawnDebris(body.position.x, body.position.y, g.material);
    this.shake = Math.max(this.shake, g.material === 'stone' ? 8 : 5);
    if (g.material === 'wood') this.audio.woodBreak();
    else if (g.material === 'glass') this.audio.glassBreak();
    else this.audio.stoneBreak();
    this.removeBody(body);
  }

  explodeTnt(body) {
    const g = body.game;
    if (!g || g.dead) return;
    g.dead = true;
    this.removeBody(body);
    this.addScore(100, body.position.x, body.position.y - 20, '+100', '#ffb08a');
    this.explode(body.position.x, body.position.y, 235, 1.2, body);
  }

  explode(x, y, radius, power, source) {
    this.audio.explode();
    this.shake = Math.max(this.shake, 23);
    this.spawnRing(x, y, '#ffe6a8');
    this.spawnExplosion(x, y);
    const bodies = Composite.allBodies(this.engine.world);
    for (const b of bodies) {
      if (b === source || b.isStatic || !b.game || b.game.dead) continue;
      const d = Math.hypot(b.position.x - x, b.position.y - y);
      if (d > radius) continue;
      const f = 1 - d / radius;
      const nx = (b.position.x - x) / (d || 1);
      const ny = (b.position.y - y) / (d || 1);
      Body.setVelocity(b, {
        x: b.velocity.x + nx * 17 * f * power,
        y: b.velocity.y + ny * 17 * f * power - 4.5 * f,
      });
      Body.setAngularVelocity(b, b.angularVelocity + nx * f * 0.35);
      if (b.game.kind === 'block') this.damageBlock(b, 195 * f * power, { x, y });
      else if (b.game.kind === 'bird') this.defeatBird(b);
      else if (b.game.kind === 'tnt') setTimeout(() => this.explodeTnt(b), 60 + Math.random() * 90);
      else if (b.game.kind === 'egg') this.rescueEgg(b);
    }
  }

  defeatBird(body) {
    const g = body.game;
    if (!g || g.dead) return;
    g.dead = true;
    this.removeBody(body);
    this.addScore(500, body.position.x, body.position.y - 16, '+500', '#ffd6c7');
    this.spawnFeathers(body.position.x, body.position.y, g.type);
    this.audio.poof();
    this.shake = Math.max(this.shake, 6);
    this.checkWin();
  }

  rescueEgg(body) {
    const g = body.game;
    if (!g || g.dead) return;
    g.dead = true;
    this.eggRescued = true;
    this.removeBody(body);
    this.addScore(1000, body.position.x, body.position.y - 22, '+1,000 EGG!', '#ffd23f');
    this.spawnSparkles(body.position.x, body.position.y);
    this.audio.egg();
    this.showToast('<b>GOLDEN EGG RESCUED!</b> &nbsp;+1,000', 2600);
  }

  removeBody(body) {
    if (!body || !body.game) return;
    if (!this.toRemove.includes(body)) this.toRemove.push(body);
  }

  processRemovals() {
    if (!this.toRemove.length) return;
    for (const body of this.toRemove) {
      if (body.game) body.game.dead = true;
      Composite.remove(this.engine.world, body);
    }
    this.toRemove.length = 0;
  }

  // ---------------------------------------------------------------- Turn flow

  finishTurn() {
    if (this.turnEnding) return;
    this.turnEnding = true;
    if (this.activePig) {
      this.activePig.game.spent = true;
      if (this.activePig.position.y > 1100) {
        this.activePig.game.dead = true;
        this.removeBody(this.activePig);
      }
    }
    this.activePig = null;
    this.hideAbilityHint();
    setTimeout(() => {
      this.turnEnding = false;
      this.afterTurn();
    }, 430);
  }

  afterTurn() {
    if (this.state !== 'playing' || this.winPending) return;
    if (this.queue.length > 0) this.loadNextPig();
    else this.maybeLose();
  }

  maybeLose() {
    if (this.losePending || this.winPending) return;
    if (!this.birds || !this.birds.some((b) => !b.game.dead)) return;
    this.losePending = true;
    setTimeout(() => {
      if (this.state === 'playing' && !this.winPending) this.showLose();
    }, 850);
  }

  checkWin() {
    if (this.state !== 'playing' || this.winPending) return;
    if (!this.birds || this.birds.some((b) => !b.game.dead)) return;
    this.winPending = true;
    this.hideAbilityHint();
    this.timeScale = 0.28;
    this.slowmoUntil = performance.now() + 950;
    this.shake = Math.max(this.shake, 10);
    setTimeout(() => {
      if (this.state === 'playing') {
        this.timeScale = 1;
        this.finishLevel();
      }
    }, 1600);
  }

  finishLevel() {
    if (this.state === 'win' || !this.level) return;
    const unused = this.queue.length;
    const bonus = 500 + unused * 1000;
    this.score += bonus;
    this.state = 'win';
    this.timeScale = 1;
    const stars = this.level.stars.reduce((n, t) => (this.score >= t ? n + 1 : n), 0);
    const prevStars = this.save.stars[this.level.id] || 0;
    const prevBest = this.save.best[this.level.id] || 0;
    this.save.stars[this.level.id] = Math.max(prevStars, stars);
    this.save.best[this.level.id] = Math.max(prevBest, this.score);
    this.persist();

    this.dom.winScore.textContent = this.score.toLocaleString('en-US');
    this.dom.winBest.textContent = `BEST ${Math.max(prevBest, this.score).toLocaleString('en-US')}`;
    this.dom.winEgg.classList.toggle('hidden', !this.eggRescued);
    this.dom.winEgg.innerHTML = this.eggRescued
      ? '<svg><use href="#icon-egg"/></svg> GOLDEN EGG RESCUED &nbsp;+1,000'
      : '';
    const starEls = this.dom.winStars.querySelectorAll('.star');
    starEls.forEach((el, i) => el.classList.toggle('on', i < stars));
    this.dom.winStars.classList.remove('show');
    void this.dom.winStars.offsetWidth;
    setTimeout(() => this.dom.winStars.classList.add('show'), 40);
    for (let i = 0; i < stars; i++) setTimeout(() => this.audio.star(i), 260 + i * 180);

    this.audio.win();
    this.spawnConfetti();
    this.updateHud();
    this.showOnly(this.dom.win);
    this.showHUD(true);
    this.buildLevelGrid();
  }

  showLose() {
    if (!this.level) return;
    this.state = 'lose';
    this.timeScale = 1;
    this.dom.loseTip.textContent = `Tip: ${this.level.tip}`;
    this.audio.lose();
    this.showOnly(this.dom.lose);
    this.showHUD(true);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.hideAbilityHint();
    this.showOnly(this.dom.pause);
    this.showHUD(true);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.showOnly(null);
    this.showHUD(true);
    this.last = performance.now();
  }

  // ---------------------------------------------------------------- Loop & particles

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.cw = Math.max(1, rect.width);
    this.ch = Math.max(1, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.cw * this.dpr);
    this.canvas.height = Math.round(this.ch * this.dpr);
    const s = Math.min(this.cw / W, this.ch / H);
    this.view = { scale: s, ox: (this.cw - W * s) / 2, oy: (this.ch - H * s) / 2 };
    if (this.state === 'rotate' && !this.isPortrait()) this.resumeFromRotate();
    else if (this.state === 'playing' && this.isPortrait() && !this.allowPortrait) this.showRotate();
  }

  frame(now) {
    const dtReal = Math.min(50, now - this.last);
    this.last = now;
    this.time += dtReal / 1000;
    this.updateAmbient(dtReal);

    if (this.state === 'playing' && this.engine) {
      if (this.timeScale < 1 && now > this.slowmoUntil) this.timeScale = 1;
      this.accum += dtReal * this.timeScale;
      let steps = 0;
      while (this.accum >= STEP && steps < 5) {
        Engine.update(this.engine, STEP);
        this.accum -= STEP;
        steps++;
      }
      if (steps > 0) {
        this.processRemovals();
        this.updateTurn(now, dtReal);
        for (const b of this.blocks) if (b.game.flash > 0) b.game.flash = Math.max(0, b.game.flash - dtReal * 0.0045);
        for (const b of this.tnts) if (b.game.flash > 0) b.game.flash = Math.max(0, b.game.flash - dtReal * 0.0045);
        if (this.activePig && !this.activePig.game.dead) {
          this.pigTrail.push({ x: this.activePig.position.x, y: this.activePig.position.y });
          if (this.pigTrail.length > 16) this.pigTrail.shift();
        }
      }
    }

    const pdt = dtReal * (this.state === 'playing' ? this.timeScale : 1);
    this.updateParticles(pdt);
    this.updatePopups(dtReal);
    this.shake = Math.max(0, this.shake - dtReal * 0.05);
    this.render(now);
    requestAnimationFrame((t) => this.frame(t));
  }

  updateAmbient(dt) {
    const ds = dt / 1000;
    for (const c of this.clouds) {
      c.x += c.sp * ds;
      if (c.x > 1780) c.x = -260;
    }
  }

  updateTurn(now, dt) {
    if (!this.activePig || this.winPending) return;
    const b = this.activePig;
    if (b.game.dead) { this.finishTurn(); return; }
    const age = now - this.launchTime;
    const sp = Math.hypot(b.velocity.x, b.velocity.y);
    if (b.position.y > 1080 || b.position.x < -260 || b.position.x > 1860) {
      b.game.dead = true;
      this.removeBody(b);
      this.processRemovals();
      this.finishTurn();
      return;
    }
    if (age > 850 && sp < 0.55) {
      this.restTime += dt;
      if (this.restTime > 480) this.finishTurn();
    } else {
      this.restTime = 0;
    }
    if (age > 9500) this.finishTurn();
  }

  updateParticles(dt) {
    if (!dt) return;
    const ds = dt / 1000;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= ds;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.vy += p.gravity * ds;
      p.x += p.vx * ds;
      p.y += p.vy * ds;
      p.rot += p.vr * ds;
      p.size += p.grow * ds;
    }
  }

  updatePopups(dt) {
    const ds = dt / 1000;
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= ds;
      p.y += p.vy * ds;
      p.vy *= 0.96;
      if (p.life <= 0) this.popups.splice(i, 1);
    }
  }

  spawnDust(x, y, count = 6, power = 1) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + rand(-14, 14), y: y + rand(-10, 10),
        vx: rand(-90, 90) * power, vy: rand(-120, 10) * power,
        size: rand(4, 11) * power, color: Math.random() < 0.5 ? '#e7d3ab' : '#cdb387',
        shape: 'smoke', life: rand(.4, .8), maxLife: .8, rot: 0, vr: 0,
        gravity: -30, grow: rand(10, 26),
      });
    }
  }

  spawnFeathers(x, y, type) {
    const style = BIRD_STYLE[type] || BIRD_STYLE.red;
    const colors = [style.body, style.dark, style.belly, '#fff6df'];
    for (let i = 0; i < 15; i++) {
      this.particles.push({
        x: x + rand(-12, 12), y: y + rand(-12, 12),
        vx: rand(-240, 240), vy: rand(-330, -40),
        size: rand(4, 9), color: colors[i % colors.length], shape: 'feather',
        life: rand(.7, 1.3), maxLife: 1.3, rot: rand(0, 6.28), vr: rand(-9, 9),
        gravity: 480, grow: 0,
      });
    }
    for (let i = 0; i < 6; i++) {
      this.particles.push({
        x, y, vx: rand(-60, 60), vy: rand(-80, 20), size: rand(10, 18),
        color: '#fff6df', shape: 'smoke', life: rand(.3, .55), maxLife: .55,
        rot: 0, vr: 0, gravity: -20, grow: 30,
      });
    }
  }

  spawnDebris(x, y, material) {
    const palette = material === 'wood'
      ? ['#c9803f', '#a9642c', '#e0a05c']
      : material === 'glass'
        ? ['#bfeaf2', '#8ed0dd', '#e8fbff']
        : ['#9aa0a8', '#7c838c', '#c1c6cd'];
    for (let i = 0; i < 13; i++) {
      this.particles.push({
        x: x + rand(-14, 14), y: y + rand(-14, 14),
        vx: rand(-260, 260), vy: rand(-320, -20),
        size: rand(3, 9), color: palette[i % palette.length],
        shape: material === 'glass' ? 'shard' : 'rect',
        life: rand(.5, 1.1), maxLife: 1.1, rot: rand(0, 6.28), vr: rand(-12, 12),
        gravity: 1250, grow: 0,
      });
    }
    this.spawnDust(x, y, 5, .7);
  }

  spawnExplosion(x, y) {
    for (let i = 0; i < 26; i++) {
      this.particles.push({
        x: x + rand(-30, 30), y: y + rand(-30, 30),
        vx: rand(-420, 420), vy: rand(-420, 220),
        size: rand(4, 13), color: i % 3 === 0 ? '#ffd23f' : i % 3 === 1 ? '#ff8a3d' : '#fff6df',
        shape: 'spark', life: rand(.3, .7), maxLife: .7, rot: 0, vr: 0, gravity: 320, grow: 0,
      });
    }
    for (let i = 0; i < 18; i++) {
      this.particles.push({
        x: x + rand(-45, 45), y: y + rand(-45, 45),
        vx: rand(-130, 130), vy: rand(-170, 30),
        size: rand(18, 40), color: i % 2 ? '#5f5147' : '#8a7664',
        shape: 'smoke', life: rand(.6, 1.15), maxLife: 1.15, rot: 0, vr: 0,
        gravity: -50, grow: rand(20, 55),
      });
    }
    for (let i = 0; i < 8; i++) {
      this.particles.push({
        x: x + rand(-35, 35), y: y + rand(-35, 35),
        vx: rand(-60, 60), vy: rand(-60, 60),
        size: rand(4, 10), color: '#fff0b3', shape: 'star',
        life: rand(.4, .8), maxLife: .8, rot: rand(0, 6.28), vr: rand(-8, 8),
        gravity: 120, grow: 0,
      });
    }
  }

  spawnRing(x, y, color) {
    this.particles.push({
      x, y, vx: 0, vy: 0, size: 16, color, shape: 'ring',
      life: .5, maxLife: .5, rot: 0, vr: 0, gravity: 0, grow: 520,
    });
  }

  spawnSparkles(x, y) {
    for (let i = 0; i < 24; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(60, 260);
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80,
        size: rand(3, 8), color: i % 2 ? '#ffd23f' : '#fff6df', shape: i % 3 ? 'star' : 'spark',
        life: rand(.5, 1), maxLife: 1, rot: rand(0, 6.28), vr: rand(-10, 10), gravity: 220, grow: 0,
      });
    }
    this.spawnRing(x, y, '#ffd23f');
  }

  spawnConfetti() {
    const colors = ['#ffd23f', '#9bcf4a', '#4aa8e8', '#e94b3c', '#ff8a3d', '#fff6df'];
    for (let i = 0; i < 150; i++) {
      this.particles.push({
        x: rand(-100, 1700), y: rand(-260, -10),
        vx: rand(-70, 70), vy: rand(120, 330),
        size: rand(5, 11), color: colors[i % colors.length], shape: 'confetti',
        life: rand(2.4, 4), maxLife: 4, rot: rand(0, 6.28), vr: rand(-9, 9),
        gravity: 260, grow: 0,
      });
    }
  }

  // ---------------------------------------------------------------- Render

  render(now) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);

    const sky = ctx.createLinearGradient(0, 0, 0, this.ch);
    sky.addColorStop(0, '#58c3ec');
    sky.addColorStop(0.48, '#a9e7f6');
    sky.addColorStop(0.82, '#ffe9b8');
    sky.addColorStop(1, '#ffd89b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.cw, this.ch);

    if (this.state === 'title' && this.isPortrait()) {
      this.drawPortraitTitle(now);
    } else {
      const shx = (Math.random() * 2 - 1) * this.shake;
      const shy = (Math.random() * 2 - 1) * this.shake;
      ctx.save();
      ctx.translate(this.view.ox + shx, this.view.oy + shy);
      ctx.scale(this.view.scale, this.view.scale);

      if (this.state === 'title' || !this.level) this.drawAttract(now);
      else this.drawGame(now);

      ctx.restore();
    }

    if (this.allowPortrait && this.isPortrait() && this.level && (this.state === 'playing' || this.state === 'paused')) {
      this.drawPortraitFallbackPanel();
    }

    const vig = ctx.createRadialGradient(this.cw / 2, this.ch / 2, Math.min(this.cw, this.ch) * 0.35, this.cw / 2, this.ch / 2, Math.max(this.cw, this.ch) * 0.78);
    vig.addColorStop(0, 'rgba(22, 48, 34, 0)');
    vig.addColorStop(1, 'rgba(22, 48, 34, 0.2)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, this.cw, this.ch);
  }

  drawGame(now) {
    this.drawBackdrop(now);
    this.drawSlingshotWood(now);

    if (this.loadedPig) this.drawBands(now);
    else this.drawSlackBands(now);

    this.drawTrail(now);
    this.drawBodies(now);

    if (this.loadedPig) {
      this.drawPouch(now);
      this.drawHeldPig(now);
      if (!this.dragging && this.usedPigs === 0 && this.levelIndex === 0) this.drawDragHint(now);
    }
    if (this.dragging) this.drawTrajectory(now);

    this.drawParticles();
    this.drawPopups();
    this.drawForeground(now);
  }

  drawAttract(now) {
    this.drawBackdrop(now);
    this.drawSlingshotWood(now);
    this.drawSlackBands(now);

    const a = this.attract;
    const bob = Math.sin(now / 620) * 5;
    this.ctx.fillStyle = 'rgba(40, 70, 28, .16)';
    this.ctx.beginPath();
    this.ctx.ellipse(a.pig.x + 6, 800, 62, 14, 0, 0, Math.PI * 2);
    this.ctx.fill();
    this.drawPigShape(a.pig.x, a.pig.y + bob, a.pig.r, a.pig.type, Math.sin(now / 900) * 0.06, 3.2, now);

    for (const s of a.blocks) {
      const fake = {
        position: { x: s.x, y: s.y },
        angle: s.a || 0,
        game: {
          kind: 'block', material: s.m, w: s.w, h: s.h, hp: 1, maxHp: 1,
          flash: 0, seed: s.x * 0.17 + s.y * 0.31, dead: false,
        },
      };
      this.drawBlock(fake);
    }
    for (const b of a.birds) {
      const fake = { position: { x: b.x, y: b.y }, angle: Math.sin(now / 800 + b.x) * 0.04, game: { type: b.type, seed: b.x } };
      this.drawBird(fake, now);
    }
    this.drawEggShape(a.egg.x, a.egg.y + Math.sin(now / 700) * 2, 16, 0);

    // A few drifting feathers make the title scene feel alive.
    const t = now / 1000;
    for (let i = 0; i < 5; i++) {
      const x = ((t * (14 + i * 4) + i * 230) % 1700) - 40;
      const y = 240 + Math.sin(t * 1.2 + i * 2) * 30 + i * 42;
      this.ctx.save();
      this.ctx.translate(x, y);
      this.ctx.rotate(Math.sin(t + i) * 0.7);
      this.ctx.globalAlpha = 0.5;
      this.ctx.fillStyle = i % 2 ? '#e94b3c' : '#fff6df';
      this.ctx.beginPath();
      this.ctx.ellipse(0, 0, 7, 3, 0, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }
  }

  drawPortraitFallbackPanel() {
    const ctx = this.ctx;
    const cw = this.cw;
    const ch = this.ch;
    const y = this.view.oy + H * this.view.scale + 18;
    if (y > ch - 70) return;
    const h = Math.min(150, ch - y - 18);
    const x = 20;
    const w = cw - 40;
    ctx.save();
    ctx.fillStyle = 'rgba(59, 42, 24, .14)';
    this.roundRect(ctx, x + 3, y + 6, w, h, 20);
    ctx.fill();
    ctx.fillStyle = '#fff6df';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    this.roundRect(ctx, x, y, w, h, 20);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(cw / 2, y + 43, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = '30px "Luckiest Guy", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('↻', cw / 2, y + 42);
    ctx.font = '18px "Luckiest Guy", sans-serif';
    ctx.fillStyle = INK;
    ctx.fillText('PORTRAIT MODE', cw / 2, y + 86);
    ctx.font = '800 11px Nunito, sans-serif';
    ctx.fillStyle = 'rgba(59, 42, 24, .7)';
    ctx.fillText('Drag the pig to aim. Rotate for a bigger battlefield.', cw / 2, y + 109);
    ctx.restore();
  }

  drawPortraitTitle(now) {
    const ctx = this.ctx;
    const cw = this.cw;
    const ch = this.ch;
    const gy = ch - 58;

    this.drawCloud(cw * 0.17, 116, 0.8, 1);
    this.drawCloud(cw * 0.83, 224, 0.64, 2);
    this.drawCloud(cw * 0.52, 74, 0.48, 3);
    this.drawCloud(cw * 0.3, 300, 0.38, 4);

    ctx.fillStyle = '#a8d96b';
    ctx.beginPath();
    ctx.moveTo(0, ch);
    ctx.lineTo(0, gy - 40);
    ctx.bezierCurveTo(cw * 0.2, gy - 82, cw * 0.42, gy - 20, cw * 0.62, gy - 48);
    ctx.bezierCurveTo(cw * 0.8, gy - 72, cw * 0.9, gy - 28, cw, gy - 44);
    ctx.lineTo(cw, ch);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#7cbe4c';
    ctx.beginPath();
    ctx.moveTo(0, ch);
    ctx.lineTo(0, gy - 4);
    ctx.bezierCurveTo(cw * 0.25, gy - 30, cw * 0.45, gy + 8, cw * 0.68, gy - 12);
    ctx.bezierCurveTo(cw * 0.84, gy - 26, cw * 0.92, gy - 2, cw, gy - 10);
    ctx.lineTo(cw, ch);
    ctx.closePath();
    ctx.fill();

    const grass = ctx.createLinearGradient(0, gy, 0, ch);
    grass.addColorStop(0, '#8ed05a');
    grass.addColorStop(1, '#5f9f38');
    ctx.fillStyle = grass;
    ctx.fillRect(0, gy, cw, ch - gy);

    ctx.strokeStyle = 'rgba(50, 110, 36, .55)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < 30; i++) {
      const x = hash(i * 2.1) * cw;
      const h = 6 + hash(i * 3.7) * 13;
      ctx.beginPath();
      ctx.moveTo(x, gy + 3);
      ctx.quadraticCurveTo(x + 3, gy - h * 0.4, x + 6, gy - h);
      ctx.stroke();
    }

    if (ch < 780) {
      // Short screens need the bottom strip for the menu, so let the cast peek in
      // from the corners instead of sitting behind the buttons.
      this.drawPigShape(52, ch - 18, 30, 'dash', Math.sin(now / 900) * 0.05, 3.2, now);
      this.drawBirdShape(cw - 44, ch - 20, 17, 'red', 0.12, 2.1, now);
      this.drawEggShape(cw - 82, ch - 12, 11, 0);
    } else {
      ctx.fillStyle = 'rgba(40, 70, 28, .16)';
      ctx.beginPath();
      ctx.ellipse(cw / 2, gy + 3, 74, 13, 0, 0, Math.PI * 2);
      ctx.fill();

      this.drawBirdShape(cw - 42, gy - 34, 25, 'red', 0.12, 2.1, now);
      this.drawBirdShape(cw - 94, gy - 21, 19, 'blue', -0.08, 5.3, now);
      this.drawEggShape(cw / 2 - 102, gy - 19, 14, 0);
      this.drawPigShape(cw / 2, gy - 64, 64, 'dash', Math.sin(now / 900) * 0.05, 3.2, now);
    }
  }

  drawBackdrop(now) {
    const ctx = this.ctx;
    const t = now / 1000;

    // Sun glow
    const glow = ctx.createRadialGradient(1325, 170, 20, 1325, 170, 220);
    glow.addColorStop(0, 'rgba(255, 246, 190, .95)');
    glow.addColorStop(0.45, 'rgba(255, 236, 150, .32)');
    glow.addColorStop(1, 'rgba(255, 236, 150, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(1050, -60, 560, 500);
    ctx.beginPath();
    ctx.arc(1325, 170, 62, 0, Math.PI * 2);
    ctx.fillStyle = '#fff2a8';
    ctx.fill();

    // Clouds
    for (const c of this.clouds) this.drawCloud(c.x, c.y, c.s, c.seed);

    // Distant hills
    ctx.fillStyle = '#b4de7c';
    ctx.beginPath();
    ctx.moveTo(-120, 840);
    ctx.lineTo(-120, 700);
    ctx.bezierCurveTo(120, 590, 380, 760, 640, 690);
    ctx.bezierCurveTo(840, 635, 1040, 750, 1280, 680);
    ctx.bezierCurveTo(1460, 630, 1620, 690, 1720, 660);
    ctx.lineTo(1720, 840);
    ctx.closePath();
    ctx.fill();

    // Mid hills
    ctx.fillStyle = '#93cc5f';
    ctx.beginPath();
    ctx.moveTo(-120, 850);
    ctx.lineTo(-120, 770);
    ctx.bezierCurveTo(150, 690, 340, 800, 560, 760);
    ctx.bezierCurveTo(780, 715, 900, 790, 1140, 750);
    ctx.bezierCurveTo(1360, 710, 1500, 770, 1720, 735);
    ctx.lineTo(1720, 850);
    ctx.closePath();
    ctx.fill();

    // Trees behind the action
    this.drawTree(175, 760, 0.95, '#4f8f3a');
    this.drawTree(610, 772, 0.7, '#4f8f3a');
    this.drawTree(1515, 760, 0.82, '#4f8f3a');

    // Near grass bank
    ctx.fillStyle = '#7cbe4c';
    ctx.beginPath();
    ctx.moveTo(-120, 900);
    ctx.lineTo(-120, 815);
    ctx.bezierCurveTo(220, 790, 420, 830, 690, 812);
    ctx.bezierCurveTo(940, 795, 1110, 825, 1350, 810);
    ctx.bezierCurveTo(1510, 800, 1630, 812, 1720, 804);
    ctx.lineTo(1720, 900);
    ctx.closePath();
    ctx.fill();

    this.drawGround(now, t);
  }

  drawCloud(x, y, s, seed) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.globalAlpha = 0.86;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.arc(32, 6, 24, 0, Math.PI * 2);
    ctx.arc(-34, 8, 22, 0, Math.PI * 2);
    ctx.arc(4, -18, 23, 0, Math.PI * 2);
    ctx.arc(-12, 12, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#bfe8f4';
    ctx.beginPath();
    ctx.ellipse(0, 22, 52, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawTree(x, y, s, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.strokeStyle = '#6b4a2a';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 70);
    ctx.lineTo(0, 0);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(52, 92, 40, .35)';
    ctx.lineWidth = 2;
    const blobs = [[-26, -12, 30], [26, -18, 28], [0, -44, 34], [0, 8, 27]];
    for (const [bx, by, br] of blobs) {
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  drawGround(now, t) {
    const ctx = this.ctx;
    // Grass top
    const grass = ctx.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 34);
    grass.addColorStop(0, '#8ed05a');
    grass.addColorStop(1, '#63a83c');
    ctx.fillStyle = grass;
    ctx.fillRect(-100, GROUND_Y, W + 200, 34);

    // Dirt
    const dirt = ctx.createLinearGradient(0, GROUND_Y + 30, 0, H);
    dirt.addColorStop(0, '#d19a5e');
    dirt.addColorStop(1, '#a86d3d');
    ctx.fillStyle = dirt;
    ctx.fillRect(-100, GROUND_Y + 30, W + 200, H - GROUND_Y);

    // Grass fringe
    ctx.strokeStyle = '#4f9234';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < 110; i++) {
      const x = hash(i * 1.37) * W;
      const h = 4 + hash(i * 2.11) * 10;
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 1);
      ctx.quadraticCurveTo(x + 2, GROUND_Y - h * 0.5, x + (hash(i) - 0.5) * 8, GROUND_Y - h);
      ctx.stroke();
    }

    // Pebbles and dirt speckles
    for (let i = 0; i < 70; i++) {
      const x = hash(i * 3.7 + 1) * W;
      const y = GROUND_Y + 40 + hash(i * 5.1) * 50;
      const r = 1 + hash(i * 7.3) * 2.4;
      ctx.fillStyle = i % 4 === 0 ? 'rgba(120, 77, 42, .5)' : 'rgba(255, 230, 190, .25)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Flowers
    const flowers = [[120, 812], [530, 816], [980, 810], [1460, 814]];
    flowers.forEach(([fx, fy], i) => {
      ctx.strokeStyle = '#4f9234';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fx, fy + 8);
      ctx.lineTo(fx, fy - 2);
      ctx.stroke();
      for (let k = 0; k < 5; k++) {
        const a = k / 5 * Math.PI * 2 + Math.sin(t + i) * 0.1;
        ctx.fillStyle = i % 2 ? '#fff6df' : '#ffd23f';
        ctx.beginPath();
        ctx.arc(fx + Math.cos(a) * 4, fy - 4 + Math.sin(a) * 4, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ff8a3d';
      ctx.beginPath();
      ctx.arc(fx, fy - 4, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });

    // Bushes near the edges
    this.drawBush(70, 822, 1.1);
    this.drawBush(690, 824, 0.8);
    this.drawBush(1580, 824, 1.0);
  }

  drawBush(x, y, s) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = '#5b9b39';
    ctx.beginPath();
    ctx.arc(-22, -8, 20, 0, Math.PI * 2);
    ctx.arc(4, -18, 26, 0, Math.PI * 2);
    ctx.arc(30, -6, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#78b84c';
    ctx.beginPath();
    ctx.arc(-8, -18, 15, 0, Math.PI * 2);
    ctx.arc(20, -20, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawForeground(now) {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(50, 110, 36, .55)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const x = 20 + i * 9;
      const h = 10 + hash(i) * 16;
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 4);
      ctx.quadraticCurveTo(x + 4, GROUND_Y - h * 0.4, x + 9, GROUND_Y - h);
      ctx.stroke();
    }
    for (let i = 0; i < 14; i++) {
      const x = W - 20 - i * 9;
      const h = 10 + hash(i + 20) * 16;
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 4);
      ctx.quadraticCurveTo(x - 4, GROUND_Y - h * 0.4, x - 9, GROUND_Y - h);
      ctx.stroke();
    }
  }

  drawSlingshotWood(now) {
    const ctx = this.ctx;
    // Ground shadow
    ctx.fillStyle = 'rgba(40, 60, 30, .18)';
    ctx.beginPath();
    ctx.ellipse(278, 824, 58, 11, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const drawPath = (width, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(278, 824);
      ctx.lineTo(278, 724);
      ctx.moveTo(278, 732);
      ctx.lineTo(249, 685);
      ctx.moveTo(278, 732);
      ctx.lineTo(307, 685);
      ctx.stroke();
    };

    drawPath(31, INK);
    drawPath(22, '#a9652c');
    drawPath(12, '#c8843f');
    ctx.strokeStyle = 'rgba(255, 220, 160, .35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(272, 820);
    ctx.lineTo(272, 730);
    ctx.stroke();

    // Grain marks
    ctx.strokeStyle = 'rgba(90, 48, 20, .35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(281, 805);
    ctx.quadraticCurveTo(284, 780, 280, 755);
    ctx.moveTo(254, 702);
    ctx.quadraticCurveTo(248, 690, 252, 682);
    ctx.stroke();

    // Rubber anchors
    ctx.fillStyle = '#5d3024';
    ctx.beginPath();
    ctx.arc(249, 684, 7, 0, Math.PI * 2);
    ctx.arc(307, 684, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  drawBands(now) {
    if (!this.loadedPig) return;
    const ctx = this.ctx;
    const h = this.loadedPig;
    const left = { x: 249, y: 684 };
    const right = { x: 307, y: 684 };
    ctx.lineCap = 'round';
    for (const anchor of [left, right]) {
      ctx.strokeStyle = '#4a231a';
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(h.x, h.y);
      ctx.stroke();
      ctx.strokeStyle = '#a84236';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(h.x, h.y);
      ctx.stroke();
    }
  }

  drawSlackBands(now) {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    for (const anchor of [{ x: 249, y: 684 }, { x: 307, y: 684 }]) {
      const sway = Math.sin(now / 700 + anchor.x) * 3;
      ctx.strokeStyle = '#4a231a';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.quadraticCurveTo(anchor.x + sway, 745, 278 + sway * 0.5, 768);
      ctx.stroke();
      ctx.strokeStyle = '#a84236';
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.quadraticCurveTo(anchor.x + sway, 745, 278 + sway * 0.5, 768);
      ctx.stroke();
    }
  }

  drawPouch(now) {
    if (!this.loadedPig) return;
    const ctx = this.ctx;
    const h = this.loadedPig;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate((h.x - ANCHOR.x) * 0.0012);
    ctx.fillStyle = '#5b3322';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    this.roundRect(ctx, -19, -27, 38, 54, 9);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 210, 150, .22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-12, -18);
    ctx.lineTo(-12, 18);
    ctx.stroke();
    ctx.restore();
  }

  drawHeldPig(now) {
    const h = this.loadedPig;
    const pulse = 1 + Math.sin(now / 420) * 0.018;
    const angle = clamp((h.x - ANCHOR.x) * 0.0014, -0.26, 0.26);
    this.ctx.save();
    this.ctx.translate(h.x, h.y);
    this.ctx.rotate(angle);
    this.ctx.scale(pulse, pulse);
    this.drawPigShape(0, 0, 26, h.type, 0, 4.7, now);
    this.ctx.restore();
  }

  drawDragHint(now) {
    const ctx = this.ctx;
    const bob = Math.sin(now / 280) * 3;
    const x = ANCHOR.x;
    const y = ANCHOR.y - 72 + bob;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.font = '24px "Luckiest Guy", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 6;
    ctx.strokeText('DRAG!', x, y);
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('DRAG!', x, y);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 2, y + 16);
    ctx.quadraticCurveTo(x - 28, y + 34, x - 44, y + 28);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 34, y + 22);
    ctx.lineTo(x - 45, y + 28);
    ctx.lineTo(x - 36, y + 36);
    ctx.stroke();
    ctx.restore();
  }

  drawTrail(now) {
    if (!this.activePig || this.pigTrail.length < 2) return;
    const ctx = this.ctx;
    for (let i = 0; i < this.pigTrail.length; i++) {
      const p = this.pigTrail[i];
      const a = (i / this.pigTrail.length) * 0.22;
      ctx.fillStyle = `rgba(255, 246, 223, ${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 + i * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawTrajectory(now) {
    if (!this.loadedPig) return;
    const ctx = this.ctx;
    const h = this.loadedPig;
    let vx = (ANCHOR.x - h.x) * LAUNCH_POWER;
    let vy = (ANCHOR.y - h.y) * LAUNCH_POWER;
    let x = h.x;
    let y = h.y;
    let landing = null;
    ctx.lineCap = 'round';
    for (let i = 0; i < 150; i++) {
      vy += 0.2778;
      x += vx;
      y += vy;
      if (y > GROUND_Y) { landing = { x, y: GROUND_Y }; break; }
      if (i % 5 === 0 && i > 2) {
        const t = i / 150;
        const r = 4.6 * (1 - t) + 1.2;
        ctx.globalAlpha = 0.75 * (1 - t * 0.75);
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(x, y, r + 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = CREAM;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (landing) {
      const pulse = 1 + Math.sin(now / 180) * 0.08;
      ctx.strokeStyle = 'rgba(59, 42, 24, .45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(landing.x, GROUND_Y + 2, 20 * pulse, 7 * pulse, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawBodies(now) {
    for (const b of this.blocks) if (!b.game.dead) this.drawBlock(b);
    for (const b of this.tnts) if (!b.game.dead) this.drawTnt(b, now);
    for (const b of this.eggs) if (!b.game.dead) this.drawEgg(b, now);
    for (const b of this.birds) if (!b.game.dead) this.drawBird(b, now);
    for (const b of this.pigs) {
      if (b.game.dead || b === this.activePig) continue;
      this.drawPigBody(b, now);
    }
    if (this.activePig && !this.activePig.game.dead) this.drawPigBody(this.activePig, now);
  }

  drawBlock(body) {
    const g = body.game;
    const ctx = this.ctx;
    const w = g.w;
    const h = g.h;
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    const x = -w / 2;
    const y = -h / 2;
    const r = Math.min(4, w / 5, h / 5);
    this.roundRect(ctx, x, y, w, h, r);

    if (g.material === 'wood') {
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, '#dfa563');
      grad.addColorStop(0.45, '#c9833f');
      grad.addColorStop(1, '#a9632b');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = '#6e3f1b';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(104, 56, 21, .32)';
      ctx.lineWidth = 1.5;
      const lines = Math.max(2, Math.floor(Math.min(w, h) / 9));
      for (let i = 0; i < lines; i++) {
        const ly = y + 8 + (i + 0.5) * ((h - 16) / lines);
        ctx.beginPath();
        ctx.moveTo(x + 5, ly);
        ctx.bezierCurveTo(x + w * 0.3, ly - 2, x + w * 0.7, ly + 2, x + w - 5, ly);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255, 225, 175, .25)';
      ctx.fillRect(x + 4, y + 3, Math.max(2, w - 8), 3);
    } else if (g.material === 'glass') {
      ctx.fillStyle = 'rgba(185, 236, 247, .55)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(86, 158, 175, .95)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.save();
      this.roundRect(ctx, x, y, w, h, r);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255, 255, 255, .62)';
      ctx.lineWidth = Math.max(3, Math.min(w, h) * 0.16);
      ctx.beginPath();
      ctx.moveTo(x + w * 0.15, y + h);
      ctx.lineTo(x + w * 0.55, y);
      ctx.moveTo(x + w * 0.55, y + h);
      ctx.lineTo(x + w * 0.85, y);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255, 255, 255, .8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 4);
      ctx.lineTo(x + w - 6, y + 4);
      ctx.stroke();
    } else {
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, '#c9ced4');
      grad.addColorStop(0.5, '#a7adb5');
      grad.addColorStop(1, '#858c95');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = '#5e656e';
      ctx.lineWidth = 3;
      ctx.stroke();
      for (let i = 0; i < 9; i++) {
        const sx = x + 5 + hash(g.seed + i * 2.3) * (w - 10);
        const sy = y + 5 + hash(g.seed + i * 4.1) * (h - 10);
        ctx.fillStyle = i % 3 === 0 ? 'rgba(255, 255, 255, .22)' : 'rgba(66, 72, 80, .2)';
        ctx.beginPath();
        ctx.arc(sx, sy, 1.2 + hash(g.seed + i) * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255, 255, 255, .18)';
      ctx.fillRect(x + 4, y + 3, Math.max(2, w - 8), 3);
    }

    // Damage cracks
    const hp = clamp(g.hp / g.maxHp, 0, 1);
    if (hp < 0.76) {
      const count = 1 + Math.floor((1 - hp) * 3);
      ctx.strokeStyle = `rgba(52, 34, 22, ${0.25 + (1 - hp) * 0.55})`;
      ctx.lineWidth = 1.6;
      for (let c = 0; c < count; c++) {
        const sx = x + 6 + hash(g.seed + c * 5.7) * (w - 12);
        const sy = y + 4 + hash(g.seed + c * 9.1) * (h - 8);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + (hash(g.seed + c * 3.3) - 0.5) * w * 0.3, sy + h * 0.22);
        ctx.lineTo(sx + (hash(g.seed + c * 7.7) - 0.5) * w * 0.34, sy + h * 0.45);
        ctx.stroke();
      }
    }

    if (g.flash > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${g.flash * 0.42})`;
      this.roundRect(ctx, x, y, w, h, r);
      ctx.fill();
    }
    ctx.restore();
  }

  drawTnt(body, now) {
    const ctx = this.ctx;
    const g = body.game;
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    this.roundRect(ctx, -26, -26, 52, 52, 5);
    const grad = ctx.createLinearGradient(0, -26, 0, 26);
    grad.addColorStop(0, '#d06f36');
    grad.addColorStop(1, '#a94d24');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(76, 36, 16, .6)';
    ctx.lineWidth = 2;
    this.roundRect(ctx, -19, -19, 38, 38, 3);
    ctx.stroke();

    ctx.font = '700 19px "Luckiest Guy", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.strokeText('TNT', 0, 1);
    ctx.fillStyle = CREAM;
    ctx.fillText('TNT', 0, 1);

    // fuse
    ctx.strokeStyle = '#4a3b2f';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(10, -26);
    ctx.quadraticCurveTo(20, -38, 14, -46);
    ctx.stroke();
    const spark = 2.2 + Math.sin(now / 90) * 0.8;
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(14, -47, spark + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8a3d';
    ctx.beginPath();
    ctx.arc(14, -47, spark, 0, Math.PI * 2);
    ctx.fill();

    if (g.flash > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${g.flash * 0.4})`;
      this.roundRect(ctx, -26, -26, 52, 52, 5);
      ctx.fill();
    }
    ctx.restore();
  }

  drawEgg(body, now) {
    this.drawEggShape(body.position.x, body.position.y, 16, body.angle);
  }

  drawEggShape(x, y, r, angle) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, r * 2.6);
    glow.addColorStop(0, 'rgba(255, 226, 110, .5)');
    glow.addColorStop(1, 'rgba(255, 226, 110, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.95, r * 1.22, 0, 0, Math.PI * 2);
    const grad = ctx.createLinearGradient(-r, -r, r, r);
    grad.addColorStop(0, '#fff7cf');
    grad.addColorStop(0.45, '#ffd94a');
    grad.addColorStop(1, '#e3a61b');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, .8)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.3, -r * 0.42, r * 0.2, r * 0.35, -0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff6df';
    this.drawStarPath(ctx, r * 0.72, -r * 0.8, r * 0.28, r * 0.12, 4, 0.2);
    ctx.fill();
    ctx.restore();
  }

  drawBird(body, now) {
    const g = body.game;
    this.drawBirdShape(body.position.x, body.position.y, 20, g.type, body.angle, g.seed, now);
  }

  drawBirdShape(x, y, r, type, angle, seed, now) {
    const ctx = this.ctx;
    const style = BIRD_STYLE[type] || BIRD_STYLE.red;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);

    // Tail feathers
    ctx.fillStyle = style.dark;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      ctx.save();
      ctx.rotate(i * 0.28);
      ctx.beginPath();
      ctx.moveTo(r * 0.72, -r * 0.12);
      ctx.lineTo(r * 1.55, -r * 0.36);
      ctx.lineTo(r * 1.42, r * 0.08);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Body
    const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.1);
    grad.addColorStop(0, style.body);
    grad.addColorStop(1, style.dark);
    ctx.fillStyle = grad;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Belly
    ctx.fillStyle = style.belly;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.ellipse(-r * 0.02, r * 0.3, r * 0.58, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Wing
    ctx.save();
    ctx.rotate(0.22);
    ctx.fillStyle = style.wing;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(r * 0.12, r * 0.1, r * 0.4, r * 0.27, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, .22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-r * 0.08, r * 0.04);
    ctx.quadraticCurveTo(r * 0.18, r * 0.12, r * 0.36, r * 0.2);
    ctx.stroke();
    ctx.restore();

    // Head tuft / fuse
    if (type === 'black') {
      ctx.strokeStyle = '#4a3b2f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(r * 0.05, -r * 0.96);
      ctx.quadraticCurveTo(r * 0.3, -r * 1.35, r * 0.1, -r * 1.58);
      ctx.stroke();
      const spark = 2 + Math.sin(now / 80 + seed) * 0.7;
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(r * 0.1, -r * 1.6, spark + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff8a3d';
      ctx.beginPath();
      ctx.arc(r * 0.1, -r * 1.6, spark, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = style.dark;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i++) {
        ctx.save();
        ctx.rotate(i * 0.34);
        ctx.beginPath();
        ctx.moveTo(-r * 0.1, -r * 0.9);
        ctx.lineTo(0, -r * 1.4);
        ctx.lineTo(r * 0.16, -r * 0.88);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // Eyes
    const blink = ((now / 1000 + seed * 0.7) % 4.6) < 0.1;
    const ex1 = -r * 0.3;
    const ex2 = r * 0.17;
    const ey = -r * 0.22;
    if (blink) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex1 - r * 0.2, ey);
      ctx.lineTo(ex1 + r * 0.16, ey);
      ctx.moveTo(ex2 - r * 0.18, ey);
      ctx.lineTo(ex2 + r * 0.16, ey);
      ctx.stroke();
    } else {
      for (const [ex, er] of [[ex1, r * 0.27], [ex2, r * 0.24]]) {
        ctx.fillStyle = '#fffdf5';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ex, ey, er, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#2b2118';
        ctx.beginPath();
        ctx.arc(ex - r * 0.05, ey + r * 0.02, er * 0.48, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(ex - r * 0.12, ey - r * 0.06, er * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Angry brows
    ctx.strokeStyle = INK;
    ctx.lineWidth = r * 0.15;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.66, -r * 0.55);
    ctx.lineTo(-r * 0.08, -r * 0.38);
    ctx.moveTo(r * 0.5, -r * 0.56);
    ctx.lineTo(r * 0.03, -r * 0.42);
    ctx.stroke();

    // Beak
    ctx.fillStyle = '#ff9f1c';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-r * 1.08, r * 0.02);
    ctx.lineTo(-r * 0.44, -r * 0.2);
    ctx.lineTo(-r * 0.44, r * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e07a0c';
    ctx.beginPath();
    ctx.moveTo(-r * 0.44, r * 0.02);
    ctx.lineTo(-r * 0.44, r * 0.25);
    ctx.lineTo(-r * 0.82, r * 0.1);
    ctx.closePath();
    ctx.fill();

    // Cheek
    ctx.fillStyle = 'rgba(255, 130, 120, .35)';
    ctx.beginPath();
    ctx.ellipse(r * 0.4, r * 0.28, r * 0.18, r * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();

    // Highlight
    ctx.fillStyle = 'rgba(255, 255, 255, .18)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.35, -r * 0.5, r * 0.26, r * 0.16, -0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawPigBody(body, now) {
    this.drawPigShape(body.position.x, body.position.y, 26, body.game.type, body.angle, body.game.seed, now);
  }

  drawPigShape(x, y, r, type, angle, seed, now) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);

    // Ears
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * r * 0.58, -r * 0.66);
      ctx.rotate(side * 0.32);
      ctx.fillStyle = '#8fc746';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.28, r * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(70, 120, 40, .3)';
      ctx.beginPath();
      ctx.ellipse(0, r * 0.03, r * 0.13, r * 0.19, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Head
    const grad = ctx.createRadialGradient(-r * 0.32, -r * 0.38, r * 0.08, 0, 0, r * 1.1);
    grad.addColorStop(0, '#b8e36f');
    grad.addColorStop(0.55, '#9bcf4a');
    grad.addColorStop(1, '#7fb33b');
    ctx.fillStyle = grad;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Highlight
    ctx.fillStyle = 'rgba(255, 255, 255, .2)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.36, -r * 0.48, r * 0.26, r * 0.17, -0.55, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    const blink = ((now / 1000 + seed * 0.5) % 4.2) < 0.09;
    const ey = -r * 0.2;
    if (blink) {
      ctx.strokeStyle = '#2b2118';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-r * 0.47, ey);
      ctx.lineTo(-r * 0.15, ey);
      ctx.moveTo(r * 0.15, ey);
      ctx.lineTo(r * 0.47, ey);
      ctx.stroke();
    } else {
      for (const ex of [-r * 0.31, r * 0.31]) {
        ctx.fillStyle = '#fffdf5';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(ex, ey, r * 0.2, r * 0.24, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#2b2118';
        ctx.beginPath();
        ctx.arc(ex - r * 0.03, ey + r * 0.02, r * 0.09, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(ex - r * 0.08, ey - r * 0.05, r * 0.035, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Angry brows
    ctx.strokeStyle = '#2b2118';
    ctx.lineWidth = r * 0.11;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.58, -r * 0.47);
    ctx.lineTo(-r * 0.12, -r * 0.36);
    ctx.moveTo(r * 0.58, -r * 0.47);
    ctx.lineTo(r * 0.12, -r * 0.36);
    ctx.stroke();

    // Snout
    ctx.fillStyle = '#7fb33b';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.24, r * 0.46, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#4e7726';
    for (const nx of [-r * 0.16, r * 0.16]) {
      ctx.beginPath();
      ctx.ellipse(nx, r * 0.24, r * 0.06, r * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Smile
    ctx.strokeStyle = 'rgba(52, 38, 24, .75)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, r * 0.66);
    ctx.quadraticCurveTo(0, r * 0.78, r * 0.2, r * 0.66);
    ctx.stroke();

    // Cheeks
    ctx.fillStyle = 'rgba(255, 120, 110, .28)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * r * 0.6, r * 0.12, r * 0.15, r * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ability accessories
    if (type === 'dash') {
      ctx.save();
      ctx.rotate(-0.06);
      ctx.fillStyle = '#4aa8e8';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.2;
      this.roundRect(ctx, -r * 0.92, -r * 0.66, r * 1.84, r * 0.24, r * 0.1);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2c7fba';
      ctx.beginPath();
      ctx.moveTo(r * 0.82, -r * 0.6);
      ctx.lineTo(r * 1.22, -r * 0.78);
      ctx.lineTo(r * 1.06, -r * 0.46);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (type === 'bomb') {
      ctx.fillStyle = '#ff8a3d';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.2;
      this.roundRect(ctx, -r * 0.9, -r * 0.64, r * 1.8, r * 0.22, r * 0.1);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#4a3b2f';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(r * 0.02, -r * 0.66);
      ctx.quadraticCurveTo(r * 0.3, -r * 1.2, r * 0.06, -r * 1.42);
      ctx.stroke();
      const spark = 2 + Math.sin(now / 80 + seed) * 0.6;
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(r * 0.06, -r * 1.44, spark + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff8a3d';
      ctx.beginPath();
      ctx.arc(r * 0.06, -r * 1.44, spark, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'heavy') {
      const helm = ctx.createLinearGradient(0, -r * 1.05, 0, -r * 0.25);
      helm.addColorStop(0, '#d8dde3');
      helm.addColorStop(1, '#8d949d');
      ctx.fillStyle = helm;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.arc(0, -r * 0.28, r * 0.98, Math.PI * 1.02, Math.PI * 1.98);
      ctx.lineTo(r * 0.98, -r * 0.28);
      ctx.lineTo(-r * 0.98, -r * 0.28);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#737b85';
      this.roundRect(ctx, -r * 1.02, -r * 0.38, r * 2.04, r * 0.16, r * 0.06);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#c7ccd3';
      for (const rx of [-r * 0.55, 0, r * 0.55]) {
        ctx.beginPath();
        ctx.arc(rx, -r * 0.72, r * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  drawParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot || 0);
      if (p.shape === 'smoke') {
        ctx.globalAlpha = a * 0.42;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1.5, p.size * 0.4);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-p.vx * 0.016, -p.vy * 0.016);
        ctx.stroke();
      } else if (p.shape === 'rect' || p.shape === 'confetti') {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      } else if (p.shape === 'shard') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.8, p.size * 0.5);
        ctx.lineTo(-p.size * 0.5, p.size * 0.7);
        ctx.closePath();
        ctx.fill();
      } else if (p.shape === 'feather') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(59, 42, 24, .25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-p.size * 0.8, 0);
        ctx.lineTo(p.size * 0.8, 0);
        ctx.stroke();
      } else if (p.shape === 'star') {
        ctx.fillStyle = p.color;
        this.drawStarPath(ctx, 0, 0, p.size, p.size * 0.45, 4, 0);
        ctx.fill();
      } else if (p.shape === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = a * 0.7;
        ctx.lineWidth = 8 * a;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawPopups() {
    const ctx = this.ctx;
    for (const p of this.popups) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `${p.size}px "Luckiest Guy", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 6;
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }
  }

  drawStarPath(ctx, cx, cy, outer, inner, points, rotation) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = rotation + i * Math.PI / points;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }
}

const game = new Game();
window.__game = game;
