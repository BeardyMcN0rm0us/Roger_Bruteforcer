/* Beardy's Battle Chess — built-in computer opponent.
 * Minimax + alpha-beta + quiescence + iterative deepening with a time budget.
 * Level 1-2 add randomness/blunders; level 3-4 play their best. The
 * grandmaster tiers use Stockfish (see opponents.js); this engine covers
 * the lower ladder and is the offline fallback. */
var AI = (function () {
  'use strict';

  var VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  // Piece-square tables from white's point of view (row 0 = rank 8).
  var PST = {
    p: [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0],
    n: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50],
    b: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20],
    r: [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0],
    q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20],
    k: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20]
  };

  var deadline = Infinity;
  var timedOut = false;
  var nodes = 0;

  /* Static eval, positive = good for white. */
  function evaluate(state) {
    var score = 0;
    for (var i = 0; i < 64; i++) {
      var p = state.board[i];
      if (!p) continue;
      var v = VAL[p.type] + PST[p.type][p.color === 'w' ? i : 63 - i];
      score += p.color === 'w' ? v : -v;
    }
    return score;
  }

  function orderMoves(moves, pv) {
    return moves.sort(function (a, b) {
      var av = a.captured ? VAL[a.captured] * 10 - VAL[a.piece] : 0;
      var bv = b.captured ? VAL[b.captured] * 10 - VAL[b.piece] : 0;
      if (pv) {
        if (a.from === pv.from && a.to === pv.to) av += 1e6;
        if (b.from === pv.from && b.to === pv.to) bv += 1e6;
      }
      return bv - av;
    });
  }

  /* Quiescence: keep resolving captures so we don't evaluate mid-exchange. */
  function quiesce(state, alpha, beta) {
    nodes++;
    var stand = evaluate(state);
    var white = state.turn === 'w';
    if (white) { if (stand >= beta) return beta; if (stand > alpha) alpha = stand; }
    else { if (stand <= alpha) return alpha; if (stand < beta) beta = stand; }
    if ((nodes & 511) === 0 && Date.now() > deadline) { timedOut = true; return stand; }

    var moves = Engine.legalMoves(state).filter(function (m) { return m.captured; });
    orderMoves(moves);
    for (var i = 0; i < moves.length; i++) {
      var val = quiesce(Engine.makeMove(state, moves[i]), alpha, beta);
      if (timedOut) break;
      if (white) { if (val > alpha) alpha = val; }
      else { if (val < beta) beta = val; }
      if (alpha >= beta) break;
    }
    return white ? alpha : beta;
  }

  function search(state, depth, alpha, beta) {
    nodes++;
    if ((nodes & 511) === 0 && Date.now() > deadline) { timedOut = true; return 0; }
    var moves = Engine.legalMoves(state);
    if (moves.length === 0) {
      if (Engine.inCheck(state, state.turn)) {
        // deeper mates score worse so the engine prefers the quickest mate
        return state.turn === 'w' ? -100000 - depth : 100000 + depth;
      }
      return 0;
    }
    if (depth === 0) return quiesce(state, alpha, beta);
    orderMoves(moves);
    var i, val;
    if (state.turn === 'w') {
      var best = -Infinity;
      for (i = 0; i < moves.length; i++) {
        val = search(Engine.makeMove(state, moves[i]), depth - 1, alpha, beta);
        if (timedOut) break;
        if (val > best) best = val;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    } else {
      var worst = Infinity;
      for (i = 0; i < moves.length; i++) {
        val = search(Engine.makeMove(state, moves[i]), depth - 1, alpha, beta);
        if (timedOut) break;
        if (val < worst) worst = val;
        if (worst < beta) beta = worst;
        if (alpha >= beta) break;
      }
      return worst;
    }
  }

  /* Score every root move at `depth`, best first for the side to move. */
  function scoreRoot(state, depth, prevBest) {
    var moves = orderMoves(Engine.legalMoves(state), prevBest);
    var mySign = state.turn === 'w' ? 1 : -1;
    var scored = [];
    var alpha = -Infinity, beta = Infinity;
    for (var i = 0; i < moves.length; i++) {
      var val = search(Engine.makeMove(state, moves[i]), depth - 1, alpha, beta);
      if (timedOut && i > 0) break;
      scored.push({ move: moves[i], score: val });
      if (state.turn === 'w') { if (val > alpha) alpha = val; }
      else { if (val < beta) beta = val; }
    }
    scored.sort(function (a, b) { return (b.score - a.score) * mySign; });
    return scored;
  }

  /* levels: 1 easy (blunders) | 2 casual | 3 club (~1s think) | 4 max (~2.5s) */
  var LEVELS = {
    1: { depth: 1, timeMs: 300, fuzz: 150, pool: 6 },
    2: { depth: 2, timeMs: 500, fuzz: 40, pool: 3 },
    3: { depth: 4, timeMs: 1000, fuzz: 0, pool: 1 },
    4: { depth: 6, timeMs: 2500, fuzz: 0, pool: 1 }
  };

  function bestMove(state, level) {
    var cfg = LEVELS[level] || LEVELS[2];
    var moves = Engine.legalMoves(state);
    if (moves.length === 0) return null;
    if (moves.length === 1) return moves[0];

    deadline = Date.now() + cfg.timeMs;
    timedOut = false;
    nodes = 0;

    var mySign = state.turn === 'w' ? 1 : -1;
    var scored = null;
    for (var d = 1; d <= cfg.depth; d++) {
      var res = scoreRoot(state, d, scored && scored[0].move);
      if (res.length && (!timedOut || !scored)) scored = res;
      if (timedOut) break;
      // don't start another iteration with under a third of the budget left
      if (Date.now() > deadline - cfg.timeMs / 3 && d >= 2) break;
    }

    // Weaker levels pick semi-randomly among moves near the best.
    var pool = 1;
    if (cfg.pool > 1) {
      var cutoff = scored[0].score * mySign - cfg.fuzz;
      while (pool < scored.length && pool < cfg.pool &&
             scored[pool].score * mySign >= cutoff) pool++;
    }
    return scored[Math.floor(Math.random() * pool)].move;
  }

  return { bestMove: bestMove, evaluate: evaluate };
})();
if (typeof module !== 'undefined') module.exports = AI;
