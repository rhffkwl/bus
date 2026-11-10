/* 서울 버스 데이터 계층.
   지금은 목 데이터를 반환하고, 나중에 BASE 만 워커 주소로 바꾸면
   서울시 버스 API(ws.bus.go.kr) 프록시에 연결할 수 있어요.
   키는 이 파일이나 프론트에 두지 않습니다. */
const BASE = null; // 예: 'https://example.workers.dev'

const TYPE_COLOR = {
  '간선': '간선',
  '지선': '지선',
  '광역': '광역',
  '순환': '순환',
  '마을': '마을',
};

const routes = {
  '202': {
    id: '202', routeId: '100100039', number: '202', type: '간선',
    start: '불암동', end: '후암동', turnStopId: '03204',
  },
  '402': {
    id: '402', routeId: '100100063', number: '402', type: '간선',
    start: '장지공영차고지', end: '시청', turnStopId: '02286',
  },
  '401': {
    id: '401', routeId: '100100062', number: '401', type: '간선',
    start: '장지공영차고지', end: '광화문', turnStopId: '01009',
  },
  '7016': {
    id: '7016', routeId: '111100003', number: '7016', type: '지선',
    start: '은평공영차고지', end: '상명대', turnStopId: '01219',
  },
  '9401': {
    id: '9401', routeId: '234000013', number: '9401', type: '광역',
    start: '구미동', end: '서울역', turnStopId: '02005',
  },
  '용산03': {
    id: '용산03', routeId: '111106011', number: '용산03', type: '마을',
    start: '한강진역', end: '서울역', turnStopId: '03130',
  },
};

