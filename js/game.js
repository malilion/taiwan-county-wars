// 遊戲主程式：回合流程、戰鬥、AI、介面
(() => {
  const byId = Object.fromEntries(COUNTIES.map(c => [c.id, c]));
  const ADJ = Object.fromEntries(COUNTIES.map(c => [c.id, new Set()]));
  for (const [a, list] of Object.entries(ADJACENCY)) for (const b of list) { ADJ[a].add(b); ADJ[b].add(a); }

  const $ = s => document.querySelector(s);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  const emptyArmy = () => ({ inf: 0, moto: 0, gen: 0, art: 0 });
  const count = a => a.inf + a.moto + a.gen + a.art;
  const fmtMoney = n => `${Math.floor(n)} 萬`;

  const S = { gen: 0, speed: 1, paused: false, over: true, hover: null };
  const map = buildMap($('#map'), onCountyClick, id => { S.hover = id; if (!S.sel) renderInfo(); renderTip(); });

  // ───────── 狀態查詢 ─────────
  const owned = f => COUNTIES.filter(c => S.owner[c.id] === f).map(c => c.id);
  const alive = () => [...new Set(Object.values(S.owner))];
  const enemiesOf = id => [...ADJ[id]].filter(n => S.owner[n] !== S.owner[id]);
  const isFront = id => enemiesOf(id).length > 0;
  const fTag = f => `<b style="color:${byId[f].color}">${byId[f].short}</b>`;
  const cTag = id => `<span class="ctag">${byId[id].short}</span>`;
  const unitCost = (k, id) => Math.round(UNITS[k].cost * (byId[id].cheap === k ? 0.8 : 1));
  const researchCost = (f, k) => 120 * (S.research[f][k] + 1);

  function income(f) {
    const ids = owned(f);
    let n = ids.reduce((s, id) => s + byId[id].econ, 0) * (1 + 0.15 * S.research[f].eco);
    for (const r of REGIONS) if (r.ids.every(id => S.owner[id] === f)) n += r.bonus;
    return Math.round(n);
  }
  function power(army, mult = 1) {
    return UNIT_KEYS.reduce((s, k) => s + army[k] * (UNITS[k].atk + UNITS[k].hp), 0) * mult;
  }
  const atkMult = (f, id) => byId[id].atk * (1 + 0.12 * S.research[f].atk);
  const defMult = (f, id) => byId[id].def * (1 + 0.12 * S.research[f].def);

  // ───────── 新遊戲 ─────────
  function initState(mode, player) {
    Object.assign(S, {
      mode, player: player || null, over: false, day: 1, turnIdx: 0, current: null, sel: null, busy: false,
      sendHalf: false, acted: new Set(), owner: {}, army: {}, money: {}, research: {}, aggr: {}, paused: false,
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
    $('#log').innerHTML = '';
    log(mode === 'play'
      ? `📣 ${fTag(player)} 宣布出征！目標：統一全台 22 縣市。`
      : '📣 22 縣市大亂鬥開始！誰會是最後的贏家？', 'big');
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
        owned(f).forEach(id => { if (count(S.army[id]) < 2) S.army[id].inf++; });
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
    const lost = emptyArmy();
    for (const k of UNIT_KEYS) {
      const x = dmgByType[k] / UNITS[k].hp;
      let kills = Math.floor(x) + (Math.random() < x % 1 ? 1 : 0);
      kills = Math.min(kills, army[k]);
      army[k] -= kills;
      lost[k] = kills;
    }
    return lost;
  }
  function dealDamage(from, to, mult, motoBonus) {
    const total = count(to);
    const out = emptyArmy();
    if (!total) return out;
    for (const k of UNIT_KEYS) {
      if (!from[k]) continue;
      const dmg = from[k] * UNITS[k].atk * mult * (k === 'moto' ? motoBonus : 1) * rand(0.8, 1.2) * 0.35;
      for (const j of UNIT_KEYS) if (to[j]) out[j] += dmg * (to[j] / total) * (COUNTERS[k] === j ? 1.6 : 1);
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
    const sent = emptyArmy();
    for (const k of UNIT_KEYS) {
      sent[k] = half ? Math.ceil(S.army[src][k] / 2) : S.army[src][k];
      S.army[src][k] -= sent[k];
    }
    // 至少留一兵守家（優先留阿兵哥）
    if (!count(S.army[src]) && count(sent) > 1) {
      const k = UNIT_KEYS.find(k => sent[k]);
      sent[k]--; S.army[src][k]++;
    }
    S.acted.add(src);
    showArrow(src, tgt, byId[fa].color);
    render();
    await wait(0.9, gen);
    const r = resolveBattle(src, tgt, sent);
    clearArrows();
    if (r.win) {
      S.owner[tgt] = fa;
      S.army[tgt] = r.A;
      S.acted.add(tgt);
      popText(tgt, '攻陷！', '#ffd166');
      log(`⚔️ ${fTag(fa)} 從 ${cTag(src)} 出兵攻下 ${cTag(tgt)}（${fTag(fd)}），折損 ${r.lostA} 兵`, fa === S.player ? 'me' : '');
      if (!owned(fd).length) eliminated(fd, fa);
    } else {
      S.army[tgt] = r.D;
      for (const k of UNIT_KEYS) S.army[src][k] += r.A[k]; // 殘兵撤回
      popText(tgt, '守住！', '#8ecae6');
      log(`🛡️ ${cTag(tgt)} 擋下 ${fTag(fa)} 的進攻（攻方損 ${r.lostA}、守方損 ${r.lostD}）`, fd === S.player ? 'me' : '');
    }
    render();
    checkEnd();
    await wait(0.5, gen);
  }

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
    for (const k of UNIT_KEYS) { const n = Math.floor(S.army[id][k] * ratio); S.army[id][k] -= n; lost += n; }
    return lost;
  }
  function randomEvent() {
    const events = [
      () => { ['yilan', 'hualien', 'taitung', 'pingtung'].forEach(id => lose(id, 0.2)); return '🌀 颱風登陸東半部！宜花東屏兵力 -20%'; },
      () => { const id = pick(COUNTIES).id; const n = lose(id, 0.35); popText(id, '地震！', '#ef476f'); return `🌏 ${cTag(id)} 發生強震，損失 ${n} 兵`; },
      () => { alive().forEach(f => S.money[f] += 50); return '🗳️ 選舉到了！各勢力發放補助，全體 +50 萬'; },
      () => { const f = pick(alive()); S.money[f] += 120; return `🧋 ${fTag(f)} 的珍奶外銷大賣，進帳 120 萬`; },
      () => { ['taichung', 'changhua', 'yunlin', 'chiayicounty'].forEach(id => S.army[id].gen += 1); return '🏮 媽祖遶境！台中、彰化、雲林、嘉義各加入 1 名八家將'; },
      () => { const id = pick(COUNTIES).id; S.army[id].inf += 3; return `🍱 ${cTag(id)} 辦桌請客，3 名阿兵哥吃飽加入`; },
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
        if (S.money[f] < cost) { if (S.money[f] >= unitCost('inf', id)) { S.money[f] -= unitCost('inf', id); S.army[id].inf++; } else break; continue; }
        S.money[f] -= cost;
        S.army[id][k]++;
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
          const dp = power(S.army[tgt], defMult(S.owner[tgt], tgt));
          let ratio = dp ? power(S.army[src], atkMult(f, src)) / dp : 99;
          if (owned(S.owner[tgt]).length === 1) ratio *= 1.1; // 喜歡收割
          if (!best || ratio > best.ratio) best = { src, tgt, ratio };
        }
      }
      if (!best) break;
      // 越後期越敢打，避免僵局
      const need = S.aggr[f] * Math.max(0.7, 1 - Math.max(0, S.day - 25) / 80);
      if (best.ratio < need && !(best.ratio > 0.95 && Math.random() < 0.12)) break;
      await doAttack(best.src, best.tgt, gen);
    }
  }

  function aiChooseUnit(id) {
    if (Math.random() < 0.5) {
      // 針對鄰居最多的兵種挑剋制兵種
      const tally = emptyArmy();
      enemiesOf(id).forEach(e => UNIT_KEYS.forEach(k => tally[k] += S.army[e][k]));
      const top = UNIT_KEYS.reduce((a, b) => tally[a] >= tally[b] ? a : b);
      const counter = UNIT_KEYS.find(k => COUNTERS[k] === top);
      if (counter) return counter;
    }
    return pick(['inf', 'inf', 'moto', 'gen', 'art']);
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
      for (const k of UNIT_KEYS) { S.army[to][k] += S.army[id][k]; S.army[id][k] = 0; }
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
        for (const k of UNIT_KEYS) {
          const n = S.sendHalf ? Math.ceil(S.army[sel][k] / 2) : S.army[sel][k];
          S.army[sel][k] -= n; S.army[id][k] += n;
        }
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
    S.army[id][k]++;
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
    let html = `<div class="ihead"><span class="sw big" style="background:${byId[f].color}"></span>
      <div><h3>${c.name} <small>${c.nick}</small></h3><div class="sub">${region.name}・稅收 ${c.econ} 萬・控制者 ${fTag(f)}</div></div></div>
      <div class="trait">✨ ${c.trait}</div>
      <div class="army">${UNIT_KEYS.map(k => `<span title="${UNITS[k].name}">${UNITS[k].icon}<b>${a[k]}</b></span>`).join('')}</div>`;
    if (isMineSel) {
      const acted = S.acted.has(id);
      html += `<div class="recruit">${UNIT_KEYS.map(k => `<button data-u="${k}" ${S.money[f] < unitCost(k, id) ? 'disabled' : ''}>
        ${UNITS[k].icon} ${UNITS[k].name}<br><small>${unitCost(k, id)} 萬・攻${UNITS[k].atk}/血${UNITS[k].hp}</small></button>`).join('')}</div>
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
      <div>${UNIT_KEYS.map(k => `${UNITS[k].icon}${a[k]}`).join(' ')}</div>${oddsHtml(id)}`;
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
    if (e.key === 'Enter' && !$('#modal').hidden) return;
    if (e.key === 'Enter' || e.key === 'e') endPlayerTurn();
    if (e.key === 'Escape') { S.sel = null; render(); }
  });

  // 開場畫面背後先顯示初始地圖
  initState('idle');
  S.over = true;
  render();
  showStart();
})();
