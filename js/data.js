// 台灣 22 縣市資料：seeds 為 Voronoi 種子點 (經度, 緯度)，用來拼出近似的縣市形狀
// econ: 每天基本稅收（萬元）；atk/def: 縣市特性加成
const COUNTIES = [
  { id: 'keelung', name: '基隆市', short: '基隆', nick: '雨都', trait: '防禦 +15%，下雨天沒人想來打', region: 'north', econ: 30, atk: 1.0, def: 1.15, color: '#4361EE', seeds: [[121.75, 25.12]], label: [121.75, 25.11] },
  { id: 'taipei', name: '臺北市', short: '台北', nick: '天龍國', trait: '稅收最高，錢多到可以砸人', region: 'north', econ: 80, atk: 1.0, def: 1.0, color: '#E63946', seeds: [[121.55, 25.04], [121.54, 25.12]], label: [121.55, 25.06] },
  { id: 'newtaipei', name: '新北市', short: '新北', nick: '人口第一', trait: '開局兵力最多，把台北包起來', region: 'north', econ: 55, atk: 1.0, def: 1.05, color: '#F4A261', seeds: [[121.47, 25.22], [121.64, 25.21], [121.88, 25.03], [121.40, 25.00], [121.38, 25.10], [121.53, 24.86], [121.70, 24.95]], label: [121.58, 24.86] },
  { id: 'taoyuan', name: '桃園市', short: '桃園', nick: '國門之都', trait: '攻擊 +10%，出國打仗最方便', region: 'north', econ: 50, atk: 1.1, def: 1.0, color: '#2A9D8F', seeds: [[121.20, 25.02], [121.30, 24.82], [121.12, 24.98]], label: [121.22, 24.93] },
  { id: 'hsinchucounty', name: '新竹縣', short: '竹縣', nick: '客家硬頸', trait: '防禦 +10%', region: 'north', econ: 35, atk: 1.0, def: 1.1, color: '#8AB17D', seeds: [[121.08, 24.80], [121.22, 24.62], [121.02, 24.70]], label: [121.12, 24.70] },
  { id: 'hsinchucity', name: '新竹市', short: '竹市', nick: '風城', trait: '攻擊 +10%，竹科稅收加持', region: 'north', econ: 45, atk: 1.1, def: 1.0, color: '#00B4D8', seeds: [[120.95, 24.81]], label: [120.94, 24.80] },
  { id: 'miaoli', name: '苗栗縣', short: '苗栗', nick: '苗栗國', trait: '防禦 +25%，入境要辦護照', region: 'central', econ: 25, atk: 1.0, def: 1.25, color: '#B5838D', seeds: [[120.82, 24.58], [120.95, 24.42], [121.05, 24.50]], label: [120.88, 24.52] },
  { id: 'taichung', name: '臺中市', short: '台中', nick: '中部霸主', trait: '攻擊 +10%', region: 'central', econ: 55, atk: 1.1, def: 1.0, color: '#7B2CBF', seeds: [[120.62, 24.18], [120.85, 24.25], [121.12, 24.28], [120.70, 24.08]], label: [120.78, 24.18] },
  { id: 'changhua', name: '彰化縣', short: '彰化', nick: '肉圓鐵騎', trait: '機車騎士攻擊 +20%', region: 'central', econ: 35, atk: 1.0, def: 1.0, moto: 1.2, color: '#E9C46A', seeds: [[120.47, 24.02], [120.40, 23.88]], label: [120.44, 23.95] },
  { id: 'nantou', name: '南投縣', short: '南投', nick: '山岳要塞', trait: '防禦 +25%，唯一不靠海', region: 'central', econ: 25, atk: 1.0, def: 1.25, color: '#2D6A4F', seeds: [[120.72, 23.88], [120.98, 23.92], [121.05, 23.60], [120.85, 23.66]], label: [120.92, 23.80] },
  { id: 'yunlin', name: '雲林縣', short: '雲林', nick: '農業首都', trait: '稅收 +，阿兵哥便宜 20%', region: 'central', econ: 30, atk: 1.0, def: 1.0, cheap: 'inf', color: '#A7C957', seeds: [[120.30, 23.74], [120.52, 23.70]], label: [120.38, 23.70] },
  { id: 'chiayicounty', name: '嘉義縣', short: '嘉縣', nick: '阿里山', trait: '防禦 +10%', region: 'south', econ: 25, atk: 1.0, def: 1.1, color: '#BC6C25', seeds: [[120.25, 23.42], [120.68, 23.45], [120.40, 23.35]], label: [120.66, 23.42] },
  { id: 'chiayicity', name: '嘉義市', short: '嘉市', nick: '雞肉飯之力', trait: '攻擊 +15%', region: 'south', econ: 25, atk: 1.15, def: 1.0, color: '#FF6B9A', seeds: [[120.45, 23.48]], label: [120.45, 23.48] },
  { id: 'tainan', name: '臺南市', short: '台南', nick: '府城古都', trait: '八家將便宜 20%，防禦 +10%', region: 'south', econ: 45, atk: 1.0, def: 1.1, cheap: 'gen', color: '#9D0208', seeds: [[120.22, 23.15], [120.38, 23.02], [120.25, 22.95], [120.45, 23.18]], label: [120.30, 23.08] },
  { id: 'kaohsiung', name: '高雄市', short: '高雄', nick: '港都', trait: '攻擊 +10%，砲兵便宜 20%', region: 'south', econ: 55, atk: 1.1, def: 1.0, cheap: 'art', color: '#0077B6', seeds: [[120.30, 22.65], [120.42, 22.80], [120.60, 23.00], [120.78, 23.22], [120.68, 23.10]], label: [120.45, 22.80] },
  { id: 'pingtung', name: '屏東縣', short: '屏東', nick: '南國烈日', trait: '攻擊 +10%', region: 'south', econ: 30, atk: 1.1, def: 1.0, color: '#FB8500', seeds: [[120.52, 22.58], [120.68, 22.25], [120.80, 21.98], [120.66, 22.70]], label: [120.62, 22.40] },
  { id: 'yilan', name: '宜蘭縣', short: '宜蘭', nick: '雪隧之後', trait: '防禦 +15%', region: 'north', econ: 30, atk: 1.0, def: 1.15, color: '#6A4C93', seeds: [[121.78, 24.72], [121.62, 24.50], [121.40, 24.58]], label: [121.70, 24.65] },
  { id: 'hualien', name: '花蓮縣', short: '花蓮', nick: '太魯閣', trait: '防禦 +20%', region: 'east', econ: 25, atk: 1.0, def: 1.2, color: '#06D6A0', seeds: [[121.55, 24.15], [121.45, 23.85], [121.38, 23.50], [121.42, 24.30]], label: [121.45, 23.90] },
  { id: 'taitung', name: '臺東縣', short: '台東', nick: '熱氣球', trait: '攻擊 +5%，熱氣球偵查', region: 'east', econ: 25, atk: 1.05, def: 1.05, color: '#FFB703', seeds: [[121.22, 23.08], [121.05, 22.75], [120.90, 22.42]], label: [121.08, 22.85] },
  { id: 'penghu', name: '澎湖縣', short: '澎湖', nick: '菊島', trait: '防禦 +30%，海峽天險', region: 'islands', econ: 20, atk: 1.0, def: 1.3, color: '#8D99AE', island: { pos: [100, 430], blobs: [[0, 0, 17], [-13, -17, 9], [15, 13, 8], [-15, 12, 6]] } },
  { id: 'kinmen', name: '金門縣', short: '金門', nick: '戰地前線', trait: '防禦 +40%，砲兵便宜 20%', region: 'islands', econ: 20, atk: 1.0, def: 1.4, cheap: 'art', color: '#6D597A', island: { pos: [70, 250], blobs: [[0, 0, 17], [-22, 4, 8]] } },
  { id: 'lienchiang', name: '連江縣', short: '馬祖', nick: '海上要塞', trait: '防禦 +40%', region: 'islands', econ: 15, atk: 1.0, def: 1.4, color: '#A0C4FF', island: { pos: [70, 95], blobs: [[0, 0, 15], [14, -18, 7], [-12, 20, 6], [18, 20, 5]] } },
];

