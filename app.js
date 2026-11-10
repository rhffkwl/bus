import {
  getArrivals, searchStops, getRouteStops, getBusPositions,
  getStop, DEFAULT_FAVORITES,
} from './api.js?v=1';

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
const LS_KEY = 'bus:favorites';

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
  bus: `<svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"><rect x="4" y="4" width="16" height="12" rx="2"/><path d="M4 11h16" stroke="#2b6de5" stroke-width="1.2"/><rect x="6.2" y="6.2" width="4.4" height="3.2" rx=".6" fill="#2b6de5"/><rect x="13.4" y="6.2" width="4.4" height="3.2" rx=".6" fill="#2b6de5"/><circle cx="7.5" cy="17.2" r="1.7"/><circle cx="16.5" cy="17.2" r="1.7"/></svg>`,
};

let favorites = loadFavs();
let editMode = false;
const cache = new Map(); // stopId -> { data, fetchedAt }
let tickTimer = null;
let searchTimer = 0;
let lastHash = '';

function loadFavs() {
  const v = LS.get(LS_KEY, null);
  if (Array.isArray(v) && v.length) {
    return v.map((x) => (typeof x === 'string' ? x : x.id)).filter(Boolean);
  }
  return DEFAULT_FAVORITES.slice();
}
function saveFavs() { LS.set(LS_KEY, favorites); }
function isFav(id) { return favorites.includes(id); }
function toggleFav(id) {
  if (!id) return;
  if (isFav(id)) favorites = favorites.filter((x) => x !== id);
  else favorites = [...favorites, id];
  saveFavs();
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const params = new URLSearchParams(qs || '');
  const p = path.split('/').filter(Boolean);
  if (p[0] === 'search') return { view: 'search', q: params.get('q') || '' };
  if (p[0] === 'stop' && p[1]) return { view: 'stop', stopId: decodeURIComponent(p[1]) };
  if (p[0] === 'route' && p[1]) {
    return { view: 'route', routeId: decodeURIComponent(p[1]), from: params.get('from') || '' };
  }
  return { view: 'home' };
}
function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

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

function etaHtml(arrivals, fetchedAt) {
  const slots = [arrivals[0], arrivals[1]];
  return `<div class="etas">${slots.map((a) => {
    if (!a) return `<div class="eta"></div>`;
    const f = formatEta(remaining(a.etaSec, fetchedAt));
    return `<div class="eta">
      <b class="${f.soon ? 'soon' : ''}">${f.text}</b>
      <span class="chip">${a.stationsAway}번째전 · <span class="c-${a.congestion}">${a.congestion}</span></span>
    </div>`;
  }).join('')}</div>`;
}

function routeRow(r, stopId, fetchedAt) {
  return `<li data-open-route="${r.routeId}" data-from="${stopId}">
    <span class="rno t-${r.type}">${r.number}</span>
    ${etaHtml(r.arrivals, fetchedAt)}
  </li>`;
}

async function loadArrivals(stopId, force = false) {
  const hit = cache.get(stopId);
  if (!force && hit && Date.now() - hit.fetchedAt < 15000) return hit;
  const data = await getArrivals(stopId);
  const rec = { data, fetchedAt: Date.now() };
  cache.set(stopId, rec);
  return rec;
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
  $$('[data-eta-stop]').forEach((el) => {
    const rec = cache.get(el.dataset.etaStop);
    if (!rec) return;
    $$('li[data-open-route]', el).forEach((li) => {
      const rid = li.dataset.openRoute;
      const r = rec.data.routes.find((x) => x.routeId === rid);
      if (!r) return;
      const box = li.querySelector('.etas');
      if (box) box.outerHTML = etaHtml(r.arrivals, rec.fetchedAt);
    });
  });
}

/* ---------- views ---------- */
async function renderHome() {
  document.body.classList.toggle('editing', editMode);
  const app = $('#app');
  app.innerHTML = `
    <header class="topbar">
      <h1>버스</h1>
      <button class="iconbtn" id="btnSearch" aria-label="정류장 검색">${ICO.search}</button>
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
      <br><button type="button" id="emptySearch">정류장 검색</button></div>`;
    $('#emptySearch').onclick = () => go('#/search');
    return;
  }

  const cards = await Promise.all(favorites.map(async (id) => {
    try {
      const rec = await loadArrivals(id);
      return { id, rec };
    } catch {
      return { id, rec: null };
    }
  }));

  list.innerHTML = cards.map(({ id, rec }) => {
    if (!rec?.data?.stop) {
      return `<article class="stop-card" data-id="${id}"><header class="card-head"><div class="names"><h3>정류장 ${id}</h3></div></header></article>`;
    }
    const s = rec.data.stop;
    const rows = rec.data.routes.map((r) => routeRow(r, id, rec.fetchedAt)).join('');
    return `<article class="stop-card" data-id="${id}" data-eta-stop="${id}">
      <header class="card-head" data-open-stop="${id}">
        <div class="names">
          <h3>${s.name}</h3>
          <p class="dir">${s.direction || ''}</p>
        </div>
        <div class="edit-tools">
          <button class="btn-del" data-del="${id}" aria-label="삭제">−</button>
          <button class="btn-handle" data-handle="${id}" aria-label="순서 변경">${ICO.handle}</button>
        </div>
      </header>
      <ul class="routes">${rows}</ul>
    </article>`;
  }).join('') + `<p class="hint">지금은 미리보기예요. 실제 도착 정보는 곧 연결할 수 있어요.</p>`;

  bindCardClicks(list);
  bindEdit(list);
}

