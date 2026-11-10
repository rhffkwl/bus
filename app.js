import {
  getArrivals, searchStops, searchRoutes, getRouteStops, getBusPositions,
  DEFAULT_FAVORITES, typeKey,
} from './api.js?v=3';

/* Block page pinch-zoom / double-tap zoom (iOS ignores user-scalable=no). */
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 350) {
    e.preventDefault();
    const t = e.target.closest('button, a, [role="button"]');
    if (t) t.click();
  }
  lastTouchEnd = now;
}, { passive: false });
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });


const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const LS_KEY = 'bus:favorites:v3';
const REFRESH_MS = 20000;
const FAIL_MSG = '실시간 정보를 불러오지 못했어요';

const LS = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  },
};

const ICO = {
  back: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-8 7 8 7"/></svg>`,
  search: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>`,
  star: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 3.6l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16l-4.8 2.5.9-5.4L4.2 9.3l5.4-.8z"/></svg>`,
  starOff: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.6l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16l-4.8 2.5.9-5.4L4.2 9.3l5.4-.8z"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.2-5.5"/><path d="M20 4v5h-5"/></svg>`,
  handle: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="8" cy="7" r="1.5"/><circle cx="16" cy="7" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="17" r="1.5"/><circle cx="16" cy="17" r="1.5"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  check: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  bus: `<svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"><rect x="4" y="4" width="16" height="12" rx="2"/><path d="M4 11h16" stroke="currentColor" stroke-width="1.2"/><rect x="6.2" y="6.2" width="4.4" height="3.2" rx=".6" fill="currentColor"/><rect x="13.4" y="6.2" width="4.4" height="3.2" rx=".6" fill="currentColor"/><circle cx="7.5" cy="17.2" r="1.7"/><circle cx="16.5" cy="17.2" r="1.7"/></svg>`,
};

let favorites = loadFavs();
let editMode = false;
const cache = new Map(); // key -> { data, fetchedAt }
let tickTimer = null;
let refreshTimer = null;
let searchTimer = 0;
let searchSeq = 0;
let routeState = null; // { routeId, from, stops, route }

/* ---------- favorites: [{ arsId, name, direction, routes:[{id,number,type}] }] ---------- */
function loadFavs() {
  const v = LS.get(LS_KEY, null);
  if (Array.isArray(v)) {
    return v.filter((x) => x && /^\d{5}$/.test(x.arsId))
      .map((x) => ({ ...x, routes: Array.isArray(x.routes) ? x.routes : [] }));
  }
  return JSON.parse(JSON.stringify(DEFAULT_FAVORITES));
}
function saveFavs() { LS.set(LS_KEY, favorites); }
function favOf(arsId) { return favorites.find((f) => f.arsId === arsId); }
function isFav(arsId) { return !!favOf(arsId); }
function addFav(stop) {
  if (!stop || isFav(stop.arsId)) return;
  favorites = [...favorites, { arsId: stop.arsId, name: stop.name || '', direction: stop.direction || '', routes: [] }];
  saveFavs();
}
function removeFav(arsId) { favorites = favorites.filter((f) => f.arsId !== arsId); saveFavs(); }
function toggleFav(stop) { if (isFav(stop.arsId)) removeFav(stop.arsId); else addFav(stop); }
function favHasRoute(arsId, routeId) { return !!favOf(arsId)?.routes.some((r) => r.id === routeId); }
function toggleFavRoute(stop, r) {
  if (!isFav(stop.arsId)) addFav(stop);
  const f = favOf(stop.arsId);
  if (f.routes.some((x) => x.id === r.routeId)) f.routes = f.routes.filter((x) => x.id !== r.routeId);
  else f.routes = [...f.routes, { id: r.routeId, number: r.number, type: r.type }];
  if (!f.name && stop.name) f.name = stop.name;
  if (!f.direction && stop.direction) f.direction = stop.direction;
  saveFavs();
  return f.routes.some((x) => x.id === r.routeId);
}

