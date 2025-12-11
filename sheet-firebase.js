// sheet-firebase.js

console.log("[sheet-firebase] Script loaded.");

// --- 1. Sanity checks for Firebase globals and config ---

if (typeof firebase === "undefined") {
  console.error("[sheet-firebase] Firebase global is NOT defined. Check your <script> tags for firebase-app-compat.js and firebase-firestore-compat.js.");
}

if (typeof firebaseConfig === "undefined") {
  console.error("[sheet-firebase] firebaseConfig is NOT defined. Make sure firebase-config.js is loaded BEFORE sheet-firebase.js.");
}

// --- 2. Initialize Firebase app ---

let app;
try {
  app = firebase.initializeApp(firebaseConfig);
  console.log("[sheet-firebase] Firebase initialized. apps.length =", firebase.apps.length, "projectId =", firebaseConfig.projectId);
} catch (err) {
  console.error("[sheet-firebase] Firebase initialization FAILED:", err);
}

// --- 3. Initialize Firestore ---

let db;
try {
  db = firebase.firestore();
  console.log("[sheet-firebase] Firestore instance created:", typeof db.collection === "function" ? "OK" : "Unexpected");
} catch (err) {
  console.error("[sheet-firebase] Firestore initialization FAILED:", err);
}

// If Firestore failed, abort further logic
if (!db) {
  console.error("[sheet-firebase] No Firestore instance; aborting sheet logic.");
} else {
  // --- 3a. Debug write to confirm rules / connectivity ---
  db.collection("debug_connection").doc("sheet_boot")
    .set({ ok: true, ts: Date.now() })
    .then(() => console.log("[sheet-firebase] Debug write succeeded (debug_connection/sheet_boot)."))
    .catch(err => console.error("[sheet-firebase] Debug write FAILED:", err));
}

// --- 4. Parse URL params ---

const params = new URLSearchParams(window.location.search);
const charId = params.get("char") || "unnamed";
const pageId = params.get("page") || "core";

const metaEl = document.getElementById("meta");
const connEl = document.getElementById("connection-status");

if (metaEl) {
  metaEl.textContent = `Character: ${charId} · Page: ${pageId}`;
} else {
  console.warn("[sheet-firebase] #meta element not found in DOM.");
}

// Only proceed with Firestore logic if db exists
if (db) {
  // --- 5. Firestore document reference ---

  const docRef = db
    .collection("characters")
    .doc(charId)
    .collection("pages")
    .doc(pageId);

  console.log(
    "[sheet-firebase] Using document path:",
    `characters/${charId}/pages/${pageId}`
  );

  // --- 6. Field DOM management ---

  const fieldWrappers = Array.from(document.querySelectorAll(".field"));
  console.log("[sheet-firebase] Found .field elements:", fieldWrappers.length);

  function getCurrentFieldsFromDom() {
    const data = {};
    fieldWrappers.forEach(wrapper => {
      const key = wrapper.dataset.key;
      const input = wrapper.querySelector("input");
      if (!key || !input) return;

      if (input.type === "checkbox") {
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
      const input = wrapper.querySelector("input");
      if (!key || !input) return;

      const value = fields[key];

      if (input.type === "checkbox") {
        input.checked = !!value;
      } else {
        input.value = value ?? "";
      }
    });
  }

  // --- 7. Debounce helper ---

  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  // --- 8. Push local changes to Firestore ---

  const pushUpdates = debounce(async () => {
    const fields = getCurrentFieldsFromDom();
    console.log("[sheet-firebase] pushUpdates triggered. Fields:", fields);

    try {
      await docRef.set(
        {
          fields,
          updatedAt: Date.now()
        },
        { merge: true }
      );
      console.log("[sheet-firebase] Firestore set() success.");
      if (connEl) connEl.textContent = "Synced ✔";
    } catch (err) {
      console.error("[sheet-firebase] Firestore set() FAILED:", err);
      if (connEl) connEl.textContent = "Sync failed ❌ (check console)";
    }
  }, 500);

  // --- 9. Attach event listeners to inputs ---

  fieldWrappers.forEach(wrapper => {
    const input = wrapper.querySelector("input");
    if (!input) return;

    const evt = input.type === "checkbox" ? "change" : "input";
    input.addEventListener(evt, () => {
      if (connEl) connEl.textContent = "Syncing…";
      pushUpdates();
    });
  });

  // --- 10. Real-time snapshot listener ---

  let isInitialLoad = true;

  docRef.onSnapshot(
    snapshot => {
      console.log("[sheet-firebase] onSnapshot fired. exists =", snapshot.exists);
      if (!snapshot.exists) {
        // First time: create empty doc with current DOM values
        const fields = getCurrentFieldsFromDom();
        console.log("[sheet-firebase] Creating new Firestore doc with initial fields:", fields);

        docRef.set(
          {
            fields,
            updatedAt: Date.now()
          },
          { merge: true }
        )
          .then(() => console.log("[sheet-firebase] Initial doc set() succeeded."))
          .catch(err => console.error("[sheet-firebase] Initial doc set() FAILED:", err));

        if (connEl) connEl.textContent = "Connected (new sheet) 🔄";
        return;
      }

      const data = snapshot.data() || {};
      const fields = data.fields || {};
      console.log("[sheet-firebase] Snapshot data:", data);

      applyFieldsToDom(fields);

      if (connEl) {
        connEl.textContent = isInitialLoad
          ? "Connected (loaded from cloud) ✔"
          : "Updated from cloud 🔄";
      }

      isInitialLoad = false;
    },
    err => {
      console.error("[sheet-firebase] Snapshot error:", err);
      if (connEl) connEl.textContent = "Connection error ❌ (see console)";
    }
  );
}
