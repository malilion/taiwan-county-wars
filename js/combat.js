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
  // 打到其中一方全滅，或打滿 TIME_LIMIT 合（時間到而雙方都還有人，守方守住）。攻方可戰略撤退。
  const CLASS_ORDER = ['inf', 'moto', 'gen', 'art'];
  const byClass = units => (a, b) => CLASS_ORDER.indexOf(units[a].cls) - CLASS_ORDER.indexOf(units[b].cls) || a.localeCompare(b);
  const TIME_LIMIT = 12; // 沙漏：打滿這麼多合仍未分出勝負，守方守住
  const MAX_ROUNDS = 200; // 再往上的安全上限
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
      rounds: [{ A: { ...A }, D: { ...D }, toA: {}, toD: {} }], done: !count(A) || !count(D),
      base: { A: { ...A }, D: { ...D } }, tacticUsed: {},
      buff: { A: { deal: 0, take: 0 }, D: { deal: 0, take: 0 } }, silence: { A: 0, D: 0 } };
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
  // 倍率 1 時原樣返回，沒有戰術的戰鬥和以前的傷害數字相同。
  function scaleDamage(amounts, mult) {
    if (mult === 1) return amounts;
    const out = {};
    for (const k of Object.keys(amounts)) out[k] = amounts[k] * mult;
    return out;
  }
  const charge = n => n > 0 ? n - 1 : 0;
  // 戰術（名稱見 data.js TACTICS）。每邊每場一次，沒有用就不影響結算。
  // fire：接下來 3 合我方傷害 ×1.5；wall：接下來 3 合我方受傷 ×0.5；
  // smoke：敵方下一合傷害 0；heal：復活本戰各兵種已損失的 30%（無條件捨去，至少 1），不超過開戰人數。
  function healSide(st, side) {
    const army = st[side], base = st.base[side];
    for (const k of Object.keys(base)) {
      const began = base[k] || 0, lost = began - (army[k] || 0);
      if (lost <= 0) continue;
      army[k] = Math.min(began, (army[k] || 0) + Math.max(1, Math.floor(lost * 3 / 10)));
    }
    const snap = st.rounds[st.round];
    if (snap) snap[side] = { ...army };
  }
  function useTactic(st, side, key) {
    if (!st || st.done || (side !== 'A' && side !== 'D')) return false;
    if (!st.tacticUsed) st.tacticUsed = {};
    if (st.tacticUsed[side]) return false;
    if (!st.buff) st.buff = { A: { deal: 0, take: 0 }, D: { deal: 0, take: 0 } };
    if (!st.silence) st.silence = { A: 0, D: 0 };
    if (!st.base) st.base = { A: { ...(st.rounds?.[0]?.A || {}) }, D: { ...(st.rounds?.[0]?.D || {}) } };
    if (key === 'fire') st.buff[side].deal = 3;
    else if (key === 'wall') st.buff[side].take = 3;
    else if (key === 'smoke') st.silence[side === 'A' ? 'D' : 'A'] = 1;
    else if (key === 'heal') healSide(st, side);
    else return false;
    st.tacticUsed[side] = key;
    return true;
  }
  // 守方 AI：兵力第一次低於開戰的一半時，城防 Lv.1 用沙包牆，否則鞭炮突擊。
  function aiTactic(st, research) {
    if (!st || st.done || st.tacticUsed?.D || !count(st.D)) return null;
    if (!(st.d0 > 0) || count(st.D) * 2 >= st.d0) return null;
    const key = (research?.def || 0) >= 1 ? 'wall' : 'fire';
    return useTactic(st, 'D', key) ? key : null;
  }
  function step(st, o, random = Math.random) {
    if (st.done) return st;
    let toD = laneDamage(o, st.A, st.laneA, st.aimA, st.D, st.laneD, o.attackMult / o.defenseMult, o.attackerMoto ?? 1, random);
    let toA = laneDamage(o, st.D, st.laneD, st.aimD, st.A, st.laneA, o.defenderAttack, o.defenderMoto ?? 1, random);
    if (st.buff && st.silence) {
      const dealA = st.buff.A.deal > 0 ? 1.5 : 1, dealD = st.buff.D.deal > 0 ? 1.5 : 1;
      const takeA = st.buff.A.take > 0 ? 0.5 : 1, takeD = st.buff.D.take > 0 ? 0.5 : 1;
      toD = scaleDamage(toD, (st.silence.A > 0 ? 0 : 1) * dealA * takeD);
      toA = scaleDamage(toA, (st.silence.D > 0 ? 0 : 1) * dealD * takeA);
      st.buff.A.deal = charge(st.buff.A.deal); st.buff.A.take = charge(st.buff.A.take);
      st.buff.D.deal = charge(st.buff.D.deal); st.buff.D.take = charge(st.buff.D.take);
      st.silence.A = charge(st.silence.A); st.silence.D = charge(st.silence.D);
    }
    applyDamage(st.D, toD, o.units, random);
    applyDamage(st.A, toA, o.units, random);
    st.round++;
    st.rounds.push({ A: { ...st.A }, D: { ...st.D }, toA, toD });
    st.done = !count(st.A) || !count(st.D) || st.round >= TIME_LIMIT || st.round >= MAX_ROUNDS;
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
    const aliveA = count(st.A) > 0, aliveD = count(st.D) > 0;
    const timeout = !retreated && aliveA && aliveD && (st.round >= TIME_LIMIT || st.round >= MAX_ROUNDS);
    const win = !retreated && !aliveD && aliveA;
    return { A: { ...st.A }, D: { ...st.D }, win, retreated, timeout, rounds: st.rounds,
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
  return { plan, planSize, validDeployment, setup, step, swap, aim, finish, resolve, estimate, count, useTactic, aiTactic, TIME_LIMIT };
})();
if (typeof module !== 'undefined') module.exports = Combat;
