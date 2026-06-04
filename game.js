'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#5b9bd5', // J - pale blue
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const comboEl = document.getElementById('combo');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const recordEntry = document.getElementById('record-entry');
const playerNameInput = document.getElementById('player-name');
const saveRecordBtn = document.getElementById('save-record-btn');
const overlayRecords = document.getElementById('overlay-records');
const overlayRecordsBody = document.getElementById('overlay-records-body');
const recordsBody = document.getElementById('records-body');
const resetRecordsBtn = document.getElementById('reset-records-btn');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let combo, maxCombo, maxLinesClear;

// ---- Records ----

const RECORDS_KEY = 'tetris-records';
const MAX_RECORDS = 5;

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY)) || [];
  } catch {
    return [];
  }
}

function isNewRecord(s) {
  const records = loadRecords();
  return records.length < MAX_RECORDS || s > records[records.length - 1].score;
}

function saveRecord(name, s, c, ml) {
  const records = loadRecords();
  records.push({ name: name.trim() || 'AAA', score: s, combo: c, maxLines: ml });
  records.sort((a, b) => b.score - a.score);
  const trimmed = records.slice(0, MAX_RECORDS);
  localStorage.setItem(RECORDS_KEY, JSON.stringify(trimmed));
  return trimmed;
}

function renderRecordsInto(tbody, highlightScore) {
  const records = loadRecords();
  tbody.innerHTML = '';
  if (!records.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5" class="no-records">Sin registros aún</td>';
    tbody.appendChild(tr);
    return;
  }
  records.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (highlightScore !== null && r.score === highlightScore && !tr.classList.contains('record-highlight-done')) {
      tr.classList.add('record-highlight');
      highlightScore = null; // highlight only the first match
    }
    tr.innerHTML = `
      <td class="rank">${i + 1}</td>
      <td class="rec-name">${escapeHtml(r.name)}</td>
      <td class="rec-score">${r.score.toLocaleString()}</td>
      <td class="rec-combo">${r.combo}x</td>
      <td class="rec-lines">${r.maxLines}</td>
    `;
    tbody.appendChild(tr);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function refreshMainRecords() {
  renderRecordsInto(recordsBody, null);
}

// ---- Game logic ----

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    if (cleared > maxLinesClear) maxLinesClear = cleared;
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  } else {
    combo = 0;
  }
  updateHUD();
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  comboEl.textContent = combo;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid-color').trim();
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function showGameOverOverlay() {
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Score: ${score.toLocaleString()} · Combo: ${maxCombo}x · Líneas: ${maxLinesClear}`;

  if (isNewRecord(score)) {
    recordEntry.classList.remove('hidden');
    playerNameInput.value = '';
    playerNameInput.focus();
    overlayRecords.classList.add('hidden');
  } else {
    recordEntry.classList.add('hidden');
    renderRecordsInto(overlayRecordsBody, null);
    overlayRecords.classList.remove('hidden');
  }

  overlay.classList.remove('hidden');
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  showGameOverOverlay();
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    recordEntry.classList.add('hidden');
    overlayRecords.classList.add('hidden');
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (!gameOver) {
    animId = requestAnimationFrame(loop);
  }
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  combo = 0;
  maxCombo = 0;
  maxLinesClear = 0;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  recordEntry.classList.add('hidden');
  overlayRecords.classList.add('hidden');
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

// ---- Event handlers ----

saveRecordBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim() || 'AAA';
  saveRecord(name, score, maxCombo, maxLinesClear);
  recordEntry.classList.add('hidden');
  renderRecordsInto(overlayRecordsBody, score);
  overlayRecords.classList.remove('hidden');
  refreshMainRecords();
});

playerNameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') saveRecordBtn.click();
});

restartBtn.addEventListener('click', init);

resetRecordsBtn.addEventListener('click', () => {
  localStorage.removeItem(RECORDS_KEY);
  refreshMainRecords();
  if (gameOver) {
    overlayRecords.classList.add('hidden');
  }
});

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

init();
refreshMainRecords();

// ---- Theme toggle ----
const themeToggleBtn = document.getElementById('theme-toggle');

function applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('light-mode');
    themeToggleBtn.textContent = '🌙 Dark';
  } else {
    document.body.classList.remove('light-mode');
    themeToggleBtn.textContent = '☀ Light';
  }
}

themeToggleBtn.addEventListener('click', () => {
  const next = document.body.classList.contains('light-mode') ? 'dark' : 'light';
  localStorage.setItem('theme', next);
  applyTheme(next);
});

applyTheme(localStorage.getItem('theme') || 'dark');