/* ---------- routing ---------- */
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const params = new URLSearchParams(qs || '');
  const p = path.split('/').filter(Boolean);
  if (p[0] === 'search') return { view: 'search', q: params.get('q') || '' };
  if (p[0] === 'stop' && p[1]) return { view: 'stop', stopId: decodeURIComponent(p[1]), route: params.get('route') || '' };
  if (p[0] === 'route' && p[1]) {
    return { view: 'route', routeId: decodeURIComponent(p[1]), from: params.get('from') || '' };
  }
  return { view: 'home' };
}
function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}
function back() { if (history.length > 1) history.back(); else go('#/'); }

/* ---------- eta formatting ---------- */
function formatEta(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s <= 30) return { text: '곧 도착', soon: true };
  if (s < 60) return { text: `${s}초`, soon: false };
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (s < 300) return { text: `${m}분 ${String(r).padStart(2, '0')}초`, soon: false };
  return { text: `${m}분`, soon: false };
}
function remaining(etaSec, fetchedAt) {
  return Math.max(0, Math.round(etaSec - (Date.now() - fetchedAt) / 1000));
}
function chipHtml(a) {
  const parts = [];
  if (a.stationsAway) parts.push(`${a.stationsAway}번째전`);
  if (a.congestion) parts.push(`<span class="c-${a.congestion}">${a.congestion}</span>`);
  if (a.last) parts.push('<span class="c-last">막차</span>');
  return parts.join(' · ');
}
function etaHtml(arrivals, fetchedAt) {
  const slots = [arrivals?.[0], arrivals?.[1]];
  return `<div class="etas">${slots.map((a, i) => {
    if (!a) return i === 0 ? `<div class="eta"><b class="muted">정보 없음</b></div>` : `<div class="eta"></div>`;
    if (a.etaSec == null) {
      if (i === 1 && slots[0] && slots[0].etaSec == null && a.status === slots[0].status) return `<div class="eta"></div>`;
      return `<div class="eta"><b class="muted">${esc(a.status || '정보 없음')}</b></div>`;
    }
    const f = formatEta(remaining(a.etaSec, fetchedAt));
    return `<div class="eta">
      <b class="${f.soon ? 'soon' : ''}">${f.text}</b>
      <span class="chip">${chipHtml(a)}</span>
    </div>`;
  }).join('')}</div>`;
}
function routeRow(r, stopId, fetchedAt, opts = {}) {
  const t = typeKey(r.type);
  const pick = opts.pick
    ? `<button class="btn-pick" data-pick="${r.routeId}" aria-pressed="${favHasRoute(stopId, r.routeId)}" aria-label="즐겨찾기에 버스 추가">${favHasRoute(stopId, r.routeId) ? ICO.check : ICO.plus}</button>`
    : '';
  return `<li data-open-route="${r.routeId}" data-from="${stopId}">
    <span class="rno t-${t}${r.number.length > 4 ? ' long' : ''}">${esc(r.number)}</span>
    ${etaHtml(r.arrivals, fetchedAt)}
    ${pick}
  </li>`;
}
function errorText(err) {
  if (err?.code === 'KEY_NOT_REGISTERED') return `${FAIL_MSG}<small>인증키 승인 반영을 기다리는 중이에요</small>`;
  if (err?.code === 'QUOTA_EXCEEDED') return `${FAIL_MSG}<small>오늘 조회 한도를 다 썼어요</small>`;
  if (err?.code === 'RATE_LIMITED') return `${FAIL_MSG}<small>잠시 후 다시 시도해 주세요</small>`;
  return FAIL_MSG;
}

