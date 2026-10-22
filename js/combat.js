// Pure combat rules shared by the live battle and the pre-battle estimate.
const Combat = (() => {
  const kinds = army => Object.keys(army).filter(k => army[k] > 0);
  const count = army => kinds(army).reduce((n, k) => n + army[k], 0);

  function plan(army, units, half = false) {
    const sent = Object.fromEntries(kinds(army).map(k => [k, half ? Math.ceil(army[k] / 2) : army[k]]));
    // Always leave one defender at home, including a single-unit garrison.
    if (count(sent) === count(army) && count(sent)) {
      const cheapest = kinds(sent).sort((a, b) => units[a].cost - units[b].cost)[0];
      sent[cheapest]--;
    }
    return sent;
  }

  function validDeployment(army, sent, units) {
    return sent && Object.entries(sent).every(([k, n]) => Object.hasOwn(units, k)
      && Number.isInteger(n) && n >= 0 && n <= (army[k] || 0))
      && count(sent) > 0 && count(sent) < count(army);
  }

  // Allocate an exact total proportionally from the deployable army.
  function planSize(army, units, requested) {
    const pool = plan(army, units), capacity = count(pool);
    const total = Math.max(0, Math.min(capacity, Number.isFinite(Number(requested)) ? Math.floor(Number(requested)) : 0));
    if (!capacity) return {};
    const sent = Object.fromEntries(kinds(pool).map(k => [k, Math.floor(pool[k] * total / capacity)]));
    const ranked = kinds(pool).sort((a, b) => (pool[b] * total / capacity % 1) - (pool[a] * total / capacity % 1));
    let remaining = total - count(sent);
    for (const k of ranked) if (remaining > 0 && sent[k] < pool[k]) { sent[k]++; remaining--; }
    return sent;
  }

  // ── 排兵對陣：每種兵一排，每一排打對面那一排；對面空了就打最近的一排 ──
  // 戰鬥一直打到其中一方全滅（攻方可由玩家主動戰略撤退）。
  const CLASS_ORDER = ['inf', 'moto', 'gen', 'art'];
  const byClass = units => (a, b) => CLASS_ORDER.indexOf(units[a].cls) - CLASS_ORDER.indexOf(units[b].cls) || a.localeCompare(b);
  const MAX_ROUNDS = 200; // 安全上限，正常戰鬥遠低於此
  // 把 army 的每一排排到它剋制的敵排對面（最強的排先挑）
  function counterLanes(army, foe, units, counters) {
    const L = Math.max(kinds(army).length, foe.length), lanes = Array(L).fill(null);
    const rows = kinds(army).sort((a, b) => army[b] * units[b].atk - army[a] * units[a].atk || a.localeCompare(b));
    for (const k of rows) {
      let best = -1, bestScore = -1;
      for (let i = 0; i < L; i++) {
        if (lanes[i] !== null) continue;
        const f = foe[i];
        const score = !f ? 1 : counters[units[k].cls] === units[f].cls ? 3 : counters[units[f].cls] === units[k].cls ? 0 : 2;
        if (score > bestScore) { best = i; bestScore = score; }
      }
      lanes[best] = k;
    }
    return lanes;
  }
  // 開戰：守方依兵系順序排，攻方針對守方排兵
  function setup({ sent, defenders, units, counters }) {
    const A = { ...sent }, D = { ...defenders };
    const laneD = kinds(D).sort(byClass(units));
    const laneA = counterLanes(A, laneD, units, counters);
    while (laneD.length < laneA.length) laneD.push(null);
    // aimA／aimD：{ 我方兵種: 指定攻擊的敵方兵種 }（玩家可直接指定打對方任一排，例如最後一排）
    return { A, D, a0: count(A), d0: count(D), laneA, laneD, aimA: {}, aimD: {}, adapted: 0, round: 0,
      rounds: [{ A: { ...A }, D: { ...D }, toA: {}, toD: {} }], done: !count(A) || !count(D) };
  }
  // 第 i 排的攻擊目標：對面那排，沒有就找最近的（同距離取上面那排）
  function targetLane(lanes, army, i) {
    let best = -1;
    lanes.forEach((k, j) => { if (k && army[k] > 0 && (best < 0 || Math.abs(j - i) < Math.abs(best - i))) best = j; });
    return best;
  }
  function laneDamage(o, from, fromLanes, aims, to, toLanes, mult, moto, random) {
    const out = {};
    fromLanes.forEach((k, i) => {
      if (!k || !from[k]) return;
      const j = targetLane(toLanes, to, i);
      if (j < 0) return;
      const t = to[aims[k]] > 0 ? aims[k] : toLanes[j], u = o.units[k]; // 指定的目標還活著就打它
      out[t] = (out[t] || 0) + from[k] * u.atk * mult * (u.cls === 'moto' ? moto : 1) * (0.8 + random() * 0.4) * 0.35
        * (o.counters[u.cls] === o.units[t].cls ? 1.6 : 1);
    });
    return out;
  }
  function applyDamage(army, amounts, units, random) {
    for (const k of kinds(army)) {
      const x = (amounts[k] || 0) / units[k].hp;
      const kills = Math.floor(x) + (random() < x % 1 ? 1 : 0);
      army[k] -= Math.min(kills, army[k]);
    }
  }
  function step(st, o, random = Math.random) {
    if (st.done) return st;
    const toD = laneDamage(o, st.A, st.laneA, st.aimA, st.D, st.laneD, o.attackMult / o.defenseMult, o.attackerMoto ?? 1, random);
    const toA = laneDamage(o, st.D, st.laneD, st.aimD, st.A, st.laneA, o.defenderAttack, o.defenderMoto ?? 1, random);
    applyDamage(st.D, toD, o.units, random);
    applyDamage(st.A, toA, o.units, random);
    st.round++;
    st.rounds.push({ A: { ...st.A }, D: { ...st.D }, toA, toD });
    st.done = !count(st.A) || !count(st.D) || st.round >= MAX_ROUNDS;
    // AI 那一方每打完一合，照對手目前的排法重新排成剋制位置（o.adapt：'A'、'D'、'AD' 或 ''，預設守方）
    // 打完才反應，所以玩家換排後至少有一合是用新排法打
    if (!st.done) for (const side of o.adapt ?? 'D') {
      const lanes = side === 'A' ? st.laneA : st.laneD;
      const next = counterLanes(side === 'A' ? st.A : st.D, side === 'A' ? st.laneD : st.laneA, o.units, o.counters);
      while (next.length < lanes.length) next.push(null);
      if (next.join() !== lanes.join()) { lanes.splice(0, lanes.length, ...next); st.adapted = st.round; }
    }
    return st;
  }
  // 換排：把自己的第 i 排和第 j 排對調（side = 'A' 攻方、'D' 守方）
  function swap(st, side, i, j) {
    const lanes = side === 'A' ? st.laneA : st.laneD;
    if (st.done || i === j || i < 0 || j < 0 || i >= lanes.length || j >= lanes.length) return false;
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    return true;
  }
  // 指定攻擊目標：side 方的 kind 那一排改打敵方 foeKind 那一排；foeKind 為 null 則恢復打正對面
  function aim(st, side, kind, foeKind) {
    const aims = side === 'A' ? st.aimA : st.aimD, mine = side === 'A' ? st.A : st.D, foe = side === 'A' ? st.D : st.A;
    if (st.done || !(mine[kind] > 0)) return false;
    if (foeKind === null || aims[kind] === foeKind) delete aims[kind];
    else if (foe[foeKind] > 0) aims[kind] = foeKind;
    else return false;
    return true;
  }
  function finish(st, retreated = false) {
    const win = !retreated && count(st.D) === 0 && count(st.A) > 0;
    return { A: { ...st.A }, D: { ...st.D }, win, retreated, rounds: st.rounds,
      lostA: st.a0 - count(st.A), lostD: st.d0 - count(st.D) };
  }
  function resolve(options, random = Math.random) {
    const st = setup(options);
    while (!st.done) step(st, options, random);
    return finish(st);
  }

  // Seeded local RNG: opening the dialog never consumes the game's randomness.
  function estimate(options, trials = 160) {
    let seed = 246813579, wins = 0, lostA = 0, lostD = 0;
    const random = () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < trials; i++) {
      const result = resolve(options, random);
      wins += Number(result.win);
      lostA += result.lostA;
      lostD += result.lostD;
    }
    return { chance: Math.round(wins / trials * 100), lostA: Math.round(lostA / trials), lostD: Math.round(lostD / trials) };
  }
  return { plan, planSize, validDeployment, setup, step, swap, aim, finish, resolve, estimate, count };
})();
if (typeof module !== 'undefined') module.exports = Combat;
