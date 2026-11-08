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
      const name = line.slice(line.lastIndexOf(',') + 1).trim() || attr('tvg-name');
      meta = { name, logo: attr('tvg-logo'), group: attr('group-title') || 'Sem categoria', id: attr('tvg-id') };
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

// ---------- Armazenamento ----------
const idb = {
  open: () => new Promise((res, rej) => { const r = indexedDB.open('neontv', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
  async get(k) { const db = await this.open(); return new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); },
  async set(k, v) { const db = await this.open(); return new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(true); t.onerror = () => res(false); }); }
};

// ---------- Login por DNS (Xtream) ----------
function withCreds(url, u, p) {
  if (url.includes('{u}')) return url.replace(/\{u\}/g, encodeURIComponent(u)).replace(/\{p\}/g, encodeURIComponent(p));
  return url;
}
async function dnsToPlaylist(dns, u, p, ssl, log) {
  let host = dns.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const base = (ssl ? 'https://' : 'http://') + host;
  log('Ligando em ' + host + ' ...');
  let r = await fetch(base + '/player_api.php?username=' + encodeURIComponent(u) + '&password=' + encodeURIComponent(p));
  if (!r.ok && !ssl) r = await fetch(('https://' + host) + '/player_api.php?username=' + encodeURIComponent(u) + '&password=' + encodeURIComponent(p));
  if (!r.ok) throw new Error('o servidor respondeu ' + r.status);
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) { throw new Error('a resposta não é de um servidor compatível'); }
  const info = (j && j.user_info) || {};
  if (info.auth === 0 || info.auth === '0') throw new Error('usuário ou senha incorretos');
  if (info.status && String(info.status).toLowerCase() !== 'active') throw new Error('a conta está ' + info.status);
  log('Conta OK. Buscando a lista ...');
  const L = await fetch(base + '/get.php?username=' + encodeURIComponent(u) + '&password=' + encodeURIComponent(p) + '&type=m3u_plus&output=ts');
  if (!L.ok) throw new Error('não consegui baixar a lista (' + L.status + ')');
  let text = await L.text();
  if (!text.includes('#EXTINF')) throw new Error('o servidor não devolveu uma lista M3U');
  return { text, base, host };
}

// ---------- Carregar ----------
async function loadUrl(text, url) {
  state.items = parseM3U(text);
  if (!state.items.length) throw new Error('nenhum canal encontrado na lista');
  await idb.set('pl', text);
  localStorage.setItem('ntv_url', url || '');
}
async function load() {
  const st = $('status'); st.textContent = 'Carregando...';
  const dnsMode = !$('formDns').hidden;
  try {
    if (dnsMode) {
      const dns = $('dns').value.trim(), u = $('user').value.trim(), p = $('pass').value;
      if (!dns || !u || !p) throw new Error('preencha DNS, usuário e senha');
      localStorage.setItem('ntv_dns', dns); localStorage.setItem('ntv_user', u); localStorage.setItem('ntv_pass', p);
      localStorage.setItem('ntv_ssl', $('ssl').checked ? '1' : '');
      const res = await dnsToPlaylist(dns, u, p, $('ssl').checked, m => { st.textContent = m; });
      await loadUrl(res.text, '');
      localStorage.setItem('ntv_dnsurl', dns);
    } else {
      let text = $('paste').value.trim();
      const f = $('file').files[0];
      const url = $('url').value.trim();
      if (f) text = await f.text();
      else if (!text && url) {
        const r = await fetch(withCreds(url, $('user').value, $('pass').value));
        if (!r.ok) throw new Error('HTTP ' + r.status);
        text = await r.text();
      }
      if (!text.includes('#EXTINF')) throw new Error('playlist inválida ou vazia');
      await loadUrl(text, url);
    }
    $('dlg').close(); state.group = 'Todos'; state.limit = 120; render();
  } catch (e) { st.textContent = 'Erro: ' + e.message + ' (se for bloqueio do navegador, use a URL M3U completa)'; }
}
async function refreshDns() {
  const dns = localStorage.getItem('ntv_dns'), u = localStorage.getItem('ntv_user'), p = localStorage.getItem('ntv_pass');
  if (!dns || !u || !p) return;
  try { const r = await dnsToPlaylist(dns, u, p, !!localStorage.getItem('ntv_ssl'), () => {});
    if (r.text.includes('#EXTINF')) { await loadUrl(r.text, ''); render(); } } catch (e) {}
}

