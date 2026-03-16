"ui";

/**
 * Auto.js script for 8x8 block puzzle auto-play.
 *
 * ВАЖНО:
 * - Работает на основании скриншота и калибровки координат.
 * - Не гарантирует "бесконечную" игру: это эвристический бот, который стремится играть долго.
 * - Требуются разрешения Accessibility + Screenshot.
 */

auto.waitFor();
if (!requestScreenCapture()) {
  toast("Не удалось получить разрешение на скриншот");
  exit();
}

const CONFIG = {
  loopDelayMs: 450,
  dragDurationMs: 120,

  // Калибровка под ваш скриншот/устройство.
  // 8x8 поле.
  board: {
    left: 46,
    top: 545,
    size: 709,
    grid: 8,
  },

  // Центры трех слотов фигур внизу (слева направо).
  pieceSlots: [
    { x: 119, y: 1897 },
    { x: 405, y: 1897 },
    { x: 691, y: 1897 },
  ],

  // Области, где лежат фигуры (для распознавания масок), 5x5 max окно.
  pieceScanBoxes: [
    { left: 40, top: 1780, size: 170 },
    { left: 320, top: 1780, size: 170 },
    { left: 600, top: 1780, size: 170 },
  ],

  // Цвета нужно подстроить через color picker (Auto.js).
  boardFillColor: "#28337e",      // занятой клетки
  boardEmptyColor: "#3f4a9b",     // пустой клетки
  pieceFillColor: "#b86df6",      // цвет клетки фигуры (можно заменить на мультитон)
  colorThreshold: 42,
};

const SHAPES = [
  // Базовый каталог для fallback-распознавания, если по маске не получилось.
  [[0,0]],
  [[0,0],[1,0]],
  [[0,0],[0,1]],
  [[0,0],[1,0],[2,0]],
  [[0,0],[0,1],[0,2]],
  [[0,0],[1,0],[0,1],[1,1]],
  [[0,0],[1,0],[2,0],[0,1]],
  [[0,0],[1,0],[2,0],[2,1]],
  [[0,0],[0,1],[1,1],[2,1]],
  [[2,0],[0,1],[1,1],[2,1]],
  [[0,0],[0,1],[0,2],[1,2]],
  [[1,0],[1,1],[1,2],[0,2]],
  [[0,0],[1,0],[1,1],[2,1]],
  [[1,0],[2,0],[0,1],[1,1]],
  [[0,0],[1,0],[2,0],[1,1]],
  [[1,0],[0,1],[1,1],[2,1]],
  [[0,0],[0,1],[0,2],[1,1]],
  [[1,0],[1,1],[1,2],[0,1]],
  [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]],
  [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1],[0,2],[1,2],[2,2]],
];

function colorNear(c1, c2, threshold) {
  const r1 = colors.red(c1), g1 = colors.green(c1), b1 = colors.blue(c1);
  const r2 = colors.red(c2), g2 = colors.green(c2), b2 = colors.blue(c2);
  return Math.abs(r1-r2) + Math.abs(g1-g2) + Math.abs(b1-b2) <= threshold;
}

function captureBoard(img) {
  const { left, top, size, grid } = CONFIG.board;
  const cell = size / grid;
  const board = [];
  const fill = colors.parseColor(CONFIG.boardFillColor);

  for (let y = 0; y < grid; y++) {
    board[y] = [];
    for (let x = 0; x < grid; x++) {
      const px = Math.floor(left + x * cell + cell * 0.5);
      const py = Math.floor(top + y * cell + cell * 0.5);
      const c = images.pixel(img, px, py);
      board[y][x] = colorNear(c, fill, CONFIG.colorThreshold);
    }
  }
  return board;
}

function detectPieceMask(img, box) {
  // Возвращает список координат блоков фигуры в нормализованной 5x5 сетке.
  const grid = 5;
  const cell = box.size / grid;
  const fill = colors.parseColor(CONFIG.pieceFillColor);
  const pts = [];

  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const px = Math.floor(box.left + x * cell + cell * 0.5);
      const py = Math.floor(box.top + y * cell + cell * 0.5);
      const c = images.pixel(img, px, py);
      if (colorNear(c, fill, CONFIG.colorThreshold)) {
        pts.push([x, y]);
      }
    }
  }

  if (!pts.length) return null;

  // Нормализуем влево/вверх.
  let minX = 99, minY = 99;
  pts.forEach(p => { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); });
  return pts.map(p => [p[0]-minX, p[1]-minY]);
}

