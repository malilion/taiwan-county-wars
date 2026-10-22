// Optional post-unification campaign. Off-map bases keep the 22-county map intact.
const Invasion = (() => {
  const PORTS = ['keelung', 'kaohsiung', 'hualien'];
  const SITES = {
    north: { name: '北方蟲洞', port: 'keelung', icon: '🌀' },
    south: { name: '南海前哨', port: 'kaohsiung', icon: '🛸' },
    east: { name: '東海巢穴', port: 'hualien', icon: '☄️' },
    core: { name: '外星母艦', port: null, icon: '👾' },
  };
  const UNITS = {
    invader: { name: '外星突擊兵', icon: '👾', cost: 30, atk: 8, hp: 9, cls: 'inf', owner: null, desc: '外星步兵，受重甲系剋制' },
    saucer: { name: '飛碟砲台', icon: '🛸', cost: 50, atk: 14, hp: 7, cls: 'art', owner: null, desc: '遠程火力，受機動系剋制' },
    overlord: { name: '母艦守衛', icon: '🦑', cost: 100, atk: 18, hp: 24, cls: 'gen', owner: null, desc: '母艦重甲守衛，受火砲系剋制' },
  };
  function create(day, difficulty) {
    const n = { easy: 7, normal: 9, hard: 11 }[difficulty] || 9;
    return { status: 'active', startDay: day, lastRaidDay: day, shield: 100, cleared: [], sites: {
      north: { invader: n, saucer: 4 }, south: { invader: n - 2, saucer: 6 },
      east: { invader: n, overlord: 3 }, core: { invader: 5, saucer: 7, overlord: 8 },
    } };
  }
  const unlocked = (state, site) => Object.hasOwn(SITES, site) && (site !== 'core' || ['north', 'south', 'east'].every(id => state.cleared.includes(id)));
  const due = (state, day) => state.status === 'active' && day - state.lastRaidDay >= 3;
  function wave(state) {
    const level = Math.min(6, state.cleared.length);
    return { invader: 6 + level, saucer: 3 + Math.floor(level / 2) };
  }
  function validate(state, day) {
    if (state === null) return true;
    const int = n => Number.isInteger(n) && n >= 0;
    if (!state || state.status !== 'active' || !int(state.startDay) || state.startDay < 1 || state.startDay > day
      || !int(state.lastRaidDay) || state.lastRaidDay < state.startDay || state.lastRaidDay > day
      || !int(state.shield) || state.shield < 1 || state.shield > 100
      || !Array.isArray(state.cleared) || new Set(state.cleared).size !== state.cleared.length
      || state.cleared.some(id => !Object.hasOwn(SITES, id)) || state.cleared.includes('core')
      || !state.sites || Object.keys(state.sites).length !== 4) return false;
    for (const id of Object.keys(SITES)) {
      const army = state.sites[id];
      if (!army || typeof army !== 'object' || Array.isArray(army) || Object.entries(army).some(([k, n]) => !Object.hasOwn(UNITS, k) || !int(n) || n > 25)) return false;
      const total = Object.values(army).reduce((a, b) => a + b, 0);
      if (total > 25 || (total === 0) !== state.cleared.includes(id)) return false;
    }
    return true;
  }
  return { PORTS, SITES, UNITS, create, unlocked, due, wave, validate };
})();
if (typeof module !== 'undefined') module.exports = Invasion;
