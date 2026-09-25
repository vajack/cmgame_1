(() => {
  "use strict";

  // ---------- Canvas setup ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1;
  let playW = 0, playX0 = 0;
  let cx = 0, cy = 0, R = 0, fieldR = 0, hexSize = 0;

  const ALTAR_ANGLE = -Math.PI / 2;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    playW = Math.min(W, 480);
    playX0 = (W - playW) / 2;
    cx = playX0 + playW / 2;
    cy = H * 0.44;
    R = Math.min(playW, H * 0.62) * 0.36;
    fieldR = R - R * 0.17;
    hexSize = fieldR * 0.27;
    layoutSlots();
  }
  window.addEventListener("resize", resize);

  // ---------- Audio ----------
  let actx = null;
  let muted = false;
  function ac() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    return actx;
  }
  function beep(freq, dur, type = "sine", vol = 0.16, glideTo = null) {
    if (muted) return;
    try {
      const c = ac();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, c.currentTime);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, c.currentTime + dur);
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + dur);
    } catch (e) { /* ignore */ }
  }
  const sfx = {
    hit: () => beep(300 + Math.random() * 120, 0.07, "square", 0.09, 180),
    kill: () => beep(500 + Math.random() * 150, 0.12, "sine", 0.14, 900),
    breach: () => beep(140, 0.3, "sawtooth", 0.22, 50),
    merge: () => { beep(500, 0.1, "sine", 0.18, 750); setTimeout(() => beep(820, 0.14, "sine", 0.18, 1150), 90); },
    gearBreak: () => { beep(300, 0.2, "square", 0.2, 500); setTimeout(() => beep(700, 0.2, "sine", 0.2, 1000), 100); },
    success: () => { beep(600, 0.15, "sine", 0.22, 1000); setTimeout(() => beep(900, 0.2, "sine", 0.2, 1300), 120); },
    fail: () => beep(220, 0.4, "sawtooth", 0.2, 70),
    clear: () => { beep(700, 0.2, "sine", 0.22, 1050); setTimeout(() => beep(1050, 0.25, "sine", 0.2, 1400), 150); },
  };

  // ---------- Persistent best ----------
  const BEST_KEY = "circle_td_best_stage";
  let bestStage = parseInt(localStorage.getItem(BEST_KEY) || "1", 10);

  // ---------- DOM refs ----------
  const el = {
    stageVal: document.getElementById("stageVal"),
    heroCountVal: document.getElementById("heroCountVal"),
    goldVal: document.getElementById("goldVal"),
    lives: document.getElementById("lives"),
    stageClearBanner: document.getElementById("stageClearBanner"),
    routeChoice: document.getElementById("routeChoice"),
    startScreen: document.getElementById("startScreen"),
    failScreen: document.getElementById("failScreen"),
    failStageVal: document.getElementById("failStageVal"),
    failPowerVal: document.getElementById("failPowerVal"),
    failGoldVal: document.getElementById("failGoldVal"),
    newBestMsg: document.getElementById("newBestMsg"),
    muteBtn: document.getElementById("muteBtn"),
    cardA: document.getElementById("cardA"),
    cardB: document.getElementById("cardB"),
  };

  const MAX_LIVES = 8;
  const TIERS = [1, 3, 5, 10, 20, 30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000];
  const EVOLVE_TIER_VALUE = 10;
  const HERO_ATK_INTERVAL = 0.42;

  // ---------- Game state ----------
  const STATE = { START: 0, PLAYING: 1, EVOLVE: 2, FAIL: 3 };
  let state = STATE.START;

  let altar = { lives: MAX_LIVES, flash: 0 };
  let stage = { index: 1, timer: 0, duration: 26, spawnTimer: 0.6, clearing: false, clearTimer: 0 };
  let enemies = [], particles = [], flashTexts = [], shake = 0, gold = 0, pendingCards = null;
  let slots = [];
  let gear = null;
  let gearSpawnTimer = 6;
  let selectedSlot = -1;
  let maxPower = 1;

  function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function enemyPos(e) {
    return { x: cx + R * Math.cos(e.angle), y: cy + R * Math.sin(e.angle) };
  }

  function angularDistToAltar(angle) {
    return Math.abs(normalizeAngle(ALTAR_ANGLE - angle));
  }

  // Attack range grows with tier: value-1 heroes can barely reach past the
  // field's edge, later tiers reach across the whole arena.
  function heroRangePx(tierIndex) {
    return Math.min(R * 1.9, R * (0.52 + tierIndex * 0.13));
  }

  // ---------- Hex slot grid ----------
  function buildSlotCoords() {
    const coords = [];
    for (let q = -2; q <= 2; q++) {
      const rMin = Math.max(-2, -q - 2);
      const rMax = Math.min(2, -q + 2);
      for (let r = rMin; r <= rMax; r++) coords.push({ q, r });
    }
    return coords;
  }

  function layoutSlots() {
    if (slots.length === 0) {
      buildSlotCoords().forEach(({ q, r }) => slots.push({ q, r, x: 0, y: 0, hero: null }));
    }
    for (const s of slots) {
      s.x = cx + hexSize * Math.sqrt(3) * (s.q + s.r / 2);
      s.y = cy + hexSize * 1.5 * s.r;
    }
  }

  function makeHero(tierIndex) {
    return { tierIndex, attack: TIERS[tierIndex], atkTimer: Math.random() * HERO_ATK_INTERVAL, evolved: false, theme: null, flashHit: 0 };
  }

  function resetRun() {
    altar = { lives: MAX_LIVES, flash: 0 };
    stage = { index: 1, timer: 0, duration: 26, spawnTimer: 0.6, clearing: false, clearTimer: 0 };
    enemies = [];
    particles = [];
    flashTexts = [];
    shake = 0;
    gold = 0;
    pendingCards = null;
    gear = null;
    gearSpawnTimer = 6;
    selectedSlot = -1;
    maxPower = 1;
    for (const s of slots) s.hero = null;
    // Place starters on the outer ring, spread 90° apart: a tier-1 hero's
    // short range only reaches the enemy path from near the field's edge.
    const outerCoords = [{ q: 2, r: 0 }, { q: -1, r: 2 }, { q: -2, r: 0 }, { q: 1, r: -2 }];
    for (const c of outerCoords) {
      const slot = slots.find((s) => s.q === c.q && s.r === c.r);
      if (slot) slot.hero = makeHero(0);
    }
    startStage();
  }

  function startStage() {
    stage.timer = stage.duration;
    stage.spawnTimer = 0.5;
    altar.lives = MAX_LIVES;
    renderLives();
  }

  function enemyLevelFor(stageIdx, elapsed) {
    const base = stageIdx * 0.6 + elapsed * 0.05;
    return Math.max(1, Math.round(base + (Math.random() * 2 - 1)));
  }

  function spawnEnemy() {
    const elapsed = stage.duration - stage.timer;
    const waveSize = 1 + Math.min(4, Math.floor(stage.index / 7));
    const avoid = 0.55;
    for (let i = 0; i < waveSize; i++) {
      const level = enemyLevelFor(stage.index, elapsed);
      let angle = ALTAR_ANGLE + avoid + Math.random() * (Math.PI * 2 - avoid * 2);
      angle = normalizeAngle(angle);
      const speed = 0.32 / (1 + level * 0.015);
      enemies.push({
        angle, level,
        hp: level, maxHp: level,
        speed, dead: false, hitFlash: 0,
      });
    }
  }

  function burst(x, y, color, n = 8, power = 100) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = power * (0.4 + Math.random() * 0.8);
      particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: 2 + Math.random() * 3,
        life: 0.4 + Math.random() * 0.35,
        t: 0, color,
      });
    }
  }

  function addFlash(text, x, y, color = "#fff", size = 18) {
    flashTexts.push({ text, x, y, t: 0, color, size });
  }

  // ---------- Evolution cards ----------
  const FIRE_NAMES = ["ゴッドキングダリウス", "ブラッドキングゼド", "カオスロード・ヴェイン"];
  const ICE_NAMES = ["ゴッドキングガレン", "アイスキングセジュアニ", "ホーリーガーディアン"];

  function genCard(theme) {
    if (theme === "fire") {
      return {
        theme,
        name: FIRE_NAMES[Math.floor(Math.random() * FIRE_NAMES.length)],
        atkPercent: Math.round(80 + Math.random() * 70),
        successRate: Math.round(40 + Math.random() * 15),
      };
    }
    return {
      theme,
      name: ICE_NAMES[Math.floor(Math.random() * ICE_NAMES.length)],
      atkPercent: Math.round(20 + Math.random() * 20),
      successRate: Math.round(88 + Math.random() * 10),
    };
  }

  let pendingEvolveSlot = null;

  function openEvolutionChoice(slotIdx) {
    state = STATE.EVOLVE;
    pendingEvolveSlot = slotIdx;
    pendingCards = { fire: genCard("fire"), ice: genCard("ice") };
    fillCard(el.cardA, pendingCards.fire, "theme-fire");
    fillCard(el.cardB, pendingCards.ice, "theme-ice");
    el.routeChoice.classList.remove("hidden");
  }

  function fillCard(node, card, cls) {
    node.className = "route-card " + cls;
    node.querySelector(".card-name").textContent = card.name;
    const stats = node.querySelectorAll(".card-stat");
    stats[0].textContent = `攻撃力+${card.atkPercent}%`;
    stats[1].textContent = `成功確率:${card.successRate}%`;
    node.querySelector(".card-stars").textContent = "★★★★★";
  }

  function chooseCard(card) {
    const slot = slots[pendingEvolveSlot];
    const hero = slot && slot.hero;
    if (hero) {
      const base = EVOLVE_TIER_VALUE;
      const success = Math.random() * 100 < card.successRate;
      if (success) {
        hero.attack = Math.round(base * (1 + card.atkPercent / 100));
        hero.evolved = true;
        hero.theme = card.theme;
        addFlash("進化成功!!", slot.x, slot.y - 26, "#ffe066", 20);
        sfx.success();
      } else {
        hero.attack = Math.round(base * 0.6);
        hero.evolved = false;
        hero.theme = card.theme;
        addFlash("進化失敗...", slot.x, slot.y - 26, "#ff8a8a", 18);
        sfx.fail();
      }
      maxPower = Math.max(maxPower, hero.attack);
    }
    el.routeChoice.classList.add("hidden");
    pendingCards = null;
    pendingEvolveSlot = null;
    state = STATE.PLAYING;
  }

  el.cardA.addEventListener("click", () => { if (pendingCards) chooseCard(pendingCards.fire); });
  el.cardB.addEventListener("click", () => { if (pendingCards) chooseCard(pendingCards.ice); });

  // ---------- Merge / placement interaction ----------
  function findSlotAt(px, py) {
    let best = -1, bestD = hexSize * 0.85;
    for (let i = 0; i < slots.length; i++) {
      const d = Math.hypot(slots[i].x - px, slots[i].y - py);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function mergeInto(targetIdx, sourceIdx) {
    const target = slots[targetIdx];
    const source = slots[sourceIdx];
    const tierIndex = target.hero.tierIndex;
    source.hero = null;
    const newIndex = Math.min(TIERS.length - 1, tierIndex + 1);
    target.hero = makeHero(newIndex);
    maxPower = Math.max(maxPower, target.hero.attack);
    sfx.merge();
    burst(target.x, target.y, "#ffe066", 14, 130);
    addFlash(`${TIERS[newIndex]}!`, target.x, target.y - 24, "#ffe066", 18);
    if (TIERS[newIndex] === EVOLVE_TIER_VALUE) {
      openEvolutionChoice(targetIdx);
    }
  }

  function handleSlotTap(idx) {
    if (state !== STATE.PLAYING || idx < 0) return;
    const slot = slots[idx];
    if (selectedSlot === -1) {
      if (slot.hero) selectedSlot = idx;
      return;
    }
    if (selectedSlot === idx) { selectedSlot = -1; return; }
    const sel = slots[selectedSlot];
    if (!sel.hero) { selectedSlot = -1; return; }
    if (slot.hero) {
      if (slot.hero.tierIndex === sel.hero.tierIndex && sel.hero.tierIndex < TIERS.length - 1) {
        mergeInto(idx, selectedSlot);
      } else {
        selectedSlot = idx;
        return;
      }
    } else if (gear && gear.slotIdx === idx) {
      return;
    } else {
      slot.hero = sel.hero;
      sel.hero = null;
    }
    selectedSlot = -1;
  }

  function pointerToCanvas(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  canvas.addEventListener("click", (e) => {
    const p = pointerToCanvas(e.clientX, e.clientY);
    handleSlotTap(findSlotAt(p.x, p.y));
  });
  canvas.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    const p = pointerToCanvas(t.clientX, t.clientY);
    handleSlotTap(findSlotAt(p.x, p.y));
  }, { passive: true });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (state === STATE.START) startGame();
      else if (state === STATE.FAIL) startGame();
    }
  });

  el.muteBtn.addEventListener("click", () => {
    muted = !muted;
    el.muteBtn.textContent = muted ? "🔇" : "🔊";
  });

  document.getElementById("startBtn").addEventListener("click", startGame);
  document.getElementById("retryBtn").addEventListener("click", startGame);

  function startGame() {
    resetRun();
    el.startScreen.classList.add("hidden");
    el.failScreen.classList.add("hidden");
    el.newBestMsg.classList.add("hidden");
    updateHUD();
    state = STATE.PLAYING;
  }

  function failStage() {
    state = STATE.FAIL;
    sfx.fail();
    shake = 16;
    let isNew = false;
    if (stage.index > bestStage) { bestStage = stage.index; localStorage.setItem(BEST_KEY, String(bestStage)); isNew = true; }
    el.failStageVal.textContent = stage.index;
    el.failPowerVal.textContent = maxPower;
    el.failGoldVal.textContent = gold;
    el.newBestMsg.classList.toggle("hidden", !isNew);
    el.failScreen.classList.remove("hidden");
  }

  function clearStage() {
    sfx.clear();
    stage.clearing = true;
    stage.clearTimer = 1.1;
    el.stageClearBanner.classList.remove("hidden");
    stage.index++;
    updateHUD();
  }

  // ---------- HUD ----------
  function renderLives() {
    el.lives.innerHTML = "";
    for (let i = 0; i < MAX_LIVES; i++) {
      const d = document.createElement("div");
      d.className = "life" + (i < altar.lives ? "" : " lost");
      el.lives.appendChild(d);
    }
  }

  function updateHUD() {
    el.stageVal.textContent = stage.index;
    el.heroCountVal.textContent = slots.filter((s) => s.hero).length;
    el.goldVal.textContent = gold;
  }

  // ---------- Gear spawner ----------
  function trySpawnGear(dt) {
    if (gear) return;
    gearSpawnTimer -= dt;
    if (gearSpawnTimer > 0) return;
    const empties = slots.filter((s) => !s.hero);
    if (empties.length === 0) { gearSpawnTimer = 3; return; }
    const slot = empties[Math.floor(Math.random() * empties.length)];
    const hp = 12 + stage.index * 3;
    gear = { slotIdx: slots.indexOf(slot), hp, maxHp: hp };
    gearSpawnTimer = 11 + Math.random() * 6;
  }

  function breakGear() {
    const slot = slots[gear.slotIdx];
    sfx.gearBreak();
    burst(slot.x, slot.y, "#7CFFCB", 20, 160);
    addFlash("新しい仲間!", slot.x, slot.y - 24, "#7CFFCB", 16);
    if (!slot.hero) slot.hero = makeHero(0);
    gear = null;
  }

  // ---------- Update ----------
  let lastTime = performance.now();
  function update(dt) {
    if (state !== STATE.PLAYING) return;

    if (stage.clearing) {
      stage.clearTimer -= dt;
      if (stage.clearTimer <= 0) {
        stage.clearing = false;
        el.stageClearBanner.classList.add("hidden");
        startStage();
      }
      return;
    }

    stage.timer -= dt;
    if (stage.timer <= 0) { clearStage(); return; }

    stage.spawnTimer -= dt;
    const elapsed = stage.duration - stage.timer;
    const interval = Math.max(0.3, 1.1 - stage.index * 0.02 - elapsed * 0.012);
    if (stage.spawnTimer <= 0) { spawnEnemy(); stage.spawnTimer = interval; }

    trySpawnGear(dt);

    for (const e of enemies) {
      const delta = normalizeAngle(ALTAR_ANGLE - e.angle);
      const dir = Math.sign(delta);
      const step = e.speed * dt;
      if (Math.abs(delta) <= step + 0.02) e.breach = true;
      else e.angle = normalizeAngle(e.angle + dir * step);
      e.hitFlash = Math.max(0, e.hitFlash - dt * 3);
    }
    for (const e of enemies) {
      if (e.breach) {
        const p = enemyPos(e);
        const loss = e.level >= 25 ? 2 : 1;
        altar.lives = Math.max(0, altar.lives - loss);
        altar.flash = 0.4;
        sfx.breach();
        shake = Math.max(shake, 8);
        burst(p.x, p.y, "#ff5252", 10, 130);
        renderLives();
      }
    }
    enemies = enemies.filter((e) => !e.breach);

    // hero attacks (range grows with tier; timer only resets on an actual hit)
    for (const slot of slots) {
      const hero = slot.hero;
      if (!hero) continue;
      hero.atkTimer -= dt;
      hero.flashHit = Math.max(0, hero.flashHit - dt * 2);
      if (hero.atkTimer > 0) continue;

      const range = heroRangePx(hero.tierIndex);
      let attacked = false;

      if (gear) {
        const gp = slots[gear.slotIdx];
        if (Math.hypot(gp.x - slot.x, gp.y - slot.y) <= range) {
          gear.hp -= hero.attack;
          hero.flashHit = 1;
          burst(gp.x, gp.y, "#7CFFCB", 3, 60);
          sfx.hit();
          if (gear.hp <= 0) breakGear();
          attacked = true;
        }
      }

      if (!attacked && enemies.length > 0) {
        let target = null, best = Infinity;
        for (const e of enemies) {
          const p = enemyPos(e);
          if (Math.hypot(p.x - slot.x, p.y - slot.y) > range) continue;
          const d = angularDistToAltar(e.angle);
          if (d < best) { best = d; target = e; }
        }
        if (target) {
          target.hp -= hero.attack;
          target.hitFlash = 0.25;
          target.slash = { x: slot.x, y: slot.y, t: 0 };
          hero.flashHit = 1;
          sfx.hit();
          attacked = true;
        }
      }

      if (attacked) hero.atkTimer = HERO_ATK_INTERVAL;
    }

    for (const e of enemies) {
      if (e.hp <= 0 && !e.dead) {
        e.dead = true;
        const p = enemyPos(e);
        burst(p.x, p.y, "#ffb0b0", 10, 110);
        sfx.kill();
        gold += e.level;
      }
    }
    enemies = enemies.filter((e) => !e.dead);

    altar.flash = Math.max(0, altar.flash - dt);

    for (const p of particles) {
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 200 * dt;
    }
    particles = particles.filter((p) => p.t < p.life);

    for (const f of flashTexts) f.t += dt;
    flashTexts = flashTexts.filter((f) => f.t < 1.1);

    shake = Math.max(0, shake - dt * 40);

    updateHUD();

    if (altar.lives <= 0) failStage();
  }

  // ---------- Render ----------
  function drawArena() {
    const g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.7);
    g.addColorStop(0, "#1c5c2f");
    g.addColorStop(1, "#0d3018");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.strokeStyle = "#8a7f6b";
    ctx.lineWidth = R * 0.34;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R - R * 0.17, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R + R * 0.17, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    ctx.save();
    const fg = ctx.createRadialGradient(cx, cy - fieldR * 0.3, fieldR * 0.1, cx, cy, fieldR);
    fg.addColorStop(0, "#3f9a4f");
    fg.addColorStop(1, "#276b34");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(cx, cy, fieldR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const ax = cx + (R + R * 0.17) * Math.cos(ALTAR_ANGLE);
    const ay = cy + (R + R * 0.17) * Math.sin(ALTAR_ANGLE);
    ctx.save();
    ctx.translate(ax, ay);
    if (altar.flash > 0) {
      ctx.fillStyle = `rgba(255,80,80,${altar.flash})`;
      ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "#5a5266";
    ctx.beginPath();
    ctx.moveTo(-16, 24); ctx.lineTo(16, 24); ctx.lineTo(11, -8); ctx.lineTo(-11, -8);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#7a7288";
    ctx.beginPath(); ctx.arc(0, -14, 13, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "#c0392b";
    ctx.fillRect(14, -30, 3, 22);
    ctx.beginPath();
    ctx.moveTo(17, -30); ctx.lineTo(34, -25); ctx.lineTo(17, -20);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawEnemy(e) {
    const p = enemyPos(e);
    ctx.save();
    ctx.translate(p.x, p.y);
    const size = 12 + Math.min(10, e.level * 0.4);
    if (e.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${e.hitFlash})`;
      ctx.beginPath(); ctx.arc(0, 0, size + 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = e.level >= 25 ? "#7a1a2b" : "#8f2d3a";
    ctx.beginPath();
    ctx.moveTo(0, -size); ctx.lineTo(size * 0.8, size * 0.6); ctx.lineTo(-size * 0.8, size * 0.6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ff5252";
    ctx.beginPath(); ctx.arc(0, -size * 0.1, size * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3;
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.strokeText(e.level, p.x, p.y - size - 6);
    ctx.fillText(e.level, p.x, p.y - size - 6);

    if (e.slash && e.slash.t < 0.15) {
      e.slash.t += 1 / 60;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(e.slash.x, e.slash.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }

  function tierColor(tierIndex) {
    const hue = (tierIndex * 42) % 360;
    return `hsl(${hue}, 55%, 45%)`;
  }

  function drawHeroCharacter(x, y, k, bodyColor, flashHit) {
    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, k * 0.95, k * 0.62, k * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ff9f1c";
    ctx.beginPath(); ctx.ellipse(-k * 0.26, k * 0.72, k * 0.17, k * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(k * 0.26, k * 0.72, k * 0.17, k * 0.1, 0, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = bodyColor;
    ctx.fillRect(-k * 0.4, -k * 0.15, k * 0.8, k * 0.85);

    ctx.strokeStyle = "#d8d8e0";
    ctx.lineWidth = Math.max(1.5, k * 0.13);
    ctx.beginPath();
    ctx.moveTo(k * 0.4, -k * 0.05);
    ctx.lineTo(k * 0.78, -k * 0.5);
    ctx.stroke();

    ctx.fillStyle = "#ffd7a8";
    ctx.beginPath(); ctx.arc(0, -k * 0.55, k * 0.4, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = "#3a2a1a";
    ctx.beginPath(); ctx.arc(0, -k * 0.62, k * 0.4, Math.PI, 0); ctx.fill();

    if (flashHit > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flashHit * 0.5})`;
      ctx.beginPath(); ctx.arc(0, -k * 0.1, k * 1.05, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawSlots() {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.hero) {
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 2;
        const cs = hexSize * 0.18;
        ctx.beginPath();
        ctx.moveTo(s.x - cs, s.y); ctx.lineTo(s.x + cs, s.y);
        ctx.moveTo(s.x, s.y - cs); ctx.lineTo(s.x, s.y + cs);
        ctx.stroke();
        continue;
      }
      const hero = s.hero;
      const rad = Math.min(hexSize * 0.42, 20);

      if (i === selectedSlot) {
        const range = heroRangePx(hero.tierIndex);
        ctx.save();
        ctx.strokeStyle = "rgba(255,224,102,0.45)";
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, range, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = "#ffe066";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, rad + 5 + Math.sin(performance.now() / 150) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (hero.evolved) {
        ctx.fillStyle = hero.theme === "fire" ? "rgba(255,120,60,0.35)" : "rgba(120,190,255,0.35)";
        ctx.beginPath(); ctx.arc(s.x, s.y, rad + 8, 0, Math.PI * 2); ctx.fill();
      }

      let bodyColor = tierColor(hero.tierIndex);
      if (hero.theme === "fire") bodyColor = hero.evolved ? "#c0392b" : "#8a4040";
      if (hero.theme === "ice") bodyColor = hero.evolved ? "#2e6fbf" : "#3f5f80";
      drawHeroCharacter(s.x, s.y, rad, bodyColor, hero.flashHit);

      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 3;
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.strokeText(hero.attack, s.x, s.y - rad - 6);
      ctx.fillText(hero.attack, s.x, s.y - rad - 6);
    }
  }

  function drawGear() {
    if (!gear) return;
    const slot = slots[gear.slotIdx];
    const spin = performance.now() / 300;
    ctx.save();
    ctx.translate(slot.x, slot.y);
    ctx.fillStyle = "rgba(124,255,203,0.25)";
    ctx.beginPath(); ctx.arc(0, 0, hexSize * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(spin);
    ctx.fillStyle = "#9aa0a6";
    for (let i = 0; i < 8; i++) {
      ctx.save();
      ctx.rotate((i / 8) * Math.PI * 2);
      ctx.fillRect(-3, -18, 6, 8);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3;
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.strokeText(gear.hp, slot.x, slot.y - 24);
    ctx.fillText(gear.hp, slot.x, slot.y - 24);
  }

  function drawParticles() {
    for (const p of particles) {
      const a = 1 - p.t / p.life;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFlashTexts() {
    for (const f of flashTexts) {
      const a = 1 - f.t / 1.1;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = f.color;
      ctx.font = `bold ${f.size}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y - f.t * 40);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawArena();
    for (const e of enemies) drawEnemy(e);
    drawSlots();
    drawGear();
    drawParticles();
    drawFlashTexts();
    ctx.restore();
  }

  function loop(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  resize();
  requestAnimationFrame(loop);
})();
