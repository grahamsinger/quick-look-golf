// The topbar "flag" button: something looks wrong → jot a note and it's
// filed to /api/issues with the page URL attached, for review later (admin
// page lists open flags; data/issues.json holds them all). Self-contained:
// it builds its own button + popover, so any page with a .topnav just
// imports this module. A page can set window.flagContext = () => "…" to
// attach extra state the URL doesn't carry (the records page's controls).
const nav = document.querySelector('.topnav');
if (nav) {
  const wrap = document.createElement('div');
  wrap.className = 'flagwrap';
  wrap.innerHTML = `
    <button id="flagBtn" type="button" title="Something looks off? Flag it for review">
      <svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 14.5v-12"/><path d="M3.5 2.8c3-1.6 6 1.6 9 0v6.4c-3 1.6-6-1.6-9 0"/></svg>
      Flag
    </button>
    <div id="flagPop" class="flagpop" hidden>
      <div class="flaghdr">Something looks off?</div>
      <textarea id="flagNote" rows="3" placeholder="What's wrong on this page?"></textarea>
      <div class="flagrow">
        <span class="flagctx">this page's address is attached</span>
        <button id="flagSend" type="button">Flag it</button>
      </div>
    </div>`;
  nav.prepend(wrap);

  const pop = wrap.querySelector('#flagPop');
  const note = wrap.querySelector('#flagNote');
  const send = wrap.querySelector('#flagSend');
  const close = () => { pop.hidden = true; };

  wrap.querySelector('#flagBtn').addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    if (!pop.hidden) note.focus();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.flagwrap')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  send.addEventListener('click', async () => {
    const text = note.value.trim();
    if (!text) { note.focus(); return; }
    send.disabled = true;
    try {
      const res = await fetch('/api/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: text,
          url: location.pathname + location.search,
          ctx: typeof window.flagContext === 'function' ? String(window.flagContext() || '') : '',
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      note.value = '';
      send.textContent = 'flagged ✓';
      setTimeout(() => { close(); send.disabled = false; send.textContent = 'Flag it'; }, 900);
    } catch {
      send.disabled = false;
      send.textContent = 'failed — retry';
    }
  });
}
