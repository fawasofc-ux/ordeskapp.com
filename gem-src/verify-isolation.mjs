// Proves two accounts on one browser cannot see each other's books.
// Replicates the cache-key and legacy-claim rules from store.js.
let failures = 0;
const chk = (l, a, e) => { const ok = a === e; if (!ok) failures++; console.log(`${ok?'  ok ':'FAIL '} ${l}: ${a}${ok?'':` (expected ${e})`}`); };

const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};

const CACHE_PREFIX = 'gem-dashboard-cache-v2';
const LEGACY_OWNER_KEY = 'gem-legacy-owner';
let ownerId = null;
const cacheKey = () => (ownerId ? `${CACHE_PREFIX}:${ownerId}` : null);
const writeCache = (s) => { const k = cacheKey(); if (k) localStorage.setItem(k, JSON.stringify(s)); };
const readCache = () => { const k = cacheKey(); if (!k) return null; const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; };
const claimLegacy = () => { if (ownerId && !localStorage.getItem(LEGACY_OWNER_KEY)) localStorage.setItem(LEGACY_OWNER_KEY, ownerId); };
const findLegacy = () => {
  const by = localStorage.getItem(LEGACY_OWNER_KEY);
  if (by && by !== ownerId) return null;
  const raw = localStorage.getItem('gem-dashboard-v1');
  return raw ? JSON.parse(raw) : null;
};
const teardown = () => { const k = cacheKey(); if (k) localStorage.removeItem(k); ownerId = null; };

const FAWAZ = 'dd860e18-fawaz', ILHAM = 'aaaa1111-ilham';
localStorage.setItem('gem-dashboard-v1', JSON.stringify({ sales: [{ amount: 311025 }] })); // pre-DB books
localStorage.setItem(CACHE_PREFIX, JSON.stringify({ sales: ['STALE SHARED'] }));            // old un-keyed cache

console.log('— Account A (existing business) —');
ownerId = FAWAZ;
localStorage.removeItem(CACHE_PREFIX);            // init clears the legacy shared cache
writeCache({ sales: ['FAWAZ GEMS'] });
claimLegacy();                                    // non-empty account claims the legacy books
chk('A reads its own cache', readCache().sales[0], 'FAWAZ GEMS');
chk('old shared cache removed', localStorage.getItem(CACHE_PREFIX), null);
chk('legacy claimed by A', localStorage.getItem(LEGACY_OWNER_KEY), FAWAZ);
teardown();
chk('A cache cleared on sign-out', localStorage.getItem(`${CACHE_PREFIX}:${FAWAZ}`), null);

console.log('— Account B (new business, same browser) —');
ownerId = ILHAM;
chk('B sees NO cached books', readCache(), null);
chk('B is NOT offered A legacy books', findLegacy(), null);
writeCache({ sales: ['ILHAM GEMS'] });
chk('B reads only its own cache', readCache().sales[0], 'ILHAM GEMS');

console.log('— Back to account A —');
teardown(); ownerId = FAWAZ;
chk('A still not shown B data', readCache(), null);
chk('A may still see its own legacy backup', findLegacy() !== null, true);
chk('legacy raw data preserved as backup', JSON.parse(localStorage.getItem('gem-dashboard-v1')).sales[0].amount, 311025);

console.log(failures === 0 ? '\nACCOUNT ISOLATION VERIFIED ✔' : `\n${failures} FAILED ✘`);
process.exit(failures ? 1 : 0);