/* 정류장: ARS 번호를 id 로 씁니다. */
const stops = {
  '06015': { id: '06015', name: '청량리역환승센터(4번승강장)', direction: '청량리청과물도매시장 방면' },
  '06022': { id: '06022', name: '청량리청과물도매시장', direction: '제기동역.서울약령시 방면' },
  '06024': { id: '06024', name: '제기동역.서울약령시', direction: '서울시동부병원 방면' },
  '06182': { id: '06182', name: '서울시동부병원', direction: '동아제약앞 방면' },
  '06184': { id: '06184', name: '동아제약앞', direction: 'e편한세상청계센트럴포레아파트 방면' },
  '06310': { id: '06310', name: 'e편한세상청계센트럴포레아파트', direction: '청계벽산아파트.텐즈힐아파트 방면' },
  '04107': { id: '04107', name: '청계벽산아파트.텐즈힐아파트', direction: '상왕십리역.센트라스아파트 방면' },
  '04114': { id: '04114', name: '상왕십리역.센트라스아파트', direction: '상왕십리역 방면' },
  '04102': { id: '04102', name: '상왕십리역', direction: '왕십리센트라스아파트 방면' },
  '04103': { id: '04103', name: '왕십리센트라스아파트', direction: '성동고등학교건너 방면' },
  '02183': { id: '02183', name: '성동고등학교건너', direction: '신당역1번출구.서울중앙시장 방면' },
  '02181': { id: '02181', name: '신당역1번출구.서울중앙시장', direction: '중구보건소.충무아트센터 방면' },
  '02177': { id: '02177', name: '중구보건소.충무아트센터', direction: '을지로6가.국립중앙의료원 방면' },
  '02172': { id: '02172', name: '을지로6가.국립중앙의료원', direction: '방산시장.을지로4가역6번출구 방면' },
  '02165': { id: '02165', name: '방산시장.을지로4가역6번출구', direction: '을지로4가역1번출구 방면' },
  '02162': { id: '02162', name: '을지로4가역1번출구', direction: '을지로3가역2번출구 방면' },
  '02160': { id: '02160', name: '을지로3가역2번출구', direction: '을지로2가.기업은행본점 방면' },
  '02158': { id: '02158', name: '을지로2가.기업은행본점.서울노동청', direction: '롯데백화점 방면' },
  '02140': { id: '02140', name: '롯데백화점', direction: '북창동.남대문시장 방면' },
  '02127': { id: '02127', name: '북창동.남대문시장', direction: '숭례문 방면' },
  '02008': { id: '02008', name: '숭례문', direction: '서울역버스환승센터 방면' },
  '02004': { id: '02004', name: '서울역버스환승센터(4번승강장)', direction: '갈월동 방면' },
  '03012': { id: '03012', name: '갈월동', direction: '남영우체국.숙대입구역3번출구 방면' },
  '03208': { id: '03208', name: '남영우체국.숙대입구역3번출구', direction: '용산고등학교 방면' },
  '03205': { id: '03205', name: '용산고등학교', direction: '후암동종점.용산중학교 방면' },
  '03204': { id: '03204', name: '후암동종점.용산중학교', direction: '용산중고.삼광초등학교 방면' },
  '03203': { id: '03203', name: '용산중고.삼광초등학교', direction: '후암시장 방면' },
  '03201': { id: '03201', name: '후암시장', direction: '후암삼거리 방면' },
  '02120': { id: '02120', name: '후암삼거리', direction: '남대문경찰서.서울역10번출구 방면' },
  '02218': { id: '02218', name: '남대문경찰서.서울역10번출구', direction: '숭례문 방면' },
  '02122': { id: '02122', name: '숭례문', direction: '남대문시장앞.이회영활동터 방면' },
  '02219': { id: '02219', name: '남대문시장앞.이회영활동터', direction: '명동.롯데영플라자 방면' },
  '02142': { id: '02142', name: '명동.롯데영플라자', direction: '을지로입구.로얄호텔 방면' },
  '02156': { id: '02156', name: '을지로입구.로얄호텔', direction: '을지로3가역12번출구 방면' },
  '02159': { id: '02159', name: '을지로3가역12번출구', direction: '을지로3가 방면' },
  '02161': { id: '02161', name: '을지로3가', direction: '을지로4가역10번출구 방면' },
  '02163': { id: '02163', name: '을지로4가역10번출구', direction: '을지로5가.중부시장 방면' },
  '02166': { id: '02166', name: '을지로5가.중부시장', direction: '을지로6가.국립중앙의료원 방면' },
  '02169': { id: '02169', name: '을지로6가.국립중앙의료원', direction: '광희동.동대문역사문화공원역 방면' },
  '02235': { id: '02235', name: '광희동.동대문역사문화공원역', direction: '중구보건소.충무아트센터 방면' },
  '02178': { id: '02178', name: '중구보건소.충무아트센터', direction: '신당역4번출구.서울중앙시장 방면' },
  '02182': { id: '02182', name: '신당역4번출구.서울중앙시장', direction: '신당5동주민센터.성동고등학교 방면' },
  '02184': { id: '02184', name: '신당5동주민센터.성동고등학교', direction: '신당파인힐하나유보라 방면' },
  '02252': { id: '02252', name: '신당파인힐하나유보라', direction: '뉴타운아파트 방면' },
  '04105': { id: '04105', name: '뉴타운아파트', direction: '상왕십리역 방면' },
  '04113': { id: '04113', name: '상왕십리역', direction: '청계벽산아파트.텐즈힐아파트 방면' },
  '04106': { id: '04106', name: '청계벽산아파트.텐즈힐아파트', direction: '동아제약앞 방면' },
  '06185': { id: '06185', name: '동아제약앞', direction: '서울시동부병원 방면' },
  '06183': { id: '06183', name: '서울시동부병원', direction: '제기동역.서울약령시 방면' },
  '06023': { id: '06023', name: '제기동역.서울약령시', direction: '청량리수산시장 방면' },
  '06426': { id: '06426', name: '청량리수산시장', direction: '청량리역환승센터 방면' },
  '06018': { id: '06018', name: '청량리역환승센터(2번승강장)', direction: '서울성심병원 방면' },

  '22016': { id: '22016', name: '신사역', direction: '한남대교전망카페 방면' },
  '23531': { id: '23531', name: '한남대교전망카페', direction: '한남오거리 방면' },
  '03166': { id: '03166', name: '한남오거리', direction: '순천향대학병원 방면' },
  '03162': { id: '03162', name: '순천향대학병원', direction: '서울시기술교육원중부.블루스퀘어 방면' },
  '03160': { id: '03160', name: '서울시기술교육원중부.블루스퀘어', direction: '장충단로입구 방면' },
  '03158': { id: '03158', name: '장충단로입구', direction: '남산맨션아파트.남산예술원 방면' },
  '03159': { id: '03159', name: '남산맨션아파트.남산예술원', direction: '하얏트호텔 방면' },
  '03175': { id: '03175', name: '하얏트호텔', direction: '남산야외식물원입구 방면' },
  '03173': { id: '03173', name: '남산야외식물원입구', direction: '용암초등학교.이태원2동주민센터 방면' },
  '03343': { id: '03343', name: '용암초등학교.이태원2동주민센터', direction: '용산2가동주민센터.보성여중고 방면' },
  '03171': { id: '03171', name: '용산2가동주민센터.보성여중고', direction: '후암약수터 방면' },
  '03169': { id: '03169', name: '후암약수터', direction: '남산도서관.용산도서관 방면' },
  '03167': { id: '03167', name: '남산도서관.용산도서관', direction: '백범광장 방면' },
  '02215': { id: '02215', name: '백범광장', direction: '남산공원.구힐튼호텔 방면' },
  '02285': { id: '02285', name: '남산공원.구힐튼호텔', direction: '숭례문.남대문시장8번출입구 방면' },
  '02124': { id: '02124', name: '숭례문.남대문시장8번출입구', direction: '소공동주민센터 방면' },
  '02128': { id: '02128', name: '소공동주민센터', direction: '시청역1호선.서울시청 방면' },
  '02507': { id: '02507', name: '시청역1호선.서울시청', direction: '시청앞.덕수궁 방면' },
  '02286': { id: '02286', name: '시청앞.덕수궁', direction: '시청역8번출구 방면' },
  '02132': { id: '02132', name: '시청역8번출구', direction: '서울역버스환승센터 방면' },
  '02005': { id: '02005', name: '서울역버스환승센터(5번승강장)', direction: '숭례문.서울역4번출구 방면' },
  '02123': { id: '02123', name: '숭례문.서울역4번출구', direction: '숭례문남산방향 방면' },
  '02125': { id: '02125', name: '숭례문남산방향', direction: '남산공원.구힐튼호텔 방면' },
  '02284': { id: '02284', name: '남산공원.구힐튼호텔', direction: '남산도서관.용산도서관 방면' },
  '03168': { id: '03168', name: '남산도서관.용산도서관', direction: '후암약수터 방면' },
  '03170': { id: '03170', name: '후암약수터', direction: '용산2가동주민센터.보성여중고 방면' },
  '03172': { id: '03172', name: '용산2가동주민센터.보성여중고', direction: '용암초등학교.이태원2동주민센터 방면' },
  '03342': { id: '03342', name: '용암초등학교.이태원2동주민센터', direction: '남산야외식물원입구 방면' },
  '03174': { id: '03174', name: '남산야외식물원입구', direction: '하얏트호텔 방면' },
  '03176': { id: '03176', name: '하얏트호텔', direction: '서울시기술교육원중부.블루스퀘어 방면' },
  '03161': { id: '03161', name: '서울시기술교육원중부.블루스퀘어', direction: '순천향대학병원.한남오거리 방면' },
  '03165': { id: '03165', name: '순천향대학병원.한남오거리', direction: '신사역.푸른저축은행 방면' },
  '22015': { id: '22015', name: '신사역.푸른저축은행', direction: '논현역 방면' },
  '22013': { id: '22013', name: '논현역', direction: '지하철2호선강남역 방면' },
  '22011': { id: '22011', name: '지하철2호선강남역', direction: '신분당선강남역 방면' },

  '01009': { id: '01009', name: '광화문', direction: '서울역사박물관.경희궁 방면' },
  '01120': { id: '01120', name: '서울신문사', direction: '광화문 방면' },
  '02126': { id: '02126', name: '남대문시장앞', direction: '서울역버스환승센터 방면' },
  '01219': { id: '01219', name: '상명대입구', direction: '세검정 방면' },
  '01171': { id: '01171', name: '경복궁역', direction: '광화문 방면' },
  '03130': { id: '03130', name: '용산역', direction: '남영역 방면' },
  '03210': { id: '03210', name: '숙대입구역', direction: '서울역 방면' },
};

