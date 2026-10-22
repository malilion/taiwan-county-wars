const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Combat = require('../js/combat.js');
const GameSaves = require('../js/saves.js');

function fixture() {
  class Element {
    constructor() { this.children = []; this.hidden = true; this.style = {}; this.dataset = {}; this.handlers = {}; this.classList = { toggle() {}, add() {}, remove() {} }; }
    set innerHTML(value) { this.html = value; this.children = []; }
    get innerHTML() { return this.html || ''; }
    get textContent() { return this.text ?? this.innerHTML.replace(/<[^>]*>/g, ''); }
    set textContent(v) { this.text = String(v); }
    get lastChild() { return this.children.at(-1); }
    appendChild(el) { this.children.push(el); el.parent = this; return el; }
    prepend(el) { this.children.unshift(el); el.parent = this; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(e => e !== this); }
    replaceChildren() { this.children = []; }
    addEventListener(event, fn) { this.handlers[event] = fn; }
    querySelectorAll() { return []; }
    setAttribute() {}
    focus() {}
  }
  const knownIds = new Set([...fs.readFileSync('index.html', 'utf8').matchAll(/id="([^"]+)"/g)].map(m => '#' + m[1]));
  const elements = new Map(), get = id => { if (!knownIds.has(id)) throw Error('Missing DOM element: ' + id); if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const timers = [], storage = new Map();
  const context = vm.createContext({
    console, harness: {}, confirm: () => true,
    document: { querySelector: get, querySelectorAll: () => [], addEventListener() {}, createElement: () => new Element() },
    window: { addEventListener() {} }, localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    MAP_W: 640, MAP_H: 830, svgEl: () => new Element(), buildMinimap() {},
  });
  vm.runInContext(fs.readFileSync('js/data.js', 'utf8'), context);
  for (const file of ['combat', 'invasion', 'saves']) vm.runInContext(fs.readFileSync(`js/${file}.js`, 'utf8'), context);
  vm.runInContext(`function buildMap() {
    const make = () => document.createElement('g');
    return { groups: Object.fromEntries(COUNTIES.map(c => [c.id, make()])),
      labels: Object.fromEntries(COUNTIES.map(c => [c.id, { dot: make(), num: make(), g: make() }])),
      labelPos: Object.fromEntries(COUNTIES.map(c => [c.id, [0, 0]])), borders: [], fx: make(),
      cards: Object.fromEntries(COUNTIES.map(c => [c.id, { tag: make(), name: make(), g: make(), cells: [], skills: [] }])),
      view: { set() {}, onChange() {}, zoomTo() {} } };
  }`, context);
  let source = fs.readFileSync('js/game.js', 'utf8');
  const at = source.lastIndexOf('})();');
  source = source.slice(0, at) + `Object.assign(harness, { S, initState, runLoop, endPlayerTurn, doAttack, saveCheckpoint, loadCheckpoint, saveRules, render, buildFacility, produceBuildings, income, defMult, openAttack, showStart, newGame, recruit, confirmTransfer, checkEnd, startInvasion, doExpedition, invasionRaid, expeditionAllowed, borderThreat, setPosture, atkMult, aiTurn, BV, startAim, aimAt, pickedArmy, nextTurn, openSkillPicker, useSkill, aiUseSkills });` + source.slice(at);
  vm.runInContext(source, context);
  const h = context.harness;
  h.initState('play', 'taipei');
  Object.assign(h.S, { current: 'taipei', diff: vm.runInContext('DIFFICULTY.easy', context), diffKey: 'easy', menuOpen: false });
  h.S.order = ['taipei', ...h.S.order.filter(x => x !== 'taipei')];
  return { h, context, elements, storage, get, timers, async flush() { for (let i = 0; i < 100; i++) { if (timers.length) timers.shift()(); await Promise.resolve(); } } };
}
const dataContext = vm.createContext({});
vm.runInContext(fs.readFileSync('js/data.js', 'utf8') + '\nthis.data = { UNITS, COUNTERS };', dataContext);
const { UNITS: units, COUNTERS: counters } = dataContext.data;
const options = (sent, defenders) => ({ sent, defenders, units, counters, attackMult: 1, defenseMult: 1, defenderAttack: 1 });

test('deployment preserves a home defender for full, half and singleton armies', () => {
  const army = { inf: 6, moto: 2, gen: 1 };
  assert.equal(Combat.count(Combat.plan(army, units)), 8);
  assert.equal(Combat.count(Combat.plan({ inf: 1 }, units)), 0);
  assert.equal(Combat.count(Combat.plan({ inf: 1, moto: 1 }, units, true)), 1);
  assert.deepEqual(army, { inf: 6, moto: 2, gen: 1 });
  assert.equal(Combat.validDeployment(army, { inf: 99 }, units), false);
  assert.equal(Combat.validDeployment(army, { inf: -1 }, units), false);
  assert.equal(Combat.validDeployment(army, { inf: 0.5 }, units), false);
  assert.equal(Combat.validDeployment(army, {}, units), false);
});
test('combat conserves survivors and casualties without mutating armies', () => {
  const a = { moto: 10 }, d = { art: 10 };
  const r = Combat.resolve(options(a, d), () => 0.5);
  assert.equal(Combat.count(r.A) + r.lostA, 10);
  assert.equal(Combat.count(r.D) + r.lostD, 10);
  assert.deepEqual(a, { moto: 10 }); assert.deepEqual(d, { art: 10 });
  assert.ok(r.lostD > Combat.resolve({ ...options(a, d), counters: {} }, () => 0.5).lostD, 'counter bonus should increase defender casualties');
  assert.equal(Combat.resolve(options({ inf: 3 }, {})).win, true);
});
test('forecast is repeatable and stronger armies have better outcomes', () => {
  const a = Combat.estimate(options({ inf: 1 }, { gen: 20 }));
  const b = Combat.estimate(options({ elite: 20 }, { inf: 1 }));
  assert.ok(b.chance > a.chance);
  assert.deepEqual(b, Combat.estimate(options({ elite: 20 }, { inf: 1 })));
});
test('checkpoint round trip includes custom units, skills, buildings and used actions', () => {
  const { h } = fixture();
  h.S.units.u1 = { ...h.S.units.elite, sprite: undefined, owner: 'taipei', name: '神將小隊' };
  h.S.unitSeq = 1; h.S.army.taipei.u1 = 2;
  h.S.acted.add('taipei'); h.S.skillReady['taipei:1'] = 5;
  h.S.buildings.taipei = { type: 'barracks', readyDay: 4 };
  const loaded = GameSaves.decode(GameSaves.encode(h.S, ['測試戰報']), h.saveRules);
  assert.equal(loaded.data.army.taipei.u1, 2);
  assert.ok(loaded.data.acted.has('taipei'));
  assert.deepEqual([...loaded.data.slots.taipei], [...h.S.slots.taipei]);
  assert.deepEqual([...loaded.data.slots.tainan], [...h.S.slots.tainan], 'AI counties keep their custom skill');
  assert.equal(loaded.data.buildings.taipei.readyDay, 4);
  assert.equal(loaded.data.skillReady['taipei:1'], 5);
});
test('malformed checkpoints are rejected before touching live state', () => {
  const { h } = fixture();
  const baseline = JSON.parse(GameSaves.encode(h.S));
  for (const corrupt of [s => s.version = 99, s => s.data.army.taipei.inf = 26, s => s.data.current = 'tainan',
    s => s.data.units.inf.hp = 0, s => s.data.order[0] = 'unknown', s => s.data.library.push('unknown'),
    s => s.data.buildings.taipei = { type: 'unknown', readyDay: 4 }]) {
    const save = structuredClone(baseline); corrupt(save);
    assert.throws(() => GameSaves.decode(JSON.stringify(save), h.saveRules));
  }
});
test('loading neither grants tax twice nor forgets used actions; manual slot survives autosave', () => {
  const { h, storage } = fixture();
  h.S.money.taipei = 123; h.S.acted.add('taipei');
  assert.ok(h.saveCheckpoint('manual'));
  h.S.money.taipei = 456; h.saveCheckpoint('auto');
  h.loadCheckpoint('manual');
  assert.equal(h.S.money.taipei, 123); assert.ok(h.S.acted.has('taipei'));
  assert.equal(JSON.parse(storage.get('taiwan-war:v1:manual')).data.money.taipei, 123);
});
test('busy/AI phases cannot overwrite a stable checkpoint; storage failure is recoverable', () => {
  const { h, context, storage } = fixture();
  h.saveCheckpoint('auto'); const previous = storage.get('taiwan-war:v1:auto');
  h.S.busy = true; h.S.money.taipei = 999;
  assert.equal(h.saveCheckpoint('auto'), false);
  assert.equal(storage.get('taiwan-war:v1:auto'), previous);
  h.S.busy = false; context.localStorage.setItem = () => { throw Error('denied'); };
  assert.equal(h.saveCheckpoint('manual'), false);
});
test('building prices, income, defense and elite unlock affect actual game rules', () => {
  const { h } = fixture(); h.S.money.taipei = 1000;
  const baseIncome = h.income('taipei'), baseDefense = h.defMult('taipei', 'taipei');
  assert.ok(h.buildFacility('taipei', 'market'));
  assert.equal(h.income('taipei'), baseIncome + 15); assert.equal(h.S.money.taipei, 880);
  assert.equal(h.buildFacility('taipei', 'fort'), false, 'one building per county');
  h.S.buildings.taipei = null; h.buildFacility('taipei', 'fort');
  assert.equal(h.defMult('taipei', 'taipei'), baseDefense * 1.2);
  h.S.buildings.taipei = null;
  assert.equal(h.buildFacility('taipei', 'summon'), false);
  h.S.research.taipei.atk = h.S.research.taipei.def = 5;
  assert.ok(h.buildFacility('taipei', 'summon'));
});
test('summoning uses fifteen-day timer, blocks at cap and resumes when room opens', () => {
  const { h } = fixture();
  h.S.money.taipei = 1000; h.S.research.taipei.atk = h.S.research.taipei.def = 5;
  h.buildFacility('taipei', 'summon');
  h.S.day = 15; h.produceBuildings('taipei'); assert.equal(h.S.army.taipei.elite, undefined);
  h.S.day = 16; h.S.army.taipei = { inf: 25 }; h.produceBuildings('taipei');
  assert.equal(h.S.buildings.taipei.readyDay, 16);
  h.S.army.taipei.inf = 24; h.produceBuildings('taipei');
  assert.equal(h.S.army.taipei.elite, 1); assert.equal(h.S.buildings.taipei.readyDay, 31);
  h.produceBuildings('taipei'); assert.equal(h.S.army.taipei.elite, 1);
});
test('canceling deployment spends neither troops nor actions', () => {
  const { h, get } = fixture(); const before = JSON.stringify(h.S.army.taipei);
  h.openAttack('taipei', 'newtaipei');
  get('#attackCancel').handlers.click();
  assert.equal(JSON.stringify(h.S.army.taipei), before); assert.equal(h.S.acted.size, 0);
});
test('a live attack captures an empty county, preserves garrison and resets captured production', async () => {
  const f = fixture(), { h } = f;
  h.S.army.newtaipei = {}; h.S.buildings.newtaipei = { type: 'barracks', readyDay: 1 };
  const result = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 3 });
  await f.flush(); await result;
  assert.equal(h.S.owner.newtaipei, 'taipei'); assert.equal(h.S.army.taipei.inf, 3);
  assert.equal(h.S.army.newtaipei.inf, 3); assert.ok(h.S.acted.has('newtaipei'));
  assert.equal(h.S.buildings.newtaipei.readyDay, 4);
});
test('a battle waiting on animation cannot mutate a replacement game', async () => {
  const f = fixture(), { h } = f;
  const old = h.doAttack('taipei', 'newtaipei', h.S.gen);
  ++h.S.gen; h.initState('play', 'tainan');
  const before = JSON.stringify({ owner: h.S.owner, army: h.S.army, money: h.S.money });
  await f.flush(); await old;
  assert.equal(JSON.stringify({ owner: h.S.owner, army: h.S.army, money: h.S.money }), before);
});
test('ending a turn cannot launch a stale loop after replacement', async () => {
  const { h } = fixture();
  h.endPlayerTurn(); ++h.S.gen; h.initState('play', 'tainan');
  const money = h.S.money.tainan;
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.S.current, null); assert.equal(h.S.money.tainan, money);
});

