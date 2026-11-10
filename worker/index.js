// Seoul bus API proxy for https://rhffkwl.github.io/bus/
// Keeps the data.go.kr service key server-side (secret SEOUL_BUS_KEY).

const UPSTREAM = 'http://ws.bus.go.kr/api/rest';
const ROUTE_TYPE = {
  '1': '공항', '2': '마을', '3': '간선', '4': '지선', '5': '순환',
  '6': '광역', '7': '인천', '8': '경기', '9': '폐지', '0': '공용',
  '10': '관광', '13': '동행', '14': '한강', '15': '심야',
};
const CONG = { '3': '여유', '4': '보통', '5': '혼잡', '6': '매우혼잡' };

const memCache = new Map(); // key -> { exp, body }

class ApiError extends Error {
  constructor(code, message, status = 502, detail) {
    super(message);
    this.code = code; this.status = status; this.detail = detail;
  }
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, origin, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
      ...(origin ? corsHeaders(origin) : {}),
    },
  });
}

// --- tiny XML fallback parser (itemList of flat elements) ---
function decodeXml(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? decodeXml(m[1]).trim() : undefined;
}
function parseXml(xml) {
  const items = [];
  for (const m of xml.matchAll(/<itemList>([\s\S]*?)<\/itemList>/g)) {
    const o = {};
    for (const f of m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) o[f[1]] = decodeXml(f[2]).trim();
    items.push(o);
  }
  return {
    headerCd: xmlTag(xml, 'headerCd'),
    headerMsg: xmlTag(xml, 'headerMsg'),
    authMsg: xmlTag(xml, 'returnAuthMsg'),
    errMsg: xmlTag(xml, 'errMsg'),
    items,
  };
}

async function callSeoul(env, path, params) {
  if (!env.SEOUL_BUS_KEY) throw new ApiError('NO_KEY', '서버에 인증키가 설정되지 않았어요', 500);
  const qs = new URLSearchParams(params);
  qs.set('resultType', 'json');
  const url = `${UPSTREAM}/${path}?serviceKey=${encodeURIComponent(env.SEOUL_BUS_KEY.trim())}&${qs}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(9000), headers: { 'User-Agent': 'bus-proxy/1.0' } });
  } catch (e) {
    throw new ApiError('UPSTREAM_UNREACHABLE', '서울시 버스 서버에 연결하지 못했어요', 504, String(e && e.message || e));
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403 || /등록되지 않은 서비스키|SERVICE_KEY_IS_NOT_REGISTERED|NOT REGISTERED/i.test(text.slice(0, 600))) {
    throw new ApiError('KEY_NOT_REGISTERED', '인증키가 아직 등록(승인 반영)되지 않았어요', 503, text.slice(0, 200));
  }
  if (!res.ok) throw new ApiError('UPSTREAM_HTTP', `서울시 버스 서버 오류 (HTTP ${res.status})`, 502, text.slice(0, 300));

  let headerCd, headerMsg, items = [], authMsg;
  const t = text.trim();
  if (t.startsWith('{')) {
    let j;
    try { j = JSON.parse(t); } catch { throw new ApiError('UPSTREAM_BAD', '응답을 해석하지 못했어요', 502, t.slice(0, 300)); }
    const h = j.msgHeader || {};
    headerCd = h.headerCd != null ? String(h.headerCd) : undefined;
    headerMsg = h.headerMsg;
    const il = j.msgBody && j.msgBody.itemList;
    items = Array.isArray(il) ? il : il ? [il] : [];
    authMsg = j.cmmMsgHeader && j.cmmMsgHeader.returnAuthMsg;
  } else {
    const p = parseXml(t);
    ({ headerCd, headerMsg, items, authMsg } = p);
    if (!headerCd && (p.authMsg || p.errMsg)) headerMsg = p.authMsg || p.errMsg;
  }

  const msg = `${headerMsg || ''} ${authMsg || ''}`;
  if (/NOT_REGISTERED|NOT REGISTERED|등록되지 않은|미등록|SERVICE_KEY|인증/i.test(msg) || headerCd === '7' || headerCd === '30') {
    throw new ApiError('KEY_NOT_REGISTERED', '인증키가 아직 등록(승인 반영)되지 않았어요', 503, (headerMsg || authMsg || '').slice(0, 200));
  }
  if (/LIMITED|초과/i.test(msg) || headerCd === '22') {
    throw new ApiError('QUOTA_EXCEEDED', '오늘 호출 한도를 넘었어요', 429, headerMsg);
  }
  // 0 = OK, 4 = 결과 없음
  if (headerCd && headerCd !== '0' && headerCd !== '4') {
    throw new ApiError('UPSTREAM_ERROR', headerMsg || '서울시 버스 서버 오류', 502, `headerCd=${headerCd}`);
  }
  return items;
}

async function cachedCall(env, path, params, ttl) {
  const key = `up:${path}?${new URLSearchParams(params)}`;
  const now = Date.now();
  const hit = memCache.get(key);
  if (hit && hit.exp > now) return hit.body;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const ckey = `https://bus-proxy.internal/${path}?${new URLSearchParams(params)}`;
  if (cache) {
    try {
      const r = await cache.match(ckey);
      if (r) { const body = await r.json(); memCache.set(key, { exp: now + ttl * 1000, body }); return body; }
    } catch {}
  }
  const body = await callSeoul(env, path, params);
  memCache.set(key, { exp: now + ttl * 1000, body });
  if (cache) {
    try { await cache.put(ckey, new Response(JSON.stringify(body), { headers: { 'Cache-Control': `max-age=${ttl}` } })); } catch {}
  }
  return body;
}

