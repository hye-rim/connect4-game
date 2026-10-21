'use strict';

// 커넥트4: 화면·입력·온라인. 판 규칙과 컴퓨터는 rules.js (CONNECT4).
(() => {
const R = CONNECT4;
const { COLS, ROWS, N, EMPTY, RED, YELLOW, other } = R;

// ---------- 모양 ----------
const CELL = 70, PAD = 14, TOP = 70;
const SIZE = PAD * 2 + COLS * CELL;              // 518
const BX = PAD, BY = TOP + PAD;                   // 판(파란 부분)의 왼쪽 위
const BW = COLS * CELL, BH = ROWS * CELL;
const DISC_R = CELL * 0.4, HOLE_R = CELL * 0.42;
const INK = '#2b1d52';
const FONT = '"Jua", "Apple SD Gothic Neo", sans-serif';
const DROP_MS = 520;
const COLOR = { [RED]: ['#ff8fa3', '#ff5f7a', '#c4264a'], [YELLOW]: ['#fff0a0', '#ffd23f', '#d99a00'] };
const NAME = { [RED]: '빨강', [YELLOW]: '노랑' };
const LEVELS = { easy: { name: '쉬움' }, normal: { name: '보통' }, hard: { name: '어려움' } };

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

function fit() {
  const hudH = 112;
  const scale = Math.min((innerWidth - 28) / SIZE, (innerHeight - 24 - hudH) / SIZE);
  const css = Math.floor(SIZE * scale);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = canvas.style.height = css + 'px';
  canvas.width = canvas.height = Math.round(css * dpr);
  ctx.setTransform(canvas.width / SIZE, 0, 0, canvas.height / SIZE, 0, 0);
  $('col').style.width = Math.min(innerWidth - 16, Math.max(css, 300)) + 'px';
  draw();
}
addEventListener('resize', fit);

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
const RECORD_KEY = 'connect4Record';   // 컴퓨터 상대 { easy: {w, l, d}, normal: …, hard: … }
const WINS_KEY = 'connect4Wins';       // 컴퓨터 상대 총 승수 (로비 카드에 표시)
const ONLINE_KEY = 'connect4Online';   // 온라인 { w, l, d }
function loadJson(k) { try { return JSON.parse(store.get(k)) || {}; } catch (_) { return {}; } }
const myName = () => store.get('connect4Name') || '';
const SESSION_KEY = 'connect4Session';
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; } }
function saveSession(s) { try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }

// ---------- 소리 ----------
let audio = null;
let muted = store.get('connect4Muted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type, vol) => notes.forEach((f, i) => setTimeout(() => tone(f, 0.18, type, vol), i * step));
const sfx = {
  drop: (row) => { setTimeout(() => tone(260, 0.08, 'triangle', 0.2, -90), DROP_MS * 0.55); setTimeout(() => tone(180 + row * 12, 0.06, 'sine', 0.08), DROP_MS * 0.75); },
  nope: () => tone(190, 0.1, 'square', 0.05, -50),
  undo: () => tone(500, 0.08, 'sine', 0.08, -200),
  tick: () => tone(880, 0.04, 'square', 0.04),
  found: () => seq([660, 880], 110, 'sine', 0.08),
  win: () => seq([523, 659, 784, 1047], 120, 'square', 0.06),
  lose: () => seq([392, 330, 262, 196], 180, 'triangle', 0.1),
};

// ---------- 게임 상태 ----------
// 두 모드가 판·차례를 같은 변수로 공유한다. 온라인은 서버가 보내준 값으로 덮어쓴다.
let mode = null;           // null(메뉴) | ai | online
let board = R.newBoard();
let turn = RED;
let over = false;
let lastMove = -1;         // 마지막으로 둔 칸
let winCells = [];         // 4목이 이어진 칸들
let hoverCol = -1, cursorCol = -1;
let note = null;           // 캔버스 위에 잠깐 띄우는 안내 { text, until }
let drops = new Map();     // 칸 -> 떨어지기 시작한 시각 (떨어지는 중인 돌)

// 컴퓨터 대전
let level = store.get('connect4Level') || 'normal';
let humanColor = Number(store.get('connect4Color')) || RED;
let thinking = false, aiTimer = null;
let history = [];          // 무르기용: 둔 사람이 두기 전의 { board, turn, last }

// 온라인
let room = null, screen = '', turnEnd = 0, netDown = false, resultSeen = '', recorded = '';

const myColor = () => (mode === 'ai' ? humanColor : room ? room.you : EMPTY);
// 돌이 떨어지는 중인가: 화면을 다시 그리는 것과 상관없이 시각으로 따진다 (백그라운드 탭에서도 입력이 막힌 채 남지 않게)
const dropping = () => { const now = performance.now(); for (const t of drops.values()) if (now - t < DROP_MS) return true; return false; };
function canPlay() {
  if (over || !mode) return false;
  if (mode === 'ai') return !thinking && turn === humanColor;
  return !!room && room.state === 'playing' && turn === room.you && !netDown;
}

function resetBoard() {
  board = R.newBoard(); turn = RED; over = false; lastMove = -1; winCells = []; hoverCol = cursorCol = -1;
  drops = new Map(); note = null; history = [];
}
function showNote(text, ms = 1500) { note = { text, until: performance.now() + ms }; scheduleDraw(); }

// ---------- 두기 (컴퓨터·온라인 공통의 화면 효과) ----------
function animateDrop(i) {
  drops.set(i, performance.now());
  lastMove = i;
  sfx.drop((i / COLS) | 0);
  scheduleDraw();
}

// ---------- 컴퓨터 대전 ----------
function newAiGame() {
  leaveOnline();
  clearTimeout(aiTimer);
  mode = 'ai'; thinking = false;
  resetBoard();
  hideOverlay(); updateHud(); draw();
  maybeAi();
}

function placeAi(c) {
  if (over || !R.canDrop(board, c)) return false;
  const mover = turn;
  history.push({ board: board.slice(), turn, last: lastMove });
  const i = R.drop(board, c, mover);
  animateDrop(i);
  const line = R.winLine(board, i, mover);
  if (line) { winCells = line; finishAi(mover); }
  else if (R.isFull(board)) finishAi(EMPTY);
  else turn = other(mover);
  updateHud(); draw();
  return true;
}

function finishAi(winner) {
  over = true;
  let title = '무승부';
  const rec = loadJson(RECORD_KEY);
  const r = rec[level] || { w: 0, l: 0, d: 0 };
  if (winner === EMPTY) r.d = (r.d || 0) + 1;
  else if (winner === humanColor) { r.w++; store.set(WINS_KEY, String((Number(store.get(WINS_KEY)) || 0) + 1)); title = '🎉 승리!'; setTimeout(sfx.win, DROP_MS); }
  else { r.l++; title = '😵 패배'; setTimeout(sfx.lose, DROP_MS); }
  rec[level] = r;
  store.set(RECORD_KEY, JSON.stringify(rec));
  const sub = `${winner === EMPTY ? '판이 가득 찼어요' : `${NAME[winner]} 4개 완성`} · ${LEVELS[level].name} ${r.w}승 ${r.l}패${r.d ? ` ${r.d}무` : ''}`;
  setTimeout(() => {
    if (!over || mode !== 'ai') return;   // 그 사이 무르기
    showOverlay(`
      <h2>${title}</h2>
      <p>${sub}</p>
      <div class="row"><button class="main" data-act="aiStart">한 판 더</button></div>
      <div class="row">
        <button class="sub" data-act="close">판 보기</button>
        <button class="sub" data-act="undo">무르기</button>
        <button class="sub" data-act="home">메뉴</button>
      </div>`);
  }, DROP_MS + 900);
}

function maybeAi() {
  if (mode !== 'ai' || over || turn === humanColor) return;
  thinking = true;
  updateHud();
  const mover = turn;
  aiTimer = setTimeout(() => {
    const t0 = performance.now();
    const c = R.aiMove(board, mover, level, { ms: 800 });
    const wait = Math.max(0, 520 - (performance.now() - t0));
    aiTimer = setTimeout(() => {
      thinking = false;
      if (c >= 0) placeAi(c);
      updateHud();
    }, wait);
  }, 30);
}

function undo() {
  if (mode !== 'ai' || !history.length) return;
  clearTimeout(aiTimer);
  thinking = false;
  // 내 차례로 돌아오도록, 내가 둔 마지막 수 이전으로 되돌린다
  let snap = null;
  while (history.length) { snap = history.pop(); if (snap.turn === humanColor) break; }
  if (!snap || snap.turn !== humanColor) { if (snap) history.push(snap); return; }
  board = snap.board; turn = snap.turn; lastMove = snap.last;
  over = false; winCells = []; drops = new Map(); note = null;
  hideOverlay(); sfx.undo(); updateHud(); draw(); maybeAi();   // 컴퓨터가 먼저(빨강)였으면 다시 둔다
}

// ---------- 온라인: 연결 ----------
const net = {
  ws: null, pulse: null, outbox: [], retry: 0,
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${location.pathname}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw('hello', { name: myName() });
      const s = loadSession();
      if (s) this.raw('resume', s);
      for (const [t, p] of this.outbox.splice(0)) this.raw(t, p);
      clearInterval(this.pulse);
      // 프록시가 WebSocket ping 을 대신 받아버리는 환경이 있어 살아있다는 신호를 직접 보낸다
      this.pulse = setInterval(() => this.raw('pulse'), 10000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onNet(m); };
    ws.onclose = () => {
      clearInterval(this.pulse);
      if (this.ws !== ws) return;   // 일부러 닫은 연결
      this.ws = null;
      if (mode !== 'online') return;
      if (room || loadSession()) {
        // 대국 중이면 계속 다시 붙어본다. 서버는 30초 동안 자리를 비워둔다.
        netDown = true; updateHud();
        setTimeout(() => { if (mode === 'online') this.connect(); }, Math.min(4000, 500 * 2 ** this.retry++));
      } else showOnline('서버와 연결이 끊겼어요. 다시 시도해 주세요.');
    };
  },
  send(t, p = {}) {
    if (this.ws && this.ws.readyState === 1) this.raw(t, p);
    else { this.outbox.push([t, p]); this.connect(); }
  },
  raw(t, p = {}) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...p })); },
  close() {
    const ws = this.ws;
    this.ws = null; this.outbox = [];
    clearInterval(this.pulse);
    if (ws) ws.close();
  },
};