test('failed attack returns survivors and consumes only one county action', async () => {
  const f = fixture(), { h } = f;
  h.S.army.taipei = { inf: 5 }; h.S.army.newtaipei = { elite: 25 };
  const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 2 });
  await f.flush(); await battle;
  assert.equal(h.S.owner.newtaipei, 'newtaipei');
  assert.equal(h.S.army.taipei.inf, 3 + Combat.count(h.S.lastBattle.A));
  assert.equal(h.S.acted.size, 1);
});
test('menu difficulty selection cannot alter the saved active difficulty', () => {
  const { h } = fixture();
  h.S.gameDiffKey = 'easy'; h.S.diffKey = 'hard';
  const save = GameSaves.decode(GameSaves.encode(h.S), h.saveRules);
  assert.equal(save.data.diffKey, 'easy');
});
test('a full AI day completes and produces a valid next-player checkpoint', async () => {
  const f = fixture(), { h } = f;
  h.endPlayerTurn();
  for (let i = 0; i < 30 && h.S.current !== 'taipei'; i++) await f.flush();
  assert.equal(h.S.current, 'taipei'); assert.equal(h.S.day, 2);
  const save = GameSaves.read(f.context.localStorage, 'auto', h.saveRules);
  assert.equal(save.data.day, 2); assert.equal(save.data.current, 'taipei');
  for (const army of Object.values(h.S.army)) assert.ok(Combat.count(army) <= 25);
});