const s = (v) => (v == null ? '' : String(v).trim());
const plate4 = (p) => { const d = s(p).replace(/\D/g, ''); return d.slice(-4) || s(p); };
const rtype = (c) => ROUTE_TYPE[s(c)] || '간선';

function congestion(v) { return CONG[s(v)] || ''; }

function parseArrival(it, n) {
  const msg = s(it[`arrmsg${n}`]);
  const out = {
    msg,
    plate: plate4(it[`plainNo${n}`]),
    lowFloor: s(it[`busType${n}`]) === '1',
    congestion: '',
    last: s(it[`isLast${n}`]) === '1',
    full: s(it[`full${n}`]) === '1',
  };
  // congestion: rerdie_Div=4 -> reride_Num is 혼잡도 code; some feeds expose congestion1/2
  out.congestion = congestion(it[`congetion${n}`] ?? it[`congestion${n}`]);
  if (!out.congestion) {
    const div = s(it[`rerdieDiv${n}`] ?? it[`rerdie_Div${n}`]);
    if (div === '4') out.congestion = congestion(it[`rerideNum${n}`] ?? it[`reride_Num${n}`]);
  }
  out.full = out.full || s(it[`isFullFlag${n}`]) === '1';

  const m = msg.match(/(?:(\d+)분)?\s*(?:(\d+)초)?\s*후/);
  const away = msg.match(/\[(\d+)번째\s*전\]/);
  if (/곧\s*도착/.test(msg)) {
    out.etaSec = 0;
    out.stationsAway = away ? Number(away[1]) : 1;
  } else if (m && (m[1] || m[2])) {
    out.etaSec = (Number(m[1] || 0) * 60) + Number(m[2] || 0);
    out.stationsAway = away ? Number(away[1]) : null;
  } else if (!msg || /운행종료|출발대기|회차|도착정보 없음|정보없음/.test(msg)) {
    out.status = msg || '정보 없음';
    return out;
  } else {
    const tt = Number(it[`traTime${n}`]);
    if (tt > 0) out.etaSec = tt;
    else out.status = msg;
    out.stationsAway = away ? Number(away[1]) : null;
  }
  if (out.stationsAway == null) {
    const so = Number(it.staOrd), sec = Number(it[`sectOrd${n}`]);
    if (so && sec && so >= sec) out.stationsAway = so - sec;
  }
  return out;
}

function mostCommon(arr) {
  const c = new Map();
  for (const v of arr) if (v) c.set(v, (c.get(v) || 0) + 1);
  let best = '', n = 0;
  for (const [k, v] of c) if (v > n) { best = k; n = v; }
  return best;
}

// --- handlers ---
function routeArrivalRow(it) {
  return {
    routeId: s(it.busRouteId),
    number: s(it.busRouteAbrv) || s(it.rtNm),
    type: rtype(it.routeType),
    toward: s(it.adirection),
    nextStop: s(it.nxtStn),
    arrivals: [parseArrival(it, 1), parseArrival(it, 2)],
  };
}

