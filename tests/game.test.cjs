const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Combat = require('../js/combat.js');
const GameSaves = require('../js/saves.js');

function fixture() {
  const focus = { el: null, doc: null };
  const buttonIds = new Set([...fs.readFileSync('index.html', 'utf8').matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map(m => m[1]));
  class Element {
    constructor(id) {
      this.children = []; this.hidden = true; this.style = {}; this.dataset = {}; this.handlers = {};
      this.parentElement = null;
      this.id = typeof id === 'string' ? id.replace(/^#/, '') : '';
      this.tagName = buttonIds.has(this.id) ? 'BUTTON' : 'DIV';
      this.attributes = {};
      const classes = new Set();
      this.classList = {
        add: (...names) => { for (const name of names) classes.add(name); },
        remove: (...names) => { for (const name of names) classes.delete(name); },
        toggle(name, on) {
          const next = on === undefined ? !classes.has(name) : !!on;
          if (next) classes.add(name); else classes.delete(name);
          return next;
        },
        contains: name => classes.has(name),
      };
    }
    set innerHTML(value) {
      for (const child of this.children) { child.parent = null; child.parentElement = null; }
      this.html = value; this.children = [];
    }
    get innerHTML() { return this.html || ''; }
    get textContent() { return this.text ?? this.innerHTML.replace(/<[^>]*>/g, ''); }
    set textContent(v) { this.text = String(v); }
    get lastChild() { return this.children.at(-1); }
    appendChild(el) {
      if (el.parentElement && el.parentElement !== this) el.parentElement.children = el.parentElement.children.filter(c => c !== el);
      this.children.push(el); el.parent = this; el.parentElement = this; return el;
    }
    prepend(el) {
      if (el.parentElement && el.parentElement !== this) el.parentElement.children = el.parentElement.children.filter(c => c !== el);
      this.children.unshift(el); el.parent = this; el.parentElement = this;
    }
    remove() {
      const parent = this.parentElement || this.parent;
      if (parent) parent.children = parent.children.filter(e => e !== this);
      this.parent = null; this.parentElement = null;
    }
    replaceChildren() {
      for (const child of this.children) { child.parent = null; child.parentElement = null; }
      this.children = [];
    }
    addEventListener(event, fn) { this.handlers[event] = fn; }
    click() { if (!this.disabled) return this.handlers.click?.(); }
    matches(selector) {
      if (selector === 'button') return this.tagName === 'BUTTON';
      if (selector === 'button:not(:disabled)') return this.tagName === 'BUTTON' && !this.disabled;
      if (selector?.startsWith('.')) return this.classList.contains(selector.slice(1));
      if (selector?.startsWith('#')) return this.id === selector.slice(1);
      return false;
    }
    querySelectorAll(selector) {
      const out = [];
      const visit = el => {
        for (const child of el.children || []) {
          if (child.matches?.(selector)) out.push(child);
          visit(child);
        }
      };
      visit(this);
      return out;
    }
    contains(node) {
      let n = node;
      while (n) { if (n === this) return true; n = n.parentElement; }
      return false;
    }
    closest(selector) {
      let n = this;
      while (n) { if (n.matches?.(selector)) return n; n = n.parentElement; }
      return null;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
    focus() { focus.el = this; if (focus.doc) focus.doc.activeElement = this; }
  }
  const knownIds = new Set([...fs.readFileSync('index.html', 'utf8').matchAll(/id="([^"]+)"/g)].map(m => '#' + m[1]));
  const elements = new Map(), get = id => { if (!knownIds.has(id)) throw Error('Missing DOM element: ' + id); if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const timers = [], storage = new Map(), listeners = {};
  const documentStub = { querySelector: get, querySelectorAll: () => [], addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, createElement: () => new Element(), activeElement: null };
  focus.doc = documentStub;
  const context = vm.createContext({
    console, harness: {}, confirm: () => true,
    document: documentStub,
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
  source = source.slice(0, at) + `Object.assign(harness, { S, initState, runLoop, endPlayerTurn, requestEndTurn, doAttack, saveCheckpoint, loadCheckpoint, saveRules, render, buildFacility, produceBuildings, income, defMult, openAttack, showStart, newGame, recruit, confirmTransfer, changeTransfer, freshArmy, reachable, checkEnd, startInvasion, doExpedition, invasionRaid, expeditionAllowed, borderThreat, setPosture, atkMult, aiTurn, BV, startAim, aimAt, pickedArmy, nextTurn, openSkillPicker, useSkill, aiUseSkills, combatOptions, defenceHoldMs, needsLowChanceConfirm, LOW_CHANCE, trapFocusTarget, battleFocusables, castTactic, keepBattleFocus, restoreFocusAfterBattle, captureBattleReturnFocus, closeBattle });` + source.slice(at);
  vm.runInContext(source, context);
  const h = context.harness;
  h.initState('play', 'taipei');
  Object.assign(h.S, { current: 'taipei', diff: vm.runInContext('DIFFICULTY.easy', context), diffKey: 'easy', menuOpen: false, playerStarted: true });
  h.S.order = ['taipei', ...h.S.order.filter(x => x !== 'taipei')];
  const adopt = (parent, child) => parent.appendChild(child);
  const screen = get('#battleScreen'), wrap = get('#bsTacticWrap'), menu = get('#bsTacticMenu'), move = get('#bsMove');
  for (const id of ['#bsPause', '#bsFast', '#bsSkip', '#bsTacticBtn', '#bsBack', '#bsFwd']) get(id).hidden = false;
  adopt(screen, get('#bsPause')); adopt(screen, get('#bsFast')); adopt(screen, get('#bsSkip'));
  adopt(screen, wrap); adopt(wrap, get('#bsTacticBtn')); adopt(wrap, menu);
  adopt(screen, move); adopt(move, get('#bsBack')); adopt(move, get('#bsFwd'));
  adopt(screen, get('#bsRetreat')); adopt(screen, get('#bsDone'));
  return { h, context, elements, storage, get, timers, listeners, get focused() { return focus.el; }, async flush() { for (let i = 0; i < 100; i++) { if (timers.length) timers.shift()(); await Promise.resolve(); } } };
}
const dataContext = vm.createContext({});
vm.runInContext(fs.readFileSync('js/data.js', 'utf8') + '\nthis.data = { UNITS, COUNTERS, TACTICS };', dataContext);
const { UNITS: units, COUNTERS: counters, TACTICS } = dataContext.data;
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
test('battles run until one side is wiped out and retreat keeps the current survivors', () => {
  for (const [a, d] of [[{ inf: 12, moto: 3 }, { gen: 14 }], [{ elite: 3 }, { inf: 25 }], [{ inf: 2 }, { gen: 20 }]]) {
    const r = Combat.resolve(options(a, d));
    assert.ok(Combat.count(r.A) === 0 || Combat.count(r.D) === 0, 'short matchups still end in a wipe');
    assert.equal(r.timeout, false);
    assert.deepEqual(r.rounds.at(-1).A, r.A);
  }
  const o = options({ inf: 12, moto: 3 }, { gen: 14 }), st = Combat.setup(o);
  const tacticUsed = JSON.parse(JSON.stringify(st.tacticUsed));
  const buff = JSON.parse(JSON.stringify(st.buff));
  assert.equal(Combat.finish(st, true).lostA, 0);
  assert.equal(st.done, true);
  assert.equal(Combat.useTactic(st, 'A', 'fire'), false);
  assert.deepEqual(st.tacticUsed, tacticUsed);
  assert.deepEqual(st.buff, buff);
  assert.equal(Combat.swap(st, 'A', 0, 1), false);
  const ongoing = Combat.setup(o);
  assert.equal(ongoing.done, false);
  assert.equal(Combat.finish(ongoing, false).retreated, false);
  assert.equal(ongoing.done, false, 'a non-retreat finish does not end a live battle');
  const midSt = Combat.setup(o);
  Combat.step(midSt, o, () => 0.5);
  const midUsed = JSON.parse(JSON.stringify(midSt.tacticUsed));
  const midBuff = JSON.parse(JSON.stringify(midSt.buff));
  const mid = Combat.finish(midSt, true);
  assert.ok(mid.retreated); assert.equal(mid.win, false); assert.equal(mid.timeout, false);
  assert.equal(Combat.count(mid.A) + mid.lostA, 15); assert.equal(Combat.count(mid.D) + mid.lostD, 14);
  assert.equal(midSt.done, true);
  assert.equal(Combat.useTactic(midSt, 'A', 'fire'), false);
  assert.deepEqual(midSt.tacticUsed, midUsed);
  assert.deepEqual(midSt.buff, midBuff);
  assert.equal(Combat.swap(midSt, 'A', 0, 1), false);
});
test('each unit type fights in its own row; attackers line up against what they counter', () => {
  const o = options({ moto: 5, gen: 5 }, { inf: 6, art: 4 }), st = Combat.setup(o);
  assert.deepEqual([...st.laneD], ['inf', 'art']);
  assert.deepEqual([...st.laneA], ['gen', 'moto'], 'gen faces inf, moto faces art');
  Combat.step(st, o, () => 0.5);
  const hit = st.rounds[1].toD;
  assert.ok(hit.inf > 0 && hit.art > 0, 'each row hits the row opposite');
  // swapping rows changes the matchup: moto now faces inf and loses the counter bonus
  const o2 = options({ moto: 5, gen: 5 }, { inf: 6, art: 4 }), good = Combat.setup(o2), bad = Combat.setup(o2);
  assert.ok(Combat.swap(bad, 'A', 0, 1));
  Combat.step(good, o2, () => 0.5); Combat.step(bad, o2, () => 0.5);
  const total = st => Object.values(st.rounds[1].toD).reduce((x, y) => x + y, 0);
  assert.ok(total(good) > total(bad));
  // a row with an empty opposite lane attacks the nearest enemy row
  const lone = Combat.setup(options({ inf: 4, moto: 4, art: 4 }, { gen: 6 }));
  Combat.step(lone, options({ inf: 4, moto: 4, art: 4 }, { gen: 6 }), () => 0.5);
  assert.ok(lone.rounds[1].toD.gen > 0);
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
test('the hourglass counts down, then a stalled defence sends the attacker home', async () => {
  const f = fixture(), { h, get } = f;
  h.S.units.inf = { ...h.S.units.inf, atk: 0, hp: 1e9 };
  h.S.army.taipei = { inf: 8 }; h.S.army.newtaipei = { inf: 8 };
  const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 6 });
  await untilStep(f, 0);
  assert.match(get('#bsTimer').innerHTML, /⏳ 剩 <b>12<\/b> 合/);
  assert.equal(get('#bsTimer').className, 'bsTimer');
  await untilStep(f, 9);
  assert.match(get('#bsTimer').innerHTML, /⏳ 剩 <b>3<\/b> 合/);
  assert.equal(get('#bsTimer').className, 'bsTimer low');
  await f.flush(); await battle;
  const r = h.S.lastBattle;
  assert.equal(r.timeout, true); assert.equal(r.win, false); assert.equal(r.retreated, false);
  assert.equal(r.rounds.length - 1, Combat.TIME_LIMIT);
  assert.ok(Combat.count(r.A) > 0);
  assert.equal(h.S.owner.newtaipei, 'newtaipei');
  assert.equal(h.S.army.taipei.inf, 8);
  assert.equal(h.S.army.newtaipei.inf, 8);
  assert.match(get('#bsStamp').innerHTML, /時間到・守住！/);
  assert.match(get('#bsStamp').className, /\bhold\b/);
  assert.ok(get('#log').children.some(c => c.innerHTML.includes('時間到') && c.innerHTML.includes('守住了')));
});
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
test('AI defender tactics in Combat.step match watched, skip and resolve with the same seed', () => {
  const o = { ...options({ inf: 24 }, { inf: 24 }), aiTactic: { side: 'D', research: { def: 0 } } };
  const seed = 20261023;
  const watched = Combat.setup(o);
  const rndWatch = mulberry32(seed);
  while (!watched.done) Combat.step(watched, o, rndWatch);
  const watchedResult = Combat.finish(watched);
  const resolved = Combat.resolve(o, mulberry32(seed));
  assert.equal(watchedResult.win, resolved.win);
  assert.deepEqual(watchedResult.A, resolved.A);
  assert.deepEqual(watchedResult.D, resolved.D);
  assert.equal(watchedResult.rounds.length, resolved.rounds.length);
  assert.equal(watchedResult.lostA, resolved.lostA);
  assert.equal(watchedResult.lostD, resolved.lostD);
  assert.ok(watched.tacticUsed.D, 'the AI tactic fires on the watched path');
  const skip = Combat.setup(o);
  const rndSkip = mulberry32(seed);
  Combat.step(skip, o, rndSkip);
  Combat.step(skip, o, rndSkip);
  Combat.step(skip, o, rndSkip);
  while (!skip.done) Combat.step(skip, o, rndSkip);
  const skipResult = Combat.finish(skip);
  assert.equal(skipResult.win, resolved.win);
  assert.deepEqual(skipResult.A, resolved.A);
  assert.deepEqual(skipResult.D, resolved.D);
  assert.equal(skipResult.rounds.length, resolved.rounds.length);
  assert.equal(skip.tacticUsed.D, watched.tacticUsed.D);
});
test('the pre-battle estimate counts the AI tactic and a fight without aiTactic is unchanged', () => {
  const base = options({ inf: 24 }, { inf: 24 });
  const withAi = { ...base, aiTactic: { side: 'D', research: { def: 0 } } };
  const plain = Combat.estimate(base);
  const counted = Combat.estimate(withAi);
  assert.ok(counted.chance <= plain.chance, 'the defender tactic should not raise the attacker\'s chance');
  const st = Combat.setup(withAi);
  const rnd = mulberry32(7);
  while (!st.done) Combat.step(st, withAi, rnd);
  assert.ok(st.tacticUsed.D, 'the AI tactic actually triggers in resolve/step');
  const bare = Combat.setup(base);
  while (!bare.done) Combat.step(bare, base, () => 0.5);
  assert.equal(bare.tacticUsed.D, undefined);
  assert.equal(bare.tacticUsed.A, undefined);
});
test('combatOptions only attaches the AI tactic when the player attacks an AI county', () => {
  const { h, get } = fixture();
  h.S.army.taipei = { inf: 25 };
  h.S.army.newtaipei = { inf: 24 };
  const attack = h.combatOptions('taipei', 'newtaipei', { inf: 24 });
  assert.equal(attack.aiTactic.side, 'D');
  assert.equal(attack.aiTactic.research, h.S.research.newtaipei);
  assert.equal(h.combatOptions('newtaipei', 'taipei', { inf: 5 }).aiTactic, undefined);
  assert.equal(h.combatOptions('yilan', 'hualien', { inf: 5 }).aiTactic, undefined);
  h.openAttack('taipei', 'newtaipei');
  const shown = get('#attackEstimate').textContent;
  assert.match(shown, new RegExp(`${Combat.estimate(attack).chance}%`));
});
test('a watched AI defender spends one tactic once its numbers fall below half', async () => {
  const f = fixture(), { h } = f;
  vm.runInContext('Math.random = () => 0.5', f.context);
  h.S.units.inf = { ...h.S.units.inf, atk: 20, hp: 10 };
  h.S.research.newtaipei.def = 0;
  h.S.army.taipei = { inf: 11 }; h.S.army.newtaipei = { inf: 10 };
  const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 10 });
  await untilStep(f, 1);
  assert.equal(h.BV.st.tacticUsed.D, undefined);
  assert.ok(Combat.count(h.BV.st.D) * 2 < h.BV.st.d0);
  await untilStep(f, 2);
  assert.equal(h.BV.st.tacticUsed.D, 'fire');
  assert.match(f.get('#bsFloat').textContent, /鞭炮突擊！/);
  h.S.research.newtaipei.def = 1;
  await f.flush(); await battle;
  assert.equal(h.BV.st.tacticUsed.D, 'fire', 'the defender does not get a second tactic');
  assert.equal(h.S.owner.newtaipei, 'newtaipei');
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
function battleSnapshot(h) {
  return JSON.parse(JSON.stringify({
    army: h.S.army,
    owner: h.S.owner,
    money: h.S.money,
    research: h.S.research,
    current: h.S.current,
    day: h.S.day,
    acted: [...h.S.acted],
    tacticUsed: h.BV.st.tacticUsed,
    buff: h.BV.st.buff,
  }));
}
async function untilBattleResult(f) {
  for (let i = 0; i < 50 && f.get('#bsDone').hidden; i++) await Promise.resolve();
  assert.equal(f.get('#bsDone').hidden, false, 'battle result should be showing');
}
// Troops are written back when the result screen closes. Tactics must not change that settlement.
function armyAfterResult(before, result, src, tgt) {
  const army = JSON.parse(JSON.stringify(before));
  if (result.win) army[tgt] = JSON.parse(JSON.stringify(result.A));
  else {
    army[tgt] = JSON.parse(JSON.stringify(result.D));
    for (const [k, n] of Object.entries(result.A)) if (n > 0) army[src][k] = (army[src][k] || 0) + n;
  }
  return army;
}
async function assertNoTacticOnResult(f, battle, src, tgt) {
  const { h, get } = f;
  await untilBattleResult(f);
  assert.equal(h.BV.st.done, true);
  assert.equal(get('#bsTacticBtn').disabled, true);
  assert.equal(h.battleFocusables().includes(get('#bsTacticBtn')), false);
  const snap = battleSnapshot(h);
  const press = key => f.listeners.keydown.at(-1)({ key, preventDefault() {}, target: { tagName: 'DIV' } });
  const sealed = () => {
    assert.equal(get('#bsTacticMenu').hidden, true);
    assert.equal(get('#bsTacticBtn').disabled, true);
    assert.deepEqual(battleSnapshot(h), snap);
  };
  get('#bsTacticBtn').handlers.click();
  sealed();
  press('t');
  sealed();
  press('T');
  sealed();
  for (const key of ['fire', 'wall', 'smoke', 'heal']) {
    assert.equal(h.castTactic(key), false, key);
    sealed();
  }
  get('#bsTacticMenu').handlers.click({
    target: { closest: sel => sel === 'button[data-tactic]' ? { dataset: { tactic: 'fire' }, disabled: false } : null },
  });
  sealed();
  await f.flush();
  await battle;
  const closed = battleSnapshot(h);
  assert.deepEqual(closed.tacticUsed, snap.tacticUsed);
  assert.deepEqual(closed.buff, snap.buff);
  assert.deepEqual(closed.owner, snap.owner);
  assert.deepEqual(closed.money, snap.money);
  assert.deepEqual(closed.research, snap.research);
  assert.equal(closed.current, snap.current);
  assert.equal(closed.day, snap.day);
  assert.deepEqual(closed.acted, snap.acted);
  assert.deepEqual(closed.army, armyAfterResult(snap.army, h.S.lastBattle, src, tgt));
}
test('no tactic can fire after a retreat or a finished battle, and game state is unchanged', async () => {
  {
    const f = fixture(), { h, get } = f;
    h.S.research.taipei = { atk: 2, def: 2, eco: 1 };
    h.S.army.taipei = { inf: 21 };
    h.S.army.newtaipei = { gen: 20 };
    const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 20 });
    await untilStep(f, 1);
    get('#bsRetreat').handlers.click();
    await assertNoTacticOnResult(f, battle, 'taipei', 'newtaipei');
    assert.equal(h.S.lastBattle.retreated, true);
    assert.equal(h.S.lastBattle.win, false);
    assert.equal(h.BV.st.tacticUsed.A, undefined);
  }
  {
    const f = fixture(), { h } = f;
    vm.runInContext('Math.random = () => 0.5', f.context);
    h.S.research.taipei = { atk: 2, def: 2, eco: 1 };
    h.S.units.inf = { ...h.S.units.inf, atk: 0, hp: 1e9 };
    h.S.units.gen = { ...h.S.units.gen, atk: 0, hp: 1e9 };
    h.S.army.taipei = { inf: 21 };
    h.S.army.newtaipei = { gen: 20 };
    const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 20 });
    await untilStep(f, 1);
    f.listeners.keydown.at(-1)({ key: 'S', preventDefault() {}, target: { tagName: 'DIV' } });
    await assertNoTacticOnResult(f, battle, 'taipei', 'newtaipei');
    assert.equal(h.S.lastBattle.retreated, false);
    assert.equal(h.S.lastBattle.timeout, true);
    assert.equal(h.BV.st.tacticUsed.A, undefined);
    assert.equal(h.S.owner.newtaipei, 'newtaipei');
  }
});
test('defending players watch without a retreat button; lightning speed and AI-only battles skip the screen', async () => {
  const f = fixture(), { h, get } = f;
  h.S.current = 'newtaipei'; h.S.army.newtaipei = { inf: 10 }; h.S.army.taipei = { inf: 5 };
  const defend = h.doAttack('newtaipei', 'taipei', h.S.gen, false, { inf: 4 });
  await untilStep(f, 0);
  assert.equal(get('#bsRetreat').hidden, true);
  assert.equal(get('#bsTacticWrap').hidden, false);
  const press = key => f.listeners.keydown.at(-1)({ key, preventDefault() {}, target: { tagName: 'DIV' } });
  press('t');
  assert.equal(get('#bsTacticMenu').hidden, false, 't opens the tactic menu');
  press('t');
  assert.equal(get('#bsTacticMenu').hidden, true, 't closes the tactic menu');
  press('T');
  get('#bsTacticBtn').handlers.click();
  assert.equal(get('#bsTacticMenu').hidden, true, 'the button toggles the menu closed');
  get('#bsTacticBtn').handlers.click();
  const locked = get('#bsTacticMenu').innerHTML;
  assert.equal(get('#bsTacticMenu').hidden, false);
  assert.equal(/<button data-tactic="fire"[^>]*>/.exec(locked)[0].includes('disabled'), false);
  assert.match(/<button data-tactic="wall"[^>]*>/.exec(locked)[0], /disabled/);
  assert.match(locked, /城防工事 Lv\.1/);
  assert.match(/<button data-tactic="heal"[^>]*>/.exec(locked)[0], /disabled/);
  assert.match(locked, /經濟發展 Lv\.1 或城防工事 Lv\.2/);
  assert.match(/<button data-tactic="smoke"[^>]*>/.exec(locked)[0], /disabled/);
  assert.match(locked, /軍事訓練 Lv\.2/);
  h.S.research.taipei = { atk: 2, def: 2, eco: 0 };
  get('#bsTacticBtn').handlers.click();
  get('#bsTacticBtn').handlers.click();
  const open = get('#bsTacticMenu').innerHTML;
  for (const key of ['fire', 'wall', 'heal', 'smoke']) assert.equal(new RegExp(`<button data-tactic="${key}"[^>]*>`).exec(open)[0].includes('disabled'), false, key);
  get('#bsTacticMenu').handlers.click({ target: { closest: sel => sel === 'button[data-tactic]' ? { dataset: { tactic: 'fire' }, disabled: false } : null } });
  assert.equal(h.BV.st.tacticUsed.D, 'fire');
  assert.equal(get('#bsTacticBtn').disabled, true);
  assert.match(get('#bsTacticBtn').textContent, /鞭炮突擊/);
  assert.match(get('#bsFloat').textContent, /🧨 鞭炮突擊！/);
  assert.equal(get('#bsTacticMenu').hidden, true);
  get('#bsTacticBtn').handlers.click();
  assert.equal(get('#bsTacticMenu').hidden, true, 'a used tactic cannot be opened again');
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
  const sides = get('#bsSides').innerHTML;
  assert.ok(sides.indexOf('（你）') < sides.indexOf('外星空襲部隊'), 'the player stays on the left');
  assert.match(get('#bsField').className, /flip/);
  assert.ok(get('#bsField').innerHTML.indexOf('bsWall') < get('#bsField').innerHTML.indexOf('bsGap'), 'wall in front of the defender');
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

test('the player moves their own rows with the bottom buttons during a battle', async () => {
  const f = fixture(), { h, get } = f;
  h.S.army.taipei = { inf: 10, moto: 6 }; h.S.army.newtaipei = { gen: 12, art: 6 };
  const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 9, moto: 6 });
  await untilStep(f, 0);
  assert.equal(get('#bsMove').hidden, false);
  const before = [...h.BV.st.laneA];
  assert.equal(h.BV.sel, 0);
  get('#bsBack').handlers.click();
  assert.deepEqual([...h.BV.st.laneA], [before[1], before[0]]);
  assert.equal(h.BV.sel, 1);
  assert.equal(h.BV.st.laneD.join(), 'gen,art', 'cannot touch enemy rows');
  await f.flush(); await battle;
  const r = h.S.lastBattle;
  assert.ok(r.timeout || Combat.count(r.A) === 0 || Combat.count(r.D) === 0);
});

test('the AI side re-arranges after each round to counter the current line-up', () => {
  const o = { ...options({ inf: 20, moto: 20 }, { gen: 10, art: 12 }), attackMult: 0.1, defenderAttack: 0.1, adapt: 'D' }, st = Combat.setup(o); // 低傷害：只測排兵
  assert.equal(st.laneD.join(), 'gen,art');
  Combat.step(st, o, () => 0.5);
  assert.equal(st.laneD.join(), 'art,gen', 'gen moves to counter inf, art leaves the moto lane');
  assert.equal(st.adapted, 1);
  const fixed = { ...o, adapt: '' }, still = Combat.setup(fixed);
  Combat.step(still, fixed, () => 0.5);
  assert.equal(still.laneD.join(), 'gen,art', 'adapt can be turned off');
});
test('the hourglass ends a battle that cannot be finished', () => {
  assert.equal(Combat.TIME_LIMIT, 12);
  const tank = { name: '石敢當', icon: '🪨', cost: 1, atk: 1, hp: 1e9, cls: 'inf' };
  const o = { sent: { inf: 4 }, defenders: { inf: 4 }, units: { inf: tank }, counters: {}, attackMult: 1, defenseMult: 1, defenderAttack: 1 };
  const r = Combat.resolve(o, () => 0.5);
  assert.equal(r.rounds.length - 1, Combat.TIME_LIMIT);
  assert.equal(r.win, false);
  assert.equal(r.timeout, true);
  assert.equal(r.retreated, false);
  assert.ok(Combat.count(r.A) > 0);
  assert.ok(Combat.count(r.D) > 0);
  const quick = Combat.resolve(options({ inf: 30 }, { inf: 1 }), () => 0.5);
  assert.equal(quick.win, true);
  assert.equal(quick.timeout, false);
  assert.equal(Combat.estimate(o, 12).chance, 0);
});
test('each side can use one tactic per battle', () => {
  const tough = { inf: { ...units.inf, hp: 1e9 } };
  const o = { ...options({ inf: 8 }, { inf: 8 }), units: tough };
  const plain = Combat.setup(o), fired = Combat.setup(o), walled = Combat.setup(o);
  assert.equal(Combat.useTactic(fired, 'A', 'fire'), true);
  assert.equal(Combat.useTactic(fired, 'A', 'wall'), false);
  assert.equal(Combat.useTactic(fired, 'A', 'fire'), false);
  assert.equal(fired.tacticUsed.A, 'fire');
  assert.equal(Combat.useTactic(fired, 'D', 'smoke'), true);
  assert.equal(Combat.useTactic(fired, 'D', 'heal'), false);
  const fresh = Combat.setup(o);
  assert.equal(Combat.useTactic(fresh, 'A', 'meteor'), false);
  assert.equal(fresh.tacticUsed.A, undefined);
  assert.equal(Combat.useTactic(fresh, 'nope', 'fire'), false);
  const rnd = () => 0.5;
  const boosted = Combat.setup(o);
  assert.equal(Combat.useTactic(boosted, 'A', 'fire'), true);
  for (let n = 1; n <= 4; n++) {
    Combat.step(plain, o, rnd);
    Combat.step(boosted, o, rnd);
    const ratio = boosted.rounds[n].toD.inf / plain.rounds[n].toD.inf;
    assert.ok(Math.abs(ratio - (n <= 3 ? 1.5 : 1)) < 1e-9, `fire round ${n}`);
  }
  const smoked = Combat.setup(o);
  assert.equal(Combat.useTactic(smoked, 'A', 'smoke'), true);
  Combat.step(smoked, o, rnd); Combat.step(smoked, o, rnd);
  assert.equal(smoked.rounds[1].toA.inf, 0, 'smoke stops the enemy for one round');
  assert.ok(smoked.rounds[1].toD.inf > 0, 'our side still attacks through the smoke');
  assert.ok(smoked.rounds[2].toA.inf > 0, 'smoke wears off on the following round');
  Combat.useTactic(walled, 'D', 'wall');
  const base = Combat.setup(o);
  Combat.step(base, o, rnd); Combat.step(walled, o, rnd);
  assert.ok(Math.abs(walled.rounds[1].toD.inf - base.rounds[1].toD.inf * 0.5) < 1e-9);
  const healed = Combat.setup(options({ inf: 10, moto: 4 }, { gen: 6 }));
  healed.A.inf = 0; healed.A.moto = 3;
  assert.equal(Combat.useTactic(healed, 'A', 'heal'), true);
  assert.equal(healed.A.inf, 3);
  assert.equal(healed.A.moto, 4);
  assert.ok(healed.A.inf <= 10 && healed.A.moto <= 4);
  assert.equal(Combat.useTactic(healed, 'A', 'heal'), false);
  assert.equal(healed.A.inf, 3);
  assert.equal(healed.rounds[0].A.inf, 3, 'the battlefield shows the revived count');
});
test('tactic unlocks follow research, and the defender AI spends its one tactic below half strength', () => {
  const none = { atk: 0, def: 0, eco: 0 };
  assert.equal(TACTICS.fire.need(none), true);
  assert.equal(TACTICS.wall.need(none), false);
  assert.equal(TACTICS.wall.need({ ...none, def: 1 }), true);
  assert.equal(TACTICS.heal.need(none), false);
  assert.equal(TACTICS.heal.need({ ...none, eco: 1 }), true);
  assert.equal(TACTICS.heal.need({ ...none, def: 1 }), false);
  assert.equal(TACTICS.heal.need({ ...none, def: 2 }), true);
  assert.equal(TACTICS.smoke.need({ ...none, atk: 1 }), false);
  assert.equal(TACTICS.smoke.need({ ...none, atk: 2 }), true);
  assert.equal(TACTICS.fire.name, '鞭炮突擊');
  for (const key of Object.keys(TACTICS)) assert.equal(Combat.useTactic(Combat.setup(options({ inf: 3 }, { inf: 3 })), 'A', key), true, key);
  const full = Combat.setup(options({ inf: 6 }, { inf: 10 }));
  assert.equal(Combat.aiTactic(full, { def: 1 }), null);
  full.D.inf = 5;
  assert.equal(Combat.aiTactic(full, { def: 1 }), null, 'exactly half is not below half');
  full.D.inf = 4;
  assert.equal(Combat.aiTactic(full, { def: 1 }), 'wall');
  assert.equal(full.buff.D.take, 3);
  assert.equal(Combat.aiTactic(full, { def: 0 }), null);
  const bare = Combat.setup(options({ inf: 6 }, { inf: 10 }));
  bare.D.inf = 4;
  assert.equal(Combat.aiTactic(bare, { def: 0 }), 'fire');
  assert.equal(bare.buff.D.deal, 3);
});
test('a row can be sent straight at any enemy row, e.g. the last one', () => {
  const o = { ...options({ moto: 5, inf: 5 }, { inf: 6, gen: 3, art: 4 }), adapt: '' };
  const plain = Combat.setup(o), aimed = Combat.setup(o);
  const inf = aimed.laneA.indexOf('inf');
  assert.notEqual(aimed.laneD[inf], 'art', 'art is not opposite the infantry row by default');
  assert.ok(Combat.aim(aimed, 'A', 'inf', 'art'));
  Combat.step(plain, o, () => 0.5); Combat.step(aimed, o, () => 0.5);
  assert.ok(aimed.rounds[1].toD.art > (plain.rounds[1].toD.art || 0));
  assert.equal(Combat.aim(aimed, 'A', 'inf', 'nope'), false);
  assert.ok(Combat.aim(aimed, 'A', 'inf', null)); assert.equal(aimed.aimA.inf, undefined);
});
test('in battle the player picks a row, then clicks an enemy row to target it', async () => {
  const f = fixture(), { h, get } = f;
  h.S.army.taipei = { inf: 10, moto: 6 }; h.S.army.newtaipei = { inf: 8, gen: 6, art: 6 };
  const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 9, moto: 6 });
  await untilStep(f, 0);
  const click = target => get('#bsField').handlers.click({ target: { closest: sel => target[sel] || null } });
  const motoLane = h.BV.st.laneA.indexOf('moto');
  click({ '[data-lane]': { dataset: { lane: String(motoLane) } } });
  click({ '[data-foe]': { dataset: { foe: 'art' } } });
  assert.equal(h.BV.st.aimA.moto, 'art');
  assert.match(get('#bsField').innerHTML, /🎯 第 \d 排/);
  await f.flush(); await battle;
});

test('transferred troops cannot attack or move again the same turn, and a county keeps one soldier', async () => {
  const f = fixture(), { h, get } = f;
  h.S.owner.newtaipei = 'taipei';
  h.S.army.taipei = { inf: 5 };
  h.S.army.newtaipei = {};
  h.S.army.keelung = {};
  h.S.tr = { from: 'taipei', to: 'newtaipei', amt: { inf: 5 } };
  h.confirmTransfer();
  assert.equal(h.S.army.taipei.inf, 1, 'transfer leaves one soldier at home');
  assert.equal(h.S.army.newtaipei.inf, 4);
  assert.deepEqual({ ...h.S.moved.newtaipei }, { inf: 4 });
  assert.equal(h.S.moved.taipei, undefined);

  h.S.tr = { from: 'newtaipei', to: 'taipei', amt: { inf: 4 } };
  h.confirmTransfer();
  assert.equal(h.S.army.newtaipei.inf, 4, 'transferred troops cannot move back');
  assert.equal(h.S.army.taipei.inf, 1);

  const before = JSON.stringify(h.S.army);
  await h.doAttack('newtaipei', 'keelung', h.S.gen, false, { inf: 3 });
  assert.equal(h.S.owner.keelung, 'keelung');
  assert.equal(JSON.stringify(h.S.army), before);
  assert.equal(h.S.acted.has('newtaipei'), false);
  h.S.sel = 'newtaipei';
  h.render();
  assert.match(get('#info').innerHTML, /已行動 4 人（今日不能再出征或調動）/);
  assert.match(get('#info').innerHTML, /調入的部隊今天不能出征/);

  h.openAttack('newtaipei', 'keelung');
  assert.match(get('#attackEstimate').innerHTML, /調入的部隊今天不能出征/);
  assert.equal(get('#attackConfirm').disabled, true);
});

test('a transfer only reaches an adjacent own county, and each troop moves once that day', () => {
  const { h, get } = fixture();
  h.S.owner.newtaipei = h.S.owner.taoyuan = h.S.owner.keelung = h.S.owner.lienchiang = h.S.owner.kinmen = 'taipei';
  h.S.army.taipei = { inf: 6 };
  h.S.army.newtaipei = { inf: 2 };
  h.S.army.taoyuan = { inf: 1 };
  h.S.army.keelung = { inf: 3 };
  h.S.army.lienchiang = { inf: 1 };
  h.S.army.kinmen = { inf: 1 };
  h.S.army.yilan = { inf: 4 };

  assert.deepEqual([...h.reachable('taipei')].sort(), ['newtaipei']);
  assert.equal(h.reachable('keelung').has('lienchiang'), true, 'sea links count as adjacent');
  assert.equal(h.reachable('keelung').has('kinmen'), false, 'a sea route does not skip the county in between');

  h.S.tr = { from: 'taipei', to: 'taoyuan', amt: { inf: 3 } };
  h.confirmTransfer();
  assert.equal(h.S.army.taipei.inf, 6, 'non-adjacent own county is rejected');
  assert.equal(h.S.army.taoyuan.inf, 1);

  h.S.tr = { from: 'keelung', to: 'kinmen', amt: { inf: 1 } };
  h.confirmTransfer();
  assert.equal(h.S.army.keelung.inf, 3);
  assert.equal(h.S.army.kinmen.inf, 1);

  h.S.tr = { from: 'newtaipei', to: 'yilan', amt: { inf: 1 } };
  h.confirmTransfer();
  assert.equal(h.S.army.newtaipei.inf, 2, 'an adjacent county owned by someone else is rejected');
  assert.equal(h.S.army.yilan.inf, 4);
  assert.equal(h.S.owner.yilan, 'yilan');

  h.S.tr = { from: 'taipei', to: 'newtaipei', amt: { inf: 4 } };
  h.confirmTransfer();
  assert.equal(h.S.army.taipei.inf, 2);
  assert.equal(h.S.army.newtaipei.inf, 6);
  assert.deepEqual({ ...h.S.moved.newtaipei }, { inf: 4 });

  get('#trSwap').handlers.click();
  assert.equal(h.S.tr.from, 'newtaipei');
  assert.equal(h.S.tr.to, 'taipei');
  h.changeTransfer('inf', 'max');
  assert.equal(h.S.tr.amt.inf, 2, 'reverse direction only offers troops that have not moved');
  h.confirmTransfer();
  assert.equal(h.S.army.newtaipei.inf, 4);
  assert.equal(h.S.army.taipei.inf, 4);
  assert.equal(h.S.moved.newtaipei.inf, 4);
  assert.equal(h.S.moved.taipei.inf, 2);

  h.S.tr = { from: 'taipei', to: 'taoyuan', amt: { inf: 1 } };
  get('#trSwap').handlers.click();
  assert.equal(h.S.tr.from, 'taipei', 'swap refuses a non-adjacent pair');
  assert.equal(h.S.tr.to, 'taoyuan');
  assert.equal(h.S.tr.amt.inf, 1);

  h.S.tr = { from: 'keelung', to: 'lienchiang', amt: { inf: 2 } };
  h.confirmTransfer();
  assert.equal(h.S.army.keelung.inf, 1);
  assert.equal(h.S.army.lienchiang.inf, 3);
  assert.deepEqual({ ...h.S.moved.lienchiang }, { inf: 2 });

  delete h.S.moved.taipei;
  h.S.army.taipei = { inf: 5 };
  assert.ok(h.startAim('taipei', [0, 1]));
  h.aimAt('taoyuan');
  assert.ok(h.S.aim, 'a far own county is not a transfer target');
  assert.equal(h.S.army.taoyuan.inf, 1);
  h.aimAt('newtaipei');
  assert.equal(h.S.aim, null);
  assert.equal(h.S.army.taipei.inf, 3);
  assert.equal(h.S.army.newtaipei.inf, 6);
});

test('only fresh troops can be selected, and the attack dialog will not deploy moved ones', () => {
  const { h, get } = fixture();
  h.S.owner.newtaipei = 'taipei';
  h.S.army.taipei = { inf: 4 };
  h.S.army.newtaipei = { inf: 24 };
  h.S.moved = { taipei: { inf: 2 } };
  h.S.tr = { from: 'taipei', to: 'newtaipei', amt: {} };
  h.changeTransfer('inf', 'max');
  assert.equal(h.S.tr.amt.inf, 1, 'destination room and fresh count both cap the transfer');

  h.S.army.newtaipei = {};
  h.S.moved = {};
  h.S.army.taipei = { inf: 5 };
  h.S.tr = { from: 'taipei', to: 'newtaipei', amt: {} };
  h.changeTransfer('inf', 'max');
  assert.equal(h.S.tr.amt.inf, 4);

  h.S.army.taipei = { inf: 4 };
  h.S.moved = { taipei: { inf: 3 } };
  assert.deepEqual({ ...h.pickedArmy('taipei', [1, 2, 3]) }, {});
  assert.deepEqual({ ...h.pickedArmy('taipei', [0, 1]) }, { inf: 1 });
  assert.ok(h.startAim('taipei', [1, 2, 3]));
  h.aimAt('newtaipei');
  assert.equal(Combat.count(h.S.army.newtaipei), 0);
  assert.equal(h.S.army.taipei.inf, 4);

  h.S.owner.newtaipei = 'newtaipei';
  h.S.army.newtaipei = { inf: 4 };
  h.S.army.taipei = { inf: 4 };
  h.S.moved = { taipei: { inf: 2 } };
  assert.ok(h.startAim('taipei', [0, 1, 2, 3]));
  h.aimAt('newtaipei');
  assert.equal(get('#attackDialog').hidden, false);
  assert.deepEqual({ ...h.S.attack.sent }, { inf: 1 });
  assert.match(get('#attackRows').innerHTML, /可出征 2/);
});

test('an inactive player cannot transfer, and new recruits stay fresh after losses clamp moved', () => {
  const { h } = fixture();
  h.S.owner.newtaipei = 'taipei';
  h.S.army.taipei = { inf: 4 };
  h.S.army.newtaipei = {};
  h.S.current = null;
  h.S.tr = { from: 'taipei', to: 'newtaipei', amt: { inf: 3 } };
  h.confirmTransfer();
  assert.equal(h.S.army.taipei.inf, 4);
  assert.equal(Combat.count(h.S.army.newtaipei), 0);

  h.S.current = 'taipei';
  h.S.owner.newtaipei = 'newtaipei';
  h.S.army.newtaipei = { inf: 10 };
  h.S.moved = { newtaipei: { inf: 8, moto: 1 } };
  assert.ok(h.useSkill('taipei', 0));
  assert.equal(h.S.army.newtaipei.inf, 7);
  assert.equal(h.S.moved.newtaipei.inf, 7);
  assert.equal(h.S.moved.newtaipei.moto, undefined);

  h.S.army.taipei = { inf: 4 };
  h.S.moved.taipei = { inf: 4 };
  h.S.money.taipei = 100;
  h.S.sel = 'taipei';
  h.recruit('inf');
  assert.equal(h.S.army.taipei.inf, 5);
  assert.equal(h.S.moved.taipei.inf, 4);
  assert.deepEqual({ ...h.freshArmy('taipei') }, { inf: 1 });
});

test('capture and retreat mark the soldiers who already fought', async () => {
  const f = fixture(), { h, get } = f;
  h.S.speed = 99;
  h.S.army.taipei = { inf: 5 };
  h.S.army.newtaipei = {};
  h.S.moved = { newtaipei: { moto: 2 } };
  const win = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 3 });
  await f.flush(); await win;
  assert.equal(h.S.owner.newtaipei, 'taipei');
  assert.deepEqual({ ...h.S.moved.newtaipei }, { inf: 3 });
  assert.equal(h.S.moved.newtaipei.moto, undefined);
  assert.equal(h.S.moved.taipei, undefined);
  assert.deepEqual({ ...h.freshArmy('taipei') }, { inf: 2 });

  h.S.speed = 1;
  h.S.acted.clear();
  h.S.army.taipei = { inf: 21 };
  h.S.army.newtaipei = { gen: 20 };
  h.S.owner.newtaipei = 'newtaipei';
  const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 20 });
  await untilStep(f, 1);
  get('#bsRetreat').handlers.click();
  await f.flush(); await battle;
  const back = Combat.count(h.S.lastBattle.A);
  assert.ok(h.S.lastBattle.retreated);
  assert.ok(back > 0);
  assert.equal(h.S.moved.taipei.inf, back);
  assert.deepEqual({ ...h.freshArmy('taipei') }, { inf: 1 });
  assert.equal(h.S.owner.newtaipei, 'newtaipei');
});

