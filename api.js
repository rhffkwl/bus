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

/* 즐겨찾기 기본값: 정류장 + 고른 노선 */
export const DEFAULT_FAVORITES = [
  {
    arsId: '03204', name: '후암동종점.용산중학교', direction: '용산중고.삼광초등학교 방면',
    routes: [{ id: '100100039', number: '202', type: '간선' }],
  },
  {
    arsId: '02005', name: '서울역버스환승센터(5번승강장)', direction: '숭례문.서울역4번출구 방면',
    routes: [{ id: '100100063', number: '402', type: '간선' }],
  },
  {
    arsId: '02004', name: '서울역버스환승센터(4번승강장)', direction: '갈월동 방면',
    routes: [{ id: '100100039', number: '202', type: '간선' }],
  },
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