function maskEquals(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const sa = a.map(p => `${p[0]},${p[1]}`).sort().join(";");
  const sb = b.map(p => `${p[0]},${p[1]}`).sort().join(";");
  return sa === sb;
}

function detectPieces(img) {
  const pieces = [];
  for (let i = 0; i < 3; i++) {
    const mask = detectPieceMask(img, CONFIG.pieceScanBoxes[i]);
    if (mask && mask.length > 0) {
      pieces.push(mask);
    } else {
      pieces.push(null);
    }
  }

  // Fallback: если маска шумная, пытаемся подобрать ближайшую известную фигуру по размеру.
  for (let i = 0; i < 3; i++) {
    const p = pieces[i];
    if (!p) continue;
    const exact = SHAPES.find(s => maskEquals(p, s));
    if (!exact) {
      const byLen = SHAPES.filter(s => s.length === p.length);
      pieces[i] = byLen.length ? byLen[0] : p;
    }
  }
  return pieces;
}

function cloneBoard(board) {
  return board.map(r => r.slice());
}

function canPlace(board, piece, ox, oy) {
  for (const [dx, dy] of piece) {
    const x = ox + dx;
    const y = oy + dy;
    if (x < 0 || y < 0 || x >= 8 || y >= 8) return false;
    if (board[y][x]) return false;
  }
  return true;
}

function placeAndClear(board, piece, ox, oy) {
  const b = cloneBoard(board);
  for (const [dx, dy] of piece) b[oy + dy][ox + dx] = true;

  const fullRows = [];
  const fullCols = [];
  for (let y = 0; y < 8; y++) if (b[y].every(v => v)) fullRows.push(y);
  for (let x = 0; x < 8; x++) {
    let ok = true;
    for (let y = 0; y < 8; y++) if (!b[y][x]) { ok = false; break; }
    if (ok) fullCols.push(x);
  }

  for (const y of fullRows) for (let x = 0; x < 8; x++) b[y][x] = false;
  for (const x of fullCols) for (let y = 0; y < 8; y++) b[y][x] = false;

  const lines = fullRows.length + fullCols.length;
  return { board: b, lines };
}

function scoreBoard(board, lines) {
  // Эвристика: линии + свободные клетки + штраф за дыры в центре.
  let empties = 0;
  let centerBusy = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (!board[y][x]) empties++;
      if (x >= 2 && x <= 5 && y >= 2 && y <= 5 && board[y][x]) centerBusy++;
    }
  }
  return lines * 120 + empties * 2 - centerBusy;
}

function bestMove(board, piece) {
  if (!piece) return null;
  let best = null;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (!canPlace(board, piece, x, y)) continue;
      const { board: nb, lines } = placeAndClear(board, piece, x, y);
      const s = scoreBoard(nb, lines);
      if (!best || s > best.score) best = { x, y, score: s, nextBoard: nb, lines };
    }
  }
  return best;
}

function boardCellCenter(x, y) {
  const { left, top, size, grid } = CONFIG.board;
  const cell = size / grid;
  return {
    x: Math.floor(left + x * cell + cell / 2),
    y: Math.floor(top + y * cell + cell / 2),
  };
}

function performDrag(slotIndex, x, y) {
  const from = CONFIG.pieceSlots[slotIndex];
  const to = boardCellCenter(x, y);
  gesture(CONFIG.dragDurationMs, [from.x, from.y], [to.x, to.y]);
}

function anyMovePossible(board, pieces) {
  for (const p of pieces) {
    if (!p) continue;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (canPlace(board, p, x, y)) return true;
      }
    }
  }
  return false;
}

function mainLoop() {
  toast("Бот запущен");
  sleep(1000);

  while (true) {
    const img = captureScreen();
    const board = captureBoard(img);
    const pieces = detectPieces(img);

    if (!anyMovePossible(board, pieces)) {
      toast("Ходы закончились. Ожидание/restart...");
      sleep(2500);
      continue;
    }

    // Жадная стратегия: берем лучший из 3 доступных текущих ходов.
    let chosen = null;
    for (let i = 0; i < 3; i++) {
      const mv = bestMove(board, pieces[i]);
      if (!mv) continue;
      if (!chosen || mv.score > chosen.move.score) {
        chosen = { index: i, move: mv };
      }
    }

    if (!chosen) {
      sleep(CONFIG.loopDelayMs);
      continue;
    }

    performDrag(chosen.index, chosen.move.x, chosen.move.y);
    sleep(CONFIG.loopDelayMs);
  }
}

setScreenMetrics(device.width, device.height);
mainLoop();
