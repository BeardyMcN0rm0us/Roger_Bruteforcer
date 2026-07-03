/* Beardy's Battle Chess — capture battle cutscenes.
 * When a piece takes a piece, the little people fight it out.
 * Gore mode ON: cartoon blood. Gore mode OFF: stars and sparks. */
var Battle = (function () {
  'use strict';

  var GORE_WORDS = ['SPLAT!', 'CRUNCH!', 'KAPOW!', 'THWACK!', 'SQUISH!', 'CHOP!'];
  var SOFT_WORDS = ['BONK!', 'OOF!', 'WHAM!', 'POW!', 'BOOP!', 'ZONK!'];
  var RANGED = { q: true, b: true }; // queen zaps, bishop casts

  function el(tag, cls, parent) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (parent) parent.appendChild(d);
    return d;
  }

  function goreOn() { return localStorage.getItem('bbc-gore') !== 'off'; }
  function toggleGore() {
    var on = !goreOn();
    localStorage.setItem('bbc-gore', on ? 'on' : 'off');
    return on;
  }

  function spawnParticles(fx, x, y, gore, big) {
    var n = big ? 26 : 16;
    for (var i = 0; i < n; i++) {
      var p = el('div', gore ? 'blood-drop' : 'star-spark', fx);
      var ang = Math.random() * Math.PI * 2;
      var dist = 30 + Math.random() * (big ? 170 : 110);
      p.style.left = x + '%';
      p.style.top = y + '%';
      p.style.setProperty('--dx', (Math.cos(ang) * dist) + 'px');
      p.style.setProperty('--dy', (Math.sin(ang) * dist * 0.7 - 40) + 'px');
      p.style.setProperty('--s', (0.5 + Math.random() * 1.1).toFixed(2));
      p.style.setProperty('--t', (0.5 + Math.random() * 0.45).toFixed(2) + 's');
      if (!gore) p.textContent = ['✦', '✶', '★', '✺'][i % 4];
    }
    if (gore) {
      for (var j = 0; j < (big ? 5 : 3); j++) {
        var s = el('div', 'blood-stain', fx);
        s.style.left = (x - 12 + Math.random() * 24) + '%';
        s.style.top = (y + 18 + Math.random() * 14) + '%';
        s.style.setProperty('--s', (0.7 + Math.random()).toFixed(2));
        s.style.setProperty('--rot', Math.floor(Math.random() * 360) + 'deg');
      }
    }
  }

  /* Fight it out. attacker/victim: {type, color}. Resolves when done. */
  function fight(attacker, victim) {
    return new Promise(function (resolve) {
      var gore = goreOn();
      var layer = document.getElementById('battle-layer');
      layer.innerHTML = '';

      var ov = el('div', 'battle-overlay', layer);
      var arena = el('div', 'battle-arena', ov);
      el('div', 'battle-floor', arena);
      var fx = el('div', 'battle-fx', arena);

      var atkLeft = attacker.color === 'w';
      var atk = el('div', 'fighter attacker ' + (atkLeft ? 'side-l' : 'side-r'), arena);
      atk.innerHTML = Characters.svg(attacker.type, attacker.color);
      var vic = el('div', 'fighter victim ' + (atkLeft ? 'side-r' : 'side-l'), arena);
      vic.innerHTML = Characters.svg(victim.type, victim.color);

      var names = el('div', 'battle-names', ov);
      names.innerHTML =
        '<span class="bn team-' + attacker.color + '">' + Characters.FLAVOR[attacker.type] + '</span>' +
        '<span class="bn-vs">VS</span>' +
        '<span class="bn team-' + victim.color + '">' + Characters.FLAVOR[victim.type] + '</span>';

      var banner = el('div', 'battle-banner', arena);
      var words = gore ? GORE_WORDS : SOFT_WORDS;
      banner.textContent = words[Math.floor(Math.random() * words.length)];

      var timers = [];
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        ov.classList.add('hide');
        setTimeout(function () { layer.innerHTML = ''; resolve(); }, 260);
      }
      function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
      ov.addEventListener('pointerdown', finish); // tap to skip

      requestAnimationFrame(function () { ov.classList.add('show'); });

      var ranged = RANGED[attacker.type];
      var victimX = atkLeft ? 72 : 28; // fx coordinates, % of arena

      if (ranged) {
        at(900, function () {
          atk.classList.add('strike');
          Sound.play('zap');
          var bolt = el('div', 'bolt' + (atkLeft ? '' : ' rtl'), fx);
          bolt.style.top = '52%';
        });
        at(1300, impact);
      } else {
        at(650, function () { atk.classList.add('advance'); });
        at(1050, function () { atk.classList.add('strike'); Sound.play('swing'); });
        at(1250, impact);
      }

      function impact() {
        Sound.play('hit');
        if (gore) Sound.play('squelch');
        arena.classList.add('shake');
        el('div', 'impact-flash', fx);
        vic.classList.add('hit');
        spawnParticles(fx, victimX, 46, gore, false);
      }

      at(1800, function () {
        vic.classList.add('dead');
        vic.querySelector('svg').classList.add('dead');
        Sound.play('ko');
        spawnParticles(fx, victimX, 60, gore, true);
        banner.classList.add('pop');
      });

      at(2750, finish);
    });
  }

  /* Tiny board-level splat that stays on the square after a capture. */
  function squareSplat(cellEl) {
    if (!goreOn()) return;
    var s = document.createElement('div');
    s.className = 'square-splat';
    s.style.setProperty('--rot', Math.floor(Math.random() * 360) + 'deg');
    s.style.setProperty('--s', (0.6 + Math.random() * 0.5).toFixed(2));
    cellEl.appendChild(s);
  }

  return { fight: fight, squareSplat: squareSplat, goreOn: goreOn, toggleGore: toggleGore };
})();
