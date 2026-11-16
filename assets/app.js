/* Japanese Scenes — library and reader. No build step, no dependencies. */
(() => {
  'use strict';

  // ---------- safe HTML ----------
  // Comic text may carry <ruby>/<rt> markup; art is inline SVG. Everything is
  // passed through an allow-list so a contributed comic can't inject script.
  const TEXT_TAGS = new Set(['RUBY', 'RT', 'RP', 'RB', 'BR', 'B', 'STRONG', 'EM', 'I', 'SPAN']);
  const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'use', 'title']);

  function clean(node, allowed, svg) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); continue; }
      const name = svg ? child.tagName.toLowerCase() : child.tagName.toUpperCase();
      if (!allowed.has(name)) {
        if (svg) child.remove(); else child.replaceWith(...child.childNodes);
        continue;
      }
      for (const attr of [...child.attributes]) {
        const n = attr.name.toLowerCase();
        const v = attr.value.trim().toLowerCase();
        if (n.startsWith('on') || n === 'style' && !svg || (n === 'href' || n === 'xlink:href') && !v.startsWith('#')) {
          child.removeAttribute(attr.name);
        }
      }
      clean(child, allowed, svg);
    }
  }

  function safeText(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html || '';
    clean(tpl.content, TEXT_TAGS, false);
    return tpl.content;
  }

  function safeSvg(markup, cls) {
    if (!markup) return null;
    if (!/^<svg[^>]*\sxmlns=/.test(markup)) markup = markup.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
    clean(svg, SVG_TAGS, true);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', cls);
    return document.importNode(svg, true);
  }

  // ---------- tiny DOM helper ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.append(safeText(v));
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }

  const ICON = {
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg>',
  };
  const icon = (name) => { const t = document.createElement('template'); t.innerHTML = ICON[name]; return t.content.firstChild; };

  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  const plain = (html) => { const f = safeText(html); f.querySelectorAll('rt, rp').forEach((n) => n.remove()); return f.textContent.replace(/\s+/g, ' ').trim(); };

  function showError(root, msg) {
    root.replaceChildren(h('div', { class: 'error wrap', role: 'alert' },
      h('p', {}, msg),
      h('p', {}, h('a', { href: './' }, 'Back to the library'))));
  }

  // ---------- shared renderers ----------
  function artLayer(art) {
    return [
      safeSvg(art.left, 'art-left'),
      safeSvg(art.right, 'art-right'),
      safeSvg(art.prop, 'art-prop'),
    ];
  }

  function lineBlock(line, { headingLevel } = {}) {
    const romaji = h('p', { class: 'line-romaji' }, line.romaji);
    const en = h('p', { class: 'line-en' }, line.en);
    const reveal = (cls, target, label) => h('button', {
      type: 'button', class: `reveal ${cls}`,
      onclick: (e) => { target.classList.add('shown'); e.currentTarget.classList.add('used'); },
    }, label);
    return [
      h('span', { class: `speaker ${line.speaker || 'other'}`, html: line.label }),
      h('p', { class: 'line-ja', lang: 'ja', html: line.ja }),
      reveal('romaji', romaji, 'Show romaji'), romaji,
      reveal('en', en, 'Show English'), en,
    ];
  }

  // ---------- library ----------
  async function library(root) {
    let index;
    try { index = await getJSON('comics/index.json'); }
    catch (e) { return showError(root, 'Could not load the comic list. If you opened this file directly, serve the folder over HTTP (see README).'); }

    const comics = index.comics || [];
    const covers = new Map();
    await Promise.all(comics.map(async (c) => {
      try {
        const full = await getJSON(`comics/${encodeURIComponent(c.id)}/comic.json`);
        const panels = full.scenes.flatMap((s) => s.panels);
        covers.set(c.id, panels.find((p) => p.art && p.art.prop && p.art.left && p.art.right) || panels[0]);
      } catch { /* cover is optional */ }
    }));

    const allTags = [...new Set(comics.flatMap((c) => c.tags || []))].sort();
    const state = { q: '', tag: null };

    const search = h('input', {
      class: 'search', type: 'search', placeholder: 'Search comics — e.g. restaurant, 注文, paying',
      'aria-label': 'Search comics',
      oninput: (e) => { state.q = e.target.value.trim().toLowerCase(); draw(); },
    });
    const tagButtons = allTags.map((t) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': 'false',
      onclick: () => { state.tag = state.tag === t ? null : t; draw(); },
    }, t));
    const shelf = h('div', { class: 'shelf', 'aria-live': 'polite' });

    function card(c) {
      const cover = covers.get(c.id);
      return h('a', { class: 'card', href: `read.html?comic=${encodeURIComponent(c.id)}&scene=1` },
        h('div', { class: 'cover panel', style: { backgroundColor: cover?.bg || '#FFF1D6' } },
          h('span', { class: 'cover-badge' }, `${c.scenes} scenes · ${c.panels} panels`),
          cover ? artLayer(cover.art) : null),
        h('div', { class: 'card-body' },
          h('h2', { lang: 'ja', html: c.titleJa }),
          h('p', { class: 'en' }, c.title),
          c.summary ? h('p', { class: 'summary' }, c.summary) : null,
          h('div', { class: 'card-meta' },
            c.level ? h('span', { class: 'chip', style: { background: 'var(--amber)' } }, c.level) : null,
            (c.tags || []).map((t) => h('span', { class: 'chip' }, t)))));
    }

    function draw() {
      tagButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === state.tag)));
      const hits = comics.filter((c) => {
        if (state.tag && !(c.tags || []).includes(state.tag)) return false;
        if (!state.q) return true;
        const hay = [c.title, plain(c.titleJa), c.titleJa, c.summary, ...(c.tags || [])].join(' ').toLowerCase();
        return hay.includes(state.q);
      });
      shelf.replaceChildren(...(hits.length ? hits.map(card) : [h('p', { class: 'empty' }, 'No comics match that search.')]));
    }

    root.replaceChildren(
      h('section', { class: 'wrap hero' },
        h('h1', { lang: 'ja', html: '<ruby>場面<rt>ばめん</rt></ruby>で<ruby>学<rt>まな</rt></ruby>ぶ<ruby>日本語<rt>にほんご</rt></ruby>' }),
        h('p', {}, 'Short comics of everyday situations in Japan. Every line comes with furigana, romaji and English — hide any of them to test yourself.')),
      h('section', { class: 'wrap' },
        h('div', { class: 'toolbar' }, search, allTags.length ? h('div', { class: 'tags', role: 'group', 'aria-label': 'Filter by tag' }, tagButtons) : null),
        shelf));
    draw();
  }

  // ---------- reader ----------
  async function reader(root) {
    const params = new URLSearchParams(location.search);
    const id = params.get('comic');
    if (!id || !/^[\w-]+$/.test(id)) return showError(root, 'No comic selected.');

    let comic;
    try { comic = await getJSON(`comics/${id}/comic.json`); }
    catch { return showError(root, `Comic “${id}” was not found.`); }

    const scenes = comic.scenes || [];
    const prefs = store.get('js-prefs', { furigana: true, romaji: true, en: true });
    const progressKey = `js-progress:${id}`;

    // site bar extras: title + display toggles
    const titleSlot = document.getElementById('reader-title');
    titleSlot.replaceChildren(h('a', { href: `read.html?comic=${encodeURIComponent(id)}&scene=1` },
      h('span', { class: 'ja', lang: 'ja', html: comic.titleJa })));
    titleSlot.hidden = false;

    const toggleDefs = [['furigana', 'Furigana'], ['romaji', 'Romaji'], ['en', 'English']];
    const toggleBox = document.getElementById('toggles');
    toggleBox.replaceChildren(h('span', { class: 'visually-hidden' }, 'Show:'), ...toggleDefs.map(([k, label]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(prefs[k]),
      onclick: (e) => { prefs[k] = !prefs[k]; e.currentTarget.setAttribute('aria-pressed', String(prefs[k])); store.set('js-prefs', prefs); applyPrefs(); },
    }, label)));
    toggleBox.hidden = false;

    function applyPrefs() {
      document.body.classList.toggle('hide-furigana', !prefs.furigana);
      document.body.classList.toggle('hide-romaji', !prefs.romaji);
      document.body.classList.toggle('hide-en', !prefs.en);
      // re-hide lines revealed one at a time when a toggle changes
      document.querySelectorAll('.shown').forEach((el) => el.classList.remove('shown'));
      document.querySelectorAll('.reveal.used').forEach((el) => el.classList.remove('used'));
    }
    applyPrefs();

    function sceneIndex() {
      const n = parseInt(new URLSearchParams(location.search).get('scene'), 10);
      const i = scenes.findIndex((s) => s.n === n);
      return i >= 0 ? i : 0;
    }
    const sceneHref = (s) => `read.html?comic=${encodeURIComponent(id)}&scene=${s.n}`;

    function panelEl(p) {
      const badgeSide = p.bubble.side === 'left' ? 'right' : 'left';
      return h('figure', { class: `panel${p.wide ? ' wide' : ''}`, style: { backgroundColor: p.bg || '#FFF1D6', margin: 0 } },
        h('span', { class: `panel-no ${badgeSide}`, 'aria-label': `Panel ${p.n}` }, String(p.n)),
        h('figcaption', { class: `bubble ${p.bubble.side}` }, lineBlock(p.bubble)),
        artLayer(p.art || {}));
    }

    function render() {
      const i = sceneIndex();
      const s = scenes[i];
      const prev = scenes[i - 1];
      const next = scenes[i + 1];
      store.set(progressKey, s.n);
      document.title = `${plain(s.title)} · ${s.subtitle} — ${comic.title}`;

      const pagerBtn = (target, dir) => {
        const label = target ? `Scene ${target.n}: ${target.subtitle}` : dir === 'prev' ? 'Library' : 'Back to library';
        return h('a', { class: `btn${dir === 'next' && target ? ' primary' : ''}`, href: target ? sceneHref(target) : './', rel: target ? dir : null },
          dir === 'prev' ? icon(target ? 'left' : 'grid') : null, label, dir === 'next' ? icon(target ? 'right' : 'grid') : null);
      };

      root.replaceChildren(h('div', { class: 'wrap' },
        h('nav', { class: 'scene-nav', 'aria-label': 'Scenes' }, scenes.map((sc) => h('a', {
          class: 'scene-tab', href: sceneHref(sc), 'aria-current': sc === s ? 'page' : null,
        }, h('span', { class: 'num' }, String(sc.n)), sc.subtitle))),
        h('article', { class: 'scene', 'aria-labelledby': 'scene-title' },
          h('header', { class: 'scene-head' },
            h('div', { class: 'scene-no', 'aria-hidden': 'true' }, h('span', {}, 'SCENE'), h('span', {}, String(s.n))),
            h('div', { class: 'scene-head-text' },
              h('h1', { id: 'scene-title', tabindex: '-1', lang: 'ja', html: s.title }),
              h('p', {}, s.subtitle)),
            s.location ? h('p', { class: 'location', lang: 'ja', html: s.location }) : null),
          h('div', { class: 'scene-body' },
            h('div', { class: 'panels' }, s.panels.map(panelEl)),
            s.phrases?.length ? h('aside', { class: 'phrases', 'aria-labelledby': 'phrases-title' },
              h('h2', { id: 'phrases-title', lang: 'ja', html: 'ほかの<ruby>言<rt>い</rt></ruby>い<ruby>方<rt>かた</rt></ruby>' }),
              h('p', {}, 'Other ways to say it'),
              h('div', { class: 'phrase-list' }, s.phrases.map((ph) => h('div', { class: 'phrase' }, lineBlock(ph))))) : null)),
        h('nav', { class: 'pager', 'aria-label': 'Scene navigation' },
          pagerBtn(prev, 'prev'),
          h('span', { class: 'kbd-hint' }, 'Tip: use ← → to turn scenes'),
          pagerBtn(next, 'next'))));
      applyPrefs();
      const tab = root.querySelector('.scene-tab[aria-current]');
      if (tab) tab.parentElement.scrollLeft = tab.offsetLeft - (tab.parentElement.clientWidth - tab.offsetWidth) / 2;
    }

    // client-side scene switching keeps toggles and scroll snappy
    root.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="read.html"]');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      const url = new URL(a.href);
      if (url.searchParams.get('comic') !== id) return;
      e.preventDefault();
      history.pushState(null, '', url);
      render();
      window.scrollTo({ top: 0 });
      document.getElementById('scene-title')?.focus({ preventScroll: true });
    });
    window.addEventListener('popstate', render);
    document.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const i = sceneIndex();
      const target = e.key === 'ArrowRight' ? scenes[i + 1] : e.key === 'ArrowLeft' ? scenes[i - 1] : null;
      if (!target) return;
      history.pushState(null, '', sceneHref(target));
      render();
      window.scrollTo({ top: 0 });
    });

    if (!params.get('scene')) {
      const last = store.get(progressKey, null);
      if (last != null) history.replaceState(null, '', sceneHref(scenes.find((s) => s.n === last) || scenes[0]));
    }
    render();
  }

  const root = document.getElementById('app');
  const page = document.body.dataset.page;
  if (page === 'library') library(root);
  else if (page === 'reader') reader(root);
})();
