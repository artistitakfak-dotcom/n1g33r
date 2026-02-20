
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

  let gameState = {};

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
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
    meteor: { maduro: 'images/meteor/maduro.png' },
    coin: { oil: 'images/coin/oil.png' }
  };

  const imgCache = {};
  const alphaMaskCache = new WeakMap();
  function preloadImages(){
    const all = [];
    Object.values(imagePaths.players).forEach(p=>all.push(p));
    Object.values(imagePaths.backgrounds).forEach(p=>all.push(p));
    Object.values(imagePaths.meteor).forEach(p=>all.push(p));
    Object.values(imagePaths.coin).forEach(p=>all.push(p));

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
  let running=false, paused=false;
  let lastTime=0;
  function getNextSpeedIncreaseDelay(){
    return 12 + Math.random() * 3;
  }

  const PLAYER_BASE_W = 42;
  const PLAYER_BASE_H = 105;
  const PLAYER_SCALE = 1.3;
  const METEOR_SCALE = 0.85;
  const COIN_SCALE = 1.2;
  const GG_MODE_SCORE_THRESHOLD = 250;

  function resetGame(){
    const playerW = PLAYER_BASE_W * PLAYER_SCALE;
    const playerH = PLAYER_BASE_H * PLAYER_SCALE;
    gameState = {
      player: {x: W/2-25, y: H - playerH + 5, w:playerW, h:playerH, speed:360, vx:0, skin: settings.player},
      meteors: [],
      coins: [],
      score:0,
      time:0,
      spawnTimer:0,
      coinSpawnTimer:0,
      difficultyTimer:0,
      meteorBaseSpeed:120,
      speedIncreaseTimer:0,
      speedIncreaseDelay:getNextSpeedIncreaseDelay(),
      ggMode:false,
      ggSpawnTimer:0
    };
    gameState.player.x = W/2 - gameState.player.w/2;
    scoreVal.innerText='0';
  }
  resetGame();

  /* ---------- Input ---------- */
  const keys = {};

  function isTypingTarget(target){
    if (!(target instanceof HTMLElement)) return false;
    return target.matches('input, textarea, [contenteditable="true"]') || target.isContentEditable;
  }

  window.addEventListener('keydown',e=>{
    if (isTypingTarget(e.target)) return;
    const key = e.key.toLowerCase();
    if(running && ['arrowleft','arrowright','a','d'].includes(key)) e.preventDefault();
    keys[key] = true;
  });
  window.addEventListener('keyup',e=>{
    if (isTypingTarget(e.target)) return;
    keys[e.key.toLowerCase()] = false;
  });

  canvas.addEventListener('touchstart', handleTouch);
  canvas.addEventListener('touchmove', handleTouch);
  function handleTouch(e){
    if(!running) return;
    e.preventDefault();
    const t = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = t.clientX - rect.left;
    if(x < rect.width/2){
      keys['arrowleft']=true; keys['arrowright']=false;
    } else {
      keys['arrowright']=true; keys['arrowleft']=false;
    }
  }
  window.addEventListener('touchend', ()=>{ keys['arrowleft']=false; keys['arrowright']=false; });

  /* ---------- Spawning helpers ---------- */
  function getMeteorSize(){
    return Math.round(Math.max(56, Math.min(89, W * 0.119)) * METEOR_SCALE);
  }

  function spawnMeteor(x,y,spd){
    const size = getMeteorSize();
    const w = size;
    const h = size;
    const r = size / 2;
    gameState.meteors.push({x,y,w,h,r,vy:spd, rot:Math.random()*Math.PI*2});
  }

  function randomMeteorX(){
    const r = getMeteorSize() / 2;
    const margin = r + 8;
    return margin + Math.random() * Math.max(1, (W - margin * 2));
  }


  function getCoinSize(){
    return Math.round(Math.max(36, Math.min(58, W * 0.085)) * COIN_SCALE);
  }

  function spawnCoin(){
    const size = getCoinSize();
    const margin = 10;
    const x = margin + Math.random() * Math.max(1, W - size - margin * 2);
    const y = -size - Math.random() * 120;
    const vy = 120 + Math.random() * 90;
    gameState.coins.push({ x, y, w:size, h:size, vy, bob:Math.random() * Math.PI * 2 });
  }

  function spawnWave(dt){
    if (gameState.ggMode) {
      gameState.ggSpawnTimer -= dt;
      if (gameState.ggSpawnTimer <= 0) {
        const size = getMeteorSize();
        const r = size / 2;
        const minX = r + 8;
        const maxX = W - r - 8;
        const step = Math.max(1, size * 0.78);

        for (let x = minX; x <= maxX; x += step) {
          const spd = gameState.meteorBaseSpeed + 260 + Math.random() * 80;
          spawnMeteor(x, -size - Math.random() * size * 0.25, spd);
        }

        gameState.ggSpawnTimer = 0.22;
      }

      gameState.coinSpawnTimer -= dt;
      if (gameState.coinSpawnTimer <= 0) {
        spawnCoin();
        gameState.coinSpawnTimer = 0.9 + Math.random() * 0.65;
      }
      return;
    }

    gameState.spawnTimer -= dt;
    if(gameState.spawnTimer <= 0){
      const x = randomMeteorX();
      const spd = gameState.meteorBaseSpeed + Math.random()*80 + gameState.difficultyTimer*8;
      spawnMeteor(x, -getMeteorSize(), spd);
      const minI = Math.max(0.4, 0.95 - gameState.difficultyTimer*0.02);
      gameState.spawnTimer = minI + Math.random()*0.45;
    }

    gameState.coinSpawnTimer -= dt;
    if (gameState.coinSpawnTimer <= 0) {
      spawnCoin();
      gameState.coinSpawnTimer = 0.8 + Math.random() * 0.85;
    }
  }

  /* ---------- Collisions ---------- */
  function rectCircleColl(px,py,pw,ph,cx,cy,cr){ const rx = Math.max(px, Math.min(cx, px+pw)); const ry = Math.max(py, Math.min(cy, py+ph)); const dx = cx-rx, dy = cy-ry; return (dx*dx + dy*dy) <= cr*cr; }

  function getAlphaMask(img){
    if(!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return null;
    if(alphaMaskCache.has(img)) return alphaMaskCache.get(img);

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = img.naturalWidth;
    maskCanvas.height = img.naturalHeight;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently:true });
    maskCtx.drawImage(img, 0, 0);
    const alphaData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
    const mask = {
      width: maskCanvas.width,
      height: maskCanvas.height,
      alphaData
    };
    alphaMaskCache.set(img, mask);
    return mask;
  }

  function isOpaqueAt(mask, ix, iy, threshold = 16){
    if(!mask) return false;
    if(ix < 0 || iy < 0 || ix >= mask.width || iy >= mask.height) return false;
    const px = Math.floor(ix);
    const py = Math.floor(iy);
    const alpha = mask.alphaData[(py * mask.width + px) * 4 + 3];
    return alpha >= threshold;
  }

  function getContainRect(img, x, y, w, h){
    const iw = img?.width || 1;
    const ih = img?.height || 1;
    const scale = Math.min(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    return {
      dx: x + (w - dw) / 2,
      dy: y + (h - dh) / 2,
      dw,
      dh,
      iw,
      ih
    };
  }

  function collideByOpaquePixels(boundsA, alphaAtA, boundsB, alphaAtB){
    const left = Math.ceil(Math.max(boundsA.left, boundsB.left));
    const top = Math.ceil(Math.max(boundsA.top, boundsB.top));
    const right = Math.floor(Math.min(boundsA.right, boundsB.right));
    const bottom = Math.floor(Math.min(boundsA.bottom, boundsB.bottom));

    if(left > right || top > bottom) return false;

    for(let y = top; y <= bottom; y++){
      for(let x = left; x <= right; x++){
        if(alphaAtA(x, y) && alphaAtB(x, y)) return true;
      }
    }
    return false;
  }

  function playerAlphaAt(p, wx, wy){
    const playerPath = imagePaths.players[settings.player];
    const playerImg = imgCache[playerPath];
    if(!playerImg) return wx >= p.x && wx <= p.x + p.w && wy >= p.y && wy <= p.y + p.h;

    const rect = getContainRect(playerImg, p.x, p.y, p.w, p.h);
    if(wx < rect.dx || wy < rect.dy || wx > rect.dx + rect.dw || wy > rect.dy + rect.dh) return false;

    const ix = ((wx - rect.dx) / rect.dw) * rect.iw;
    const iy = ((wy - rect.dy) / rect.dh) * rect.ih;
    return isOpaqueAt(getAlphaMask(playerImg), ix, iy);
  }

  function meteorAlphaAt(m, wx, wy){
    const path = imagePaths.meteor[settings.meteor];
    const img = imgCache[path];
    if(!img) return ((wx - m.x) ** 2 + (wy - m.y) ** 2) <= m.r ** 2;

    const cos = Math.cos(m.rot || 0);
    const sin = Math.sin(m.rot || 0);
    const rx = wx - m.x;
    const ry = wy - m.y;
    const localX = rx * cos + ry * sin;
    const localY = -rx * sin + ry * cos;
    if(localX < -m.r || localX > m.r || localY < -m.r || localY > m.r) return false;

    const ix = ((localX + m.r) / (m.r * 2)) * img.width;
    const iy = ((localY + m.r) / (m.r * 2)) * img.height;
    return isOpaqueAt(getAlphaMask(img), ix, iy);
  }

  function coinAlphaAt(c, wx, wy){
    const path = imagePaths.coin.oil;
    const img = imgCache[path];
    const drawX = c.x + Math.sin(c.bob || 0) * 4;
    if(!img) return wx >= drawX && wx <= drawX + c.w && wy >= c.y && wy <= c.y + c.h;

    const rect = getContainRect(img, drawX, c.y, c.w, c.h);
    if(wx < rect.dx || wy < rect.dy || wx > rect.dx + rect.dw || wy > rect.dy + rect.dh) return false;
    const ix = ((wx - rect.dx) / rect.dw) * rect.iw;
    const iy = ((wy - rect.dy) / rect.dh) * rect.ih;
    return isOpaqueAt(getAlphaMask(img), ix, iy);
  }

  function collidesPlayerMeteor(p, m){
    const meteorBounds = { left: m.x - m.r, top: m.y - m.r, right: m.x + m.r, bottom: m.y + m.r };
    const playerBounds = { left: p.x, top: p.y, right: p.x + p.w, bottom: p.y + p.h };
    return collideByOpaquePixels(playerBounds, (x,y)=>playerAlphaAt(p,x,y), meteorBounds, (x,y)=>meteorAlphaAt(m,x,y));
  }

  function collidesPlayerCoin(p, c){
    const drawX = c.x + Math.sin(c.bob || 0) * 4;
    const coinBounds = { left: drawX, top: c.y, right: drawX + c.w, bottom: c.y + c.h };
    const playerBounds = { left: p.x, top: p.y, right: p.x + p.w, bottom: p.y + p.h };
    return collideByOpaquePixels(playerBounds, (x,y)=>playerAlphaAt(p,x,y), coinBounds, (x,y)=>coinAlphaAt(c,x,y));
  }

  /* ---------- Update ---------- */
  function update(dt){
    if(paused) return;
    gameState.time += dt;
    scoreVal.innerText = gameState.score;

    gameState.difficultyTimer += dt; if(gameState.difficultyTimer > 120) gameState.difficultyTimer = 120;
    if (!gameState.ggMode && gameState.score >= GG_MODE_SCORE_THRESHOLD) {
      gameState.ggMode = true;
      gameState.ggSpawnTimer = 0;
      gameState.meteorBaseSpeed += 140;
    }

    gameState.speedIncreaseTimer += dt;
    if (gameState.speedIncreaseTimer >= gameState.speedIncreaseDelay) {
      gameState.meteorBaseSpeed += 5;
      gameState.speedIncreaseTimer = 0;
      gameState.speedIncreaseDelay = getNextSpeedIncreaseDelay();
    }
     spawnWave(dt);

    // player movement
    const p = gameState.player;
    let dir = 0;
    if(keys['arrowleft']||keys['a']) dir -= 1;
    if(keys['arrowright']||keys['d']) dir += 1;
    p.vx = dir * p.speed;
    p.x += p.vx * dt;
    p.x = Math.max(8, Math.min(W - p.w - 8, p.x));

    // coins
    for(let i = gameState.coins.length - 1; i >= 0; i--){
      const c = gameState.coins[i];
      c.y += c.vy * dt;
      c.bob += dt * 3;
      const cx = c.x + c.w / 2 + Math.sin(c.bob) * 4;
      const cy = c.y + c.h / 2;
      const cr = c.w * 0.42;
      if(rectCircleColl(p.x, p.y, p.w, p.h, cx, cy, cr) && collidesPlayerCoin(p, c)){
        gameState.score += 1;
        scoreVal.innerText = gameState.score;
        gameState.coins.splice(i,1);
      } else if(c.y > H + 60) {
        gameState.coins.splice(i,1);
      }
    }

    // meteors
    for(let i = gameState.meteors.length - 1; i >= 0; i--){
      const m = gameState.meteors[i];
      m.y += m.vy * dt;
      m.rot += 0.45 * dt;
      if(rectCircleColl(p.x, p.y, p.w, p.h, m.x, m.y, m.r) && collidesPlayerMeteor(p, m)){
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

  function drawImageContain(img, x, y, w, h){
    const { dx, dy, dw, dh } = getContainRect(img, x, y, w, h);
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  function drawPlayer(p){
    const skin = settings.player;
    const path = imagePaths.players[skin];
    const img = imgCache[path];
    if(img){
      drawImageContain(img, p.x, p.y, p.w, p.h);
    }
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


  function drawCoin(c){
    const path = imagePaths.coin.oil;
    const img = imgCache[path];
    const x = c.x + Math.sin(c.bob || 0) * 4;
    const y = c.y;
    if(img){
      drawImageContain(img, x, y, c.w, c.h);
    } else {
      ctx.save();
      ctx.fillStyle = '#ffd54d';
      ctx.beginPath();
      ctx.arc(x + c.w / 2, y + c.h / 2, c.w * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /* ---------- Draw loop ---------- */
  function draw(){
    ctx.clearRect(0,0,W,H);

    drawBackground();

    // subtle stars overlay
    ctx.save(); for(let i=0;i<50;i++){ ctx.globalAlpha = 0.02 + ((i%7)/120); ctx.fillRect((i*23)%W, (i*37)%H, 2,2); } ctx.restore();


    // coins
    for(const c of gameState.coins) drawCoin(c);

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
    finalScore.innerText = `Game Over — Coins Collected: ${gameState.score}`;
    gameOverScreen.style.display = 'flex';
    syncOverlayPointerEvents();

    const handle = localStorage.getItem('dodge_twitter') || 'Anon';
    const score = gameState.score || 0;
    const duration = gameState.time || 0;
    const MIN_DURATION = 3;

    if (duration < MIN_DURATION) {
      finalScore.innerText = `Game Over — Coins Collected: ${gameState.score} (play at least ${MIN_DURATION}s to submit)`;
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
  setInterval(()=>{ if(!running || paused) return; if(Math.random() < 0.03) { spawnMeteor(randomMeteorX(), -getMeteorSize(), gameState.meteorBaseSpeed + Math.random()*60 + gameState.difficultyTimer*6); } }, 650);

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