test('moved troops reset on the next turn and round-trip through old and new saves', async () => {
  const f = fixture(), { h } = f;
  h.S.army.taipei = { inf: 4, moto: 1 };
  h.S.army.keelung = { art: 2 };
  h.S.moved = { taipei: { inf: 2 }, keelung: { art: 1 } };
  const bag = moved => JSON.parse(JSON.stringify(moved));
  const loaded = GameSaves.decode(GameSaves.encode(h.S), h.saveRules);
  assert.deepEqual(bag(loaded.data.moved), { taipei: { inf: 2 }, keelung: { art: 1 } });
  assert.ok(h.saveCheckpoint('manual'));
  h.S.moved = {};
  h.loadCheckpoint('manual');
  assert.deepEqual(bag(h.S.moved), { taipei: { inf: 2 }, keelung: { art: 1 } });

  const old = JSON.parse(GameSaves.encode(h.S));
  delete old.data.moved;
  assert.deepEqual(GameSaves.decode(JSON.stringify(old), h.saveRules).data.moved, {});
  for (const corrupt of [
    s => { s.data.moved = { taipei: { inf: 99 } }; },
    s => { s.data.moved = { taipei: { nope: 1 } }; },
    s => { s.data.moved = { taipei: { inf: 9 } }; },
    s => { s.data.moved = { nope: { inf: 1 } }; },
    s => { s.data.moved = null; },
  ]) {
    const bad = structuredClone(JSON.parse(GameSaves.encode(h.S)));
    corrupt(bad);
    assert.throws(() => GameSaves.decode(JSON.stringify(bad), h.saveRules));
  }

  h.S.speed = 99;
  h.S.moved = { taipei: { inf: 2 } };
  h.endPlayerTurn();
  for (let i = 0; i < 40 && h.S.current !== 'taipei'; i++) await f.flush();
  assert.equal(h.S.current, 'taipei');
  assert.equal(h.S.day, 2);
  assert.deepEqual({ ...h.S.moved }, {});
});

