'use strict';

// 커넥트4: 판 규칙과 컴퓨터 상대. 브라우저와 서버(Node)가 같은 코드를 쓴다 (document 가 없으면 module.exports 로 내보낸다).
//
// - 가로 7칸 × 세로 6칸의 세워진 판. 칸 번호 = 행 × 7 + 열 (행 0 이 맨 위). 열을 고르면 돌이 그 열의 맨 아래 빈칸까지 떨어진다
// - 빨강이 먼저 둔다. 가로·세로·대각선으로 자기 돌 4개를 먼저 이으면 승리. 판이 꽉 차면 무승부
const COLS = 7, ROWS = 6, N = COLS * ROWS, EMPTY = 0, RED = 1, YELLOW = 2;
const other = (p) => 3 - p;
const idx = (r, c) => r * COLS + c;
const newBoard = () => new Int8Array(N);

// c 열에서 돌이 멈출 행 (꽉 찼으면 -1)
function dropRow(b, c) {
  if (c < 0 || c >= COLS) return -1;
  for (let r = ROWS - 1; r >= 0; r--) if (b[idx(r, c)] === EMPTY) return r;
  return -1;
}
const canDrop = (b, c) => c >= 0 && c < COLS && b[idx(0, c)] === EMPTY;
const legalCols = (b) => { const out = []; for (let c = 0; c < COLS; c++) if (b[idx(0, c)] === EMPTY) out.push(c); return out; };
// 돌을 떨어뜨린다. 놓인 칸 번호를 돌려준다 (안 되면 -1)
function drop(b, c, p) {
  const r = dropRow(b, c);
  if (r < 0) return -1;
  b[idx(r, c)] = p;
  return idx(r, c);
}
const isFull = (b) => { for (let c = 0; c < COLS; c++) if (b[idx(0, c)] === EMPTY) return false; return true; };

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
// i 칸에 방금 놓은 돌 p 가 4개 이상 이어졌으면 그 줄(칸 번호 배열)을 돌려준다. 아니면 null
function winLine(b, i, p) {
  const r0 = (i / COLS) | 0, c0 = i % COLS;
  for (const [dr, dc] of DIRS) {
    const line = [i];
    for (const s of [1, -1]) {
      let r = r0 + dr * s, c = c0 + dc * s;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && b[idx(r, c)] === p) { line.push(idx(r, c)); r += dr * s; c += dc * s; }
    }
    if (line.length >= 4) return line;
  }
  return null;
}
// 판 전체에서 p 의 4목이 있나 (시험·복원용)
function findWin(b) {
  for (let i = 0; i < N; i++) if (b[i] && winLine(b, i, b[i])) return { p: b[i], line: winLine(b, i, b[i]) };
  return null;
}

// ---------- 컴퓨터 ----------
// 4칸 묶음(가로·세로·대각선 69개) 점수: 내 돌만 있으면 +, 상대 돌만 있으면 -. 가운데 열이 길이 많아 가운데를 선호한다
const WINDOWS = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) for (const [dr, dc] of DIRS) {
  const er = r + dr * 3, ec = c + dc * 3;
  if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
  WINDOWS.push([idx(r, c), idx(r + dr, c + dc), idx(r + dr * 2, c + dc * 2), idx(er, ec)]);
}
const WIN_SCORE = 100000;
function evaluate(b, p) {
  const o = other(p);
  let s = 0;
  for (let r = 0; r < ROWS; r++) if (b[idx(r, 3)] === p) s += 6; else if (b[idx(r, 3)] === o) s -= 6;
  for (const w of WINDOWS) {
    let mine = 0, theirs = 0;
    for (let k = 0; k < 4; k++) { const v = b[w[k]]; if (v === p) mine++; else if (v === o) theirs++; }
    if (mine && theirs) continue;
    if (mine === 3) s += 12; else if (mine === 2) s += 4; else if (mine === 1) s += 1;
    if (theirs === 3) s -= 14; else if (theirs === 2) s -= 4; else if (theirs === 1) s -= 1;
  }
  return s;
}

