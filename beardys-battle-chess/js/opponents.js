/* Beardy's Battle Chess — AI opponent roster.
 * Lower tiers run the built-in JS engine; master tiers run Stockfish 10
 * (WASM, vendored) in a Web Worker. If Stockfish can't load (e.g. the page
 * was opened from file://), masters fall back to the built-in engine's
 * strongest setting. Adaptive mode tracks an Elo-style rating and matches
 * the engine strength to the player. */
var Opponents = (function () {
  'use strict';

  var ROSTER = [
    {
      id: 'daisy', name: 'Daisy', title: 'The Rookie', rating: 500,
      avatar: ['p', 'b'], desc: 'Learning the ropes. Makes plenty of mistakes — pounce on them!',
      engine: { type: 'js', level: 1 }
    },
    {
      id: 'eadie', name: 'Eadie', title: 'The Scrapper', rating: 900,
      avatar: ['n', 'b'], desc: 'Loves a fight and grabs every piece she can. Punishes lazy moves.',
      engine: { type: 'js', level: 2 }
    },
    {
      id: 'sidney', name: 'Sidney', title: 'The Tactician', rating: 1400,
      avatar: ['b', 'b'], desc: 'Club-level calculation. Leave nothing hanging.',
      engine: { type: 'js', level: 3 }
    },
    {
      id: 'duchess', name: 'The Duchess', title: 'Master', rating: 2000,
      avatar: ['q', 'b'], desc: 'A genuine master engine. Every plan gets tested.',
      engine: { type: 'sf', skill: 10, movetime: 400, fallbackLevel: 4 }
    },
    {
      id: 'beardy', name: 'King Beardy', title: 'Grandmaster', rating: 2850,
      avatar: ['k', 'b'], desc: 'Full-strength Stockfish. Beat him and claim the crown. (Nobody beats him.)',
      engine: { type: 'sf', skill: 20, movetime: 2000, fallbackLevel: 4 }
    },
    {
      id: 'mystery', name: 'The Mystery Knight', title: 'Adaptive', rating: 0,
      avatar: ['r', 'b'], desc: 'Matches your rating: grows stronger when you win, eases off when you lose.',
      engine: { type: 'adaptive' }
    }
  ];

  function byId(id) {
    for (var i = 0; i < ROSTER.length; i++) if (ROSTER[i].id === id) return ROSTER[i];
    return ROSTER[0];
  }

  /* ---------- adaptive rating ---------- */

  function playerRating() {
    var v = parseInt(localStorage.getItem('bbc-rating'), 10);
    return isNaN(v) ? 800 : v;
  }

  /* result: 1 win, 0.5 draw, 0 loss (from the player's side) */
  function recordResult(oppRating, result) {
    var r = playerRating();
    var expected = 1 / (1 + Math.pow(10, (oppRating - r) / 400));
    r = Math.round(Math.min(3000, Math.max(100, r + 40 * (result - expected))));
    localStorage.setItem('bbc-rating', String(r));
    return r;
  }

  /* Pick an engine config that gives the player a real game at their level. */
  function adaptiveEngine() {
    var r = playerRating() + 50; // aim slightly above the player
    if (r < 700) return { type: 'js', level: 1, rating: 600 };
    if (r < 1100) return { type: 'js', level: 2, rating: 950 };
    if (r < 1600) return { type: 'js', level: 3, rating: 1400 };
    if (r < 2000) return { type: 'sf', skill: 8, movetime: 300, fallbackLevel: 4, rating: 1800 };
    if (r < 2400) return { type: 'sf', skill: 14, movetime: 700, fallbackLevel: 4, rating: 2200 };
    return { type: 'sf', skill: 20, movetime: 1500, fallbackLevel: 4, rating: 2850 };
  }

  /* ---------- Stockfish worker ---------- */

  var sf = null;          // worker
  var sfState = 'cold';   // cold | loading | ready | dead
  var sfQueue = [];       // callbacks waiting for ready/dead
  var sfBestCb = null;

  function bootStockfish() {
    if (sfState !== 'cold') return;
    sfState = 'loading';
    var died = function () {
      sfState = 'dead';
      if (sf) { try { sf.terminate(); } catch (e) { /* already gone */ } sf = null; }
      flushQueue();
    };
    if (typeof Worker === 'undefined' || location.protocol === 'file:') { died(); return; }
    var file = (typeof WebAssembly === 'object') ? 'stockfish.js' : 'stockfish.asm.js';
    var timer = setTimeout(died, 8000);
    try {
      sf = new Worker('vendor/stockfish/' + file);
    } catch (e) { clearTimeout(timer); died(); return; }
    sf.onerror = function () { clearTimeout(timer); died(); };
    sf.onmessage = function (e) {
      var line = String(e.data);
      if (line === 'uciok') {
        clearTimeout(timer);
        sfState = 'ready';
        flushQueue();
      } else if (line.indexOf('bestmove') === 0 && sfBestCb) {
        var cb = sfBestCb; sfBestCb = null;
        cb(line.split(/\s+/)[1]);
      }
    };
    sf.postMessage('uci');
  }

  function flushQueue() {
    var q = sfQueue; sfQueue = [];
    q.forEach(function (fn) { fn(); });
  }

  function whenStockfish(fn) {
    bootStockfish();
    if (sfState === 'ready' || sfState === 'dead') fn();
    else sfQueue.push(fn);
  }

  function uciToMove(state, uci) {
    if (!uci || uci === '(none)') return null;
    var from = Engine.sqIndex(uci.slice(0, 2));
    var to = Engine.sqIndex(uci.slice(2, 4));
    var promo = uci.length > 4 ? uci[4] : null;
    var moves = Engine.legalMoves(state, from);
    for (var i = 0; i < moves.length; i++) {
      if (moves[i].to === to && (!promo || moves[i].promo === promo)) return moves[i];
    }
    return null;
  }

  /* ---------- unified interface ---------- */

  /* Ask `opp` for its move in `state`; cb(move) later (may be same tick). */
  function getMove(opp, state, cb) {
    var eng = opp.engine.type === 'adaptive' ? adaptiveEngine() : opp.engine;
    if (eng.type === 'js') {
      setTimeout(function () { cb(AI.bestMove(state, eng.level)); }, 60);
      return;
    }
    whenStockfish(function () {
      if (sfState !== 'ready') {
        setTimeout(function () { cb(AI.bestMove(state, eng.fallbackLevel || 4)); }, 60);
        return;
      }
      var guard = setTimeout(function () {
        if (!sfBestCb) return;
        sfBestCb = null;
        cb(AI.bestMove(state, eng.fallbackLevel || 4));
      }, (eng.movetime || 1000) + 8000);
      sfBestCb = function (uci) {
        clearTimeout(guard);
        var m = uciToMove(state, uci);
        cb(m || AI.bestMove(state, eng.fallbackLevel || 4));
      };
      sf.postMessage('setoption name Skill Level value ' + (eng.skill != null ? eng.skill : 20));
      sf.postMessage('position fen ' + Engine.toFEN(state));
      sf.postMessage('go movetime ' + (eng.movetime || 1000));
    });
  }

  /* Effective rating for adaptive results bookkeeping. */
  function effectiveRating(opp) {
    if (opp.engine.type === 'adaptive') return adaptiveEngine().rating;
    return opp.rating;
  }

  /* Warm the engine up front so the first master move isn't slow. */
  function preload(opp) {
    var eng = opp.engine.type === 'adaptive' ? adaptiveEngine() : opp.engine;
    if (eng.type === 'sf') bootStockfish();
  }

  return {
    ROSTER: ROSTER, byId: byId, getMove: getMove, preload: preload,
    playerRating: playerRating, recordResult: recordResult,
    effectiveRating: effectiveRating
  };
})();