async function arrivalsByRoutes(env, arsId, routeIds) {
  const stop = { id: arsId, arsId, stId: '', name: '', direction: '' };
  const routes = [];
  await Promise.all(routeIds.map(async (rid) => {
    let items;
    try { items = await cachedCall(env, 'arrive/getArrInfoByRouteAll', { busRouteId: rid }, 15); }
    catch (e) { if (e.code === 'KEY_NOT_REGISTERED' || e.code === 'QUOTA_EXCEEDED') throw e; return; }
    // a route can pass a stop twice; take the first match
    const idx = items.findIndex((i) => s(i.arsId) === arsId);
    if (idx < 0) return;
    const it = items[idx];
    if (!stop.name) {
      stop.name = s(it.stNm); stop.stId = s(it.stId);
      const nx = items[idx + 1];
      if (nx) stop.direction = `${s(nx.stNm)} 방면`;
    }
    const row = routeArrivalRow(it);
    row.nextStop = items[idx + 1] ? s(items[idx + 1].stNm) : '';
    routes.push(row);
  }));
  routes.sort((a, b) => routeIds.indexOf(a.routeId) - routeIds.indexOf(b.routeId));
  return { stop: stop.name ? stop : null, routes, partial: true };
}

async function arrivals(env, q) {
  const arsId = s(q.get('arsId') || q.get('stopId'));
  if (!/^\d{5}$/.test(arsId)) throw new ApiError('BAD_REQUEST', 'arsId(5자리)가 필요해요', 400);
  const routeIds = s(q.get('routes')).split(',').map((x) => x.trim()).filter((x) => /^\d{6,12}$/.test(x)).slice(0, 8);
  if (q.get('mode') === 'routes' && routeIds.length) return arrivalsByRoutes(env, arsId, routeIds);
  let items;
  try {
    items = await cachedCall(env, 'stationinfo/getStationByUid', { arsId }, 15);
  } catch (e) {
    if (e.code === 'KEY_NOT_REGISTERED' && routeIds.length) {
      const r = await arrivalsByRoutes(env, arsId, routeIds);
      r.stationInfoUnavailable = true;
      return r;
    }
    throw e;
  }
  if (!items.length) return { stop: null, routes: [] };
  const first = items[0];
  const nxt = mostCommon(items.map((i) => s(i.nxtStn)));
  const stop = {
    id: arsId, arsId, stId: s(first.stId), name: s(first.stNm),
    direction: nxt && !/^\d+$/.test(nxt) ? `${nxt} 방면` : '',
  };
  const routes = items.map(routeArrivalRow);
  routes.sort((a, b) => a.number.localeCompare(b.number, 'ko', { numeric: true }));
  return { stop, routes };
}

async function searchStops(env, q) {
  const term = s(q.get('q'));
  if (!term) return [];
  if (/^\d{5}$/.test(term)) {
    const r = await arrivals(env, new URLSearchParams({ arsId: term }));
    return r.stop ? [{ ...r.stop, routes: r.routes.map((x) => x.number) }] : [];
  }
  const items = await cachedCall(env, 'stationinfo/getStationByName', { stSrch: term }, 86400);
  return items
    .filter((i) => /^\d{5}$/.test(s(i.arsId)))
    .slice(0, 40)
    .map((i) => ({ id: s(i.arsId), arsId: s(i.arsId), stId: s(i.stId), name: s(i.stNm), x: Number(i.tmX) || null, y: Number(i.tmY) || null }));
}

async function searchRoutes(env, q) {
  const term = s(q.get('q'));
  if (!term) return [];
  const items = await cachedCall(env, 'busRouteInfo/getBusRouteList', { strSrch: term }, 86400);
  return items.slice(0, 40).map((i) => ({
    routeId: s(i.busRouteId), number: s(i.busRouteNm), type: rtype(i.routeType),
    start: s(i.stStationNm), end: s(i.edStationNm),
  }));
}

async function routeInfo(env, routeId) {
  const items = await cachedCall(env, 'busRouteInfo/getRouteInfo', { busRouteId: routeId }, 86400);
  const i = items[0];
  if (!i) return null;
  return {
    routeId, number: s(i.busRouteNm), type: rtype(i.routeType),
    start: s(i.stStationNm), end: s(i.edStationNm),
    first: s(i.firstBusTm), last: s(i.lastBusTm), term: s(i.term),
  };
}

async function routeStops(env, q) {
  const routeId = s(q.get('routeId'));
  if (!/^\d{6,12}$/.test(routeId)) throw new ApiError('BAD_REQUEST', 'routeId가 필요해요', 400);
  const [route, items] = await Promise.all([
    routeInfo(env, routeId),
    cachedCall(env, 'busRouteInfo/getStaionByRoute', { busRouteId: routeId }, 86400),
  ]);
  const stops = items.map((i) => ({
    seq: Number(i.seq),
    stId: s(i.station),
    arsId: s(i.arsId) || s(i.stationNo),
    name: s(i.stationNm),
    turn: s(i.transYn) === 'Y',
    direction: s(i.direction),
  })).sort((a, b) => a.seq - b.seq);
  const r = route || (items[0] ? {
    routeId, number: s(items[0].busRouteNm), type: rtype(items[0].routeType),
    start: stops[0]?.name || '', end: '',
  } : null);
  const trn = items[0] ? s(items[0].trnstnid) : '';
  const turn = stops.find((x) => x.turn) || stops.find((x) => trn && x.stId === trn);
  if (r) r.turnSeq = turn ? turn.seq : null;
  return { route: r, stops };
}