const ORDER = [3, 2, 4, 1, 5, 0, 6];                       // 가운데부터 보면 가지를 많이 쳐낸다
class Timeout extends Error {}
// 알파-베타 탐색. 점수는 p(차례인 쪽)의 입장. 빨리 이길수록·늦게 질수록 좋게 depth 를 점수에 섞는다
function search(b, p, depth, alpha, beta, ctx, free) {
  if (ctx.deadline && (++ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) throw new Timeout();
  if (free === 0) return 0;                                  // 꽉 참: 무승부
  if (depth === 0) return evaluate(b, p);
  let best = -Infinity;
  for (const c of ORDER) {
    const r = dropRow(b, c);
    if (r < 0) continue;
    const i = idx(r, c);
    b[i] = p;
    let s;
    if (winLine(b, i, p)) s = WIN_SCORE + depth;
    else s = -search(b, other(p), depth - 1, -beta, -alpha, ctx, free - 1);
    b[i] = EMPTY;
    if (s > best) best = s;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// 한 열을 고른다. level: easy(가끔 실수하는 초보) · normal(5수 앞) · hard(시간 안에 깊이 읽는다)
function aiMove(b, p, level = 'normal', opts = {}) {
  const cols = legalCols(b);
  if (!cols.length) return -1;
  if (cols.length === 1) return cols[0];
  const rand = opts.rand || Math.random, o = other(p);
  const wins = (c, who) => { const t = b.slice(); const i = drop(t, c, who); return i >= 0 && !!winLine(t, i, who); };
  // 이길 수 있으면 이긴다 (쉬움도 보이는 한 수 승리는 놓치지 않는다)
  for (const c of cols) if (wins(c, p)) return c;
  // 막아야 하는 곳: 쉬움은 가끔 못 본다
  const block = cols.filter((c) => wins(c, o));
  if (block.length && (level !== 'easy' || rand() < 0.7)) return block[0];
  if (level === 'easy') {
    // 상대가 바로 위에서 이기게 해 주는 열은 피하되, 대체로 무작위
    const safe = cols.filter((c) => { const t = b.slice(); drop(t, c, p); return !legalCols(t).some((x) => { const u = t.slice(); const i = drop(u, x, o); return i >= 0 && winLine(u, i, o); }); });
    const pool = safe.length && rand() < 0.75 ? safe : cols;
    return pool[Math.floor(rand() * pool.length)];
  }
  const free = N - b.reduce((n, v) => n + (v ? 1 : 0), 0);
  const scoreAll = (depth, ctx) => ORDER.filter((c) => canDrop(b, c)).map((c) => {
    const t = b.slice(); const i = drop(t, c, p);
    const s = winLine(t, i, p) ? WIN_SCORE + depth : -search(t, o, depth - 1, -Infinity, Infinity, ctx, free - 1);
    return { c, s };
  });
  if (level === 'normal') {
    const r = scoreAll(5, { nodes: 0, deadline: 0 }).sort((x, y) => y.s - x.s);
    const top = r.filter((x) => x.s >= r[0].s - 3);          // 비슷한 점수면 무작위: 매번 똑같이 두지 않게
    return top[Math.floor(rand() * top.length)].c;
  }
  // hard: 시간 안에서 점점 깊이 (iterative deepening)
  const budget = opts.ms || 800, start = Date.now(), maxDepth = opts.depth || 12;
  let bestC = cols.slice().sort((a, c) => Math.abs(a - 3) - Math.abs(c - 3))[0];
  for (let d = 2; d <= maxDepth; d++) {
    const ctx = { nodes: 0, deadline: start + budget };
    try {
      const r = scoreAll(d, ctx).sort((x, y) => y.s - x.s);
      bestC = r[0].c;
      if (r[0].s >= WIN_SCORE) break;                         // 이기는 길을 찾았다
      if (r.every((x) => x.s <= -WIN_SCORE) ) break;          // 어떻게 해도 진다
    } catch (e) { if (e instanceof Timeout) break; throw e; }
    if (Date.now() - start > budget * 0.6) break;
  }
  return bestC;
}

const RULES = { COLS, ROWS, N, EMPTY, RED, YELLOW, other, idx, newBoard, dropRow, canDrop, legalCols, drop, isFull, winLine, findWin, evaluate, aiMove };
if (typeof document === 'undefined' && typeof module !== 'undefined') module.exports = RULES;
else if (typeof window !== 'undefined') window.CONNECT4 = RULES;
