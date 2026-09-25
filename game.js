(() => {
  "use strict";

  // ---------- Canvas setup ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1;
  let playW = 0, playX0 = 0;
  let cx = 0, cy = 0, R = 0;

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
  }
  window.addEventListener("resize", resize);
  resize();

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
    hit: () => beep(300 + Math.random() * 120, 0.07, "square", 0.1, 180),
    kill: () => beep(500 + Math.random() * 150, 0.12, "sine", 0.15, 900),
    breach: () => beep(140, 0.3, "sawtooth", 0.22, 50),
    levelup: () => { beep(500, 0.12, "sine", 0.2, 700); setTimeout(() => beep(760, 0.16, "sine", 0.2, 1100), 100); },
    skill: () => beep(200, 0.4, "sawtooth", 0.22, 700),
    success: () => { beep(600, 0.15, "sine", 0.22, 1000); setTimeout(() => beep(900, 0.2, "sine", 0.2, 1300), 120); },
    fail: () => beep(220, 0.4, "sawtooth", 0.2, 70),
    clear: () => { beep(700, 0.2, "sine", 0.22, 1050); setTimeout(() => beep(1050, 0.25, "sine", 0.2, 1400), 150); },
  };

  // ---------- Persistent best ----------
  const BEST_KEY = "petapeta_best_stage";
  let bestStage = parseInt(localStorage.getItem(BEST_KEY) || "1", 10);

  // ---------- DOM refs ----------
  const el = {
    stageVal: document.getElementById("stageVal"),
    lvVal: document.getElementById("lvVal"),
    goldVal: document.getElementById("goldVal"),
    lives: document.getElementById("lives"),
    xpFill: document.getElementById("xpBarFill"),
    stageClearBanner: document.getElementById("stageClearBanner"),
    routeChoice: document.getElementById("routeChoice"),
    startScreen: document.getElementById("startScreen"),
    failScreen: document.getElementById("failScreen"),
    failStageVal: document.getElementById("failStageVal"),
    failLvVal: document.getElementById("failLvVal"),
    failGoldVal: document.getElementById("failGoldVal"),
    newBestMsg: document.getElementById("newBestMsg"),
    skillBtn: document.getElementById("skillBtn"),
    muteBtn: document.getElementById("muteBtn"),
    cardA: document.getElementById("cardA"),
    cardB: document.getElementById("cardB"),
  };

  const MAX_LIVES = 8;

  // ---------- Game state ----------
  const STATE = { START: 0, PLAYING: 1, ROUTE: 2, FAIL: 3 };
  let state = STATE.START;

  let hero = { level: 1, xp: 0, xpToNext: 30, atkMultiplier: 1, atkTimer: 0, tint: "base", flash: 0 };
  let altar = { lives: MAX_LIVES, flash: 0 };
  let stage = { index: 1, timer: 0, duration: 26, spawnTimer: 0.6, clearing: false, clearTimer: 0 };
  let enemies = [], particles = [], flashTexts = [], shake = 0, gold = 0, pendingCards = null;

  function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function resetRun() {
    hero = {
      level: 1, xp: 0, xpToNext: 30,
      atkMultiplier: 1,
      atkTimer: 0,
      tint: "base",
      flash: 0,
    };
    altar = { lives: MAX_LIVES, flash: 0 };
    stage = { index: 1, timer: 0, duration: 26, spawnTimer: 0.6, clearing: false, clearTimer: 0 };
    enemies = [];
    particles = [];
    flashTexts = [];
    shake = 0;
    gold = 0;
    pendingCards = null;
    startStage();
  }

  function startStage() {
    stage.timer = stage.duration;
    stage.spawnTimer = 0.5;
    altar.lives = MAX_LIVES;
    renderLives();
  }

  function heroAtk() {
    return (6 + hero.level * 1.05) * hero.atkMultiplier;
  }

  function enemyLevelFor(stageIdx, elapsed) {
    const base = stageIdx * 0.6 + elapsed * 0.05;
    return Math.max(1, Math.round(base + (Math.random() * 2 - 1)));
  }

  function spawnEnemy() {
    const elapsed = stage.duration - stage.timer;
    const waveSize = 1 + Math.min(3, Math.floor(stage.index / 8));
    const avoid = 0.55;
    for (let i = 0; i < waveSize; i++) {
      const level = enemyLevelFor(stage.index, elapsed);
      let angle = ALTAR_ANGLE + avoid + Math.random() * (Math.PI * 2 - avoid * 2);
      angle = normalizeAngle(angle);
      const speed = 0.32 / (1 + level * 0.015);
      enemies.push({
        angle,
        level,
        hp: 8 + level * 6,
        maxHp: 8 + level * 6,
        speed,
        dead: false,
        hitFlash: 0,
      });
    }
  }

  function angularDistToAltar(angle) {
    return Math.abs(normalizeAngle(ALTAR_ANGLE - angle));
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
        t: 0,
        color,
      });
    }
  }

  function addFlash(text, x, y, color = "#fff", size = 18) {
    flashTexts.push({ text, x, y, t: 0, color, size });
  }

  function enemyPos(e) {
    return { x: cx + R * Math.cos(e.angle), y: cy + R * Math.sin(e.angle) };
  }

  // ---------- Route choice cards ----------
  const FIRE_NAMES = ["ゴッドキングダリウス", "ブラッドキングゼド", "カオスロード・ヴェイン"];
  const ICE_NAMES = ["ゴッドキングガレン", "アイスキングセジュアニ", "ホーリーガーディアン"];

  function genCard(theme) {
    if (theme === "fire") {
      return {
        theme,
        name: FIRE_NAMES[Math.floor(Math.random() * FIRE_NAMES.length)],
        atkPercent: Math.round(35 + Math.random() * 35),
        successRate: Math.round(50 + Math.random() * 15),
      };
    }
    return {
      theme,
      name: ICE_NAMES[Math.floor(Math.random() * ICE_NAMES.length)],
      atkPercent: Math.round(15 + Math.random() * 15),
      successRate: Math.round(90 + Math.random() * 10),
    };
  }

  function openRouteChoice() {
    state = STATE.ROUTE;
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
    const success = Math.random() * 100 < card.successRate;
    if (success) {
      hero.atkMultiplier *= 1 + card.atkPercent / 100;
      hero.tint = card.theme;
      hero.flash = 0.5;
      addFlash("進化成功!!", cx, cy - R * 0.3, "#ffe066", 22);
      sfx.success();
    } else {
      hero.atkMultiplier *= 1 + (card.atkPercent * 0.25) / 100;
      addFlash("進化失敗...", cx, cy - R * 0.3, "#ff8a8a", 20);
      sfx.fail();
    }
    el.routeChoice.classList.add("hidden");
    pendingCards = null;
    state = STATE.PLAYING;
  }

  el.cardA.addEventListener("click", () => { if (pendingCards) chooseCard(pendingCards.fire); });
  el.cardB.addEventListener("click", () => { if (pendingCards) chooseCard(pendingCards.ice); });

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
    el.lvVal.textContent = hero.level;
    el.goldVal.textContent = gold;
    el.xpFill.style.width = Math.min(100, (hero.xp / hero.xpToNext) * 100) + "%";
  }

  // ---------- Skill ----------
  let skillCooldown = 0;
  const SKILL_MAX_CD = 8;
  function tryUseSkill() {
    if (state !== STATE.PLAYING || skillCooldown > 0) return;
    skillCooldown = SKILL_MAX_CD;
    sfx.skill();
    burst(cx, cy, "#7CFFCB", 30, 220);
    shake = 10;
    const dmg = 40 + hero.level * 3;
    for (const e of enemies) {
      e.hp -= dmg;
      e.hitFlash = 0.3;
    }
    addFlash("スキル発動!", cx, cy - R - 30, "#7CFFCB", 18);
  }

  el.skillBtn.addEventListener("click", tryUseSkill);
  canvas.addEventListener("click", tryUseSkill);
  window.addEventListener("keydown", (e) => {
    if (e.key === " ") { e.preventDefault(); tryUseSkill(); }
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
    skillCooldown = 0;
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
    el.failLvVal.textContent = hero.level;
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
    if (stage.timer <= 0) {
      clearStage();
      return;
    }

    // spawn
    stage.spawnTimer -= dt;
    const elapsed = stage.duration - stage.timer;
    const interval = Math.max(0.35, 1.1 - stage.index * 0.016 - elapsed * 0.012);
    if (stage.spawnTimer <= 0) {
      spawnEnemy();
      stage.spawnTimer = interval;
    }

    // move enemies, check breach
    for (const e of enemies) {
      const delta = normalizeAngle(ALTAR_ANGLE - e.angle);
      const dir = Math.sign(delta);
      const step = e.speed * dt;
      if (Math.abs(delta) <= step + 0.02) {
        e.breach = true;
      } else {
        e.angle = normalizeAngle(e.angle + dir * step);
      }
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

    // hero auto attack: target enemy closest to altar
    hero.atkTimer -= dt;
    if (hero.atkTimer <= 0 && enemies.length > 0) {
      let target = enemies[0];
      let best = angularDistToAltar(target.angle);
      for (const e of enemies) {
        const d = angularDistToAltar(e.angle);
        if (d < best) { best = d; target = e; }
      }
      target.hp -= heroAtk();
      target.hitFlash = 0.25;
      target.slash = { x: enemyPos(target).x, y: enemyPos(target).y, t: 0 };
      sfx.hit();
      hero.atkTimer = Math.max(0.22, 0.46 - hero.level * 0.003);
    }

    // enemy death / xp
    for (const e of enemies) {
      if (e.hp <= 0 && !e.dead) {
        e.dead = true;
        const p = enemyPos(e);
        burst(p.x, p.y, "#ffb0b0", 10, 110);
        sfx.kill();
        gold += e.level;
        hero.xp += e.level * 3 + 2;
        while (hero.xp >= hero.xpToNext) {
          hero.xp -= hero.xpToNext;
          hero.level++;
          hero.xpToNext = 30 + hero.level * 15;
          sfx.levelup();
          addFlash(`Lv.${hero.level}!`, cx, cy - 10, "#ffe066", 20);
          if (hero.level % 5 === 0) {
            openRouteChoice();
          }
        }
      }
    }
    enemies = enemies.filter((e) => !e.dead);

    hero.flash = Math.max(0, hero.flash - dt);
    altar.flash = Math.max(0, altar.flash - dt);

    if (skillCooldown > 0) {
      skillCooldown = Math.max(0, skillCooldown - dt);
      el.skillBtn.disabled = true;
      el.skillBtn.textContent = Math.ceil(skillCooldown) + "s";
    } else {
      el.skillBtn.disabled = false;
      el.skillBtn.textContent = "スキル";
    }

    for (const p of particles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 200 * dt;
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

    // stone ring path
    ctx.save();
    ctx.strokeStyle = "#8a7f6b";
    ctx.lineWidth = R * 0.34;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R - R * 0.17, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R + R * 0.17, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // inner field
    ctx.save();
    const fieldR = R - R * 0.17;
    const fg = ctx.createRadialGradient(cx, cy - fieldR * 0.3, fieldR * 0.1, cx, cy, fieldR);
    fg.addColorStop(0, "#3f9a4f");
    fg.addColorStop(1, "#276b34");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(cx, cy, fieldR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (fieldR / 4) * i, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // altar
    const ax = cx + (R + R * 0.17) * Math.cos(ALTAR_ANGLE);
    const ay = cy + (R + R * 0.17) * Math.sin(ALTAR_ANGLE);
    ctx.save();
    ctx.translate(ax, ay);
    if (altar.flash > 0) {
      ctx.fillStyle = `rgba(255,80,80,${altar.flash})`;
      ctx.beginPath();
      ctx.arc(0, 0, 34, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#5a5266";
    ctx.beginPath();
    ctx.moveTo(-16, 24);
    ctx.lineTo(16, 24);
    ctx.lineTo(11, -8);
    ctx.lineTo(-11, -8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#7a7288";
    ctx.beginPath();
    ctx.arc(0, -14, 13, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "#c0392b";
    ctx.fillRect(14, -30, 3, 22);
    ctx.beginPath();
    ctx.moveTo(17, -30);
    ctx.lineTo(34, -25);
    ctx.lineTo(17, -20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawEnemy(e) {
    const p = enemyPos(e);
    ctx.save();
    ctx.translate(p.x, p.y);
    const size = 12 + Math.min(10, e.level * 0.4);
    if (e.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${e.hitFlash})`;
      ctx.beginPath();
      ctx.arc(0, 0, size + 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = e.level >= 25 ? "#7a1a2b" : "#8f2d3a";
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.8, size * 0.6);
    ctx.lineTo(-size * 0.8, size * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ff5252";
    ctx.beginPath();
    ctx.arc(0, -size * 0.1, size * 0.22, 0, Math.PI * 2);
    ctx.fill();
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
      ctx.moveTo(cx, cy);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }

  function drawHero() {
    ctx.save();
    ctx.translate(cx, cy);
    const bob = Math.sin(performance.now() / 260) * 2;
    ctx.translate(0, bob);

    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(0, 24, 16, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    const tintColor = hero.tint === "fire" ? "#c0392b" : hero.tint === "ice" ? "#2e6fbf" : "#3a5c9a";
    if (hero.flash > 0) {
      ctx.fillStyle = `rgba(255,230,102,${hero.flash})`;
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.fill();
    }

    // body
    ctx.fillStyle = tintColor;
    ctx.fillRect(-10, -6, 20, 26);
    // head
    ctx.fillStyle = "#ffd7a8";
    ctx.beginPath();
    ctx.arc(0, -16, 10, 0, Math.PI * 2);
    ctx.fill();
    // helmet/hair
    ctx.fillStyle = "#3a2a1a";
    ctx.beginPath();
    ctx.arc(0, -19, 10, Math.PI, 0);
    ctx.fill();
    // sword
    ctx.strokeStyle = "#d8d8e0";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(12, -4);
    ctx.lineTo(24, -18);
    ctx.stroke();

    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      const a = 1 - p.t / p.life;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
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
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawArena();
    for (const e of enemies) drawEnemy(e);
    if (state !== STATE.START) drawHero();
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
  requestAnimationFrame(loop);
})();
