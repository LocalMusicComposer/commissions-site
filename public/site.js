const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (url, o = {}) => {
  const r = await fetch(url, { credentials: 'same-origin', ...o, headers: o.body && !(o.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
};
const post = (u, b, m = 'POST') => api(u, { method: m, body: JSON.stringify(b || {}) });

// ---------- shared header + footer ----------
const pages = [['index', 'Home', '/'], ['art', 'Art', '/art.html'], ['music', 'Music', '/music.html'], ['gallery', 'Gallery', '/gallery.html'], ['jukebox', 'Jukebox', '/jukebox.html'], ['queue', 'Queue', '/queue.html']];
const cur = document.body.dataset.page;
const msg = '🚨 EMERGENCY COMMISSIONS OPEN · Art from $10/hr · Music from $20/hr · Art in as little as 2 days · Saving for college ·';
$('#top').innerHTML = `<div id="alert" role="status"><div class="track"><span>${msg}</span><span aria-hidden="true">${msg}</span></div></div>
<header class="nav"><a class="logo" href="/">Jonathan's Commissions</a>
<button id="burger" aria-expanded="false" aria-controls="links">Menu</button>
<nav id="links" aria-label="Main">${pages.map(([p, t, h]) => `<a href="${h}"${p === cur ? ' aria-current="page"' : ''}>${t}</a>`).join('')}<a class="cta" href="/request.html">Request</a></nav></header>`;
$('#burger').onclick = e => { const o = $('#links').classList.toggle('open'); e.target.setAttribute('aria-expanded', o); };
$('#foot').innerHTML = `<footer><div class="wrap"><span><b>Jonathan's Commissions</b><br>Saving for college, one commission at a time.</span>
<span><a href="/art.html">Art</a> · <a href="/music.html">Music</a> · <a href="/queue.html">Queue</a> · <a href="/request.html">Request</a> · <a href="/admin.html">Owner login</a></span>
<span>TOS: <a href="https://docs.google.com/document/d/1EU53gxlrldeMXIp0Zeh2bPcaq9cprxblpM7Hi5OETtk/edit?usp=sharing" target="_blank" rel="noopener">Art</a> · <a href="https://docs.google.com/document/d/1wEUbWNo9dk0hoHtJOPRfoWgE632EhbkCmjRAtBqdp_I/edit?usp=sharing" target="_blank" rel="noopener">Music</a></span></div></footer>`;

// ---------- lightbox + single audio ----------
document.body.insertAdjacentHTML('beforeend', '<div id="lightbox" hidden><img alt=""></div>');
document.addEventListener('click', e => {
  const b = e.target.closest('button[data-src]');
  if (b) { $('#lightbox img').src = b.dataset.src; $('#lightbox').hidden = false; }
  else if (e.target.closest('#lightbox')) $('#lightbox').hidden = true;
});
addEventListener('keydown', e => { if (e.key === 'Escape') $('#lightbox').hidden = true; });
document.addEventListener('play', e => $$('audio').forEach(a => a !== e.target && a.pause()), true);

// ---------- queue ----------
const labels = { accepted: 'Accepted', 'in-progress': 'In progress', review: 'In review', done: 'Done' };
(async () => {
  const el = $('#queueList'); if (!el) return;
  const list = (await api('/api/queue')).slice(0, +el.dataset.limit || 999);
  el.innerHTML = list.length ? list.map(c => `<li><span>${esc(c.name)} <span class="muted">(${esc(c.type)})</span></span><span class="tag ${esc(c.status)}">${labels[c.status] || esc(c.status)}</span></li>`).join('')
    : '<li>The queue is empty right now. <a href="/request.html">Request a commission</a> to be first.</li>';
})().catch(() => {});

// ---------- art + music ----------
(async () => {
  if (!$('#artGrid,#trackList,#freshArt,#freshTrack')) return;
  const g = await api('/api/gallery');
  const art = a => `<button data-src="/files/art/${esc(a.file)}" title="${esc(a.title)}"><img loading="lazy" src="/files/art/${esc(a.file)}" alt="${esc(a.title)}"></button>`;
  const track = t => `<li><b>${esc(t.title)}</b><audio controls preload="none" src="/files/music/${esc(t.file)}"></audio></li>`;
  for (const id of ['artGrid', 'freshArt']) { const el = $('#' + id); if (el) el.innerHTML = g.art.length ? g.art.slice(0, +el.dataset.limit || 999).map(art).join('') : '<p class="empty">Art samples are coming soon.</p>'; }
  const tl = $('#trackList'); if (tl) tl.innerHTML = g.music.length ? g.music.slice(0, +tl.dataset.limit || 999).map(track).join('') : '<li class="empty">Music samples are coming soon.</li>';
  const ft = $('#freshTrack'); if (ft) ft.innerHTML = g.music[0] ? `<ul class="tracks">${track(g.music[0])}</ul>` : '<p class="empty">Music samples are coming soon.</p>';
})().catch(() => {});

// ---------- request form ----------
const rf = $('#reqForm');
if (rf) rf.addEventListener('submit', async e => {
  e.preventDefault();
  const m = $('#reqMsg'), d = Object.fromEntries(new FormData(rf));
  ['commercial', 'rushed', 'tos'].forEach(k => d[k] = rf[k].checked);
  m.className = 'msg'; m.textContent = 'Sending...';
  try { await post('/api/request', d); rf.reset(); m.textContent = 'Sent! I will reply with a price using your Discord or email. Watch the Queue page for progress.'; }
  catch (err) { m.className = 'msg err'; m.textContent = err.message; }
});

// ---------- owner area ----------
if ($('#loginForm')) {
  const statuses = ['requested', 'accepted', 'in-progress', 'review', 'done', 'declined'];
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
  async function loadComms() {
    const list = await api('/api/admin/commissions');
    $('#t-comms').innerHTML = list.length ? list.map(c => `
      <details class="comm" data-id="${c.id}">
        <summary>${esc(c.name)} (${esc(c.type)}) - ${esc(c.status)}${c.rushed ? ' - RUSH' : ''}${c.commercial ? ' - COMMERCIAL' : ''}</summary>
        <div class="in">
          <p>Discord: ${esc(c.discord)}${c.email ? ' | ' + esc(c.email) : ''}${c.budget ? ' | Budget: $' + esc(c.budget) : ''}</p>
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
          <p><button class="btn sm" data-act="save">Save</button><button class="btn sm ghost" data-act="up">Move up</button><button class="btn sm ghost" data-act="down">Move down</button><button class="btn sm ghost" data-act="del">Delete</button></p>
        </div>
      </details>`).join('') : '<p class="empty">No commission requests yet.</p>';
  }
  $('#t-comms').addEventListener('click', async e => {
    const act = e.target.dataset.act; if (!act) return;
    const box = e.target.closest('.comm'), id = box.dataset.id, open = box.open;
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
  checkAdmin();
}