const Invasion = require('../js/invasion.js');
function unifiedFixture() {
  const f = fixture(), s = f.h.S;
  for (const id of Object.keys(s.owner)) {
    s.owner[id] = s.player;
    s.slots[id] = [id, null];
    s.library.add(id);
  }
  return f;
}
test('unification offers an optional final campaign without replacing the county victory', () => {
  const { h, get } = unifiedFixture();
  h.checkEnd();
  assert.equal(h.S.over, true); assert.equal(h.S.invasion, null);
  assert.equal(get('#invasionBtn').hidden, false);
  const generation = h.S.gen;
  h.startInvasion();
  assert.equal(h.S.over, false); assert.equal(h.S.gen, generation + 1);
  assert.equal(h.S.invasion.shield, 100); assert.equal(h.S.current, 'taipei');
  assert.ok(h.S.acted.size === 0);
});

test('invasion cannot start before unification or start twice', () => {
  const f = fixture(); f.h.S.over = true; f.h.startInvasion();
  assert.equal(f.h.S.invasion, null);
  const { h } = unifiedFixture(); h.checkEnd(); h.startInvasion();
  const inv = h.S.invasion; h.startInvasion(); assert.equal(h.S.invasion, inv);
});
test('base locks and departure ports enforce the final campaign sequence', () => {
  const { h } = unifiedFixture(); h.checkEnd(); h.startInvasion();
  h.S.army.keelung = { elite: 24 }; h.S.army.kaohsiung = { elite: 24 };
  assert.equal(h.expeditionAllowed('keelung', 'core'), false);
  assert.equal(h.expeditionAllowed('kaohsiung', 'north'), false);
  assert.equal(h.expeditionAllowed('keelung', 'north'), true);
  h.S.acted.add('keelung'); assert.equal(h.expeditionAllowed('keelung', 'north'), false);
  h.S.acted.clear(); h.S.stun.keelung = h.S.day;
  assert.equal(h.expeditionAllowed('keelung', 'north'), false);
});
test('a successful expedition returns survivors, gives one reward and consumes one action', async () => {
  const f = unifiedFixture(), { h } = f; h.checkEnd(); h.startInvasion();
  h.S.army.keelung = { elite: 25 }; h.S.invasion.sites.north = { invader: 1 };
  h.S.invasion.shield = 70;
  const money = h.S.money.taipei;
  const battle = h.doExpedition('keelung', 'north', { elite: 24 }, h.S.gen);
  const second = h.doExpedition('keelung', 'north', { elite: 24 }, h.S.gen);
  await f.flush(); await battle; await second;
  assert.ok(h.S.invasion.cleared.includes('north'));
  assert.equal(h.S.money.taipei, money + 120); assert.equal(h.S.invasion.shield, 80);
  assert.ok(Combat.count(h.S.army.keelung) <= 25);
  assert.ok(h.S.acted.has('keelung')); assert.equal(h.S.busy, false);
  h.S.acted.clear(); assert.equal(h.expeditionAllowed('keelung', 'north'), false);
});
test('failed expeditions preserve enemy casualties for the next sortie', async () => {
  const f = unifiedFixture(), { h } = f; h.checkEnd(); h.startInvasion();
  h.S.army.keelung = { art: 6, inf: 1 }; h.S.invasion.sites.north = { overlord: 20 };
  const battle = h.doExpedition('keelung', 'north', { art: 6 }, h.S.gen);
  await f.flush(); await battle;
  assert.equal(h.S.invasion.cleared.length, 0);
  assert.ok(Combat.count(h.S.invasion.sites.north) < 20);
  assert.equal(h.S.army.keelung.inf, 1);
});
test('raids allow three preparation days, happen once per scheduled day and honor defenses', () => {
  const { h } = unifiedFixture(); h.checkEnd(); h.startInvasion(); h.S.speed = 99;
  for (const port of Invasion.PORTS) h.S.army[port] = {};
  h.S.day += 2; h.invasionRaid(); assert.equal(h.S.invasion.shield, 100);
  h.S.day += 1; h.invasionRaid(); assert.equal(h.S.invasion.shield, 82);
  h.invasionRaid(); assert.equal(h.S.invasion.shield, 82);
  for (const port of Invasion.PORTS) { h.S.army[port] = { elite: 25 }; h.S.buildings[port] = { type: 'fort', readyDay: 1 }; }
  h.S.research.taipei.atk = h.S.research.taipei.def = 5;
  h.S.day += 3; h.invasionRaid(); assert.equal(h.S.invasion.shield, 78);
});
test('shield collapse shows a final defeat and leaves the previous checkpoint available', () => {
  const { h, get, storage } = unifiedFixture(); h.checkEnd(); h.startInvasion();
  const previous = storage.get('taiwan-war:v1:auto');
  for (const port of Invasion.PORTS) h.S.army[port] = {};
  h.S.speed = 99; h.S.invasion.shield = 10; h.S.day += 3; h.invasionRaid();
  assert.equal(h.S.over, true); assert.equal(h.S.invasion.status, 'lost');
  assert.match(get('#endTitle').textContent, /防線/);
  assert.equal(storage.get('taiwan-war:v1:auto'), previous);
});
test('destroying the core ends the final campaign with a distinct victory', async () => {
  const f = unifiedFixture(), { h, get } = f; h.checkEnd(); h.startInvasion();
  h.S.invasion.cleared = ['north', 'south', 'east'];
  for (const id of h.S.invasion.cleared) h.S.invasion.sites[id] = {};
  h.S.invasion.sites.core = { invader: 1 }; h.S.army.keelung = { elite: 25 };
  const battle = h.doExpedition('keelung', 'core', { elite: 24 }, h.S.gen);
  await f.flush(); await battle;
  assert.equal(h.S.invasion.status, 'won'); assert.equal(h.S.over, true);
  assert.match(get('#endTitle').textContent, /守衛戰成功/);
  assert.equal(get('#invasionBtn').hidden, true);
});
test('final campaign checkpoint round trip preserves raid timer, damage, bases and actions', () => {
  const { h } = unifiedFixture(); h.checkEnd(); h.startInvasion();
  h.S.day += 4; h.S.invasion.lastRaidDay += 3; h.S.invasion.shield = 64;
  h.S.invasion.cleared.push('north'); h.S.invasion.sites.north = {};
  h.S.invasion.sites.south.invader = 2; h.S.acted.add('keelung');
  assert.ok(h.saveCheckpoint('manual'));
  h.S.invasion.shield = 99; h.loadCheckpoint('manual');
  assert.equal(h.S.invasion.shield, 64); assert.equal(h.S.invasion.sites.south.invader, 2);
  assert.equal(h.S.invasion.lastRaidDay, 4); assert.ok(h.S.acted.has('keelung'));
});
test('old v1 saves migrate enemy definitions; malformed invasion progress is rejected', () => {
  const { h } = fixture(), old = JSON.parse(GameSaves.encode(h.S));
  delete old.data.invasion;
  for (const key of Object.keys(Invasion.UNITS)) delete old.data.units[key];
  const loaded = GameSaves.decode(JSON.stringify(old), h.saveRules);
  assert.equal(loaded.data.invasion, null); assert.ok(loaded.data.units.invader);
  const f = unifiedFixture(); f.h.checkEnd(); f.h.startInvasion();
  const valid = JSON.parse(GameSaves.encode(f.h.S));
  for (const corrupt of [s => s.invasion.shield = -1, s => s.invasion.cleared.push('core'),
    s => s.invasion.sites.core.invader = 99, s => s.invasion.lastRaidDay = s.day + 1,
    s => s.invasion.cleared.push('north'), s => s.owner.keelung = 'keelung']) {
    const copy = structuredClone(valid); corrupt(copy.data);
    assert.throws(() => GameSaves.decode(JSON.stringify(copy), f.h.saveRules));
  }
});
test('a pending expedition cannot damage a newly started game', async () => {
  const f = unifiedFixture(), { h } = f; h.checkEnd(); h.startInvasion();
  h.S.army.keelung = { elite: 25 };
  const old = h.doExpedition('keelung', 'north', { elite: 24 }, h.S.gen);
  ++h.S.gen; h.initState('play', 'tainan');
  const armies = JSON.stringify(h.S.army);
  await f.flush(); await old;
  assert.equal(h.S.invasion, null); assert.equal(JSON.stringify(h.S.army), armies);
});