const routeStops = {
  '202': [
    '06015','06022','06024','06182','06184','06310','04107','04114','04102','04103',
    '02183','02181','02177','02172','02165','02162','02160','02158','02140','02127',
    '02008','02004','03012','03208','03205','03204',
    '03203','03201','02120','02218','02122','02219','02142','02156','02159','02161',
    '02163','02166','02169','02235','02178','02182','02184','02252','04105','04113',
    '04106','06185','06183','06023','06426','06018',
  ],
  '402': [
    '22016','23531','03166','03162','03160','03158','03159','03175','03173','03343',
    '03171','03169','03167','02215','02285','02124','02128','02507','02286',
    '02132','02005','02123','02125','02284','03168','03170','03172','03342','03174',
    '03176','03161','03165','22015','22013','22011',
  ],
  '401': [
    '02285','02124','02128','02507','01009','01120','02005','02004','02123','02284',
  ],
  '7016': [
    '01219','01171','01009','02127','02005','02004','03210','03130',
  ],
  '9401': [
    '22011','22013','22015','03165','02285','02124','02005',
  ],
  '용산03': [
    '03166','03169','03204','03203','03208','03210','03130',
  ],
};

const stopRoutes = {};
for (const [rid, ids] of Object.entries(routeStops)) {
  for (const id of ids) {
    (stopRoutes[id] ||= []).push(rid);
  }
}

