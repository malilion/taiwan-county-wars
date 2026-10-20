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

  svgEl('path', { d: outlineD, class: 'land-under' }, svg);
  const land = svgEl('g', { 'clip-path': 'url(#tw-clip)', class: 'land' }, svg);
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
  svgEl('path', { d: outlineD, class: 'coast' }, svg);

  // 離島
  const islandLayer = svgEl('g', { class: 'islands' }, svg);
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

  const fx = svgEl('g', { class: 'fx' }, svg);

  for (const id in groups) {
    for (const target of [groups[id], labels[id].g]) {
      target.addEventListener('click', ev => onClick(id, ev));
      target.addEventListener('mouseenter', () => onHover(id));
      target.addEventListener('mouseleave', () => onHover(null));
    }
  }
  return { groups, labels, borders, labelPos, fx };
}
