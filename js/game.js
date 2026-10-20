// 遊戲主程式：回合流程、戰鬥、AI、介面
(() => {
  const byId = Object.fromEntries(COUNTIES.map(c => [c.id, c]));
  const ADJ = Object.fromEntries(COUNTIES.map(c => [c.id, new Set()]));
  for (const [a, list] of Object.entries(ADJACENCY)) for (const b of list) { ADJ[a].add(b); ADJ[b].add(a); }

  const $ = s => document.querySelector(s);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  // 軍隊 = { 兵種id: 數量 }，兵種可能是基本兵種或自組兵種（S.units）
  const emptyArmy = () => ({});
  const kinds = a => Object.keys(a).filter(k => a[k] > 0);
  const count = a => kinds(a).reduce((s, k) => s + a[k], 0);
  const addUnits = (a, k, n) => { a[k] = (a[k] || 0) + n; };
  const U = k => S.units[k];
  const fmtMoney = n => `${Math.floor(n)} 萬`;

  const S = { gen: 0, speed: 1, paused: false, over: true, hover: null, diffKey: 'easy' };
  const map = buildMap($('#map'), onCountyClick, id => { S.hover = id; if (!S.sel) renderInfo(); renderTip(); });

  // ───────── 狀態查詢 ─────────
  const owned = f => COUNTIES.filter(c => S.owner[c.id] === f).map(c => c.id);
  const alive = () => [...new Set(Object.values(S.owner))];
  const enemiesOf = id => [...ADJ[id]].filter(n => S.owner[n] !== S.owner[id]);
  const isFront = id => enemiesOf(id).length > 0;
  const fTag = f => `<b style="color:${byId[f].color}">${byId[f].short}</b>`;
  const cTag = id => `<span class="ctag">${byId[id].short}</span>`;
  const unitIcon = (k, cls = 'unit-sprite') => U(k).sprite ? `<img class="${cls}" src="${U(k).sprite}" alt="">` : U(k).icon;
  const unitCost = (k, id) => Math.round(U(k).cost * (byId[id].cheap === U(k).cls ? 0.8 : 1));
  const unitsOf = f => [...UNIT_KEYS, ...Object.keys(S.units).filter(k => S.units[k].owner === f)];
  const customOf = f => Object.keys(S.units).filter(k => S.units[k].owner === f);
  const armyHtml = a => kinds(a).length
    ? kinds(a).map(k => `<span title="${U(k).name}（${UNIT_CLASSES[U(k).cls]}）">${unitIcon(k)}<b>${a[k]}</b></span>`).join('')
    : '<span class="emptyArmy">空城</span>';
  const researchCost = (f, k) => 120 * (S.research[f][k] + 1);

  function income(f) {
    const ids = owned(f);
    let n = ids.reduce((s, id) => s + byId[id].econ, 0) * (1 + 0.15 * S.research[f].eco);
    for (const r of REGIONS) if (r.ids.every(id => S.owner[id] === f)) n += r.bonus;
    return Math.round(n);
  }
  function power(army, mult = 1) {
    return kinds(army).reduce((s, k) => s + army[k] * (U(k).atk + U(k).hp), 0) * mult;
  }
  const atkMult = (f, id) => byId[id].atk * (1 + 0.12 * S.research[f].atk);
  const defMult = (f, id) => byId[id].def * (1 + 0.12 * S.research[f].def);

  // ───────── 新遊戲 ─────────
  function initState(mode, player) {
    Object.assign(S, {
      mode, player: player || null, over: false, day: 1, turnIdx: 0, current: null, sel: null, busy: false,
      sendHalf: false, acted: new Set(), owner: {}, army: {}, money: {}, research: {}, aggr: {}, paused: false,
      units: Object.fromEntries(UNIT_KEYS.map(k => [k, { ...UNITS[k], owner: null }])), unitSeq: 0,
    });
    COUNTIES.forEach(c => {
      S.owner[c.id] = c.id;
      S.army[c.id] = Object.assign(emptyArmy(), START_ARMY[c.id] || (c.island ? ISLAND_ARMY : DEFAULT_ARMY));
      S.money[c.id] = 100;
      S.research[c.id] = { atk: 0, def: 0, eco: 0 };
      S.aggr[c.id] = rand(1.15, 1.7);
    });
    S.order = shuffle(COUNTIES.map(c => c.id));
  }

  function newGame(mode, player) {
    S.gen++;
    initState(mode, player);
    S.diff = DIFFICULTY[mode === 'play' ? S.diffKey : 'hard'];
    $('#log').innerHTML = '';
    log(mode === 'play'
      ? `📣 ${fTag(player)} 宣布出征！目標：統一全台 22 縣市。（難度：${S.diff.name}）`
      : '📣 22 縣市大亂鬥開始！誰會是最後的贏家？', 'big');
    if (S.diff.aiPeace) log(`🕊️ 前 ${S.diff.aiPeace} 天為和平期：AI 縣市不會主動開戰，趁機招兵、併吞鄰居吧！`, 'event');
    hideModal();
    render();
    runLoop(S.gen);
  }

  // ───────── 回合流程 ─────────
  async function wait(mult = 1, gen) {
    const ms = S.speed >= 99 ? 0 : 550 * mult / S.speed;
    await new Promise(r => setTimeout(r, ms));
    while (S.paused && gen === S.gen) await new Promise(r => setTimeout(r, 120));
  }

  async function runLoop(gen) {
    while (gen === S.gen && !S.over) {
      const f = S.order[S.turnIdx];
      if (owned(f).length) {
        S.current = f;
        const inc = income(f);
        S.money[f] += inc;
        // 替代役：兵力太少的縣市每天自動補 1 名阿兵哥
        owned(f).forEach(id => { if (count(S.army[id]) < 2) addUnits(S.army[id], 'inf', 1); });
        if (f === S.player && S.mode === 'play') {
          S.acted = new Set();
          log(`🌅 第 ${S.day} 天，輪到你了！稅收 +${fmtMoney(inc)}`, 'me');
          render();
          return; // 等玩家按「結束回合」
        }
        S.acted = new Set();
        render();
        await aiTurn(f, gen);
        if (gen !== S.gen || S.over) return;
      }
      await nextTurn(gen);
    }
  }

  async function nextTurn(gen) {
    S.turnIdx++;
    if (S.turnIdx >= S.order.length) {
      S.turnIdx = 0;
      S.day++;
      log(`── 第 ${S.day} 天 ──`, 'day');
      if (S.diff.aiPeace && S.day === S.diff.aiPeace + 1) log('⚠️ 和平期結束！各縣市開始對外擴張', 'big');
      if (Math.random() < 0.3) randomEvent();
      render();
      await wait(0.4, gen);
    }
  }

  function endPlayerTurn() {
    if (S.mode !== 'play' || S.current !== S.player || S.busy || S.over) return;
    S.sel = null;
    S.current = null;
    nextTurn(S.gen).then(() => runLoop(S.gen));
  }

  // ───────── 戰鬥 ─────────
  function applyDamage(army, dmgByType) {
    for (const k of kinds(army)) {
      const x = (dmgByType[k] || 0) / U(k).hp;
      const kills = Math.floor(x) + (Math.random() < x % 1 ? 1 : 0);
      army[k] -= Math.min(kills, army[k]);
    }
  }
  function dealDamage(from, to, mult, motoBonus) {
    const total = count(to);
    const out = {};
    if (!total) return out;
    for (const k of kinds(from)) {
      const dmg = from[k] * U(k).atk * mult * (U(k).cls === 'moto' ? motoBonus : 1) * rand(0.8, 1.2) * 0.35;
      for (const j of kinds(to)) out[j] = (out[j] || 0) + dmg * (to[j] / total) * (COUNTERS[U(k).cls] === U(j).cls ? 1.6 : 1);
    }
    return out;
  }

  function resolveBattle(src, tgt, sent) {
    const fa = S.owner[src], fd = S.owner[tgt];
    const A = { ...sent }, D = { ...S.army[tgt] };
    const am = atkMult(fa, src), dm = defMult(fd, tgt);
    const a0 = count(A), d0 = count(D);
    // 攻方剩不到 35% 就撤退
    for (let round = 0; round < 8 && count(A) > a0 * 0.35 && count(D); round++) {
      const toD = dealDamage(A, D, am / dm, byId[src].moto || 1);
      const toA = dealDamage(D, A, 1 + 0.12 * S.research[fd].atk, byId[tgt].moto || 1);
      applyDamage(D, toD);
      applyDamage(A, toA);
    }
    return { A, D, win: count(D) === 0 && count(A) > 0, lostA: a0 - count(A), lostD: d0 - count(D) };
  }

  async function doAttack(src, tgt, gen, half = false) {
    const fa = S.owner[src], fd = S.owner[tgt];
    const sent = splitArmy(src, half);
    // 至少留一兵守家（留最便宜的）
    if (!count(S.army[src]) && count(sent) > 1) {
      const k = kinds(sent).sort((a, b) => U(a).cost - U(b).cost)[0];
      sent[k]--; addUnits(S.army[src], k, 1);
    }
    S.acted.add(src);
    showArrow(src, tgt, byId[fa].color);
    render();
    await wait(0.9, gen);
    const r = resolveBattle(src, tgt, sent);
    clearArrows();
    battleBurst(src, 'attack');
    battleBurst(tgt, r.win ? 'win' : 'block');
    if (r.win) {
      S.owner[tgt] = fa;
      S.army[tgt] = r.A;
      S.acted.add(tgt);
      popText(tgt, '攻陷！', '#ffd166');
      log(`⚔️ ${fTag(fa)} 從 ${cTag(src)} 出兵攻下 ${cTag(tgt)}（${fTag(fd)}），折損 ${r.lostA} 兵`, fa === S.player ? 'me' : '');
      if (!owned(fd).length) eliminated(fd, fa);
    } else {
      S.army[tgt] = r.D;
      for (const k of kinds(r.A)) addUnits(S.army[src], k, r.A[k]); // 殘兵撤回
      popText(tgt, '守住！', '#8ecae6');
      log(`🛡️ ${cTag(tgt)} 擋下 ${fTag(fa)} 的進攻（攻方損 ${r.lostA}、守方損 ${r.lostD}）`, fd === S.player ? 'me' : '');
    }
    render();
    checkEnd();
    await wait(0.5, gen);
  }

  // 從縣市抽出部隊（全部或一半）
  function splitArmy(id, half) {
    const out = emptyArmy();
    for (const k of kinds(S.army[id])) {
      out[k] = half ? Math.ceil(S.army[id][k] / 2) : S.army[id][k];
      S.army[id][k] -= out[k];
    }
    return out;
  }
  function mergeArmy(to, from) { for (const k of kinds(from)) addUnits(to, k, from[k]); }

  const ELIM_LINES = [
    '居民表示：反正房價一樣買不起。',
    '縣長連夜搭客運逃離。',
    '從此地圖上少了一種顏色。',
    '市議會宣布：明天起改吃對方的名產。',
    '在地網紅開直播哭了三小時。',
  ];
  function eliminated(f, by) {
    log(`💀 ${fTag(f)} 勢力被 ${fTag(by)} 消滅！${pick(ELIM_LINES)}（剩 ${alive().length} 個勢力）`, 'big');
  }

  function checkEnd() {
    if (S.over) return;
    const a = alive();
    if (S.mode === 'play' && !owned(S.player).length) {
      S.over = true;
      showEnd(false, `${byId[S.player].short} 在第 ${S.day} 天滅亡了…`);
    } else if (a.length === 1) {
      S.over = true;
      const w = a[0];
      showEnd(S.mode !== 'play' || w === S.player, `${byId[w].name}（${byId[w].nick}）在第 ${S.day} 天統一全台！`, w);
    }
  }

  // ───────── 隨機事件 ─────────
  function lose(id, ratio) {
    let lost = 0;
    for (const k of kinds(S.army[id])) { const n = Math.floor(S.army[id][k] * ratio); S.army[id][k] -= n; lost += n; }
    return lost;
  }
  function randomEvent() {
    const events = [
      () => { ['yilan', 'hualien', 'taitung', 'pingtung'].forEach(id => lose(id, 0.2)); return '🌀 颱風登陸東半部！宜花東屏兵力 -20%'; },
      () => { const id = pick(COUNTIES).id; const n = lose(id, 0.35); popText(id, '地震！', '#ef476f'); return `🌏 ${cTag(id)} 發生強震，損失 ${n} 兵`; },
      () => { alive().forEach(f => S.money[f] += 50); return '🗳️ 選舉到了！各勢力發放補助，全體 +50 萬'; },
      () => { const f = pick(alive()); S.money[f] += 120; return `🧋 ${fTag(f)} 的珍奶外銷大賣，進帳 120 萬`; },
      () => { ['taichung', 'changhua', 'yunlin', 'chiayicounty'].forEach(id => addUnits(S.army[id], 'gen', 1)); return '🏮 媽祖遶境！台中、彰化、雲林、嘉義各加入 1 名八家將'; },
      () => { const id = pick(COUNTIES).id; addUnits(S.army[id], 'inf', 3); return `🍱 ${cTag(id)} 辦桌請客，3 名阿兵哥吃飽加入`; },
    ];
    log(pick(events)(), 'event');
  }

  // ───────── AI ─────────
  async function aiTurn(f, gen) {
    // 研發
    if (S.money[f] > 260 && Math.random() < 0.35) {
      const k = pick(['atk', 'def', 'eco']);
      if (S.research[f][k] < 5 && S.money[f] >= researchCost(f, k)) { S.money[f] -= researchCost(f, k); S.research[f][k]++; }
    }
    // 組建新兵種
    if (S.day >= 4 && S.money[f] > 200 && customOf(f).length < 2 && Math.random() < 0.12) aiDesign(f);
    // 招兵：集中在最有機會進攻或最受威脅的前線
    const front = owned(f).filter(isFront);
    if (front.length) {
      const score = id => {
        const en = enemiesOf(id);
        const weakest = Math.min(...en.map(e => power(S.army[e])));
        const threat = Math.max(...en.map(e => power(S.army[e])));
        return power(S.army[id]) - weakest + Math.max(0, threat - power(S.army[id])) * 0.6 + rand(0, 25);
      };
      const ranked = front.sort((a, b) => score(b) - score(a));
      let guard = 0;
      while (S.money[f] >= 10 && guard++ < 60) {
        const id = Math.random() < 0.7 ? ranked[0] : pick(ranked);
        const k = aiChooseUnit(id);
        const cost = unitCost(k, id);
        if (S.money[f] < cost) { if (S.money[f] >= unitCost('inf', id)) { S.money[f] -= unitCost('inf', id); addUnits(S.army[id], 'inf', 1); } else break; continue; }
        S.money[f] -= cost;
        addUnits(S.army[id], k, 1);
      }
    }
    aiFortify(f);
    render();
    await wait(0.5, gen);
    // 進攻
    for (let tries = 0; tries < 10; tries++) {
      if (gen !== S.gen || S.over) return;
      let best = null;
      for (const src of owned(f)) {
        if (S.acted.has(src) || count(S.army[src]) < 3) continue;
        for (const tgt of enemiesOf(src)) {
          const vsPlayer = S.owner[tgt] === S.player;
          if (S.day <= (vsPlayer ? S.diff.playerPeace : S.diff.aiPeace)) continue;
          if (!vsPlayer && Math.random() > S.diff.aiVsAi) continue;
          const dp = power(S.army[tgt], defMult(S.owner[tgt], tgt));
          let ratio = dp ? power(S.army[src], atkMult(f, src)) / dp : 99;
          if (owned(S.owner[tgt]).length === 1) ratio *= 1.1; // 喜歡收割
          if (!best || ratio > best.ratio) best = { src, tgt, ratio };
        }
      }
      if (!best) break;
      // 越後期越敢打，避免僵局
      const need = S.aggr[f] * S.diff.aggr * Math.max(0.7, 1 - Math.max(0, S.day - 25) / 80);
      if (best.ratio < need && !(best.ratio > 0.95 && Math.random() < 0.12)) break;
      await doAttack(best.src, best.tgt, gen);
    }
  }

  function aiChooseUnit(id) {
    const f = S.owner[id];
    const avail = unitsOf(f);
    if (Math.random() < 0.5) {
      // 針對鄰居最多的兵系挑剋制兵系，同兵系裡挑 CP 值最高的
      const tally = { inf: 0, moto: 0, gen: 0, art: 0 };
      enemiesOf(id).forEach(e => kinds(S.army[e]).forEach(k => tally[U(k).cls] += S.army[e][k]));
      const top = UNIT_KEYS.reduce((a, b) => tally[a] >= tally[b] ? a : b);
      const cls = UNIT_KEYS.find(c => COUNTERS[c] === top);
      const options = avail.filter(k => U(k).cls === cls);
      if (options.length) return options.sort((a, b) => (U(b).atk + U(b).hp) / unitCost(b, id) - (U(a).atk + U(a).hp) / unitCost(a, id))[0];
    }
    const custom = customOf(f);
    if (custom.length && Math.random() < 0.5) return pick(custom);
    return pick(['inf', 'inf', 'moto', 'gen', 'art']);
  }

  const AI_UNIT_SUFFIX = ['鐵衛', '敢死隊', '特攻隊', '神兵', '自衛隊', '義勇軍', '親衛隊', '鄉勇'];
  function aiDesign(f) {
    const rich = S.money[f] > 350;
    const pickPart = list => rich ? pick(list.slice(Math.floor(list.length / 2))) : pick(list);
    const spec = designUnit(pickPart(PARTS.weapon).id, pickPart(PARTS.armor).id, pickPart(PARTS.mount).id);
    const name = byId[f].short + pick(AI_UNIT_SUFFIX);
    createUnit(f, name, pick(UNIT_ICONS), spec);
    log(`🛠️ ${fTag(f)} 組建新兵種「${name}」（${spec.parts.join('＋')}）`, 'event');
  }

  function createUnit(f, name, icon, spec) {
    const k = 'u' + (++S.unitSeq);
    S.units[k] = { name, icon, atk: spec.atk, hp: spec.hp, cost: spec.cost, cls: spec.cls, owner: f, desc: spec.parts.join('＋') };
    S.money[f] -= DESIGN_FEE;
    return k;
  }

  // 後方部隊往前線移動
  function aiFortify(f) {
    const ids = owned(f);
    const dist = {};
    const q = ids.filter(isFront);
    q.forEach(id => dist[id] = 0);
    for (let i = 0; i < q.length; i++) {
      for (const n of ADJ[q[i]]) if (S.owner[n] === f && dist[n] === undefined) { dist[n] = dist[q[i]] + 1; q.push(n); }
    }
    ids.filter(id => dist[id] > 0).sort((a, b) => dist[b] - dist[a]).forEach(id => {
      const to = [...ADJ[id]].find(n => S.owner[n] === f && dist[n] === dist[id] - 1);
      if (!to || !count(S.army[id])) return;
      mergeArmy(S.army[to], splitArmy(id, false));
    });
  }

  // ───────── 玩家操作 ─────────
  const playerActive = () => S.mode === 'play' && !S.over && S.current === S.player && !S.busy;

  async function onCountyClick(id) {
    if (S.over) return;
    if (!playerActive()) { S.sel = id; render(); return; }
    const mine = S.owner[id] === S.player;
    const sel = S.sel && S.owner[S.sel] === S.player ? S.sel : null;
    if (sel && sel !== id && ADJ[sel].has(id) && !S.acted.has(sel) && count(S.army[sel])) {
      if (mine) {
        // 調兵
        mergeArmy(S.army[id], splitArmy(sel, S.sendHalf));
        S.acted.add(sel);
        log(`🚚 從 ${cTag(sel)} 調兵到 ${cTag(id)}`, 'me');
        S.sel = id;
        render();
        return;
      }
      S.busy = true;
      const gen = S.gen;
      await doAttack(sel, id, gen, S.sendHalf);
      if (gen !== S.gen) return;
      S.busy = false;
      S.sel = S.owner[id] === S.player ? id : sel;
      render();
      return;
    }
    S.sel = id;
    render();
  }

  function recruit(k) {
    const id = S.sel;
    if (!playerActive() || !id || S.owner[id] !== S.player) return;
    const cost = unitCost(k, id);
    if (S.money[S.player] < cost) return flash('錢不夠！');
    S.money[S.player] -= cost;
    addUnits(S.army[id], k, 1);
    render();
  }
  function doResearch(k) {
    const f = S.player;
    if (!playerActive() || S.research[f][k] >= 5) return;
    const cost = researchCost(f, k);
    if (S.money[f] < cost) return flash('錢不夠！');
    S.money[f] -= cost;
    S.research[f][k]++;
    log(`🔬 完成研發「${RESEARCH[k].name}」Lv.${S.research[f][k]}`, 'me');
    render();
  }

  // ───────── 組建兵種 ─────────
  function openDesigner() {
    if (!playerActive()) return;
    if (customOf(S.player).length >= MAX_CUSTOM_UNITS) return flash(`最多只能有 ${MAX_CUSTOM_UNITS} 種自組兵種`);
    S.draft = { weapon: 'knife', armor: 'helmet', mount: 'scooter', icon: pick(UNIT_ICONS), name: '' };
    $('#dzFee').textContent = fmtMoney(DESIGN_FEE);
    $('#dzName').value = '';
    $('#designer').hidden = false;
    renderDesigner();
  }
  function renderDesigner() {
    const d = S.draft;
    $('#dzParts').innerHTML = Object.entries(PARTS).map(([slot, list]) => `<div class="dzRow"><span class="dzLabel">${PART_LABELS[slot]}</span>
      <div class="chips">${list.map(p => `<button data-slot="${slot}" data-id="${p.id}" class="${d[slot] === p.id ? 'on' : ''}">${p.icon} ${p.name}<br>
      <small>${[p.atk ? `攻+${p.atk}` : '', p.hp ? `血+${p.hp}` : '', `${p.cost}萬`, p.ranged ? '遠程' : '', p.heavy ? '重甲' : '', p.vehicle ? '載具' : ''].filter(Boolean).join(' ')}</small></button>`).join('')}</div></div>`).join('');
    $('#dzIcons').innerHTML = UNIT_ICONS.map(i => `<button data-icon="${i}" class="${d.icon === i ? 'on' : ''}">${i}</button>`).join('');
    const spec = designUnit(d.weapon, d.armor, d.mount);
    const name = d.name.trim() || defaultUnitName(spec);
    const base = UNITS[spec.cls];
    const beats = UNIT_CLASSES[COUNTERS[spec.cls]];
    const beatenBy = UNIT_CLASSES[UNIT_KEYS.find(c => COUNTERS[c] === spec.cls)];
    $('#dzPreview').innerHTML = `<span class="big">${d.icon}</span><div>
      <h3>${name} <small style="color:var(--accent)">${UNIT_CLASSES[spec.cls]}</small></h3>
      <div class="stats"><span>⚔️ 攻擊 <b>${spec.atk}</b></span><span>❤️ 血量 <b>${spec.hp}</b></span><span>💰 單價 <b>${spec.cost} 萬</b></span></div>
      <div class="cmp">剋 ${beats}、怕 ${beatenBy}｜同兵系基本兵：${base.icon}${base.name} 攻${base.atk}/血${base.hp}/${base.cost}萬</div></div>`;
    const mine = customOf(S.player);
    $('#dzMine').innerHTML = `已組建 ${mine.length}/${MAX_CUSTOM_UNITS}：` + (mine.map(k => `<span class="mu">${U(k).icon} ${U(k).name}</span>`).join('') || '（還沒有）');
    $('#dzOk').textContent = `組建（${DESIGN_FEE} 萬）`;
    $('#dzOk').disabled = S.money[S.player] < DESIGN_FEE;
  }
  const defaultUnitName = spec => spec.parts[0] + spec.parts[2] + '隊';
  function confirmDesign() {
    const d = S.draft, f = S.player;
    if (!playerActive() || S.money[f] < DESIGN_FEE) return flash('錢不夠！');
    const spec = designUnit(d.weapon, d.armor, d.mount);
    const name = d.name.trim() || defaultUnitName(spec);
    createUnit(f, name, d.icon, spec);
    log(`🛠️ 組建新兵種「${d.icon} ${name}」（${spec.parts.join('＋')}），攻${spec.atk}/血${spec.hp}`, 'me');
    $('#designer').hidden = true;
    render();
  }
  $('#designBtn').addEventListener('click', openDesigner);
  $('#dzCancel').addEventListener('click', () => { $('#designer').hidden = true; });
  $('#dzOk').addEventListener('click', confirmDesign);
  $('#dzParts').addEventListener('click', e => {
    const b = e.target.closest('button[data-slot]');
    if (b) { S.draft[b.dataset.slot] = b.dataset.id; renderDesigner(); }
  });
  $('#dzIcons').addEventListener('click', e => {
    const b = e.target.closest('button[data-icon]');
    if (b) { S.draft.icon = b.dataset.icon; renderDesigner(); }
  });
  $('#dzName').addEventListener('input', e => {
    S.draft.name = e.target.value;
    const spec = designUnit(S.draft.weapon, S.draft.armor, S.draft.mount);
    $('#dzPreview h3').firstChild.textContent = (S.draft.name.trim() || defaultUnitName(spec)) + ' ';
  });

  // ───────── 特效 ─────────
  function showArrow(a, b, color) {
    if (S.speed >= 99) return;
    const [x1, y1] = map.labelPos[a], [x2, y2] = map.labelPos[b];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    const ex = x2 - dx / len * 18, ey = y2 - dy / len * 18;
    const mx = (x1 + ex) / 2 - dy * 0.15, my = (y1 + ey) / 2 + dx * 0.15;
    svgEl('path', { d: `M${x1},${y1}Q${mx},${my} ${ex},${ey}`, class: 'arrow', stroke: color, 'marker-end': 'url(#arrowhead)' }, map.fx);
  }
  const clearArrows = () => map.fx.querySelectorAll('.arrow').forEach(e => e.remove());
  function popText(id, text, color) {
    if (S.speed >= 99) return;
    const [x, y] = map.labelPos[id];
    const t = svgEl('text', { x, y: y - 22, class: 'pop', fill: color }, map.fx);
    t.textContent = text;
    setTimeout(() => t.remove(), 1200);
  }
  function battleBurst(id, outcome) {
    if (S.speed >= 99) return;
    const [x, y] = map.labelPos[id];
    const points = Array.from({ length: 16 }, (_, i) => {
      const angle = -Math.PI / 2 + i * Math.PI / 8;
      const radius = i % 2 ? 9 : 22;
      return `${x + Math.cos(angle) * radius},${y + Math.sin(angle) * radius}`;
    }).join(' ');
    const burst = svgEl('polygon', { points, class: `battle-burst ${outcome}` }, map.fx);
    setTimeout(() => burst.remove(), 700);
  }
  function flash(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(flash.t);
    flash.t = setTimeout(() => el.classList.remove('show'), 1400);
  }
  function log(html, cls = '') {
    const box = $('#log');
    const div = document.createElement('div');
    div.className = 'entry ' + cls;
    div.innerHTML = html;
    box.prepend(div);
    while (box.children.length > 120) box.lastChild.remove();
  }

  // ───────── 繪製 ─────────
  function render() {
    if (!S.owner) return;
    const sel = S.sel;
    const canAct = playerActive() && sel && S.owner[sel] === S.player && !S.acted.has(sel) && count(S.army[sel]) > 0;
    for (const c of COUNTIES) {
      const id = c.id, f = S.owner[id];
      const g = map.groups[id], L = map.labels[id];
      g.style.color = byId[f].color;
      L.dot.style.fill = byId[f].color;
      L.num.textContent = count(S.army[id]);
      const target = canAct && ADJ[sel].has(id);
      g.classList.toggle('selected', id === sel);
      g.classList.toggle('target', target && f !== S.player);
      g.classList.toggle('move', target && f === S.player);
      L.g.classList.toggle('selected', id === sel);
      L.g.classList.toggle('mine', S.mode === 'play' && f === S.player);
      L.g.classList.toggle('acted', S.current === f && S.acted.has(id));
      L.g.classList.toggle('capital', f === id);
    }
    for (const b of map.borders) b.el.setAttribute('class', S.owner[b.a] === S.owner[b.b] ? 'b-county' : 'b-owner');
    renderPanel();
    renderInfo();
    renderTip();
  }

  function renderPanel() {
    const cur = S.current;
    $('#day').textContent = `第 ${S.day} 天`;
    $('#turn').innerHTML = S.mode === 'idle' ? '選擇縣市開始' : S.over ? '遊戲結束' : cur ? `行動中：${fTag(cur)}` : '…';
    $('#pauseBtn').disabled = S.mode !== 'watch' || S.over;
    $('#pauseBtn').textContent = S.paused ? '▶ 繼續' : '⏸ 暫停';

    const me = $('#mePanel');
    if (S.mode === 'play' && owned(S.player).length) {
      const f = S.player;
      me.hidden = false;
      $('#meName').innerHTML = `${fTag(f)}・${byId[f].nick}`;
      $('#meMoney').textContent = fmtMoney(S.money[f]);
      $('#meIncome').textContent = `+${income(f)}/天`;
      $('#meCounties').textContent = `${owned(f).length} 縣市`;
      $('#research').innerHTML = Object.entries(RESEARCH).map(([k, r]) => {
        const lv = S.research[f][k];
        return `<button class="res" data-k="${k}" ${!playerActive() || lv >= 5 ? 'disabled' : ''} title="${r.desc}">
          ${r.icon} ${r.name} <small>Lv.${lv}</small><br><small>${lv >= 5 ? 'MAX' : researchCost(f, k) + ' 萬'}</small></button>`;
      }).join('');
      $('#designBtn').disabled = !playerActive() || customOf(f).length >= MAX_CUSTOM_UNITS;
      $('#designCount').textContent = `${customOf(f).length}/${MAX_CUSTOM_UNITS}`;
      $('#endTurn').disabled = !playerActive();
      $('#endTurn').textContent = playerActive() ? '結束回合 ▶' : '等待其他縣市行動…';
    } else me.hidden = true;

    const facs = alive().map(f => ({ f, n: owned(f).length, p: owned(f).reduce((s, id) => s + count(S.army[id]), 0) }))
      .sort((a, b) => b.n - a.n || b.p - a.p);
    $('#board').innerHTML = facs.map((x, i) => `<div class="row ${x.f === S.player ? 'me' : ''} ${x.f === cur ? 'cur' : ''}">
      <span class="rk">${i + 1}</span><span class="sw" style="background:${byId[x.f].color}"></span>
      <span class="nm">${byId[x.f].short}${x.f === S.player ? ' ★' : ''}</span><span class="ct">${x.n} 縣市</span><span class="pw">${x.p} 兵</span></div>`).join('');
    $('#boardTitle').textContent = `勢力排行（剩 ${facs.length} / 22）`;
  }

  function renderInfo() {
    const box = $('#info');
    const id = S.sel || S.hover;
    if (!id || !S.owner) { box.innerHTML = '<p class="hint">點選地圖上的縣市查看資訊</p>'; return; }
    const c = byId[id], f = S.owner[id], a = S.army[id];
    const isMineSel = playerActive() && id === S.sel && f === S.player;
    const region = REGIONS.find(r => r.id === c.region);
    let html = `<div class="county-hero">${c.portrait ? `<img class="county-portrait" src="${c.portrait}" alt="${c.name}角色插畫">` : ''}<div class="ihead"><span class="sw big" style="background:${byId[f].color}"></span>
      <div><h3>${c.name} <small>${c.nick}</small></h3><div class="sub">${region.name}・稅收 ${c.econ} 萬・控制者 ${fTag(f)}</div></div></div></div>
      <div class="trait">✨ ${c.trait}</div>
      <div class="army">${armyHtml(a)}</div>`;
    if (isMineSel) {
      const acted = S.acted.has(id);
      html += `<div class="recruit">${unitsOf(f).map(k => `<button data-u="${k}" class="${U(k).owner ? 'custom' : ''}" ${S.money[f] < unitCost(k, id) ? 'disabled' : ''} title="${U(k).desc}">
        ${unitIcon(k)} ${U(k).name}<br><small>${unitCost(k, id)} 萬・攻${U(k).atk}/血${U(k).hp}・${UNIT_CLASSES[U(k).cls]}</small></button>`).join('')}</div>
        <label class="half"><input type="checkbox" id="halfChk" ${S.sendHalf ? 'checked' : ''}> 只派一半兵力（其餘留守）</label>
        <p class="hint">${acted ? '⛔ 這個縣市今天已經行動過了（還能招兵）' : count(a) ? '👉 點擊<b class="hl-r">閃爍紅框</b>的相鄰縣市進攻，或<b class="hl-g">綠框</b>己方縣市調兵' : '先招兵才能出擊'}</p>`;
    }
    box.innerHTML = html;
  }

  function oddsHtml(tgt) {
    const src = S.sel;
    if (S.mode !== 'play' || !src || S.owner[src] !== S.player || S.owner[tgt] === S.player || !ADJ[src].has(tgt)) return '';
    const mine = power(S.army[src], atkMult(S.player, src)) * (S.sendHalf ? 0.5 : 1);
    const theirs = power(S.army[tgt], defMult(S.owner[tgt], tgt));
    const r = theirs ? mine / theirs : 99;
    return `<div class="odds">勝算：<b class="${r > 1.3 ? 'good' : r > 0.9 ? 'mid' : 'bad'}">${r > 1.8 ? '穩贏' : r > 1.3 ? '有利' : r > 0.9 ? '五五波' : r > 0.6 ? '不利' : '送頭'}</b></div>`;
  }

  function renderTip() {
    const tip = $('#tip');
    const id = S.hover;
    if (!id || !S.owner || S.over) { tip.hidden = true; return; }
    const c = byId[id], f = S.owner[id], a = S.army[id];
    tip.innerHTML = `<b>${c.short}</b> <small>${c.nick}</small> ${f !== id ? `<small>（${fTag(f)} 佔領）</small>` : ''}
      <div>${kinds(a).map(k => `${U(k).icon}${a[k]}`).join(' ') || '空城'}</div>${oddsHtml(id)}`;
    tip.hidden = false;
  }
  $('#mapWrap').addEventListener('mousemove', e => {
    const tip = $('#tip');
    tip.style.left = e.clientX + 14 + 'px';
    tip.style.top = e.clientY + 14 + 'px';
  });

  // ───────── 視窗 ─────────
  function showStart() {
    $('#modal').hidden = false;
    $('#startView').hidden = false;
    $('#endView').hidden = true;
    $('#diffPick').innerHTML = Object.entries(DIFFICULTY).map(([k, d]) =>
      `<button data-d="${k}" class="${k === S.diffKey ? 'on' : ''}">${d.name}</button>`).join('');
    $('#diffDesc').textContent = DIFFICULTY[S.diffKey].desc;
    $('#pickGrid').innerHTML = REGIONS.map(r => `<div class="preg"><h4>${r.name}</h4>${r.ids.map(id => {
      const c = byId[id];
      return `<button class="pickBtn" data-id="${id}"><span class="sw" style="background:${c.color}"></span>${c.short}<small>${c.nick}</small></button>`;
    }).join('')}</div>`).join('');
  }
  function showEnd(win, text, winner) {
    $('#modal').hidden = false;
    $('#startView').hidden = true;
    $('#endView').hidden = false;
    $('#endTitle').textContent = S.mode === 'play' ? (win ? '🎉 統一全台！' : '💀 你被滅了') : `👑 ${byId[winner].short} 稱霸台灣`;
    $('#endText').textContent = text;
    $('#watchBtn').hidden = !(S.mode === 'play' && !win && alive().length > 1);
    if (winner) $('#endTitle').style.color = byId[winner].color; else $('#endTitle').style.color = '';
  }
  const hideModal = () => { $('#modal').hidden = true; };

  // ───────── 事件綁定 ─────────
  $('#pickGrid').addEventListener('click', e => { const b = e.target.closest('.pickBtn'); if (b) newGame('play', b.dataset.id); });
  $('#diffPick').addEventListener('click', e => {
    const b = e.target.closest('button[data-d]');
    if (!b) return;
    S.diffKey = b.dataset.d;
    document.querySelectorAll('#diffPick button').forEach(x => x.classList.toggle('on', x === b));
    $('#diffDesc').textContent = DIFFICULTY[S.diffKey].desc;
  });
  $('#watchAll').addEventListener('click', () => newGame('watch'));
  $('#newBtn').addEventListener('click', showStart);
  $('#againBtn').addEventListener('click', showStart);
  $('#watchBtn').addEventListener('click', () => {
    S.mode = 'watch'; S.over = false; hideModal();
    log('👀 你已滅亡，切換為觀戰模式', 'big');
    const gen = ++S.gen;
    (async () => { await nextTurn(gen); runLoop(gen); })();
  });
  $('#endTurn').addEventListener('click', endPlayerTurn);
  $('#pauseBtn').addEventListener('click', () => { S.paused = !S.paused; renderPanel(); });
  $('#speed').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    S.speed = +b.dataset.s;
    document.querySelectorAll('#speed button').forEach(x => x.classList.toggle('on', x === b));
  });
  $('#info').addEventListener('click', e => { const b = e.target.closest('button[data-u]'); if (b) recruit(b.dataset.u); });
  $('#info').addEventListener('change', e => { if (e.target.id === 'halfChk') { S.sendHalf = e.target.checked; renderInfo(); } });
  $('#research').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) doResearch(b.dataset.k); });
  document.addEventListener('keydown', e => {
    if (!$('#modal').hidden || !$('#designer').hidden || e.target.tagName === 'INPUT') return;
    if (e.key === 'Enter' || e.key === 'e') endPlayerTurn();
    if (e.key === 'Escape') { S.sel = null; render(); }
  });

  // 開場畫面背後先顯示初始地圖
  initState('idle');
  S.over = true;
  render();
  showStart();
})();
