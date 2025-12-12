// sheet-firebase.js

// 1. Init Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// 2. Parse URL params
const params = new URLSearchParams(window.location.search);
const charId = params.get('char') || 'unnamed';
const pageId = params.get('page') || 'core';

const metaEl = document.getElementById('meta');
const connEl = document.getElementById('connection-status');

if (metaEl) {
  metaEl.textContent = `Character: ${charId} · Page: ${pageId}`;
}

// 3. Firestore document reference
const docRef = db
  .collection('characters')
  .doc(charId)
  .collection('pages')
  .doc(pageId);

// Track definitions: absolute max per printed sheet
const TRACK_DEFINITIONS = {
  armor: 12,        // 4x3
  hp: 12,
  stress: 12,
  hope: 10,         // adjust if your sheet uses a different max
  gold_hand: 9,
  gold_bag: 9,
  proficiency: 6
};

function getAllFieldWrappers() {
  return Array.from(document.querySelectorAll('.field'));
}

function getCurrentFieldsFromDom() {
  const data = {};
  const wrappers = getAllFieldWrappers();

  wrappers.forEach(wrapper => {
    const key = wrapper.dataset.key;
    const control = wrapper.querySelector('input, textarea');
    if (!key || !control) return;

    if (control.type === 'checkbox') {
      data[key] = !!control.checked;
    } else {
      data[key] = control.value;
    }
  });

  return data;
}

function applyFieldsToDom(fields) {
  if (!fields) return;
  const wrappers = getAllFieldWrappers();

  wrappers.forEach(wrapper => {
    const key = wrapper.dataset.key;
    const control = wrapper.querySelector('input, textarea');
    if (!key || !control) return;

    const value = fields[key];

    if (control.type === 'checkbox') {
      control.checked = !!value;
    } else {
      control.value = value ?? '';
    }
  });
}

/**
 * Apply track max constraints based on *_max fields.
 * e.g. hp_max = 4 => hp_0..hp_3 enabled, hp_4..hp_11 disabled + cleared.
 */
function applyTrackMaxes(fields) {
  if (!fields) return;

  Object.entries(TRACK_DEFINITIONS).forEach(([baseKey, absoluteMax]) => {
    const maxKey = `${baseKey}_max`;
    let currentMax = parseInt(fields[maxKey], 10);

    if (isNaN(currentMax) || currentMax < 0) {
      currentMax = absoluteMax;
    } else if (currentMax > absoluteMax) {
      currentMax = absoluteMax;
    }

    for (let i = 0; i < absoluteMax; i++) {
      const wrapper = document.querySelector(`.field[data-key="${baseKey}_${i}"]`);
      if (!wrapper) continue;

      const control = wrapper.querySelector('input, textarea');
      if (!control) continue;

      if (i < currentMax) {
        control.disabled = false;
        wrapper.classList.remove('track-disabled');
      } else {
        // Beyond max: clear & disable
        if (control.type === 'checkbox') {
          control.checked = false;
        } else {
          control.value = '';
        }
        control.disabled = true;
        wrapper.classList.add('track-disabled');
      }
    }
  });
}

// Debounce helper
function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Push local changes to Firestore
const pushUpdates = debounce(async () => {
  const fields = getCurrentFieldsFromDom();

  try {
    await docRef.set(
      {
        fields,
        updatedAt: Date.now()
      },
      { merge: true }
    );
    if (connEl) connEl.textContent = 'Synced ✔';
  } catch (err) {
    console.error(err);
    if (connEl) connEl.textContent = 'Sync failed ❌ (check console)';
  }
}, 500);

// Attach event listeners so editing triggers pushUpdates
function attachListeners() {
  const wrappers = getAllFieldWrappers();

  wrappers.forEach(wrapper => {
    const control = wrapper.querySelector('input, textarea');
    if (!control) return;

    const evt = (control.type === 'checkbox') ? 'change' : 'input';
    control.addEventListener(evt, () => {
      if (connEl) connEl.textContent = 'Syncing…';
      pushUpdates();
    });
  });
}

attachListeners();

// Subscribe to Firestore changes (real-time)
let isInitialLoad = true;

docRef.onSnapshot(
  snapshot => {
    if (!snapshot.exists) {
      const fields = getCurrentFieldsFromDom();
      docRef.set(
        {
          fields,
          updatedAt: Date.now()
        },
        { merge: true }
      ).catch(console.error);

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
