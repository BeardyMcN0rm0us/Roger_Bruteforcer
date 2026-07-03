/* Beardy's Battle Chess — app shell: screens, board UI, game flow. */
(function () {
  'use strict';

  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, parent) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (parent) parent.appendChild(d);
    return d;
  }

  /* ---------- screens ---------- */

  function show(id) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.classList.toggle('active', s.id === id);
    });
    if (id === 'screen-menu') renderMenu();
    if (id === 'screen-opponents') renderOpponents();
    if (id === 'screen-academy') renderAcademy();
    if (id === 'screen-puzzles') renderPuzzles();
  }

  /* ---------- game context ---------- */

  var G = null;
  /* G = { state, mode: 'ai'|'2p'|'lesson'|'puzzle', opponent, lesson, puzzle,
   *       playerColor, flipped, history: [state...], captured: {w:[],b:[]},
   *       moveCount, over, busy, loose, selected, targets } */

  var cells = [];   // 64 cell divs
  var pieceLayer;

  function dispRC(i) {
    var p = Engine.rc(i);
    return G && G.flipped ? { r: 7 - p.r, c: 7 - p.c } : p;
  }

  function buildBoard() {
    var grid = $('#board-cells');
    grid.innerHTML = '';
    cells = [];
    for (var i = 0; i < 64; i++) {
      var p = Engine.rc(i);
      var c = el('div', 'cell ' + (((p.r + p.c) % 2) ? 'dark' : 'light'), grid);
      c.dataset.i = i;
      c.addEventListener('pointerdown', onCell);
      cells.push(c);
    }
    pieceLayer = $('#board-pieces');
    layoutCells();
  }

  function layoutCells() {
    for (var i = 0; i < 64; i++) {
      var d = dispRC(i);
      cells[i].style.left = (d.c * 12.5) + '%';
      cells[i].style.top = (d.r * 12.5) + '%';
      cells[i].innerHTML = '';
      // coordinate labels on the display edges
      var name = Engine.sqName(i);
      if (d.r === 7) el('span', 'coord coord-f', cells[i]).textContent = name[0];
      if (d.c === 0) el('span', 'coord coord-r', cells[i]).textContent = name[1];
    }
  }

  function positionPiece(node, i) {
    var d = dispRC(i);
    node.style.left = (d.c * 12.5) + '%';
    node.style.top = (d.r * 12.5) + '%';
  }

  function renderPieces() {
    pieceLayer.innerHTML = '';
    for (var i = 0; i < 64; i++) {
      var p = G.state.board[i];
      if (!p) continue;
      var node = el('div', 'piece', pieceLayer);
      node.dataset.i = i;
      node.innerHTML = Characters.svg(p.type, p.color);
      node.querySelector('.body-root').style.animationDelay = (-(i % 7) * 0.3) + 's';
      positionPiece(node, i);
    }
  }

  function pieceAt(i) {
    return pieceLayer.querySelector('.piece[data-i="' + i + '"]');
  }

  function clearMarks() {
    cells.forEach(function (c) {
      c.classList.remove('sel', 'move', 'take', 'last', 'check', 'hint');
    });
  }

  function markLast(move) {
    if (!move) return;
    cells[move.from].classList.add('last');
    cells[move.to].classList.add('last');
  }

  function markCheck() {
    if (Engine.inCheck(G.state, G.state.turn)) {
      var k = Engine.findKing(G.state.board, G.state.turn);
      if (k >= 0) cells[k].classList.add('check');
    }
  }

  /* ---------- HUD ---------- */

  function setStatus(html) { $('#game-status').innerHTML = html; }

  function updateHud(lastMove) {
    clearMarks();
    markLast(lastMove);
    markCheck();
    renderCaptured();
    if (G.over) return;
    if (G.mode === 'lesson' && G.lesson.kind === 'captureAll') {
      setStatus('<b>' + G.lesson.name + '</b> &middot; Moves: ' + G.moveCount +
        ' / par ' + G.lesson.par);
      return;
    }
    if (G.mode === 'lesson' || G.mode === 'puzzle') {
      setStatus('<b>Find the checkmate!</b> One move wins it.');
      return;
    }
    var turnName;
    if (G.mode === '2p') {
      turnName = G.state.turn === 'w' ? 'Blue' : 'Red';
      setStatus('<b>' + turnName + '</b> to move');
    } else {
      setStatus(G.state.turn === G.playerColor ? '<b>Your move</b>'
        : '<b>' + G.opponent.name + '</b> is thinking<span class="dots"></span>');
    }
  }

  function renderCaptured() {
    ['w', 'b'].forEach(function (color) {
      var tray = $('#captured-' + color);
      tray.innerHTML = '';
      G.captured[color].forEach(function (t) {
        var m = el('div', 'mini', tray);
        m.innerHTML = Characters.svg(t, color, 'mini-dead');
      });
    });
  }

  /* ---------- interaction ---------- */

  function legalFor(i) {
    return Engine.legalMoves(G.state, i, G.loose);
  }

  function onCell(ev) {
    if (!G || G.busy || G.over) return;
    var i = parseInt(ev.currentTarget.dataset.i, 10);
    var piece = G.state.board[i];
    var humanTurn = G.mode === '2p' || G.mode === 'lesson' || G.mode === 'puzzle' ||
      G.state.turn === G.playerColor;
    if (!humanTurn) return;

    if (G.selected != null) {
      var mv = G.targets.filter(function (m) { return m.to === i; });
      if (mv.length) {
        var chosen = mv[0];
        if (mv.length > 1) { promoPicker(mv, doPlayerMove); deselect(); return; }
        deselect();
        doPlayerMove(chosen);
        return;
      }
      deselect();
      if (piece && piece.color === G.state.turn) select(i);
      return;
    }
    if (piece && piece.color === G.state.turn) select(i);
  }

  function select(i) {
    G.selected = i;
    G.targets = legalFor(i);
    if (!G.targets.length) { G.selected = null; return; }
    Sound.play('select');
    cells[i].classList.add('sel');
    G.targets.forEach(function (m) {
      cells[m.to].classList.add(m.captured ? 'take' : 'move');
    });
  }

  function deselect() {
    G.selected = null;
    G.targets = [];
    clearMarks();
    markCheck();
  }

  function promoPicker(moves, cb) {
    var layer = $('#modal-layer');
    layer.innerHTML = '';
    var ov = el('div', 'modal-overlay show', layer);
    var box = el('div', 'modal promo', ov);
    el('h3', null, box).textContent = 'Promote your pawn!';
    var row = el('div', 'promo-row', box);
    moves.forEach(function (m) {
      var b = el('button', 'promo-btn', row);
      b.innerHTML = Characters.svg(m.promo, m.color) +
        '<span>' + Characters.NAMES[m.promo] + '</span>';
      b.addEventListener('click', function () {
        layer.innerHTML = '';
        cb(m);
      });
    });
  }

  /* ---------- moves & animation ---------- */

  function slide(node, to) {
    return new Promise(function (res) {
      positionPiece(node, to);
      setTimeout(res, 300);
    });
  }

  function animateMove(move) {
    G.busy = true;
    clearMarks();
    var attacker = G.state.board[move.from];
    var victimSq = move.ep ? move.to + (attacker.color === 'w' ? 8 : -8) : move.to;
    var victim = move.captured ? G.state.board[victimSq] || { type: move.captured, color: attacker.color === 'w' ? 'b' : 'w' } : null;
    var node = pieceAt(move.from);
    var seq = Promise.resolve();

    Sound.play('move');
    if (node) {
      node.style.zIndex = 40;
      seq = seq.then(function () { return slide(node, move.to); });
    }
    if (move.castle) {
      var home = attacker.color === 'w' ? 7 : 0;
      var rookFrom = Engine.idx(home, move.castle === 'K' ? 7 : 0);
      var rookNode = pieceAt(rookFrom);
      if (rookNode) slide(rookNode, Engine.idx(home, move.castle === 'K' ? 5 : 3));
    }
    if (victim) {
      seq = seq.then(function () { return Battle.fight(attacker, victim); });
    }
    return seq.then(function () {
      if (victim) {
        G.captured[victim.color].push(victim.type);
        Battle.squareSplat(cells[victimSq]);
      }
      G.history.push(G.state);
      G.state = Engine.makeMove(G.state, move);
      renderPieces();
      G.busy = false;
      return move;
    });
  }

  /* ---------- game flow ---------- */

  function startGame(opts) {
    G = {
      state: opts.fen ? Engine.fromFEN(opts.fen) : Engine.initialState(),
      mode: opts.mode,
      opponent: opts.opponent || null,
      lesson: opts.lesson || null,
      puzzle: opts.puzzle || null,
      playerColor: opts.playerColor || 'w',
      flipped: (opts.playerColor || 'w') === 'b',
      history: [],
      captured: { w: [], b: [] },
      moveCount: 0,
      over: false, busy: false,
      loose: !!(opts.lesson && opts.lesson.kind === 'captureAll'),
      selected: null, targets: []
    };
    if (G.opponent) Opponents.preload(G.opponent);
    layoutCells();
    renderPieces();
    show('screen-game');

    $('#game-title').textContent =
      G.mode === 'ai' ? 'You vs ' + G.opponent.name :
      G.mode === '2p' ? 'Blue vs Red' :
      G.mode === 'puzzle' ? G.puzzle.name :
      G.lesson.name;
    $('#lesson-tip').style.display = (G.lesson || G.puzzle) ? '' : 'none';
    $('#lesson-tip').textContent = G.lesson ? G.lesson.tip :
      G.puzzle ? 'White to move. Deliver checkmate in ONE move!' : '';
    $('#btn-undo').style.display = (G.mode === 'ai' || G.mode === '2p') ? '' : 'none';
    $('#btn-hint').style.display = (G.mode === 'ai' || G.mode === '2p') ? '' : 'none';
    $('#btn-restart').style.display = (G.mode === 'lesson' || G.mode === 'puzzle') ? '' : 'none';

    updateHud();
    if (G.mode === 'ai' && G.playerColor === 'b') aiTurn();
  }

  function doPlayerMove(move) {
    animateMove(move).then(function () {
      G.moveCount++;
      afterPlayerMove(move);
    });
  }

  function afterPlayerMove(move) {
    if (G.mode === 'lesson' && G.lesson.kind === 'captureAll') {
      G.state.turn = 'w'; // enemies in drills stand still
      updateHud(move);
      if (Lessons.captureAllDone(G.state)) {
        var stars = Lessons.starsFor(G.lesson, G.moveCount);
        Lessons.setLessonStars(G.lesson.id, stars);
        lessonWin(stars);
      }
      return;
    }
    if (G.mode === 'puzzle' || (G.mode === 'lesson' && G.lesson.kind === 'mate1')) {
      updateHud(move);
      if (Engine.status(G.state) === 'checkmate') {
        if (G.puzzle) Lessons.setPuzzleDone(G.puzzle.id);
        else Lessons.setLessonStars(G.lesson.id, 3);
        lessonWin(3);
      } else {
        setStatus('Not quite — that\'s not mate. Try again!');
        Sound.play('lose');
        setTimeout(function () {
          G.state = G.history.pop();
          renderPieces();
          updateHud();
        }, 900);
      }
      return;
    }

    var st = Engine.status(G.state);
    updateHud(move);
    if (st === 'check') { flashCheck(); }
    if (endIfOver(st)) return;
    if (G.mode === 'ai') aiTurn();
  }

  function aiTurn() {
    if (G.over) return;
    G.busy = true;
    updateHud();
    var myG = G;
    Opponents.getMove(G.opponent, G.state, function (move) {
      if (G !== myG || G.over) return; // player left the game meanwhile
      if (!move) { G.busy = false; endIfOver(Engine.status(G.state)); return; }
      animateMove(move).then(function () {
        var st = Engine.status(G.state);
        updateHud(move);
        if (st === 'check') flashCheck();
        endIfOver(st);
      });
    });
  }

  function flashCheck() {
    Sound.play('check');
    var b = el('div', 'check-flash', $('#board-wrap'));
    b.textContent = 'CHECK!';
    setTimeout(function () { b.remove(); }, 1100);
  }

  function endIfOver(st) {
    if (st !== 'checkmate' && st !== 'stalemate' && st !== 'draw') return false;
    G.over = true;
    var result, title, sub;
    if (st === 'checkmate') {
      var winner = G.state.turn === 'w' ? 'b' : 'w';
      if (G.mode === '2p') {
        title = (winner === 'w' ? 'Blue' : 'Red') + ' wins!';
        sub = 'Checkmate!';
        result = 1;
      } else {
        var playerWon = winner === G.playerColor;
        title = playerWon ? 'Victory!' : 'Defeated!';
        sub = playerWon ? 'You checkmated ' + G.opponent.name + '!' :
          G.opponent.name + ' got you — rematch?';
        result = playerWon ? 1 : 0;
      }
    } else {
      title = 'Draw!';
      sub = st === 'stalemate' ? 'Stalemate — nobody wins.' : 'Neither army can win.';
      result = 0.5;
    }

    var newRating = null;
    if (G.mode === 'ai') {
      newRating = Opponents.recordResult(Opponents.effectiveRating(G.opponent), result);
    }
    if (G.mode === 'ai' && G.lessonBoss && result === 1) {
      Lessons.setLessonStars('boss', 3);
    }
    setTimeout(function () { endModal(title, sub, result, newRating); }, 700);
    return true;
  }

  function confetti(box, n) {
    var colors = ['#f6c445', '#3567c9', '#c03a3a', '#7ed36b', '#4fc3f7', '#e4526e'];
    for (var i = 0; i < n; i++) {
      var c = el('div', 'confetti', box);
      c.style.left = Math.random() * 100 + '%';
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--d', (2.4 + Math.random() * 2.2) + 's');
      c.style.setProperty('--delay', (Math.random() * 1.4) + 's');
      c.style.setProperty('--drift', (Math.random() * 80 - 40) + 'px');
    }
  }

  function endModal(title, sub, result, newRating) {
    Sound.play(result === 1 ? 'win' : result === 0 ? 'lose' : 'check');
    var layer = $('#modal-layer');
    layer.innerHTML = '';
    var ov = el('div', 'modal-overlay show', layer);
    if (result === 1) confetti(ov, 60);
    var box = el('div', 'modal end-modal', ov);
    el('h2', null, box).textContent = title;
    el('p', null, box).textContent = sub;
    if (newRating != null) {
      var r = el('p', 'rating-line', box);
      r.innerHTML = 'Your rating: <b>' + newRating + '</b>';
    }
    if (result === 1 && G.mode !== '2p') {
      var champ = el('div', 'end-champ', box);
      champ.innerHTML = Characters.svg('k', G.playerColor, 'dance');
    }
    var row = el('div', 'modal-btns', box);
    if (G.mode === 'ai' || G.mode === '2p') {
      btn(row, 'Rematch', function () {
        layer.innerHTML = '';
        startGame({ mode: G.mode, opponent: G.opponent, playerColor: G.playerColor });
      });
    }
    if (G.mode === 'ai') {
      btn(row, 'Opponents', function () { layer.innerHTML = ''; show('screen-opponents'); });
    }
    btn(row, 'Menu', function () { layer.innerHTML = ''; show('screen-menu'); });
  }

  function lessonWin(stars) {
    G.over = true;
    Sound.play('win');
    setTimeout(function () { Sound.play('star'); }, 350);
    var layer = $('#modal-layer');
    layer.innerHTML = '';
    var ov = el('div', 'modal-overlay show', layer);
    confetti(ov, 40);
    var box = el('div', 'modal end-modal', ov);
    el('h2', null, box).textContent = G.puzzle ? 'Puzzle solved!' : 'Lesson complete!';
    var starRow = el('div', 'star-row', box);
    for (var i = 1; i <= 3; i++) {
      var s = el('span', 'star' + (i <= stars ? ' lit' : ''), starRow);
      s.textContent = '★';
      s.style.animationDelay = (i * 0.18) + 's';
    }
    var row = el('div', 'modal-btns', box);
    var next = nextItem();
    if (next) btn(row, 'Next ▸', function () { layer.innerHTML = ''; next(); });
    btn(row, G.puzzle ? 'Puzzles' : 'Academy', function () {
      layer.innerHTML = '';
      show(G.puzzle ? 'screen-puzzles' : 'screen-academy');
    });
  }

  function nextItem() {
    if (G.puzzle) {
      var idx = Lessons.PUZZLES.indexOf(G.puzzle);
      var nx = Lessons.PUZZLES[idx + 1];
      return nx ? function () { startPuzzle(nx); } : null;
    }
    var li = Lessons.LESSONS.indexOf(G.lesson);
    var nl = Lessons.LESSONS[li + 1];
    return nl ? function () { startLesson(nl); } : null;
  }

  function btn(parent, label, fn) {
    var b = el('button', 'btn', parent);
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  /* ---------- lesson / puzzle starters ---------- */

  function startLesson(lesson) {
    if (lesson.kind === 'boss') {
      startGame({ mode: 'ai', opponent: Opponents.byId(lesson.opponent), playerColor: 'w' });
      G.lessonBoss = true;
      $('#game-title').textContent = 'Boss Battle: ' + G.opponent.name;
      return;
    }
    startGame({ mode: 'lesson', lesson: lesson, fen: lesson.fen });
  }

  function startPuzzle(pz) {
    startGame({ mode: 'puzzle', puzzle: pz, fen: pz.fen });
  }

  /* ---------- screen renderers ---------- */

  function renderMenu() {
    $('#menu-rating').innerHTML = 'Rating: <b>' + Opponents.playerRating() + '</b>';
    var heroes = $('#menu-heroes');
    if (!heroes.dataset.built) {
      heroes.dataset.built = '1';
      ['n', 'k', 'q'].forEach(function (t, i) {
        var h = el('div', 'hero', heroes);
        h.innerHTML = Characters.svg(t, i === 1 ? 'w' : (i ? 'b' : 'w'));
        h.querySelector('.body-root').style.animationDelay = (-i * 0.4) + 's';
      });
    }
    refreshToggles();
  }

  function renderOpponents() {
    var list = $('#opponent-list');
    list.innerHTML = '';
    Opponents.ROSTER.forEach(function (opp) {
      var card = el('div', 'opp-card', list);
      var av = el('div', 'opp-avatar', card);
      av.innerHTML = Characters.svg(opp.avatar[0], opp.avatar[1]);
      var info = el('div', 'opp-info', card);
      el('h3', null, info).textContent = opp.name;
      el('div', 'opp-title', info).textContent = opp.title +
        (opp.rating ? ' · ~' + opp.rating : ' · matches you');
      el('p', null, info).textContent = opp.desc;
      var play = el('button', 'btn btn-play', card);
      play.textContent = 'Fight!';
      play.addEventListener('click', function () {
        var colorSel = document.querySelector('input[name="pcolor"]:checked').value;
        var pc = colorSel === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorSel;
        startGame({ mode: 'ai', opponent: opp, playerColor: pc });
      });
    });
  }

  function renderAcademy() {
    var path = $('#lesson-path');
    path.innerHTML = '';
    Lessons.LESSONS.forEach(function (lesson, i) {
      var stars = Lessons.lessonStars(lesson.id);
      var open = Lessons.unlocked(i);
      var node = el('div', 'lesson-node' + (open ? '' : ' locked') + (i % 2 ? ' alt' : ''), path);
      var bubble = el('button', 'lesson-bubble', node);
      bubble.innerHTML = open
        ? Characters.svg(lesson.icon, 'w')
        : '<span class="lock">🔒</span>';
      if (open) bubble.addEventListener('click', function () { startLesson(lesson); });
      var meta = el('div', 'lesson-meta', node);
      el('div', 'lesson-name', meta).textContent = lesson.name;
      var sr = el('div', 'lesson-stars', meta);
      for (var s = 1; s <= 3; s++) {
        el('span', 'star' + (s <= stars ? ' lit' : ''), sr).textContent = '★';
      }
    });
  }

  function renderPuzzles() {
    var grid = $('#puzzle-grid');
    grid.innerHTML = '';
    Lessons.PUZZLES.forEach(function (pz, i) {
      var card = el('button', 'puzzle-card' + (Lessons.puzzleDone(pz.id) ? ' done' : ''), grid);
      el('div', 'pz-num', card).textContent = '#' + (i + 1);
      el('div', 'pz-name', card).textContent = pz.name;
      el('div', 'pz-check', card).textContent = Lessons.puzzleDone(pz.id) ? '✔' : 'Mate in 1';
      card.addEventListener('click', function () { startPuzzle(pz); });
    });
  }

  /* ---------- toggles & buttons ---------- */

  function refreshToggles() {
    $('#btn-sound').textContent = Sound.isOn() ? '🔊' : '🔇';
    $('#btn-gore').textContent = Battle.goreOn() ? '🩸' : '✨';
    $('#btn-gore').title = Battle.goreOn() ? 'Battle style: blood (click for family-friendly sparks)'
      : 'Battle style: sparks (click for blood)';
  }

  function wireUp() {
    document.querySelectorAll('[data-show]').forEach(function (b) {
      b.addEventListener('click', function () { show(b.dataset.show); });
    });
    $('#btn-2p').addEventListener('click', function () { startGame({ mode: '2p' }); });
    $('#btn-sound').addEventListener('click', function () { Sound.toggle(); refreshToggles(); });
    $('#btn-gore').addEventListener('click', function () { Battle.toggleGore(); refreshToggles(); });

    $('#btn-undo').addEventListener('click', function () {
      if (!G || G.busy || !G.history.length) return;
      var steps = (G.mode === 'ai' && G.history.length >= 2) ? 2 : 1;
      while (steps-- && G.history.length) {
        var prev = G.history.pop();
        // rebuild captured trays from what disappeared
        ['w', 'b'].forEach(function (color) {
          var now = 0, was = 0, i;
          for (i = 0; i < 64; i++) {
            if (G.state.board[i] && G.state.board[i].color === color) now++;
            if (prev.board[i] && prev.board[i].color === color) was++;
          }
          if (was > now) G.captured[color].pop();
        });
        G.state = prev;
      }
      G.over = false;
      renderPieces();
      updateHud();
    });

    $('#btn-hint').addEventListener('click', function () {
      if (!G || G.busy || G.over) return;
      var m = AI.bestMove(G.state, 3);
      if (!m) return;
      clearMarks();
      cells[m.from].classList.add('hint');
      cells[m.to].classList.add('hint');
      Sound.play('select');
    });

    $('#btn-restart').addEventListener('click', function () {
      if (!G) return;
      if (G.lesson) startLesson(G.lesson);
      else if (G.puzzle) startPuzzle(G.puzzle);
    });

    $('#btn-quit').addEventListener('click', function () {
      show('screen-menu');
      G = null;
    });
  }

  /* ---------- boot ---------- */

  document.addEventListener('DOMContentLoaded', function () {
    buildBoard();
    wireUp();
    show('screen-menu');
  });
})();