// ---------- Render ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const byType = t => state.items.filter(i => i.type === t);
const showCount = () => new Set(state.items.filter(i => i.type === 'series').map(i => i.show)).size;
function menu() {
  const has = state.items.length > 0;
  $('menu').innerHTML = has ? '' : `<div class="logo" style="text-align:center;font-size:40px">KPLAY<i>TV</i></div>
    <button class="block big" data-m="dns"><i>▶</i>Entrar com DNS</button>
    <button class="block" data-m="url"><i>⚙</i>URL M3U</button>
    <button class="block plain" data-m="last"><i>↻</i>Recarregar última lista</button>`;
  $('menu').hidden = has;
  $('empty').innerHTML = has ? '' : '<p>Informe o DNS, o usuário e a senha do seu servidor para começar.</p>';
  $('empty').hidden = has;
}
function render() {
  const has = state.items.length > 0;
  menu();
  $('tabs').hidden = !has; $('search').hidden = !has;
  $('cLive').textContent = byType('live').length; $('cMovie').textContent = byType('movie').length;
  $('cSeries').textContent = showCount(); $('cFav').textContent = state.favs.size;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  const base = state.tab === 'fav' ? state.items.filter(i => state.favs.has(i.key)) : byType(state.tab);
  const groups = ['Todos', ...[...new Set(base.map(i => i.group))].sort((a, b) => a.localeCompare(b))];
  $('side').innerHTML = groups.map(g => `<button class="${g === state.group ? 'active' : ''}" data-g="${esc(g)}" title="${esc(g)}">${esc(g)}</button>`).join('');
  $('side').hidden = !has;
  let arr = visibleItems();
  if (state.tab === 'series') {
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
function visibleItems() {
  const q = state.q.toLowerCase();
  let arr = state.tab === 'fav' ? state.items.filter(i => state.favs.has(i.key)) : byType(state.tab);
  if (state.group !== 'Todos') arr = arr.filter(i => i.group === state.group);
  if (q) arr = arr.filter(i => i.name.toLowerCase().includes(q) || (i.show || '').toLowerCase().includes(q));
  return arr;
}

// ---------- Player (rapido: 1 tentativa principal, depois alternativas) ----------
function destroyPlayers() {
  clearTimeout(state.timer);
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  if (state.ts) { try { state.ts.destroy(); } catch (e) {} state.ts = null; }
}
const spin = on => { $('spin').hidden = !on; };
function play(item) {
  const v = $('video');
  state.current = item;
  $('playerWrap').hidden = false; $('err').hidden = true;
  $('nowTitle').textContent = item.name;
  document.querySelectorAll('.card').forEach(c => c.classList.remove('playing'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  v.pause(); v.removeAttribute('src'); v.load(); destroyPlayers(); spin(true);

  const tries = [], seen = new Set();
  const add = (kind, url) => { const k = kind + '|' + url; if (url && !seen.has(k)) { seen.add(k); tries.push({ kind, url }); } };
  const orig = item.url;
  if (item.type === 'live') {
    add('hls', /\.[a-z]+(\?|$)/i.test(orig) ? orig.replace(/\.[a-z]+(\?|$)/i, '.m3u8$1') : orig);
    add('ts', orig);
    add('ts', /\.[a-z]+(\?|$)/i.test(orig) ? orig.replace(/\.[a-z]+(\?|$)/i, '.ts$1') : orig + '.ts');
  } else { add('hls', orig); add('dir', orig); }

  let i = 0;
  const finish = () => { spin(false); };
  const onFail = () => { if (!tries.length) { finish(); return showErr(); } tries.splice(i, 1); i = 0; if (!tries.length) { finish(); return showErr(); } run(); };
  function run() {
    destroyPlayers();
    const t = tries[i]; if (!t) { finish(); return showErr(); }
    $('err').hidden = true; spin(true);
    state.timer = setTimeout(() => { if (v.readyState < 2) onFail(); }, 7000);
    if (t.kind === 'ts') {
      if (window.mpegts && mpegts.isSupported()) {
        const p = state.ts = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: t.url });
        p.attachMediaElement(v); p.load();
        p.on(mpegts.Events.ERROR, onFail);
        v.addEventListener('playing', () => { clearTimeout(state.timer); finish(); }, { once: true });
        const r = p.play(); if (r && r.catch) r.catch(() => {});
      } else onFail();
    } else if (t.kind === 'hls') {
      if (!(window.Hls && Hls.isSupported())) { tries[i] = { kind: 'dir', url: t.url }; return run(); }
      const h = state.hls = new Hls({ lowLatencyMode: true, maxBufferLength: 12, maxMaxBufferLength: 24, liveSyncDurationCount: 3, manifestLoadingTimeOut: 6000, manifestLoadingMaxRetry: 1, fragLoadingTimeOut: 12000 });
      let rec = 0;
      h.loadSource(t.url); h.attachMedia(v);
      v.addEventListener('playing', () => { clearTimeout(state.timer); finish(); }, { once: true });
      h.on(Hls.Events.MANIFEST_PARSED, () => { v.play().catch(() => {}); });
      h.on(Hls.Events.ERROR, (_, d) => { if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && rec++ < 1) return h.recoverMediaError();
        onFail(); });
    } else {
      v.src = t.url; const r = v.play(); if (r && r.catch) r.catch(() => {});
      v.addEventListener('playing', () => { clearTimeout(state.timer); finish(); }, { once: true });
      v.addEventListener('loadeddata', () => { clearTimeout(state.timer); finish(); }, { once: true });
    }
    setTimeout(() => { if (!v.videoWidth && !v.ended) onFail(); }, 7000);
  }
  run();
}
function showErr() {
  const e = $('err'); e.hidden = false;
  e.textContent = 'Não consegui abrir este canal agora. Tente outro, ou toque de novo para o app tentar de novo.';
}
$('video').addEventListener('error', () => { spin(false); });

function openSeries(show) {
  const eps = state.items.filter(i => i.type === 'series' && i.show === show).sort((a, b) => a.season - b.season || a.ep - b.ep);
  const seasons = [...new Set(eps.map(e => e.season))];
  const box = $('episodes'); box.hidden = false;
  const draw = s => {
    box.innerHTML = `<h3>${esc(show)}</h3><div class="seasons">${seasons.map(x => `<button class="btn sm ${x === s ? 'act' : ''}" data-s="${x}">Temporada ${x}</button>`).join('')}</div>
    <div class="eps">${eps.filter(e => e.season === s).map(e => `<button class="btn" data-k="${esc(e.key)}">Ep. ${e.ep || '?'} — ${esc(e.name.slice(0, 40))}</button>`).join('')}</div>`;
    box.querySelectorAll('[data-s]').forEach(b => b.onclick = () => draw(+b.dataset.s));
    box.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { const e = eps.find(x => x.key === b.dataset.k); state.queue = eps; play(e); });
  };
  draw(seasons[0]); box.scrollIntoView({ behavior: 'smooth' });
}
function step(d) {
  const q = state.queue || state.list.filter(i => !i.series);
  const i = q.findIndex(x => state.current && x.key === state.current.key);
  if (i >= 0 && q[i + d]) play(q[i + d]);
}