function onNet(m) {
  if (m.t === 'queued') { screen = 'queued'; showQueued(); }
  else if (m.t === 'room') applyRoom(m);
  else if (m.t === 'error') { room = null; saveSession(null); showOnline(m.msg); }
  else if (m.t === 'resumeFailed') {
    saveSession(null);
    if (room) { room = null; showOnline('대국이 끝나서 이어갈 수 없어요.'); }
    netDown = false; updateHud();
  }
}

function leaveOnline() {
  if (mode !== 'online') return;
  net.send('leave'); net.close();
  saveSession(null);
  room = null; netDown = false;
}

// ---------- 온라인: 대국 ----------
const moves = () => (room ? room.moves : []);
function applyRoom(r) {
  const prevLen = moves().length;
  const fresh = !room || room.code !== r.code;
  const newGame = r.state === 'playing' && (!room || room.state !== 'playing');
  room = r;
  netDown = false;
  saveSession({ code: r.code, token: r.token });

  // 서버가 보낸 수순을 처음부터 떨어뜨려서 판을 맞춘다. 방금 늘어난 한 수만 떨어지는 효과를 보여 준다
  const b = R.newBoard();
  let lastI = -1;
  for (const [c, col] of r.moves) { const i = R.drop(b, c, col); if (i < 0) break; lastI = i; }
  board = b;
  if (r.moves.length === prevLen + 1 && !fresh && lastI >= 0) animateDrop(lastI);
  else { drops = new Map(); lastMove = lastI; }
  turn = r.turn;
  over = r.state === 'over';
  winCells = r.state === 'over' && r.winner !== EMPTY ? r.line || [] : [];
  turnEnd = performance.now() + r.remain;

  if (r.state === 'waiting') {
    screen = 'waiting'; showWaiting();
  } else if (r.state === 'playing') {
    if (newGame) { sfx.found(); resultSeen = ''; hoverCol = cursorCol = -1; }
    if (screen !== 'confirm') { screen = ''; hideOverlay(); }
  } else {
    const key = `${r.code}:${r.moves.length}:${r.reason}:${r.winner}`;
    if (recorded !== key) {
      recorded = key;
      const rec = loadJson(ONLINE_KEY);
      if (r.winner === EMPTY) rec.d = (rec.d || 0) + 1;
      else if (r.winner === r.you) { rec.w = (rec.w || 0) + 1; setTimeout(sfx.win, r.reason === 'connect' ? DROP_MS : 0); }
      else { rec.l = (rec.l || 0) + 1; setTimeout(sfx.lose, r.reason === 'connect' ? DROP_MS : 0); }
      store.set(ONLINE_KEY, JSON.stringify(rec));
    }
    if (resultSeen !== key) {
      // 마지막 돌이 떨어지고 4목이 반짝이는 모습을 잠깐 보여준 뒤 결과창
      const delay = ['connect', 'draw'].includes(r.reason) && screen !== 'result' ? DROP_MS + 900 : 0;
      setTimeout(() => { if (room === r && resultSeen !== key) showResult(); }, delay);
    }
  }
  updateHud(); draw();
}
const opponent = () => room && room.players.find((p) => p.color !== room.you);