test('old saves treat the player as already started; an explicit flag round-trips', () => {
  const { h } = fixture();
  h.S.playerStarted = false;
  const saved = JSON.parse(GameSaves.encode(h.S));
  assert.equal(GameSaves.decode(JSON.stringify(saved), h.saveRules).data.playerStarted, false);
  delete saved.data.playerStarted;
  assert.equal(GameSaves.decode(JSON.stringify(saved), h.saveRules).data.playerStarted, true);
});

test('hard difficulty tops an island opening army up to 8 and announces protection', () => {
  const f = fixture(), { h, get } = f;
  h.S.diffKey = 'easy';
  h.initState('play', 'penghu');
  assert.equal(Combat.count(h.S.army.penghu), 4, 'easy keeps the island army');
  h.S.diffKey = 'hard';
  h.newGame('play', 'penghu');
  assert.ok(Combat.count(h.S.army.penghu) >= 8);
  assert.equal(h.S.army.penghu.art, 1, 'top-up adds infantry and keeps the artillery');
  assert.ok(get('#log').children.some(c => c.innerHTML.includes('開局保護')));
  ++h.S.gen;
});

test('before the player acts, a hard AI cannot capture or strike their county', async () => {
  const f = fixture(), { h, context } = f;
  h.S.speed = 99;
  h.S.diff = vm.runInContext('DIFFICULTY.hard', context);
  h.S.player = 'penghu';
  h.S.playerStarted = false;
  h.S.owner.penghu = 'penghu';
  h.S.owner.changhua = h.S.owner.chiayicounty = 'yunlin';
  h.S.army.penghu = { inf: 1 };
  h.S.army.yunlin = { elite: 25 };
  h.S.money.yunlin = 0;
  h.S.slots.yunlin = ['yunlin', 'c_leak'];
  h.S.skillReady = {};
  h.S.current = 'yunlin';
  h.S.acted.clear();
  const blocked = h.aiTurn('yunlin', h.S.gen);
  await f.flush();
  await blocked;
  assert.equal(h.S.owner.penghu, 'penghu');
  assert.equal(h.S.army.penghu.inf, 1, 'strike skills also spare the player');
  h.S.playerStarted = true;
  h.S.acted.clear();
  h.S.money.yunlin = 0;
  h.S.skillReady = {};
  const open = h.aiTurn('yunlin', h.S.gen);
  await f.flush();
  await open;
  assert.equal(h.S.owner.penghu, 'yunlin');
});