async function positions(env, q) {
  const routeId = s(q.get('routeId'));
  if (!/^\d{6,12}$/.test(routeId)) throw new ApiError('BAD_REQUEST', 'routeId가 필요해요', 400);
  const items = await cachedCall(env, 'buspos/getBusPosByRtid', { busRouteId: routeId }, 12);
  return items.filter((i) => s(i.isrunyn) !== '0').map((i) => {
    const full = Number(i.fullSectDist) || 0;
    const d = Number(i.sectDist) || 0;
    const stopped = s(i.stopFlag) === '1';
    return {
      vehId: s(i.vehId),
      plate: plate4(i.plainNo),
      lowFloor: s(i.busType) === '1',
      congestion: congestion(i.congetion ?? i.congestion),
      seq: Number(i.sectOrd) || 0,
      lastStId: s(i.lastStnId),
      progress: stopped || !full ? 0 : Math.max(0, Math.min(0.95, d / full)),
      stopped,
      full: s(i.isFullFlag) === '1',
    };
  });
}

async function health(env) {
  const tests = {
    stationinfo: ['stationinfo/getStationByUid', { arsId: '02005' }],
    busRouteInfo: ['busRouteInfo/getBusRouteList', { strSrch: '402' }],
    arrive: ['arrive/getArrInfoByRouteAll', { busRouteId: '100100063' }],
    buspos: ['buspos/getBusPosByRtid', { busRouteId: '100100063' }],
  };
  const out = {};
  await Promise.all(Object.entries(tests).map(async ([k, [p, q]]) => {
    try { const items = await callSeoul(env, p, q); out[k] = { ok: true, count: items.length }; }
    catch (e) { out[k] = { ok: false, code: e.code, detail: e.detail }; }
  }));
  return out;
}

const ROUTES = {
  '/arrivals': { fn: arrivals, ttl: 15 },
  '/stops': { fn: searchStops, ttl: 86400 },
  '/routes': { fn: searchRoutes, ttl: 86400 },
  '/route-stops': { fn: routeStops, ttl: 86400 },
  '/positions': { fn: positions, ttl: 12 },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);

    if (url.pathname === '/' ) return json({ service: 'bus-proxy', ok: true }, 200, okOrigin ? origin : null);
    if (!okOrigin) return json({ error: { code: 'FORBIDDEN_ORIGIN', message: '허용되지 않은 요청이에요' } }, 403, null);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== 'GET') return json({ error: { code: 'METHOD', message: 'GET only' } }, 405, origin);

    if (env.LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return json({ error: { code: 'RATE_LIMITED', message: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요' } }, 429, origin);
    }

    if (url.pathname === '/debug' && env.DEBUG === '1') {
      const p = url.searchParams.get('path'); const q = Object.fromEntries([...url.searchParams].filter(([k]) => k !== 'path' && k !== 'fields'));
      try { const items = await callSeoul(env, p, q); const f = url.searchParams.get('fields'); return json({ count: items.length, items: f ? items.map((i) => Object.fromEntries(f.split(',').map((k) => [k, i[k]]))) : items.slice(0, 3) }, 200, origin); }
      catch (e) { return json({ error: e.code, detail: e.detail }, 200, origin); }
    }
    if (url.pathname === '/health') return json(await health(env), 200, origin);

    const r = ROUTES[url.pathname];
    if (!r) return json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404, origin);

    const params = new URLSearchParams([...url.searchParams].sort());
    const key = `${url.pathname}?${params}`;
    const now = Date.now();
    const hit = memCache.get(key);
    if (hit && hit.exp > now) return json(hit.body, 200, origin, Math.max(1, Math.round((hit.exp - now) / 1000)));

    try {
      const data = await r.fn(env, url.searchParams);
      const body = { data, fetchedAt: now };
      memCache.set(key, { exp: now + r.ttl * 1000, body });
      if (memCache.size > 500) memCache.delete(memCache.keys().next().value);
      return json(body, 200, origin, r.ttl);
    } catch (e) {
      if (e instanceof ApiError) {
        return json({ error: { code: e.code, message: e.message, detail: e.detail } }, e.status, origin);
      }
      return json({ error: { code: 'INTERNAL', message: '서버 오류', detail: String(e && e.message || e) } }, 500, origin);
    }
  },
};
