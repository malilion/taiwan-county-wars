// 地圖繪製：用 Voronoi 把台灣本島切成近似縣市形狀，離島用圓形示意
const MAP_W = 640, MAP_H = 830;
const NS = 'http://www.w3.org/2000/svg';
const proj = ([lon, lat]) => [190 + (lon - 120) * 210.5, 20 + (25.35 - lat) * 230];

const TAIWAN_OUTLINE = [
  [121.51, 25.30], [121.60, 25.29], [121.69, 25.20], [121.79, 25.15], [121.93, 25.13], [122.00, 25.01],
  [121.92, 24.93], [121.85, 24.83], [121.83, 24.70], [121.87, 24.58], [121.80, 24.40], [121.70, 24.20],
  [121.62, 24.02], [121.58, 23.85], [121.52, 23.60], [121.45, 23.35], [121.38, 23.12], [121.28, 22.95],
  [121.17, 22.77], [121.02, 22.60], [120.92, 22.40], [120.89, 22.20], [120.86, 22.00], [120.84, 21.90],
  [120.74, 21.93], [120.72, 22.05], [120.66, 22.25], [120.58, 22.37], [120.47, 22.46], [120.35, 22.55],
  [120.27, 22.62], [120.20, 22.80], [120.15, 22.95], [120.08, 23.08], [120.06, 23.20], [120.11, 23.38],
  [120.15, 23.55], [120.18, 23.75], [120.27, 23.95], [120.38, 24.10], [120.50, 24.28], [120.62, 24.45],
  [120.75, 24.62], [120.88, 24.75], [120.95, 24.86], [121.02, 24.97], [121.10, 25.05], [121.22, 25.10],
  [121.38, 25.17], [121.44, 25.25],
];

function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

