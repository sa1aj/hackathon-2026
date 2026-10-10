// Knightro Tracker frontend. One persistent Leaflet map; panels slide over it.
// SECURITY: captions are typed by strangers. Every piece of text goes into the page with
// textContent / text nodes (see h() below). Never use innerHTML with API data.
(function () {
  'use strict';
  const { CONFIG, IMG, api, pixelPhoto, hash, sfx, fx } = window.KT;
  const $ = (sel) => document.querySelector(sel);

  /** Build DOM safely: string children become text nodes, never HTML. */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  // ---------- time + places ----------
  const nowSec = () => Date.now() / 1000;
  const ageSec = (s) => Math.max(0, nowSec() - s.timestamp);
  function timeAgo(s) {
    const m = Math.floor(ageSec(s) / 60);
    return m < 1 ? 'just now' : `${m} min ago`;
  }
  const shortAgo = (s) => `${Math.max(1, Math.floor(ageSec(s) / 60))}M`;
  const clock = (s) => new Date(s.timestamp * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  let buildings = [];
  fetch(CONFIG.BUILDINGS_URL)
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d) => {
      buildings = d.buildings || [];
      render();
    })
    .catch(() => { /* labels fall back to "On campus" when opened as a local file */ });

  function placeName(lat, long) {
    let best = null, bestD = Infinity;
    for (const b of buildings) {
      const dy = (b.lat - lat) * 111320;
      const dx = (b.long - long) * 111320 * Math.cos((lat * Math.PI) / 180);
      const d = Math.hypot(dx, dy);
      if (d < bestD) [best, bestD] = [b, d];
    }
    if (!best || bestD > 600) return 'On campus';
    return `${bestD <= 80 ? 'At' : 'Near'} ${best.name}`;
  }
  const B = CONFIG.CAMPUS_BOUNDS;
  const onCampus = (p) => p && p.lat >= B.minLat && p.lat <= B.maxLat && p.lng >= B.minLng && p.lng <= B.maxLng;
  const isMobile = () => matchMedia('(max-width: 720px)').matches;

  function photoFor(s) {
    const list = CONFIG.STOCK_PHOTOS;
    if (list.length) return { src: list[hash(s.sightingId) % list.length], pixel: false };
    return { src: pixelPhoto(s.sightingId), pixel: true };
  }

  // ---------- state ----------
  const state = {
    sightings: [],
    loaded: false,
    netError: '',
    panel: null, // 'report' | 'recent' | 'detail'
    backTo: null,
    selectedId: null,
    report: null,
  };
  const newReport = () => ({ step: 'location', pin: null, gps: null, caption: '', submitting: false, error: '', result: null });
  const myPosts = new Set(); // ids this device just posted, so we don't announce them as "new"
  const enteredAt = new Map(); // sightingId -> time its pin first appeared (drives the drop-in animation)

  // ---------- map (created once, never replaced) ----------
  const map = L.map('map', {
    center: [CONFIG.CAMPUS_CENTER.lat, CONFIG.CAMPUS_CENTER.lng],
    zoom: 16,
    minZoom: 14,
    maxZoom: 19,
    zoomControl: false,
    maxBounds: [[B.minLat - 0.01, B.minLng - 0.012], [B.maxLat + 0.01, B.maxLng + 0.012]],
  });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  map.on('zoomend', () => sfx.play('tick'));
  window.KT.map = map; // handy for debugging in dev tools

  const markers = new Map();
  let dropPin = null;
  const DROP_MS = 900;

  function sightingIcon(s, selected, newest) {
    const age = ageSec(s);
    const fresh = age < CONFIG.FRESH_SEC;
    const opacity = Math.max(0.55, 1 - (age / CONFIG.ACTIVE_WINDOW_SEC) * 0.45);
    const since = performance.now() - (enteredAt.get(s.sightingId) || -1e9);
    const entering = since < DROP_MS + (enteredAt.get(`${s.sightingId}:delay`) || 0);
    const cls = ['kt-pin', 's', fresh && 'fresh', selected && 'sel', newest && 'newest', entering && 'enter'].filter(Boolean).join(' ');
    const delay = entering ? enteredAt.get(`${s.sightingId}:delay`) || 0 : 0;
    // Only our own static markup and numbers go in here, never caption text.
    return L.divIcon({
      className: cls,
      html: `<div class="kt-pin-body" style="--d:${delay}ms"><div class="kt-pin-inner" style="opacity:${opacity.toFixed(2)}"><img src="${IMG.helm}" alt=""></div><span class="age">${shortAgo(s)}</span></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }
  const dropIcon = L.divIcon({ className: 'kt-drop', html: `<img src="${IMG.pin}" alt="">`, iconSize: [36, 36], iconAnchor: [18, 36] });

  function renderMarkers() {
    const seen = new Set();
    const newestId = state.sightings[0]?.sightingId;
    for (const s of state.sightings) {
      seen.add(s.sightingId);
      const icon = sightingIcon(s, state.panel === 'detail' && state.selectedId === s.sightingId, s.sightingId === newestId);
      let m = markers.get(s.sightingId);
      if (!m) {
        m = L.marker([s.lat, s.long], { icon, keyboard: true, title: `Sighting ${placeName(s.lat, s.long)}`, alt: 'Knightro sighting', riseOnHover: true })
          .on('click', () => openDetail(s.sightingId))
          .on('mouseover', () => sfx.play('hover'))
          .addTo(map);
        markers.set(s.sightingId, m);
      } else {
        m.setIcon(icon);
      }
      m.setZIndexOffset(s.sightingId === newestId ? 500 : 0);
    }
    for (const [id, m] of markers) {
      if (!seen.has(id)) {
        const el = m.getElement();
        if (el && !fx.reducedMotion()) {
          el.classList.add('leave'); // shrink away, then remove
          setTimeout(() => m.remove(), 400);
        } else m.remove();
        markers.delete(id);
      }
    }
    // Report pin
    const picking = state.panel === 'report' && state.report?.step === 'location' && state.report.pin;
    if (picking && !dropPin) {
      dropPin = L.marker([state.report.pin.lat, state.report.pin.lng], { icon: dropIcon, draggable: true, zIndexOffset: 1000, title: 'Sighting location. Drag to adjust.' })
        .on('dragstart', () => {
          sfx.play('grab');
          dropPin.getElement()?.classList.add('lifted');
        })
        .on('dragend', (e) => {
          dropPin.getElement()?.classList.remove('lifted');
          setPin(e.target.getLatLng());
        })
        .addTo(map);
      fx.replay(dropPin.getElement(), 'bounce');
    } else if (picking) {
      dropPin.setLatLng([state.report.pin.lat, state.report.pin.lng]);
    } else if (!picking && dropPin) {
      dropPin.remove();
      dropPin = null;
    }
    $('#map').classList.toggle('picking', state.panel === 'report' && state.report?.step === 'location');
  }

  map.on('click', (e) => {
    if (state.panel === 'report' && state.report?.step === 'location') setPin(e.latlng);
  });

  function setPin(latlng) {
    state.report.pin = { lat: latlng.lat, lng: latlng.lng };
    sfx.play('place');
    render();
    fx.replay(dropPin?.getElement(), 'bounce');
  }

  /** Center a point in the part of the map the panel isn't covering. */
  function focusOn(lat, lng, minZoom = 17) {
    const z = Math.max(map.getZoom(), minZoom);
    const size = map.getSize();
    const panel = $('#panel'), status = $('#status');
    const open = panel.classList.contains('open');
    let target = L.point(size.x / 2, size.y / 2);
    if (open && isMobile()) target = L.point(size.x / 2, (status.offsetTop + status.offsetHeight + panel.offsetTop) / 2);
    else if (open) target = L.point(panel.offsetLeft / 2, size.y / 2 - 40);
    const offset = L.point(size.x / 2, size.y / 2).subtract(target);
    sfx.play('whoosh');
    map.flyTo(map.unproject(map.project([lat, lng], z).add(offset), z), z, { duration: 0.7, easeLinearity: 0.2 });
  }

  // ---------- data ----------
  let inFlight = false;
  async function refresh({ quiet = false } = {}) {
    if (inFlight) return;
    inFlight = true;
    const firstLoad = !state.hasData; // first successful load: drop all pins in, announce nothing
    const wasOffline = !!state.netError;
    try {
      const list = await api.getSightings();
      const known = new Set(state.sightings.map((s) => s.sightingId));
      const fresh = list.filter((s) => !known.has(s.sightingId));
      const now = performance.now();
      // Oldest first so the newest pin lands last.
      [...fresh].reverse().forEach((s, i) => {
        enteredAt.set(s.sightingId, now);
        enteredAt.set(`${s.sightingId}:delay`, firstLoad ? i * 90 : 0);
        if (firstLoad) setTimeout(() => sfx.play('pinDrop'), 400 + i * 90);
      });
      state.sightings = list;
      state.hasData = true;
      state.netError = '';
      if (wasOffline && !quiet) {
        sfx.play('online');
        fx.toast('BACK ONLINE', 'Live sightings are updating again.', 'good', 1800);
      }
      const others = fresh.filter((s) => !myPosts.has(s.sightingId));
      if (!firstLoad && others.length) announce(others[0], others.length);
    } catch (err) {
      if (!state.netError) {
        sfx.play('offline');
        fx.toast('CONNECTION LOST', err.message, 'bad', 3200);
      }
      state.netError = err.message;
    } finally {
      state.loaded = true;
      inFlight = false;
      // Don't rebuild the report form under someone who is typing; everything else refreshes.
      render({ panel: state.panel !== 'report' });
      fx.replay($('#status'), 'blink');
    }
  }
  function announce(s, count) {
    sfx.play('newSighting');
    fx.toast(count > 1 ? `${count} NEW SIGHTINGS!` : 'NEW SIGHTING!', `${placeName(s.lat, s.long)}${s.caption ? ` · “${s.caption}”` : ''}`, 'gold');
    const el = markers.get(s.sightingId)?.getElement();
    if (el) {
      const r = el.getBoundingClientRect();
      fx.burst(r.left + r.width / 2, r.top + r.height / 2, 40, 0.6);
    }
  }
  setInterval(() => { if (!document.hidden) refresh(); }, CONFIG.POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  // ---------- panels ----------
  const TITLES = { report: 'REPORT A SIGHTING', recent: 'ACTIVE SIGHTINGS', detail: 'SIGHTING' };

  function openPanel(name, backTo = null) {
    if (state.panel === name && name !== 'detail') return closePanel();
    sfx.play(state.panel ? 'switch' : 'open');
    state.report = name === 'report' ? newReport() : null;
    state.panel = name;
    state.backTo = backTo;
    render();
    if (name === 'report') locate();
    $('#panel-close').focus({ preventScroll: true });
  }
  function closePanel() {
    if (!state.panel) return;
    sfx.play('close');
    state.panel = null;
    state.report = null;
    render();
  }
  function openDetail(id, backTo = null) {
    if (state.panel === 'report') return; // pins aren't selectable while placing the report pin
    sfx.play(state.panel ? 'switch' : 'open');
    state.selectedId = id;
    state.panel = 'detail';
    state.backTo = backTo;
    render();
  }

  $('#panel-close').addEventListener('click', closePanel);
  $('#panel-back').addEventListener('click', () => state.backTo && openPanel(state.backTo));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.panel) closePanel(); });
  document.querySelectorAll('[data-panel]').forEach((b) => b.addEventListener('click', () => openPanel(b.dataset.panel)));

  // ---------- report flow ----------
  let locateId = 0;
  const GPS_MSG = {
    locating: 'Finding your location…',
    ok: 'GPS placed the pin. Drag it or tap the map if it is off.',
    denied: 'Location permission was denied. Drag the pin or tap the map where you saw Knightro.',
    failed: "Couldn't get your location. Drag the pin or tap the map where you saw Knightro.",
    offcampus: "You don't appear to be on main campus. Drag the pin or tap the map where you saw Knightro.",
    unsupported: 'Location needs HTTPS (or localhost). Drag the pin or tap the map where you saw Knightro.',
  };
  function locate() {
    const r = state.report;
    if (!r) return;
    const id = ++locateId;
    const fallback = (gps) => {
      if (id !== locateId || state.report !== r) return;
      const c = map.getCenter();
      r.gps = gps;
      r.pin = r.pin || (onCampus({ lat: c.lat, lng: c.lng }) ? { lat: c.lat, lng: c.lng } : { ...CONFIG.CAMPUS_CENTER });
      sfx.play('place');
      render();
    };
    if (!navigator.geolocation || !window.isSecureContext) return fallback('unsupported');
    r.gps = 'locating';
    render();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (id !== locateId || state.report !== r) return;
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!onCampus(p)) return fallback('offcampus');
        r.gps = 'ok';
        r.pin = p;
        sfx.play('place');
        render();
        focusOn(p.lat, p.lng, 18);
      },
      (err) => fallback(err.code === 1 ? 'denied' : 'failed'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  async function submitReport() {
    const r = state.report;
    r.submitting = true;
    r.error = '';
    sfx.play('click');
    render();
    try {
      const res = await api.postSighting({ lat: r.pin.lat, long: r.pin.lng, caption: r.caption });
      if (state.report !== r) return; // panel was closed meanwhile
      myPosts.add(res.sightingId);
      r.result = res;
      r.step = 'done';
      sfx.play('success');
      const btn = $('#btn-report').getBoundingClientRect();
      fx.burst(btn.left + btn.width / 2, btn.top, 120);
      await refresh({ quiet: true });
      fx.toast('SIGHTING POSTED!', 'Thanks, Knight! Everyone can see it for 20 minutes.', 'good');
    } catch (err) {
      if (state.report !== r) return;
      r.error = err.message;
      sfx.play('error');
      fx.replay($('#panel'), 'shake');
      fx.toast("COULDN'T POST", err.message, 'bad', 2800);
    } finally {
      r.submitting = false;
      render();
    }
  }

  function reportView(r) {
    const idx = r.step === 'location' ? 0 : 1;
    const steps = h('ol', { class: 'steps' },
      [['location', 'LOCATION'], ['details', 'DETAILS']].map(([k, label], i) =>
        h('li', { class: i === idx ? 'on' : i < idx ? 'done' : '', 'aria-current': i === idx ? 'step' : null }, `${i + 1}. ${label}`)
      )
    );

    if (r.step === 'location') {
      const pinOk = onCampus(r.pin);
      const warn = ['denied', 'failed', 'offcampus', 'unsupported'].includes(r.gps);
      return [
        steps,
        h('p', { class: 'small' }, 'Where did you see Knightro? Confirm the gold pin on the map. Drag it, or tap the map to move it.'),
        r.gps && h('div', { class: `msg${warn ? ' warn' : ''}${r.gps === 'locating' ? ' scanning' : ''}` }, GPS_MSG[r.gps]),
        r.pin && h('dl', { class: 'kv' }, h('dt', {}, 'PIN'), h('dd', {}, pinOk ? placeName(r.pin.lat, r.pin.lng) : 'Off campus. Move the pin onto main campus.')),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'px-btn alt sm', onclick: () => { sfx.play('click'); locate(); }, disabled: r.gps === 'locating' }, 'USE MY LOCATION'),
          r.pin && h('button', { type: 'button', class: 'px-btn alt sm', onclick: () => focusOn(r.pin.lat, r.pin.lng) }, 'SHOW PIN')
        ),
        h('div', { class: 'panel-foot' },
          h('span'),
          h('button', {
            type: 'button',
            class: 'px-btn',
            disabled: !pinOk,
            onclick: () => { sfx.play('switch'); r.step = 'details'; render(); },
          }, 'CONFIRM LOCATION')
        ),
      ];
    }

    if (r.step === 'details') {
      const counter = h('span', { class: 'muted small counter' }, `${r.caption.length}/${CONFIG.CAPTION_MAX}`);
      const ta = h('textarea', { id: 'rep-caption', maxlength: CONFIG.CAPTION_MAX, placeholder: 'Knightro is near the Student Union' });
      ta.value = r.caption;
      ta.addEventListener('input', () => {
        r.caption = ta.value;
        counter.textContent = `${ta.value.length}/${CONFIG.CAPTION_MAX}`;
        counter.classList.toggle('near', ta.value.length > CONFIG.CAPTION_MAX - 20);
        sfx.play('type');
      });
      return [
        steps,
        h('dl', { class: 'kv' }, h('dt', {}, 'WHERE'), h('dd', {}, placeName(r.pin.lat, r.pin.lng))),
        h('div', { class: 'field' }, h('label', { class: 'label', for: 'rep-caption' }, 'What is he doing? (optional)'), ta, counter),
        h('p', { class: 'muted small' }, 'Your sighting appears on the map for everyone for 20 minutes. Reports are anonymous.'),
        r.error && h('div', { class: 'msg err', role: 'alert' }, r.error),
        h('div', { class: 'panel-foot' },
          h('button', { type: 'button', class: 'px-btn alt', disabled: r.submitting, onclick: () => { sfx.play('switch'); r.step = 'location'; r.error = ''; render(); } }, 'BACK'),
          h('button', { type: 'button', class: `px-btn${r.submitting ? ' loading' : ''}`, disabled: r.submitting, onclick: submitReport }, r.submitting ? 'POSTING…' : 'POST SIGHTING')
        ),
      ];
    }

    // done
    return [
      h('div', { class: 'victory' }, h('img', { src: IMG.helm, alt: '' }), h('h3', {}, 'SIGHTING POSTED')),
      h('dl', { class: 'kv' }, h('dt', {}, 'WHERE'), h('dd', {}, placeName(r.pin.lat, r.pin.lng))),
      h('div', { class: 'msg', role: 'status' }, 'Thanks! Your sighting is on the map for everyone for the next 20 minutes.'),
      h('div', { class: 'panel-foot' },
        h('button', { type: 'button', class: 'px-btn alt', onclick: closePanel }, 'CLOSE'),
        h('button', {
          type: 'button',
          class: 'px-btn',
          onclick: () => {
            const id = r.result?.sightingId;
            const s = state.sightings.find((x) => x.sightingId === id);
            if (s) {
              openDetail(s.sightingId);
              focusOn(s.lat, s.long);
            } else closePanel();
          },
        }, 'VIEW ON MAP')
      ),
    ];
  }

  function recentView() {
    if (!state.loaded) return [h('p', { class: 'muted' }, 'Loading sightings…')];
    if (state.netError && !state.hasData) {
      return [h('h3', {}, "CAN'T LOAD SIGHTINGS"), h('div', { class: 'msg err' }, `${state.netError} Retrying every few seconds.`)];
    }
    if (!state.sightings.length) {
      return [
        h('div', { class: 'empty' }, h('img', { src: IMG.helm, alt: '' }), h('h3', {}, 'NO ACTIVE SIGHTINGS')),
        h('p', { class: 'muted' }, 'Nobody has reported Knightro in the last 20 minutes. Spot him? Tap REPORT SIGHTING.'),
      ];
    }
    return state.sightings.map((s) => {
      const photo = photoFor(s);
      return h('button', { type: 'button', class: 'feed-item', onclick: () => { openDetail(s.sightingId, 'recent'); focusOn(s.lat, s.long); } },
        h('img', { src: photo.src, alt: '', class: photo.pixel ? 'pixel' : null }),
        h('span', { class: 'feed-text' },
          h('strong', {}, placeName(s.lat, s.long)),
          h('span', { class: 'muted small' }, `${timeAgo(s)} · ${clock(s)}`),
          s.caption && h('span', { class: 'small' }, s.caption)
        )
      );
    });
  }

  function detailView() {
    const s = state.sightings.find((x) => x.sightingId === state.selectedId);
    if (!s) return [h('p', { class: 'muted' }, 'This sighting is more than 20 minutes old and has left the map.')];
    const fresh = ageSec(s) < CONFIG.FRESH_SEC;
    const photo = photoFor(s);
    return [
      h('div', { class: 'label' }, s.sightingId === state.sightings[0].sightingId ? 'Latest sighting' : 'Sighting'),
      h('figure', { class: 'photo-fig' },
        h('img', { class: `photo${photo.pixel ? ' pixel' : ''}`, src: photo.src, alt: 'Illustration of Knightro' }),
        h('figcaption', { class: 'label' }, 'Stock image. Sighting photos are not uploaded yet.')
      ),
      h('div', { class: `fresh-note ${fresh ? 'live' : 'old'}` },
        fresh ? `SPOTTED ${timeAgo(s).toUpperCase()}. HE MAY STILL BE NEARBY.` : `SEEN ${timeAgo(s).toUpperCase()}. HE MAY HAVE MOVED ON.`),
      h('h3', {}, placeName(s.lat, s.long).toUpperCase()),
      h('dl', { class: 'kv' }, h('dt', {}, 'SEEN'), h('dd', {}, `${clock(s)} (${timeAgo(s)})`)),
      s.caption && h('p', { class: 'quote' }, s.caption),
    ];
  }

  // ---------- render ----------
  let lastViewKey = '';
  let viewShownAt = 0;
  let lastCount = -1;
  let lastTickerKey = '';

  function render({ panel: updatePanel = true } = {}) {
    const panel = $('#panel');
    const open = !!state.panel;
    panel.classList.toggle('open', open);
    panel.setAttribute('aria-hidden', String(!open));
    panel.inert = !open;
    if (!open) lastViewKey = '';
    if (open && updatePanel) {
      $('#panel-title').textContent = TITLES[state.panel];
      $('#panel-back').hidden = !(state.panel === 'detail' && state.backTo);
      const view = (state.panel === 'report' ? reportView(state.report) : state.panel === 'recent' ? recentView() : detailView()).filter(Boolean);
      const body = $('#panel-body');
      const scroll = body.scrollTop;
      const focusedId = document.activeElement?.id;
      body.replaceChildren(...view);
      // Stagger the content in only when the view changes, not on every background refresh.
      const key = `${state.panel}:${state.report?.step || ''}:${state.selectedId || ''}`;
      if (key !== lastViewKey) {
        view.forEach((el, i) => el.style.setProperty('--i', Math.min(i, 10)));
        fx.replay(body, 'stagger');
        body.scrollTop = 0;
        lastViewKey = key;
        viewShownAt = performance.now();
      } else {
        // Same view re-rendered (GPS answered, pin moved, data refreshed). If the entrance is still
        // playing, continue it from where it is; otherwise show the new elements without replaying it.
        const elapsed = performance.now() - viewShownAt;
        view.forEach((el, i) => {
          if (elapsed < 800) {
            el.style.setProperty('--i', Math.min(i, 10));
            el.style.animationDelay = `calc(var(--i) * 50ms + 90ms - ${Math.round(elapsed)}ms)`;
          } else el.classList.add('no-anim');
        });
        body.scrollTop = scroll;
      }
      if (focusedId && body.querySelector(`#${focusedId}`)) body.querySelector(`#${focusedId}`).focus();
    }

    // Report button doubles as cancel while reporting.
    const reporting = state.panel === 'report';
    $('#btn-report').classList.toggle('active', reporting);
    $('#report-label').textContent = !reporting ? 'REPORT SIGHTING' : state.report?.step === 'done' ? 'CLOSE REPORT' : 'CANCEL REPORT';
    $('#btn-recent').classList.toggle('active', state.panel === 'recent');

    renderMarkers();

    // Count badge with a little tweened pop.
    const count = state.sightings.length;
    const badge = $('#recent-count');
    badge.hidden = !count;
    if (count !== lastCount) {
      const from = Math.max(0, lastCount);
      fx.tween({ from, to: count, duration: 500, onUpdate: (v) => (badge.textContent = Math.round(v)) });
      if (lastCount >= 0) fx.replay(badge, 'pop');
      lastCount = count;
    }

    // Ticker: typed out when the message changes; ages update quietly.
    const latest = state.sightings[0];
    const tickerKey = !state.loaded ? 'loading' : state.netError ? 'error' : latest ? latest.sightingId : 'empty';
    const tickerText = !state.loaded
      ? 'CONNECTING TO KNIGHTRO HQ…'
      : state.netError
        ? "CAN'T REACH THE SERVER. RETRYING…"
        : latest
          ? `LAST SEEN: ${placeName(latest.lat, latest.long).toUpperCase()} · ${timeAgo(latest).toUpperCase()}${latest.caption ? ` · “${latest.caption.toUpperCase()}”` : ''}`
          : 'NO SIGHTINGS IN THE LAST 20 MINUTES. SPOT KNIGHTRO? TAP REPORT.';
    const tickerEl = $('#ticker-text');
    if (tickerKey !== lastTickerKey) {
      fx.typewriter(tickerEl, tickerText, { sound: lastTickerKey !== '' });
      lastTickerKey = tickerKey;
    } else if (tickerEl.dataset.full !== tickerText) {
      tickerEl.dataset.full = tickerText; // e.g. "2 MIN AGO" -> "3 MIN AGO": no retyping
      if (!tickerEl._typing) tickerEl.textContent = tickerText;
    }
    $('#ticker').classList.toggle('bad', !!state.netError);

    $('#status-text').textContent = !state.loaded ? 'CONNECTING…' : state.netError ? 'OFFLINE' : `LIVE · ${count} ACTIVE`;
    $('#status').classList.toggle('bad', !!state.netError);
  }

  // ---------- chrome ----------
  $('#plaque-helm').src = IMG.helm;
  document.querySelectorAll('img[data-icon]').forEach((img) => (img.src = IMG[img.dataset.icon]));
  $('#btn-recenter').addEventListener('click', () => {
    map.flyTo([CONFIG.CAMPUS_CENTER.lat, CONFIG.CAMPUS_CENTER.lng], 16, { duration: 0.7 });
    sfx.play('whoosh');
    fx.replay($('#btn-recenter'), 'spin');
  });
  const soundBtn = $('#btn-sound');
  const paintSound = () => {
    const on = sfx.enabled();
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    soundBtn.classList.toggle('muted', !on);
  };
  soundBtn.addEventListener('click', () => {
    const on = !sfx.enabled();
    sfx.set(on);
    paintSound();
    sfx.play(on ? 'toggleOn' : 'toggleOff');
    fx.replay(soundBtn, 'pop');
  });
  paintSound();

  // Hover + press sounds for every button (mouse only, so phones don't double up).
  document.addEventListener('pointerover', (e) => {
    const b = e.target.closest('button:not(:disabled)');
    if (b && e.pointerType === 'mouse' && !b.contains(e.relatedTarget)) sfx.play('hover');
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.tile, .report-btn');
    if (b) fx.replay(b, 'press');
  });

  // Boot sequence: CRT power-on, chrome tweens in, then the first data load drops the pins.
  // Browsers block sound until a tap, so the power-on chime plays on a tap in the first few seconds.
  const loadedAt = performance.now();
  addEventListener('pointerdown', () => { if (performance.now() - loadedAt < 6000) sfx.play('boot'); }, { once: true });
  setTimeout(() => document.body.classList.remove('booting'), 2200);

  render();
  refresh();
})();
