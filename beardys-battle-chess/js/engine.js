/* Beardy's Battle Chess — chess rules engine.
 * Board: 64-array, index 0 = a8 (top-left), 63 = h1. row 0 = rank 8.
 * Piece: { type: 'p'|'n'|'b'|'r'|'q'|'k', color: 'w'|'b' } */
var Engine = (function () {
  'use strict';

  var FILES = 'abcdefgh';

  function sqIndex(name) {
    var file = FILES.indexOf(name[0]);
    var rank = parseInt(name[1], 10);
    return (8 - rank) * 8 + file;
  }
  function sqName(i) {
    return FILES[i % 8] + (8 - Math.floor(i / 8));
  }
  function rc(i) { return { r: Math.floor(i / 8), c: i % 8 }; }
  function idx(r, c) { return r * 8 + c; }
  function onBoard(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

  function fromFEN(fen) {
    var parts = fen.trim().split(/\s+/);
    var board = new Array(64).fill(null);
    var i = 0;
    for (var k = 0; k < parts[0].length; k++) {
      var ch = parts[0][k];
      if (ch === '/') continue;
      if (ch >= '1' && ch <= '8') { i += parseInt(ch, 10); continue; }
      board[i++] = { type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b' };
    }
    var castle = parts[2] || '-';
    return {
      board: board,
      turn: parts[1] || 'w',
      castling: {
        K: castle.indexOf('K') >= 0, Q: castle.indexOf('Q') >= 0,
        k: castle.indexOf('k') >= 0, q: castle.indexOf('q') >= 0
      },
      ep: (parts[3] && parts[3] !== '-') ? sqIndex(parts[3]) : -1,
      half: parseInt(parts[4], 10) || 0,
      moveNum: parseInt(parts[5], 10) || 1
    };
  }

  function initialState() {
    return fromFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  }

  function toFEN(s) {
    var rows = [];
    for (var r = 0; r < 8; r++) {
      var row = '', empty = 0;
      for (var c = 0; c < 8; c++) {
        var p = s.board[idx(r, c)];
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += p.color === 'w' ? p.type.toUpperCase() : p.type;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    var castle = (s.castling.K ? 'K' : '') + (s.castling.Q ? 'Q' : '') +
                 (s.castling.k ? 'k' : '') + (s.castling.q ? 'q' : '');
    return rows.join('/') + ' ' + s.turn + ' ' + (castle || '-') + ' ' +
      (s.ep >= 0 ? sqName(s.ep) : '-') + ' ' + s.half + ' ' + s.moveNum;
  }

  function cloneState(s) {
    return {
      board: s.board.slice(),
      turn: s.turn,
      castling: { K: s.castling.K, Q: s.castling.Q, k: s.castling.k, q: s.castling.q },
      ep: s.ep,
      half: s.half,
      moveNum: s.moveNum
    };
  }

  var KNIGHT_D = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  var KING_D = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  var BISHOP_D = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  var ROOK_D = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  /* Is square `sq` attacked by any piece of `byColor`? */
  function attacked(board, sq, byColor) {
    var p = rc(sq), r = p.r, c = p.c, i, d, nr, nc, piece;
    // pawn attacks: white pawns attack upward (toward row 0)
    var pr = byColor === 'w' ? r + 1 : r - 1;
    for (i = -1; i <= 1; i += 2) {
      if (onBoard(pr, c + i)) {
        piece = board[idx(pr, c + i)];
        if (piece && piece.type === 'p' && piece.color === byColor) return true;
      }
    }
    for (i = 0; i < 8; i++) {
      d = KNIGHT_D[i]; nr = r + d[0]; nc = c + d[1];
      if (onBoard(nr, nc)) {
        piece = board[idx(nr, nc)];
        if (piece && piece.type === 'n' && piece.color === byColor) return true;
      }
    }
    for (i = 0; i < 8; i++) {
      d = KING_D[i]; nr = r + d[0]; nc = c + d[1];
      if (onBoard(nr, nc)) {
        piece = board[idx(nr, nc)];
        if (piece && piece.type === 'k' && piece.color === byColor) return true;
      }
    }
    for (i = 0; i < 4; i++) {
      d = BISHOP_D[i]; nr = r + d[0]; nc = c + d[1];
      while (onBoard(nr, nc)) {
        piece = board[idx(nr, nc)];
        if (piece) {
          if (piece.color === byColor && (piece.type === 'b' || piece.type === 'q')) return true;
          break;
        }
        nr += d[0]; nc += d[1];
      }
    }
    for (i = 0; i < 4; i++) {
      d = ROOK_D[i]; nr = r + d[0]; nc = c + d[1];
      while (onBoard(nr, nc)) {
        piece = board[idx(nr, nc)];
        if (piece) {
          if (piece.color === byColor && (piece.type === 'r' || piece.type === 'q')) return true;
          break;
        }
        nr += d[0]; nc += d[1];
      }
    }
    return false;
  }

  function findKing(board, color) {
    for (var i = 0; i < 64; i++) {
      var p = board[i];
      if (p && p.type === 'k' && p.color === color) return i;
    }
    return -1;
  }

  function inCheck(state, color) {
    var k = findKing(state.board, color);
    if (k < 0) return false; // lesson boards may have no king
    return attacked(state.board, k, color === 'w' ? 'b' : 'w');
  }

  /* Pseudo-legal moves for the piece on `from`. */
  function pseudoMoves(state, from) {
    var board = state.board, piece = board[from];
    if (!piece) return [];
    var moves = [], p = rc(from), r = p.r, c = p.c, i, d, nr, nc, t;
    var color = piece.color, enemy = color === 'w' ? 'b' : 'w';

    function add(to, extra) {
      var m = { from: from, to: to, piece: piece.type, color: color };
      var cap = board[to];
      if (cap) m.captured = cap.type;
      if (extra) for (var k in extra) m[k] = extra[k];
      moves.push(m);
    }

    if (piece.type === 'p') {
      var dir = color === 'w' ? -1 : 1;
      var startRow = color === 'w' ? 6 : 1;
      var promoRow = color === 'w' ? 0 : 7;
      nr = r + dir;
      if (onBoard(nr, c) && !board[idx(nr, c)]) {
        if (nr === promoRow) {
          ['q', 'r', 'b', 'n'].forEach(function (pr) { add(idx(nr, c), { promo: pr }); });
        } else {
          add(idx(nr, c));
          if (r === startRow && !board[idx(r + 2 * dir, c)]) add(idx(r + 2 * dir, c), { double: true });
        }
      }
      for (i = -1; i <= 1; i += 2) {
        nc = c + i;
        if (!onBoard(nr, nc)) continue;
        t = idx(nr, nc);
        var target = board[t];
        if (target && target.color === enemy) {
          if (nr === promoRow) {
            ['q', 'r', 'b', 'n'].forEach(function (pr) { add(t, { promo: pr }); });
          } else add(t);
        } else if (t === state.ep && !target) {
          add(t, { ep: true, captured: 'p' });
        }
      }
    } else if (piece.type === 'n' || piece.type === 'k') {
      var deltas = piece.type === 'n' ? KNIGHT_D : KING_D;
      for (i = 0; i < 8; i++) {
        d = deltas[i]; nr = r + d[0]; nc = c + d[1];
        if (!onBoard(nr, nc)) continue;
        t = board[idx(nr, nc)];
        if (!t || t.color === enemy) add(idx(nr, nc));
      }
      if (piece.type === 'k') {
        // castling: squares between empty, king not in/through check
        var home = color === 'w' ? 7 : 0;
        if (r === home && c === 4) {
          var rightsK = color === 'w' ? state.castling.K : state.castling.k;
          var rightsQ = color === 'w' ? state.castling.Q : state.castling.q;
          if (rightsK && !board[idx(home, 5)] && !board[idx(home, 6)]) {
            var rook = board[idx(home, 7)];
            if (rook && rook.type === 'r' && rook.color === color &&
                !attacked(board, idx(home, 4), enemy) &&
                !attacked(board, idx(home, 5), enemy) &&
                !attacked(board, idx(home, 6), enemy)) {
              add(idx(home, 6), { castle: 'K' });
            }
          }
          if (rightsQ && !board[idx(home, 3)] && !board[idx(home, 2)] && !board[idx(home, 1)]) {
            var rookQ = board[idx(home, 0)];
            if (rookQ && rookQ.type === 'r' && rookQ.color === color &&
                !attacked(board, idx(home, 4), enemy) &&
                !attacked(board, idx(home, 3), enemy) &&
                !attacked(board, idx(home, 2), enemy)) {
              add(idx(home, 2), { castle: 'Q' });
            }
          }
        }
      }
    } else {
      var dirs = piece.type === 'b' ? BISHOP_D : piece.type === 'r' ? ROOK_D : BISHOP_D.concat(ROOK_D);
      for (i = 0; i < dirs.length; i++) {
        d = dirs[i]; nr = r + d[0]; nc = c + d[1];
        while (onBoard(nr, nc)) {
          t = board[idx(nr, nc)];
          if (!t) add(idx(nr, nc));
          else { if (t.color === enemy) add(idx(nr, nc)); break; }
          nr += d[0]; nc += d[1];
        }
      }
    }
    return moves;
  }

  /* Apply a move, returning a new state. Does not validate legality. */
  function makeMove(state, move) {
    var s = cloneState(state);
    var board = s.board;
    var piece = board[move.from];
    var color = piece.color;

    if (piece.type === 'p' || move.captured) s.half = 0; else s.half++;
    if (color === 'b') s.moveNum++;

    board[move.to] = move.promo ? { type: move.promo, color: color } : piece;
    board[move.from] = null;

    if (move.ep) board[move.to + (color === 'w' ? 8 : -8)] = null;

    if (move.castle) {
      var home = color === 'w' ? 7 : 0;
      if (move.castle === 'K') {
        board[idx(home, 5)] = board[idx(home, 7)];
        board[idx(home, 7)] = null;
      } else {
        board[idx(home, 3)] = board[idx(home, 0)];
        board[idx(home, 0)] = null;
      }
    }

    s.ep = move.double ? (move.from + move.to) / 2 : -1;

    // castling rights
    if (piece.type === 'k') {
      if (color === 'w') { s.castling.K = s.castling.Q = false; }
      else { s.castling.k = s.castling.q = false; }
    }
    [move.from, move.to].forEach(function (sq) {
      if (sq === 63) s.castling.K = false;
      if (sq === 56) s.castling.Q = false;
      if (sq === 7) s.castling.k = false;
      if (sq === 0) s.castling.q = false;
    });

    s.turn = color === 'w' ? 'b' : 'w';
    return s;
  }

  /* Fully legal moves. If `from` given, only for that square.
   * `loose` skips the self-check filter (for kings-optional lesson boards). */
  function legalMoves(state, from, loose) {
    var moves = [];
    var squares = from != null ? [from] : [];
    if (from == null) {
      for (var i = 0; i < 64; i++) {
        var p = state.board[i];
        if (p && p.color === state.turn) squares.push(i);
      }
    }
    squares.forEach(function (sq) {
      var p = state.board[sq];
      if (!p || p.color !== state.turn) return;
      pseudoMoves(state, sq).forEach(function (m) {
        if (loose || !inCheck(makeMove(state, m), state.turn)) moves.push(m);
      });
    });
    return moves;
  }

  function insufficientMaterial(board) {
    var minor = 0;
    for (var i = 0; i < 64; i++) {
      var p = board[i];
      if (!p || p.type === 'k') continue;
      if (p.type === 'n' || p.type === 'b') { if (++minor > 1) return false; }
      else return false;
    }
    return true;
  }

  /* Game status for side to move: normal | check | checkmate | stalemate | draw */
  function status(state) {
    var hasMove = legalMoves(state).length > 0;
    var check = inCheck(state, state.turn);
    if (!hasMove) return check ? 'checkmate' : 'stalemate';
    if (state.half >= 100 || insufficientMaterial(state.board)) return 'draw';
    return check ? 'check' : 'normal';
  }

  return {
    sqIndex: sqIndex, sqName: sqName, rc: rc, idx: idx,
    fromFEN: fromFEN, initialState: initialState, cloneState: cloneState,
    legalMoves: legalMoves, makeMove: makeMove,
    inCheck: inCheck, status: status, attacked: attacked, findKing: findKing
  };
})();
if (typeof module !== 'undefined') module.exports = Engine;
