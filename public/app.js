const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (url, opts = {}) => {
  const r = await fetch(url, { credentials: 'same-origin', ...opts, headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
};
const post = (url, body, method = 'POST') => api(url, { method, body: JSON.stringify(body || {}) });
const small = () => matchMedia('(max-width:760px)').matches;

// ---------- window manager ----------
let z = 10;
const wins = $$('.win');
wins.forEach((w, i) => {
  const title = w.dataset.title;
  const body = document.createElement('div'); body.className = 'body';
  while (w.firstChild) body.appendChild(w.firstChild);
  const bar = document.createElement('div'); bar.className = 'bar';
  bar.innerHTML = `<span>${esc(title)}</span><button aria-label="Close ${esc(title)}">x</button>`;
  w.append(bar, body);
  w.style.width = (w.dataset.w || 480) + 'px';
  w.style.left = (+w.dataset.x + i * 6) + 'px';
  w.style.top = (+w.dataset.y + i * 6) + 'px';
  w.hidden = true;
  $('button', bar).onclick = () => closeWin(w);
  w.addEventListener('pointerdown', () => focusWin(w));
  let drag;
  bar.addEventListener('pointerdown', e => {
    if (e.target.tagName === 'BUTTON' || small()) return;
    drag = { dx: e.clientX - w.offsetLeft, dy: e.clientY - w.offsetTop };
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener('pointermove', e => {
    if (!drag) return;
    w.style.left = Math.max(0, Math.min(innerWidth - 80, e.clientX - drag.dx)) + 'px';
    w.style.top = Math.max(0, Math.min(innerHeight - 90, e.clientY - drag.dy)) + 'px';
  });
  bar.addEventListener('pointerup', () => drag = null);
});
const loaders = { queue: loadQueue, gallery: loadGallery, jukebox: loadGallery, admin: checkAdmin };
function openWin(id) {
  const w = $('#w-' + id); if (!w) return;
  w.hidden = false; focusWin(w);
  if (loaders[id]) loaders[id]();
}
function closeWin(w) { w.hidden = true; drawTaskbar(); }
function focusWin(w) { w.style.zIndex = ++z; w.dataset.z = z; drawTaskbar(); }
function drawTaskbar() {
  const open = wins.filter(w => !w.hidden);
  const top = open.reduce((a, b) => (+b.dataset.z > +(a?.dataset.z || 0) ? b : a), null);
  $('#taskbar').innerHTML = '';
  open.forEach(w => {
    const b = document.createElement('button');
    b.textContent = w.dataset.title; if (w === top) b.className = 'front';
    b.onclick = () => focusWin(w);
    $('#taskbar').appendChild(b);
  });
}
document.addEventListener('click', e => { const t = e.target.closest('[data-open]'); if (t) openWin(t.dataset.open); });
openWin('home');
if (location.hash === '#queue') openWin('queue');

// ---------- request form ----------
$('#reqForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, m = $('#reqMsg'), d = Object.fromEntries(new FormData(f));
  ['commercial', 'rushed', 'tos'].forEach(k => d[k] = f[k].checked);
  m.className = 'msg'; m.textContent = 'Sending...';
  try { await post('/api/request', d); f.reset(); m.textContent = 'Sent! Check your email for a confirmation. I will reply with a price.'; }
  catch (err) { m.className = 'msg err'; m.textContent = err.message; }
});

// ---------- queue ----------
const labels = { accepted: 'Accepted', 'in-progress': 'In progress', review: 'In review', done: 'Done' };
async function loadQueue() {
  const list = await api('/api/queue');
  $('#queueList').innerHTML = list.length ? list.map(c =>
    `<li><span>${esc(c.name)} <span class="muted">(${esc(c.type)})</span></span><span class="tag ${esc(c.status)}">${labels[c.status] || esc(c.status)}</span></li>`).join('')
    : '<li>The queue is empty right now. Request a commission to be first.</li>';
}

// ---------- gallery + jukebox ----------
async function loadGallery() {
  const g = await api('/api/gallery');
  $('#artGrid').innerHTML = g.art.length ? g.art.map(a =>
    `<button data-src="/files/art/${esc(a.file)}" title="${esc(a.title)}"><img loading="lazy" src="/files/art/${esc(a.file)}" alt="${esc(a.title)}"></button>`).join('')
    : '<p>No art uploaded yet.</p>';
  $('#trackList').innerHTML = g.music.length ? g.music.map(t =>
    `<li><b>${esc(t.title)}</b><audio controls preload="none" src="/files/music/${esc(t.file)}"></audio></li>`).join('')
    : '<li>No tracks uploaded yet.</li>';
  return g;
}
$('#artGrid').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $('#lightbox img').src = b.dataset.src; $('#lightbox').hidden = false;
});
$('#lightbox').onclick = () => $('#lightbox').hidden = true;
addEventListener('keydown', e => { if (e.key === 'Escape') $('#lightbox').hidden = true; });
// only one track plays at a time
document.addEventListener('play', e => $$('audio').forEach(a => a !== e.target && a.pause()), true);

// ---------- admin ----------
async function checkAdmin() {
  const { admin } = await api('/api/me');
  $('#loginBox').hidden = admin; $('#adminBox').hidden = !admin;
  if (admin) { loadComms(); loadManage(); }
}
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); const m = $('#loginMsg'); m.className = 'msg'; m.textContent = '';
  try { await post('/api/login', { password: e.target.password.value }); e.target.reset(); checkAdmin(); }
  catch (err) { m.className = 'msg err'; m.textContent = err.message; }
});
$('#logoutBtn').onclick = async () => { await post('/api/logout'); checkAdmin(); };
$$('.tabs [data-tab]').forEach(b => b.onclick = () => {
  $$('.tabs [data-tab]').forEach(x => x.classList.toggle('on', x === b));
  $$('#adminBox .tab').forEach(t => t.hidden = t.id !== b.dataset.tab);
});
$$('.upForm').forEach(f => f.addEventListener('submit', async e => {
  e.preventDefault(); const m = $('.msg', f); m.className = 'msg'; m.textContent = 'Uploading...';
  try { await api('/api/upload/' + f.dataset.kind, { method: 'POST', body: new FormData(f) }); f.reset(); m.textContent = 'Uploaded.'; loadManage(); }
  catch (err) { m.className = 'msg err'; m.textContent = err.message; }
}));
async function loadManage() {
  const g = await api('/api/gallery');
  const row = (k, x) => `<li><span>${esc(x.title)}</span><button class="btn sm" data-del="${k}/${x.id}">Delete</button></li>`;
  $('#manageArt').innerHTML = g.art.map(x => row('art', x)).join('');
  $('#manageMusic').innerHTML = g.music.map(x => row('music', x)).join('');
}
$('#adminBox').addEventListener('click', async e => {
  const d = e.target.dataset.del;
  if (d && confirm('Delete this file permanently?')) { await api('/api/item/' + d, { method: 'DELETE' }); loadManage(); }
});