export const DEFAULT_FAVORITES = ['03204', '02005', '02286'];

const arrivalBase = {
  '03204': [
    { routeId: '202', items: [
      { etaSec: 25, stationsAway: 1, congestion: '여유', plate: '1842', lowFloor: true },
      { etaSec: 1080, stationsAway: 8, congestion: '보통', plate: '3310', lowFloor: true },
    ]},
  ],
  '02005': [
    { routeId: '402', items: [
      { etaSec: 110, stationsAway: 5, congestion: '여유', plate: '9555', lowFloor: true },
      { etaSec: 490, stationsAway: 9, congestion: '보통', plate: '7721', lowFloor: true },
    ]},
    { routeId: '401', items: [
      { etaSec: 200, stationsAway: 3, congestion: '여유', plate: '2108', lowFloor: true },
      { etaSec: 720, stationsAway: 11, congestion: '혼잡', plate: '4417', lowFloor: true },
    ]},
    { routeId: '7016', items: [
      { etaSec: 40, stationsAway: 1, congestion: '여유', plate: '0522', lowFloor: false },
      { etaSec: 900, stationsAway: 7, congestion: '여유', plate: '0688', lowFloor: false },
    ]},
    { routeId: '9401', items: [
      { etaSec: 360, stationsAway: 4, congestion: '보통', plate: '8091', lowFloor: true },
      { etaSec: 1320, stationsAway: 10, congestion: '여유', plate: '8104', lowFloor: true },
    ]},
  ],
  '02286': [
    { routeId: '402', items: [
      { etaSec: 20, stationsAway: 1, congestion: '여유', plate: '6630', lowFloor: true },
      { etaSec: 660, stationsAway: 6, congestion: '혼잡', plate: '9555', lowFloor: true },
    ]},
    { routeId: '401', items: [
      { etaSec: 180, stationsAway: 2, congestion: '보통', plate: '2108', lowFloor: true },
      { etaSec: 840, stationsAway: 8, congestion: '여유', plate: '4417', lowFloor: true },
    ]},
  ],
  '02004': [
    { routeId: '202', items: [
      { etaSec: 150, stationsAway: 3, congestion: '여유', plate: '1842', lowFloor: true },
      { etaSec: 600, stationsAway: 7, congestion: '보통', plate: '3310', lowFloor: true },
    ]},
    { routeId: '7016', items: [
      { etaSec: 90, stationsAway: 2, congestion: '여유', plate: '0522', lowFloor: false },
      { etaSec: 780, stationsAway: 6, congestion: '여유', plate: '0688', lowFloor: false },
    ]},
  ],
  '03203': [
    { routeId: '202', items: [
      { etaSec: 80, stationsAway: 1, congestion: '여유', plate: '1842', lowFloor: true },
      { etaSec: 1140, stationsAway: 9, congestion: '보통', plate: '3310', lowFloor: true },
    ]},
    { routeId: '용산03', items: [
      { etaSec: 240, stationsAway: 3, congestion: '여유', plate: '3011', lowFloor: false },
    ]},
  ],
};