async function cached(key, ttl, force, fn) {
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.fetchedAt < ttl) return hit;
  const data = await fn();
  const rec = { data, fetchedAt: Date.now() };
  cache.set(key, rec);
  return rec;
}
function loadFavArrivals(f, force = false) {
  const ids = f.routes.map((r) => r.id);
  return cached(`fav:${f.arsId}:${ids.join(',')}`, 15000, force,
    () => getArrivals(f.arsId, { routeIds: ids, onlyRoutes: ids.length > 0 }));
}
function loadStopArrivals(arsId, extraRoutes, force = false) {
  const ids = [...new Set([...(favOf(arsId)?.routes.map((r) => r.id) || []), ...extraRoutes])];
  return cached(`stop:${arsId}:${ids.join(',')}`, 15000, force, () => getArrivals(arsId, { routeIds: ids }));
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 1600);
}

function startTick() {
  clearInterval(tickTimer);
  tickTimer = setInterval(updateEtas, 1000);
}
function updateEtas() {
  $$('[data-eta-key]').forEach((el) => {
    const rec = cache.get(el.dataset.etaKey);
    if (!rec) return;
    $$('li[data-open-route]', el).forEach((li) => {
      const r = rec.data.routes.find((x) => x.routeId === li.dataset.openRoute);
      if (!r) return;
      const box = li.querySelector('.etas');
      if (box) box.outerHTML = etaHtml(r.arrivals, rec.fetchedAt);
    });
  });
}

/* auto refresh while visible */
function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') softRefresh();
  }, REFRESH_MS);
}
async function softRefresh() {
  const st = parseHash();
  try {
    if (st.view === 'home' && !editMode) await fillHome(true);
    else if (st.view === 'stop') await fillStop(st.stopId, st.route, true);
    else if (st.view === 'route') await refreshPositions();
  } catch (e) { console.warn(e); }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') softRefresh();
});

/* ---------- views ---------- */
function cardHtml(f, rec, err) {
  const fav = f;
  const s = rec?.data?.stop;
  const name = fav.name || s?.name || `정류장 ${fav.arsId}`;
  const dir = fav.direction || s?.direction || '';
  let rows;
  if (err || !rec) {
    rows = `<div class="card-err">${errorText(err)}</div>`;
  } else {
    let list = rec.data.routes;
    if (fav.routes.length) {
      list = fav.routes.map((fr) => list.find((x) => x.routeId === fr.id)
        || { routeId: fr.id, number: fr.number, type: fr.type, arrivals: [] });
    }
    rows = list.length
      ? `<ul class="routes">${list.map((r) => routeRow(r, fav.arsId, rec.fetchedAt)).join('')}</ul>`
      : `<div class="card-err">도착 예정 버스가 없어요</div>`;
  }
  const key = rec ? `fav:${fav.arsId}:${fav.routes.map((r) => r.id).join(',')}` : '';
  return `<article class="stop-card" data-id="${fav.arsId}" ${key ? `data-eta-key="${key}"` : ''}>
      <header class="card-head" data-open-stop="${fav.arsId}">
        <div class="names">
          <h3>${esc(name)}</h3>
          <p class="dir">${esc(dir)}${dir ? ' · ' : ''}${fav.arsId}</p>
        </div>
        <div class="edit-tools">
          <button class="btn-del" data-del="${fav.arsId}" aria-label="삭제">−</button>
          <button class="btn-handle" data-handle="${fav.arsId}" aria-label="순서 변경">${ICO.handle}</button>
        </div>
      </header>
      ${rows}
      <button class="add-bus" data-add-bus="${fav.arsId}">${ICO.plus}<span>버스 추가</span></button>
    </article>`;
}

