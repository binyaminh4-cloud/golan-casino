(function (root) {
  'use strict';
  function resolve(entry) {
    const raw = String(entry.where || '');
    if (raw === 'poker_private') return { label: 'פוקר · שולחן פרטי', href: null };
    const [page, query = ''] = raw.split('?'), q = new URLSearchParams(query);
    if (page === 'poker.html') {
      const id = q.get('t');
      return { label: 'פוקר' + (entry.table_name ? ' · ' + entry.table_name : ''),
        href: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '') ? 'poker.html?t=' + encodeURIComponent(id) : null };
    }
    if (page === 'roulette.html') {
      const mode = ['lightning','xxx'].includes(q.get('mode')) ? q.get('mode') : 'classic';
      return { label: mode === 'classic' ? 'רולטה' : mode === 'lightning' ? 'רולטת ברקים X' : 'רולטת XXX',
        href: q.has('private') || q.has('duel') ? null : 'roulette.html' + (mode === 'classic' ? '' : '?mode=' + mode + (q.get('skin') === 'fish' ? '&skin=fish' : '')) };
    }
    if (page === 'zman.html') return { label: 'זמן למטווח', href: 'zman.html' };
    if (page === 'blackjack.html') return { label: 'בלאק ג׳ק', href: q.get('table') === '1' && !q.has('ch') ? 'blackjack.html?table=1' : null };
    const dealer = { tcp: 'פוקר שלושה קלפים', uth: 'הולדם מול הדילר', csp: 'פוקר קריבי' };
    if (page === 'dp.html' || /^(tcp|uth|csp)_live$/.test(page)) {
      const game = dealer[q.get('g')] ? q.get('g') : page.endsWith('_live') ? page.split('_')[0] : 'tcp';
      return { label: dealer[game], href: q.get('t') === '1' || page.endsWith('_live') ? 'dp.html?g=' + game + '&t=1' : null };
    }
    const games = { 'slots.html':'מכונות מזל', 'dragons.html':'דרקוני הגולן', 'wildwest.html':'המערב הפרוע',
      'kinneret.html':'על האש בכינרת', 'pachinko.html':'מכונת השירותים', 'protein.html':'שולה החלבון',
      'chicken.html':'עידו חוצה את הכביש', 'fisher90.html':'פישר בדקה ה־90', 'fishing.html':'גלגל הדגים של עידו' };
    if (games[page]) return { label: page === 'slots.html' && q.get('m') === 'fortune' ? 'מכונת האטרף' : games[page],
      href: page === 'fishing.html' ? page : null };
    return null;
  }
  root.GC_FRIEND_LOCATION = resolve;
  if (typeof document === 'undefined') return;
  let timer = null, busy = false, watchedSheet = null;
  const active = () => !document.hidden && document.getElementById('frSheet')?.classList.contains('on');
  async function refresh() {
    clearTimeout(timer); timer = null;
    const sheet = document.getElementById('frSheet');
    if (sheet && watchedSheet !== sheet) {
      watchedSheet = sheet;
      new MutationObserver(() => { if (active()) refresh(); else { clearTimeout(timer); timer = null; } })
        .observe(sheet, { attributes: true, attributeFilter: ['class'] });
    }
    if (!active() || busy) return;
    busy = true;
    try {
      const { data, error } = await db.rpc('gc_friend_locations');
      if (error || !Array.isArray(data) || !active()) return;
      const locations = new Map(data.map(x => [x.id, resolve(x)]));
      document.querySelectorAll('#frSheet .fr-list li').forEach(row => {
        const id = row.querySelector('.av[data-u]')?.dataset.u, value = locations.get(id);
        let badge = row.querySelector('.fr-live');
        if (!value) { badge?.remove(); return; }
        const text = 'משחק עכשיו · ' + value.label;
        if (badge && badge.textContent === text && badge.getAttribute('href') === value.href) return;
        badge?.remove(); badge = document.createElement(value.href ? 'a' : 'span');
        badge.className = 'fr-live'; badge.textContent = text;
        if (value.href) badge.setAttribute('href', value.href);
        row.querySelector('.nm')?.appendChild(badge);
      });
    } catch (e) { /* next visible refresh retries */ }
    finally { busy = false; if (active()) timer = setTimeout(refresh, 10000); }
  }
  root.GC_REFRESH_FRIEND_LOCATIONS = refresh;
  // Stop when the sheet closes; resume immediately when opened or made visible.
  document.addEventListener('visibilitychange', () => { if (active()) refresh(); else { clearTimeout(timer); timer = null; } });
})(typeof window === 'undefined' ? globalThis : window);