function showResult() {
  screen = 'result';
  const r = room, opp = opponent();
  const won = r.winner === r.you;
  const title = r.winner === EMPTY ? '무승부' : won ? '🎉 승리!' : '😵 패배';
  const why = {
    connect: won ? '4개를 먼저 이었어요!' : '상대가 4개를 이었어요',
    draw: '판이 가득 찼어요',
    resign: won ? '상대가 기권했어요' : '기권했어요',
    timeout: won ? '상대가 시간을 넘겼어요' : '시간을 넘겼어요',
    left: won ? '상대가 나갔어요' : '연결이 끊겨 패배했어요',
  }[r.reason] || '';
  const rec = loadJson(ONLINE_KEY);
  const iVoted = r.rematch.includes(r.you), theyVoted = opp && r.rematch.includes(opp.color);
  let again;
  if (!opp) again = '<p>상대가 방을 나갔어요</p>';
  else if (iVoted) again = '<p>상대를 기다리는 중…</p>';
  else again = `${theyVoted ? '<p>상대가 한 판 더 두고 싶어해요!</p>' : ''}<div class="row"><button class="main" data-act="rematch">한 판 더</button></div>`;
  showOverlay(`
    <h2>${title}</h2>
    ${why ? `<p>${why}</p>` : ''}
    <span class="record">온라인 ${rec.w || 0}승 ${rec.l || 0}패${rec.d ? ` ${rec.d}무` : ''}</span>
    ${again}
    <div class="row">
      <button class="sub" data-act="viewResult">판 보기</button>
      <button class="sub" data-act="leave">나가기</button>
    </div>`);
}

function humanPlace(c) {
  if (!canPlay() || dropping()) return;                 // 돌이 떨어지는 동안에는 기다린다
  if (!R.canDrop(board, c)) { sfx.nope(); showNote('가득 찬 열이에요', 1100); return; }
  hoverCol = -1;
  if (mode === 'ai') { if (placeAi(c)) maybeAi(); return; }
  net.send('place', { c });
}

// 남은 시간 표시. 10초 아래로 내려가면 똑딱.
let lastTick = -1;
setInterval(() => {
  if (mode !== 'online' || !room || room.state !== 'playing') return;
  const s = Math.max(0, Math.ceil((turnEnd - performance.now()) / 1000));
  if (s !== lastTick) {
    lastTick = s;
    if (s <= 10 && s > 0 && turn === room.you) sfx.tick();
    updateHud();
  }
}, 200);

// ---------- HUD ----------
function updateHud() {
  let names = [NAME[RED], NAME[YELLOW]], status = '';
  let reds = 0, yellows = 0;
  for (let i = 0; i < N; i++) { if (board[i] === RED) reds++; else if (board[i] === YELLOW) yellows++; }
  if (mode === 'ai') {
    const cpu = `🤖${LEVELS[level].name}`;
    names = humanColor === RED ? ['나', cpu] : [cpu, '나'];
    status = over ? '게임 끝' : thinking ? '생각 중…' : '내 차례';
  } else if (mode === 'online' && room) {
    for (const p of room.players) {
      const label = p.color === room.you ? `${p.name} (나)` : p.online ? p.name : `${p.name} · 끊김`;
      if (p.color === RED) names[0] = label;
      if (p.color === YELLOW) names[1] = label;
    }
    if (room.state === 'waiting') status = '상대 기다리는 중';
    else if (room.state === 'over') status = '게임 끝';
    else if (netDown) status = '다시 연결하는 중…';
    else {
      const s = Math.max(0, Math.ceil((turnEnd - performance.now()) / 1000));
      status = `${turn === room.you ? '내 차례' : '상대 차례'} · ${s}초`;
    }
  }
  $('n1').textContent = names[0]; $('n2').textContent = names[1];
  $('c1').textContent = reds; $('c2').textContent = yellows;
  const live = !!mode && !over && (mode === 'ai' || (room && room.state === 'playing'));
  $('p1').classList.toggle('turn', live && turn === RED);
  $('p2').classList.toggle('turn', live && turn === YELLOW);
  $('status').textContent = status;
  const low = mode === 'online' && live && turn === room.you && turnEnd - performance.now() < 10000;
  $('status').classList.toggle('warn', !!low);

  const undoBtn = $('undoBtn');
  if (mode === 'online') { undoBtn.textContent = '🏳'; undoBtn.title = '기권'; undoBtn.disabled = !live; }
  else { undoBtn.textContent = '↩'; undoBtn.title = '무르기 (Z)'; undoBtn.disabled = mode !== 'ai' || !history.some((h) => h.turn === humanColor); }
}