async function renderHome() {
  document.body.classList.toggle('editing', editMode);
  const app = $('#app');
  app.innerHTML = `
    <header class="topbar">
      <h1>버스</h1>
      <button class="iconbtn" id="btnSearch" aria-label="검색">${ICO.search}</button>
    </header>
    <div class="sec-head">
      <h2>즐겨찾기</h2>
      <button class="linkbtn" id="btnEdit">${editMode ? '완료' : '편집'}</button>
    </div>
    <main class="home" id="favList"></main>
    <button id="btnRefresh" aria-label="새로고침" ${editMode ? 'hidden' : ''}>${ICO.refresh}</button>`;

  $('#btnSearch').onclick = () => go('#/search');
  $('#btnEdit').onclick = () => { editMode = !editMode; render(); };
  $('#btnRefresh')?.addEventListener('click', onRefresh);

  const list = $('#favList');
  if (!favorites.length) {
    list.innerHTML = `<div class="empty">즐겨찾는 정류장이 없어요.<br>검색에서 별을 눌러 추가해 보세요.
      <br><button type="button" id="emptySearch">검색</button></div>`;
    $('#emptySearch').onclick = () => go('#/search');
    return;
  }
  list.innerHTML = favorites.map((f) => `<article class="stop-card skeleton" data-id="${f.arsId}">
    <header class="card-head"><div class="names"><h3>${esc(f.name || f.arsId)}</h3><p class="dir">${esc(f.direction || '')}</p></div></header>
    <div class="card-err">불러오는 중…</div></article>`).join('');
  bindCardClicks(list);
  bindEdit(list);
  await fillHome(false);
}

async function fillHome(force) {
  const list = $('#favList');
  if (!list || !favorites.length) return;
  const cards = await Promise.all(favorites.map(async (f) => {
    try { return { f, rec: await loadFavArrivals(f, force) }; }
    catch (err) { return { f, err }; }
  }));
  if (!$('#favList') || parseHash().view !== 'home') return;
  // remember names we learned from the API
  let changed = false;
  for (const { f, rec } of cards) {
    const s = rec?.data?.stop;
    if (s && !f.name) { f.name = s.name; changed = true; }
    if (s && !f.direction && s.direction) { f.direction = s.direction; changed = true; }
  }
  if (changed) saveFavs();
  list.innerHTML = cards.map(({ f, rec, err }) => cardHtml(f, rec, err)).join('');
}

function bindCardClicks(root) {
  root.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      removeFav(del.dataset.del);
      render();
      return;
    }
    if (editMode) return;
    const add = e.target.closest('[data-add-bus]');
    if (add) { go(`#/stop/${encodeURIComponent(add.dataset.addBus)}`); return; }
    const route = e.target.closest('[data-open-route]');
    if (route) {
      go(`#/route/${encodeURIComponent(route.dataset.openRoute)}?from=${encodeURIComponent(route.dataset.from)}`);
      return;
    }
    const stop = e.target.closest('[data-open-stop]');
    if (stop) go(`#/stop/${encodeURIComponent(stop.dataset.openStop)}`);
  });
}

function bindEdit(list) {
  let drag = null;
  list.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('[data-handle]');
    if (!h) return;
    e.preventDefault();
    drag = h.closest('.stop-card');
    drag.classList.add('dragging');
    h.setPointerCapture(e.pointerId);
  });
  list.addEventListener('pointermove', (e) => {
    if (!drag) return;
    e.preventDefault();
    const cards = $$('.stop-card', list).filter((c) => c !== drag);
    const y = e.clientY;
    let placed = false;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        list.insertBefore(drag, c);
        placed = true;
        break;
      }
    }
    if (!placed) list.appendChild(drag);
  });
  const end = () => {
    if (!drag) return;
    drag.classList.remove('dragging');
    const order = $$('.stop-card', list).map((c) => c.dataset.id);
    favorites = order.map((id) => favOf(id)).filter(Boolean);
    saveFavs();
    drag = null;
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
}

async function onRefresh() {
  const btn = $('#btnRefresh');
  btn?.classList.add('spin');
  await fillHome(true);
  setTimeout(() => $('#btnRefresh')?.classList.remove('spin'), 700);
}

