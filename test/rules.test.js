'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../public/rules.js');
const { COLS, ROWS, RED, YELLOW } = R;

const fromRows = (rows) => {                       // 위 → 아래 6줄의 문자열 ('.' 빈칸, 'R' 빨강, 'Y' 노랑)
  const b = R.newBoard();
  rows.forEach((row, r) => [...row].forEach((ch, c) => { b[R.idx(r, c)] = ch === 'R' ? RED : ch === 'Y' ? YELLOW : 0; }));
  return b;
};

test('drop: stacks from the bottom and a full column refuses', () => {
  const b = R.newBoard();
  assert.strictEqual(R.drop(b, 3, RED), R.idx(5, 3));
  assert.strictEqual(R.drop(b, 3, YELLOW), R.idx(4, 3));
  for (let k = 0; k < 4; k++) R.drop(b, 3, RED);
  assert.strictEqual(R.drop(b, 3, RED), -1);
  assert.ok(!R.canDrop(b, 3)); assert.ok(R.canDrop(b, 2));
  assert.deepStrictEqual(R.legalCols(b), [0, 1, 2, 4, 5, 6]);
  assert.strictEqual(R.drop(b, -1, RED), -1); assert.strictEqual(R.drop(b, 7, RED), -1);
});

test('winLine: horizontal, vertical and both diagonals (4 or more)', () => {
  let b = R.newBoard();
  for (const c of [1, 2, 3]) R.drop(b, c, RED);
  const i = R.drop(b, 4, RED); assert.deepStrictEqual(R.winLine(b, i, RED).sort((a, c) => a - c), [R.idx(5, 1), R.idx(5, 2), R.idx(5, 3), R.idx(5, 4)]);
  b = R.newBoard(); let last; for (let k = 0; k < 4; k++) last = R.drop(b, 0, YELLOW);
  assert.strictEqual(R.winLine(b, last, YELLOW).length, 4);
  b = fromRows(['.......', '.......', '.......', '...R...', '..RY...', '.RYY...']);
  b[R.idx(2, 4)] = RED; b[R.idx(3, 3)] = RED; b[R.idx(4, 2)] = RED; b[R.idx(5, 1)] = RED;       // ↗ diagonal
  assert.ok(R.winLine(b, R.idx(3, 3), RED));
  b = fromRows(['.......', '.......', '.......', '.......', '.......', '.......']);
  for (let k = 0; k < 4; k++) b[R.idx(2 + k, 1 + k)] = YELLOW;                                  // ↘ diagonal
  assert.ok(R.winLine(b, R.idx(4, 3), YELLOW));
  b = R.newBoard(); for (const c of [1, 2, 3]) R.drop(b, c, RED); const j = R.drop(b, 5, RED);
  assert.strictEqual(R.winLine(b, j, RED), null);                                                 // gap: only 3 in a row
  b = R.newBoard(); for (const c of [1, 2, 3, 4]) R.drop(b, c, RED); const k5 = R.drop(b, 5, RED);
  assert.strictEqual(R.winLine(b, k5, RED).length, 5);                                            // five also counts
});

test('winLine: a row does not wrap around the board edge', () => {
  const b = R.newBoard();
  b[R.idx(4, 5)] = RED; b[R.idx(4, 6)] = RED; b[R.idx(5, 0)] = RED; b[R.idx(5, 1)] = RED;
  assert.strictEqual(R.findWin(b), null);
  b[R.idx(3, 6)] = RED; b[R.idx(2, 0)] = RED; assert.strictEqual(R.findWin(b), null);
});

test('isFull and a full-board draw', () => {
  const b = R.newBoard();
  assert.ok(!R.isFull(b));
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) R.drop(b, c, ((c + (r >> 1)) % 2) + 1);
  assert.ok(R.isFull(b));
  assert.deepStrictEqual(R.legalCols(b), []);
  assert.strictEqual(R.aiMove(b, RED, 'hard'), -1);
});