// ---------- Eventos ----------
$('menu').onclick = e => {
  const b = e.target.closest('[data-m]'); if (!b) return;
  const m = b.dataset.m;
  if (m === 'last') { (async () => {
      if (!state.items.length) { const s = await idb.get('pl'); if (s && s.includes('#EXTINF')) { state.items = parseM3U(s); render(); } }
      refreshDns(); })(); return; }
  openDlg(m === 'dns');
};
function openDlg(dns) {
  $('formDns').hidden = !dns; $('formUrl').hidden = dns;
  $('dlgTitle').textContent = dns ? 'Entrar com DNS' : 'Carregar playlist';
  $('dlgSub').textContent = dns ? 'Digite o DNS do seu servidor e os dados da conta.' : 'Use a URL M3U, um arquivo ou cole o texto.';
  $('status').textContent = '';
  if (dns) { $('dns').value = localStorage.getItem('ntv_dns') || 'KEVIN4MVENDAS0805.COM.BR';
    $('user').value = localStorage.getItem('ntv_user') || ''; $('pass').value = localStorage.getItem('ntv_pass') || '';
    $('ssl').checked = !!localStorage.getItem('ntv_ssl'); }
  else $('url').value = localStorage.getItem('ntv_url') || '';
  $('dlg').showModal();
}
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
  const it = state.list[+c.dataset.n]; if (!it) return;
  if (it.series) openSeries(it.show);
  else { state.queue = null; $('episodes').hidden = true; play(it); c.classList.add('playing'); }
};
let t; $('search').oninput = e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; state.limit = 120; render(); }, 200); };
$('btnLoad').onclick = () => openDlg(true);
$('btnCancel').onclick = () => $('dlg').close();
$('btnOk').onclick = load;
$('btnPrev').onclick = () => step(-1); $('btnNext').onclick = () => step(1);
$('btnFs').onclick = () => $('video').requestFullscreen?.();
$('btnPip').onclick = () => $('video').requestPictureInPicture?.().catch(() => {});
$('btnClose').onclick = () => { clearTimeout(state.timer); $('video').pause(); $('video').removeAttribute('src'); destroyPlayers(); spin(false); $('playerWrap').hidden = true; };
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

// ---------- Inicio ----------
(async () => {
  render();
  try { const s = await idb.get('pl'); if (s && s.includes('#EXTINF')) { state.items = parseM3U(s); render(); } } catch (e) {}
  refreshDns();
})();
})();