/* ---------- search: 정류장 + 노선 ---------- */
async function renderSearch() {
  document.body.classList.remove('editing');
  const state = parseHash();
  $('#app').innerHTML = `
    <header class="topbar solid">
      <button class="iconbtn" id="btnBack" aria-label="뒤로">${ICO.back}</button>
      <form class="searchbox" id="searchForm" autocomplete="off">
        <input id="searchInput" type="search" placeholder="정류장 이름·번호, 버스 번호" value="${esc(state.q)}" enterkeyhint="search" aria-label="검색">
      </form>
    </header>
    <div id="searchResults"></div>`;
  $('#btnBack').onclick = back;
  const input = $('#searchInput');
  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    input.blur();
    runSearch(input.value);
  });
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(input.value), 350);
  });
  setTimeout(() => input.focus(), 50);
  await runSearch(state.q);
}

async function runSearch(q) {
  const box = $('#searchResults');
  if (!box) return;
  const term = (q || '').trim();
  history.replaceState(null, '', `#/search${term ? `?q=${encodeURIComponent(term)}` : ''}`);
  if (!term) {
    box.innerHTML = `<div class="empty">정류장 이름이나 번호(5자리),<br>버스 번호로 찾아보세요.</div>`;
    return;
  }
  const seq = ++searchSeq;
  box.innerHTML = `<div class="empty">찾는 중…</div>`;
  const wantRoutes = !/^\d{5}$/.test(term);
  const [stopsR, routesR] = await Promise.allSettled([
    searchStops(term),
    wantRoutes ? searchRoutes(term) : Promise.resolve([]),
  ]);
  if (seq !== searchSeq || !$('#searchResults')) return;
  const stops = stopsR.status === 'fulfilled' ? stopsR.value : [];
  const routes = routesR.status === 'fulfilled' ? routesR.value : [];
  let html = '';
  if (routes.length) {
    html += `<div class="res-head">버스</div>` + routes.slice(0, 15).map((r) => `<div class="result" data-open-route="${r.routeId}">
      <span class="rno sm t-${typeKey(r.type)}">${esc(r.number)}</span>
      <div class="names"><div class="meta">${esc(r.start)} ↔ ${esc(r.end)} · ${esc(r.type)}</div></div>
    </div>`).join('');
  }
  if (stops.length) {
    html += `<div class="res-head">정류장</div>` + stops.map((s) => `<div class="result" data-open-stop="${s.arsId}">
      <div class="names">
        <div class="name">${esc(s.name)}</div>
        <div class="meta">${s.arsId}${s.direction ? ' · ' + esc(s.direction) : ''}</div>
      </div>
      <button class="star" data-star="${s.arsId}" data-name="${esc(s.name)}" aria-label="즐겨찾기" aria-pressed="${isFav(s.arsId)}">${isFav(s.arsId) ? ICO.star : ICO.starOff}</button>
    </div>`).join('');
  }
  if (stopsR.status === 'rejected' && stopsR.reason?.code === 'KEY_NOT_REGISTERED') {
    html += `<p class="note">정류장 검색은 공공데이터포털에서 ‘서울특별시_정류소정보조회 서비스’를 신청하면 쓸 수 있어요. 지금은 버스 번호로 찾은 뒤 노선도에서 정류장을 눌러 주세요.</p>`;
  } else if (!html && (stopsR.status === 'rejected' || routesR.status === 'rejected')) {
    html = `<div class="empty">${FAIL_MSG}</div>`;
  }
  box.innerHTML = html || `<div class="empty">검색 결과가 없어요.</div>`;
  box.onclick = (e) => {
    const star = e.target.closest('[data-star]');
    if (star) {
      e.stopPropagation();
      const id = star.dataset.star;
      toggleFav({ arsId: id, name: star.dataset.name });
      toast(isFav(id) ? '즐겨찾기에 넣었어요' : '즐겨찾기에서 뺐어요');
      star.setAttribute('aria-pressed', isFav(id));
      star.innerHTML = isFav(id) ? ICO.star : ICO.starOff;
      return;
    }
    const route = e.target.closest('[data-open-route]');
    if (route) { go(`#/route/${encodeURIComponent(route.dataset.openRoute)}`); return; }
    const row = e.target.closest('[data-open-stop]');
    if (row) go(`#/stop/${encodeURIComponent(row.dataset.openStop)}`);
  };
}

