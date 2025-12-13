// sheet-firebase.js

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// URL params
const params = new URLSearchParams(window.location.search);
const charId = params.get('char') || 'unnamed';
const pageId = params.get('page') || 'core';

const metaEl = document.getElementById('meta');
const connEl = document.getElementById('connection-status');

if (metaEl) metaEl.textContent = `Character: ${charId} · Page: ${pageId}`;

// Data doc (character sheet values)
const docRef = db
  .collection('characters')
  .doc(charId)
  .collection('pages')
  .doc(pageId);

// Layout doc (template positions for this page)
const layoutRef = db
  .collection('layouts')
  .doc(pageId); // one layout per page (core/advancement/notes)

// Track definitions (absolute printed max)
const TRACK_DEFINITIONS = {
  armor: 12,
  hp: 12,
  stress: 12,
  hope: 10,
  gold_hand: 9,
  gold_bag: 9,
  proficiency: 6
};

function getAllFieldWrappers() {
  return Array.from(document.querySelectorAll('.field'));
}

function getControl(wrapper) {
  return wrapper.querySelector('input, textarea');
}

function getCurrentFieldsFromDom() {
  const data = {};
  getAllFieldWrappers().forEach(wrapper => {
    const key = wrapper.dataset.key;
    const control = getControl(wrapper);
    if (!key || !control) return;

    if (control.type === 'checkbox') data[key] = !!control.checked;
    else data[key] = control.value;
  });
  return data;
}

function applyFieldsToDom(fields) {
  if (!fields) return;
  getAllFieldWrappers().forEach(wrapper => {
    const key = wrapper.dataset.key;
    const control = getControl(wrapper);
    if (!key || !control) return;

    const value = fields[key];
    if (control.type === 'checkbox') control.checked = !!value;
    else control.value = value ?? '';
  });
}

function applyTrackMaxes(fields) {
  if (!fields) return;

  Object.entries(TRACK_DEFINITIONS).forEach(([baseKey, absoluteMax]) => {
    const maxKey = `${baseKey}_max`;
    let currentMax = parseInt(fields[maxKey], 10);

    if (isNaN(currentMax) || currentMax < 0) currentMax = absoluteMax;
    if (currentMax > absoluteMax) currentMax = absoluteMax;

    for (let i = 0; i < absoluteMax; i++) {
      const wrapper = document.querySelector(`.field[data-key="${baseKey}_${i}"]`);
      if (!wrapper) continue;
      const control = getControl(wrapper);
      if (!control) continue;

      if (i < currentMax) {
        control.disabled = false;
        wrapper.classList.remove('track-disabled');
      } else {
        if (control.type === 'checkbox') control.checked = false;
        else control.value = '';
        control.disabled = true;
        wrapper.classList.add('track-disabled');
      }
    }
  });
}

/* =========================
   LAYOUT (positions/sizes)
   layout doc format:
   {
     fields: {
       "name": { top: 10, left: 20, width: 200 },
       "class_feature": { top: 500, left: 10, width: 260, height: 110, lineHeight: 18 }
     },
     updatedAt: <ms>
   }
========================= */

function applyLayout(layout) {
  if (!layout || !layout.fields) return;

  Object.entries(layout.fields).forEach(([key, cfg]) => {
    const el = document.querySelector(`.field[data-key="${key}"]`);
    if (!el) return;

    // stop "parked" from fighting you
    el.classList.remove('parked');

    if (typeof cfg.top === 'number') el.style.top = cfg.top + 'px';
    if (typeof cfg.left === 'number') el.style.left = cfg.left + 'px';
    if (typeof cfg.right === 'number') el.style.right = cfg.right + 'px';
    if (typeof cfg.bottom === 'number') el.style.bottom = cfg.bottom + 'px';

    // Apply width/height/line-height to the control (not the wrapper)
    const control = getControl(el);
    if (control) {
      if (typeof cfg.width === 'number') control.style.width = cfg.width + 'px';
      if (typeof cfg.height === 'number') control.style.height = cfg.height + 'px';
      if (typeof cfg.lineHeight === 'number') control.style.lineHeight = cfg.lineHeight + 'px';
    }
  });
}

