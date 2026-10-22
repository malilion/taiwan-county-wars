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

  function resolve({ sent, defenders, units, counters, attackMult, defenseMult, defenderAttack, attackerMoto = 1, defenderMoto = 1 }, random = Math.random) {
    const A = { ...sent }, D = { ...defenders };
    const a0 = count(A), d0 = count(D);
    function damage(from, to, mult, moto) {
      const total = count(to), out = {};
      if (!total) return out;
      for (const k of kinds(from)) {
        const dmg = from[k] * units[k].atk * mult * (units[k].cls === 'moto' ? moto : 1) * (0.8 + random() * 0.4) * 0.35;
        for (const j of kinds(to)) out[j] = (out[j] || 0) + dmg * to[j] / total * (counters[units[k].cls] === units[j].cls ? 1.6 : 1);
      }
      return out;
    }
    function apply(army, amounts) {
      for (const k of kinds(army)) {
        const x = (amounts[k] || 0) / units[k].hp;
        const kills = Math.floor(x) + (random() < x % 1 ? 1 : 0);
        army[k] -= Math.min(kills, army[k]);
      }
    }
    for (let round = 0; round < 8 && count(A) > a0 * 0.35 && count(D); round++) {
      const toD = damage(A, D, attackMult / defenseMult, attackerMoto);
      const toA = damage(D, A, defenderAttack, defenderMoto);
      apply(D, toD);
      apply(A, toA);
    }
    return { A, D, win: count(D) === 0 && count(A) > 0, lostA: a0 - count(A), lostD: d0 - count(D) };
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
  return { plan, validDeployment, resolve, estimate, count };
})();
if (typeof module !== 'undefined') module.exports = Combat;
