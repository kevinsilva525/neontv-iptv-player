(() => {
const $ = id => document.getElementById(id);
const state = { items: [], tab: 'live', group: 'Todos', q: '', limit: 120, current: null, list: [], hls: null, ts: null, timer: 0,
  favs: new Set(JSON.parse(localStorage.getItem('ntv_favs') || '[]')) };

// ---------- Parser M3U ----------
function parseM3U(text) {
  const out = []; let meta = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const attr = k => (line.match(new RegExp(k + '="([^"]*)"', 'i')) || [])[1] || '';
      meta = { name: line.slice(line.lastIndexOf(',') + 1).trim() || attr('tvg-name'),
        logo: attr('tvg-logo'), group: attr('group-title') || 'Sem categoria', id: attr('tvg-id') };
    } else if (!line.startsWith('#') && meta) {
      meta.url = line; meta.type = classify(meta);
      if (meta.type === 'series') Object.assign(meta, parseEpisode(meta.name));
      meta.key = meta.url; out.push(meta); meta = null;
    }
  }
  return out;
}
function classify(m) {
  const u = m.url.toLowerCase(), g = m.group.toLowerCase();
  if (/\/series\//.test(u) || /s\d{1,2}\s?e\d{1,3}/i.test(m.name) || /\b(s[eé]ries?|temporada|novelas?|doramas?|animes?)\b/.test(g)) return 'series';
  if (/\/movie\//.test(u) || /\b(filmes?|movies?|vod|cinema|lan[cç]amentos?|4k movies)\b/.test(g) || /\.(mp4|mkv|avi)(\?|$)/.test(u)) return 'movie';
  return 'live';
}
function parseEpisode(name) {
  const m = name.match(/^(.*?)[\s\-–_.]*[\[(]?\s*S(\d{1,2})\s?E(\d{1,3})/i);
  if (m) return { show: m[1].replace(/[-–_.\s]+$/, '').trim() || name, season: +m[2], ep: +m[3] };
  const m2 = name.match(/^(.*?)\s*(\d{1,2})x(\d{1,3})/i);
  if (m2) return { show: m2[1].trim(), season: +m2[2], ep: +m2[3] };
  return { show: name, season: 1, ep: 0 };
}

// ---------- Armazenamento (IndexedDB: aguenta playlists grandes) ----------
const idb = {
  open: () => new Promise((res, rej) => { const r = indexedDB.open('neontv', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
  async get(k) { const db = await this.open(); return new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); },
  async set(k, v) { const db = await this.open(); return new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(true); t.onerror = () => res(false); }); }
};

// ---------- Carregamento ----------
async function load() {
  const st = $('status'); st.textContent = 'Carregando...';
  try {
    let text = $('paste').value.trim();
    const f = $('file').files[0];
    if (f) text = await f.text();
    else if (!text && $('url').value.trim()) {
      const r = await fetch($('url').value.trim()); if (!r.ok) throw new Error('HTTP ' + r.status);
      text = await r.text();
    }
    if (!text.includes('#EXTINF')) throw new Error('Playlist inválida ou vazia');
    state.items = parseM3U(text);
    localStorage.setItem('ntv_url', $('url').value.trim());
    await idb.set('pl', text);
    $('dlg').close(); state.group = 'Todos'; render();
  } catch (e) { st.textContent = 'Erro: ' + e.message + ' (se for CORS, envie o arquivo local)'; }
}

// ---------- Render ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function visibleItems() {
  const q = state.q.toLowerCase();
  let arr = state.tab === 'fav' ? state.items.filter(i => state.favs.has(i.key)) : state.items.filter(i => i.type === state.tab);
  if (state.group !== 'Todos') arr = arr.filter(i => i.group === state.group);
  if (q) arr = arr.filter(i => i.name.toLowerCase().includes(q) || (i.show || '').toLowerCase().includes(q));
  return arr;
}
function render() {
  const has = state.items.length > 0;
  $('empty').hidden = has;
  const cnt = t => state.items.filter(i => i.type === t).length;
  $('cLive').textContent = cnt('live'); $('cMovie').textContent = cnt('movie');
  $('cSeries').textContent = new Set(state.items.filter(i => i.type === 'series').map(i => i.show)).size;
  $('cFav').textContent = state.favs.size;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  // categorias
  const base = state.tab === 'fav' ? state.items.filter(i => state.favs.has(i.key)) : state.items.filter(i => i.type === state.tab);
  const groups = ['Todos', ...[...new Set(base.map(i => i.group))].sort((a, b) => a.localeCompare(b))];
  $('side').innerHTML = groups.map(g => `<button class="${g === state.group ? 'active' : ''}" data-g="${esc(g)}" title="${esc(g)}">${esc(g)}</button>`).join('');
  // grade
  let arr = visibleItems();
  if (state.tab === 'series') { // agrupa por série
    const map = new Map();
    arr.forEach(i => { if (!map.has(i.show)) map.set(i.show, { ...i, name: i.show, count: 0, series: true }); map.get(i.show).count++; });
    arr = [...map.values()];
  }
  state.list = arr;
  const g = $('grid'); g.className = 'grid ' + (state.tab === 'live' ? 'live' : '');
  const shown = arr.slice(0, state.limit);
  g.innerHTML = shown.map((i, n) => `<div class="card ${state.current && state.current.key === i.key ? 'playing' : ''}" data-n="${n}">
    <div class="poster" style="${i.logo ? `background-image:url('${esc(i.logo)}')` : ''}">${i.logo ? '' : (i.type === 'live' ? '📡' : i.type === 'movie' ? '🎬' : '📺')}</div>
    ${i.series ? `<span class="badge">${i.count} ep</span>` : ''}
    <button class="fav ${state.favs.has(i.key) ? 'on' : ''}" data-f="${n}">★</button>
    <div class="name">${esc(i.name)}</div></div>`).join('') +
    (arr.length > shown.length ? `<div class="more"><button class="btn" id="more">Mostrar mais (${arr.length - shown.length})</button></div>` : '');
  if (has && !arr.length) g.innerHTML = '<div class="more">Nada encontrado.</div>';
}

// ---------- Player ----------
function destroyPlayers() {
  clearTimeout(state.timer);
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  if (state.ts) { try { state.ts.destroy(); } catch (e) {} state.ts = null; }
}
function play(item) {
  const v = $('video');
  state.current = item;
  $('playerWrap').hidden = false; $('err').hidden = true;
  $('nowTitle').textContent = item.name;
  document.querySelectorAll('.card').forEach(c => c.classList.remove('playing'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  v.pause(); v.removeAttribute('src'); v.load(); destroyPlayers();

  // monta a lista de tentativas, na ordem
  const tries = [], seen = new Set();
  const add = (kind, url) => { const k = kind + '|' + url; if (url && !seen.has(k)) { seen.add(k); tries.push({ kind, url }); } };
  const orig = item.url;
  if (item.type === 'live') {
    add('hls', orig);
    if (/\.ts(\?|$)/i.test(orig)) add('hls', orig.replace(/\.ts(\?|$)/i, '.m3u8$1'));
    add('ts', /\.ts(\?|$)/i.test(orig) ? orig : orig.replace(/(\?|$)/, '.ts$1'));
    add('ts', orig);
  } else { add('hls', orig); add('dir', orig); }

  let i = 0;
  const onFail = () => {
    if (!tries.length) return showErr();
    tries.splice(i, 1); i = 0;
    if (!tries.length) return showErr();
    run();
  };
  function run() {
    destroyPlayers();
    const t = tries[i]; if (!t) return showErr();
    $('err').hidden = true;
    state.timer = setTimeout(() => { if (v.readyState < 2) onFail(); }, 14000);
    v.addEventListener('playing', () => clearTimeout(state.timer), { once: true });
    if (t.kind === 'ts') {
      if (window.mpegts && mpegts.isSupported()) {
        const p = state.ts = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: t.url });
        p.attachMediaElement(v); p.load();
        p.on(mpegts.Events.ERROR, onFail);
        const r = p.play(); if (r && r.catch) r.catch(() => {});
      } else onFail();
    } else if (t.kind === 'hls') {
      if (!(window.Hls && Hls.isSupported())) { tries[i] = { kind: 'dir', url: t.url }; return run(); }
      const h = state.hls = new Hls({ manifestLoadingTimeOut: 15000, fragLoadingTimeOut: 25000, maxBufferLength: 30, manifestLoadingMaxRetry: 2 });
      let rec = 0;
      h.loadSource(t.url); h.attachMedia(v);
      h.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
      h.on(Hls.Events.ERROR, (_, d) => { if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && rec++ < 2) return h.recoverMediaError();
        onFail(); });
    } else {
      v.src = t.url; const r = v.play(); if (r && r.catch) r.catch(() => {});
    }
    // se depois de um tempo o video nao produziu imagem, tenta o proximo formato
    setTimeout(() => { if (!v.videoWidth && !v.ended) onFail(); }, 9000);
  }
  run();
}
function showErr() {
  const e = $('err'); e.hidden = false;
  e.textContent = 'Não foi possível reproduzir este item. Ele pode estar offline, usar um formato que o celular não toca, ou o servidor pode estar bloqueando o acesso.';
}
$('video').addEventListener('error', showErr);

function openSeries(show) {
  const eps = state.items.filter(i => i.type === 'series' && i.show === show).sort((a, b) => a.season - b.season || a.ep - b.ep);
  const seasons = [...new Set(eps.map(e => e.season))];
  const box = $('episodes'); box.hidden = false;
  const draw = s => {
    box.innerHTML = `<h3>${esc(show)}</h3><div class="seasons">${seasons.map(x => `<button class="btn sm ${x === s ? 'act' : ''}" data-s="${x}">Temporada ${x}</button>`).join('')}</div>
    <div class="eps">${eps.filter(e => e.season === s).map(e => `<button class="btn" data-k="${esc(e.key)}">Ep. ${e.ep || '?'} — ${esc(e.name.slice(0, 40))}</button>`).join('')}</div>`;
    box.querySelectorAll('[data-s]').forEach(b => b.onclick = () => draw(+b.dataset.s));
    box.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
      const e = eps.find(x => x.key === b.dataset.k); state.queue = eps; play(e); });
  };
  draw(seasons[0]); box.scrollIntoView({ behavior: 'smooth' });
}