function collectLayoutFromDom() {
  const fields = {};

  getAllFieldWrappers().forEach(el => {
    const key = el.dataset.key;
    if (!key) return;

    const control = getControl(el);

    // Only store layout for non-track checkbox series if you want.
    // (Tracks are generated; leave them as-is unless you add containers to layout.)
    // We'll still store positions for any field wrapper that exists.
    const cfg = {};

    // Prefer top/left if present; otherwise bottom/right
    const top = parseFloat(el.style.top);
    const left = parseFloat(el.style.left);
    const bottom = parseFloat(el.style.bottom);
    const right = parseFloat(el.style.right);

    if (!Number.isNaN(top)) cfg.top = top;
    if (!Number.isNaN(left)) cfg.left = left;
    if (!Number.isNaN(bottom)) cfg.bottom = bottom;
    if (!Number.isNaN(right)) cfg.right = right;

    if (control) {
      const w = parseFloat(control.style.width);
      const h = parseFloat(control.style.height);
      const lh = parseFloat(control.style.lineHeight);
      if (!Number.isNaN(w)) cfg.width = w;
      if (!Number.isNaN(h)) cfg.height = h;
      if (!Number.isNaN(lh)) cfg.lineHeight = lh;
    }

    // Only save if we actually have something
    if (Object.keys(cfg).length) fields[key] = cfg;
  });

  return { fields, updatedAt: Date.now() };
}

async function saveLayout() {
  const payload = collectLayoutFromDom();
  await layoutRef.set(payload, { merge: true });
}

async function loadLayoutOnce() {
  try {
    const snap = await layoutRef.get();
    if (snap.exists) applyLayout(snap.data());
  } catch (e) {
    console.error('Layout load failed', e);
  }
}

// Debounce helper
function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Push data changes
const pushUpdates = debounce(async () => {
  const fields = getCurrentFieldsFromDom();
  try {
    await docRef.set({ fields, updatedAt: Date.now() }, { merge: true });
    if (connEl) connEl.textContent = 'Synced ✔';
  } catch (err) {
    console.error(err);
    if (connEl) connEl.textContent = 'Sync failed ❌ (check console)';
  }
}, 400);

// Attach listeners for data entry
function attachDataListeners() {
  getAllFieldWrappers().forEach(wrapper => {
    const control = getControl(wrapper);
    if (!control) return;

    const evt = (control.type === 'checkbox') ? 'change' : 'input';
    control.addEventListener(evt, () => {
      if (connEl) connEl.textContent = 'Syncing…';
      pushUpdates();
    });
  });
}

/* =========================
   Boot sequence:
   1) load layout
   2) wire listeners
   3) subscribe to sheet data
========================= */

(async function boot() {
  await loadLayoutOnce();
  attachDataListeners();

  let isInitialLoad = true;

  docRef.onSnapshot(
    snapshot => {
      if (!snapshot.exists) {
        const fields = getCurrentFieldsFromDom();
        docRef.set({ fields, updatedAt: Date.now() }, { merge: true }).catch(console.error);
        if (connEl) connEl.textContent = 'Connected (new sheet) 🔄';
        return;
      }

      const data = snapshot.data() || {};
      const fields = data.fields || {};

      applyFieldsToDom(fields);
      applyTrackMaxes(fields);

      if (connEl) {
        connEl.textContent = isInitialLoad
          ? 'Connected (loaded from cloud) ✔'
          : 'Updated from cloud 🔄';
      }
      isInitialLoad = false;
    },
    err => {
      console.error('Snapshot error', err);
      if (connEl) connEl.textContent = 'Connection error ❌ (see console)';
    }
  );

  // Expose layout functions for the layout-mode UI
  window.__layout = {
    saveLayout,
    reloadLayout: loadLayoutOnce
  };
})();