test('a hard penghu opening survives every AI turn before the player acts', async () => {
  const f = fixture(), { h, context } = f;
  const hard = vm.runInContext('DIFFICULTY.hard', context);
  for (let n = 0; n < 20; n++) {
    ++h.S.gen;
    h.S.diffKey = 'hard';
    h.S.speed = 99;
    h.initState('play', 'penghu');
    h.S.diff = hard;
    h.S.gameDiffKey = 'hard';
    h.S.menuOpen = false;
    assert.equal(h.S.playerStarted, false);
    assert.ok(Combat.count(h.S.army.penghu) >= 8);
    const troops = Combat.count(h.S.army.penghu);
    for (const id of h.S.order) {
      if (id === 'penghu') break;
      if (!Object.values(h.S.owner).includes(id)) continue;
      const turn = h.aiTurn(id, h.S.gen);
      await f.flush();
      await turn;
    }
    assert.equal(h.S.owner.penghu, 'penghu', `iteration ${n}`);
    assert.equal(Combat.count(h.S.army.penghu), troops, `iteration ${n} army was hit before the first turn`);
    h.S.turnIdx = h.S.order.indexOf('penghu');
    await h.runLoop(h.S.gen);
    assert.equal(h.S.current, 'penghu');
    assert.equal(h.S.playerStarted, true);
    assert.ok(Object.values(h.S.owner).includes('penghu'));
  }
});

