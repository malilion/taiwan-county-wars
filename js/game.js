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
  // 每個縣市最多 MAX_TROOPS 名戰鬥人員
  const MAX_TROOPS = 25;
  const room = id => Math.max(0, MAX_TROOPS - count(S.army[id]));
  const addCapped = (id, k, n) => { const m = Math.min(n, room(id)); addUnits(S.army[id], k, m); return m; };
  const U = k => S.units[k];
  const iconMarkup = (icon, cls = 'unit-sprite') => typeof icon === 'string' && icon.startsWith('assets/')
    ? `<img class="${cls}" src="${icon}" alt="">` : icon;
  const fmtMoney = n => `${Math.floor(n)} 萬`;
  const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const S = { gen: 0, speed: 1, paused: false, over: true, hover: null, diffKey: 'easy' };
  const map = buildMap($('#map'), onCountyClick, id => { S.hover = id; if (!S.sel) renderInfo(); renderTip(); });

  // ───────── 狀態查詢 ─────────
  const owned = f => COUNTIES.filter(c => S.owner[c.id] === f).map(c => c.id);
  const alive = () => [...new Set(Object.values(S.owner))];
  const enemiesOf = id => [...ADJ[id]].filter(n => S.owner[n] !== S.owner[id]);
  const isFront = id => enemiesOf(id).length > 0;
  const fTag = f => `<b style="color:${byId[f].color}">${byId[f].short}</b>`;
  const cTag = id => `<span class="ctag">${byId[id].short}</span>`;
  const unitIcon = (k, cls = 'unit-sprite') => iconMarkup(U(k).sprite || U(k).icon, cls);
  const unitCost = (k, id) => Math.round(U(k).cost * (byId[id].cheap === U(k).cls ? 0.8 : 1));
  const eliteUnlocked = f => S.research[f].atk === 5 && S.research[f].def === 5;
  const unitsOf = f => [...UNIT_KEYS, ...(eliteUnlocked(f) ? ['elite'] : []), ...Object.keys(S.units).filter(k => S.units[k].owner === f)];
  const customOf = f => Object.keys(S.units).filter(k => S.units[k].owner === f);
  const armyHtml = a => kinds(a).length
    ? kinds(a).map(k => `<span title="${esc(U(k).name)}（${UNIT_CLASSES[U(k).cls]}）">${unitIcon(k)}<b>${a[k]}</b></span>`).join('')
    : '<span class="emptyArmy">空城</span>';
  const researchCost = (f, k) => 120 * (S.research[f][k] + 1);

  function income(f) {
    const ids = owned(f);
    let n = ids.reduce((s, id) => s + byId[id].econ + (BUILDINGS[S.buildings[id]?.type]?.income || 0), 0) * (1 + 0.15 * S.research[f].eco);
    for (const r of REGIONS) if (r.ids.every(id => S.owner[id] === f)) n += r.bonus;
    return Math.round(n);
  }
  function power(army, mult = 1) {
    return kinds(army).reduce((s, k) => s + army[k] * (U(k).atk + U(k).hp), 0) * mult;
  }
  // 地域技能的暫時加成：buff[id] = { atk, def, defUntil }；stun[id] = 無法出兵到第幾天
  const atkBuff = id => S.buff[id]?.atk || 1;
  const defBuff = id => S.buff[id]?.def && S.buff[id].defUntil >= S.day ? S.buff[id].def : 1;
  const stunned = id => (S.stun[id] || 0) >= S.day;
  const atkMult = (f, id) => byId[id].atk * (1 + 0.12 * S.research[f].atk) * atkBuff(id) * POSTURES[S.posture[id]].atk;
  const defMult = (f, id) => byId[id].def * (1 + 0.12 * S.research[f].def) * defBuff(id) * (BUILDINGS[S.buildings[id]?.type]?.defense || 1) * POSTURES[S.posture[id]].def;

  // ───────── 新遊戲 ─────────
  function initState(mode, player) {
    Object.assign(S, {
      mode, player: player || null, over: false, day: 1, turnIdx: 0, current: null, sel: null, busy: false, invasion: null, expeditionPort: null, lastExpedition: null,
      sendHalf: false, acted: new Set(), owner: {}, army: {}, money: {}, research: {}, aggr: {}, paused: false,
      units: Object.fromEntries(Object.entries({ ...UNITS, ...Invasion.UNITS }).map(([k, u]) => [k, { ...u, owner: null }])), unitSeq: 0,
      posture: Object.fromEntries(COUNTIES.map(c => [c.id, 'balanced'])), buildings: Object.fromEntries(COUNTIES.map(c => [c.id, null])), skillReady: {}, buff: {}, stun: {}, menuOpen: false, transferMode: false, attack: null, lastBattle: null,
    });
    COUNTIES.forEach(c => {
      S.owner[c.id] = c.id;
      S.army[c.id] = Object.assign(emptyArmy(), START_ARMY[c.id] || (c.island ? ISLAND_ARMY : DEFAULT_ARMY));
      S.money[c.id] = 100;
      S.research[c.id] = { atk: 0, def: 0, eco: 0 };
      S.aggr[c.id] = rand(1.15, 1.7);
    });
    S.order = shuffle(COUNTIES.map(c => c.id));
    // 玩家的技能欄：老家 = 自己的技能 + 1 個額外欄位；每佔領一個縣市 = 1 個可設定的欄位
    S.slots = {};
    S.library = new Set();
    if (player) {
      S.slots[player] = [player, null];
      S.library = new Set([player, ...Object.keys(COMMON_SKILLS)]);
    }
  }

  function newGame(mode, player) {
    S.gen++;
    closeActionDialogs();
    clearArrows();
    initState(mode, player);
    S.gameDiffKey = mode === 'play' ? S.diffKey : 'hard';
    S.diff = DIFFICULTY[S.gameDiffKey];
    $('#log').innerHTML = '';
    log(mode === 'play'
      ? `📣 ${fTag(player)} 宣布出征！目標：統一全台 22 縣市。（難度：${S.diff.name}）`
      : '📣 22 縣市大亂鬥開始！誰會是最後的贏家？', 'big');
    if (S.diff.aiPeace) log(`🕊️ 前 ${S.diff.aiPeace} 天為和平期：AI 縣市不會主動開戰，趁機招兵、併吞鄰居吧！`, 'event');
    hideModal();
    if (mode === 'play') focusCounty(player); else map.view.set(MAP_W / 2, MAP_H / 2, 1);
    render();
    runLoop(S.gen);
  }

  // ───────── 回合流程 ─────────
  async function wait(mult = 1, gen) {
    const ms = S.speed >= 99 ? 0 : 550 * mult / S.speed;
    await new Promise(r => setTimeout(r, ms));
    while ((S.paused || S.menuOpen) && gen === S.gen) await new Promise(r => setTimeout(r, 120));
  }

  async function runLoop(gen) {
    while (gen === S.gen && !S.over) {
      const f = S.order[S.turnIdx];
      if (owned(f).length) {
        S.current = f;
        if (f === S.player && S.invasion?.status === 'active') {
          invasionRaid();
          if (S.over) { render(); return; }
        }
        produceBuildings(f);
        const inc = income(f);
        S.money[f] += inc;
        // 替代役：兵力太少的縣市每天自動補 1 名阿兵哥
        owned(f).forEach(id => { if (count(S.army[id]) < 2) addCapped(id, 'inf', 1); });
        if (f === S.player && S.mode === 'play') {
          S.acted = new Set();
          log(`🌅 第 ${S.day} 天，輪到你了！稅收 +${fmtMoney(inc)}`, 'me');
          // 自動選取老家（或任一己方縣市），招兵按鈕一開始就看得到
          if (!S.sel || S.owner[S.sel] !== S.player) S.sel = S.owner[S.player] === S.player ? S.player : owned(S.player)[0];
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
    if (gen !== S.gen || S.over) return;
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
    if (!playerActive()) return;
    saveCheckpoint('auto');
    const gen = S.gen;
    S.sel = null;
    S.transferMode = false;
    S.current = null;
    render();
    nextTurn(gen).then(() => { if (gen === S.gen) runLoop(gen); });
  }

  // ───────── 戰鬥 ─────────
  function combatOptions(src, tgt, sent) {
    const fa = S.owner[src], fd = S.owner[tgt];
    return { sent, defenders: S.army[tgt], units: S.units, counters: COUNTERS,
      attackMult: atkMult(fa, src), defenseMult: defMult(fd, tgt),
      defenderAttack: 1 + 0.12 * S.research[fd].atk,
      attackerMoto: byId[src].moto || 1, defenderMoto: byId[tgt].moto || 1 };
  }

  async function doAttack(src, tgt, gen, half = false, deployment = null) {
    if (gen !== S.gen || S.over) return;
    const fa = S.owner[src], fd = S.owner[tgt];
    const sent = deployment ? { ...deployment } : Combat.plan(S.army[src], S.units, half);
    if (fa === fd || !ADJ[src].has(tgt) || S.acted.has(src) || stunned(src) || !Combat.validDeployment(S.army[src], sent, S.units)) return;
    for (const k of kinds(sent)) S.army[src][k] -= sent[k];
    S.acted.add(src);
    showArrow(src, tgt, byId[fa].color);
    render();
    await wait(0.9, gen);
    if (gen !== S.gen || S.over) return;
    const r = Combat.resolve(combatOptions(src, tgt, sent));
    if (fa === S.player || fd === S.player) S.lastBattle = { src, tgt, fa, fd, sent: count(sent), defenders: count(S.army[tgt]), ...r };
    if (S.buff[src]) delete S.buff[src].atk; // 進攻加成用掉了
    clearArrows();
    battleBurst(src, 'attack');
    battleBurst(tgt, r.win ? 'win' : 'block');
    if (r.win) {
      S.owner[tgt] = fa;
      S.posture[tgt] = 'balanced';
      // 佔領後重新整備，不能跨勢力重複領取即將到期的產兵。
      const facility = S.buildings[tgt];
      if (facility) facility.readyDay = S.day + (BUILDINGS[facility.type].period || 0);
      claimSlots(tgt);
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
  // 調兵：目標縣市塞不下的留在原地，回傳實際移動人數
  function moveTroops(from, to, half) {
    const moving = splitArmy(from, half);
    let moved = 0;
    for (const k of kinds(moving)) {
      const n = addCapped(to, k, moving[k]);
      moved += n;
      addUnits(S.army[from], k, moving[k] - n);
    }
    return moved;
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
    } else if (a.length === 1 && !S.invasion) {
      S.over = true;
      const w = a[0];
      showEnd(S.mode !== 'play' || w === S.player, `${byId[w].name}（${byId[w].nick}）在第 ${S.day} 天統一全台！`, w);
    }
  }

  // ───────── 統一後的外星入侵 ─────────
  function startInvasion() {
    if (S.mode !== 'play' || !S.over || owned(S.player).length !== COUNTIES.length || S.invasion) return;
    ++S.gen; // Invalidate the final county battle's pending animation/continuation.
    closeActionDialogs();
    clearArrows();
    S.invasion = Invasion.create(S.day, S.gameDiffKey || S.diffKey);
    S.over = S.busy = false;
    S.current = S.player;
    S.turnIdx = S.order.indexOf(S.player);
    S.acted = new Set();
    S.expeditionPort = S.sel = 'keelung';
    hideModal();
    log('👾 統一之後，外星蟲洞出現！三天後首次空襲。從基隆、高雄、花蓮出征，清除三座前哨，再摧毀母艦。', 'big');
    render();
  }
  function expeditionAllowed(src, site) {
    return playerActive() && S.invasion?.status === 'active' && Invasion.PORTS.includes(src)
      && S.owner[src] === S.player && !S.acted.has(src) && !stunned(src) && count(S.army[src]) > 1
      && Invasion.unlocked(S.invasion, site) && !S.invasion.cleared.includes(site)
      && (!Invasion.SITES[site].port || Invasion.SITES[site].port === src);
  }
  function expeditionOptions(src, site, sent) {
    return { sent, defenders: S.invasion.sites[site], units: S.units, counters: COUNTERS,
      attackMult: atkMult(S.player, src), defenseMult: site === 'core' ? 1.25 : 1,
      defenderAttack: site === 'core' ? 1.2 : 1, attackerMoto: byId[src].moto || 1 };
  }
  async function doExpedition(src, site, sent, gen) {
    if (gen !== S.gen || !expeditionAllowed(src, site) || !Combat.validDeployment(S.army[src], sent, S.units)) return;
    // Lock before yielding: double clicks cannot launch a second expedition.
    S.busy = true;
    S.acted.add(src);
    for (const k of kinds(sent)) S.army[src][k] -= sent[k];
    render();
    await wait(0.9, gen);
    if (gen !== S.gen || S.over) return;
    const r = Combat.resolve(expeditionOptions(src, site, sent));
    S.invasion.sites[site] = r.D;
    if (S.buff[src]) delete S.buff[src].atk;
    // Expeditions return to port instead of occupying an off-map base.
    for (const k of kinds(r.A)) addUnits(S.army[src], k, r.A[k]);
    if (r.win) {
      S.invasion.cleared.push(site);
      S.money[S.player] += 120;
      S.invasion.shield = Math.min(100, S.invasion.shield + 10);
    }
    log(`${r.win ? '🏆' : '🛸'} ${cTag(src)} 出征${Invasion.SITES[site].name}：${r.win ? '摧毀成功，補給 +120 萬、防線 +10' : '未能攻陷，守軍損耗保留'}。我軍折損 ${r.lostA} 人，敵軍折損 ${r.lostD} 人；${count(r.A)} 人返港。`, 'me');
    S.lastExpedition = { name: Invasion.SITES[site].name, win: r.win, lostA: r.lostA, lostD: r.lostD };
    S.busy = false;
    S.sel = src;
    if (site === 'core' && r.win) {
      S.invasion.status = 'won';
      S.over = true;
      showEnd(true, `第 ${S.day} 天，外星母艦已摧毀！全台防線剩餘 ${S.invasion.shield}%，台灣守衛戰成功。`, S.player);
    }
    render();
  }
  function invasionRaid() {
    if (!Invasion.due(S.invasion, S.day)) return;
    S.invasion.lastRaidDay = S.day;
    const port = pick(Invasion.PORTS);
    const r = Combat.resolve({ sent: Invasion.wave(S.invasion), defenders: S.army[port], units: S.units,
      counters: COUNTERS, attackMult: 1.1, defenseMult: defMult(S.player, port),
      defenderAttack: 1 + 0.12 * S.research[S.player].atk, defenderMoto: byId[port].moto || 1 });
    S.army[port] = r.D;
    const damage = r.win ? 18 : 4;
    S.invasion.shield = Math.max(0, S.invasion.shield - damage);
    log(`🚨 外星空襲${cTag(port)}！${r.win ? '守軍遭突破' : '守軍攔截成功'}，守軍折損 ${r.lostD} 人，全台防線 -${damage}%（剩 ${S.invasion.shield}%）。`, 'big');
    if (!S.invasion.shield) {
      S.invasion.status = 'lost';
      S.over = true;
      showEnd(false, `第 ${S.day} 天，外星空襲突破全台防線。可從先前存檔調整港口駐軍，再次挑戰。`);
    }
  }
  function renderInvasion() {
    $('#invasionPanel').hidden = !S.invasion;
    if (!S.invasion) return;
    const inv = S.invasion;
    const port = Invasion.PORTS.includes(S.expeditionPort) ? S.expeditionPort : Invasion.PORTS[0];
    $('#invasionPort').value = port;
    $('#invasionPortInfo').textContent = `${byId[port].name}駐軍 ${count(S.army[port])} / ${MAX_TROOPS} 人`;
    $('#focusPortBtn').disabled = S.busy;
    $('#invasionShield').textContent = `${inv.shield}%`;
    $('#invasionMeter').style.width = `${inv.shield}%`;
    const next = Math.max(0, 3 - (S.day - inv.lastRaidDay));
    $('#invasionStatus').textContent = inv.status === 'won' ? '母艦已摧毀，台灣守衛戰成功！' : inv.status === 'lost' ? '全台防線已被突破。' : `下次空襲：${next} 天後。三港守軍會影響防線損耗。`;
    $('#invasionSites').innerHTML = Object.entries(Invasion.SITES).map(([id, site]) => {
      const cleared = inv.cleared.includes(id), unlocked = Invasion.unlocked(inv, id);
      const reason = cleared ? '已摧毀' : !unlocked ? '先清除三座前哨' : site.port && site.port !== port ? `需從${byId[site.port].short}出征` : S.acted.has(port) ? '本港今日已出征' : stunned(port) ? '港口暫時無法出兵' : count(S.army[port]) < 2 ? '港口兵力不足' : '配置部隊';
      return `<div class="invasionSite ${cleared ? 'cleared' : ''}"><div><b>${site.icon} ${site.name}</b><small>${cleared ? '外星據點已清除' : `守軍 ${count(inv.sites[id])} 人`}</small></div><button data-site="${id}" ${expeditionAllowed(port, id) ? '' : 'disabled'}>${reason}</button></div>`;
    }).join('');
    $('#expeditionResult').textContent = S.lastExpedition ? `${S.lastExpedition.name}：${S.lastExpedition.win ? '摧毀' : '撤回'}，我軍折損 ${S.lastExpedition.lostA}／敵軍折損 ${S.lastExpedition.lostD}` : '先調兵到對應港口，再配置出征部隊；每港每天限一次。';
  }
  $('#focusPortBtn').addEventListener('click', () => {
    if (S.busy || !S.invasion) return;
    const port = $('#invasionPort').value;
    S.sel = port; focusCounty(port); render();
  });
  $('#invasionBtn').addEventListener('click', startInvasion);
  $('#invasionPort').addEventListener('change', e => { S.expeditionPort = e.target.value; renderInvasion(); });
  $('#invasionSites').addEventListener('click', e => {
    const b = e.target.closest('button[data-site]');
    const port = $('#invasionPort').value;
    if (b && expeditionAllowed(port, b.dataset.site)) openAttack(port, b.dataset.site, 'invasion');
  });

  // ───────── 隨機事件 ─────────
  function lose(id, ratio) {
    let lost = 0;
    for (const k of kinds(S.army[id])) { const n = Math.floor(S.army[id][k] * ratio); S.army[id][k] -= n; lost += n; }
    return lost;
  }
  // 依總兵力打掉一定比例（至少 1 人），隨機挑兵種
  function loseTotal(id, ratio) {
    const n = Math.min(count(S.army[id]), Math.max(1, Math.round(count(S.army[id]) * ratio)));
    for (let i = 0; i < n; i++) {
      const pool = kinds(S.army[id]).flatMap(k => Array(S.army[id][k]).fill(k));
      S.army[id][pick(pool)]--;
    }
    return n;
  }
  function randomEvent() {
    const events = [
      () => { ['yilan', 'hualien', 'taitung', 'pingtung'].forEach(id => lose(id, 0.2)); return '🌀 颱風登陸東半部！宜花東屏兵力 -20%'; },
      () => { const id = pick(COUNTIES).id; const n = lose(id, 0.35); popText(id, '地震！', '#ef476f'); return `🌏 ${cTag(id)} 發生強震，損失 ${n} 兵`; },
      () => { alive().forEach(f => S.money[f] += 50); return '🗳️ 選舉到了！各勢力發放補助，全體 +50 萬'; },
      () => { const f = pick(alive()); S.money[f] += 120; return `🧋 ${fTag(f)} 的珍奶外銷大賣，進帳 120 萬`; },
      () => { ['taichung', 'changhua', 'yunlin', 'chiayicounty'].forEach(id => addCapped(id, 'gen', 1)); return '🏮 媽祖遶境！台中、彰化、雲林、嘉義各加入 1 名八家將（滿 25 人的縣市擠不進去）'; },
      () => { const id = pick(COUNTIES).id; const n = addCapped(id, 'inf', 3); return n ? `🍱 ${cTag(id)} 辦桌請客，${n} 名阿兵哥吃飽加入` : `🍱 ${cTag(id)} 辦桌請客，但營區已滿 25 人，大家吃飽就回家了`; },
    ];
    log(pick(events)(), 'event');
  }

  // ───────── AI ─────────
  async function aiTurn(f, gen) {
    for (const id of owned(f)) {
      const threat = enemiesOf(id).reduce((n, e) => Math.max(n, power(S.army[e])), 0);
      S.posture[id] = threat > power(S.army[id]) * 1.3 ? 'guard' : isFront(id) ? 'assault' : 'balanced';
    }
    // 研發
    if (S.money[f] > 260 && Math.random() < 0.35) {
      const k = pick(['atk', 'def', 'eco']);
      if (S.research[f][k] < 5 && S.money[f] >= researchCost(f, k)) { S.money[f] -= researchCost(f, k); S.research[f][k]++; }
    }
    aiUseSkills(f);
    const site = owned(f).find(id => !S.buildings[id]);
    if (site && S.money[f] > 300 && Math.random() < 0.3) {
      const type = eliteUnlocked(f) && S.money[f] > 500 ? 'summon' : isFront(site) ? 'fort' : 'barracks';
      buildFacility(site, type);
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
        const open = ranked.filter(id => room(id) > 0);
        if (!open.length) break;
        const id = Math.random() < 0.7 ? open[0] : pick(open);
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
        if (S.acted.has(src) || stunned(src) || count(S.army[src]) < 3) continue;
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
    log(`🛠️ ${fTag(f)} 組建新兵種「${esc(name)}」（${spec.parts.join('＋')}）`, 'event');
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
      moveTroops(id, to, false);
    });
  }

  // ───────── 縣市經營（每縣一格，拆除無退款） ─────────
  function buildFacility(id, type) {
    const b = BUILDINGS[type], f = S.owner[id];
    if (!b || S.buildings[id] || S.money[f] < b.cost || (b.elite && !eliteUnlocked(f))) return false;
    S.money[f] -= b.cost;
    S.buildings[id] = { type, readyDay: S.day + (b.period || 0) };
    log(`${b.icon} ${fTag(f)} 在 ${cTag(id)} 建成「${b.name}」`, f === S.player ? 'me' : '');
    return true;
  }
  function produceBuildings(f) {
    for (const id of owned(f)) {
      const facility = S.buildings[id], b = BUILDINGS[facility?.type];
      if (!b?.period || facility.readyDay > S.day) continue;
      if (addCapped(id, b.unit, 1)) {
        facility.readyDay = S.day + b.period;
        log(`${b.icon} ${cTag(id)} 的${b.name}產出 1 名${UNITS[b.unit].name}`, f === S.player ? 'me' : '');
      }
    }
  }
  function facilityHtml(id, canEdit) {
    const facility = S.buildings[id], b = BUILDINGS[facility?.type];
    if (b) return `<div class="facility"><div><b>${b.icon} ${b.name}</b><small>${b.desc}</small>
      ${b.period ? `<span class="facilityTimer">${facility.readyDay <= S.day ? '等待營區空位' : `距下次產兵 ${facility.readyDay - S.day} 天`}</span>` : ''}</div>
      ${canEdit ? '<button id="demolishBtn">拆除</button>' : ''}</div>`;
    if (!canEdit) return '<p class="hint">🏗️ 縣市設施：尚未建設</p>';
    return `<details class="facilityPicker"><summary>🏗️ 建設縣市設施（1 格）</summary><div>${Object.entries(BUILDINGS).map(([type, spec]) => {
      const locked = spec.elite && !eliteUnlocked(S.player);
      return `<button data-build="${type}" ${locked || S.money[S.player] < spec.cost ? 'disabled' : ''}><b>${spec.icon} ${spec.name}・${spec.cost} 萬</b><small>${spec.desc}${locked ? '（尚未解鎖）' : ''}</small></button>`;
    }).join('')}</div><small>拆除無退款；被佔領時設施保留、產兵重新計時。</small></details>`;
  }

  // ───────── 地域技能 ─────────
  // 技能欄：第 0 欄固定是縣市固有技能（不能換）；玩家的老家和每個佔領的縣市多 1 個自訂欄（S.slots[id][1]）
  // AI 的縣市只有固有技能
  // 技能 key = 技能原本所屬的縣市 id（REGION_SKILLS 的 key）；冷卻以「縣市:欄位」計算，換技能也不會重置冷卻
  const slotsOf = id => S.owner[id] === S.player && S.slots[id] ? S.slots[id] : [id];
  const cdKey = (id, i) => `${id}:${i}`;
  const skillWait = (id, i) => Math.max(0, (S.skillReady[cdKey(id, i)] || 0) - S.day); // 還要等幾天
  const HOSTILE = ['strike', 'storm', 'stun'];
  // 佔領縣市時：玩家拿到的縣市開一個技能欄（預設是當地技能）並解鎖到技能庫；被別人拿走就恢復原狀
  function claimSlots(id) {
    if (S.owner[id] !== S.player) { delete S.slots[id]; return; }
    if (!S.library.has(id)) log(`📜 解鎖地域技能「${REGION_SKILLS[id].icon} ${REGION_SKILLS[id].name}」，可以裝到任何己方縣市的技能欄`, 'me');
    S.library.add(id);
    S.slots[id] = [id, null];
  }
  // 和平期內不能對受保護的對象使用攻擊型技能
  function hostileTargets(id) {
    const f = S.owner[id];
    return enemiesOf(id).filter(e => {
      const vsPlayer = S.owner[e] === S.player;
      if (f !== S.player && S.day <= (vsPlayer ? S.diff.playerPeace : S.diff.aiPeace)) return false;
      return true;
    });
  }
  // 回傳不能發動的原因；可以發動回傳 null
  function skillBlock(id, i) {
    const key = slotsOf(id)[i];
    if (!key) return '未設定';
    const sk = ALL_SKILLS[key];
    if (skillWait(id, i)) return `冷卻 ${skillWait(id, i)} 天`;
    if (sk.type === 'recruit' && !room(id)) return '兵力已滿';
    if (HOSTILE.includes(sk.type) && !hostileTargets(id).length) return '無敵方鄰居';
    if (sk.type === 'again' && !S.acted.has(id)) return '尚未出兵';
    return null;
  }
  function useSkill(id, i) {
    if (skillBlock(id, i)) return false;
    const sk = ALL_SKILLS[slotsOf(id)[i]], f = S.owner[id];
    const by = `${fTag(f)} 在 ${cTag(id)} 發動地域技能「${sk.icon} ${sk.name}」`;
    let detail = '';
    if (sk.type === 'money') { S.money[f] += sk.value; detail = `進帳 ${sk.value} 萬`; }
    else if (sk.type === 'recruit') { const n = addCapped(id, sk.unit, sk.value); detail = `${n} 名${UNITS[sk.unit].name}加入`; }
    else if (sk.type === 'atk') { S.buff[id] = { ...S.buff[id], atk: sk.value }; detail = `下一次進攻攻擊 ×${sk.value}`; }
    else if (sk.type === 'def') { S.buff[id] = { ...S.buff[id], def: sk.value, defUntil: S.day + 1 }; detail = `防禦 ×${sk.value} 到第 ${S.day + 1} 天`; }
    else if (sk.type === 'strike') {
      const t = hostileTargets(id).sort((a, b) => power(S.army[b]) - power(S.army[a]))[0];
      detail = `${cTag(t)} 損失 ${loseTotal(t, sk.value)} 兵`;
      popText(t, sk.icon, '#ef476f');
    } else if (sk.type === 'storm') {
      detail = hostileTargets(id).map(t => { popText(t, sk.icon, '#ef476f'); return `${cTag(t)} -${loseTotal(t, sk.value)}`; }).join('、');
    } else if (sk.type === 'stun') {
      const ts = hostileTargets(id);
      ts.forEach(t => { S.stun[t] = S.day + 1; popText(t, '😵', '#ffd166'); });
      detail = `${ts.map(cTag).join('、')} 到第 ${S.day + 1} 天都無法出兵`;
    } else if (sk.type === 'again') { S.acted.delete(id); detail = '今天可以再出兵一次'; }
    S.skillReady[cdKey(id, i)] = S.day + sk.cd;
    popText(id, sk.icon + sk.name, '#c77dff');
    log(`🌟 ${by}：${detail}`, f === S.player ? 'me skill' : 'skill');
    return true;
  }

  // 技能設定視窗
  function openSkillPicker(id, i) {
    S.picker = { id, i };
    const cur = S.slots[id][i];
    const used = S.slots[id].filter((k, j) => k && j !== i);
    $('#spTitle').innerHTML = `📜 設定 ${cTag(id)} 的自訂技能欄`;
    $('#spList').innerHTML = [...S.library].map(k => {
      const sk = ALL_SKILLS[k];
      const dup = used.includes(k);
      return `<button class="spItem ${k === cur ? 'on' : ''}" data-key="${k}" ${dup ? 'disabled' : ''}>
        <span class="ricon">${sk.icon}</span><span><b>${sk.name}</b><small>${sk.desc}・冷卻 ${sk.cd} 天・${byId[k] ? `來自${byId[k].short}` : '通用技能'}${dup ? '（這個縣市已裝備）' : ''}</small></span></button>`;
    }).join('');
    $('#spHint').textContent = `技能庫 ${S.library.size} 個（含 ${Object.keys(COMMON_SKILLS).length} 個通用技能）：佔領新的縣市就能解鎖它的地域技能。換技能不會重置這一欄的冷卻。`;
    $('#skillPicker').hidden = false;
  }
  $('#spList').addEventListener('click', e => {
    const b = e.target.closest('button[data-key]');
    if (!b || !S.picker) return;
    const { id, i } = S.picker;
    S.slots[id][i] = b.dataset.key;
    $('#skillPicker').hidden = true;
    log(`📜 ${cTag(id)} 的技能欄裝上「${ALL_SKILLS[b.dataset.key].icon} ${ALL_SKILLS[b.dataset.key].name}」`, 'me');
    render();
  });
  $('#spCancel').addEventListener('click', () => { $('#skillPicker').hidden = true; });

  function aiUseSkills(f) {
    for (const id of owned(f)) {
      const sk = REGION_SKILLS[id];
      if (sk.type === 'again' || skillBlock(id, 0)) continue;
      const front = isFront(id);
      const threat = front ? Math.max(...enemiesOf(id).map(e => power(S.army[e]))) : 0;
      const use = sk.type === 'money' || sk.type === 'recruit'
        || (sk.type === 'atk' && front)
        || (sk.type === 'def' && threat > power(S.army[id]) * 0.8)
        || HOSTILE.includes(sk.type);
      if (use) useSkill(id, 0);
    }
  }

  function borderThreat(id, defenders = S.army[id]) {
    const f = S.owner[id];
    const threats = enemiesOf(id).filter(e => !stunned(e) && count(S.army[e]) > 1).map(e => {
      const sent = Combat.plan(S.army[e], S.units);
      return { id: e, troops: count(sent), ratio: power(sent, atkMult(S.owner[e], e)) / Math.max(1, power(defenders, defMult(f, id))) };
    }).sort((a, b) => b.ratio - a.ratio);
    const peace = f === S.player && S.day <= S.diff.playerPeace;
    return { threats, peace, level: !threats.length ? 'none' : threats[0].ratio > 1.4 ? 'high' : threats[0].ratio > 0.85 ? 'mid' : 'low' };
  }
  function defenseHtml(id, canEdit) {
    const f = S.owner[id], posture = POSTURES[S.posture[id]], risk = borderThreat(id);
    const label = { none: '無相鄰敵軍', low: '威脅較低', mid: '需要留意', high: '防線薄弱' }[risk.level];
    const detail = risk.peace ? `和平期剩 ${S.diff.playerPeace - S.day + 1} 天，之後 AI 可能進攻。`
      : risk.threats.length ? `最需留意${byId[risk.threats[0].id].short}，目前可派約 ${risk.threats[0].troops} 人。` : S.invasion ? '港口仍可能遭到外星空襲。' : '目前沒有可出兵的相鄰敵軍。';
    return `<div class="defenseBox"><div class="defenseHead"><b>🛡️ 駐防與警戒</b><span class="risk-${risk.level}">${risk.peace ? '🕊️ 和平期' : label}</span></div>
      <p>駐軍 ${count(S.army[id])} 人・防禦加成 ×${defMult(f, id).toFixed(2)}</p><p class="hint">${detail}</p>
      <div class="postures">${Object.entries(POSTURES).map(([key, spec]) => `<button data-posture="${key}" class="${S.posture[id] === key ? 'on' : ''}" ${!canEdit || S.acted.has(id) ? 'disabled' : ''}>${spec.icon} ${spec.name}</button>`).join('')}</div>
      <small>${posture.desc}。${S.acted.has(id) && f === S.player ? '今日已出征，姿態鎖定至下回合。' : '出征後無法更換姿態，需保留兵力迎戰。'}</small>
      <small>威脅依目前兵力與加成估算，未涵蓋兵種相剋及隨機戰損。</small></div>`;
  }
  function setPosture(id, key) {
    if (!playerActive() || S.owner[id] !== S.player || S.acted.has(id) || !Object.hasOwn(POSTURES, key)) return false;
    S.posture[id] = key;
    render();
    return true;
  }

  // ───────── 玩家操作 ─────────
  const playerActive = () => S.mode === 'play' && !S.over && S.current === S.player && !S.busy && !S.menuOpen;

  async function onCountyClick(id) {
    if (S.over) return;
    if (!playerActive()) { S.sel = id; render(); return; }
    const mine = S.owner[id] === S.player;
    const sel = S.sel && S.owner[S.sel] === S.player ? S.sel : null;
    // 調兵模式：點一個連通的己方縣市 → 開調兵視窗
    if (S.transferMode) {
      S.transferMode = false;
      if (sel && mine && id !== sel && reachable(sel).has(id)) return openTransfer(sel, id);
    }
    if (sel && sel !== id && !mine && ADJ[sel].has(id) && !S.acted.has(sel) && count(S.army[sel]) > 1) {
      if (stunned(sel)) return flash(`${byId[sel].short} 被困住了，到第 ${S.stun[sel]} 天都無法出兵`);
      openAttack(sel, id);
      return;
    }
    S.sel = id;
    render();
  }

  function closeActionDialogs() {
    for (const id of ['designer', 'transfer', 'skillPicker', 'attackDialog']) $('#' + id).hidden = true;
    S.attack = S.tr = S.picker = S.draft = null;
  }

  function openAttack(src, tgt, kind = 'county') {
    S.attack = { src, tgt, kind, sent: Combat.plan(S.army[src], S.units, S.sendHalf) };
    $('#attackDialog').hidden = false;
    $('#tip').hidden = true;
    renderAttack();
    $('#attackCancel').focus();
  }
  function renderAttack() {
    const { src, tgt, sent } = S.attack;
    const total = count(sent), reserve = count(S.army[src]) - total;
    const expedition = S.attack.kind === 'invasion';
    const targetName = expedition ? Invasion.SITES[tgt].name : byId[tgt].short;
    const options = expedition ? expeditionOptions(src, tgt, sent) : combatOptions(src, tgt, sent);
    $('#attackTitle').textContent = `${byId[src].short} → ${targetName}`;
    $('#attackHint').textContent = expedition ? '每港每日出征一次；作戰後存活部隊返港，前哨守軍戰損保留。' : '每個縣市每日出兵一次；失敗後殘兵撤回，攻陷後駐守新領土。';
    $('#attackForces').innerHTML = `<div><small>出征部隊</small><b>${total}<em> 人</em></b><span>本土留守 ${reserve} 人</span></div>
      <span class="versus">VS</span><div><small>${expedition ? '外星' : byId[S.owner[tgt]].short}守軍</small><b>${count(options.defenders)}<em> 人</em></b><span>防禦加成 ×${options.defenseMult.toFixed(2)}</span></div>`;
    $('#attackRows').innerHTML = kinds(S.army[src]).map(k => `<div class="deployRow"><span>${unitIcon(k)} ${esc(U(k).name)}<small>${UNIT_CLASSES[U(k).cls]}・現有 ${S.army[src][k]}</small></span>
      <div class="deployControl"><button data-unit="${k}" data-delta="-1" aria-label="減少${esc(U(k).name)}" ${!sent[k] ? 'disabled' : ''}>−</button>
      <input class="unitAmount" type="number" min="0" max="${Math.min(S.army[src][k], (sent[k] || 0) + reserve - 1)}" value="${sent[k] || 0}" data-amount="${k}" aria-label="${esc(U(k).name)}出征人數"><button data-unit="${k}" data-delta="1" aria-label="增加${esc(U(k).name)}" ${sent[k] >= S.army[src][k] || reserve <= 1 ? 'disabled' : ''}>＋</button></div></div>`).join('');
    const valid = Combat.validDeployment(S.army[src], sent, S.units);
    const estimate = valid ? Combat.estimate(options) : null;
    $('#attackEstimate').innerHTML = estimate ? `<div class="estimateTop"><span>預估攻陷機率</span><b class="${estimate.chance >= 65 ? 'hl-g' : 'hl-r'}">${estimate.chance}%</b></div>
      <div class="estimateBar"><i style="width:${estimate.chance}%"></i></div>
      <p>平均折損：我軍 ${estimate.lostA} 人／守軍 ${estimate.lostD} 人</p>
      <small>依目前兵種相剋、研發、地域與技能加成模擬 160 次；實戰仍有隨機性。</small>` : '<p>請選擇至少 1 名出征部隊，並留 1 人守家。</p>';
    $('#deploymentSize').max = Math.max(0, count(S.army[src]) - 1);
    $('#deploymentSize').value = total;
    const reserveArmy = Object.fromEntries(kinds(S.army[src]).map(k => [k, S.army[src][k] - (sent[k] || 0)]));
    const risk = borderThreat(src, reserveArmy);
    $('#reserveWarning').textContent = `${reserve} 人留守${byId[src].short}。` + (risk.peace ? '目前仍在和平期。' : risk.level === 'high' ? '⚠️ 鄰國兵力明顯超過留守部隊，可能遭到反攻。' : risk.threats.length ? '鄰國可能反攻，請搭配駐防與要塞。' : S.invasion ? '請保留守軍應對外星空襲。' : '目前無相鄰敵軍。');
    $('#reserveWarning').className = 'reserveWarning' + (!risk.peace && risk.level === 'high' ? ' danger' : '');
    $('#attackConfirm').disabled = !valid;
    $('#attackConfirm').textContent = `⚔️ 確認出征 ${total} 人`;
  }
  $('#attackRows').addEventListener('click', e => {
    const b = e.target.closest('button[data-unit]');
    if (!b || !S.attack) return;
    const { src, sent } = S.attack, k = b.dataset.unit, delta = Number(b.dataset.delta);
    if (delta > 0 && count(sent) >= count(S.army[src]) - 1) return;
    sent[k] = Math.max(0, Math.min(S.army[src][k], (sent[k] || 0) + delta));
    renderAttack();
  });
  $('#attackRows').addEventListener('change', e => {
    const k = e.target.dataset.amount;
    if (!S.attack || !k || !Object.hasOwn(S.army[S.attack.src], k)) return;
    const { src, sent } = S.attack;
    const other = count(sent) - (sent[k] || 0);
    const value = Number(e.target.value);
    sent[k] = Math.max(0, Math.min(S.army[src][k], count(S.army[src]) - 1 - other, Number.isFinite(value) ? Math.floor(value) : 0));
    renderAttack();
  });
  $('#deploymentSize').addEventListener('change', e => {
    if (!S.attack) return;
    S.attack.sent = Combat.planSize(S.army[S.attack.src], S.units, e.target.value);
    renderAttack();
  });
  $('#attackPresets').addEventListener('click', e => {
    const b = e.target.closest('button[data-plan]');
    if (!b || !S.attack) return;
    S.attack.sent = /^\d+$/.test(b.dataset.plan) ? Combat.planSize(S.army[S.attack.src], S.units, Number(b.dataset.plan)) : b.dataset.plan === 'none' ? {} : Combat.plan(S.army[S.attack.src], S.units, b.dataset.plan === 'half');
    renderAttack();
  });
  $('#attackCancel').addEventListener('click', () => { $('#attackDialog').hidden = true; S.attack = null; });
  $('#attackConfirm').addEventListener('click', async () => {
    if (!playerActive() || !S.attack) return;
    const { src, tgt, sent, kind } = S.attack;
    if (kind === 'invasion') {
      if (!expeditionAllowed(src, tgt) || !Combat.validDeployment(S.army[src], sent, S.units)) return;
      $('#attackDialog').hidden = true;
      S.attack = null;
      await doExpedition(src, tgt, sent, S.gen);
      return;
    }
    if (S.owner[src] !== S.player || S.owner[tgt] === S.player || S.acted.has(src) || stunned(src) || !Combat.validDeployment(S.army[src], sent, S.units)) return;
    $('#attackDialog').hidden = true;
    S.attack = null;
    S.busy = true;
    const gen = S.gen;
    await doAttack(src, tgt, gen, false, sent);
    if (gen !== S.gen) return;
    S.busy = false;
    S.sel = S.owner[tgt] === S.player ? tgt : src;
    render();
  });
  function renderBattleReport() {
    const box = $('#battleReport'), r = S.lastBattle;
    box.hidden = !r;
    if (!r) return;
    box.innerHTML = `<h4>最近一場戰役</h4><div class="reportTitle">${byId[r.src].short} → ${byId[r.tgt].short}<b class="${r.win ? 'hl-g' : 'hl-r'}">${r.win ? '攻陷' : '守住'}</b></div>
      <div class="reportStats"><span>攻方 ${r.sent} → ${count(r.A)} 人<small>折損 ${r.lostA} 人</small></span><span>守方 ${r.defenders} → ${count(r.D)} 人<small>折損 ${r.lostD} 人</small></span></div>
      <p class="hint">${r.win ? `剩餘攻方部隊進駐${byId[r.tgt].short}。` : '攻方殘兵已撤回出兵縣市。'}出兵縣市今日行動已使用。</p>`;
  }

  // 透過己方領土（含海路）連通的縣市
  function reachable(from) {
    const seen = new Set([from]);
    const q = [from];
    while (q.length) for (const n of ADJ[q.shift()]) if (!seen.has(n) && S.owner[n] === S.owner[from]) { seen.add(n); q.push(n); }
    seen.delete(from);
    return seen;
  }

  function openTransfer(from, to) {
    S.tr = { from, to, amt: {} };
    $('#transfer').hidden = false;
    renderTransfer();
  }
  function renderTransfer() {
    const { from, to, amt } = S.tr;
    const total = Object.values(amt).reduce((a, b) => a + b, 0);
    const space = room(to);
    const src = S.army[from];
    $('#trTitle').innerHTML = `🚚 從 ${cTag(from)} 調兵到 ${cTag(to)}`;
    $('#trRows').innerHTML = kinds(src).map(k => `<div class="trRow">
      <span class="trName">${unitIcon(k)} ${esc(U(k).name)}<small>現有 ${src[k]}</small></span>
      <span class="trCtl">
        <button data-k="${k}" data-d="-1" ${!amt[k] ? 'disabled' : ''}>−</button>
        <b>${amt[k] || 0}</b>
        <button data-k="${k}" data-d="1" ${(amt[k] || 0) >= src[k] || total >= space ? 'disabled' : ''}>＋</button>
        <button data-k="${k}" data-d="max" ${(amt[k] || 0) >= src[k] || total >= space ? 'disabled' : ''}>全部</button>
      </span>
    </div>`).join('') || '<p class="hint">這個縣市沒有部隊可以調</p>';
    $('#trInfo').innerHTML = `${cTag(from)} ${count(src)} → ${count(src) - total} 人｜${cTag(to)} ${count(S.army[to])} → ${count(S.army[to]) + total} / ${MAX_TROOPS} 人${space === 0 ? '<b class="hl-r">（目標已滿）</b>' : ''}`;
    $('#trOk').disabled = total === 0;
    $('#trOk').textContent = `確認調動 ${total} 人`;
  }
  function changeTransfer(k, d) {
    const { to, amt } = S.tr;
    const have = S.army[S.tr.from][k];
    const total = Object.values(amt).reduce((a, b) => a + b, 0);
    const cur = amt[k] || 0;
    const free = room(to) - total;
    amt[k] = d === 'max' ? Math.min(have, cur + free) : Math.max(0, Math.min(have, cur + Number(d), cur + free));
    renderTransfer();
  }
  function confirmTransfer() {
    const { from, to, amt } = S.tr;
    let moved = 0;
    for (const k of Object.keys(amt)) {
      const n = Math.min(amt[k], S.army[from][k] || 0, room(to));
      S.army[from][k] -= n;
      addUnits(S.army[to], k, n);
      moved += n;
    }
    $('#transfer').hidden = true;
    if (moved) log(`🚚 從 ${cTag(from)} 調 ${moved} 兵到 ${cTag(to)}`, 'me');
    S.sel = to;
    render();
  }
  $('#trRows').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) changeTransfer(b.dataset.k, b.dataset.d); });
  $('#trOk').addEventListener('click', confirmTransfer);
  $('#trCancel').addEventListener('click', () => { $('#transfer').hidden = true; });
  $('#trSwap').addEventListener('click', () => openTransfer(S.tr.to, S.tr.from));

  function recruit(k) {
    const id = S.sel;
    if (!playerActive() || !id || S.owner[id] !== S.player) return;
    const cost = unitCost(k, id);
    if (!room(id)) return flash(`每個縣市最多 ${MAX_TROOPS} 名戰鬥人員`);
    if (S.money[S.player] < cost) return flash('錢不夠！');
    S.money[S.player] -= cost;
    addUnits(S.army[id], k, 1);
    flash(`${esc(U(k).name)} +1　💰 -${cost} 萬（剩 ${fmtMoney(S.money[S.player])}）`, 'good');
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
      <div class="chips">${list.map(p => `<button data-slot="${slot}" data-id="${p.id}" class="${d[slot] === p.id ? 'on' : ''}">${iconMarkup(p.sprite || p.icon, 'part-sprite')} ${p.name}<br>
      <small>${[p.atk ? `攻+${p.atk}` : '', p.hp ? `血+${p.hp}` : '', `${p.cost}萬`, p.ranged ? '遠程' : '', p.heavy ? '重甲' : '', p.vehicle ? '載具' : ''].filter(Boolean).join(' ')}</small></button>`).join('')}</div></div>`).join('');
    $('#dzIcons').innerHTML = UNIT_ICONS.map(i => `<button data-icon="${i}" class="${d.icon === i ? 'on' : ''}">${iconMarkup(i, 'unit-avatar')}</button>`).join('');
    const spec = designUnit(d.weapon, d.armor, d.mount);
    const name = d.name.trim() || defaultUnitName(spec);
    const base = UNITS[spec.cls];
    const beats = UNIT_CLASSES[COUNTERS[spec.cls]];
    const beatenBy = UNIT_CLASSES[UNIT_KEYS.find(c => COUNTERS[c] === spec.cls)];
    $('#dzPreview').innerHTML = `<span class="big">${iconMarkup(d.icon, 'avatar-large')}</span><div>
      <h3>${esc(name)} <small style="color:var(--accent)">${UNIT_CLASSES[spec.cls]}</small></h3>
      <div class="stats"><span>⚔️ 攻擊 <b>${spec.atk}</b></span><span>❤️ 血量 <b>${spec.hp}</b></span><span>💰 單價 <b>${spec.cost} 萬</b></span></div>
      <div class="cmp">剋 ${beats}、怕 ${beatenBy}｜同兵系基本兵：${unitIcon(spec.cls)}${base.name} 攻${base.atk}/血${base.hp}/${base.cost}萬</div></div>`;
    const mine = customOf(S.player);
    $('#dzMine').innerHTML = `已組建 ${mine.length}/${MAX_CUSTOM_UNITS}：` + (mine.map(k => `<span class="mu">${unitIcon(k, 'unit-avatar-mini')} ${esc(U(k).name)}</span>`).join('') || '（還沒有）');
    $('#dzOk').textContent = `組建（${DESIGN_FEE} 萬）`;
    $('#dzOk').disabled = S.money[S.player] < DESIGN_FEE;
  }
  const defaultUnitName = spec => spec.parts[0] + spec.parts[2] + '隊';
  function confirmDesign() {
    const d = S.draft, f = S.player;
    if (!playerActive() || S.money[f] < DESIGN_FEE) return flash('錢不夠！');
    const spec = designUnit(d.weapon, d.armor, d.mount);
    const name = d.name.trim().slice(0, 8) || defaultUnitName(spec);
    createUnit(f, name, d.icon, spec);
    log(`🛠️ 組建新兵種「${iconMarkup(d.icon, 'log-avatar')} ${esc(name)}」（${spec.parts.join('＋')}），攻${spec.atk}/血${spec.hp}`, 'me');
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
  function flash(msg, kind = '') {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('good', kind === 'good');
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
    const canAct = playerActive() && sel && S.owner[sel] === S.player && !S.acted.has(sel) && !stunned(sel) && count(S.army[sel]) > 1;
    const reach = S.transferMode && playerActive() && sel ? reachable(sel) : new Set();
    for (const c of COUNTIES) {
      const id = c.id, f = S.owner[id];
      const g = map.groups[id], L = map.labels[id];
      g.style.color = byId[f].color;
      L.dot.style.fill = byId[f].color;
      L.num.textContent = count(S.army[id]);
      const target = canAct && ADJ[sel].has(id);
      g.classList.toggle('selected', id === sel);
      g.classList.toggle('target', !S.transferMode && target && f !== S.player);
      g.classList.toggle('move', reach.has(id));
      L.g.classList.toggle('selected', id === sel);
      L.g.classList.toggle('mine', S.mode === 'play' && f === S.player);
      L.g.classList.toggle('acted', S.current === f && S.acted.has(id));
      L.g.classList.toggle('capital', f === id);
    }
    for (const b of map.borders) b.el.setAttribute('class', S.owner[b.a] === S.owner[b.b] ? 'b-county' : 'b-owner');
    renderCards();
    renderPanel();
    renderInfo();
    renderTip();
    renderBattleReport();
    renderInvasion();
    $('#campaignGoalName').textContent = S.invasion ? '👾 台灣守衛戰' : '🏁 統一全台';
    $('#campaignGoalProgress').textContent = S.invasion ? `${S.invasion.cleared.length} / 4 據點` : `${S.player ? owned(S.player).length : 0} / 22 縣市`;
    $('#saveBtn').disabled = !playerActive();
    if (playerActive()) saveCheckpoint('auto');
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
      <div class="army">${armyHtml(a)}</div>
      ${troopGrid(a)}
      <div class="cap ${count(a) >= MAX_TROOPS ? 'full' : ''}">兵力 ${count(a)} / ${MAX_TROOPS}${count(a) >= MAX_TROOPS ? '（已滿）' : ''}</div>`;
    const status = [
      atkBuff(id) > 1 ? `⚔️ 下次進攻 ×${atkBuff(id)}` : '',
      defBuff(id) > 1 ? `🛡️ 防禦 ×${defBuff(id)}（到第 ${S.buff[id].defUntil} 天）` : '',
      stunned(id) ? `😵 無法出兵（到第 ${S.stun[id]} 天）` : '',
    ].filter(Boolean);
    const canEdit = isMineSel && S.slots[id];
    html += slotsOf(id).map((key, i) => {
      const label = i === 0 ? '固有技能' : '自訂技能欄';
      if (!key) return `<div class="rskill empty"><span class="ricon">➕</span><div class="rtext"><b>${label}（空）</b><small>${canEdit ? '從技能庫挑一個技能裝上' : '尚未設定'}</small></div>
        ${canEdit ? `<button data-pick="${i}">設定</button>` : ''}</div>`;
      const sk = ALL_SKILLS[key], block = skillBlock(id, i);
      return `<div class="rskill"><span class="ricon">${sk.icon}</span><div class="rtext"><b>${label}：${sk.name}${key !== id ? `<em>（${byId[key] ? `來自${byId[key].short}` : '通用'}）</em>` : ''}</b><small>${sk.desc}（冷卻 ${sk.cd} 天）</small></div>
        <div class="rbtns">${isMineSel ? `<button data-skill="${i}" ${block ? 'disabled' : ''}>${block || '發動'}</button>` : skillWait(id, i) ? `<span class="cdTag">冷卻 ${skillWait(id, i)} 天</span>` : ''}
        ${canEdit && i > 0 ? `<button class="swap" data-pick="${i}">更換</button>` : ''}</div></div>`;
    }).join('') + (status.length ? `<div class="rstatus">${status.join('　')}</div>` : '');
    html += defenseHtml(id, isMineSel);
    html += facilityHtml(id, isMineSel);
    if (isMineSel) {
      const acted = S.acted.has(id);
      html += `<div class="recruitHead"><b>🪖 招兵到${c.short}</b><span>💰 目前 <b>${fmtMoney(S.money[f])}</b></span></div>
        <div class="recruit">${unitsOf(f).map(k => `<button data-u="${k}" class="${U(k).owner ? 'custom' : ''}" ${S.money[f] < unitCost(k, id) || !room(id) ? 'disabled' : ''} title="${U(k).desc}">
        ${unitIcon(k)} ${esc(U(k).name)}<br><small>${unitCost(k, id)} 萬・攻${U(k).atk}/血${U(k).hp}・${UNIT_CLASSES[U(k).cls]}</small></button>`).join('')}</div>
        <button id="trBtn" class="trBtn ${S.transferMode ? 'on' : ''}" ${reachable(id).size ? '' : 'disabled'}>🚚 ${S.transferMode ? '點地圖上綠框的己方縣市（再按一次取消）' : reachable(id).size ? '調兵到其他己方縣市' : '調兵（還沒有其他相連的己方縣市）'}</button>
        <label class="half"><input type="checkbox" id="halfChk" ${S.sendHalf ? 'checked' : ''}> 進攻時只派一半兵力（其餘留守）</label>
        <p class="hint">${stunned(id) ? `😵 被困住了，到第 ${S.stun[id]} 天都無法出兵` : acted ? '⛔ 這個縣市今天已經出兵過了（還能招兵、調兵）' : count(a) > 1 ? '👉 點擊<b class="hl-r">閃爍紅框</b>的敵方縣市，配置出征部隊' : count(a) === 1 ? '至少留 1 人守家，招兵後才能出征' : '先招兵才能出擊'}</p>`;
    }
    box.innerHTML = html;
  }

  // 地圖上的縣市卡片（放大時顯示）
  function renderCards() {
    for (const c of COUNTIES) {
      const id = c.id, f = S.owner[id], a = S.army[id], card = map.cards[id];
      card.tag.style.fill = byId[f].color;
      card.name.textContent = `${c.short} ${count(a)}`;
      card.g.classList.toggle('mine', S.mode === 'play' && f === S.player);
      card.g.classList.toggle('selected', id === S.sel);
      const units = kinds(a).sort((x, y) => UNIT_KEYS.indexOf(U(x).cls) - UNIT_KEYS.indexOf(U(y).cls)).flatMap(k => Array(a[k]).fill(k));
      card.cells.forEach((cell, i) => {
        const k = units[i];
        cell.rect.setAttribute('class', 'ccell' + (k ? ' cls-' + U(k).cls : ''));
        // 基本兵種用 sprite；自組兵種的 icon 本身就是圖片路徑
        const sprite = k && (U(k).sprite || (U(k).icon.startsWith('assets/') ? U(k).icon : null));
        if (sprite) cell.img.setAttribute('href', sprite);
        cell.img.style.display = sprite ? '' : 'none';
        cell.txt.textContent = k && !sprite ? U(k).icon : '';
      });
      const slots = slotsOf(id);
      card.skills.forEach((sk, i) => {
        const key = slots[i];
        sk.g.style.display = i < slots.length ? '' : 'none';
        sk.t.textContent = key ? ALL_SKILLS[key].icon : '＋';
        sk.g.classList.toggle('cooling', !key || skillWait(id, i) > 0);
      });
    }
  }

  // 5×5 兵力格：每格一名戰鬥人員
  function troopGrid(a) {
    const cells = kinds(a).sort((x, y) => UNIT_KEYS.indexOf(U(x).cls) - UNIT_KEYS.indexOf(U(y).cls)).flatMap(k => Array(a[k]).fill(k));
    return `<div class="tgrid">${Array.from({ length: MAX_TROOPS }, (_, i) =>
      `<span class="tcell ${cells[i] ? 'cls-' + U(cells[i]).cls : ''}">${cells[i] ? unitIcon(cells[i], 'tcellImg') : ''}</span>`).join('')}</div>`;
  }

  function oddsHtml(tgt) {
    const src = S.sel;
    if (S.mode !== 'play' || !src || S.owner[src] !== S.player || S.owner[tgt] === S.player || !ADJ[src].has(tgt)) return '';
    const mine = power(S.army[src], atkMult(S.player, src)) * (S.sendHalf ? 0.5 : 1);
    const theirs = power(S.army[tgt], defMult(S.owner[tgt], tgt));
    const r = theirs ? mine / theirs : 99;
    return `<div class="odds">勝算：<b class="${r > 1.3 ? 'good' : r > 0.9 ? 'mid' : 'bad'}">${r > 1.8 ? '優勢大' : r > 1.3 ? '有利' : r > 0.9 ? '五五波' : r > 0.6 ? '不利' : '送頭'}</b></div>`;
  }

  function renderTip() {
    const tip = $('#tip');
    const id = S.hover;
    if (!id || !S.owner || S.over) { tip.hidden = true; return; }
    const c = byId[id], f = S.owner[id], a = S.army[id];
    tip.innerHTML = `<b>${c.short}</b> <small>${c.nick}</small> ${f !== id ? `<small>（${fTag(f)} 佔領）</small>` : ''}
      <div>${kinds(a).map(k => `${unitIcon(k, 'unit-sprite-small')}${a[k]}`).join(' ') || '空城'}</div>${oddsHtml(id)}`;
    tip.hidden = false;
  }
  $('#mapWrap').addEventListener('mousemove', e => {
    const tip = $('#tip');
    tip.style.left = e.clientX + 14 + 'px';
    tip.style.top = e.clientY + 14 + 'px';
  });

  // ───────── 視窗 ─────────
  function showStart() {
    S.menuOpen = true;
    closeActionDialogs();
    refreshSaveButtons();
    $('#returnGame').hidden = !S.owner || S.mode === 'idle' || S.over;
    $('#modal').hidden = false;
    $('#startView').hidden = false;
    $('#endView').hidden = true;
    $('#diffPick').innerHTML = Object.entries(DIFFICULTY).map(([k, d]) =>
      `<button data-d="${k}" class="${k === S.diffKey ? 'on' : ''}">${d.name}</button>`).join('');
    $('#diffDesc').textContent = DIFFICULTY[S.diffKey].desc;
    $('#pickGrid').innerHTML = REGIONS.map(r => `<div class="preg"><h4>${r.name}</h4>${r.ids.map(id => {
      const c = byId[id];
      return `<button class="pickBtn" data-id="${id}">${c.portrait ? `<img class="pick-portrait" src="${c.portrait}" alt="" loading="lazy">` : ''}<span class="sw" style="background:${c.color}"></span>${c.short}<small>${c.nick}</small></button>`;
    }).join('')}</div>`).join('');
  }
  function showEnd(win, text, winner) {
    $('#modal').hidden = false;
    $('#startView').hidden = true;
    $('#endView').hidden = false;
    $('#endTitle').textContent = S.mode === 'play' ? (win ? '🎉 統一全台！' : '💀 你被滅了') : `👑 ${byId[winner].short} 稱霸台灣`;
    if (S.invasion) $('#endTitle').textContent = win ? '🌏 台灣守衛戰成功！' : '👾 防線遭突破';
    $('#invasionBtn').hidden = !(win && S.mode === 'play' && owned(S.player).length === COUNTIES.length && !S.invasion);
    $('#endText').textContent = text;
    $('#watchBtn').hidden = !(S.mode === 'play' && !win && alive().length > 1);
    if (winner) $('#endTitle').style.color = byId[winner].color; else $('#endTitle').style.color = '';
  }
  const hideModal = () => { $('#modal').hidden = true; S.menuOpen = false; };

  // Only save at a stable player turn, never a partially resolved battle/AI turn.
  const saveRules = { counties: COUNTIES.map(c => c.id), skills: ALL_SKILLS, difficulties: DIFFICULTY,
    enemyUnits: Invasion.UNITS, validateInvasion: Invasion.validate, baseUnits: Object.keys(UNITS), classes: UNIT_KEYS, buildings: BUILDINGS, maxCustom: MAX_CUSTOM_UNITS,
    icons: [...UNIT_ICONS, ...Object.values({ ...UNITS, ...Invasion.UNITS }).map(u => u.icon)], sprites: Object.values(UNITS).map(u => u.sprite) };
  let lastAuto = '', storageWarned = false;
  function saveCheckpoint(slot, notify = false) {
    if (!playerActive()) return false;
    try {
      const logs = [...$('#log').children].slice(0, 80).map(e => e.textContent.slice(0, 2000));
      const text = GameSaves.encode(S, logs), signature = JSON.stringify(JSON.parse(text).data) + JSON.stringify(logs);
      if (slot === 'auto' && signature === lastAuto) return true;
      localStorage.setItem('taiwan-war:v1:' + slot, text);
      if (slot === 'auto') lastAuto = signature;
      $('#saveStatus').textContent = `${slot === 'auto' ? '已自動儲存' : '已手動存檔'}・第 ${S.day} 天`;
      if (notify) flash('存檔完成，下次可從開始畫面繼續', 'good');
      return true;
    } catch {
      $('#saveStatus').textContent = '無法儲存，請確認瀏覽器允許本機儲存';
      if (notify || !storageWarned) flash('無法存檔，請確認瀏覽器允許本機儲存');
      storageWarned = true;
      return false;
    }
  }
  function refreshSaveButtons() {
    for (const slot of ['auto', 'manual']) {
      const b = $('#' + slot + 'Load');
      try {
        const save = GameSaves.read(localStorage, slot, saveRules);
        const s = save.data;
        b.disabled = false;
        b.textContent = `${slot === 'auto' ? '▶ 繼續自動存檔' : '📂 讀取手動存檔'}・${byId[s.player].short} 第 ${s.day} 天`;
        b.title = new Date(save.savedAt).toLocaleString('zh-TW');
      } catch {
        b.disabled = true;
        b.textContent = slot === 'auto' ? '尚無可用自動存檔' : '尚無可用手動存檔';
      }
    }
  }
  function loadCheckpoint(slot) {
    try {
      const save = GameSaves.read(localStorage, slot, saveRules);
      ++S.gen;
      closeActionDialogs();
      Object.assign(S, save.data, { diff: DIFFICULTY[save.data.diffKey], gameDiffKey: save.data.diffKey, over: false, busy: false, paused: false, transferMode: false, hover: null, lastBattle: null, lastExpedition: null, expeditionPort: null });
      lastAuto = '';
      $('#log').replaceChildren();
      for (const text of save.logs) { const div = document.createElement('div'); div.className = 'entry'; div.textContent = text; $('#log').appendChild(div); }
      hideModal();
      focusCounty(S.sel || owned(S.player)[0]);
      render();
      flash('已回到存檔時的玩家回合；稅收不會重複領取', 'good');
    } catch {
      flash('存檔無法讀取，目前遊戲保持原狀');
      refreshSaveButtons();
    }
  }
  $('#saveBtn').addEventListener('click', () => saveCheckpoint('manual', true));
  $('#autoLoad').addEventListener('click', () => loadCheckpoint('auto'));
  $('#manualLoad').addEventListener('click', () => loadCheckpoint('manual'));
  $('#returnGame').addEventListener('click', () => { hideModal(); render(); });
  window.addEventListener('pagehide', () => saveCheckpoint('auto'));

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
  $('#info').addEventListener('click', e => {
    const stance = e.target.closest('button[data-posture]');
    if (stance) setPosture(S.sel, stance.dataset.posture);
    const build = e.target.closest('button[data-build]');
    if (build && playerActive() && S.owner[S.sel] === S.player) { buildFacility(S.sel, build.dataset.build); render(); }
    if (e.target.closest('#demolishBtn') && playerActive() && S.owner[S.sel] === S.player) {
      if (confirm('確定拆除目前設施？不會退還建造費。')) { S.buildings[S.sel] = null; render(); }
    }
    const b = e.target.closest('button[data-u]');
    if (b) recruit(b.dataset.u);
    if (e.target.closest('#trBtn')) { S.transferMode = !S.transferMode; render(); }
    const sb = e.target.closest('button[data-skill]');
    if (sb && playerActive() && S.owner[S.sel] === S.player) { useSkill(S.sel, +sb.dataset.skill); render(); }
    const pb = e.target.closest('button[data-pick]');
    if (pb && playerActive() && S.slots[S.sel] && +pb.dataset.pick > 0) openSkillPicker(S.sel, +pb.dataset.pick);
  });
  $('#info').addEventListener('change', e => { if (e.target.id === 'halfChk') { S.sendHalf = e.target.checked; renderInfo(); } });
  $('#research').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) doResearch(b.dataset.k); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !$('#attackDialog').hidden) {
      const controls = [...$('#attackDialog').querySelectorAll('button:not(:disabled)')];
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    if (e.key === 'Escape' && !$('#attackDialog').hidden) { $('#attackCancel').click(); return; }
    if (!$('#attackDialog').hidden || !$('#modal').hidden || !$('#designer').hidden || !$('#transfer').hidden || !$('#skillPicker').hidden || e.target.tagName === 'INPUT') return;
    if (e.key === 'Enter' || e.key === 'e') endPlayerTurn();
    if (e.key === 'Escape') { S.sel = null; S.transferMode = false; render(); }
  });

  // 小地圖與縮放
  buildMinimap($('#minimap'), map.view);
  map.view.onChange(v => { $('#zoom').value = v.z; });
  $('#zoom').addEventListener('input', e => map.view.zoomTo(+e.target.value));
  function focusCounty(id, z = 2.6) { const [x, y] = map.labelPos[id]; map.view.set(x, y + 10, z); }

  // 開場畫面背後先顯示初始地圖
  initState('idle');
  S.over = true;
  render();
  showStart();
})();