test('the expedition confirmation button uses off-map battle rules', async () => {
  const f = unifiedFixture(), { h, get } = f; h.checkEnd(); h.startInvasion();
  h.S.army.keelung = { elite: 25 }; h.S.invasion.sites.north = { invader: 1 };
  h.openAttack('keelung', 'north', 'invasion');
  assert.match(get('#attackTitle').textContent, /北方蟲洞/);
  assert.match(get('#attackHint').textContent, /返港/);
  const confirm = get('#attackConfirm').handlers.click();
  await f.flush(); await confirm;
  assert.equal(get('#attackDialog').hidden, true);
  assert.ok(h.S.invasion.cleared.includes('north'));
});
test('full final-campaign turns advance raid timing without duplicating tax or air raids', async () => {
  const f = unifiedFixture(), { h } = f; h.checkEnd(); h.startInvasion();
  for (let turn = 0; turn < 3; turn++) {
    h.endPlayerTurn();
    for (let i = 0; i < 30 && h.S.current !== 'taipei'; i++) await f.flush();
  }
  assert.equal(h.S.day, 4); assert.equal(h.S.current, 'taipei');
  assert.equal(h.S.invasion.lastRaidDay, 4);
  const save = GameSaves.read(f.context.localStorage, 'auto', h.saveRules);
  assert.equal(save.data.invasion.lastRaidDay, 4);
  const money = h.S.money.taipei, shield = h.S.invasion.shield;
  h.loadCheckpoint('auto');
  assert.equal(h.S.money.taipei, money); assert.equal(h.S.invasion.shield, shield);
});