function bindCardClicks(root) {
  root.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      favorites = favorites.filter((x) => x !== del.dataset.del);
      saveFavs();
      render();
      return;
    }
    if (editMode) return;
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
    if (!placed) {
      const hint = list.querySelector('.hint');
      if (hint) list.insertBefore(drag, hint);
      else list.appendChild(drag);
    }
  });
  const end = () => {
    if (!drag) return;
    drag.classList.remove('dragging');
    favorites = $$('.stop-card', list).map((c) => c.dataset.id);
    saveFavs();
    drag = null;
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
}

async function onRefresh() {
  const btn = $('#btnRefresh');
  btn?.classList.add('spin');
  cache.clear();
  await renderHome();
  startTick();
  setTimeout(() => $('#btnRefresh')?.classList.remove('spin'), 700);
}

async function renderSearch() {
  document.body.classList.remove('editing');
  const state = parseHash();
  $('#app').innerHTML = `
    <header class="topbar solid">
      <button class="iconbtn" id="btnBack" aria-label="뒤로">${ICO.back}</button>
      <form class="searchbox" id="searchForm" autocomplete="off">
        <input id="searchInput" type="search" placeholder="정류장 이름, 번호" value="${escapeAttr(state.q)}" enterkeyhint="search" aria-label="정류장 검색">
      </form>
    </header>
    <div id="searchResults"></div>`;
  $('#btnBack').onclick = () => history.length > 1 ? history.back() : go('#/');
  const input = $('#searchInput');
  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    input.blur();
    runSearch(input.value);
  });
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(input.value), 150);
  });
  setTimeout(() => input.focus(), 50);
  await runSearch(state.q);
}

async function runSearch(q) {
  const box = $('#searchResults');
  if (!box) return;
  const results = await searchStops(q);
  if (!results.length) {
    box.innerHTML = `<div class="empty">찾는 정류장이 없어요.</div>`;
    return;
  }
  box.innerHTML = results.map((s) => {
    const routes = (s.routes || []).join(', ');
    return `<div class="result" data-open-stop="${s.id}">
      <div class="names">
        <div class="name">${s.name}</div>
        <div class="meta">${s.arsId}${s.direction ? ' · ' + s.direction : ''}${routes ? ' · ' + routes : ''}</div>
      </div>
      <button class="star" data-star="${s.id}" aria-label="즐겨찾기" aria-pressed="${isFav(s.id)}">${isFav(s.id) ? ICO.star : ICO.starOff}</button>
    </div>`;
  }).join('');
  box.onclick = (e) => {
    const star = e.target.closest('[data-star]');
    if (star) {
      e.stopPropagation();
      const id = star.dataset.star;
      toggleFav(id);
      toast(isFav(id) ? '즐겨찾기에 넣었어요' : '즐겨찾기에서 뺐어요');
      runSearch($('#searchInput').value);
      return;
    }
    const row = e.target.closest('[data-open-stop]');
    if (row) go(`#/stop/${encodeURIComponent(row.dataset.openStop)}`);
  };
}

async function renderStop(stopId) {
  document.body.classList.remove('editing');
  const rec = await loadArrivals(stopId, false);
  const s = rec.data.stop;
  if (!s) {
    $('#app').innerHTML = `<header class="topbar solid"><button class="iconbtn" id="btnBack" aria-label="뒤로">${ICO.back}</button><h1>정류장</h1></header><div class="empty">정류장을 찾지 못했어요.</div>`;
    $('#btnBack').onclick = () => history.length > 1 ? history.back() : go('#/');
    return;
  }
  const fav = isFav(stopId);
  $('#app').innerHTML = `
    <header class="topbar solid">
      <button class="iconbtn" id="btnBack" aria-label="뒤로">${ICO.back}</button>
      <div class="title-wrap">
        <h1>${s.name}</h1>
      </div>
      <button class="iconbtn star" id="btnStar" aria-label="즐겨찾기" aria-pressed="${fav}">${fav ? ICO.star : ICO.starOff}</button>
    </header>
    <div class="detail-body" data-eta-stop="${stopId}">
      <div class="detail-dir">${s.direction || ''} · ${s.arsId}</div>
      <ul class="routes">${rec.data.routes.map((r) => routeRow(r, stopId, rec.fetchedAt)).join('')}</ul>
    </div>`;
  $('#btnBack').onclick = () => history.length > 1 ? history.back() : go('#/');
  $('#btnStar').onclick = () => {
    toggleFav(stopId);
    const on = isFav(stopId);
    $('#btnStar').setAttribute('aria-pressed', on);
    $('#btnStar').innerHTML = on ? ICO.star : ICO.starOff;
    toast(on ? '즐겨찾기에 넣었어요' : '즐겨찾기에서 뺐어요');
  };
  $('.detail-body').addEventListener('click', (e) => {
    const route = e.target.closest('[data-open-route]');
    if (route) go(`#/route/${encodeURIComponent(route.dataset.openRoute)}?from=${encodeURIComponent(route.dataset.from)}`);
  });
}