// 陸地相鄰 + 海上航線（雙向，寫一邊即可）
const ADJACENCY = {
  keelung: ['newtaipei', 'lienchiang'],
  taipei: ['newtaipei'],
  newtaipei: ['taoyuan', 'yilan'],
  taoyuan: ['hsinchucounty', 'yilan'],
  hsinchucounty: ['hsinchucity', 'miaoli', 'taichung', 'yilan'],
  hsinchucity: ['miaoli'],
  miaoli: ['taichung'],
  taichung: ['yilan', 'hualien', 'nantou', 'changhua', 'kinmen'],
  changhua: ['nantou', 'yunlin'],
  nantou: ['yunlin', 'chiayicounty', 'kaohsiung', 'hualien'],
  yunlin: ['chiayicounty', 'penghu'],
  chiayicounty: ['chiayicity', 'tainan', 'kaohsiung', 'penghu'],
  tainan: ['kaohsiung', 'penghu'],
  kaohsiung: ['hualien', 'taitung', 'pingtung', 'penghu'],
  pingtung: ['taitung'],
  yilan: ['hualien'],
  hualien: ['taitung'],
  penghu: ['kinmen'],
  kinmen: ['lienchiang'],
};
const SEA_ROUTES = [['keelung', 'lienchiang'], ['taichung', 'kinmen'], ['yunlin', 'penghu'], ['chiayicounty', 'penghu'], ['tainan', 'penghu'], ['kaohsiung', 'penghu'], ['penghu', 'kinmen'], ['kinmen', 'lienchiang']];