test('an AI faction uses at most two skills per turn and skips defense during peace', () => {
  const f = fixture(), { h, context } = f;
  h.S.diff = vm.runInContext('DIFFICULTY.hard', context);
  h.S.day = 3;
  h.S.playerStarted = true;
  h.S.skillReady = {};
  for (const id of Object.keys(h.S.owner)) {
    h.S.owner[id] = 'kaohsiung';
    h.S.slots[id] = [id, 'c_build'];
    h.S.army[id] = { inf: 4 };
    h.S.money.kaohsiung = 0;
  }
  h.aiUseSkills('kaohsiung');
  const used = Object.keys(h.S.skillReady);
  assert.ok(used.length > 0 && used.length <= 2, `used ${used.length}: ${used.join(',')}`);
  assert.ok(used.every(k => k.startsWith('kaohsiung:')), 'home county skills come first');

  h.S.diff = vm.runInContext('DIFFICULTY.easy', context);
  h.S.day = 1;
  h.S.skillReady = {};
  h.S.buff = {};
  for (const id of Object.keys(h.S.owner)) {
    h.S.owner[id] = 'newtaipei';
    h.S.slots[id] = [id, 'c_guard'];
    h.S.skillReady[`${id}:0`] = 99;
    h.S.skillReady[`${id}:1`] = 99;
    h.S.army[id] = { inf: 1 };
  }
  h.S.owner.taichung = 'taichung';
  h.S.army.taichung = { elite: 25 };
  for (const id of ['miaoli', 'hsinchucounty']) {
    delete h.S.skillReady[`${id}:0`];
    delete h.S.skillReady[`${id}:1`];
  }
  h.aiUseSkills('newtaipei');
  assert.equal(h.S.buff.miaoli, undefined);
  assert.equal(h.S.skillReady['miaoli:0'], undefined);
  assert.equal(h.S.skillReady['miaoli:1'], undefined);

  h.S.diff = vm.runInContext('DIFFICULTY.hard', context);
  h.S.buff = {};
  h.aiUseSkills('newtaipei');
  assert.ok(h.S.buff.miaoli?.def, 'defense is allowed once peace is over');
});

test('ending the turn asks once, then ends on the second request', () => {
  const { h, get } = fixture();
  h.render();
  const btn = get('#endTurn');
  assert.equal(btn.textContent, '結束回合 ▶');
  h.requestEndTurn();
  assert.equal(h.S.current, 'taipei');
  assert.equal(btn.textContent, '還有 1 個縣市可出征，確定結束？');
  assert.equal(btn.classList.contains('confirming'), true);
  h.requestEndTurn();
  assert.notEqual(h.S.current, 'taipei');
  assert.equal(btn.classList.contains('confirming'), false);
});

test('end-turn confirmation reverts without ending, and a direct end still works', async () => {
  const f = fixture(), { h, get } = f;
  h.render();
  const btn = get('#endTurn');
  h.S.acted.add('taipei');
  h.requestEndTurn();
  assert.equal(h.S.current, 'taipei');
  assert.equal(btn.textContent, '確定結束回合？');
  await f.flush();
  assert.equal(h.S.current, 'taipei');
  assert.equal(btn.textContent, '結束回合 ▶');
  assert.equal(btn.classList.contains('confirming'), false);

  h.S.acted.clear();
  h.S.owner.newtaipei = 'taipei';
  h.requestEndTurn();
  assert.equal(btn.textContent, '還有 2 個縣市可出征，確定結束？');
  h.S.sel = 'taipei';
  h.recruit('inf');
  assert.equal(h.S.current, 'taipei');
  assert.equal(btn.textContent, '結束回合 ▶');
  h.requestEndTurn();
  assert.equal(h.S.current, 'taipei');
  h.openAttack('taipei', 'newtaipei');
  assert.equal(btn.textContent, '結束回合 ▶');
  assert.equal(btn.classList.contains('confirming'), false);
  assert.equal(get('#attackDialog').hidden, false);

  h.requestEndTurn();
  assert.equal(h.S.current, 'taipei');
  h.endPlayerTurn();
  assert.notEqual(h.S.current, 'taipei');
});

test('Enter on a focused button does not skip the end-turn confirmation', () => {
  const f = fixture(), { h, get } = f;
  get('#modal').hidden = true;
  h.render();
  const btn = get('#endTurn');
  const press = (key, target) => f.listeners.keydown.at(-1)({ key, preventDefault() {}, target });
  // One Enter on a focused button: keydown, then the browser's native click.
  press('Enter', { tagName: 'BUTTON' });
  btn.handlers.click();
  assert.equal(h.S.current, 'taipei');
  assert.equal(btn.classList.contains('confirming'), true);
  press('e', { tagName: 'BUTTON' });
  assert.notEqual(h.S.current, 'taipei');
});