const statuses = ['requested', 'accepted', 'in-progress', 'review', 'done', 'declined'];
async function loadComms() {
  const list = await api('/api/admin/commissions');
  $('#t-comms').innerHTML = list.length ? list.map(c => `
    <details class="comm" data-id="${c.id}">
      <summary>${esc(c.name)} (${esc(c.type)}) - ${esc(c.status)}${c.rushed ? ' - RUSH' : ''}${c.commercial ? ' - COMMERCIAL' : ''}</summary>
      <div class="in">
        <p>${esc(c.email)}${c.discord ? ' | Discord: ' + esc(c.discord) : ''}${c.budget ? ' | Budget: $' + esc(c.budget) : ''}</p>
        <p>${esc(c.description).replace(/\n/g, '<br>')}</p>
        ${c.refs ? `<p>Refs: ${esc(c.refs)}</p>` : ''}
        <div class="row">
          <label>Status <select data-f="status">${statuses.map(s => `<option ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label>Price <input data-f="price" value="${esc(c.price)}"></label>
          <label>Due date <input type="date" data-f="due" value="${esc(c.due)}"></label>
          <label>Message to client (optional) <input data-f="message"></label>
        </div>
        <label>Private notes <textarea data-f="notes" rows="2">${esc(c.notes)}</textarea></label>
        <label class="chk"><input type="checkbox" data-f="hidden" ${c.hidden ? 'checked' : ''}> Hide from public queue</label>
        <label class="chk"><input type="checkbox" data-f="notify"> Email the client about this update</label>
        <p><button class="btn sm" data-act="save">Save</button><button class="btn sm" data-act="up">Move up</button><button class="btn sm" data-act="down">Move down</button><button class="btn sm" data-act="del">Delete</button></p>
      </div>
    </details>`).join('') : '<p>No commission requests yet.</p>';
}
$('#t-comms').addEventListener('click', async e => {
  const act = e.target.dataset.act; if (!act) return;
  const box = e.target.closest('.comm'), id = box.dataset.id;
  const open = box.open;
  try {
    if (act === 'save') {
      const body = {};
      $$('[data-f]', box).forEach(i => body[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value);
      await post('/api/admin/commissions/' + id, body, 'PATCH');
    } else if (act === 'del') { if (!confirm('Delete this request?')) return; await api('/api/admin/commissions/' + id, { method: 'DELETE' }); }
    else await post(`/api/admin/commissions/${id}/move`, { dir: act });
    await loadComms();
    if (open && act !== 'del') $(`.comm[data-id="${id}"]`)?.setAttribute('open', '');
  } catch (err) { alert(err.message); }
});