const REGIONS = [
  { id: 'north', name: '北部', bonus: 60, ids: ['keelung', 'taipei', 'newtaipei', 'taoyuan', 'hsinchucounty', 'hsinchucity', 'yilan'] },
  { id: 'central', name: '中部', bonus: 45, ids: ['miaoli', 'taichung', 'changhua', 'nantou', 'yunlin'] },
  { id: 'south', name: '南部', bonus: 45, ids: ['chiayicounty', 'chiayicity', 'tainan', 'kaohsiung', 'pingtung'] },
  { id: 'east', name: '東部', bonus: 25, ids: ['hualien', 'taitung'] },
  { id: 'islands', name: '離島', bonus: 30, ids: ['penghu', 'kinmen', 'lienchiang'] },
];

// 兵種：剪刀石頭布 → 機車剋砲兵、砲兵剋八家將、八家將剋阿兵哥、阿兵哥擋機車
const UNITS = {
  inf: { name: '阿兵哥', icon: '🪖', cost: 10, atk: 3, hp: 5, desc: '便宜耐打，擅長擋機車' },
  moto: { name: '機車騎士', icon: '🛵', cost: 18, atk: 5, hp: 4, desc: '機動快攻，專衝砲兵陣地' },
  gen: { name: '八家將', icon: '👺', cost: 26, atk: 7, hp: 7, desc: '廟口精銳，壓制阿兵哥' },
  art: { name: '砲兵', icon: '💣', cost: 34, atk: 11, hp: 3, desc: '火力最強，但怕被近身' },
};
const UNIT_KEYS = ['inf', 'moto', 'gen', 'art'];
const COUNTERS = { moto: 'art', art: 'gen', gen: 'inf', inf: 'moto' };

// 開局兵力
const START_ARMY = {
  newtaipei: { inf: 8, moto: 3, gen: 1 }, taichung: { inf: 7, moto: 3, gen: 1 }, kaohsiung: { inf: 7, moto: 2, gen: 1, art: 1 },
  taipei: { inf: 6, moto: 2, gen: 1 }, taoyuan: { inf: 6, moto: 2, gen: 1 }, tainan: { inf: 5, moto: 2, gen: 2 },
  changhua: { inf: 5, moto: 3 }, pingtung: { inf: 5, moto: 2 },
};
const DEFAULT_ARMY = { inf: 4, moto: 1 };
const ISLAND_ARMY = { inf: 3, art: 1 };

const RESEARCH = {
  atk: { name: '軍事訓練', icon: '⚔️', desc: '全軍攻擊 +12%' },
  def: { name: '城防工事', icon: '🛡️', desc: '全縣防禦 +12%' },
  eco: { name: '經濟發展', icon: '💰', desc: '每日稅收 +15%' },
};

// 難度：playerPeace / aiPeace = 前幾天 AI 不會攻擊玩家 / 不會互打；aiVsAi = AI 互打的機率；aggr = 進攻門檻倍率
const DIFFICULTY = {
  easy: { name: '簡單', desc: '前 12 天和平發展，AI 很少互打，適合慢慢併吞', playerPeace: 12, aiPeace: 12, aiVsAi: 0.25, aggr: 1.4 },
  normal: { name: '普通', desc: '前 6 天和平，之後各縣市開始蠢蠢欲動', playerPeace: 6, aiPeace: 6, aiVsAi: 0.6, aggr: 1.15 },
  hard: { name: '困難', desc: '第一天就開打的大亂鬥', playerPeace: 0, aiPeace: 0, aiVsAi: 1, aggr: 1 },
};
