
document.addEventListener('DOMContentLoaded', ()=>{

  /* ---------- DOM ---------- */
   const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const startScreen = document.getElementById('startScreen');
  const startBtn = document.getElementById('startBtn');
  const twitterInput = document.getElementById('twitterInput');
  const scoreVal = document.getElementById('scoreVal');
  const leaderboardEl = document.getElementById('leaderboard');
  const gameOverScreen = document.getElementById('gameOverScreen');
  const finalScore = document.getElementById('finalScore');
  const restartBtn = document.getElementById('restartBtn');
  const toStartBtn = document.getElementById('toStartBtn');
  const twitterShow = document.getElementById('twitterShow');
  const clearLbBtn = document.getElementById('clearLb');
  const copyTargets = document.querySelectorAll('[data-copy]');
  const overlayElements = [startScreen, gameOverScreen];
  copyTargets.forEach((el)=>{
    el.addEventListener('click', async ()=>{
      const value = el.getAttribute('data-copy') || el.textContent.trim();
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(value);
        } else {
          const temp = document.createElement('textarea');
          temp.value = value;
          temp.setAttribute('readonly', '');
          temp.style.position = 'absolute';
          temp.style.left = '-9999px';
          document.body.appendChild(temp);
          temp.select();
          document.execCommand('copy');
          document.body.removeChild(temp);
        }
        el.setAttribute('data-status', 'copied');
        window.setTimeout(()=>el.removeAttribute('data-status'), 1500);
      } catch (err) {
        console.warn('Copy failed', err);
      }
    });
  });

  function syncOverlayPointerEvents() {
    const isOverlayVisible = overlayElements.some((el) => {
      if (!el) return false;
      return window.getComputedStyle(el).display !== 'none';
    });
    canvas.style.pointerEvents = isOverlayVisible ? 'none' : 'auto';
  }

  /* ---------- Canvas sizing (vertical) ---------- */
  const BASE_W = 600, BASE_H = 1100;
  let W = BASE_W, H = BASE_H;

  function computePlayableSize(){
    const padding = 32;
    const availableW = Math.max(320, window.innerWidth - padding);
    const availableH = Math.max(520, window.innerHeight - padding);
    const scale = Math.min(1, availableW / BASE_W, availableH / BASE_H);
    return {
      cssW: Math.round(BASE_W * scale),
      cssH: Math.round(BASE_H * scale)
    };
  }

  function resizeCanvas(){
    const { cssW, cssH } = computePlayableSize();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    W = cssW; H = cssH;
  }

  const LANE_COUNT = 3;
  let laneCenters = [];

  function updateLaneCenters(){
    const laneInset = Math.min(W / 2 - 40, Math.max(60, W * 0.18));
    const gap = (W - laneInset * 2) / (LANE_COUNT - 1);
    laneCenters = Array.from({ length: LANE_COUNT }, (_, idx) => laneInset + gap * idx);
    if (gameState.player) {
      setPlayerLane(gameState.player.lane ?? 1);
    }
  }

  resizeCanvas();
  updateLaneCenters();
  window.addEventListener('resize', () => {
    resizeCanvas();
    updateLaneCenters();
  });
  syncOverlayPointerEvents();

  /* ---------- Settings persistence ---------- */
    const DEFAULTS = { player:'trump', background:'default', meteor:'maduro' };
  const settings = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('dodge_settings') || '{}'));

  /* ---------- Image paths & preload ---------- */
    const imagePaths = {
    players: {
      'trump': 'images/nigga/trump.png',
    },
    backgrounds: {
      default: 'images/backgrounds/background.png'
    },
    meteor: { maduro: 'images/meteor/maduro.png' }
  };

  const imgCache = {};
  function preloadImages(){
    const all = [];
    Object.values(imagePaths.players).forEach(p=>all.push(p));
    Object.values(imagePaths.backgrounds).forEach(p=>all.push(p));
    Object.values(imagePaths.meteor).forEach(p=>all.push(p));

    all.forEach(src => {
      const img = new Image();
      img.src = src;
      img.onload = ()=>{ imgCache[src] = img; };
      img.onerror = ()=>{ /* silently allow fallback */ };
    });
  }
  preloadImages();

  if (!imagePaths.players[settings.player]) settings.player = DEFAULTS.player;
  if (!imagePaths.backgrounds[settings.background]) settings.background = DEFAULTS.background;
  if (!imagePaths.meteor[settings.meteor]) settings.meteor = DEFAULTS.meteor;
  localStorage.setItem('dodge_settings', JSON.stringify(settings));

  /* ---------- Game state ---------- */
   let running=false, paused=false, AUDIO_ENABLED=true;
  const gameOverAudio = new Audio('sound/game-over.mp3');
  gameOverAudio.preload = 'auto';
  let lastTime=0;
  let gameState = {};

  function resetGame(){
    gameState = {
      player: {x: W/2-25, y: H - 120, w:56, h:140, speed:520, vx:0, skin: settings.player, lane: 1, targetX: W/2-25},
      meteors: [],
      score:0, time:0, spawnTimer:0, spawnInterval:0.9, difficultyTimer:0, meteorBaseSpeed:120
    };
    setPlayerLane(1);
    scoreVal.innerText='0';
  }
  resetGame();

  /* ---------- Input ---------- */
  function setPlayerLane(nextLane){
    const p = gameState.player;
    if (!p) return;
    const lane = Math.max(0, Math.min(LANE_COUNT - 1, nextLane));
    p.lane = lane;
    p.targetX = (laneCenters[lane] ?? W / 2) - p.w / 2;
  }

  function shiftPlayerLane(delta){
    if (!running) return;
    setPlayerLane(gameState.player.lane + delta);
  }

  window.addEventListener('keydown',e=>{
    const key = e.key.toLowerCase();
    if(['arrowleft','arrowright','a','d'].includes(key)) e.preventDefault();
    if (!running || e.repeat) return;
    if(key === 'arrowleft' || key === 'a') shiftPlayerLane(-1);
    if(key === 'arrowright' || key === 'd') shiftPlayerLane(1);
  });

  canvas.addEventListener('touchstart', handleTouch);
  canvas.addEventListener('touchmove', handleTouch);
  function handleTouch(e){
    if(!running) return;
    e.preventDefault();
    const t = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = t.clientX - rect.left;
    const laneWidth = rect.width / LANE_COUNT;
    const laneIndex = Math.min(LANE_COUNT - 1, Math.floor(x / laneWidth));
    setPlayerLane(laneIndex);
  }
  window.addEventListener('touchend', ()=>{});

  /* ---------- Spawning helpers ---------- */
  function getMeteorSize(){
    return Math.round(Math.max(56, Math.min(90, W * 0.12)));
  }

  function spawnMeteor(x,y,spd){
    const size = getMeteorSize();
    const w = size;
    const h = size;
    const r = size / 2;
    gameState.meteors.push({x,y,w,h,r,vy:spd, rot:Math.random()*Math.PI*2});
  }

  function spawnWave(dt){
    gameState.spawnTimer -= dt;
    if(gameState.spawnTimer <= 0){
      const laneIndex = Math.floor(Math.random() * laneCenters.length);
      const x = laneCenters[laneIndex] ?? W / 2;
      const spd = gameState.meteorBaseSpeed + Math.random()*80 + gameState.difficultyTimer*8;
      spawnMeteor(x, -getMeteorSize(), spd);
      const minI = Math.max(0.4, 0.95 - gameState.difficultyTimer*0.02);
      gameState.spawnTimer = minI + Math.random()*0.45;
    }
  }

  /* ---------- Collisions ---------- */
  function rectCircleColl(px,py,pw,ph,cx,cy,cr){ const rx = Math.max(px, Math.min(cx, px+pw)); const ry = Math.max(py, Math.min(cy, py+ph)); const dx = cx-rx, dy = cy-ry; return (dx*dx + dy*dy) <= cr*cr; }

  /* ---------- Update ---------- */
  function update(dt){
    if(paused) return;
    gameState.time += dt;
    gameState.score = Math.floor(gameState.time);
    scoreVal.innerText = gameState.score;

    gameState.difficultyTimer += dt; if(gameState.difficultyTimer > 120) gameState.difficultyTimer = 120;
     spawnWave(dt);

    // player movement
    const p = gameState.player;
    const dx = p.targetX - p.x;
    if (Math.abs(dx) < 1) {
      p.x = p.targetX;
    } else {
      const step = Math.sign(dx) * Math.min(Math.abs(dx), p.speed * dt);
      p.x += step;
    }

    // meteors
    for(let i = gameState.meteors.length - 1; i >= 0; i--){
      const m = gameState.meteors[i];
      m.y += m.vy * dt;
      m.rot += 0.45 * dt;
      if(rectCircleColl(p.x, p.y, p.w, p.h, m.x, m.y, m.r)){
        running = false; showGameOver(); return;
      } else if(m.y > H + 80) gameState.meteors.splice(i,1);
    }

  }

  /* ---------- Drawing helpers ---------- */

  function drawBackground(){
    const bgKey = settings.background;
    const path = imagePaths.backgrounds[bgKey];
    const img = imgCache[path];
    if(img){
      // cover fit
      const iw = img.width, ih = img.height;
      const scale = Math.max(W/iw, H/ih);
      const nw = iw * scale, nh = ih * scale;
      const dx = (W - nw) / 2, dy = (H - nh) / 2;
      ctx.drawImage(img, dx, dy, nw, nh);
    } else {
      // fallback gradient
      const g = ctx.createLinearGradient(0,0,0,H);
      g.addColorStop(0,'#041224');
      g.addColorStop(1,'#062033');
      ctx.fillStyle = g;
      ctx.fillRect(0,0,W,H);
    }
  }

  function drawPlayer(p){
    const skin = settings.player;
    const path = imagePaths.players[skin];
    const img = imgCache[path];
    if(img){ ctx.drawImage(img, p.x, p.y, p.w, p.h); }
    else { // fallback - block
      ctx.save(); ctx.fillStyle = '#22e6b3'; ctx.fillRect(p.x,p.y,p.w,p.h); ctx.restore(); }
  }

  function drawMeteor(m){
    const path = imagePaths.meteor[settings.meteor];
    const img = imgCache[path];
    if(img){ ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.rot || 0); ctx.drawImage(img, -m.r, -m.r, m.r*2, m.r*2); ctx.restore(); }
    else {
      ctx.save(); const grad = ctx.createLinearGradient(m.x - m.r, m.y - m.r, m.x + m.r, m.y + m.r); grad.addColorStop(0,'#cfcfcf'); grad.addColorStop(1,'#595959'); ctx.beginPath(); ctx.ellipse(m.x,m.y,m.r,m.r, m.rot || 0,0,Math.PI*2); ctx.fillStyle = grad; ctx.fill(); ctx.restore(); }
  }

  /* ---------- Draw loop ---------- */
  function draw(){
    ctx.clearRect(0,0,W,H);

    drawBackground();

    // subtle stars overlay
    ctx.save(); for(let i=0;i<50;i++){ ctx.globalAlpha = 0.02 + ((i%7)/120); ctx.fillRect((i*23)%W, (i*37)%H, 2,2); } ctx.restore();

 
    // draw player
     const p = gameState.player;
    drawPlayer(p);

    // meteors
    for(const m of gameState.meteors) drawMeteor(m);

  }

  function loop(ts){
    if(!lastTime) lastTime = ts;
    const dt = Math.min(0.05, (ts - lastTime) / 1000);
    lastTime = ts;
    if(running && !paused) update(dt), draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ---------- Controls & UI ---------- */
  startBtn.addEventListener('click', ()=>{ startScreen.style.display='none'; startGame(); });
  restartBtn.addEventListener('click', ()=>{ gameOverScreen.style.display='none'; startGame(); });
  toStartBtn.addEventListener('click', ()=>{ gameOverScreen.style.display='none'; startScreen.style.display='flex'; syncOverlayPointerEvents(); });
  clearLbBtn.addEventListener('click', () => {
  fetchLeaderboard(); 
  });

  function startGame(){
    resetGame();
    running = true;
    paused = false;
    lastTime = 0;
    setPlayerLane(1);
    syncOverlayPointerEvents();
  }
  
  async function relayScore(payload) {
    const { handle, score, duration } = payload || {};
    return submitScore(handle, score, duration);
  }

  async function submitScore(handle, score, duration) {
    try {
      const res = await fetch('/api/submit-score', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'dragonballer-game'
        },
        body: JSON.stringify({ handle, score, duration })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error('submitScore failed:', data);
      } else {
        console.log('submitScore ok:', data);
      }
    } catch (err) {
      console.error('submitScore error:', err);
    }
  }

  
  async function fetchLeaderboard() {
    try {
      const res = await fetch('/api/leaderboard');
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Leaderboard request failed: ${res.status} ${text}`);
      }

      const data = await res.json();

      console.log('leaderboard data:', data);
      renderLeaderboard(data);
      return data;
    } catch (err) {
      console.error('fetchLeaderboard error:', err);
      renderLeaderboard([]);
      return [];
    }
  }

 
  function renderLeaderboard(list) {
    const container = document.getElementById('leaderboard');
    if (!container) return;

    container.innerHTML = ''; 

    if (!Array.isArray(list)) {
      container.innerHTML = '<li class="muted">Unable to load leaderboard right now.</li>';
      return;
    }

    if (!list || list.length === 0) {
      container.innerHTML = '<li class="muted">No scores yet — be first!</li>';
      return;
    }

    list.forEach((row, index) => {
      const li = document.createElement('li');
      li.className = 'lb-row';
      li.innerHTML = `
        <span class="lb-rank">${index + 1}.</span>
        <span class="lb-handle">${escapeHtml(row.handle)}</span>
        <span class="lb-score">${row.score}</span>
      `;
      container.appendChild(li);
    });
  }

  async function showGameOver() {
    finalScore.innerText = `Game Over — Points: ${gameState.score}`;
    gameOverScreen.style.display = 'flex';
    syncOverlayPointerEvents();
    if (AUDIO_ENABLED) {
      try {
        gameOverAudio.currentTime = 0;
        await gameOverAudio.play();
      } catch (e) {
        console.warn('Game over audio failed to play', e);
      }
    }

    const handle = localStorage.getItem('dodge_twitter') || 'Anon';
    const score = gameState.score || 0;
    const duration = gameState.time || 0;
    const MIN_DURATION = 3;

    if (duration < MIN_DURATION) {
      finalScore.innerText = `Game Over — Points: ${gameState.score} (play at least ${MIN_DURATION}s to submit)`;
      console.log('Run lasted less than minimum duration; skipping submit.');
      return;
    }

    try {
      await relayScore({ handle, score, duration });
      await fetchLeaderboard();
      console.log('Auto-saved score', handle, score);
    } catch (e) {
      console.error('Auto-save failed', e);

    }
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  /* ---------- Background spawn & misc tasks ---------- */
  setInterval(()=>{ if(running && !paused){ gameState.meteorBaseSpeed += 0.6; } }, 1500);
  setInterval(()=>{ if(!running || paused) return; if(Math.random() < 0.03) { const laneIndex = Math.floor(Math.random() * laneCenters.length); const x = laneCenters[laneIndex] ?? W / 2; spawnMeteor(x, -getMeteorSize(), gameState.meteorBaseSpeed + Math.random()*60 + gameState.difficultyTimer*6); } }, 650);

  /* ---------- Fit canvas ---------- */
  function fitCanvas(){ const rect = canvas.getBoundingClientRect(); if(rect.width !== W || rect.height !== H) resizeCanvas(); }
  setInterval(fitCanvas, 500);

  /* ---------- Twitter handle validation ---------- */
  function extractHandle(input){
    if(!input) return null;
    input = input.trim();
    try{ if(input.includes('twitter.com')){ const u = new URL(input.startsWith('http') ? input : 'https://' + input); const p = u.pathname.split('/').filter(Boolean); if(p.length) return '@' + p[0]; } } catch(e){}
    if(input[0] !== '@') input = '@' + input;
    const m = input.match(/^@([A-Za-z0-9_]{1,15})$/);
    return m ? input : null;
  }
  function validateTwitterField(){
    const val = twitterInput.value;
    const h = extractHandle(val);
    if(h){ startBtn.disabled = false; twitterInput.style.borderColor = 'rgba(255,255,255,0.12)'; localStorage.setItem('dodge_twitter', h); twitterShow.innerText = h; }
    else{ startBtn.disabled = true; twitterInput.style.borderColor = 'rgba(255,50,50,0.6)'; twitterShow.innerText = ''; }
  }
    twitterInput.addEventListener('input', validateTwitterField);
  const storedHandle = localStorage.getItem('dodge_twitter');
  if(storedHandle){ twitterInput.value = storedHandle; validateTwitterField(); }

  /* ---------- end DOMContentLoaded ---------- */

  window.addEventListener('load', () => {
    fetchLeaderboard();
  });

});