test('mute shortcut stays quiet without Sfx and ignores text fields', () => {
  const f = fixture();
  const press = (key, target) => f.listeners.keydown.at(-1)({ key, repeat: false, preventDefault() {}, target: target || { tagName: 'DIV' } });
  assert.equal(f.get('#sfxBtn').textContent, '🔇');
  assert.equal(f.get('#sfxBtn').title, '音效：關');
  assert.equal(f.get('#sfxBtnStart').textContent, '🔇');
  assert.equal(f.get('#sfxBtnStart').title, '音效：關');
  assert.doesNotThrow(() => press('m'));
  assert.doesNotThrow(() => press('M', { tagName: 'INPUT' }));
  assert.doesNotThrow(() => press('m', { tagName: 'SELECT' }));
  f.get('#sfxBtn').handlers.click();
  assert.equal(f.get('#sfxBtn').textContent, '🔇');
  f.get('#sfxBtnStart').handlers.click();
  assert.equal(f.get('#sfxBtnStart').textContent, '🔇');
});
test('the start screen can toggle mute with the in-dialog button and the M key', () => {
  const f = fixture(), { get } = f;
  let muted = true;
  f.context.Sfx = { muted: () => muted, toggle() { muted = !muted; return muted; } };
  const press = (key, target) => f.listeners.keydown.at(-1)({
    key, repeat: false, preventDefault() {}, target: target || { tagName: 'DIV' },
  });
  assert.equal(get('#modal').hidden, false);
  assert.equal(get('#startView').hidden, false);
  press('m');
  assert.equal(muted, false);
  assert.equal(get('#sfxBtn').textContent, '🔊');
  assert.equal(get('#sfxBtnStart').textContent, '🔊');
  assert.equal(get('#sfxBtnStart').title, '音效：開');
  get('#sfxBtnStart').handlers.click();
  assert.equal(muted, true);
  assert.equal(get('#sfxBtn').textContent, '🔇');
  assert.equal(get('#sfxBtnStart').textContent, '🔇');
  press('m');
  assert.equal(muted, false);
  get('#attackDialog').hidden = false;
  press('m');
  assert.equal(muted, false, 'M stays quiet in the attack dialog');
  get('#attackDialog').hidden = true;
  get('#startView').hidden = true;
  press('m');
  assert.equal(muted, false, 'M stays quiet on the end-game modal');
  get('#modal').hidden = true;
  press('M', { tagName: 'INPUT' });
  assert.equal(muted, false, 'M stays quiet while typing');
  press('m');
  assert.equal(muted, true);
});
test('player-defence battles hold 3 seconds before the first round; attacks do not', () => {
  const { h } = fixture();
  assert.equal(h.defenceHoldMs({ att: { mine: true }, def: { mine: false } }), 0);
  assert.equal(h.defenceHoldMs({ att: { mine: false }, def: { mine: true } }), 3000);
  assert.equal(h.defenceHoldMs({ att: { mine: true }, def: { mine: true } }), 0);
  assert.equal(h.defenceHoldMs(null), 0);
});
test('a defending player sees the pre-battle hold prompt and can skip it with play', async () => {
  const f = fixture(), { h, get } = f;
  h.S.current = 'newtaipei'; h.S.army.newtaipei = { inf: 10 }; h.S.army.taipei = { inf: 5 };
  const defend = h.doAttack('newtaipei', 'taipei', h.S.gen, false, { inf: 4 });
  await untilStep(f, 0);
  assert.equal(get('#bsHold').hidden, false);
  assert.match(get('#bsHold').textContent, /守城戰！可先使用 🎴 戰術（\d 秒後自動開戰）/);
  assert.equal(h.BV.holding, true);
  get('#bsPause').handlers.click();
  assert.equal(h.BV.holding, false);
  await f.flush(); await defend;
});
test('space during a defence hold focuses the battle screen and resumes without skipping', async () => {
  const f = fixture(), { h, get } = f;
  h.S.current = 'newtaipei'; h.S.army.newtaipei = { inf: 10 }; h.S.army.taipei = { inf: 5 };
  const defend = h.doAttack('newtaipei', 'taipei', h.S.gen, false, { inf: 4 });
  await untilStep(f, 0);
  assert.equal(h.BV.holding, true);
  assert.equal(f.focused, get('#battleScreen'));
  assert.notEqual(f.focused, get('#bsSkip'));
  f.listeners.keydown.at(-1)({ key: ' ', preventDefault() {}, target: { tagName: 'DIV' } });
  assert.equal(h.BV.holding, false);
  assert.equal(h.BV.skip, false);
  await Promise.resolve();
  assert.equal(f.focused, get('#battleScreen'));
  await f.flush(); await defend;
  assert.equal(get('#battleScreen').hidden, true);
  assert.ok(h.S.lastBattle);
});
test('a player attack battle keeps focus on the battle screen', async () => {
  const f = fixture(), { h, get } = f;
  h.S.army.taipei = { inf: 10 }; h.S.army.newtaipei = { inf: 5 };
  const attack = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 4 });
  await untilStep(f, 0);
  assert.equal(h.BV.holding, false);
  assert.equal(get('#bsHold').hidden, true);
  assert.equal(f.focused, get('#battleScreen'));
  assert.notEqual(f.focused, get('#bsSkip'));
  await f.flush(); await attack;
});
test('after a battle ends ⏸ and ⏩ are disabled and Tab only cycles 繼續; a new battle re-enables them', async () => {
  const f = fixture(), { h, get } = f;
  h.S.army.taipei = { inf: 10 }; h.S.army.newtaipei = { inf: 2 };
  const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 9 });
  await untilStep(f, 0);
  assert.equal(get('#bsPause').disabled, false);
  assert.equal(get('#bsFast').disabled, false);
  get('#bsPause').focus();
  get('#bsSkip').handlers.click();
  for (let i = 0; i < 50 && get('#bsDone').hidden; i++) await Promise.resolve();
  assert.equal(get('#bsDone').hidden, false);
  assert.equal(get('#bsPause').disabled, true);
  assert.equal(get('#bsFast').disabled, true);
  assert.equal(get('#bsSkip').disabled, true);
  const focusables = h.battleFocusables();
  assert.equal(focusables.length, 1);
  assert.equal(focusables[0].id, 'bsDone');
  assert.equal(focusables[0], get('#bsDone'));
  assert.equal(f.focused, get('#bsDone'));
  assert.equal(f.context.document.activeElement, get('#bsDone'));
  for (const shiftKey of [false, true]) {
    let prevented = false;
    f.listeners.keydown.at(-1)({
      key: 'Tab', shiftKey,
      preventDefault() { prevented = true; },
      target: get('#bsDone'),
    });
    assert.equal(prevented, true);
    assert.equal(f.focused, get('#bsDone'));
    assert.equal(f.context.document.activeElement, get('#bsDone'));
  }
  get('#bsDone').handlers.click();
  await f.flush(); await battle;
  h.S.over = false;
  h.S.owner.newtaipei = 'newtaipei';
  h.S.army.taipei = { inf: 10 };
  h.S.army.newtaipei = { inf: 5 };
  h.S.acted.delete('taipei');
  delete h.S.moved.taipei;
  delete h.S.moved.newtaipei;
  const again = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 4 });
  await untilStep(f, 0);
  assert.equal(get('#bsPause').disabled, false);
  assert.equal(get('#bsFast').disabled, false);
  assert.equal(get('#bsDone').hidden, true);
  const open = h.battleFocusables();
  assert.ok(open.includes(get('#bsPause')));
  assert.ok(open.includes(get('#bsFast')));
  await f.flush(); await again;
});
async function skipThenCloseBattle(f) {
  f.get('#bsSkip').handlers.click();
  for (let i = 0; i < 50 && f.get('#bsDone').hidden; i++) await Promise.resolve();
  if (!f.get('#bsDone').hidden) f.get('#bsDone').handlers.click();
  await f.flush();
}
test('closing the battle screen returns focus to the element focused before the battle, or the map', async () => {
  {
    const f = fixture(), { h, get } = f;
    const endTurn = get('#endTurn');
    endTurn.hidden = false;
    endTurn.disabled = false;
    endTurn.focus();
    h.S.army.taipei = { inf: 10 }; h.S.army.newtaipei = { inf: 2 };
    const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 9 });
    await untilStep(f, 0);
    assert.equal(h.BV.returnFocus, endTurn);
    await skipThenCloseBattle(f); await battle;
    assert.equal(get('#battleScreen').hidden, true);
    assert.equal(f.focused, endTurn);
    assert.equal(f.context.document.activeElement, endTurn);
    assert.notEqual(f.focused, f.context.document.body);
    assert.equal(h.BV.returnFocus, null);
  }
  {
    const f = fixture(), { h, get } = f;
    const endTurn = get('#endTurn');
    endTurn.hidden = false;
    endTurn.disabled = false;
    endTurn.focus();
    h.S.army.taipei = { inf: 10 }; h.S.army.newtaipei = { inf: 2 };
    const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 9 });
    await untilStep(f, 0);
    endTurn.disabled = true;
    await skipThenCloseBattle(f); await battle;
    assert.equal(f.focused, get('#map'));
    assert.equal(f.context.document.activeElement, get('#map'));
    assert.notEqual(f.focused, f.context.document.body);
    assert.notEqual(f.context.document.activeElement, f.context.document.body);
    assert.equal(h.BV.returnFocus, null);
  }
  {
    const f = fixture(), { h, get } = f;
    const dlg = get('#attackDialog'), btn = get('#endTurn');
    btn.hidden = false;
    dlg.hidden = false;
    dlg.appendChild(btn);
    btn.focus();
    h.S.army.taipei = { inf: 10 }; h.S.army.newtaipei = { inf: 2 };
    const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 9 });
    await untilStep(f, 0);
    dlg.hidden = true;
    await skipThenCloseBattle(f); await battle;
    assert.equal(f.focused, get('#map'));
    assert.notEqual(f.focused, f.context.document.body);
  }
  {
    const f = fixture(), { h, get } = f;
    const body = { id: 'body', tagName: 'BODY' };
    f.context.document.body = body;
    f.context.document.activeElement = body;
    h.S.army.taipei = { inf: 10 }; h.S.army.newtaipei = { inf: 2 };
    const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 9 });
    await untilStep(f, 0);
    assert.equal(h.BV.returnFocus, null);
    await skipThenCloseBattle(f); await battle;
    assert.equal(f.focused, get('#map'));
    assert.notEqual(f.focused, body);
    assert.notEqual(f.context.document.activeElement, body);
  }
  {
    const f = fixture(), { h, get } = f;
    const btn = get('#newBtn');
    btn.focus();
    h.BV.returnFocus = get('#endTurn');
    h.closeBattle();
    assert.equal(f.focused, btn);
    assert.equal(f.context.document.activeElement, btn);
    assert.equal(h.BV.returnFocus, null);
  }
});
test('space pauses a running attack when no button is focused; a focused button keeps native Space; S skips', async () => {
  const f = fixture(), { h, get } = f;
  h.S.army.taipei = { inf: 10 }; h.S.army.newtaipei = { inf: 5 };
  const attack = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 4 });
  await untilStep(f, 0);
  assert.equal(get('#bsDone').hidden, true);
  assert.equal(h.BV.paused, false);
  assert.equal(h.BV.skip, false);
  const down = (key, extra = {}) => {
    let prevented = false;
    f.listeners.keydown.at(-1)({
      key,
      repeat: !!extra.repeat,
      preventDefault() { prevented = true; },
      target: extra.target || { tagName: 'DIV' },
    });
    return prevented;
  };
  assert.equal(down(' ', { repeat: true, target: { tagName: 'DIV' } }), true);
  assert.equal(h.BV.paused, false, 'auto-repeat does not toggle pause');
  assert.equal(h.BV.skip, false);
  assert.equal(down(' ', { target: { tagName: 'DIV' } }), true);
  assert.equal(h.BV.paused, true);
  assert.equal(h.BV.skip, false);
  assert.equal(down(' ', { target: { tagName: 'DIV' } }), true);
  assert.equal(h.BV.paused, false);
  assert.equal(h.BV.skip, false);
  assert.equal(down(' ', { repeat: true, target: { tagName: 'DIV' } }), true);
  assert.equal(h.BV.paused, false, 'auto-repeat does not resume either');
  assert.equal(down(' ', { target: { tagName: 'BUTTON' } }), false);
  assert.equal(h.BV.paused, false);
  assert.equal(h.BV.skip, false);
  assert.equal(down('Enter', { target: { tagName: 'DIV' } }), false);
  assert.equal(h.BV.skip, false, 'Enter does not continue a battle that is still running');
  assert.equal(down('Enter', { target: { tagName: 'BUTTON' } }), false);
  assert.equal(h.BV.skip, false);
  get('#bsSkip').handlers.click();
  assert.equal(h.BV.skip, true);
  h.BV.skip = false;
  assert.equal(down('s'), true);
  assert.equal(h.BV.skip, true);
  h.BV.skip = false;
  assert.equal(down('S'), true);
  assert.equal(h.BV.skip, true);
  await f.flush(); await attack;
  assert.equal(get('#battleScreen').hidden, true);
  assert.equal(h.BV.open, false);
});
async function openPausedResult(f) {
  const { h, get } = f;
  h.S.army.taipei = { inf: 10 };
  h.S.army.newtaipei = { inf: 2 };
  const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 9 });
  await untilStep(f, 0);
  get('#bsPause').handlers.click();
  assert.equal(h.BV.paused, true);
  assert.equal(get('#bsPause').textContent, '▶');
  assert.equal(get('#bsPause').getAttribute('aria-label'), '繼續戰鬥');
  f.listeners.keydown.at(-1)({ key: 's', repeat: false, preventDefault() {}, target: { tagName: 'DIV' } });
  for (let i = 0; i < 50 && get('#bsDone').hidden; i++) await Promise.resolve();
  assert.equal(get('#bsDone').hidden, false);
  assert.equal(get('#battleScreen').hidden, false);
  assert.equal(h.BV.open, true);
  assert.equal(h.BV.paused, false);
  assert.equal(h.BV.endedPaused, true);
  assert.equal(get('#bsPause').textContent, '⏸');
  assert.equal(get('#bsPause').getAttribute('aria-label'), '暫停戰鬥');
  assert.equal(get('#bsPause').disabled, true);
  assert.equal(get('#bsFast').disabled, true);
  assert.equal(f.focused, get('#bsDone'));
  assert.equal(f.context.document.activeElement, get('#bsDone'));
  // Return a plain object so await does not unwrap the still-open battle promise.
  return { battle };
}
// Two full flushes are far past the 2400ms auto-close, and past the 200ms poll.
async function assertPausedResultStaysOpen(f) {
  await f.flush();
  await f.flush();
  assert.equal(f.get('#battleScreen').hidden, false);
  assert.equal(f.get('#bsDone').hidden, false);
  assert.equal(f.h.BV.open, true);
  assert.equal(f.focused, f.get('#bsDone'));
  assert.equal(f.context.document.activeElement, f.get('#bsDone'));
}
function pressBattleKey(f, key, extra = {}) {
  let prevented = false;
  f.listeners.keydown.at(-1)({
    key,
    repeat: !!extra.repeat,
    ctrlKey: !!extra.ctrlKey,
    metaKey: !!extra.metaKey,
    altKey: !!extra.altKey,
    preventDefault() { prevented = true; },
    target: extra.target || f.get('#battleScreen'),
  });
  return prevented;
}
function prepareBattleReturnFocus(f) {
  const endTurn = f.get('#endTurn');
  endTurn.hidden = false;
  endTurn.disabled = false;
  endTurn.focus();
  return endTurn;
}
function assertBattleFocusRestored(f, endTurn, usable, label) {
  const expected = usable ? endTurn : f.get('#map');
  assert.equal(f.get('#battleScreen').hidden, true, label);
  assert.equal(f.focused, expected, label);
  assert.equal(f.context.document.activeElement, expected, label);
  assert.notEqual(f.focused, f.context.document.body, label);
  assert.notEqual(f.context.document.activeElement, f.context.document.body, label);
  assert.equal(f.h.BV.returnFocus, null, label);
}
test('a battle that ends while paused resets ⏸, stays open past the auto-close timer, and the next battle re-enables ⏸ ⏩', async () => {
  const f = fixture(), { h, get } = f;
  const endTurn = prepareBattleReturnFocus(f);
  const { battle } = await openPausedResult(f);
  assert.equal(h.BV.returnFocus, endTurn);
  get('#bsPause').handlers.click();
  assert.equal(h.BV.paused, false, 'pause cannot toggle once the battle is done');
  assert.equal(get('#bsPause').textContent, '⏸');
  assert.equal(get('#bsPause').getAttribute('aria-label'), '暫停戰鬥');
  assert.equal(pressBattleKey(f, ' ', { target: get('#bsDone') }), false);
  assert.equal(pressBattleKey(f, 'Enter', { target: get('#bsDone') }), false);
  assert.equal(h.BV.skip, false, 'Enter or Space on 繼續 stays a native button press');
  assert.equal(h.BV.paused, false);
  for (const key of [' ', 'Enter']) {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
      assert.equal(pressBattleKey(f, key, { [mod]: true }), false, `${mod}+${key} does not continue`);
      assert.equal(h.BV.skip, false);
      assert.equal(h.BV.paused, false);
    }
  }
  await assertPausedResultStaysOpen(f);
  get('#bsDone').handlers.click();
  await f.flush();
  assertBattleFocusRestored(f, endTurn, true, '繼續');
  await battle;
  h.S.over = false;
  h.S.owner.newtaipei = 'newtaipei';
  h.S.army.taipei = { inf: 10 };
  h.S.army.newtaipei = { inf: 5 };
  h.S.acted.delete('taipei');
  delete h.S.moved.taipei;
  delete h.S.moved.newtaipei;
  const again = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 4 });
  await untilStep(f, 0);
  assert.equal(get('#bsPause').disabled, false);
  assert.equal(get('#bsFast').disabled, false);
  assert.equal(h.BV.paused, false);
  assert.equal(h.BV.endedPaused, false);
  assert.equal(get('#bsPause').textContent, '⏸');
  assert.equal(get('#bsPause').getAttribute('aria-label'), '暫停戰鬥');
  get('#bsPause').handlers.click();
  assert.equal(h.BV.paused, true);
  assert.equal(get('#bsPause').textContent, '▶');
  get('#bsPause').handlers.click();
  assert.equal(h.BV.paused, false);
  assert.equal(get('#bsPause').textContent, '⏸');
  await f.flush();
  await again;
});
test('a paused battle result closes from 繼續, Escape, Enter, or Space and restores focus', async () => {
  const paths = [
    ['繼續', f => { f.get('#bsDone').handlers.click(); }],
    ['Escape', f => { pressBattleKey(f, 'Escape'); }],
    ['Enter', f => { assert.equal(pressBattleKey(f, 'Enter'), true); }],
    ['Space', f => { assert.equal(pressBattleKey(f, ' '), true); }],
  ];
  for (const [name, close] of paths) {
    for (const usable of [true, false]) {
      const f = fixture(), { h } = f;
      const endTurn = prepareBattleReturnFocus(f);
      const { battle } = await openPausedResult(f);
      assert.equal(h.BV.returnFocus, endTurn, name);
      if (!usable) endTurn.disabled = true;
      await assertPausedResultStaysOpen(f);
      close(f);
      await f.flush();
      assertBattleFocusRestored(f, endTurn, usable, `${name} usable=${usable}`);
      await battle;
    }
  }
});
test('a battle that ends without pause still auto-closes after the timer', async () => {
  const f = fixture(), { h, get } = f;
  h.S.army.taipei = { inf: 10 };
  h.S.army.newtaipei = { inf: 2 };
  const battle = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 9 });
  await untilStep(f, 0);
  assert.equal(h.BV.paused, false);
  f.listeners.keydown.at(-1)({ key: 's', repeat: false, preventDefault() {}, target: { tagName: 'DIV' } });
  for (let i = 0; i < 50 && get('#bsDone').hidden; i++) await Promise.resolve();
  assert.equal(get('#bsDone').hidden, false);
  assert.equal(h.BV.endedPaused, false);
  assert.equal(h.BV.paused, false);
  assert.equal(get('#battleScreen').hidden, false);
  assert.equal(f.focused, get('#bsDone'));
  await f.flush();
  await battle;
  assert.equal(get('#battleScreen').hidden, true);
  assert.equal(h.BV.open, false);
});
test('a paused battle result stops waiting when the battle generation changes', async () => {
  const f = fixture(), { h, get } = f;
  const { battle } = await openPausedResult(f);
  const generation = h.S.gen;
  h.S.gen++;
  h.closeBattle();
  await f.flush();
  await battle;
  assert.equal(h.S.gen, generation + 1);
  assert.equal(get('#battleScreen').hidden, true);
  assert.equal(h.BV.open, false);
});
test('modifier+S/Esc/Space do not skip or pause a running battle', async () => {
  const f = fixture(), { h, get } = f;
  h.S.army.taipei = { inf: 10 }; h.S.army.newtaipei = { inf: 5 };
  const attack = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 4 });
  await untilStep(f, 0);
  assert.equal(get('#bsDone').hidden, true);
  assert.equal(h.BV.paused, false);
  assert.equal(h.BV.skip, false);
  const down = (key, extra = {}) => {
    let prevented = false;
    f.listeners.keydown.at(-1)({
      key,
      repeat: !!extra.repeat,
      ctrlKey: !!extra.ctrlKey,
      metaKey: !!extra.metaKey,
      altKey: !!extra.altKey,
      preventDefault() { prevented = true; },
      target: extra.target || { tagName: 'DIV' },
    });
    return prevented;
  };
  for (const key of ['s', 'S']) {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
      assert.equal(down(key, { [mod]: true }), false, `${mod}+${key} keeps the browser shortcut`);
      assert.equal(h.BV.skip, false);
      assert.equal(h.BV.paused, false);
    }
  }
  assert.equal(down('Escape', { ctrlKey: true }), false);
  assert.equal(h.BV.skip, false);
  assert.equal(h.BV.paused, false);
  assert.equal(down(' ', { metaKey: true, target: { tagName: 'DIV' } }), false);
  assert.equal(h.BV.skip, false);
  assert.equal(h.BV.paused, false);
  assert.equal(down('s'), true);
  assert.equal(h.BV.skip, true);
  h.BV.skip = false;
  assert.equal(down('S'), true);
  assert.equal(h.BV.skip, true);
  await f.flush(); await attack;
  assert.equal(get('#battleScreen').hidden, true);
  assert.equal(h.BV.open, false);
});
test('modifier+T does not open the tactic menu; plain t does', async () => {
  const f = fixture(), { h, get } = f;
  h.S.army.taipei = { inf: 10 }; h.S.army.newtaipei = { inf: 5 };
  const attack = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 4 });
  await untilStep(f, 0);
  assert.equal(h.BV.side, 'A');
  assert.equal(get('#bsTacticWrap').hidden, false);
  assert.equal(get('#bsTacticMenu').hidden, true);
  const down = (key, extra = {}) => {
    let prevented = false;
    f.listeners.keydown.at(-1)({
      key, repeat: false,
      ctrlKey: !!extra.ctrlKey, metaKey: !!extra.metaKey, altKey: !!extra.altKey,
      preventDefault() { prevented = true; },
      target: { tagName: 'DIV' },
    });
    return prevented;
  };
  for (const key of ['t', 'T']) {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
      assert.equal(down(key, { [mod]: true }), false, `${mod}+${key} leaves the browser shortcut`);
      assert.equal(get('#bsTacticMenu').hidden, true);
    }
  }
  assert.equal(down('t'), true);
  assert.equal(get('#bsTacticMenu').hidden, false);
  assert.equal(down('T'), true);
  assert.equal(get('#bsTacticMenu').hidden, true);
  await f.flush(); await attack;
});
test('modifier+M does not toggle sound; plain m does', () => {
  const f = fixture(), { get } = f;
  let muted = true;
  f.context.Sfx = { muted: () => muted, toggle() { muted = !muted; return muted; } };
  get('#modal').hidden = true;
  const down = (key, extra = {}) => {
    let prevented = false;
    f.listeners.keydown.at(-1)({
      key, repeat: false,
      ctrlKey: !!extra.ctrlKey, metaKey: !!extra.metaKey, altKey: !!extra.altKey,
      preventDefault() { prevented = true; },
      target: extra.target || { tagName: 'DIV' },
    });
    return prevented;
  };
  for (const key of ['m', 'M']) {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
      assert.equal(down(key, { [mod]: true }), false, `${mod}+${key} leaves the browser shortcut`);
      assert.equal(muted, true);
      assert.equal(get('#sfxBtn').textContent, '🔇');
    }
  }
  assert.equal(down('m'), true);
  assert.equal(muted, false);
  assert.equal(get('#sfxBtn').textContent, '🔊');
  assert.equal(down('M', { target: { tagName: 'INPUT' } }), false);
  assert.equal(muted, false, 'typing still swallows a plain M');
});
test('modifier+arrows do not move a row; plain arrows do', async () => {
  const f = fixture(), { h } = f;
  h.S.army.taipei = { inf: 10, moto: 6 }; h.S.army.newtaipei = { gen: 12, art: 6 };
  const attack = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 9, moto: 6 });
  await untilStep(f, 0);
  const lanes = () => h.BV.st.laneA.join();
  const start = lanes();
  assert.equal(h.BV.sel, 0);
  const down = (key, extra = {}) => {
    let prevented = false;
    f.listeners.keydown.at(-1)({
      key,
      ctrlKey: !!extra.ctrlKey, metaKey: !!extra.metaKey, altKey: !!extra.altKey,
      preventDefault() { prevented = true; },
      target: { tagName: 'DIV' },
    });
    return prevented;
  };
  assert.equal(down('ArrowLeft', { altKey: true }), false);
  assert.equal(down('ArrowRight', { ctrlKey: true }), false);
  assert.equal(down('ArrowLeft', { metaKey: true }), false);
  assert.equal(down('ArrowRight', { altKey: true }), false);
  assert.equal(lanes(), start);
  assert.equal(h.BV.sel, 0);
  assert.equal(down('ArrowLeft'), true);
  assert.equal(h.BV.sel, 1);
  assert.notEqual(lanes(), start);
  const moved = lanes();
  assert.equal(down('ArrowRight'), true);
  assert.equal(h.BV.sel, 0);
  assert.equal(lanes(), start);
  assert.notEqual(lanes(), moved);
  await f.flush(); await attack;
});
test('modifier+E/Enter/Escape do not end the turn or confirm or cancel an attack', () => {
  const f = fixture(), { h, get } = f;
  get('#modal').hidden = true;
  h.render();
  const btn = get('#endTurn');
  const label = btn.textContent;
  const down = (key, extra = {}) => {
    let prevented = false;
    f.listeners.keydown.at(-1)({
      key,
      ctrlKey: !!extra.ctrlKey, metaKey: !!extra.metaKey, altKey: !!extra.altKey,
      preventDefault() { prevented = true; },
      target: extra.target || { tagName: 'DIV' },
    });
    return prevented;
  };
  assert.equal(down('e', { ctrlKey: true }), false);
  assert.equal(down('Enter', { metaKey: true }), false);
  assert.equal(h.S.current, 'taipei');
  assert.equal(btn.textContent, label);
  assert.equal(btn.classList.contains('confirming'), false);
  h.S.sel = 'taipei';
  assert.equal(down('Escape', { altKey: true }), false);
  assert.equal(h.S.sel, 'taipei');

  h.S.army.taipei = { inf: 5 }; h.S.army.newtaipei = { inf: 1 };
  h.openAttack('taipei', 'newtaipei');
  assert.equal(down('Enter', { ctrlKey: true }), false);
  assert.equal(get('#attackDialog').hidden, false);
  assert.equal(h.S.acted.has('taipei'), false);
  assert.equal(down('Escape', { ctrlKey: true }), false);
  assert.equal(get('#attackDialog').hidden, false);
  assert.ok(h.S.attack);
});
test('Shift+E ends the turn like e; Ctrl/Meta/Alt+E (with or without Shift) still do nothing', () => {
  const f = fixture(), { h, get } = f;
  get('#modal').hidden = true;
  h.render();
  const btn = get('#endTurn');
  const label = btn.textContent;
  const down = (key, extra = {}) => {
    let prevented = false;
    f.listeners.keydown.at(-1)({
      key,
      ctrlKey: !!extra.ctrlKey, metaKey: !!extra.metaKey, altKey: !!extra.altKey,
      shiftKey: !!extra.shiftKey,
      preventDefault() { prevented = true; },
      target: extra.target || { tagName: 'DIV' },
    });
    return prevented;
  };
  const blocked = [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { ctrlKey: true, shiftKey: true },
    { metaKey: true, shiftKey: true },
    { altKey: true, shiftKey: true },
  ];
  for (const extra of blocked) assert.equal(down('E', extra), false);
  assert.equal(h.S.current, 'taipei');
  assert.equal(btn.textContent, label);
  assert.equal(btn.classList.contains('confirming'), false);

  assert.equal(down('E', { shiftKey: true }), false);
  assert.equal(h.S.current, 'taipei');
  assert.equal(btn.textContent, '還有 1 個縣市可出征，確定結束？');
  assert.equal(btn.classList.contains('confirming'), true);

  for (const extra of blocked) assert.equal(down('E', extra), false);
  assert.equal(h.S.current, 'taipei');
  assert.equal(btn.textContent, '還有 1 個縣市可出征，確定結束？');
  assert.equal(btn.classList.contains('confirming'), true);

  down('E', { shiftKey: true });
  assert.notEqual(h.S.current, 'taipei');
  assert.equal(btn.classList.contains('confirming'), false);
});
test('trapFocusTarget wraps the ends and leaves the middle to the browser', () => {
  const { h } = fixture();
  const first = { id: 'first' }, mid = { id: 'mid' }, last = { id: 'last' };
  const list = [first, mid, last];
  const outside = { id: 'outside' }, container = { id: 'battleScreen' };
  assert.equal(h.trapFocusTarget(list, last, false), first);
  assert.equal(h.trapFocusTarget(list, first, true), last);
  assert.equal(h.trapFocusTarget(list, container, false), first);
  assert.equal(h.trapFocusTarget(list, container, true), last);
  assert.equal(h.trapFocusTarget(list, outside, false), first);
  assert.equal(h.trapFocusTarget(list, outside, true), last);
  assert.equal(h.trapFocusTarget(list, mid, false), null);
  assert.equal(h.trapFocusTarget(list, mid, true), null);
});
test('disabling 往前 moves focus to the other move button or the battle screen; castTactic focuses the screen', async () => {
  const f = fixture(), { h, get } = f;
  h.S.army.taipei = { inf: 10, moto: 6 }; h.S.army.newtaipei = { gen: 12, art: 6 };
  const attack = h.doAttack('taipei', 'newtaipei', h.S.gen, false, { inf: 9, moto: 6 });
  await untilStep(f, 0);
  const fwd = get('#bsFwd'), back = get('#bsBack'), screen = get('#battleScreen');
  assert.equal(h.BV.sel, 0);
  assert.equal(fwd.disabled, true);
  back.focus();
  back.handlers.click();
  assert.equal(h.BV.sel, 1);
  assert.equal(fwd.disabled, false);
  fwd.focus();
  fwd.handlers.click();
  assert.equal(fwd.disabled, true);
  assert.ok(f.focused === back || f.focused === screen);
  assert.notEqual(f.focused, null);
  assert.notEqual(f.focused, f.context.document.body);
  assert.notEqual(f.context.document.activeElement, null);
  assert.notEqual(f.context.document.activeElement, f.context.document.body);
  assert.notEqual(f.focused, fwd);

  get('#bsTacticBtn').focus();
  assert.equal(h.castTactic('fire'), true);
  assert.equal(get('#bsTacticBtn').disabled, true);
  assert.equal(get('#bsTacticMenu').hidden, true);
  assert.equal(f.focused, screen);
  assert.notEqual(f.context.document.activeElement, f.context.document.body);
  await f.flush(); await attack;
});
test('needsLowChanceConfirm is true at or below 10 percent', () => {
  const { h } = fixture();
  assert.equal(h.LOW_CHANCE, 10);
  assert.equal(h.needsLowChanceConfirm(0), true);
  assert.equal(h.needsLowChanceConfirm(9), true);
  assert.equal(h.needsLowChanceConfirm(10), true);
  assert.equal(h.needsLowChanceConfirm(10.5), false);
  assert.equal(h.needsLowChanceConfirm(11), false);
  assert.equal(h.needsLowChanceConfirm(65), false);
  assert.equal(h.needsLowChanceConfirm(undefined), false);
});
test('an estimate of exactly 10 percent needs two confirm clicks', async () => {
  const f = fixture(), { h, get } = f;
  h.S.speed = 99;
  h.S.army.taipei = { inf: 2 };
  h.S.army.newtaipei = { inf: 2 };
  h.openAttack('taipei', 'newtaipei');
  assert.equal(h.S.attack.chance, 10);
  const army = JSON.stringify(h.S.army);
  const first = get('#attackConfirm').handlers.click();
  await first;
  assert.equal(h.S.acted.has('taipei'), false);
  assert.equal(get('#attackDialog').hidden, false);
  assert.equal(JSON.stringify(h.S.army), army);
  assert.ok(get('#attackConfirm').classList.contains('danger'));
  assert.match(get('#attackConfirm').textContent, /勝率僅 10%/);
  assert.equal(get('#lowChanceWarning').hidden, false);
  assert.match(get('#lowChanceWarning').textContent, /僅 10%/);
  const launch = get('#attackConfirm').handlers.click();
  await Promise.resolve();
  assert.ok(h.S.acted.has('taipei'));
  await f.flush();
  await launch;
});
test('a 0% attack needs two confirm clicks before it launches', async () => {
  const f = fixture(), { h, get } = f;
  h.S.speed = 99;
  h.S.army.taipei = { inf: 2 };
  h.S.army.newtaipei = { gen: 25 };
  h.openAttack('taipei', 'newtaipei');
  assert.equal(h.S.attack.chance, 0);
  const army = JSON.stringify(h.S.army);
  const first = get('#attackConfirm').handlers.click();
  await first;
  assert.equal(h.S.acted.has('taipei'), false);
  assert.equal(get('#attackDialog').hidden, false);
  assert.equal(JSON.stringify(h.S.army), army);
  assert.ok(get('#attackConfirm').classList.contains('danger'));
  assert.match(get('#attackConfirm').textContent, /勝率僅 0%/);
  assert.equal(get('#lowChanceWarning').hidden, false);
  assert.match(get('#lowChanceWarning').textContent, /僅 0%/);
  get('#attackRows').handlers.change({ target: { dataset: { amount: 'inf' }, value: '1' } });
  assert.equal(get('#attackConfirm').classList.contains('danger'), false);
  assert.equal(get('#lowChanceWarning').hidden, true);
  const again = get('#attackConfirm').handlers.click();
  await again;
  assert.equal(h.S.acted.has('taipei'), false, 'changing deployment resets the warning');
  assert.equal(get('#attackDialog').hidden, false);
  const launch = get('#attackConfirm').handlers.click();
  await Promise.resolve();
  assert.ok(h.S.acted.has('taipei'));
  await f.flush();
  await launch;
});
test('Enter in the attack dialog follows the same two-step low-chance confirm', async () => {
  const f = fixture(), { h, get } = f;
  h.S.speed = 99;
  get('#modal').hidden = true;
  h.S.army.taipei = { inf: 2 };
  h.S.army.newtaipei = { gen: 25 };
  h.openAttack('taipei', 'newtaipei');
  const press = (key, target) => f.listeners.keydown.at(-1)({
    key, preventDefault() {}, target: target || { tagName: 'DIV' },
  });
  press('Enter');
  assert.equal(h.S.acted.has('taipei'), false);
  assert.equal(get('#attackDialog').hidden, false);
  assert.match(get('#attackConfirm').textContent, /勝率僅 0%/);
  press('Enter');
  await Promise.resolve();
  assert.ok(h.S.acted.has('taipei'));
  await f.flush();
});
test('Enter on another attack-dialog button does not arm the attack; Enter on an input still confirms in two steps', async () => {
  const f = fixture(), { h, get } = f;
  h.S.speed = 99;
  get('#modal').hidden = true;
  h.S.army.taipei = { inf: 2 };
  h.S.army.newtaipei = { gen: 25 };
  h.openAttack('taipei', 'newtaipei');
  const prevented = [];
  const press = (key, target) => f.listeners.keydown.at(-1)({
    key,
    preventDefault() { prevented.push(target.tagName); },
    target,
  });
  const label = get('#attackConfirm').textContent;
  press('Enter', { tagName: 'BUTTON', id: 'someOtherBtn' });
  assert.equal(h.S.acted.has('taipei'), false);
  assert.equal(get('#attackDialog').hidden, false);
  assert.equal(get('#lowChanceWarning').hidden, true);
  assert.equal(get('#attackConfirm').classList.contains('danger'), false);
  assert.equal(get('#attackConfirm').textContent, label);
  assert.equal(h.S.current, 'taipei');
  assert.equal(get('#endTurn').classList.contains('confirming'), false);
  assert.deepEqual(prevented, []);

  press('Enter', { tagName: 'INPUT' });
  assert.equal(h.S.acted.has('taipei'), false);
  assert.equal(get('#attackDialog').hidden, false);
  assert.equal(get('#lowChanceWarning').hidden, false);
  assert.match(get('#attackConfirm').textContent, /勝率僅 0%/);
  assert.equal(h.S.current, 'taipei');
  assert.equal(get('#endTurn').classList.contains('confirming'), false);
  assert.deepEqual(prevented, ['INPUT']);

  press('Enter', { tagName: 'INPUT' });
  await Promise.resolve();
  assert.ok(h.S.acted.has('taipei'));
  assert.equal(h.S.current, 'taipei');
  await f.flush();
});