// 回傳 { groups, labels, borders, labelPos, fx }，供 game.js 更新顏色與數字
function buildMap(svg, onClick, onHover) {
  svg.setAttribute('viewBox', `0 0 ${MAP_W} ${MAP_H}`);
  const defs = svgEl('defs', {}, svg);
  const outline = TAIWAN_OUTLINE.map(proj);
  const outlineD = 'M' + outline.map(p => p.join(',')).join('L') + 'Z';
  const clip = svgEl('clipPath', { id: 'tw-clip' }, defs);
  svgEl('path', { d: outlineD }, clip);
  const marker = svgEl('marker', { id: 'arrowhead', viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 4, markerHeight: 4, orient: 'auto-start-reverse' }, defs);
  svgEl('path', { d: 'M0,0L10,5L0,10z', fill: 'context-stroke' }, marker);
  const glow = svgEl('filter', { id: 'glow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
  svgEl('feGaussianBlur', { stdDeviation: 6, result: 'b' }, glow);
  const merge = svgEl('feMerge', {}, glow);
  svgEl('feMergeNode', { in: 'b' }, merge);
  svgEl('feMergeNode', { in: 'SourceGraphic' }, merge);

  const labelPos = {};
  COUNTIES.forEach(c => { labelPos[c.id] = c.island ? c.island.pos : proj(c.label); });

  // 海上航線（畫在陸地下方，只露出海面部分）
  const routes = svgEl('g', { class: 'sea-routes' }, svg);
  SEA_ROUTES.forEach(([a, b]) => {
    const [x1, y1] = labelPos[a], [x2, y2] = labelPos[b];
    svgEl('line', { x1, y1, x2, y2 }, routes);
  });

  // 離島示意框
  const insets = svgEl('g', { class: 'insets' }, svg);
  [['lienchiang', '馬祖列島'], ['kinmen', '金門']].forEach(([id, t]) => {
    const [x, y] = labelPos[id];
    svgEl('rect', { x: x - 48, y: y - 48, width: 96, height: 100, rx: 10 }, insets);
    svgEl('text', { x: x - 42, y: y - 34 }, insets).textContent = t + '（示意）';
  });

  svgEl('path', { d: outlineD, class: 'coast-glow', filter: 'url(#glow)' }, svg);

  // 本島 Voronoi
  const pts = [], owner = [];
  COUNTIES.forEach(c => (c.seeds || []).forEach(s => { pts.push(proj(s)); owner.push(c.id); }));
  const delaunay = d3.Delaunay.from(pts);
  const vor = delaunay.voronoi([0, 0, MAP_W, MAP_H]);

  svgEl('path', { d: outlineD, class: 'land-under', id: 'mapUnder' }, svg);
  const land = svgEl('g', { 'clip-path': 'url(#tw-clip)', class: 'land', id: 'mapLand' }, svg);
  const groups = {};
  COUNTIES.forEach(c => {
    const g = svgEl('g', { class: 'county', 'data-id': c.id }, c.island ? null : land);
    groups[c.id] = g;
  });
  pts.forEach((_, i) => svgEl('path', { d: vor.renderCell(i) }, groups[owner[i]]));

  // 縣市邊界：Delaunay 相鄰但屬不同縣市的種子之間的 Voronoi 邊
  const borderLayer = svgEl('g', { 'clip-path': 'url(#tw-clip)', class: 'borders' }, svg);
  const borders = [];
  const { halfedges, triangles } = delaunay;
  const cc = vor.circumcenters;
  for (let e = 0; e < halfedges.length; e++) {
    const j = halfedges[e];
    if (j < e) continue;
    const a = owner[triangles[e]], b = owner[triangles[e % 3 === 2 ? e - 2 : e + 1]];
    if (a === b) continue;
    const t1 = Math.floor(e / 3), t2 = Math.floor(j / 3);
    const line = svgEl('line', { x1: cc[2 * t1], y1: cc[2 * t1 + 1], x2: cc[2 * t2], y2: cc[2 * t2 + 1] }, borderLayer);
    borders.push({ a, b, el: line });
  }
  svgEl('path', { d: outlineD, class: 'coast', id: 'mapCoast' }, svg);

  // 離島
  const islandLayer = svgEl('g', { class: 'islands', id: 'mapIslands' }, svg);
  COUNTIES.filter(c => c.island).forEach(c => {
    const g = groups[c.id];
    islandLayer.appendChild(g);
    const [x, y] = c.island.pos;
    c.island.blobs.forEach(([dx, dy, r]) => svgEl('circle', { cx: x + dx, cy: y + dy, r }, g));
  });

  // 標籤
  const labelLayer = svgEl('g', { class: 'labels' }, svg);
  const labels = {};
  COUNTIES.forEach(c => {
    const [x, y] = labelPos[c.id];
    const g = svgEl('g', { class: 'label', transform: `translate(${x},${y})`, 'data-id': c.id }, labelLayer);
    const ring = svgEl('circle', { r: 17, class: 'ring' }, g);
    const dot = svgEl('circle', { r: 12.5, class: 'dot' }, g);
    const num = svgEl('text', { y: 4.5, class: 'num' }, g);
    const name = svgEl('text', { y: 26, class: 'name' }, g);
    name.textContent = c.short;
    labels[c.id] = { g, ring, dot, num };
  });

  // 放大時顯示的縣市卡片：名牌 + 5×5 兵力格 + 技能圖示（座標單位 = 地圖單位，會跟著縮放）
  const cardLayer = svgEl('g', { class: 'cards' }, svg);
  const cards = {};
  COUNTIES.forEach(c => {
    const [x, y] = labelPos[c.id];
    const g = svgEl('g', { class: 'ccard', transform: `translate(${x},${y - 22})`, 'data-id': c.id }, cardLayer);
    const tag = svgEl('rect', { x: -16, y: 0, width: 32, height: 7.5, rx: 1.6, class: 'ctag' }, g);
    const name = svgEl('text', { x: 0, y: 5.4, class: 'cname' }, g);
    svgEl('rect', { x: -14.5, y: 8.8, width: 29, height: 29, rx: 1.2, class: 'cgrid' }, g);
    const cells = [];
    for (let i = 0; i < 25; i++) {
      const cx = -13.6 + (i % 5) * 5.5, cy = 9.7 + Math.floor(i / 5) * 5.5;
      const rect = svgEl('rect', { x: cx, y: cy, width: 5, height: 5, rx: .6, class: 'ccell' }, g);
      const img = svgEl('image', { x: cx, y: cy, width: 5, height: 5 }, g);
      const txt = svgEl('text', { x: cx + 2.5, y: cy + 3.9, class: 'cicon' }, g);
      cells.push({ rect, img, txt });
    }
    const skills = [0, 1].map(i => {
      const sg = svgEl('g', { transform: `translate(${i ? 1.5 : -8.5},39.5)` }, g);
      svgEl('rect', { width: 7, height: 7, rx: 1.4, class: 'cskill' }, sg);
      const t = svgEl('text', { x: 3.5, y: 5.2, class: 'cskillIcon' }, sg);
      return { g: sg, t };
    });
    cards[c.id] = { g, tag, name, cells, skills };
  });

  const fx = svgEl('g', { class: 'fx' }, svg);

  for (const id in groups) {
    for (const target of [groups[id], labels[id].g, cards[id].g]) {
      target.addEventListener('click', ev => onClick(id, ev));
      target.addEventListener('mouseenter', () => onHover(id));
      target.addEventListener('mouseleave', () => onHover(null));
    }
  }
  const view = makeView(svg);
  return { groups, labels, borders, labelPos, fx, cards, view };
}

// ───────── 縮放與拖曳 ─────────
const ZOOM_CARDS = 1.8; // 放大到這個倍率以上顯示縣市卡片
function makeView(svg) {
  const v = { cx: MAP_W / 2, cy: MAP_H / 2, z: 1, w: MAP_W, h: MAP_H, listeners: [] };
  const clamp = (val, lo, hi) => Math.min(hi, Math.max(lo, val));
  function apply() {
    const r = svg.getBoundingClientRect();
    const aspect = r.width && r.height ? r.width / r.height : MAP_W / MAP_H;
    let w = MAP_W, h = MAP_H;
    if (aspect > MAP_W / MAP_H) w = h * aspect; else h = w / aspect;
    v.w = w / v.z; v.h = h / v.z;
    v.cx = v.w >= MAP_W ? MAP_W / 2 : clamp(v.cx, v.w / 2, MAP_W - v.w / 2);
    v.cy = v.h >= MAP_H ? MAP_H / 2 : clamp(v.cy, v.h / 2, MAP_H - v.h / 2);
    svg.setAttribute('viewBox', `${v.cx - v.w / 2} ${v.cy - v.h / 2} ${v.w} ${v.h}`);
    svg.classList.toggle('zoomed', v.z >= ZOOM_CARDS);
    svg.style.setProperty('--z', v.z); // 讓特效文字、箭頭不會跟著放大
    v.listeners.forEach(fn => fn(v));
  }
  v.set = (cx, cy, z = v.z) => { v.cx = cx; v.cy = cy; v.z = clamp(z, 1, 4); apply(); };
  v.zoomTo = z => v.set(v.cx, v.cy, z);
  v.onChange = fn => v.listeners.push(fn);
  v.apply = apply;

  // 拖曳平移（移動超過幾個像素就不算點擊）
  let drag = null, moved = false;
  svg.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy };
    moved = false;
  });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!moved && Math.hypot(dx, dy) < 5) return;
    moved = true;
    svg.classList.add('dragging');
    const scale = v.w / svg.getBoundingClientRect().width;
    v.set(drag.cx - dx * scale, drag.cy - dy * scale);
  });
  window.addEventListener('pointerup', () => { drag = null; svg.classList.remove('dragging'); });
  svg.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);

  // 滾輪縮放，以游標為中心
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const px = v.cx - v.w / 2 + (e.clientX - r.left) / r.width * v.w;
    const py = v.cy - v.h / 2 + (e.clientY - r.top) / r.height * v.h;
    const z = Math.min(4, Math.max(1, v.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    const k = v.z / z;
    v.set(px - (px - v.cx) * k, py - (py - v.cy) * k, z);
  }, { passive: false });
  window.addEventListener('resize', apply);
  apply();
  return v;
}

// ───────── 小地圖 ─────────
// 用 <use> 引用主地圖的陸地，顏色會自動同步；方框 = 主畫面目前看到的範圍
function buildMinimap(mini, view) {
  mini.setAttribute('viewBox', `0 0 ${MAP_W} ${MAP_H}`);
  for (const ref of ['mapUnder', 'mapLand', 'mapIslands', 'mapCoast']) svgEl('use', { href: '#' + ref }, mini);
  const box = svgEl('rect', { class: 'miniBox' }, mini);
  view.onChange(v => {
    box.setAttribute('x', v.cx - v.w / 2);
    box.setAttribute('y', v.cy - v.h / 2);
    box.setAttribute('width', v.w);
    box.setAttribute('height', v.h);
  });
  view.apply();
  let down = false;
  const go = e => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(mini.getScreenCTM().inverse());
    view.set(pt.x, pt.y, Math.max(view.z, 2));
  };
  mini.addEventListener('pointerdown', e => { down = true; mini.setPointerCapture(e.pointerId); go(e); });
  mini.addEventListener('pointermove', e => { if (down) go(e); });
  mini.addEventListener('pointerup', () => { down = false; });
}
