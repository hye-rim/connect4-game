'use strict';

// 서버 시험: 보안·안정성 회귀 + 커넥트4 대국 흐름
// 실행: npm test  (Node 18 이상, 별도 설치 없이 node:test)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { WebSocket } = require('ws');
const R = require('../public/rules.js');

// 운영체제가 지금 비어 있는 포트를 골라 준다. 예전엔 정해 둔 범위에서 무작위로 골라서, 다른 시험의 서버나
// 다른 프로그램이 쓰는 포트와 겹치면 시험이 엉뚱한 서버에 붙어 가끔 실패했다
const freePort = () => Number(require('child_process').execFileSync(process.execPath, ['-e', "const s = require('net').createServer().listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); })"]));
const PORT = freePort();
const get = (p) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject); req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), TURN_MS: '1500' }, stdio: 'ignore' });
child.unref();
process.on('exit', () => child.kill());
const ready = (async () => {
  for (let i = 0; i < 80; i++) { try { await get('/'); return; } catch { await sleep(100); } }
  throw new Error('server did not start');
})();

const open = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const c = { ws, msgs: [], room: null, queued: false, errors: [], closed: null };
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    c.msgs.push(m);
    if (m.t === 'room') c.room = m;
    if (m.t === 'queued') c.queued = true;
    if (m.t === 'error') c.errors.push(m.msg);
  });
  ws.on('close', (code) => { c.closed = code; });
  ws.on('error', () => {});
  ws.on('open', () => resolve(c));
  setTimeout(() => reject(new Error('websocket connect failed')), 3000);
});
const send = (c, t, p = {}) => c.ws.send(JSON.stringify({ t, ...p }));
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(15); } return false; };

// 두 손님을 빠른 대전으로 맺어 준다
async function pair() {
  const a = await open(), b = await open();
  send(a, 'hello', { name: '가' }); send(b, 'hello', { name: '나' });
  send(a, 'quick'); await until(() => a.queued);
  send(b, 'quick');
  assert.ok(await until(() => a.room && b.room && a.room.state === 'playing' && b.room.state === 'playing'), 'both players enter a playing room');
  return [a, b];
}
// 스냅샷으로 판을 다시 만든다 (서버가 보낸 수순을 처음부터 떨어뜨려 본다)
function boardOf(room) {
  const b = R.newBoard();
  for (const [c, col] of room.moves) assert.ok(R.drop(b, c, col) >= 0, 'server move list replays legally');
  return b;
}
const mine = (a, b) => (a.room.turn === a.room.you ? a : b);
const redOf = (a, b) => (a.room.you === R.RED ? a : b);
// 수 하나를 두고 양쪽에 반영될 때까지 기다린다
async function play(a, b, col) {
  const mover = mine(a, b), before = mover.room.moves.length;
  send(mover, 'place', { c: col });
  assert.ok(await until(() => a.room.moves.length > before && b.room.moves.length > before), `move ${col} propagates to both`);
}

test('malformed URLs get 400 and the server stays up', async () => {
  await ready;
  assert.strictEqual(await get('/%'), 400);
  assert.strictEqual(await get('/%00'), 400);
  assert.strictEqual(await get('/%E0%A4%A'), 400);
  assert.strictEqual(await get('/'), 200);
  assert.strictEqual(await get('/rules.js'), 200);
});

test('dotfiles and paths outside the public dir are not served', async () => {
  await ready;
  assert.strictEqual(await get('/.git/config'), 403);
  assert.strictEqual(await get('/.hidden'), 403);
  assert.ok([403, 404].includes(await get('/../server.js')));
});

test('oversized websocket message closes the connection (1009)', async () => {
  await ready;
  const c = await open();
  c.ws.send('x'.repeat(2 * 1024 * 1024));
  await sleep(500);
  assert.strictEqual(c.closed, 1009);
  assert.strictEqual(await get('/'), 200);
});

test('quick match starts an empty game with red to move', async () => {
  await ready;
  const [a, b] = await pair();
  assert.strictEqual(a.room.code, b.room.code);
  assert.notStrictEqual(a.room.you, b.room.you);
  assert.strictEqual(a.room.turn, R.RED);
  assert.strictEqual(a.room.moves.length, 0);
  assert.deepStrictEqual(a.room.line, []);
  a.ws.close(); b.ws.close();
});

test('out-of-turn moves, bad columns and garbage are ignored; a full column refuses', async () => {
  await ready;
  const [a, b] = await pair();
  const red = redOf(a, b), yellow = red === a ? b : a;
  send(yellow, 'place', { c: 3 });                                           // 노랑 차례가 아님
  for (const bad of [-1, 7, 99, 'x', 3.5, null]) send(red, 'place', { c: bad });
  send(red, 'place', {});
  await sleep(300);
  assert.strictEqual(red.room.moves.length, 0, 'nothing was accepted');
  for (let k = 0; k < 6; k++) await play(a, b, 0);                           // 0열을 가득 채운다
  const before = a.room.moves.length;
  send(mine(a, b), 'place', { c: 0 });                                       // 꽉 찬 열
  await sleep(300);
  assert.strictEqual(a.room.moves.length, before, 'a full column is refused');
  await play(a, b, 1);
  assert.strictEqual(boardOf(a.room)[R.idx(5, 1)], R.RED === a.room.turn ? R.YELLOW : R.RED, 'the disc fell to the bottom of its column');
  a.ws.close(); b.ws.close();
});