/* ---------- stop detail (+ 버스 추가) ---------- */
async function renderStop(stopId, hintRoute) {
  document.body.classList.remove('editing');
  const f = favOf(stopId);
  const fav = !!f;
  $('#app').innerHTML = `
    <header class="topbar solid">
      <button class="iconbtn" id="btnBack" aria-label="뒤로">${ICO.back}</button>
      <div class="title-wrap"><h1 id="stopTitle">${esc(f?.name || '정류장')}</h1></div>
      <button class="iconbtn star" id="btnStar" aria-label="즐겨찾기" aria-pressed="${fav}">${fav ? ICO.star : ICO.starOff}</button>
    </header>
    <div class="detail-body" id="stopBody"><div class="empty">불러오는 중…</div></div>`;
  $('#btnBack').onclick = back;
  $('#btnStar').onclick = () => {
    const rec = currentStopRec;
    const s = rec?.data?.stop || { arsId: stopId };
    toggleFav({ ...s, arsId: stopId, name: favOf(stopId)?.name || s.name });
    const on = isFav(stopId);
    $('#btnStar').setAttribute('aria-pressed', on);
    $('#btnStar').innerHTML = on ? ICO.star : ICO.starOff;
    toast(on ? '즐겨찾기에 넣었어요' : '즐겨찾기에서 뺐어요');
    fillStop(stopId, hintRoute, false);
  };
  $('#stopBody').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      e.stopPropagation();
      const rec = currentStopRec;
      const r = rec?.data?.routes.find((x) => x.routeId === pick.dataset.pick);
      if (!r) return;
      const s = rec.data.stop || { arsId: stopId };
      const on = toggleFavRoute({ ...s, arsId: stopId, name: favOf(stopId)?.name || s.name }, r);
      pick.setAttribute('aria-pressed', on);
      pick.innerHTML = on ? ICO.check : ICO.plus;
      $('#btnStar').setAttribute('aria-pressed', isFav(stopId));
      $('#btnStar').innerHTML = isFav(stopId) ? ICO.star : ICO.starOff;
      toast(on ? `${r.number}번을 즐겨찾기에 넣었어요` : `${r.number}번을 뺐어요`);
      return;
    }
    const route = e.target.closest('[data-open-route]');
    if (route) go(`#/route/${encodeURIComponent(route.dataset.openRoute)}?from=${encodeURIComponent(route.dataset.from)}`);
  });
  await fillStop(stopId, hintRoute, false);
}
let currentStopRec = null;

async function fillStop(stopId, hintRoute, force) {
  const body = $('#stopBody');
  if (!body) return;
  let rec;
  try {
    rec = await loadStopArrivals(stopId, hintRoute ? [hintRoute] : [], force);
  } catch (err) {
    if (!$('#stopBody')) return;
    body.innerHTML = `<div class="empty card-err">${errorText(err)}</div>`;
    return;
  }
  if (!$('#stopBody') || parseHash().view !== 'stop') return;
  currentStopRec = rec;
  const s = rec.data.stop;
  const f = favOf(stopId);
  if (!s) {
    body.innerHTML = `<div class="empty">${rec.data.stationInfoUnavailable ? '이 정류장 정보를 불러오려면 정류소정보조회 서비스 신청이 필요해요.' : '정류장을 찾지 못했어요.'}</div>`;
    return;
  }
  $('#stopTitle').textContent = f?.name || s.name;
  const key = `stop:${stopId}:${[...new Set([...(f?.routes.map((r) => r.id) || []), ...(hintRoute ? [hintRoute] : [])])].join(',')}`;
  body.dataset.etaKey = key;
  const pickNote = f?.routes.length
    ? '홈에는 ✓ 표시한 버스만 보여요.'
    : '＋를 눌러 홈에 보일 버스를 골라요. 고르지 않으면 모든 버스가 보여요.';
  body.innerHTML = `
    <div class="detail-dir">${esc(f?.direction || s.direction || '')}${(f?.direction || s.direction) ? ' · ' : ''}${s.arsId}</div>
    <div class="pick-note">${pickNote}</div>
    <ul class="routes">${rec.data.routes.map((r) => routeRow(r, stopId, rec.fetchedAt, { pick: true })).join('')}</ul>
    ${rec.data.stationInfoUnavailable ? `<p class="note">이 정류장의 모든 버스를 보려면 공공데이터포털에서 ‘서울특별시_정류소정보조회 서비스’를 신청해 주세요. 지금은 즐겨찾기한 버스만 보여요.</p>` : ''}`;
}

