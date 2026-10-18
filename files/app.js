/* PlayHub: one script for every page. No libraries, no build step. */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const url = u => (/^https?:\/\//.test(u) ? esc(u) : '#');   // only allow web links
const store = {                                              // localStorage that never crashes
  get: k => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const DB = {};                 // card key -> {kind, it}
let refresh = () => {};        // set by listing pages

/* ---------- Header and footer: edit the menu here, once ---------- */
const NAV = [['index', 'Home'], ['games', 'Games'], ['sources', 'Sources'], ['about', 'About']];
const here = (location.pathname.split('/').pop() || 'index').replace('.html', '');
document.body.insertAdjacentHTML('afterbegin',
  '<header class="hd"><a class="logo" href="index.html">Play<b>Hub</b></a><nav aria-label="Main">' +
  NAV.map(([p, t]) => `<a href="${p}.html"${p === here ? ' aria-current="page"' : ''}>${t}</a>`).join('') + '</nav></header>');
document.body.insertAdjacentHTML('beforeend',
  '<footer class="ft">PlayHub is a directory, not a proxy. Games belong to their creators; every card credits its source. <a href="about.html">About and credits</a></footer>');

/* ---------- Data ---------- */
const load = async kind => {
  const r = await fetch('data/' + kind + '.json');
  if (!r.ok) throw new Error(r.status);
  return r.json();
};
const err = el => {
  el.innerHTML = '<p class="msg">Could not load the list. Opened by double-click? Browsers block JSON on file://, so run <code>python3 -m http.server</code> inside the web folder, or deploy the site.</p>';
};

/* ---------- One card for games and documentaries ---------- */
function card(kind, it) {
  const key = kind[0] + ':' + it.id;                         // g:id or d:id
  DB[key] = { kind, it };
  const playable = /^https:\/\//.test(it.embed || '');   // only a game with an allowed embed plays inside PlayHub
  const fav = store.get('ph_fav').includes(key);
  const img = it.thumb
    ? `<img src="${esc(it.thumb)}" alt="" width="320" height="180" loading="lazy" decoding="async">`
    : `<div class="ph" aria-hidden="true">🎮</div>`;
  const act = playable
    ? `<button class="btn" data-play="${esc(key)}">Play</button>`
    : `<a class="btn" data-open="${esc(key)}" href="${url(it.sourceUrl)}" target="_blank" rel="noopener noreferrer">Play now ↗</a>`;
  return `<article class="card">${img}<button class="fav" data-fav="${esc(key)}" aria-pressed="${fav}" aria-label="Favorite: ${esc(it.title)}">${fav ? '★' : '☆'}</button><div class="cb"><h3>${esc(it.title)}</h3><p class="tag">${esc(it.category)}</p>` +
    `<p class="desc">${esc(it.description)}</p>` +
    `<p class="src">Source: <a href="${url(it.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(it.source)}</a></p>` +
    `<div class="row">${act}</div></div></article>`;
}

/* ---------- Player: the iframe is created only after Play is clicked ---------- */
function play(key) {
  const { it } = DB[key];
  if (!(window.HTMLDialogElement && HTMLDialogElement.prototype.showModal)) {   // very old browser
    window.open(/^https?:\/\//.test(it.sourceUrl) ? it.sourceUrl : '/', '_blank', 'noopener');
    return;
  }
  if (!$('#pl')) {
    document.body.insertAdjacentHTML('beforeend',
      '<dialog id="pl" aria-label="Player"><div class="plh"><strong id="plt"></strong><button class="btn" id="plf">Fullscreen</button><a class="btn" id="plo" target="_blank" rel="noopener noreferrer">Original ↗</a><button class="btn" id="plx">Close</button></div><div class="plb" id="plb"></div></dialog>');
    const d = $('#pl');
    $('#plx').onclick = () => d.close();
    d.onclose = () => { $('#plb').innerHTML = ''; d.classList.remove('max'); };   // unloads the game
    $('#plf').onclick = () => {
      const b = $('#plb'), fs = b.requestFullscreen || b.webkitRequestFullscreen;
      fs ? fs.call(b) : d.classList.toggle('max');             // iPhone fallback: fill the screen
    };
  }
  const src = it.embed;
  $('#plt').textContent = it.title + ' – ' + it.source;
  $('#plo').href = /^https?:\/\//.test(it.sourceUrl) ? it.sourceUrl : '#';   // fallback if an embed is blocked
  // sandbox keeps third-party games in a box; loosen it only if a game truly needs more.
  $('#plb').innerHTML = `<iframe src="${esc(src)}" title="${esc(it.title)}" allow="fullscreen; autoplay; gamepad" allowfullscreen sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-pointer-lock allow-presentation"></iframe>`;
  $('#pl').showModal();
}

/* ---------- Clicks: favorites, recently played, play ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-play],[data-open],[data-fav]');
  if (!t) return;
  if (t.dataset.fav) {
    const key = t.dataset.fav, favs = store.get('ph_fav'), on = !favs.includes(key);
    store.set('ph_fav', on ? [...favs, key] : favs.filter(k => k !== key));
    t.setAttribute('aria-pressed', on);
    t.textContent = on ? '★' : '☆';
    return refresh();
  }
  const key = t.dataset.play || t.dataset.open;
  store.set('ph_rec', [key, ...store.get('ph_rec').filter(k => k !== key)].slice(0, 8));
  if (t.dataset.play) play(key);
});

/* ---------- Games and Documentaries pages: search + filters ---------- */
async function listing(kind) {
  const grid = $('#grid'), box = $('#q'), chips = $('#chips'), count = $('#count');
  let items;
  try { items = await load(kind); } catch { return err(grid); }
  const p = new URLSearchParams(location.search);
  const st = { q: p.get('q') || '', cat: p.get('cat') || '', fav: false };
  box.value = st.q;
  const cats = [['', 'All'], ...[...new Set(items.map(i => i.category))].sort().map(c => [c, c]), ['*', 'Favorites']];
  chips.innerHTML = cats.map(([v, t]) => `<button class="chip" data-cat="${esc(v)}" aria-pressed="false">${esc(t)}</button>`).join('');
  const show = () => {
    const favs = store.get('ph_fav'), q = st.q.trim().toLowerCase();
    const out = items.filter(i => (!st.cat || i.category === st.cat)
      && (!st.fav || favs.includes(kind[0] + ':' + i.id))
      && (!q || [i.title, i.category, i.description, i.source].join(' ').toLowerCase().includes(q)));
    grid.innerHTML = out.length ? out.map(i => card(kind, i)).join('')
      : '<p class="msg">' + (st.fav ? 'No favorites yet. Tap the star on any card.' : 'Nothing matches. Try another word or category.') + '</p>';
    count.textContent = out.length + (out.length === 1 ? ' result' : ' results');
    chips.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cat === (st.fav ? '*' : st.cat))));
  };
  box.oninput = () => { st.q = box.value; show(); };
  chips.onclick = e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    st.fav = b.dataset.cat === '*';
    st.cat = st.fav ? '' : b.dataset.cat;
    show();
  };
  refresh = () => st.fav && show();
  show();
}

/* ---------- Home page: featured + recently played ---------- */
async function home() {
  let items;
  try { items = await load('games'); } catch { document.querySelectorAll('[data-feat]').forEach(err); return; }
  $('[data-feat]').innerHTML = items.slice(0, 4).map(i => card('games', i)).join('');
  const rec = store.get('ph_rec').map(k => items.find(i => 'g:' + i.id === k)).filter(Boolean);
  if (rec.length) { $('#rec').hidden = false; $('#recGrid').innerHTML = rec.map(i => card('games', i)).join(''); }
}

const m = $('main');
if (m && m.dataset.kind) listing(m.dataset.kind);
else if ($('[data-feat]')) home();
