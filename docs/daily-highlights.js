// On-demand only: one small RPC per player/minute; no polling or realtime feed.
(function () {
  'use strict';
  const cache = new Map();
  let dialog, content, title, previousFocus, request = 0;
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  function node(tag, text, cls) {
    const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n;
  }
  function amount(value) {
    const n = BigInt(value), unit = n >= 1000000000000n ? 1000000000000n : n >= 1000000000n ? 1000000000n : n >= 1000000n ? 1000000n : 1n;
    if (unit === 1n) return '+' + n.toLocaleString('en-US') + ' ₪';
    const cents = n * 100n / unit;
    return '+' + (cents / 100n) + (cents % 100n ? '.' + String(cents % 100n).padStart(2, '0').replace(/0$/, '') : '') + (unit === 1000000000000n ? 'T' : unit === 1000000000n ? 'B' : 'M') + ' ₪';
  }
  function close() {
    if (!dialog || dialog.hidden) return;
    request++; dialog.hidden = true;
    if (previousFocus?.isConnected) previousFocus.focus();
    else document.querySelector('#navLb, [data-nav="lb"]')?.focus();
  }
  function ensure() {
    if (dialog) return;
    dialog = node('div', null, 'dh-overlay'); dialog.hidden = true;
    const box = node('section', null, 'dh-box'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'dhTitle');
    const header = node('div', null, 'dh-head'); title = node('h2', '', ''); title.id = 'dhTitle';
    const exit = node('button', '✕', 'dh-close'); exit.type = 'button'; exit.setAttribute('aria-label', 'סגור'); exit.onclick = close;
    header.append(title, exit); content = node('div', null, 'dh-content'); content.setAttribute('aria-live', 'polite');
    box.append(header, node('p', 'חמש התוצאות הגבוהות היום · לפי שעון ישראל', 'dh-note'), content,
      node('p', 'רווחים שהתקבלו בפועל, ללא הקרן. עבודות מרוכזות לסכום יומי אחד.', 'dh-note'));
    dialog.append(box); document.body.append(dialog);
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    document.addEventListener('keydown', e => {
      if (dialog.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
      if (e.key === 'Tab') {
        const buttons = [...box.querySelectorAll('button:not([disabled])')], first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }, true);
  }
  async function open(button) {
    ensure(); previousFocus = button; const token = ++request, user = button.dataset.user;
    title.textContent = 'הרווחים הגדולים היום · ' + (button.closest('li')?.querySelector('.nmt')?.firstChild?.textContent || 'שחקן').trim();
    content.replaceChildren(node('p', 'טוען…')); dialog.hidden = false; dialog.querySelector('.dh-close').focus();
    try {
      const session = await db.auth.getSession(), viewer = session.data?.session?.user?.id;
      if (!viewer) throw new Error('not_signed_in');
      const key = viewer + ':' + user + ':' + today(); let saved = cache.get(key);
      if (!saved || Date.now() - saved.time >= 60000) {
        const pending = db.rpc('gc_daily_highlights', { p_user: user }).then(({ data, error }) => { if (error) throw error; return data; });
        saved = { time: Date.now(), pending }; cache.set(key, saved);
        pending.catch(() => { if (cache.get(key) === saved) cache.delete(key); });
      }
      const data = await saved.pending;
      if (token !== request) return;
      content.replaceChildren();
      if (!data?.items?.length) { content.append(node('p', 'עדיין אין רווחים להצגה היום.')); return; }
      const list = node('ol', null, 'dh-list');
      data.items.slice(0, 5).forEach(item => {
        const row = node('li'), label = node('span', item.label), value = node('b', amount(item.profit), 'dh-profit'); value.dir = 'ltr';
        value.title = '+' + BigInt(item.profit).toLocaleString('en-US') + ' ₪'; row.append(label, value); list.append(row);
      });
      content.append(list);
    } catch (e) {
      if (token !== request) return;
      const retry = node('button', 'נסה שוב', 'dh-retry'); retry.type = 'button'; retry.onclick = () => open(button);
      content.replaceChildren(node('p', 'לא הצלחנו לטעון את הרווחים. אפשר לנסות שוב.'), retry);
    }
  }
  db.auth.onAuthStateChange((_event, session) => { if (!session) { cache.clear(); close(); } });
  document.addEventListener('click', e => { const button = e.target.closest('.dh-button'); if (!button) return; e.preventDefault(); e.stopPropagation(); open(button); });
})();