/* ---------- route map ---------- */
async function renderRoute(routeId, fromId) {
  document.body.classList.remove('editing');
  $('#app').innerHTML = `<header class="topbar solid"><button class="iconbtn" id="btnBack" aria-label="뒤로">${ICO.back}</button><h1>노선</h1></header><div class="empty">불러오는 중…</div>`;
  $('#btnBack').onclick = back;
  let data, positions = [];
  try {
    const [rs, ps] = await Promise.allSettled([getRouteStops(routeId), getBusPositions(routeId)]);
    if (rs.status === 'rejected') throw rs.reason;
    data = rs.value;
    positions = ps.status === 'fulfilled' ? ps.value : null;
  } catch (err) {
    if (parseHash().view !== 'route') return;
    $('#app').innerHTML = `<header class="topbar solid"><button class="iconbtn" id="btnBack" aria-label="뒤로">${ICO.back}</button><h1>노선</h1></header><div class="empty card-err">${errorText(err)}</div>`;
    $('#btnBack').onclick = back;
    return;
  }
  if (parseHash().view !== 'route') return;
  const { route, stops } = data;
  if (!route) {
    $('#app').innerHTML = `<header class="topbar solid"><button class="iconbtn" id="btnBack" aria-label="뒤로">${ICO.back}</button><h1>노선</h1></header><div class="empty">노선을 찾지 못했어요.</div>`;
    $('#btnBack').onclick = back;
    return;
  }
  const t = typeKey(route.type);
  const hlSeq = fromId ? (stops.find((s) => s.arsId === fromId)?.seq ?? null) : null;
  routeState = { routeId, fromId, stops, route };
  $('#app').innerHTML = `
    <section class="route-view" style="--bus-color:var(--${t})">
      <header class="topbar solid">
        <button class="iconbtn" id="btnBack" aria-label="뒤로">${ICO.back}</button>
        <div class="title-wrap">
          <h1 class="rno t-${t}" style="font-size:26px;width:auto">${esc(route.number)}</h1>
          <div class="sub">${esc(route.start)} ↔ ${esc(route.end)}${route.term ? ` · 배차 ${route.term}분` : ''}</div>
        </div>
        <button class="iconbtn" id="btnRouteRefresh" aria-label="새로고침">${ICO.refresh}</button>
      </header>
      <div class="route-map" id="routeMap">
        ${stops.map((s) => {
          const hl = hlSeq != null && s.seq === hlSeq;
          const turn = route.turnSeq === s.seq;
          const ars = /^\d{5}$/.test(s.arsId) ? s.arsId : '';
          return `<div class="stop-row${hl ? ' hl' : ''}${turn ? ' turn' : ''}" data-seq="${s.seq}" data-st="${s.stId}" ${ars ? `data-open-stop="${ars}"` : ''}>
            <div class="bus-col"></div>
            <div class="track"><span class="dot"></span></div>
            <div class="stop-info">
              <div class="sn">${esc(s.name)}${turn ? '<span class="pill-turn">회차</span>' : ''}</div>
              <div class="ars">${ars || '미정차'}</div>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="route-err" id="routeErr" ${positions ? 'hidden' : ''}>${FAIL_MSG}</div>
    </section>`;
  $('#btnBack').onclick = back;
  $('#btnRouteRefresh').onclick = async () => {
    $('#btnRouteRefresh').classList.add('spin');
    await refreshPositions();
    setTimeout(() => $('#btnRouteRefresh')?.classList.remove('spin'), 700);
  };
  $('#routeMap').addEventListener('click', (e) => {
    const row = e.target.closest('[data-open-stop]');
    if (row) go(`#/stop/${encodeURIComponent(row.dataset.openStop)}?route=${encodeURIComponent(routeId)}`);
  });
  layoutBuses(positions || [], true);
}

