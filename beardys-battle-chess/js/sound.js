/* Beardy's Battle Chess — synthesized sound effects (Web Audio, no assets). */
var Sound = (function () {
  'use strict';

  var ctx = null;
  var enabled = localStorage.getItem('bbc-sound') !== 'off';

  function ac() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function env(node, t0, attack, decay, peak) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.linearRampToValueAtTime(peak, t0 + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  function osc(type, freq, t0, dur, peak, slideTo) {
    var a = ac(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    env(g, t0, 0.005, dur, peak);
    o.connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.1);
  }

  function noise(t0, dur, peak, filterFreq, slideTo) {
    var a = ac(); if (!a) return;
    var len = Math.max(1, Math.floor(a.sampleRate * dur));
    var buf = a.createBuffer(1, len, a.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    var src = a.createBufferSource(); src.buffer = buf;
    var f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(filterFreq, t0);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    var g = a.createGain();
    env(g, t0, 0.005, dur, peak);
    src.connect(f).connect(g).connect(a.destination);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  var FX = {
    select: function (t) { osc('sine', 660, t, 0.08, 0.12); },
    move: function (t) { noise(t, 0.09, 0.25, 900, 300); },
    swing: function (t) { noise(t, 0.22, 0.3, 400, 2400); },
    hit: function (t) {
      osc('square', 160, t, 0.12, 0.3, 60);
      noise(t, 0.12, 0.35, 250, 90);
    },
    squelch: function (t) {
      noise(t, 0.25, 0.4, 700, 150);
      osc('sawtooth', 220, t + 0.02, 0.2, 0.15, 50);
    },
    zap: function (t) { osc('sawtooth', 1400, t, 0.3, 0.2, 120); noise(t, 0.25, 0.15, 3000, 500); },
    check: function (t) { osc('triangle', 880, t, 0.12, 0.2); osc('triangle', 660, t + 0.13, 0.2, 0.2); },
    win: function (t) {
      [523, 659, 784, 1047].forEach(function (f, i) {
        osc('triangle', f, t + i * 0.13, 0.28, 0.22);
      });
    },
    lose: function (t) {
      [392, 330, 262, 196].forEach(function (f, i) {
        osc('triangle', f, t + i * 0.16, 0.3, 0.2);
      });
    },
    star: function (t) { osc('sine', 1046, t, 0.15, 0.18); osc('sine', 1568, t + 0.08, 0.25, 0.15); },
    ko: function (t) { osc('square', 90, t, 0.35, 0.3, 40); }
  };

  function play(name) {
    if (!enabled) return;
    var a = ac(); if (!a) return;
    try { FX[name](a.currentTime + 0.01); } catch (e) { /* audio best-effort */ }
  }

  function toggle() {
    enabled = !enabled;
    localStorage.setItem('bbc-sound', enabled ? 'on' : 'off');
    return enabled;
  }

  return { play: play, toggle: toggle, isOn: function () { return enabled; } };
})();
