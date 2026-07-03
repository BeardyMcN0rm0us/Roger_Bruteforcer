/* Beardy's Battle Chess — Academy: bite-size lessons and mate puzzles.
 * Lesson kinds:
 *   captureAll — enemies stand still; take them all (stars scored vs par)
 *   mate1     — real position; deliver checkmate in one move
 *   boss      — a real game against an opponent from the roster */
var Lessons = (function () {
  'use strict';

  var LESSONS = [
    {
      id: 'pawn', icon: 'p', name: 'Pawn Power', kind: 'captureAll', par: 2,
      fen: '8/8/8/5p2/8/8/4P3/8 w - - 0 1',
      tip: 'Pawns march straight ahead (two squares from home!) but capture diagonally. Take the enemy pawn.'
    },
    {
      id: 'rook', icon: 'r', name: 'Rook Rampage', kind: 'captureAll', par: 2,
      fen: 'p6p/8/8/8/8/8/8/R7 w - - 0 1',
      tip: 'Rooks charge in straight lines — any distance. Flatten both enemies.'
    },
    {
      id: 'bishop', icon: 'b', name: 'Bishop Bash', kind: 'captureAll', par: 2,
      fen: '3p4/8/8/6p1/8/8/8/2B5 w - - 0 1',
      tip: 'Bishops sweep the diagonals. Take both enemies — plan the order!'
    },
    {
      id: 'knight', icon: 'n', name: 'Knight Moves', kind: 'captureAll', par: 3,
      fen: '8/3p4/8/4p3/8/5p2/8/6N1 w - - 0 1',
      tip: 'Knights jump in an L: two squares one way, one square sideways. Chain all three captures.'
    },
    {
      id: 'queen', icon: 'q', name: 'Queen Quest', kind: 'captureAll', par: 2,
      fen: '8/3p4/8/8/6p1/8/8/3Q4 w - - 0 1',
      tip: 'The queen moves like a rook AND a bishop. Zap both enemies in two moves.'
    },
    {
      id: 'king', icon: 'k', name: 'King Combat', kind: 'captureAll', par: 2,
      fen: '8/8/8/8/8/6p1/5p2/4K3 w - - 0 1',
      tip: 'The king steps one square in any direction. Slow, but he can still swing a sword.'
    },
    {
      id: 'mate', icon: 'r', name: 'Checkmate 101', kind: 'mate1',
      fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
      tip: 'Trap the king so he cannot escape. The enemy king is stuck behind his own pawns — find the back-rank mate!'
    },
    {
      id: 'boss', icon: 'k', name: 'Boss Battle: Daisy', kind: 'boss', opponent: 'daisy',
      tip: 'Put it all together — beat Daisy in a real game to finish the Academy!'
    }
  ];

  var PUZZLES = [
    { id: 'pz1', name: 'Back-Rank Blitz', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1' },
    { id: 'pz2', name: 'Corridor of Doom', fen: '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1' },
    { id: 'pz3', name: 'Royal Escort', fen: '7k/8/5KQ1/8/8/8/8/8 w - - 0 1' },
    { id: 'pz4', name: 'Sneaky Knight', fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1' },
    { id: 'pz5', name: 'Ladder Finish', fen: '7k/R7/1R6/8/8/8/8/6K1 w - - 0 1' },
    { id: 'pz6', name: 'Queen Takes All', fen: '3q2k1/5ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1' },
    { id: 'pz7', name: 'Corner Trap', fen: 'k7/8/1QK5/8/8/8/8/8 w - - 0 1' },
    { id: 'pz8', name: 'Long Distance Call', fen: '5k2/1R6/8/8/8/8/8/Q5K1 w - - 0 1' }
  ];

  /* ---------- progress (localStorage) ---------- */

  function load() {
    try { return JSON.parse(localStorage.getItem('bbc-progress')) || {}; }
    catch (e) { return {}; }
  }
  function save(p) { localStorage.setItem('bbc-progress', JSON.stringify(p)); }

  function lessonStars(id) { return (load().lessons || {})[id] || 0; }
  function setLessonStars(id, stars) {
    var p = load();
    p.lessons = p.lessons || {};
    if (stars > (p.lessons[id] || 0)) p.lessons[id] = stars;
    save(p);
  }
  function puzzleDone(id) { return !!(load().puzzles || {})[id]; }
  function setPuzzleDone(id) {
    var p = load();
    p.puzzles = p.puzzles || {};
    p.puzzles[id] = true;
    save(p);
  }

  /* Lesson i is unlocked when the previous lesson has at least one star. */
  function unlocked(i) {
    if (i === 0) return true;
    return lessonStars(LESSONS[i - 1].id) > 0;
  }

  function starsFor(lesson, movesUsed) {
    if (movesUsed <= lesson.par) return 3;
    if (movesUsed <= lesson.par + 1) return 2;
    return 1;
  }

  /* For captureAll lessons: done when no black pieces remain. */
  function captureAllDone(state) {
    for (var i = 0; i < 64; i++) {
      var p = state.board[i];
      if (p && p.color === 'b') return false;
    }
    return true;
  }

  return {
    LESSONS: LESSONS, PUZZLES: PUZZLES,
    lessonStars: lessonStars, setLessonStars: setLessonStars,
    puzzleDone: puzzleDone, setPuzzleDone: setPuzzleDone,
    unlocked: unlocked, starsFor: starsFor, captureAllDone: captureAllDone
  };
})();