test('synthesized sfx stays silent without AudioContext, defaults to muted, and persists the toggle', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const readme = fs.readFileSync('README.md', 'utf8');
  assert.ok(html.indexOf('js/sfx.js?v=20261023c') !== -1 && html.indexOf('js/sfx.js?v=20261023c') < html.indexOf('js/game.js'), 'sfx.js loads before game.js');
  assert.match(html, /id="sfxBtn"[^>]*aria-label="音效：關"/);
  assert.match(html, /id="sfxBtn"[^>]*title="音效：關"/);
  assert.match(html, /id="sfxBtnStart"[^>]*aria-label="音效：關"/);
  assert.match(html, /id="sfxBtnStart"[^>]*title="音效：關"/);
  assert.match(readme, /🔇／🔊/);
  assert.match(readme, /預設靜音/);

  function load(extra, storage = new Map()) {
    const context = vm.createContext({
      localStorage: {
        getItem: k => storage.has(k) ? storage.get(k) : null,
        setItem(k, v) { if (storage.get('deny')) throw Error('denied'); storage.set(k, String(v)); },
      },
      ...extra,
    });
    vm.runInContext(fs.readFileSync('js/sfx.js', 'utf8'), context);
    return context.Sfx;
  }

  const storage = new Map();
  const Sfx = load({}, storage);
  assert.equal(typeof Sfx.play, 'function');
  assert.equal(Sfx.muted(), true);
  assert.doesNotThrow(() => Sfx.play('attack'));
  assert.doesNotThrow(() => Sfx.play('not-a-sound'));
  assert.equal(storage.has('tcw-muted'), false, 'reading the default does not write storage');
  Sfx.toggle();
  assert.equal(Sfx.muted(), false);
  assert.equal(storage.get('tcw-muted'), '0');
  assert.doesNotThrow(() => {
    for (const name of ['click', 'attack', 'hit', 'capture', 'hold', 'news', 'tactic', 'end']) Sfx.play(name);
  });
  Sfx.setMuted(true);
  assert.equal(Sfx.muted(), true);
  assert.equal(storage.get('tcw-muted'), '1');
  Sfx.toggle();
  assert.equal(Sfx.muted(), false);
  storage.set('deny', '1');
  assert.doesNotThrow(() => Sfx.toggle());
  assert.equal(Sfx.muted(), true, 'mute still flips when storage throws');

  const storedOn = new Map([['tcw-muted', '0']]);
  let constructed = 0;
  const unmuted = load({ AudioContext: class { constructor() { constructed++; throw Error('blocked'); } } }, storedOn);
  assert.equal(unmuted.muted(), false);
  assert.doesNotThrow(() => unmuted.play('click'));
  assert.equal(constructed, 1);

  const clock = { t: 1000 };
  let osc = 0, master = null, contexts = 0;
  class FakeAudio {
    constructor() {
      contexts++;
      this.sampleRate = 8000;
      this.currentTime = 0;
      this.state = 'running';
      this.destination = {};
    }
    createGain() {
      const gain = { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} };
      const node = { gain, connect() {} };
      if (!this.master) { this.master = node; master = node; }
      return node;
    }
    createOscillator() {
      osc++;
      return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} };
    }
    createBuffer(_ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    createBufferSource() { return { connect() {}, start() {}, stop() {} }; }
    createBiquadFilter() { return { type: '', frequency: { setValueAtTime() {} }, connect() {} }; }
  }
  const live = load({ AudioContext: FakeAudio, performance: { now: () => clock.t } }, new Map([['tcw-muted', '0']]));
  assert.equal(live.muted(), false);
  live.play('attack');
  assert.equal(contexts, 1);
  assert.equal(master.gain.value, 0.25);
  const first = osc;
  assert.ok(first >= 1);
  live.play('attack');
  assert.equal(osc, first, 'same sound inside 60 ms is ignored');
  clock.t += 60;
  live.play('attack');
  assert.ok(osc > first);
  live.setMuted(true);
  const gated = osc;
  live.play('click');
  assert.equal(osc, gated, 'muted play stays silent');
  assert.equal(live.muted(), true);
});
