/* 서울 버스 데이터 계층.
   서울시 버스 API(ws.bus.go.kr)를 Cloudflare 워커(bus-proxy)를 거쳐 불러와요.
   인증키는 워커에만 있고 이 파일이나 프론트에는 없어요. */
const BASE = 'https://bus-proxy.rhffkwl.workers.dev';

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function fetchJson(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.set(k, v);
  let res;
  try {
    res = await fetch(`${BASE}${path}?${qs}`, { cache: 'no-store' });
  } catch {
    throw new ApiError('NETWORK', '인터넷 연결을 확인해 주세요');
  }
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok || !body || body.error) {
    const e = (body && body.error) || {};
    throw new ApiError(e.code || `HTTP_${res.status}`, e.message || '요청에 실패했어요');
  }
  return body.data;
}

/* 노선 유형 → 색 클래스 (style.css 의 --간선 등) */
const KNOWN = ['간선', '지선', '광역', '순환', '마을', '공항', '경기', '인천', '심야', '동행', '한강', '관광'];
export function typeKey(t) { return KNOWN.includes(t) ? t : '간선'; }

/* 즐겨찾기 기본값: 정류장 + 고른 노선.
   FAV_SEEDS 는 버전별로 나중에 추가된 항목. 이미 앱을 쓰던 사람에게는
   빠진 정류장·노선만 넣고, 직접 지운 예전 기본값은 다시 넣지 않아요. */
const R202 = { id: '100100039', number: '202', type: '간선' };
const R402 = { id: '100100063', number: '402', type: '간선' };
const R405 = { id: '100100597', number: '405', type: '간선' };

const FAV_V3 = [
  {
    arsId: '03204', name: '후암동종점.용산중학교', direction: '용산중고.삼광초등학교 방면',
    routes: [R202],
  },
  {
    arsId: '02005', name: '서울역버스환승센터(5번승강장)', direction: '숭례문.서울역4번출구 방면',
    routes: [R402],
  },
  {
    arsId: '02004', name: '서울역버스환승센터(4번승강장)', direction: '갈월동 방면',
    routes: [R202],
  },
];

export const FAV_SEED_VERSION = 4;
export const FAV_SEEDS = {
  4: [
    {
      arsId: '03170', name: '후암약수터', direction: '용산2가동주민센터.보성여중고 방면',
      routes: [R402],
    },
    {
      arsId: '02140', name: '롯데백화점', direction: '북창동.남대문시장 방면',
      routes: [R202, R405],
    },
    {
      arsId: '02132', name: '시청역8번출구', direction: '염천교 방면',
      routes: [R402],
    },
    {
      arsId: '02123', name: '숭례문.서울역4번출구', direction: '북창동.소공동주민센터건너 방면',
      routes: [R402, R405],
    },
    {
      arsId: '02125', name: '숭례문남산방향', direction: '남산공원.구힐튼호텔 방면',
      routes: [R402, R405],
    },
    {
      arsId: '03169', name: '후암약수터', direction: '남산도서관.용산도서관 방면',
      routes: [R402, R405],
    },
  ],
};

export const DEFAULT_FAVORITES = [
  ...FAV_V3,
  ...Object.keys(FAV_SEEDS).sort((a, b) => a - b).flatMap((v) => FAV_SEEDS[v]),
];

/* 정류장 도착 정보.
   routeIds 를 주고 onlyRoutes=true 면 그 노선들만 (노선 기준 조회, 호출 수 절약).
   아니면 정류장 전체 노선 (정류소정보조회 서비스 필요, 안 되면 routeIds 로 대체). */
export function getArrivals(arsId, { routeIds = [], onlyRoutes = false } = {}) {
  return fetchJson('/arrivals', {
    arsId,
    routes: routeIds.join(','),
    mode: onlyRoutes && routeIds.length ? 'routes' : '',
  });
}

export function searchStops(q) { return fetchJson('/stops', { q }); }
export function searchRoutes(q) { return fetchJson('/routes', { q }); }
export function getRouteStops(routeId) { return fetchJson('/route-stops', { routeId }); }
export function getBusPositions(routeId) { return fetchJson('/positions', { routeId }); }