test('random playouts end with a real win or a full board', () => {
  let wins = 0, draws = 0;
  for (let g = 0; g < 400; g++) {
    const b = R.newBoard(); let p = RED, over = false;
    for (let t = 0; t < 42 && !over; t++) {
      const cols = R.legalCols(b); const c = cols[Math.floor(Math.random() * cols.length)];
      const i = R.drop(b, c, p);
      assert.ok(i >= 0);
      if (R.winLine(b, i, p)) { over = true; wins++; assert.deepStrictEqual(R.findWin(b).p, p); }
      p = R.other(p);
    }
    if (!over) { assert.ok(R.isFull(b)); draws++; }
  }
  assert.ok(wins > 300);
});

test('AI: always legal, takes a win, blocks a threat', () => {
  for (const level of ['easy', 'normal', 'hard']) {
    for (let g = 0; g < 8; g++) {
      const b = R.newBoard(); let p = RED;
      for (let t = 0; t < 42; t++) {
        const c = R.aiMove(b, p, level, { ms: 60 });
        if (c < 0) break;
        assert.ok(R.canDrop(b, c), `${level} illegal column ${c}`);
        const i = R.drop(b, c, p);
        if (R.winLine(b, i, p)) break;
        p = R.other(p);
      }
    }
  }
  // 빨강이 가로로 3개: 내 차례(빨강)면 이긴다, 노랑 차례면 막는다
  const b = fromRows(['.......', '.......', '.......', '.......', '.Y.....', '.RRR.Y.']);
  for (const level of ['easy', 'normal', 'hard']) assert.ok([0, 4].includes(R.aiMove(b, RED, level, { ms: 60 })), level + ' should win (either open end)');
  for (const level of ['normal', 'hard']) assert.ok([0, 4].includes(R.aiMove(b, YELLOW, level, { ms: 60 })), level + ' should block');
});

test('AI: hard avoids setting up an opponent win and sees a forced win two moves ahead', () => {
  // 빨강: 바닥에 2,3 + 위 칸들. 4 열에 두면 양쪽이 열리는 3 → 노랑이 못 막는 함정
  const b = fromRows(['.......', '.......', '.......', '.......', '.......', '..RR...']);
  const c = R.aiMove(b, RED, 'hard', { ms: 500 });
  assert.ok(c === 1 || c === 4, `expected an open-three move, got ${c}`);
  // 상대가 4열에서 이기는 자리를 만들어 주는 수는 피한다 (3열 위에 두면 노랑이 위에서 이김)
  const d = fromRows(['.......', '.......', '.......', '.......', '...Y...', '.YYRR..']);
  assert.notStrictEqual(R.aiMove(d, RED, 'hard', { ms: 300 }), 0, 'must block the open end');
});

function play(a, b, games, ms = 120) {
  const score = { a: 0, b: 0, d: 0 };
  for (let g = 0; g < games; g++) {
    const aIsRed = g % 2 === 0, bd = R.newBoard(); let p = RED, winner = 0;
    for (let t = 0; t < 42; t++) {
      const lvl = (p === RED) === aIsRed ? a : b;
      const c = R.aiMove(bd, p, lvl, { ms });
      const i = R.drop(bd, c, p);
      if (R.winLine(bd, i, p)) { winner = p; break; }
      p = R.other(p);
    }
    if (!winner) score.d++; else if ((winner === RED) === aIsRed) score.a++; else score.b++;
  }
  return score;
}
test('AI strength ordering: normal beats easy, hard beats normal', () => {
  const s1 = play('normal', 'easy', 12); assert.ok(s1.a >= 9 && s1.b <= 2, JSON.stringify(s1));
  const s2 = play('hard', 'normal', 10); assert.ok(s2.a >= 5 && s2.a - s2.b >= 3, JSON.stringify(s2));
});

test('AI: hard respects its time budget', () => {
  const b = R.newBoard();
  for (const c of [3, 3, 2, 4, 3, 2]) R.drop(b, c, R.legalCols(b).length % 2 ? RED : YELLOW);
  const t0 = Date.now(); R.aiMove(b, RED, 'hard', { ms: 300 });
  assert.ok(Date.now() - t0 < 900, 'took ' + (Date.now() - t0));
});
