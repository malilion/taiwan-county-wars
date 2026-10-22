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
  for (const file of ['combat', 'saves']) vm.runInContext(fs.readFileSync(`js/${file}.js`, 'utf8'), context);
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
  source = source.slice(0, at) + `Object.assign(harness, { S, initState, runLoop, endPlayerTurn, doAttack, saveCheckpoint, loadCheckpoint, saveRules, render, buildFacility, produceBuildings, income, defMult, openAttack, showStart, newGame, recruit, confirmTransfer });` + source.slice(at);
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
  assert.ok(loaded.data.library.has('taipei'));
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
