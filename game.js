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

// ---- Visual skins ----
// Each skin defines its own 7-color palette (index 0 is null/empty) and a
// `style` that drawBlock() branches on to render the canvas blocks.
const SKINS = {
  retro: {
    name: 'Retro',
    style: 'flat',
    palette: COLORS, // current default palette
  },
  neon: {
    name: 'Neon',
    style: 'neon',
    palette: [null, '#00f0ff', '#ffe600', '#ff00e5', '#00ff66', '#ff0033', '#3399ff', '#ff9100'],
  },
  pastel: {
    name: 'Pastel',
    style: 'pastel',
    palette: [null, '#a8e6e3', '#fff2b3', '#e0c3f0', '#c3e8c8', '#f5c3c3', '#bcd4f0', '#ffd9a8'],
  },
  pixel: {
    name: 'Pixel-art',
    style: 'pixel',
    palette: [null, '#2bb3c0', '#d9b53f', '#9e51b8', '#5fa86a', '#c95151', '#4a82c0', '#d68f3a'],
  },
};

let activeSkin = 'retro';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const gravityBtn = document.getElementById('gravity-btn');
const gameoverBox = document.getElementById('gameover-box');
const pauseMenu = document.getElementById('pause-menu');
const resumeBtn = document.getElementById('resume-btn');
const menuRestartBtn = document.getElementById('menu-restart-btn');
const controlsBtn = document.getElementById('controls-btn');
const menuControls = document.getElementById('menu-controls');
const startLevelSelect = document.getElementById('start-level-select');
const nameEntry = document.getElementById('name-entry');
const nameInput = document.getElementById('name-input');
const saveScoreBtn = document.getElementById('save-score-btn');
const resetRecordsBtn = document.getElementById('reset-records-btn');
const recordsEl = document.getElementById('records');
const recordsBody = document.getElementById('records-body');
const overlayActions = document.querySelector('.overlay-actions');
const bestComboEl = document.getElementById('best-combo');
const maxLinesEl = document.getElementById('max-lines');

const RECORDS_KEY = 'tetris-records';
const MAX_RECORDS = 5;
const DEFAULT_NAME = 'ANON';

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let gravityCharges, gravityFlashAlpha, gravityAnimating;
let startLevel = 1;
let combo, bestComboThisRun, scoreSaved, started;

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
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    if (lines % 3 === 0) gravityCharges = Math.min(3, gravityCharges + 1);
    combo++;
    if (combo > bestComboThisRun) bestComboThisRun = combo;
    updateHUD();
    updateGravityUI();
  } else {
    combo = 0;
  }
}

function applyGravityCompact() {
  for (let c = 0; c < COLS; c++) {
    const blocks = [];
    for (let r = 0; r < ROWS; r++) {
      if (board[r][c] !== 0) blocks.push(board[r][c]);
    }
    for (let r = 0; r < ROWS; r++) {
      board[r][c] = r < ROWS - blocks.length ? 0 : blocks[r - (ROWS - blocks.length)];
    }
  }
}

function clearLinesCombo() {
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
    score += (LINE_SCORES[cleared] || 0) * level * 2;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    combo++;
    if (combo > bestComboThisRun) bestComboThisRun = combo;
    updateHUD();
  }
}

function updateGravityUI() {
  gravityBtn.textContent = `GRAVEDAD [${gravityCharges}]`;
  gravityBtn.disabled = gravityCharges === 0 || paused || gameOver || gravityAnimating;
}