async function renderRoute(routeId, fromId) {
  document.body.classList.remove('editing');
  const [{ route, stops }, positions] = await Promise.all([
    getRouteStops(routeId),
    getBusPositions(routeId),
  ]);
  if (!route) {
    $('#app').innerHTML = `<header class="topbar solid"><button class="iconbtn" id="btnBack" aria-label="뒤로">${ICO.back}</button><h1>노선</h1></header><div class="empty">노선을 찾지 못했어요.</div>`;
    $('#btnBack').onclick = () => history.length > 1 ? history.back() : go('#/');
    return;
  }
  const favStop = fromId || '';
  const fav = favStop && isFav(favStop);
  const color = `var(--${route.type})`;
  $('#app').innerHTML = `
    <section class="route-view" style="--route-color:${color}">
      <header class="topbar solid">
        <button class="iconbtn" id="btnBack" aria-label="뒤로">${ICO.back}</button>
        <div class="title-wrap">
          <h1 class="rno t-${route.type}" style="font-size:26px">${route.number}</h1>
          <div class="sub">${route.start} ↔ ${route.end}</div>
        </div>
        <button class="iconbtn star" id="btnStar" aria-label="즐겨찾기" aria-pressed="${fav}" ${favStop ? '' : 'hidden'}>${fav ? ICO.star : ICO.starOff}</button>
      </header>
      <div class="route-map" id="routeMap">
        ${stops.map((s) => {
          const hl = fromId && s.id === fromId;
          const turn = route.turnStopId === s.id;
          return `<div class="stop-row${hl ? ' hl' : ''}" data-id="${s.id}">
            <div class="bus-col"></div>
            <div class="track"><span class="dot"></span></div>
            <div class="stop-info">
              <div class="sn">${s.name}${turn ? '<span class="pill-turn">회차</span>' : ''}</div>
              <div class="ars">${s.arsId}</div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </section>`;
  $('#btnBack').onclick = () => history.length > 1 ? history.back() : go('#/');
  if (favStop) {
    $('#btnStar').onclick = () => {
      toggleFav(favStop);
      const on = isFav(favStop);
      $('#btnStar').setAttribute('aria-pressed', on);
      $('#btnStar').innerHTML = on ? ICO.star : ICO.starOff;
      toast(on ? '즐겨찾기에 넣었어요' : '즐겨찾기에서 뺐어요');
    };
  }
  layoutBuses(positions, fromId);
}

function layoutBuses(positions, fromId) {
  const map = $('#routeMap');
  if (!map) return;
  $$('.bus-float', map).forEach((el) => el.remove());
  const rows = $$('.stop-row', map);
  const idIndex = new Map(rows.map((r, i) => [r.dataset.id, i]));
  const mapTop = map.getBoundingClientRect().top;
  const scroll = map.scrollTop;

  positions.forEach((b) => {
    const i = idIndex.get(b.stopId);
    if (i == null) return;
    const a = rows[i];
    const nxt = rows[i + 1] || a;
    const ar = a.getBoundingClientRect();
    const br = nxt.getBoundingClientRect();
    const aMid = ar.top + ar.height / 2;
    const bMid = br.top + br.height / 2;
    const y = aMid + (b.progress || 0) * (bMid - aMid);
    const top = y - mapTop + scroll;
    const track = a.querySelector('.track');
    const tr = track.getBoundingClientRect();
    const lineX = tr.left + tr.width / 2 - map.getBoundingClientRect().left;

    const el = document.createElement('div');
    el.className = 'bus-float';
    el.innerHTML = `<div class="bus-bubble"><span>${b.plate}</span> <span class="c-${b.congestion}">${b.congestion}</span>${b.lowFloor ? ' <span class="low">저상</span>' : ''}</div><div class="bus-ico">${ICO.bus}</div>`;
    map.appendChild(el);
    const bubbleW = el.querySelector('.bus-bubble').offsetWidth;
    const icoW = 22;
    const gap = 6;
    const total = bubbleW + gap + icoW;
    el.style.top = `${top}px`;
    el.style.left = `${lineX - total + icoW / 2}px`;
    el.style.transform = 'translateY(-50%)';
  });

  const hl = map.querySelector('.stop-row.hl');
  if (hl) hl.scrollIntoView({ block: 'center', inline: 'nearest' });
}

function escapeAttr(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function render() {
  const st = parseHash();
  lastHash = location.hash;
  if (st.view !== 'home') editMode = false;
  try {
    if (st.view === 'search') await renderSearch();
    else if (st.view === 'stop') await renderStop(st.stopId);
    else if (st.view === 'route') await renderRoute(st.routeId, st.from);
    else await renderHome();
  } catch (err) {
    console.error(err);
    toast('화면을 불러오지 못했어요');
  }
  startTick();
}

window.addEventListener('hashchange', render);
render();