function step(d) {
  const q = state.queue || state.list.filter(i => !i.series);
  const i = q.findIndex(x => state.current && x.key === state.current.key);
  if (i >= 0 && q[i + d]) play(q[i + d]);
}

// ---------- Eventos ----------
$('tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return;
  state.tab = b.dataset.tab; state.group = 'Todos'; state.limit = 120; state.queue = null; $('episodes').hidden = true; render(); };
$('side').onclick = e => { const b = e.target.closest('button'); if (!b) return; state.group = b.dataset.g; state.limit = 120; render(); };
$('grid').onclick = e => {
  if (e.target.id === 'more') { state.limit += 120; return render(); }
  const f = e.target.closest('[data-f]');
  if (f) { const it = state.list[+f.dataset.f];
    const keys = it.series ? state.items.filter(i => i.show === it.show).map(i => i.key) : [it.key];
    const on = state.favs.has(keys[0]); keys.forEach(k => on ? state.favs.delete(k) : state.favs.add(k));
    localStorage.setItem('ntv_favs', JSON.stringify([...state.favs])); return render(); }
  const c = e.target.closest('.card'); if (!c) return;
  const it = state.list[+c.dataset.n];
  if (it.series) openSeries(it.show);
  else { state.queue = null; $('episodes').hidden = true; play(it); c.classList.add('playing'); }
};
let t; $('search').oninput = e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; state.limit = 120; render(); }, 200); };
$('btnLoad').onclick = () => { $('url').value = localStorage.getItem('ntv_url') || ''; $('status').textContent = ''; $('dlg').showModal(); };
$('btnCancel').onclick = () => $('dlg').close();
$('btnOk').onclick = load;
$('btnPrev').onclick = () => step(-1); $('btnNext').onclick = () => step(1);
$('btnFs').onclick = () => $('video').requestFullscreen?.();
$('btnPip').onclick = () => $('video').requestPictureInPicture?.().catch(() => {});
$('btnClose').onclick = () => { clearTimeout(state.timer); $('video').pause(); $('video').removeAttribute('src'); destroyPlayers(); $('playerWrap').hidden = true; };
document.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const v = $('video');
  if (e.key === 'f') v.requestFullscreen?.();
  else if (e.key === ' ') { e.preventDefault(); v.paused ? v.play() : v.pause(); }
  else if (e.key === 'm') v.muted = !v.muted;
  else if (e.key === 'ArrowRight') v.currentTime += 10;
  else if (e.key === 'ArrowLeft') v.currentTime -= 10;
  else if (e.key === 'n') step(1); else if (e.key === 'p') step(-1);
});

// restaura a última playlist (cache) e atualiza em segundo plano pela URL salva
(async () => {
  render();
  try { const saved = await idb.get('pl');
    if (saved && saved.includes('#EXTINF')) { state.items = parseM3U(saved); render(); } } catch (e) {}
  const u = localStorage.getItem('ntv_url');
  if (u) { try { const r = await fetch(u); if (r.ok) { const t = await r.text();
    if (t.includes('#EXTINF')) { state.items = parseM3U(t); await idb.set('pl', t); render(); } } } catch (e) {} }
})();
})();
