
document.addEventListener('DOMContentLoaded', ()=>{

  /* ---------- DOM ---------- */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const startScreen = document.getElementById('startScreen');
  const startBtn = document.getElementById('startBtn');
  const helpBtn = document.getElementById('helpBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const twitterInput = document.getElementById('twitterInput');
  const settingsModal = document.getElementById('settingsModal');
  const settingsClose = document.getElementById('settingsClose');

  const scoreVal = document.getElementById('scoreVal');
  const timeVal = document.getElementById('timeVal');
   const activePowers = document.getElementById('activePowers');
  const leaderboardEl = document.getElementById('leaderboard');
  const gameOverScreen = document.getElementById('gameOverScreen');
  const finalScore = document.getElementById('finalScore');
  const restartBtn = document.getElementById('restartBtn');
  const toStartBtn = document.getElementById('toStartBtn');
  const twitterShow = document.getElementById('twitterShow');
  const playerPreview = document.getElementById('playerPreview');
  const backgroundPreview = document.getElementById('backgroundPreview');;
  const clearLbBtn = document.getElementById('clearLb');

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

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  /* ---------- Settings persistence ---------- */
  const DEFAULTS = { coin:'dragonball', player:'goku', background:'kame-house', meteor:'beerus' };
  const settings = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('dodge_settings') || '{}'));

  /* ---------- Image paths & preload ---------- */
  const imagePaths = {
    players: {
      goku: 'images/players/goku.png',
      vegeta: 'images/players/vegeta.png',
      frieza: 'images/players/frieza.png',
      piccolo: 'images/players/piccolo.png'
    },
    backgrounds: {
      'kame-house': 'images/backgrounds/kame-house.jpg',
      namek: 'images/backgrounds/namek.jpg',
      'vegeta-palace': 'images/backgrounds/vegeta-palace.jpg',
      'planet-frieza': 'images/backgrounds/planet-frieza.jpg'
    },
    coin: { dragonball: 'images/coin/dragonball.png' },
    meteor: { beerus: 'images/meteor/beerus.png' },
    powerups: { magnet: 'images/powerups/magnet.png', shield: 'images/powerups/shield.png', slow: 'images/powerups/slow.png' }
  };

  const imgCache = {};
  function preloadImages(){
    const all = [];
    Object.values(imagePaths.players).forEach(p=>all.push(p));
    Object.values(imagePaths.backgrounds).forEach(p=>all.push(p));
    Object.values(imagePaths.coin).forEach(p=>all.push(p));
    Object.values(imagePaths.meteor).forEach(p=>all.push(p));
    Object.values(imagePaths.powerups).forEach(p=>all.push(p));

    all.forEach(src => {
      const img = new Image();
      img.src = src;
      img.onload = ()=>{ imgCache[src] = img; };
      img.onerror = ()=>{ /* silently allow fallback */ };
    });
  }
  preloadImages();

  /* ---------- Initialize radios (player & background only) ---------- */
  function initRadios(){
    ['player','background'].forEach(name=>{
      const r = document.querySelector(`input[name="${name}"][value="${settings[name]}"]`);
      if(r) r.checked = true;
      document.querySelectorAll(`input[name="${name}"]`).forEach(inp=>{
        inp.addEventListener('change', (e)=>{
          if(e.target.checked){ settings[name] = e.target.value; localStorage.setItem('dodge_settings', JSON.stringify(settings)); updatePreviews(); }
        });
      });
    });
  }
  initRadios();

  /* ---------- Game state ---------- */
  let running=false, paused=false, AUDIO_ENABLED=true;
  let lastTime=0;
  let gameState = {};

  function resetGame(){
    gameState = {
      player: {x: W/2-25, y: H - 120, w:35, h:72, speed:360, vx:0, skin: settings.player},
      coins: [], meteors: [], powerups: [], particles: [],
      score:0, time:0, spawnTimer:0, spawnInterval:0.9, difficultyTimer:0, meteorBaseSpeed:120,
      active: {magnet:0, shield:0, slow:0}
    };
    scoreVal.innerText='0'; timeVal.innerText='0'; activePowers.innerHTML='';
  }
  resetGame();

  /* ---------- Input ---------- */
  const keys = {};
  window.addEventListener('keydown',e=>{ keys[e.key.toLowerCase()] = true; if(['arrowleft','arrowright'].includes(e.key.toLowerCase())) e.preventDefault(); });
  window.addEventListener('keyup',e=>{ keys[e.key.toLowerCase()] = false; });

  canvas.addEventListener('touchstart', handleTouch); canvas.addEventListener('touchmove', handleTouch);
  function handleTouch(e){ e.preventDefault(); const t = e.touches[0]; const rect = canvas.getBoundingClientRect(); const x = t.clientX - rect.left; if(x < rect.width/2){ keys['arrowleft']=true; keys['arrowright']=false; } else { keys['arrowright']=true; keys['arrowleft']=false; } }
  window.addEventListener('touchend', ()=>{ keys['arrowleft']=false; keys['arrowright']=false; });

  /* ---------- Spawning helpers ---------- */
  function spawnCoin(x,y){ gameState.coins.push({x,y,r:24,vy:60}) }
  function spawnMeteor(x,y,spd){ const r = 18 + Math.random()*26; gameState.meteors.push({x,y,r,vy:spd, rot:Math.random()*Math.PI*2}); }
  function spawnPowerup(x,y,type){ gameState.powerups.push({x,y,type,r:22}); }

  function spawnWave(dt){
    gameState.spawnTimer -= dt;
    if(gameState.spawnTimer <= 0){
      const roll = Math.random(), x = 30 + Math.random()*(W - 60);
      if(roll < 0.62){
        const spd = gameState.meteorBaseSpeed + Math.random()*80 + gameState.difficultyTimer*8;
        spawnMeteor(x, -40, spd);
      } else if(roll < 0.92){
        spawnCoin(x, -20);
      } else {
        const types = ['magnet','shield','slow'];
        spawnPowerup(x, -20, types[Math.floor(Math.random()*types.length)]);
      }
      const minI = Math.max(0.4, 0.95 - gameState.difficultyTimer*0.02);
      gameState.spawnTimer = minI + Math.random()*0.45;
    }
  }

  /* ---------- Collisions ---------- */
  function rectCircleColl(px,py,pw,ph,cx,cy,cr){ const rx = Math.max(px, Math.min(cx, px+pw)); const ry = Math.max(py, Math.min(cy, py+ph)); const dx = cx-rx, dy = cy-ry; return (dx*dx + dy*dy) <= cr*cr; }

  /* ---------- Powerups ---------- */
  function activatePower(type){ gameState.active[type] = 5.0; if(type==='magnet') beep(600,0.08); if(type==='shield') beep(200,0.08); if(type==='slow') beep(320,0.08); updateActiveUI(); }
  function updateActiveUI(){
    activePowers.innerHTML = '';
    const order = ['magnet','shield','slow'];
    order.forEach(t => {
      if(gameState.active[t] > 0){
        const el = document.createElement('div'); el.className = 'power-icon';
        el.style.display = 'inline-flex'; el.style.alignItems = 'center'; el.style.gap = '8px';
        el.innerHTML = powerSvg(t,20) + `<div style="font-size:12px">${t.toUpperCase()} ${Math.ceil(gameState.active[t])}s</div>`;
        activePowers.appendChild(el);
      }
    });
  }

  function powerSvg(type,size=20){
    if(type === 'magnet'){
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 3v6a5 5 0 0 0 5 5h0" stroke="#ffd560" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M17 3v6a5 5 0 0 1-5 5h0" stroke="#ffd560" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
    } else if(type === 'shield'){
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3l7 3v5c0 5-3.5 9-7 10-3.5-1-7-5-7-10V6l7-3z" stroke="#9ad3ff" stroke-width="1.6" fill="#072b3a" />
        </svg>`;
    } else {
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="8" stroke="#b0f0ff" stroke-width="1.6" fill="#062233"/>
        <path d="M12 8v5l3 2" stroke="#b0f0ff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
    }
  }

  /* ---------- Particles ---------- */
  function emitParticles(x,y,n,color='#ffcc00'){ for(let i=0;i<n;i++){ gameState.particles.push({x,y,vx:(Math.random()-0.5)*260, vy:(Math.random()-1.2)*260, life:0.5 + Math.random()*0.7, size:1+Math.random()*3, color}); } }
  function updateParticles(dt){ for(let i=gameState.particles.length-1;i>=0;i--){ const p = gameState.particles[i]; p.life -= dt; if(p.life<=0) gameState.particles.splice(i,1); else { p.x += p.vx*dt; p.y += p.vy*dt; p.vy += 240*dt; } } }
  function drawParticles(){ for(const p of gameState.particles){ ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, p.life)); ctx.beginPath(); ctx.fillStyle = p.color; ctx.ellipse(p.x,p.y,p.size,p.size,0,0,Math.PI*2); ctx.fill(); ctx.restore(); } }

  /* ---------- Update ---------- */
  function update(dt){
    if(paused) return;
    gameState.time += dt; timeVal.innerText = Math.floor(gameState.time);

    gameState.difficultyTimer += dt; if(gameState.difficultyTimer > 120) gameState.difficultyTimer = 120;
    const slowFactor = gameState.active.slow > 0 ? 0.45 : 1.0;

    spawnWave(dt);

    ['magnet','shield','slow'].forEach(k=>{ if(gameState.active[k] > 0){ gameState.active[k] -= dt; if(gameState.active[k] <= 0) gameState.active[k] = 0; } });
    updateActiveUI();

    // player movement
    const p = gameState.player; let dir = 0; if(keys['arrowleft']||keys['a']) dir -= 1; if(keys['arrowright']||keys['d']) dir += 1;
    p.vx = dir * p.speed; p.x += p.vx * dt; p.x = Math.max(8, Math.min(W - p.w - 8, p.x));

    // coins: magnet behavior
    for(let i = gameState.coins.length - 1; i >= 0; i--){
      const c = gameState.coins[i];
      c.y += (c.vy + gameState.difficultyTimer*6) * dt * slowFactor;

      if(gameState.active.magnet > 0){
        const px = p.x + p.w/2, py = p.y + p.h/2;
        const dx = px - c.x, dy = py - c.y;
        const dist = Math.sqrt(dx*dx + dy*dy) || 0.0001;
        const radius = 180;
        if(dist < radius){
          const strength = (1 - dist/radius) * 1800;
          c.x += (dx/dist) * strength * dt;
          c.y += (dy/dist) * strength * dt;
        }
      }

      if(rectCircleColl(p.x, p.y, p.w, p.h, c.x, c.y, c.r)){
        gameState.coins.splice(i,1); gameState.score += 1; scoreVal.innerText = gameState.score;
        beep(740,0.06); emitParticles(c.x,c.y,14,'#ffd560');
      } else if(c.y > H + 40) gameState.coins.splice(i,1);
    }

    // meteors
    for(let i = gameState.meteors.length - 1; i >= 0; i--){
      const m = gameState.meteors[i];
      m.y += m.vy * dt * slowFactor;
      m.rot += 0.45 * dt;
      if(rectCircleColl(p.x, p.y, p.w, p.h, m.x, m.y, m.r)){
        if(gameState.active.shield > 0){
          gameState.meteors.splice(i,1); beep(160,0.06); emitParticles(m.x,m.y,12,'#ddd');
        } else {
          running = false; showGameOver(); return;
        }
      } else if(m.y > H + 80) gameState.meteors.splice(i,1);
    }

    // powerups
    for(let i = gameState.powerups.length - 1; i >= 0; i--){
      const u = gameState.powerups[i];
      u.y += 90 * dt * slowFactor;
      u._labelOffset = (u._labelOffset || 0) + dt*20;
      if(rectCircleColl(p.x, p.y, p.w, p.h, u.x, u.y, u.r)){
        activatePower(u.type); gameState.powerups.splice(i,1); emitParticles(u.x,u.y,14,'#aaffaa');
      } else if(u.y > H + 80) gameState.powerups.splice(i,1);
    }

    updateParticles(dt);
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

  function drawCoin(c){
    const path = imagePaths.coin[settings.coin];
    const img = imgCache[path];
    if(img){ ctx.drawImage(img, c.x - c.r, c.y - c.r, c.r*2, c.r*2); }
    else drawCoinFallback(c.x, c.y, c.r);
  }
  function drawCoinFallback(x,y,r){ ctx.save(); ctx.beginPath(); ctx.fillStyle = '#ffd76b'; ctx.ellipse(x,y,r,r,0,0,Math.PI*2); ctx.fill(); ctx.restore(); }

  function drawMeteor(m){
    const path = imagePaths.meteor[settings.meteor];
    const img = imgCache[path];
    if(img){ ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.rot || 0); ctx.drawImage(img, -m.r, -m.r, m.r*2, m.r*2); ctx.restore(); }
    else {
      ctx.save(); const grad = ctx.createLinearGradient(m.x - m.r, m.y - m.r, m.x + m.r, m.y + m.r); grad.addColorStop(0,'#cfcfcf'); grad.addColorStop(1,'#595959'); ctx.beginPath(); ctx.ellipse(m.x,m.y,m.r,m.r, m.rot || 0,0,Math.PI*2); ctx.fillStyle = grad; ctx.fill(); ctx.restore(); }
  }

  function drawPowerup(u){
    const path = imagePaths.powerups[u.type];
    const img = imgCache[path];
    if(img){ ctx.drawImage(img, u.x - u.r, u.y - u.r, u.r*2, u.r*2); ctx.fillStyle='rgba(255,255,255,0.95)'; ctx.font='10px sans-serif'; ctx.textAlign='center'; ctx.fillText(u.type.toUpperCase(), u.x, u.y + u.r + 12); }
    else {
      // fallback icon
      ctx.save(); ctx.beginPath(); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.ellipse(u.x,u.y,u.r,u.r,0,0,Math.PI*2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font='10px sans-serif'; ctx.textAlign='center'; ctx.fillText(u.type.toUpperCase(), u.x, u.y + u.r + 12); ctx.restore(); }
  }

  function drawParticles(){ for(const p of gameState.particles){ ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, p.life)); ctx.beginPath(); ctx.fillStyle = p.color; ctx.ellipse(p.x,p.y,p.size,p.size,0,0,Math.PI*2); ctx.fill(); ctx.restore(); } }

  /* ---------- Draw loop ---------- */
  function draw(){
    ctx.clearRect(0,0,W,H);

    drawBackground();

    // subtle stars overlay
    ctx.save(); for(let i=0;i<50;i++){ ctx.globalAlpha = 0.02 + ((i%7)/120); ctx.fillRect((i*23)%W, (i*37)%H, 2,2); } ctx.restore();

 
    // draw player
     const p = gameState.player;
    drawPlayer(p);

    // coins
    for(const c of gameState.coins) drawCoin(c);

    // meteors
    for(const m of gameState.meteors) drawMeteor(m);

    // powerups
    for(const u of gameState.powerups) drawPowerup(u);

    // shield aura
    if(gameState.active.shield > 0){
      ctx.save(); ctx.globalAlpha = 0.22 + 0.14*Math.sin(Date.now()/120); ctx.strokeStyle = '#66f'; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(p.x + p.w/2, p.y + p.h/2, p.w+14, p.h+24, 0, 0, Math.PI*2); ctx.stroke(); ctx.restore();
    }

    // particles
    drawParticles();
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
  helpBtn.addEventListener('click', ()=>{ alert('Move with A/D or ←/→ (or touch left/right). Collect Dragon Balls, avoid Beerus. Powerups: Magnet (pull Dragon Balls nearby), Shield (Protects you from Beerus), Time Slow (meteors slow). All last 5s.'); });
  settingsBtn.addEventListener('click', ()=>{ settingsModal.style.display='flex'; updatePreviews(); });
  settingsClose.addEventListener('click', ()=>{ settingsModal.style.display='none'; });

   restartBtn.addEventListener('click', ()=>{ gameOverScreen.style.display='none'; startGame(); });
  toStartBtn.addEventListener('click', ()=>{ gameOverScreen.style.display='none'; startScreen.style.display='flex'; });
  clearLbBtn.addEventListener('click', () => {
    fetchLeaderboard(); 
  });

function startGame(){ resetGame(); running = true; paused=false; lastTime=0; gameState.player.x = W/2 - gameState.player.w/2; }

  
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
    finalScore.innerText = `Game Over — Coins: ${gameState.score}`;
    gameOverScreen.style.display = 'flex';

    const handle = localStorage.getItem('dodge_twitter') || 'Anon';
    const score = gameState.score || 0;
    const duration = gameState.time || 0;
    const MIN_DURATION = 3;

    if (duration < MIN_DURATION) {
      finalScore.innerText = `Game Over — Coins: ${gameState.score} (play at least ${MIN_DURATION}s to submit)`;
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

  /* ---------- Audio ---------- */
  function beep(freq=440,duration=0.08){ if(!AUDIO_ENABLED) return; try{ const ac = new (window.AudioContext||window.webkitAudioContext)(); const o = ac.createOscillator(); const g = ac.createGain(); o.connect(g); g.connect(ac.destination); o.type='sine'; o.frequency.value=freq; g.gain.value=0.07; o.start(); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration); setTimeout(()=>{ o.stop(); ac.close(); }, duration*1000 + 30); } catch(e){} }

  /* ---------- Previews for settings (image-based) ---------- */
  function updatePreviews(){
    // player
    const playerPath = imagePaths.players[settings.player];
    if(playerPath) playerPreview.style.backgroundImage = `url('${playerPath}')`;
    else playerPreview.style.backgroundImage = '';

    // background
    const bgPath = imagePaths.backgrounds[settings.background];
    if(bgPath) backgroundPreview.style.backgroundImage = `url('${bgPath}')`;
    else backgroundPreview.style.backgroundImage = '';
  }
  updatePreviews();

  /* ---------- Background spawn & misc tasks ---------- */
  setInterval(()=>{ if(!running || paused) return; if(Math.random() < 0.12) spawnCoin(30 + Math.random()*(W-60), -20); }, 1000);
  setInterval(()=>{ if(!running || paused) return; if(Math.random() < 0.06) spawnPowerup(30 + Math.random()*(W-60), -20, ['magnet','shield','slow'][Math.floor(Math.random()*3)]); }, 2500);
  setInterval(()=>{ if(running && !paused){ gameState.meteorBaseSpeed += 0.6; } }, 1500);
  setInterval(()=>{ if(!running || paused) return; if(Math.random() < 0.03) spawnMeteor(30 + Math.random()*(W-60), -40, gameState.meteorBaseSpeed + Math.random()*60 + gameState.difficultyTimer*6); }, 650);

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