// ---------- 그리기 ----------
const cx = (c) => BX + c * CELL + CELL / 2;
const cy = (r) => BY + r * CELL + CELL / 2;
let drawQueued = false;
function scheduleDraw() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(() => { drawQueued = false; draw(); }); } }

function disc(x, y, p, alpha = 1, r = DISC_R) {
  const [hi, mid, lo] = COLOR[p];
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, hi); g.addColorStop(0.55, mid); g.addColorStop(1, lo);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(43,29,82,.35)';                  // 안쪽 둥근 홈
  ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.beginPath(); ctx.ellipse(x - r * 0.32, y - r * 0.45, r * 0.3, r * 0.14, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function label(text, x, y, size, fill = '#fff') {
  ctx.font = `${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.22; ctx.strokeStyle = INK; ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}
const roundRect = (x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };

// 떨어지는 돌의 높이 (0 → 1): 가속하며 떨어지다 바닥에서 살짝 튕긴다
function fallY(k, targetRow) {
  const y0 = BY - CELL * 0.6, y1 = cy(targetRow);
  if (k >= 1) return y1;
  const t = Math.min(1, k / 0.78);
  if (k < 0.78) return y0 + (y1 - y0) * t * t;
  const b = (k - 0.78) / 0.22;                         // 튕김
  return y1 - Math.sin(b * Math.PI) * 9 * (1 - b);
}

function draw() {
  const now = performance.now();
  let animating = false;
  // 배경
  const bg = ctx.createLinearGradient(0, 0, 0, SIZE);
  bg.addColorStop(0, '#dce9ff'); bg.addColorStop(1, '#b9d2ff');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, SIZE, SIZE);
  // 판 뒤쪽 (구멍으로 보이는 바탕)
  ctx.fillStyle = '#f3f7ff'; roundRect(BX, BY, BW, BH, 10); ctx.fill();

  // 위에서 놓을 열 미리보기: 마우스·키보드 열
  const col = canPlay() && !dropping() ? (hoverCol >= 0 ? hoverCol : cursorCol) : -1;
  if (col >= 0) {
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillRect(BX + col * CELL, BY - 6, CELL, BH + 6);
    if (R.canDrop(board, col)) {
      disc(cx(col), BY - CELL * 0.6, turn, 0.75);
      const r = R.dropRow(board, col);
      ctx.strokeStyle = 'rgba(43,29,82,.35)'; ctx.lineWidth = 3; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(cx(col), cy(r), DISC_R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  // 돌 (판 앞면보다 뒤에 그려서 구멍으로 보인다)
  const winSet = new Set(winCells);
  for (let i = 0; i < N; i++) {
    const v = board[i];
    if (!v) continue;
    const r = (i / COLS) | 0, c = i % COLS;
    let y = cy(r);
    const t0 = drops.get(i);
    if (t0 !== undefined) {
      const k = (now - t0) / DROP_MS;
      if (k < 1) { y = fallY(k, r); animating = true; } else drops.delete(i);
    }
    const dim = winCells.length && !winSet.has(i);
    disc(cx(c), y, v, dim ? 0.55 : 1);
  }

  // 파란 판 앞면: 구멍을 뚫어서 그린다 (evenodd)
  ctx.save();
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(BX - 6, BY - 6, BW + 12, BH + 12, 18); else ctx.rect(BX - 6, BY - 6, BW + 12, BH + 12);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { ctx.moveTo(cx(c) + HOLE_R, cy(r)); ctx.arc(cx(c), cy(r), HOLE_R, 0, Math.PI * 2); }
  const g = ctx.createLinearGradient(0, BY, 0, BY + BH);
  g.addColorStop(0, '#4f7dff'); g.addColorStop(1, '#2f5be6');
  ctx.fillStyle = g; ctx.fill('evenodd');
  ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
  ctx.restore();
  // 구멍 테두리 (입체감)
  ctx.strokeStyle = 'rgba(15,30,110,.8)'; ctx.lineWidth = 3;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { ctx.beginPath(); ctx.arc(cx(c), cy(r), HOLE_R, 0, Math.PI * 2); ctx.stroke(); }
  // 판 위의 광택
  ctx.fillStyle = 'rgba(255,255,255,.1)'; roundRect(BX - 2, BY - 2, BW + 4, 16, 8); ctx.fill();

  // 마지막 수 표시 / 4목 반짝임
  if (winCells.length && !dropping()) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    for (const i of winCells) {
      ctx.strokeStyle = `rgba(255,255,255,${0.7 + 0.3 * pulse})`; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(cx(i % COLS), cy((i / COLS) | 0), DISC_R + 3 + pulse * 2, 0, Math.PI * 2); ctx.stroke();
    }
    animating = true;
  } else if (lastMove >= 0 && board[lastMove] && !dropping() && !over) {
    ctx.fillStyle = 'rgba(43,29,82,.55)';
    ctx.beginPath(); ctx.arc(cx(lastMove % COLS), cy((lastMove / COLS) | 0), 7, 0, Math.PI * 2); ctx.fill();
  }

  // 안내 문구
  if (note) {
    if (now > note.until) note = null;
    else {
      const k = Math.min(1, (note.until - now) / 300);
      ctx.save(); ctx.globalAlpha = k;
      ctx.fillStyle = 'rgba(43,29,82,.88)';
      const w = Math.min(SIZE - 40, 44 + note.text.length * 24), x0 = (SIZE - w) / 2;
      roundRect(x0, SIZE / 2 - 28, w, 56, 28); ctx.fill();
      label(note.text, SIZE / 2, SIZE / 2 + 1, 26, '#ffd23f');
      ctx.restore();
      animating = true;
    }
  }
  if (animating) scheduleDraw();
}

// ---------- 오버레이 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }
const overlayOpen = () => !$('overlay').classList.contains('hidden');
function segHtml(key, opts, value) {
  return `<div class="seg" data-key="${key}">${opts.map(([v, label]) => `<button data-v="${v}" class="${String(v) === String(value) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
}

function showHome() {
  leaveOnline();
  clearTimeout(aiTimer);
  mode = null; screen = ''; thinking = false;
  resetBoard(); updateHud(); draw();
  const wins = Number(store.get(WINS_KEY)) || 0, on = loadJson(ONLINE_KEY);
  showOverlay(`
    <h1><span class="r">커넥</span><span class="y">트4</span></h1>
    <p>돌을 떨어뜨려 <b>가로·세로·대각선으로<br>4개를 먼저 이으면</b> 승리!</p>
    <div class="modes">
      <button class="mode" data-act="aiMenu"><span class="ico">🤖</span><b>컴퓨터랑 하기</b><small>쉬움 · 보통 · 어려움</small></button>
      <button class="mode" data-act="online"><span class="ico">🌐</span><b>온라인 커넥트4</b><small>빠른 대전 · 친구와 방 만들기</small></button>
    </div>
    <span class="record">${wins || on.w || on.l ? `컴퓨터 상대 ${wins}승 · 온라인 ${on.w || 0}승 ${on.l || 0}패` : ''}</span>`);
}

function showAiMenu() {
  const rec = loadJson(RECORD_KEY)[level];
  const playing = mode === 'ai' && !over && history.length;
  showOverlay(`
    <h2>🤖 컴퓨터랑 하기</h2>
    <div class="group">
      <span class="label">난이도</span>
      ${segHtml('level', [['easy', '쉬움'], ['normal', '보통'], ['hard', '어려움']], level)}
      <span class="record">${rec ? `전적 ${rec.w}승 ${rec.l}패${rec.d ? ` ${rec.d}무` : ''}` : ''}</span>
    </div>
    <div class="group">
      <span class="label">내 돌</span>
      ${segHtml('color', [[RED, '🔴 빨강 (먼저)'], [YELLOW, '🟡 노랑 (나중)']], humanColor)}
    </div>
    <div class="row">
      <button class="main" data-act="aiStart">${playing ? '새로 시작' : '시작하기'}</button>
      ${playing ? '<button class="sub" data-act="close">계속하기</button>' : ''}
    </div>
    <button class="back" data-act="home">← 처음으로</button>
    <div class="help"><span class="pc">🖱️ 열을 클릭해서 돌을 떨어뜨려요<br>⌨️ ←→ + Space (또는 숫자 1~7) · Z 무르기</span><span class="touch">👆 돌을 놓을 열을 눌러요</span></div>`);
}

function showOnline(error = '') {
  leaveOnline();
  clearTimeout(aiTimer);
  mode = 'online'; screen = 'online'; room = null;
  resetBoard(); updateHud(); draw();
  showOverlay(`
    <h2>🌐 온라인 커넥트4</h2>
    <div class="group">
      <span class="label">내 이름</span>
      <input id="nameInput" maxlength="10" placeholder="이름 (최대 10자)" value="${esc(myName())}" autocomplete="off">
    </div>
    <div class="row"><button class="main" data-act="quick">⚡ 빠른 대전</button></div>
    <div class="row"><button class="sub" data-act="create">방 만들기</button></div>
    <div class="row join">
      <input id="codeInput" maxlength="4" placeholder="방 코드" autocomplete="off" autocapitalize="characters">
      <button class="sub" data-act="join">들어가기</button>
    </div>
    <span class="error">${esc(error)}</span>
    <button class="back" data-act="home">← 처음으로</button>
    <div class="help">한 수에 30초 · 빨강·노랑은 한 판마다 바뀌어요</div>`);
}

function showQueued() {
  showOverlay(`
    <h2>상대를 찾는 중…</h2>
    <div class="dots"><span></span><span></span><span></span></div>
    <p>누군가 빠른 대전을 누르면 바로 시작해요</p>
    <button class="sub" data-act="cancel">취소</button>`);
}
const inviteUrl = () => `${location.origin}${location.pathname}?room=${room.code}`;
function showWaiting() {
  showOverlay(`
    <h2>친구를 기다리는 중…</h2>
    <span class="label">방 코드</span>
    <div class="code">${esc(room.code)}</div>
    <p>친구가 <b>온라인 커넥트4 → 들어가기</b>에<br>이 코드를 입력하면 시작해요</p>
    <div class="row"><button class="main" data-act="copy">🔗 초대 링크 복사</button></div>
    <button class="sub" data-act="cancel">취소</button>`);
}
function saveName() {
  const input = $('nameInput');
  if (!input) return;
  const name = input.value.trim().slice(0, 10);
  store.set('connect4Name', name);
  net.send('hello', { name });
}

$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const seg = btn.closest('.seg');
  if (seg) {
    const v = btn.dataset.v;
    if (seg.dataset.key === 'level') { level = v; store.set('connect4Level', v); }
    if (seg.dataset.key === 'color') { humanColor = Number(v); store.set('connect4Color', v); }
    showAiMenu();
    return;
  }
  const act = btn.dataset.act;
  if (act === 'home') showHome();
  else if (act === 'aiMenu') showAiMenu();
  else if (act === 'aiStart') newAiGame();
  else if (act === 'close') { hideOverlay(); updateHud(); draw(); }
  else if (act === 'undo') undo();
  else if (act === 'online') showOnline();
  else if (act === 'quick') { saveName(); net.send('quick'); }
  else if (act === 'create') { saveName(); net.send('create'); }
  else if (act === 'join') {
    const code = ($('codeInput').value || '').trim().toUpperCase();
    if (code.length !== 4) { $('overlay').querySelector('.error').textContent = '방 코드 4자리를 입력해 주세요.'; return; }
    saveName();
    net.send('join', { code });
  } else if (act === 'cancel') { net.send('cancel'); showOnline(); }
  else if (act === 'copy') {
    const url = inviteUrl();
    const done = () => { btn.textContent = '✅ 복사했어요'; setTimeout(() => { btn.textContent = '🔗 초대 링크 복사'; }, 1500); };
    if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: '커넥트4 한 판 해요!', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('링크를 복사하세요', url));
    else prompt('링크를 복사하세요', url);
  } else if (act === 'rematch') net.send('rematch');
  else if (act === 'viewResult') { resultSeen = `${room.code}:${room.moves.length}:${room.reason}:${room.winner}`; screen = ''; hideOverlay(); }
  else if (act === 'leave') showOnline();
  else if (act === 'resign') { net.send('resign'); screen = ''; hideOverlay(); }
  else if (act === 'quit') showHome();
  else if (act === 'resume') { screen = ''; hideOverlay(); }
});
$('overlay').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'codeInput') $('overlay').querySelector('[data-act="join"]').click();
  if (e.target.id === 'nameInput') $('overlay').querySelector('[data-act="quick"]').click();
  e.stopPropagation();
});

function confirmResign() {
  screen = 'confirm';
  showOverlay(`<h2>기권할까요?</h2><p>이번 판은 패배로 기록돼요</p>
    <div class="row"><button class="main" data-act="resume">계속 두기</button><button class="sub" data-act="resign">🏳 기권</button></div>`);
}
function confirmQuit() {
  screen = 'confirm';
  showOverlay(`<h2>대국을 그만둘까요?</h2><p>지금 나가면 기권패가 돼요</p>
    <div class="row"><button class="main" data-act="resume">계속 두기</button><button class="sub" data-act="quit">나가기</button></div>`);
}

// ---------- 입력 ----------
function colAt(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (SIZE / rect.width);
  const c = Math.floor((x - BX) / CELL);
  return c < 0 || c >= COLS ? -1 : c;
}
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const c = colAt(e);
  if (c !== hoverCol) { hoverCol = c; scheduleDraw(); }
});
canvas.addEventListener('pointerleave', () => { hoverCol = -1; scheduleDraw(); });
canvas.addEventListener('pointerdown', (e) => {
  // 판 보기 중에 누르면 결과창으로 돌아간다
  if (over && !overlayOpen()) {
    if (mode === 'online' && room) { resultSeen = ''; showResult(); }
    else if (mode === 'ai') finishAiOverlay();
    return;
  }
  const c = colAt(e);
  if (c < 0 || !canPlay()) return;
  cursorCol = -1;
  humanPlace(c);
});
function finishAiOverlay() {
  showOverlay(`<h2>게임 끝</h2>
    <div class="row"><button class="main" data-act="aiStart">한 판 더</button></div>
    <div class="row"><button class="sub" data-act="close">판 보기</button><button class="sub" data-act="undo">무르기</button><button class="sub" data-act="home">메뉴</button></div>`);
}
function openMenu() {
  if (mode === 'online' && room && room.state === 'playing') confirmQuit();
  else if (mode === 'online') showOnline();
  else if (mode === 'ai') showAiMenu();
  else showHome();
}
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (e.code === 'Escape') {
    if (overlayOpen() && (screen === 'confirm' || (mode === 'ai' && !over && history.length))) { screen = ''; hideOverlay(); }
    else openMenu();
    return;
  }
  if (overlayOpen()) {
    if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); const m = $('overlay').querySelector('.main'); if (m) m.click(); }
    return;
  }
  if (e.code === 'KeyZ' || e.code === 'Backspace') { e.preventDefault(); undo(); return; }
  const digit = /^(?:Digit|Numpad)([1-7])$/.exec(e.code);
  if (digit) { e.preventDefault(); humanPlace(Number(digit[1]) - 1); return; }
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    e.preventDefault();
    if (cursorCol < 0) cursorCol = 3; else cursorCol = Math.min(COLS - 1, Math.max(0, cursorCol + (e.code === 'ArrowLeft' ? -1 : 1)));
    hoverCol = -1; draw();
  }
  if ((e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowDown') && cursorCol >= 0) { e.preventDefault(); humanPlace(cursorCol); }
});

function toggleMute() { muted = !muted; store.set('connect4Muted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('undoBtn').onclick = (e) => { e.currentTarget.blur(); if (mode === 'online') confirmResign(); else undo(); };
$('menuBtn').onclick = (e) => { e.currentTarget.blur(); openMenu(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 시작 ----------
// 초대 링크(?room=CODE)로 들어왔거나, 새로고침 전에 두던 대국이 있으면 온라인으로 바로 간다
const invite = new URLSearchParams(location.search).get('room');
if (invite) { try { window.history.replaceState(null, '', location.pathname); } catch (_) {} }
function joinInvite(code) { showOnline(); net.send('join', { code: code.toUpperCase() }); }
fit();
if (loadSession()) {
  mode = 'online'; screen = '';
  showOverlay('<h2>대국으로 돌아가는 중…</h2>');
  net.connect();
  const until = setInterval(() => {
    if (room || !loadSession()) { clearInterval(until); if (!room) invite ? joinInvite(invite) : showOnline(); }
  }, 100);
} else if (invite) joinInvite(invite);
else showHome();
updateHud();

/* @test-hooks:start */
window.__c4 = { get board() { return board; }, get turn() { return turn; }, get over() { return over; }, get mode() { return mode; }, get room() { return room; }, get thinking() { return thinking; }, get history() { return history; }, get winCells() { return winCells; }, humanPlace, newAiGame, undo, canPlay, draw, setLevel: (l) => { level = l; }, setColor: (c) => { humanColor = c; }, showResult, R };
/* @test-hooks:end */
})();
