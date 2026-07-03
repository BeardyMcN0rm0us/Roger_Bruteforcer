/* Beardy's Battle Chess — SVG character builder.
 * Every piece is a little person with a weapon. Groups are classed
 * (.arm-weapon, .head, .body-root, .eyes/.eyes-dead) so CSS can animate them. */
var Characters = (function () {
  'use strict';

  var TEAM = {
    w: { // Blue Knights
      main: '#3567c9', main2: '#274e9c', trim: '#f6c445', trim2: '#c99a1f',
      skin: '#f6c9a0', metal: '#c8d2e0', metal2: '#8fa0b8', cloth: '#e9eef7'
    },
    b: { // Red Raiders
      main: '#c03a3a', main2: '#8e2626', trim: '#f2a93b', trim2: '#b87716',
      skin: '#e8b183', metal: '#b9b3c4', metal2: '#7d7590', cloth: '#3c2f45'
    }
  };

  function face(t, opts) {
    var beard = opts && opts.beard;
    var s = '';
    s += '<g class="eyes">' +
      '<circle cx="43" cy="38" r="2.6" fill="#2b2530"/>' +
      '<circle cx="57" cy="38" r="2.6" fill="#2b2530"/>' +
      '<circle cx="44" cy="37" r="0.9" fill="#fff"/>' +
      '<circle cx="58" cy="37" r="0.9" fill="#fff"/>' +
      '<path d="M45 47 Q50 51 55 47" stroke="#2b2530" stroke-width="2" fill="none" stroke-linecap="round"/>' +
      '</g>';
    s += '<g class="eyes-dead" style="display:none">' +
      '<path d="M40 35 l6 6 M46 35 l-6 6" stroke="#2b2530" stroke-width="2.2" stroke-linecap="round"/>' +
      '<path d="M54 35 l6 6 M60 35 l-6 6" stroke="#2b2530" stroke-width="2.2" stroke-linecap="round"/>' +
      '<ellipse cx="50" cy="48" rx="3.5" ry="2.5" fill="#2b2530"/>' +
      '</g>';
    s += '<circle cx="38" cy="44" r="3" fill="#e88" opacity="0.45"/>' +
         '<circle cx="62" cy="44" r="3" fill="#e88" opacity="0.45"/>';
    if (beard) {
      s += '<path d="M36 42 Q36 62 50 64 Q64 62 64 42 Q60 50 50 50 Q40 50 36 42 Z" fill="' + beard + '"/>' +
           '<path d="M44 52 Q50 56 56 52" stroke="' + beard + '" stroke-width="2" fill="none"/>';
    }
    return s;
  }

  function head(t, inner, opts) {
    return '<g class="head">' +
      '<circle cx="50" cy="40" r="19" fill="' + t.skin + '"/>' +
      face(t, opts) + (inner || '') + '</g>';
  }

  function legs(t, boots) {
    return '<g class="legs">' +
      '<rect x="39" y="98" width="9" height="22" rx="4" fill="' + t.main2 + '"/>' +
      '<rect x="52" y="98" width="9" height="22" rx="4" fill="' + t.main2 + '"/>' +
      '<ellipse cx="43" cy="121" rx="7" ry="4.5" fill="' + (boots || '#4a3628') + '"/>' +
      '<ellipse cx="57" cy="121" rx="7" ry="4.5" fill="' + (boots || '#4a3628') + '"/>' +
      '</g>';
  }

  function torso(t, fill, extra) {
    return '<g class="torso">' +
      '<path d="M36 66 Q34 78 36 96 Q37 104 50 104 Q63 104 64 96 Q66 78 64 66 Q57 60 50 60 Q43 60 36 66 Z" fill="' + fill + '"/>' +
      (extra || '') + '</g>';
  }

  function backArm(t, fill) {
    return '<g class="arm-back">' +
      '<rect x="28" y="64" width="10" height="26" rx="5" fill="' + fill + '"/>' +
      '<circle cx="33" cy="91" r="5.5" fill="' + t.skin + '"/>' +
      '</g>';
  }

  /* Weapon arm anchored at the right shoulder (63,66). `weapon` draws pointing up. */
  function weaponArm(t, fill, weapon) {
    return '<g class="arm-weapon">' +
      '<rect x="61" y="62" width="10" height="26" rx="5" fill="' + fill + '"/>' +
      '<circle cx="66" cy="87" r="6" fill="' + t.skin + '"/>' +
      weapon + '</g>';
  }

  var WEAPONS = {
    pitchfork: function (t) {
      return '<g class="weapon">' +
        '<rect x="64.5" y="18" width="3.5" height="72" rx="1.5" fill="#8a5a2e"/>' +
        '<path d="M58 22 v-12 M66.2 22 v-16 M74.5 22 v-12" stroke="' + t.metal2 + '" stroke-width="3.4" stroke-linecap="round"/>' +
        '<rect x="56" y="19" width="20.5" height="4" rx="2" fill="' + t.metal2 + '"/>' +
        '</g>';
    },
    mace: function (t) {
      return '<g class="weapon">' +
        '<rect x="64.5" y="34" width="4" height="56" rx="2" fill="#6b4a26"/>' +
        '<circle cx="66.5" cy="26" r="11" fill="' + t.metal2 + '"/>' +
        '<circle cx="66.5" cy="26" r="6" fill="' + t.metal + '"/>' +
        '<path d="M66.5 11 v6 M66.5 35 v6 M52 26 h6 M75 26 h6 M56 16 l4.5 4.5 M77 37 l-4.5 -4.5 M77 16 l-4.5 4.5 M56 37 l4.5 -4.5" stroke="' + t.metal2 + '" stroke-width="3" stroke-linecap="round"/>' +
        '</g>';
    },
    club: function (t) {
      return '<g class="weapon">' +
        '<path d="M63 90 L61 34 Q61 20 68 20 Q75 20 75 34 L71 90 Z" fill="#7d7568"/>' +
        '<circle cx="64" cy="30" r="2" fill="#5c554b"/><circle cx="71" cy="42" r="2" fill="#5c554b"/><circle cx="66" cy="55" r="2" fill="#5c554b"/>' +
        '</g>';
    },
    staff: function (t) {
      return '<g class="weapon">' +
        '<rect x="64.5" y="24" width="4" height="66" rx="2" fill="' + t.trim2 + '"/>' +
        '<circle cx="66.5" cy="18" r="8.5" fill="' + t.trim + '"/>' +
        '<circle cx="64" cy="15.5" r="3" fill="#fff" opacity="0.7"/>' +
        '<path d="M66.5 4 v5 M56 18 h5 M72 18 h5" stroke="' + t.trim + '" stroke-width="2.5" stroke-linecap="round"/>' +
        '</g>';
    },
    scepter: function (t) {
      return '<g class="weapon">' +
        '<rect x="64.8" y="30" width="3.4" height="60" rx="1.7" fill="' + t.trim2 + '"/>' +
        '<path d="M66.5 8 L71 19 L82 20 L73.5 27 L76 38 L66.5 32 L57 38 L59.5 27 L51 20 L62 19 Z" fill="' + t.trim + '" stroke="' + t.trim2 + '" stroke-width="1.5"/>' +
        '</g>';
    },
    sword: function (t) {
      return '<g class="weapon">' +
        '<path d="M64.5 78 L64.5 18 L66.5 10 L68.5 18 L68.5 78 Z" fill="' + t.metal + '" stroke="' + t.metal2 + '" stroke-width="1"/>' +
        '<rect x="56" y="76" width="21" height="5" rx="2.5" fill="' + t.trim2 + '"/>' +
        '<rect x="64" y="81" width="5" height="9" rx="2" fill="#6b4a26"/>' +
        '<circle cx="66.5" cy="92" r="3.5" fill="' + t.trim + '"/>' +
        '</g>';
    }
  };

  var BUILDERS = {
    p: function (t) { // Pawn: plucky peasant with pitchfork
      return legs(t) + backArm(t, t.cloth) +
        torso(t, t.main, '<rect x="36" y="80" width="28" height="5" fill="' + t.trim2 + '"/>' +
          '<circle cx="50" cy="82.5" r="3.5" fill="' + t.trim + '"/>') +
        head(t, '<path d="M31 36 Q31 18 50 18 Q69 18 69 36 Q60 30 50 30 Q40 30 31 36 Z" fill="' + t.main2 + '"/>' +
          '<circle cx="50" cy="19" r="3.5" fill="' + t.trim + '"/>') +
        weaponArm(t, t.cloth, WEAPONS.pitchfork(t));
    },
    n: function (t) { // Knight: armored, big helm with plume, spiked mace
      return legs(t, t.metal2) + backArm(t, t.metal) +
        torso(t, t.metal, '<path d="M38 66 Q50 74 62 66 L62 74 Q50 82 38 74 Z" fill="' + t.main + '"/>' +
          '<circle cx="50" cy="92" r="5" fill="' + t.trim + '"/>') +
        head(t, '<path d="M30 42 Q28 16 50 15 Q72 16 70 42 L70 34 Q70 46 62 46 L60 34 L40 34 L38 46 Q30 46 30 34 Z" fill="' + t.metal + '"/>' +
          '<path d="M30 34 Q30 15 50 14 Q70 15 70 34 Q60 26 50 26 Q40 26 30 34 Z" fill="' + t.metal2 + '"/>' +
          '<path d="M50 14 Q46 2 36 4 Q44 8 42 16 Z" fill="' + t.main + '"/>') +
        weaponArm(t, t.metal, WEAPONS.mace(t));
    },
    r: function (t) { // Rook: stone golem with tower-top head and club
      var stone = '#9a938a', stone2 = '#6f6960';
      return '<g class="legs">' +
        '<rect x="36" y="98" width="12" height="22" rx="4" fill="' + stone2 + '"/>' +
        '<rect x="52" y="98" width="12" height="22" rx="4" fill="' + stone2 + '"/>' +
        '<ellipse cx="42" cy="121" rx="8" ry="4.5" fill="' + stone2 + '"/>' +
        '<ellipse cx="58" cy="121" rx="8" ry="4.5" fill="' + stone2 + '"/></g>' +
        '<g class="arm-back"><rect x="24" y="62" width="13" height="30" rx="6" fill="' + stone + '"/>' +
        '<circle cx="31" cy="93" r="7.5" fill="' + stone2 + '"/></g>' +
        '<g class="torso"><path d="M32 62 Q29 80 33 98 Q34 106 50 106 Q66 106 67 98 Q71 80 68 62 Q58 55 50 55 Q42 55 32 62 Z" fill="' + stone + '"/>' +
        '<path d="M38 70 h10 M52 82 h12 M36 90 h9" stroke="' + stone2 + '" stroke-width="2.5" stroke-linecap="round"/>' +
        '<rect x="40" y="58" width="20" height="7" rx="3" fill="' + t.main + '"/></g>' +
        '<g class="head"><circle cx="50" cy="38" r="19" fill="' + stone + '"/>' +
        face({ skin: stone }, null) +
        '<path d="M30 30 L30 12 L38 12 L38 19 L45 19 L45 12 L55 12 L55 19 L62 19 L62 12 L70 12 L70 30 Q60 24 50 24 Q40 24 30 30 Z" fill="' + stone2 + '"/>' +
        '<rect x="30" y="27" width="40" height="5" fill="' + t.main + '"/></g>' +
        '<g class="arm-weapon"><rect x="60" y="60" width="13" height="30" rx="6" fill="' + stone + '"/>' +
        '<circle cx="66.5" cy="91" r="8" fill="' + stone2 + '"/>' + WEAPONS.club(t) + '</g>';
    },
    b: function (t) { // Bishop: robed, tall mitre, glowing staff
      return '<g class="legs"><path d="M36 96 Q34 116 40 120 L60 120 Q66 116 64 96 Z" fill="' + t.main2 + '"/></g>' +
        backArm(t, t.cloth) +
        torso(t, t.cloth, '<path d="M44 62 L50 104 L56 62 Z" fill="' + t.trim + '"/>' +
          '<path d="M47 70 h6 M50 67 v12" stroke="' + t.main2 + '" stroke-width="2.2" stroke-linecap="round"/>') +
        head(t, '<path d="M34 34 Q34 24 42 22 L50 0 L58 22 Q66 24 66 34 Q58 28 50 28 Q42 28 34 34 Z" fill="' + t.main + '"/>' +
          '<path d="M50 5 L50 24" stroke="' + t.trim + '" stroke-width="2.5"/>' +
          '<path d="M45 14 h10" stroke="' + t.trim + '" stroke-width="2.5"/>', { beard: '#cfc7bd' }) +
        weaponArm(t, t.cloth, WEAPONS.staff(t));
    },
    q: function (t) { // Queen: gown, crown, star scepter
      return '<g class="legs"><path d="M34 92 Q28 118 38 121 L62 121 Q72 118 66 92 Z" fill="' + t.main + '"/>' +
        '<path d="M38 108 Q50 114 62 108" stroke="' + t.trim + '" stroke-width="2" fill="none"/></g>' +
        backArm(t, t.main) +
        torso(t, t.main, '<path d="M40 62 Q50 70 60 62 L60 70 Q50 78 40 70 Z" fill="' + t.trim + '"/>' +
          '<circle cx="50" cy="88" r="4" fill="' + t.trim + '"/>') +
        head(t, '<path d="M32 34 Q30 50 36 58 L36 30 Z" fill="#7a4a21"/>' +
          '<path d="M68 34 Q70 50 64 58 L64 30 Z" fill="#7a4a21"/>' +
          '<path d="M31 34 Q31 16 50 16 Q69 16 69 34 Q60 26 50 26 Q40 26 31 34 Z" fill="#7a4a21"/>' +
          '<path d="M36 22 L38 10 L44 18 L50 8 L56 18 L62 10 L64 22 Q50 16 36 22 Z" fill="' + t.trim + '" stroke="' + t.trim2 + '" stroke-width="1.5"/>' +
          '<circle cx="38" cy="12" r="2.5" fill="#e4526e"/><circle cx="50" cy="10" r="2.5" fill="#4fc3f7"/><circle cx="62" cy="12" r="2.5" fill="#7ed36b"/>') +
        weaponArm(t, t.main, WEAPONS.scepter(t));
    },
    k: function (t) { // King: big crown, big beard (it IS Beardy's game), sword
      return legs(t, t.metal2) + backArm(t, t.main) +
        '<g class="cape"><path d="M34 62 Q26 90 30 112 L40 104 Q36 82 40 64 Z" fill="' + t.main2 + '"/></g>' +
        torso(t, t.main, '<path d="M36 66 L64 66 L64 72 L36 72 Z" fill="#fff" opacity="0.25"/>' +
          '<rect x="36" y="84" width="28" height="5" fill="' + t.trim2 + '"/>' +
          '<circle cx="50" cy="86.5" r="4" fill="' + t.trim + '"/>') +
        head(t, '<path d="M33 30 L33 12 L41 20 L50 8 L59 20 L67 12 L67 30 Q58 24 50 24 Q42 24 33 30 Z" fill="' + t.trim + '" stroke="' + t.trim2 + '" stroke-width="1.5"/>' +
          '<circle cx="50" cy="14" r="3" fill="#e4526e"/><circle cx="39" cy="19" r="2" fill="#4fc3f7"/><circle cx="61" cy="19" r="2" fill="#4fc3f7"/>',
          { beard: t.color === 'w' ? '#e8e3da' : '#4a3a2e' }) +
        weaponArm(t, t.main, WEAPONS.sword(t));
    }
  };

  /* Build a full character SVG string. */
  function svg(type, color, cls) {
    var t = Object.assign({ color: color }, TEAM[color]);
    return '<svg class="char char-' + type + ' team-' + color + (cls ? ' ' + cls : '') + '" viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg">' +
      '<ellipse class="shadow" cx="50" cy="123" rx="24" ry="5" fill="#000" opacity="0.18"/>' +
      '<g class="body-root">' + BUILDERS[type](t) + '</g></svg>';
  }

  var NAMES = {
    p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King'
  };
  var FLAVOR = {
    p: 'Pokey the Pawn', n: 'Sir Bonk', b: 'Brother Whack',
    r: 'Rocky the Rook', q: 'Queen Zapper', k: 'King Beardy'
  };

  return { svg: svg, NAMES: NAMES, FLAVOR: FLAVOR, TEAM: TEAM };
})();