test('exact-size allocation honors the chosen number and keeps one soldier home', () => {
  const army = { inf: 9, moto: 5, gen: 3, art: 2 };
  for (const n of [0, 1, 5, 10, 15, 18, 99, -1, 3.7]) {
    const sent = Combat.planSize(army, units, n);
    assert.equal(Combat.count(sent), Math.max(0, Math.min(18, Math.floor(n))));
    for (const [k, count] of Object.entries(sent)) assert.ok(count >= 0 && count <= army[k]);
  }
  assert.equal(Combat.count(Combat.planSize({ inf: 1 }, units, 5)), 0);
});
test('total and individual number inputs clamp deployment while updating remaining defense', () => {
  const { h, get } = fixture(); h.S.diff.playerPeace = 0;
  h.S.army.taipei = { inf: 9, moto: 5 }; h.openAttack('taipei', 'newtaipei');
  get('#deploymentSize').handlers.change({ target: { value: '5' } });
  assert.equal(Combat.count(h.S.attack.sent), 5);
  assert.match(get('#reserveWarning').textContent, /9 人留守/);
  get('#attackRows').handlers.change({ target: { dataset: { amount: 'inf' }, value: '999' } });
  assert.ok(Combat.count(h.S.attack.sent) <= 13);
  assert.ok(h.S.attack.sent.inf <= 9);
  get('#attackRows').handlers.change({ target: { dataset: { amount: 'inf' }, value: '-3' } });
  assert.equal(h.S.attack.sent.inf, 0);
});
test('guard and assault affect actual attack and defense and lock after departing', () => {
  const { h } = fixture(), baseAttack = h.atkMult('taipei', 'taipei'), baseDefense = h.defMult('taipei', 'taipei');
  assert.ok(h.setPosture('taipei', 'guard'));
  assert.equal(h.atkMult('taipei', 'taipei'), baseAttack * 0.85);
  assert.equal(h.defMult('taipei', 'taipei'), baseDefense * 1.25);
  assert.ok(h.setPosture('taipei', 'assault'));
  assert.equal(h.defMult('taipei', 'taipei'), baseDefense * 0.85);
  h.S.acted.add('taipei'); assert.equal(h.setPosture('taipei', 'guard'), false);
  assert.equal(h.S.posture.taipei, 'assault');
  h.S.acted.clear(); h.S.current = 'newtaipei'; assert.equal(h.setPosture('taipei', 'guard'), false);
});
test('sending too many troops raises the visible border risk', () => {
  const { h } = fixture(); h.S.diff.playerPeace = 0;
  h.S.army.taipei = { elite: 25 }; h.S.army.newtaipei = { elite: 25 };
  const full = h.borderThreat('taipei'), depleted = h.borderThreat('taipei', { inf: 1 });
  assert.ok(depleted.threats[0].ratio > full.threats[0].ratio);
  assert.equal(depleted.level, 'high');
});
test('hostile AI can invade and capture an under-defended player county', async () => {
  const f = fixture(), { h, context } = f;
  for (const id of Object.keys(h.S.owner)) {
    h.S.owner[id] = id === 'taipei' ? 'taipei' : 'newtaipei';
    h.S.army[id] = {};
  }
  h.S.army.newtaipei = { elite: 25 }; h.S.army.taipei = { inf: 1 };
  h.S.diff = vm.runInContext('DIFFICULTY.hard', context);
  h.S.current = 'newtaipei'; h.S.acted.clear(); h.S.money.newtaipei = 0;
  const turn = h.aiTurn('newtaipei', h.S.gen);
  await f.flush(); await turn;
  assert.equal(h.S.owner.taipei, 'newtaipei'); assert.equal(h.S.over, true);
});
test('postures survive saving while old checkpoint postures default to balanced', () => {
  const { h } = fixture(); h.S.posture.taipei = 'guard';
  const saved = JSON.parse(GameSaves.encode(h.S));
  assert.equal(GameSaves.decode(JSON.stringify(saved), h.saveRules).data.posture.taipei, 'guard');
  delete saved.data.posture;
  assert.equal(GameSaves.decode(JSON.stringify(saved), h.saveRules).data.posture.taipei, 'balanced');
  saved.data.posture = Object.fromEntries(Object.keys(h.S.owner).map(id => [id, 'balanced']));
  saved.data.posture.taipei = 'invincible';
  assert.throws(() => GameSaves.decode(JSON.stringify(saved), h.saveRules));
});

