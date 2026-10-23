// 合成音效（WebAudio，無音檔）。預設靜音；localStorage「tcw-muted」為 0 才出聲。
(function () {
  var root = typeof globalThis !== 'undefined' ? globalThis : this;
  var KEY = 'tcw-muted';
  var ctx = null, master = null, noiseBuf = null, failed = false, armed = false;
  var last = Object.create(null);
  var muted = true;
  try { muted = root.localStorage.getItem(KEY) !== '0'; } catch (e) { muted = true; }

  function persist() {
    try { root.localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) { /* 寫不進去就只留在這次 */ }
  }
  function clock() {
    try {
      if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
    } catch (e) { /* 改用 Date */ }
    return Date.now();
  }
  function ensure() {
    if (failed) return null;
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (typeof AC !== 'function') { failed = true; return null; }
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.25;
      master.connect(ctx.destination);
      var len = Math.max(1, Math.floor(ctx.sampleRate * 0.5));
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return ctx;
    } catch (e) {
      ctx = null;
      master = null;
      noiseBuf = null;
      failed = true;
      return null;
    }
  }
  function resume() {
    try {
      if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        var p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    } catch (e) { /* 瀏覽器擋自動播放就靜音 */ }
  }
  function arm() {
    if (armed) return;
    armed = true;
    if (ensure()) resume();
  }
  try {
    if (typeof document !== 'undefined' && document.addEventListener) {
      var once = function () {
        document.removeEventListener('pointerdown', once, true);
        document.removeEventListener('keydown', once, true);
        arm();
      };
      document.addEventListener('pointerdown', once, true);
      document.addEventListener('keydown', once, true);
    }
  } catch (e) { /* 沒有 DOM 就等 play */ }

  function env(peak, dur, delay) {
    var g = ctx.createGain();
    var t = ctx.currentTime + (delay || 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.min(0.03, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);
    return { g: g, t: t };
  }
  function tone(freq, dur, type, peak, delay) {
    var e = env(peak, dur, delay);
    var o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, e.t);
    o.connect(e.g);
    o.start(e.t);
    o.stop(e.t + dur + 0.02);
    return o;
  }
  function noise(dur, peak, freq) {
    var e = env(peak, dur, 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var node = src;
    if (freq && typeof ctx.createBiquadFilter === 'function') {
      var f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(freq, e.t);
      src.connect(f);
      node = f;
    }
    node.connect(e.g);
    src.start(e.t);
    src.stop(e.t + dur + 0.02);
  }
  var sounds = {
    click: function () { tone(740, 0.055, 'square', 0.1); },
    attack: function () { noise(0.08, 0.08, 180); tone(120, 0.2, 'sine', 0.18); tone(80, 0.16, 'triangle', 0.08, 0.03); },
    hit: function () { noise(0.045, 0.035, 2400); },
    capture: function () { tone(523, 0.12, 'triangle', 0.14, 0); tone(659, 0.12, 'triangle', 0.14, 0.11); tone(784, 0.26, 'triangle', 0.16, 0.22); },
    hold: function () { tone(98, 0.42, 'sine', 0.16); tone(74, 0.36, 'triangle', 0.06, 0.04); },
    news: function () { tone(660, 0.12, 'sine', 0.13, 0); tone(880, 0.18, 'sine', 0.13, 0.13); },
    tactic: function () {
      noise(0.24, 0.09, 700);
      var e = env(0.06, 0.22, 0);
      var o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(180, e.t);
      o.frequency.exponentialRampToValueAtTime(760, e.t + 0.18);
      o.connect(e.g);
      o.start(e.t);
      o.stop(e.t + 0.24);
    },
    end: function () { tone(392, 0.1, 'square', 0.09, 0); tone(523, 0.16, 'square', 0.11, 0.1); },
  };

  function play(name) {
    try {
      if (muted || typeof sounds[name] !== 'function') return;
      var t = clock();
      if (last[name] != null && t - last[name] < 60) return;
      last[name] = t;
      if (!ensure()) return;
      resume();
      sounds[name]();
    } catch (e) { /* 音效失敗就略過 */ }
  }
  function setMuted(v) { muted = !!v; persist(); }
  root.Sfx = {
    play: play,
    muted: function () { return muted; },
    setMuted: setMuted,
    toggle: function () { setMuted(!muted); return muted; },
  };
})();
