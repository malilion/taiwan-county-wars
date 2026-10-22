// Versioned local checkpoints; loading returns fresh data, never DOM/HTML.
const GameSaves = (() => {
  const PREFIX = 'taiwan-war:v1:';
  const FIELDS = ['mode', 'player', 'diffKey', 'day', 'turnIdx', 'current', 'sel', 'sendHalf', 'owner', 'army', 'money', 'research', 'aggr', 'units', 'unitSeq', 'skillReady', 'buff', 'stun', 'order', 'slots', 'buildings', 'invasion', 'posture'];
  const integer = (n, max = 1000000000) => Number.isInteger(n) && n >= 0 && n <= max;
  const record = v => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => !['__proto__', 'constructor', 'prototype'].includes(k));
  function encode(state, logs = []) {
    const data = Object.fromEntries(FIELDS.map(k => [k, state[k]]));
    data.diffKey = state.gameDiffKey || state.diffKey;
    data.acted = [...state.acted];
    data.library = [...state.library];
    return JSON.stringify({ version: 1, savedAt: new Date().toISOString(), data, logs });
  }
  function decode(text, rules) {
    if (!text || text.length > 500000) throw new Error('找不到可用存檔');
    const save = JSON.parse(text), s = save.data;
    const ids = rules.counties, hasId = id => ids.includes(id), hasSkill = key => Object.hasOwn(rules.skills, key);
    const allIds = obj => record(obj) && Object.keys(obj).length === ids.length && ids.every(id => Object.hasOwn(obj, id));
    if (save.version !== 1 || !Number.isFinite(Date.parse(save.savedAt)) || !record(s)
      || s.mode !== 'play' || !hasId(s.player) || s.current !== s.player
      || !Object.hasOwn(rules.difficulties, s.diffKey) || !integer(s.day) || s.day < 1
      || !integer(s.turnIdx, ids.length - 1) || !Array.isArray(s.order) || s.order.length !== ids.length
      || new Set(s.order).size !== ids.length || !s.order.every(hasId) || s.order[s.turnIdx] !== s.player
      || (s.sel !== null && !hasId(s.sel)) || typeof s.sendHalf !== 'boolean'
      || !integer(s.unitSeq, ids.length * rules.maxCustom) || !record(s.units)) throw new Error('存檔格式不相容');
    s.posture ??= Object.fromEntries(ids.map(id => [id, 'balanced']));
    s.invasion ??= null; // Existing v1 county saves remain loadable.
    const enemyUnits = rules.enemyUnits || {};
    for (const [key, unit] of Object.entries(enemyUnits)) if (!Object.hasOwn(s.units, key)) s.units[key] = { ...unit };
    if (!rules.baseUnits.every(k => Object.hasOwn(s.units, k)) || Object.keys(s.units).length > rules.baseUnits.length + Object.keys(enemyUnits).length + ids.length * rules.maxCustom) throw new Error('兵種資料不完整');
    for (const [k, u] of Object.entries(s.units)) {
      if (!record(u) || (!rules.baseUnits.includes(k) && !Object.hasOwn(enemyUnits, k) && !/^u[1-9]\d*$/.test(k))
        || (!rules.baseUnits.includes(k) && !Object.hasOwn(enemyUnits, k) && Number(k.slice(1)) > s.unitSeq)
        || !(rules.classes || rules.baseUnits).includes(u.cls) || !(u.owner === null || hasId(u.owner))
        || typeof u.name !== 'string' || u.name.length > 50 || typeof u.desc !== 'string' || u.desc.length > 200
        || !integer(u.atk, 1000) || u.atk < 1 || !integer(u.hp, 1000) || u.hp < 1
        || !integer(u.cost, 10000) || u.cost < 1 || !rules.icons.includes(u.icon)
        || (u.sprite !== undefined && !rules.sprites.includes(u.sprite))) throw new Error('兵種資料損毀');
    }
    for (const field of ['owner', 'army', 'money', 'research', 'aggr', 'buildings', 'posture']) if (!allIds(s[field])) throw new Error('縣市資料不完整');
    for (const id of ids) {
      if (!['balanced', 'guard', 'assault'].includes(s.posture[id])) throw new Error('駐防姿態損毀');
      const facility = s.buildings[id];
      if (facility !== null && (!record(facility) || !Object.hasOwn(rules.buildings, facility.type) || !integer(facility.readyDay))) throw new Error('設施資料損毀');
      if (!hasId(s.owner[id]) || !record(s.army[id]) || Object.entries(s.army[id]).some(([k, n]) => !Object.hasOwn(s.units, k) || !integer(n, 25))
        || Object.values(s.army[id]).reduce((a, b) => a + b, 0) > 25 || !integer(s.money[id])
        || !record(s.research[id]) || !['atk', 'def', 'eco'].every(k => integer(s.research[id][k], 5))
        || !Number.isFinite(s.aggr[id]) || s.aggr[id] < 1 || s.aggr[id] > 2) throw new Error('縣市數值損毀');
    }
    if (s.invasion !== null && (!rules.validateInvasion?.(s.invasion, s.day) || !ids.every(id => s.owner[id] === s.player))) throw new Error('入侵進度損毀');
    if (!ids.some(id => s.owner[id] === s.player) || (new Set(Object.values(s.owner)).size < 2 && s.invasion === null)
      || !Array.isArray(s.acted) || !s.acted.every(hasId) || !Array.isArray(s.library) || !s.library.every(hasSkill)
      || !record(s.slots) || !record(s.skillReady) || !record(s.buff) || !record(s.stun)) throw new Error('回合資料損毀');
    for (const [id, slots] of Object.entries(s.slots)) {
      if (!hasId(id) || s.owner[id] !== s.player || !Array.isArray(slots) || slots.length !== 2 || slots[0] !== id
        || (slots[1] !== null && (!hasSkill(slots[1]) || !s.library.includes(slots[1])))) throw new Error('技能欄損毀');
    }
    if (ids.some(id => s.owner[id] === s.player && !Object.hasOwn(s.slots, id))) throw new Error('技能欄不完整');
    for (const [key, n] of Object.entries(s.skillReady)) if (!/^([a-z]+):[01]$/.test(key) || !hasId(key.split(':')[0]) || !integer(n)) throw new Error('技能冷卻損毀');
    for (const [id, n] of Object.entries(s.stun)) if (!hasId(id) || !integer(n)) throw new Error('狀態資料損毀');
    for (const [id, b] of Object.entries(s.buff)) {
      if (!hasId(id) || !record(b) || Object.keys(b).some(k => !['atk', 'def', 'defUntil'].includes(k))
        || ['atk', 'def'].some(k => b[k] !== undefined && (!Number.isFinite(b[k]) || b[k] < 1 || b[k] > 10))
        || (b.def !== undefined && !integer(b.defUntil))) throw new Error('加成資料損毀');
    }
    if (!Array.isArray(save.logs) || save.logs.length > 120 || save.logs.some(l => typeof l !== 'string' || l.length > 2000)) throw new Error('戰報資料損毀');
    // Drop unknown fields rather than merging arbitrary input into live state.
    const clean = Object.fromEntries(FIELDS.map(k => [k, s[k]]));
    clean.acted = new Set(s.acted);
    clean.library = new Set(s.library);
    return { data: clean, logs: save.logs, savedAt: save.savedAt };
  }
  function read(storage, slot, rules) { return decode(storage.getItem(PREFIX + slot), rules); }
  function write(storage, slot, state, logs) { storage.setItem(PREFIX + slot, encode(state, logs)); }
  return { encode, decode, read, write };
})();
if (typeof module !== 'undefined') module.exports = GameSaves;
