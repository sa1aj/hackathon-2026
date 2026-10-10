// Pixel-art sprites drawn from character grids, plus a pixel "photo" used until stock photos are added.
(function () {
  'use strict';
  const PAL = { K: '#0c0c0e', G: '#ffc904', Y: '#fff1b0', S: '#c9ccd4', W: '#ffffff', D: '#3b3f4a' };

  const HELM = [
    '.......GGG......',
    '......GYYYG.....',
    '.....GYYG.......',
    '....KKKKKKKK....',
    '...KSSSSSSSSK...',
    '..KSWWSSSSSSSK..',
    '..KSWSSSSSSSSK..',
    '..KSSSSSSSSSSK..',
    '..KKKKKKKKKKKK..',
    '..KDDDDDDDDDDK..',
    '..KSSSSSSSSSSK..',
    '..KSSKSSSSKSSK..',
    '..KSSSSSSSSSSK..',
    '..KGGGGGGGGGGK..',
    '...KKKKKKKKKK...',
    '................',
  ];
  const KNIGHT = HELM.slice(0, 14).concat([
    '...KKKKKKKKKK...',
    '.KKGGGGKKGGGGKK.',
    'KGGGGGKYYKGGGGGK',
    'KGKGGGKYYKGGGKGK',
    'KGKKKKKKKKKKKKGK',
    'KSK.KGGGGGGK.KSK',
    '.K..KGGKKGGK..K.',
    '....KKK..KKK....',
    '....KDK..KDK....',
    '...KKKK..KKKK...',
  ]);
  const ICONS = {
    helm: HELM,
    map: ['..KKKKK..', '.KGGGGGK.', 'KGGKKKGGK', 'KGGK.KGGK', 'KGGKKKGGK', '.KGGGGGK.', '..KGGGK..', '...KGK...', '....K....'],
    camera: ['..KKK....', 'KKKKKKKKK', 'KGGGGGGGK', 'KGGKKKGGK', 'KGKWWWKGK', 'KGKWWWKGK', 'KGGKKKGGK', 'KGGGGGGGK', 'KKKKKKKKK'],
    speaker: ['....K....', '...KK..K.', 'KKKGK...K', 'KGGGK.K.K', 'KGGGK.K.K', 'KKKGK...K', '...KK..K.', '....K....', '.........'],
    pin: ['..KKKKK..', '.KGGGGGK.', 'KGGKKKGGK', 'KGGKWKGGK', 'KGGKKKGGK', '.KGGGGGK.', '..KGGGK..', '...KGK...', '....K....'],
  };

  function drawSprite(g, rows, ox, oy, s) {
    rows.forEach((r, y) =>
      [...r].forEach((ch, x) => {
        if (PAL[ch]) {
          g.fillStyle = PAL[ch];
          g.fillRect(ox + x * s, oy + y * s, s, s);
        }
      })
    );
  }
  function sprite(rows) {
    const c = document.createElement('canvas');
    c.width = rows[0].length;
    c.height = rows.length;
    drawSprite(c.getContext('2d'), rows, 0, 0, 1);
    return c.toDataURL();
  }

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    let h = 2166136261;
    for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  }

  /** A small pixel-art scene of Knightro on campus, varied by seed. */
  const cache = {};
  function pixelPhoto(seed) {
    if (cache[seed]) return cache[seed];
    const r = rng(hash(seed));
    const W = 96, H = 72;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    R(0, 0, W, 32, ['#7fb8e6', '#9ec9f0', '#f0a663', '#6f92d6'][Math.floor(r() * 4)]);
    for (let i = 0; i < 4; i++) { const x = Math.floor(r() * W), y = 3 + Math.floor(r() * 10); R(x, y, 12, 3, '#fff'); R(x + 3, y - 2, 6, 2, '#fff'); }
    R(0, 12, W, 24, ['#b9a27a', '#8f8f99', '#a68b6a', '#9a8f80'][Math.floor(r() * 4)]);
    for (let y = 15; y < 33; y += 6) for (let x = 3; x < W; x += 8) R(x, y, 4, 3, '#2b3a55');
    R(0, 34, W, H - 34, '#3f7d3c');
    R(0, 50, W, 8, '#c4b383');
    for (let i = 0; i < 60; i++) R(Math.floor(r() * W), 34 + Math.floor(r() * 38), 1, 1, '#4c8f48');
    const kx = 18 + Math.floor(r() * 46);
    R(kx + 4, 68, 24, 3, 'rgba(0,0,0,.35)');
    drawSprite(g, KNIGHT, kx, 22, 2);
    return (cache[seed] = c.toDataURL());
  }

  const IMG = {};
  for (const k in ICONS) IMG[k] = sprite(ICONS[k]);
  window.KT.IMG = IMG;
  window.KT.pixelPhoto = pixelPhoto;
  window.KT.hash = hash;
})();