test('four in a column wins for red and reports the winning line', async () => {
  await ready;
  const [a, b] = await pair();
  for (const c of [0, 1, 0, 1, 0, 1, 0]) await play(a, b, c);
  assert.ok(await until(() => a.room.state === 'over' && b.room.state === 'over'));
  assert.strictEqual(a.room.reason, 'connect');
  assert.strictEqual(a.room.winner, R.RED);
  assert.strictEqual(a.room.line.length, 4);
  assert.deepStrictEqual(a.room.line.map((i) => i % 7), [0, 0, 0, 0]);
  const final = boardOf(a.room);
  assert.ok(a.room.line.every((i) => final[i] === R.RED));
  send(mine(a, b), 'place', { c: 2 });                                       // 끝난 뒤에는 둘 수 없다
  await sleep(250);
  assert.strictEqual(a.room.moves.length, 7);
  a.ws.close(); b.ws.close();
});

test('a full board without four in a row is a draw', async () => {
  await ready;
  const DRAW = [1, 3, 0, 3, 3, 5, 6, 0, 1, 3, 3, 3, 2, 5, 0, 4, 5, 6, 6, 2, 2, 2, 5, 6, 6, 1, 4, 6, 2, 4, 0, 2, 4, 4, 1, 0, 1, 5, 4, 5, 1, 0];
  const [a, b] = await pair();
  for (const c of DRAW) await play(a, b, c);
  assert.ok(await until(() => a.room.state === 'over' && b.room.state === 'over'));
  assert.strictEqual(a.room.reason, 'draw');
  assert.strictEqual(a.room.winner, 0);
  assert.ok(R.isFull(boardOf(a.room)));
  a.ws.close(); b.ws.close();
});

test('random full games end with a correct winner or a draw', async () => {
  await ready;
  for (let g = 0; g < 4; g++) {
    const [a, b] = await pair();
    for (let guard = 0; guard < 60 && !(a.room.state === 'over' && b.room.state === 'over'); guard++) {
      const mover = mine(a, b), cols = R.legalCols(boardOf(mover.room));
      assert.ok(cols.length > 0, 'the player on move always has a legal column');
      const before = mover.room.moves.length;
      send(mover, 'place', { c: cols[Math.floor(Math.random() * cols.length)] });
      assert.ok(await until(() => (a.room.moves.length > before && b.room.moves.length > before) || (a.room.state === 'over' && b.room.state === 'over')));
    }
    assert.strictEqual(a.room.state, 'over');
    const final = boardOf(a.room), win = R.findWin(final);
    if (win) { assert.strictEqual(a.room.reason, 'connect'); assert.strictEqual(a.room.winner, win.p); } else { assert.strictEqual(a.room.reason, 'draw'); assert.ok(R.isFull(final)); }
    a.ws.close(); b.ws.close();
  }
});

test('resigning ends the game and rematch swaps colors', async () => {
  await ready;
  const [a, b] = await pair();
  const colorA = a.room.you;
  send(a, 'resign');
  assert.ok(await until(() => b.room.state === 'over'));
  assert.strictEqual(b.room.reason, 'resign');
  assert.strictEqual(b.room.winner, b.room.you);
  send(a, 'rematch'); send(b, 'rematch');
  assert.ok(await until(() => a.room.state === 'playing' && a.room.moves.length === 0));
  assert.notStrictEqual(a.room.you, colorA, 'colors swap on a rematch');
  assert.strictEqual(a.room.turn, R.RED);
  a.ws.close(); b.ws.close();
});

test('running out of time loses the game', async () => {
  await ready;
  const [a, b] = await pair();
  assert.ok(await until(() => a.room.state === 'over', 4000), 'the timer fires');
  assert.strictEqual(a.room.reason, 'timeout');
  assert.strictEqual(a.room.winner, R.YELLOW, 'red was on move, so yellow wins');
  a.ws.close(); b.ws.close();
});

test('private rooms: create, join by code, and a third player is turned away', async () => {
  await ready;
  const a = await open(), b = await open(), c = await open();
  send(a, 'create');
  assert.ok(await until(() => a.room && a.room.code));
  assert.strictEqual(a.room.state, 'waiting');
  send(b, 'join', { code: a.room.code.toLowerCase() });
  assert.ok(await until(() => a.room.state === 'playing' && b.room && b.room.state === 'playing'));
  send(c, 'join', { code: a.room.code });
  assert.ok(await until(() => c.errors.length > 0));
  assert.match(c.errors[0], /이미 두 사람/);
  a.ws.close(); b.ws.close(); c.ws.close();
});

test('a dropped player can resume the same seat with the token', async () => {
  await ready;
  const [a, b] = await pair();
  const token = a.room.token, code = a.room.code, you = a.room.you;
  a.ws.close();
  assert.ok(await until(() => b.room.players.some((p) => !p.online)), 'the other side sees the drop');
  const a2 = await open();
  send(a2, 'resume', { code, token });
  assert.ok(await until(() => a2.room && a2.room.you === you && a2.room.state === 'playing'));
  assert.ok(await until(() => b.room.players.every((p) => p.online)));
  a2.ws.close(); b.ws.close();
});

// 같은 주소에서 코드를 일부러 많이 틀리므로 이 시험은 맨 뒤에 둔다 (뒤의 시험이 막히지 않게)
test('repeated wrong room codes get temporarily blocked', async () => {
  await ready;
  const c = await open();
  for (let i = 0; i < 10; i++) c.ws.send(JSON.stringify({ t: 'join', code: 'ZZZ' + 'ABCDEFGH'[i] }));
  await sleep(500);
  assert.ok(c.errors.some((x) => /그런 방이 없어요/.test(x)), 'first attempts are answered with room-not-found');
  assert.ok(c.errors.some((x) => /너무 많이 틀렸어요/.test(x)), 'many wrong codes get blocked');
  c.ws.close();
});

test('shutdown', () => { child.kill(); });