// Advance fake timers until the battle screen reaches the requested clash.
async function untilStep(f, step) {
  for (let i = 0; i < 200 && !(f.h.BV.open && f.h.BV.step >= step); i++) { if (f.timers.length) f.timers.shift()(); await Promise.resolve(); }
  assert.ok(f.h.BV.open && f.h.BV.step >= step, 'battle screen should be playing');
}
test('combat rounds start from the line-up, end at the result and support retreat at any clash', () => {
  const r = Combat.resolve(options({ inf: 12, moto: 3 }, { gen: 14 }), () => 0.5);
  assert.deepEqual(r.rounds[0].A, { inf: 12, moto: 3 }); assert.deepEqual(r.rounds[0].D, { gen: 14 });
  assert.deepEqual(r.rounds.at(-1).A, r.A); assert.deepEqual(r.rounds.at(-1).D, r.D);
  const early = Combat.retreat(r, 0);
  assert.equal(early.lostA + early.lostD, 0); assert.equal(early.win, false); assert.ok(early.retreated);
  const mid = Combat.retreat(r, 1);
  assert.equal(Combat.count(mid.A) + mid.lostA, 15); assert.equal(Combat.count(mid.D) + mid.lostD, 14);
});
test('player battles open the battle screen and close it after the result', async () => {
  const f = fixture(), { h, get } = f;
  h.S.army.taipei = { inf: 10 }; h.S.army.newtaipei = { inf: 2 };
  const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 9 });
  await untilStep(f, 0);
  assert.equal(get('#battleScreen').hidden, false);
  assert.equal(get('#bsRetreat').hidden, false, 'the attacking player may retreat');
  await f.flush(); await battle;
  assert.equal(get('#battleScreen').hidden, true); assert.equal(h.BV.open, false);
});
test('strategic retreat keeps that clash\'s survivors, spares the target and uses the action', async () => {
  const f = fixture(), { h, get } = f;
  h.S.army.taipei = { inf: 21 }; h.S.army.newtaipei = { gen: 20 };
  const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 20 });
  await untilStep(f, 1);
  get('#bsRetreat').handlers.click();
  await f.flush(); await battle;
  const r = h.S.lastBattle;
  assert.ok(r.retreated); assert.equal(r.win, false);
  assert.deepEqual(r.A, r.rounds[1].A); assert.deepEqual(r.D, r.rounds[1].D);
  assert.equal(h.S.owner.newtaipei, 'newtaipei');
  assert.equal(Combat.count(h.S.army.taipei), 1 + Combat.count(r.A));
  assert.equal(Combat.count(h.S.army.newtaipei), Combat.count(r.D));
  assert.ok(h.S.acted.has('taipei'));
});
test('defending players watch without a retreat button; lightning speed and AI-only battles skip the screen', async () => {
  const f = fixture(), { h, get } = f;
  h.S.current = 'newtaipei'; h.S.army.newtaipei = { inf: 10 }; h.S.army.taipei = { inf: 5 };
  const defend = h.doAttack('newtaipei', 'taipei', h.S.gen, false, { inf: 4 });
  await untilStep(f, 0);
  assert.equal(get('#bsRetreat').hidden, true);
  await f.flush(); await defend;
  h.BV.step = 0; h.S.army.yilan = { inf: 6 }; h.S.army.hualien = { inf: 2 }; h.S.current = 'yilan';
  const aiOnly = h.doAttack('yilan', 'hualien', h.S.gen, false, { inf: 5 });
  await f.flush(); await aiOnly;
  assert.equal(h.BV.step, 0, 'AI-only battle did not play');
  h.S.speed = 99; h.S.current = 'taipei'; h.S.acted.clear();
  h.S.army.taipei = { inf: 5 }; h.S.army.newtaipei = {};
  const fast = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 2 });
  await f.flush(); await fast;
  assert.equal(h.BV.step, 0); assert.equal(get('#battleScreen').hidden, true);
});
test('replacing the game mid-playback leaves the new game untouched', async () => {
  const f = fixture(), { h } = f;
  h.S.army.taipei = { inf: 21 }; h.S.army.newtaipei = { gen: 20 };
  const old = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 20 });
  await untilStep(f, 1);
  ++h.S.gen; h.initState('play', 'tainan');
  const before = JSON.stringify({ owner: h.S.owner, army: h.S.army });
  await f.flush(); await old;
  assert.equal(JSON.stringify({ owner: h.S.owner, army: h.S.army }), before);
});