/* 노선별 버스 위치: stopId 는 막 떠난(또는 정차 중인) 정류장, progress 0~1 은 다음 정류장까지 비율. */
const positions = {
  '202': [
    { plate: '1842', congestion: '여유', lowFloor: true, stopId: '03205', progress: 0.7 },
    { plate: '3310', congestion: '보통', lowFloor: true, stopId: '02004', progress: 0.2 },
    { plate: '5904', congestion: '여유', lowFloor: true, stopId: '02140', progress: 0.5 },
    { plate: '2261', congestion: '혼잡', lowFloor: true, stopId: '02122', progress: 0.4 },
  ],
  '402': [
    { plate: '9555', congestion: '여유', lowFloor: true, stopId: '02132', progress: 0.55 },
    { plate: '7721', congestion: '보통', lowFloor: true, stopId: '02285', progress: 0.3 },
    { plate: '6630', congestion: '여유', lowFloor: true, stopId: '02507', progress: 0.8 },
    { plate: '4190', congestion: '여유', lowFloor: true, stopId: '02123', progress: 0.45 },
    { plate: '3088', congestion: '혼잡', lowFloor: true, stopId: '03175', progress: 0.2 },
  ],
  '401': [
    { plate: '2108', congestion: '여유', lowFloor: true, stopId: '02128', progress: 0.4 },
    { plate: '4417', congestion: '혼잡', lowFloor: true, stopId: '02285', progress: 0.6 },
  ],
  '7016': [
    { plate: '0522', congestion: '여유', lowFloor: false, stopId: '02127', progress: 0.5 },
    { plate: '0688', congestion: '여유', lowFloor: false, stopId: '01171', progress: 0.3 },
  ],
  '9401': [
    { plate: '8091', congestion: '보통', lowFloor: true, stopId: '02124', progress: 0.5 },
    { plate: '8104', congestion: '여유', lowFloor: true, stopId: '22013', progress: 0.2 },
  ],
  '용산03': [
    { plate: '3011', congestion: '여유', lowFloor: false, stopId: '03169', progress: 0.4 },
  ],
};

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function stopView(id) {
  const s = stops[id];
  if (!s) return null;
  return { ...s, arsId: id, routes: (stopRoutes[id] || []).slice() };
}

function routeView(id) {
  return routes[id] ? { ...routes[id] } : null;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('요청에 실패했어요');
  return res.json();
}

export async function getStop(stopId) {
  return stopView(stopId);
}

export async function getRoute(routeId) {
  return routeView(routeId);
}

export async function getArrivals(stopId) {
  if (BASE) return fetchJson(`${BASE}/arrivals?stopId=${encodeURIComponent(stopId)}`);
  const stop = stopView(stopId);
  if (!stop) return { stop: null, routes: [] };
  let packed = arrivalBase[stopId];
  if (!packed) {
    packed = (stopRoutes[stopId] || []).map((rid, i) => ({
      routeId: rid,
      items: [
        { etaSec: 60 + i * 80, stationsAway: 2 + i, congestion: '여유', plate: '1000', lowFloor: true },
        { etaSec: 480 + i * 90, stationsAway: 6 + i, congestion: '보통', plate: '2000', lowFloor: true },
      ],
    }));
  }
  const list = packed.map((p) => {
    const r = routes[p.routeId];
    return {
      routeId: p.routeId,
      number: r ? r.number : p.routeId,
      type: r ? r.type : '간선',
      arrivals: clone(p.items),
    };
  });
  return { stop, routes: list };
}

export async function searchStops(q) {
  if (BASE) return fetchJson(`${BASE}/stops?q=${encodeURIComponent(q)}`);
  const needle = (q || '').trim().toLowerCase().replace(/\s+/g, '');
  const all = Object.keys(stops).map(stopView);
  if (!needle) return all.slice(0, 12);
  const scored = [];
  for (const s of all) {
    const name = s.name.toLowerCase().replace(/\s+/g, '');
    let score = 0;
    if (s.arsId.includes(needle)) score = name.startsWith(needle) ? 400 : 200;
    if (name === needle) score = Math.max(score, 500);
    else if (name.startsWith(needle)) score = Math.max(score, 400);
    else if (name.includes(needle)) score = Math.max(score, 300);
    if (score) scored.push({ s, score, name });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ko'));
  return scored.map((x) => x.s).slice(0, 30);
}

export async function getRouteStops(routeId) {
  if (BASE) return fetchJson(`${BASE}/route-stops?routeId=${encodeURIComponent(routeId)}`);
  const route = routeView(routeId);
  if (!route) return { route: null, stops: [] };
  const list = (routeStops[routeId] || []).map((id) => stopView(id)).filter(Boolean);
  return { route, stops: list };
}

export async function getBusPositions(routeId) {
  if (BASE) return fetchJson(`${BASE}/positions?routeId=${encodeURIComponent(routeId)}`);
  return clone(positions[routeId] || []);
}

export { TYPE_COLOR };
