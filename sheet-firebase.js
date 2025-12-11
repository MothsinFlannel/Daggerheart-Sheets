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

// 4. Grab all fields on the page
let fieldWrappers = Array.from(document.querySelectorAll('.field'));

// Track definitions: absolute max per printed sheet
// (we ALWAYS render this many, but only the first N are active, where N = *_max)
const TRACK_DEFINITIONS = {
  armor: 12,
  hp: 12,
  stress: 12,
  gold_hand: 9,
  gold_bag: 9,
  proficiency: 6
};

function getCurrentFieldsFromDom() {
  const data = {};
  fieldWrappers.forEach(wrapper => {
    const key = wrapper.dataset.key;
    const input = wrapper.querySelector('input');
    if (!key || !input) return;

    if (input.type === 'checkbox') {
      data[key] = !!input.checked;
    } else {
      data[key] = input.value;
    }
  });
  return data;
}

function applyFieldsToDom(fields) {
  if (!fields) return;
  fieldWrappers.forEach(wrapper => {
    const key = wrapper.dataset.key;
    const input = wrapper.querySelector('input');
    if (!key || !input) return;

    const value = fields[key];

    if (input.type === 'checkbox') {
      input.checked = !!value;
    } else {
      input.value = value ?? '';
    }
  });
}

/**
 * Apply track max constraints based on *_max fields.
 * Example: hp_max = 4 => hp_0..hp_3 enabled, hp_4..hp_11 disabled + cleared.
 */
function applyTrackMaxes(fields) {
  if (!fields) return;

  Object.entries(TRACK_DEFINITIONS).forEach(([baseKey, absoluteMax]) => {
    const maxKey = `${baseKey}_max`;
    let currentMax = parseInt(fields[maxKey], 10);

    if (isNaN(currentMax) || currentMax < 0) {
      // No max set yet? Use full track.
      currentMax = absoluteMax;
    } else if (currentMax > absoluteMax) {
      currentMax = absoluteMax;
    }

    for (let i = 0; i < absoluteMax; i++) {
      const wrapper = document.querySelector(`.field[data-key="${baseKey}_${i}"]`);
      if (!wrapper) continue;
      const input = wrapper.querySelector('input');
      if (!input) continue;

      if (i < currentMax) {
        input.disabled = false;
        wrapper.classList.remove('track-disabled');
      } else {
        // Beyond max: clear & disable
        input.checked = false;
        input.disabled = true;
        wrapper.classList.add('track-disabled');
      }
    }
  });
}

// 5. Debounce helper to avoid writing on every keystroke instantly
function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// 6. Push local changes to Firestore
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
}, 500); // half-second debounce

// 7. Attach event listeners so editing triggers pushUpdates
fieldWrappers.forEach(wrapper => {
  const input = wrapper.querySelector('input');
  if (!input) return;

  const evt = input.type === 'checkbox' ? 'change' : 'input';
  input.addEventListener(evt, () => {
    if (connEl) connEl.textContent = 'Syncing…';
    pushUpdates();
  });
});

// 8. Subscribe to Firestore changes (real-time)
let isInitialLoad = true;

// IMPORTANT: some fields (.field elements) are added dynamically by the track generator
// which runs before this script in sheet.html. If you ever change that order, re-grab them.
fieldWrappers = Array.from(document.querySelectorAll('.field'));

docRef.onSnapshot(
  snapshot => {
    if (!snapshot.exists) {
      // First time: create empty doc with current DOM values
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

    // First apply all raw values
    applyFieldsToDom(fields);
    // Then apply track max logic
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