async function refreshPositions() {
  if (!routeState || !$('#routeMap')) return;
  try {
    const ps = await getBusPositions(routeState.routeId);
    if (!$('#routeMap')) return;
    $('#routeErr').hidden = true;
    layoutBuses(ps, false);
  } catch {
    const el = $('#routeErr');
    if (el) el.hidden = false;
  }
}

function layoutBuses(positions, scrollToHl) {
  const map = $('#routeMap');
  if (!map) return;
  $$('.bus-float', map).forEach((el) => el.remove());
  const rows = $$('.stop-row', map);
  const seqIndex = new Map(rows.map((r, i) => [Number(r.dataset.seq), i]));
  const mapRect = map.getBoundingClientRect();
  const scroll = map.scrollTop;

  positions.forEach((b) => {
    let i = seqIndex.get(b.seq);
    // trust lastStId if the seq does not line up
    if (b.lastStId && (i == null || rows[i].dataset.st !== b.lastStId)) {
      let best = null;
      rows.forEach((r, j) => {
        if (r.dataset.st === b.lastStId && (best == null || Math.abs(j - (i ?? j)) < Math.abs(best - (i ?? best)))) best = j;
      });
      if (best != null) i = best;
    }
    if (i == null) return;
    const a = rows[i];
    const nxt = rows[i + 1] || a;
    const ar = a.getBoundingClientRect();
    const br = nxt.getBoundingClientRect();
    const aMid = ar.top + ar.height / 2;
    const bMid = br.top + br.height / 2;
    const y = aMid + (b.progress || 0) * (bMid - aMid);
    const top = y - mapRect.top + scroll;
    const tr = a.querySelector('.track').getBoundingClientRect();
    const lineX = tr.left + tr.width / 2 - mapRect.left;

    const el = document.createElement('div');
    el.className = 'bus-float';
    el.innerHTML = `<div class="bus-bubble"><span>${esc(b.plate)}</span>${b.congestion ? ` <span class="c-${b.congestion}">${b.congestion}</span>` : ''}${b.lowFloor ? ' <span class="low">저상</span>' : ''}</div><div class="bus-ico">${ICO.bus}</div>`;
    map.appendChild(el);
    const bubbleW = el.querySelector('.bus-bubble').offsetWidth;
    const icoW = 22;
    const gap = 6;
    const total = bubbleW + gap + icoW;
    el.style.top = `${top}px`;
    el.style.left = `${lineX - total + icoW / 2}px`;
    el.style.transform = 'translateY(-50%)';
  });

  if (scrollToHl) {
    const hl = map.querySelector('.stop-row.hl');
    if (hl) hl.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function render() {
  const st = parseHash();
  if (st.view !== 'home') editMode = false;
  if (st.view !== 'route') routeState = null;
  try {
    if (st.view === 'search') await renderSearch();
    else if (st.view === 'stop') await renderStop(st.stopId, st.route);
    else if (st.view === 'route') await renderRoute(st.routeId, st.from);
    else await renderHome();
  } catch (err) {
    console.error(err);
    toast('화면을 불러오지 못했어요');
  }
  startTick();
  scheduleRefresh();
}

window.addEventListener('hashchange', render);
render();