function activateGravity() {
  if (gravityCharges <= 0 || paused || gameOver || gravityAnimating) return;
  gravityCharges--;
  gravityAnimating = true;
  gravityFlashAlpha = 0.55;
  updateGravityUI();
  setTimeout(() => {
    applyGravityCompact();
    clearLinesCombo();
    gravityFlashAlpha = 0.25;
    setTimeout(() => {
      gravityFlashAlpha = 0;
      gravityAnimating = false;
      updateGravityUI();
    }, 200);
  }, 200);
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
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const skin = SKINS[activeSkin] || SKINS.retro;
  const color = skin.palette[colorIndex];
  const px = x * size + 1;
  const py = y * size + 1;
  const s = size - 2;

  context.save();
  context.globalAlpha = alpha ?? 1;

  switch (skin.style) {
    case 'neon': {
      // Dark block body with a saturated colored glow.
      context.shadowColor = color;
      context.shadowBlur = 8;
      context.fillStyle = '#0a0a0a';
      context.fillRect(px, py, s, s);
      // Bright inner core so the color reads through the glow.
      context.shadowBlur = 12;
      context.fillStyle = color;
      context.fillRect(px + 3, py + 3, s - 6, s - 6);
      context.shadowBlur = 0;
      break;
    }
    case 'pastel': {
      // Soft fill with rounded corners.
      const r = Math.max(2, Math.floor(size * 0.2));
      context.fillStyle = color;
      context.beginPath();
      if (typeof context.roundRect === 'function') {
        context.roundRect(px, py, s, s, r);
      } else {
        context.rect(px, py, s, s);
      }
      context.fill();
      // Gentle highlight stripe.
      context.fillStyle = 'rgba(255,255,255,0.25)';
      context.fillRect(px + r, py + 2, s - 2 * r, 3);
      break;
    }
    case 'pixel': {
      // Flat fill plus a darker dithered inner grid for a pixelated look.
      context.fillStyle = color;
      context.fillRect(px, py, s, s);
      context.fillStyle = 'rgba(0,0,0,0.22)';
      const cell = Math.max(3, Math.floor(size / 6));
      for (let gy = 0; gy < s; gy += cell) {
        for (let gx = 0; gx < s; gx += cell) {
          // Checkerboard dithering.
          if (((gx / cell) + (gy / cell)) % 2 === 0) {
            context.fillRect(px + gx, py + gy, Math.min(cell, s - gx), Math.min(cell, s - gy));
          }
        }
      }
      // Light top-left edge for depth.
      context.fillStyle = 'rgba(255,255,255,0.18)';
      context.fillRect(px, py, s, 2);
      context.fillRect(px, py, 2, s);
      break;
    }
    case 'flat':
    default: {
      // Original Retro look: flat square + white highlight stripe.
      context.fillStyle = color;
      context.fillRect(px, py, s, s);
      context.fillStyle = 'rgba(255,255,255,0.12)';
      context.fillRect(px, py, s, 4);
      break;
    }
  }

  context.restore();
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
  if (gravityFlashAlpha > 0) {
    ctx.fillStyle = `rgba(100, 120, 255, ${gravityFlashAlpha})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
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

// ---- Records ----
function loadRecords() {
  try {
    const data = JSON.parse(localStorage.getItem(RECORDS_KEY));
    if (data && Array.isArray(data.scores)) {
      return {
        scores: data.scores,
        bestCombo: data.bestCombo || 0,
        maxLines: data.maxLines || 0,
      };
    }
  } catch (e) { /* ignore corrupt data */ }
  return { scores: [], bestCombo: 0, maxLines: 0 };
}

function saveRecords(records) {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

function qualifies(records, s) {
  if (s <= 0) return false;
  if (records.scores.length < MAX_RECORDS) return true;
  return s > records.scores[records.scores.length - 1].score;
}

function renderRecords(records, highlightIndex) {
  recordsBody.innerHTML = '';
  if (records.scores.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'records-empty';
    const td = document.createElement('td');
    td.colSpan = 4;
    td.textContent = 'Sin récords aún';
    tr.appendChild(td);
    recordsBody.appendChild(tr);
  } else {
    records.scores.forEach((entry, i) => {
      const tr = document.createElement('tr');
      if (i === highlightIndex) tr.className = 'highlight';
      const cells = [
        String(i + 1),
        entry.name,
        Number(entry.score).toLocaleString(),
        String(entry.lines),
      ];
      cells.forEach(text => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      recordsBody.appendChild(tr);
    });
  }
  bestComboEl.textContent = records.bestCombo;
  maxLinesEl.textContent = records.maxLines;
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  updateGravityUI();

  const records = loadRecords();
  if (bestComboThisRun > records.bestCombo) records.bestCombo = bestComboThisRun;
  if (lines > records.maxLines) records.maxLines = lines;
  saveRecords(records);

  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  pauseMenu.classList.add('hidden');
  gameoverBox.classList.remove('hidden');
  recordsEl.classList.remove('hidden');
  overlayActions.classList.remove('hidden');
  scoreSaved = false;

  if (qualifies(records, score)) {
    nameEntry.classList.remove('hidden');
    nameInput.value = '';
  } else {
    nameEntry.classList.add('hidden');
  }
  renderRecords(records, -1);
  overlay.classList.remove('hidden');
}

function saveScore() {
  if (scoreSaved) return;
  const records = loadRecords();
  if (!qualifies(records, score)) return;
  const name = (nameInput.value.trim() || DEFAULT_NAME).toUpperCase().slice(0, 8);
  const entry = { name, score, lines };
  records.scores.push(entry);
  records.scores.sort((a, b) => b.score - a.score);
  records.scores = records.scores.slice(0, MAX_RECORDS);
  saveRecords(records);
  scoreSaved = true;
  const idx = records.scores.indexOf(entry);
  nameEntry.classList.add('hidden');
  renderRecords(records, idx);
}

function showStartScreen() {
  const records = loadRecords();
  renderRecords(records, -1);
  overlayTitle.textContent = 'TETRIS';
  overlayScore.textContent = '';
  nameEntry.classList.add('hidden');
  recordsEl.classList.remove('hidden');
  overlayActions.classList.remove('hidden');
  restartBtn.textContent = 'Jugar';
  overlay.classList.remove('hidden');
}

function resetRecords() {
  localStorage.removeItem(RECORDS_KEY);
  renderRecords(loadRecords(), -1);
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    overlay.classList.add('hidden');
    pauseMenu.classList.add('hidden');
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    gameoverBox.classList.add('hidden');
    menuControls.classList.add('hidden');
    pauseMenu.classList.remove('hidden');
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
  level = startLevel;
  paused = false;
  gameOver = false;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  dropAccum = 0;
  combo = 0;
  bestComboThisRun = 0;
  scoreSaved = false;
  started = true;
  lastTime = performance.now();
  gravityCharges = 0;
  gravityFlashAlpha = 0;
  gravityAnimating = false;
  next = randomPiece();
  spawn();
  updateHUD();
  updateGravityUI();
  restartBtn.textContent = 'Reiniciar';
  overlay.classList.add('hidden');
  pauseMenu.classList.add('hidden');
  menuControls.classList.add('hidden');
  gameoverBox.classList.remove('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (!started || gameOver) return;
  if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); return; }
  if (paused) return;
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
    case 'KeyG':
      activateGravity();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);
gravityBtn.addEventListener('click', activateGravity);

// ---- Pause menu ----
resumeBtn.addEventListener('click', () => {
  if (paused) togglePause();
});

menuRestartBtn.addEventListener('click', init);

controlsBtn.addEventListener('click', () => {
  menuControls.classList.toggle('hidden');
});

startLevelSelect.addEventListener('change', () => {
  startLevel = Math.min(10, Math.max(1, parseInt(startLevelSelect.value, 10) || 1));
});

// ---- Records ----
saveScoreBtn.addEventListener('click', saveScore);
nameInput.addEventListener('keydown', e => {
  if (e.code === 'Enter') { e.preventDefault(); saveScore(); }
});
resetRecordsBtn.addEventListener('click', resetRecords);

started = false;
showStartScreen();

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

// ---- Skin selector ----
const skinSelect = document.getElementById('skin-select');

function applySkin(skin) {
  if (!SKINS[skin]) skin = 'retro';
  activeSkin = skin;
  if (skinSelect) skinSelect.value = skin;
  // Re-render immediately with the new palette/style, but only once the game
  // has been initialized — at load time the start screen is shown and the
  // board/current piece don't exist yet.
  if (board && current) {
    draw();
    drawNext();
  }
}

if (skinSelect) {
  skinSelect.addEventListener('change', () => {
    const skin = skinSelect.value;
    localStorage.setItem('tetris-skin', skin);
    applySkin(skin);
  });
}

applySkin(localStorage.getItem('tetris-skin') || 'retro');