test('box-selected soldiers aim a red arrow at an enemy and prefill the attack, keeping one at home', () => {
  const { h, get } = fixture();
  h.S.army.taipei = { inf: 3, art: 2 };
  assert.deepEqual({ ...h.pickedArmy('taipei', [3, 4]) }, { art: 2 }, 'cells follow the map card order');
  assert.ok(h.startAim('taipei', [0, 1, 2, 3, 4]));
  h.aimAt('newtaipei');
  assert.equal(h.S.aim, null); assert.equal(get('#attackDialog').hidden, false);
  assert.deepEqual({ ...h.S.attack.sent }, { inf: 2, art: 2 });
  assert.deepEqual({ ...h.S.army.taipei }, { inf: 3, art: 2 }, 'nothing leaves before confirming');
  assert.equal(h.S.acted.size, 0);
});
test('a blue arrow to a connected own county moves only the picked soldiers that fit', () => {
  const { h } = fixture();
  h.S.owner.newtaipei = 'taipei'; h.S.army.newtaipei = { inf: 24 }; h.S.army.taipei = { inf: 4, moto: 2 };
  h.S.acted.add('taipei'); // moving troops is still allowed after attacking
  assert.ok(h.startAim('taipei', [4, 5]));
  h.aimAt('newtaipei');
  assert.equal(Combat.count(h.S.army.newtaipei), 25);
  assert.equal(Combat.count(h.S.army.taipei), 5);
  assert.equal(h.S.army.newtaipei.moto, 1);
});
test('invalid arrow targets keep aiming; attacks need an unused, adjacent source', () => {
  const { h, get } = fixture();
  h.S.army.taipei = { inf: 5 };
  h.startAim('taipei', [0, 1]);
  h.aimAt('pingtung');
  assert.ok(h.S.aim, 'still aiming after a far target'); assert.equal(get('#attackDialog').hidden, true);
  h.S.acted.add('taipei');
  h.aimAt('newtaipei');
  assert.ok(h.S.aim); assert.equal(get('#attackDialog').hidden, true);
  assert.equal(h.startAim('newtaipei', [0]), false, 'enemy soldiers cannot be picked');
});
test('the day ends with a news broadcast of captures and eliminations', async () => {
  const f = fixture(), { h, get } = f;
  h.S.speed = 99; h.S.army.newtaipei = {}; h.S.army.taipei = { inf: 5 };
  const attack = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 3 });
  await f.flush(); await attack;
  assert.deepEqual([...h.S.news.map(n => n.kind)], ['capture', 'elim']);
  h.S.speed = 1; h.S.turnIdx = h.S.order.length - 1;
  const day = h.S.day, done = h.nextTurn(h.S.gen);
  await Promise.resolve();
  assert.equal(get('#newsFlash').hidden, false);
  assert.match(get('#newsBody').innerHTML, /新北市<\/b> 滅亡了/);
  await f.flush(); await done;
  assert.equal(get('#newsFlash').hidden, true);
  assert.equal(h.S.day, day + 1); assert.equal(h.S.news.length, 0);
  assert.ok(get('#log').children.some(c => c.innerHTML.includes('晚間新聞')));
});

const pickSkill = (get, key) => get('#spList').handlers.click({ target: { closest: () => ({ dataset: { key } }) } });
test('every county has a fixed regional skill plus one of ten custom skills', () => {
  const { h, get, context } = fixture();
  const custom = Object.keys(vm.runInContext('COMMON_SKILLS', context));
  assert.equal(custom.length, 10);
  for (const [id, [own, extra]] of Object.entries(h.S.slots)) {
    assert.equal(own, id);
    if (id === 'taipei') assert.equal(extra, null, 'the player sets the home custom skill');
    else assert.ok(custom.includes(extra), `${id} AI custom skill`);
  }
  assert.ok(h.openSkillPicker('taipei'));
  assert.equal(get('#spList').innerHTML.match(/data-key=/g).length, 10);
  assert.equal(h.openSkillPicker('tainan'), false, 'cannot edit an enemy county');
});
test('a custom skill locks once chosen and can be used like the regional one', () => {
  const { h, get } = fixture();
  h.openSkillPicker('taipei');
  pickSkill(get, 'c_build');
  assert.equal(h.S.slots.taipei[1], 'c_build');
  assert.equal(h.openSkillPicker('taipei'), false, 'locked until the county changes hands');
  const money = h.S.money.taipei;
  assert.ok(h.useSkill('taipei', 1));
  assert.equal(h.S.money.taipei, money + 60);
  assert.equal(h.useSkill('taipei', 1), false, 'custom slot has its own cooldown');
});
test('capturing a county clears its custom skill and asks the player to choose again', async () => {
  const f = fixture(), { h, get } = f;
  h.S.army.taipei = { inf: 6 }; h.S.army.newtaipei = {};
  const aiSkill = h.S.slots.newtaipei[1];
  assert.ok(aiSkill);
  h.openAttack('taipei', 'newtaipei');
  const confirm = get('#attackConfirm').handlers.click();
  await f.flush(); await confirm;
  assert.equal(h.S.owner.newtaipei, 'taipei');
  assert.equal(h.S.slots.newtaipei[1], null);
  assert.equal(get('#skillPicker').hidden, false);
  assert.match(get('#spTitle').innerHTML, /攻下/);
  pickSkill(get, 'c_jam');
  assert.equal(h.S.slots.newtaipei[1], 'c_jam');
});
test('an AI that takes a player county picks its own custom skill', async () => {
  const f = fixture(), { h } = f;
  h.S.slots.taipei[1] = 'c_build'; h.S.speed = 99;
  h.S.current = 'newtaipei'; h.S.army.newtaipei = { gen: 20 }; h.S.army.taipei = { inf: 1 };
  const attack = h.doAttack('newtaipei', 'taipei', h.S.gen, false, { gen: 19 });
  await f.flush(); await attack;
  assert.equal(h.S.owner.taipei, 'newtaipei');
  assert.ok(h.S.slots.taipei[1] && h.S.slots.taipei[1].startsWith('c_'));
  assert.equal(h.openSkillPicker('taipei'), false);
});
test('old saves drop regional skills from custom slots and fill in AI slots', () => {
  const { h } = fixture();
  const save = JSON.parse(GameSaves.encode(h.S));
  save.data.slots = { taipei: ['taipei', 'tainan'] };
  const loaded = GameSaves.decode(JSON.stringify(save), h.saveRules);
  assert.deepEqual([...loaded.data.slots.taipei], ['taipei', null]);
  assert.deepEqual([...loaded.data.slots.kaohsiung], ['kaohsiung', null]);
  const bad = structuredClone(save); bad.data.slots.taipei = ['taipei', 'nope'];
  assert.throws(() => GameSaves.decode(JSON.stringify(bad), h.saveRules));
});

test('air raids play on the battle screen with the player defending and apply only afterwards', async () => {
  const f = unifiedFixture(), { h, get } = f; h.checkEnd(); h.startInvasion();
  for (const port of Invasion.PORTS) h.S.army[port] = { inf: 3 };
  h.S.day += 3;
  const raid = h.invasionRaid(h.S.gen);
  await untilStep(f, 0);
  assert.equal(get('#battleScreen').hidden, false);
  assert.equal(get('#bsRetreat').hidden, true, 'defenders cannot retreat');
  assert.match(get('#bsTitle').textContent, /防空戰/);
  assert.equal(h.S.busy, true, 'no orders or autosaves mid-raid');
  assert.equal(h.S.invasion.shield, 100, 'damage lands after the playback');
  await f.flush(); await raid;
  assert.equal(get('#battleScreen').hidden, true); assert.equal(h.S.busy, false);
  assert.ok(h.S.invasion.shield < 100);
  assert.match(get('#bsStamp').innerHTML, /防線突破|攔截成功/);
});
test('a raid interrupted by a new game leaves the new game untouched', async () => {
  const f = unifiedFixture(), { h } = f; h.checkEnd(); h.startInvasion();
  h.S.day += 3;
  const raid = h.invasionRaid(h.S.gen);
  await untilStep(f, 0);
  ++h.S.gen; h.initState('play', 'tainan');
  const before = JSON.stringify({ owner: h.S.owner, army: h.S.army });
  await f.flush(); await raid;
  assert.equal(JSON.stringify({ owner: h.S.owner, army: h.S.army }), before);
});
