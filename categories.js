import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
import { getDatabase, ref, onValue, set } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js';

// Duplicate firebase config (kept in sync with app.js)
const firebaseConfig = {
  apiKey: "AIzaSyBP7NUTGpupGEz5ZH28AhY8DHZKxkKRWTU",
  authDomain: "daily-diary-26dbf.firebaseapp.com",
  databaseURL: "https://daily-diary-26dbf-default-rtdb.firebaseio.com",
  projectId: "daily-diary-26dbf",
  storageBucket: "daily-diary-26dbf.firebasestorage.app",
  messagingSenderId: "994518127061",
  appId: "1:994518127061:web:89064378570723575bed5c",
  measurementId: "G-YRDNL38G9X"
};

let db = null;
let categoriesRef = null;
function currentBoardId(){ return localStorage.getItem('kanban_selected_board') || 'default'; }
function categoriesPathForBoard(b){ return '/boards/' + (b || currentBoardId()) + '/categories'; }
try{
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  categoriesRef = ref(db, categoriesPathForBoard());
}catch(err){
  console.warn('Firebase init (categories) failed', err);
}

// sanitize a category name into a safe firebase key
function slugifyKey(name){
  return String(name).trim().replace(/[.#$\[\]\/]/g, '_');
}

// Keep a copy of the app's default columns (cannot be removed)
// Minimal default: a single base column that can be renamed but not removed
const DEFAULT_COLUMNS = ["base"];

function perBoardKey(){ return 'kanban_categories_v1::' + currentBoardId(); }
function loadLocalCategories(){
  try{ const raw = localStorage.getItem(perBoardKey()) || localStorage.getItem('kanban_categories_v1'); if(!raw) return null; return JSON.parse(raw); }catch(e){ return null; }
}
function saveLocalCategories(list){ localStorage.setItem(perBoardKey(), JSON.stringify(list)); }

// Ensure DOM is ready before looking up UI elements
// Create a modal-based manager for categories; show when 'categories-manage' event is dispatched
let modalEl = null;
let modalListEl = null;
let modalInputEl = null;

function buildCategoriesModal(){
  if(modalEl) return modalEl;
  modalEl = document.createElement('div');
  modalEl.style.position = 'fixed';
  modalEl.style.left = '0';
  modalEl.style.top = '0';
  modalEl.style.right = '0';
  modalEl.style.bottom = '0';
  modalEl.style.background = 'rgba(0,0,0,0.45)';
  modalEl.style.display = 'flex';
  modalEl.style.alignItems = 'center';
  modalEl.style.justifyContent = 'center';

  const panel = document.createElement('div');
  panel.style.width = '420px';
  panel.style.maxHeight = '80vh';
  panel.style.overflow = 'auto';
  panel.style.background = '#fff';
  panel.style.borderRadius = '8px';
  panel.style.padding = '16px';

  const title = document.createElement('h3');
  title.textContent = 'Manage Categories';
  panel.appendChild(title);

  modalInputEl = document.createElement('input');
  modalInputEl.placeholder = 'New category name';
  modalInputEl.style.width = '100%';
  modalInputEl.style.padding = '8px';
  modalInputEl.style.marginBottom = '8px';
  panel.appendChild(modalInputEl);

  const addBtn = document.createElement('button');
  addBtn.textContent = 'Add Category';
  addBtn.style.marginBottom = '12px';
  addBtn.addEventListener('click', ()=>{
    addCategory(modalInputEl.value);
    modalInputEl.value = '';
    renderModalList(loadLocalCategories() || []);
  });
  panel.appendChild(addBtn);

  modalListEl = document.createElement('div');
  panel.appendChild(modalListEl);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.marginTop = '12px';
  closeBtn.addEventListener('click', ()=>{ modalEl.style.display = 'none'; });
  panel.appendChild(closeBtn);

  modalEl.appendChild(panel);
  document.body.appendChild(modalEl);
  return modalEl;
}

function renderModalList(list){
  if(!modalListEl) return;
  modalListEl.innerHTML = '';
  const cols = list || [];

  // Show base (first item) in its own section
  const baseLabel = document.createElement('h4');
  baseLabel.textContent = 'Base category (cannot be removed)';
  modalListEl.appendChild(baseLabel);
  const baseName = cols[0] || DEFAULT_COLUMNS[0];
  const baseRow = document.createElement('div');
  baseRow.style.display = 'flex';
  baseRow.style.justifyContent = 'space-between';
  baseRow.style.marginBottom = '6px';
  const baseText = document.createElement('div');
  baseText.textContent = baseName;
  baseRow.appendChild(baseText);
  const renameBaseBtn = document.createElement('button');
  renameBaseBtn.textContent = 'Rename';
  renameBaseBtn.addEventListener('click', ()=>{
    const nv = prompt('Rename base category', baseName);
    if(nv && nv.trim()){
      renameCategory(baseName, nv.trim());
      renderModalList(loadLocalCategories() || []);
    }
  });
  baseRow.appendChild(renameBaseBtn);
  modalListEl.appendChild(baseRow);

  // Other categories
  const otherLabel = document.createElement('h4');
  otherLabel.textContent = 'Other categories';
  modalListEl.appendChild(otherLabel);

  cols.slice(1).forEach((cat, idx) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.marginBottom = '6px';
    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.gap = '8px';
    const label = document.createElement('div');
    label.textContent = cat;
    left.appendChild(label);

    // Up / Down buttons for ordering
    const up = document.createElement('button'); up.textContent = '↑';
    up.title = 'Move up';
    up.addEventListener('click', ()=>{ moveCategory(cat, -1); renderModalList(loadLocalCategories() || []); });
    const down = document.createElement('button'); down.textContent = '↓';
    down.title = 'Move down';
    down.addEventListener('click', ()=>{ moveCategory(cat, +1); renderModalList(loadLocalCategories() || []); });
    left.appendChild(up);
    left.appendChild(down);

    row.appendChild(left);

    const right = document.createElement('div');
    const rename = document.createElement('button');
    rename.textContent = 'Rename';
    rename.addEventListener('click', ()=>{
      const nv = prompt('Rename category', cat);
      if(nv && nv.trim()){
        renameCategory(cat, nv.trim());
        renderModalList(loadLocalCategories() || []);
      }
    });
    right.appendChild(rename);

    // check whether this category contains any cards in the current local state
    const localState = window._KANBAN && window._KANBAN.state;
    const count = localState && localState[cat] ? localState[cat].length : 0;
    const del = document.createElement('button');
    if(count > 0){
      del.textContent = `Cannot remove (${count} jobs)`;
      del.disabled = true;
      del.title = 'Remove jobs from this category before deleting it.';
      del.style.opacity = '0.6';
      del.style.cursor = 'not-allowed';
    }else{
      del.textContent = 'Remove';
      del.addEventListener('click', ()=>{
        if(!confirm(`Remove category "${cat}"?`)) return;
        removeCategory(cat);
        renderModalList(loadLocalCategories() || []);
      });
    }
    right.appendChild(del);
    row.appendChild(right);
    modalListEl.appendChild(row);
  });
}

// reuse helper functions from previous inline implementation
function dispatchCategories(list){
  const evt = new CustomEvent('categories-updated', { detail: { categories: list } });
  window.dispatchEvent(evt);
}

function addCategory(name){
  const trimmed = (name || '').trim();
  if(!trimmed) return;
  // only allow adding categories when admin authenticated
  if(typeof window._CATSAdminAuthenticated !== 'undefined' && !window._CATSAdminAuthenticated){
    alert('Admin authentication required to add categories');
    return;
  }
  const current = loadLocalCategories() || [];
  if(current.includes(trimmed)){
    console.log('Category already exists:', trimmed);
    return;
  }
  current.push(trimmed);
  saveLocalCategories(current);
  dispatchCategories(current);
  // persist the full ordered list to firebase with per-item order
  if(db){
    current.forEach((t, i) => {
      const key = slugifyKey(t);
      set(ref(db, categoriesPathForBoard() + '/' + key), { title: t, order: i }).catch(err => console.warn('Failed to write category', err));
    });
  }
}

function removeCategory(name){
  // prevent deletion if there are any jobs in this category
  // only allow removing categories when admin authenticated
  if(typeof window._CATSAdminAuthenticated !== 'undefined' && !window._CATSAdminAuthenticated){
    alert('Admin authentication required to remove categories');
    return;
  }
  const localState = window._KANBAN && window._KANBAN.state;
  const count = localState && localState[name] ? localState[name].length : 0;
  if(count > 0){
    alert(`Cannot remove category "${name}" because it contains ${count} job(s). Move or delete the jobs first.`);
    return;
  }
  const current = loadLocalCategories() || [];
  const idx = current.indexOf(name);
  if(idx === -1) return;
  current.splice(idx,1);
  saveLocalCategories(current);
  dispatchCategories(current);
    if(db){
    const key = slugifyKey(name);
    // delete the removed item
    set(ref(db, categoriesPathForBoard() + '/' + key), null).catch(err => console.warn('Failed to delete category', err));
    // rewrite remaining with updated order
    current.forEach((t, i) => {
      const k = slugifyKey(t);
      set(ref(db, categoriesPathForBoard() + '/' + k), { title: t, order: i }).catch(err => console.warn('Failed to write category', err));
    });
  }
}

function renameCategory(oldName, newName){
  if(!oldName || !newName) return;
  if(typeof window._CATSAdminAuthenticated !== 'undefined' && !window._CATSAdminAuthenticated){
    alert('Admin authentication required to rename categories');
    return;
  }
  const current = loadLocalCategories() || [];
  const idx = current.indexOf(oldName);
  if(idx === -1) return;
  // if renaming the base (index 0) replace it in place
  if(idx === 0){
    current[0] = newName;
    try{ DEFAULT_COLUMNS[0] = newName; }catch(e){}
    // remove duplicate occurrences later in the array
    for(let i = current.length - 1; i >= 1; i--){ if(current[i] === newName) current.splice(i,1); }
  }else{
    // ensure we don't duplicate
    if(current.includes(newName)){
      alert('A category with that name already exists');
      return;
    }
    current[idx] = newName;
  }
  saveLocalCategories(current);
  dispatchCategories(current);
  if(db){
    // remove old key if the slug changed
    const oldKey = slugifyKey(oldName);
    const newKey = slugifyKey(newName);
    if(oldKey !== newKey){
      set(ref(db, categoriesPathForBoard() + '/' + oldKey), null).catch(err => console.warn('Failed to delete old category key', err));
    }
    // write full ordered list with updated titles and orders
    current.forEach((t, i) => {
      const k = slugifyKey(t);
      set(ref(db, categoriesPathForBoard() + '/' + k), { title: t, order: i }).catch(err => console.warn('Failed to write category', err));
    });
  }
}

function moveCategory(name, dir){
  const current = loadLocalCategories() || [];
  const idx = current.indexOf(name);
  if(idx === -1) return;
  const newIdx = idx + dir;
  if(newIdx < 0 || newIdx >= current.length) return;
  const tmp = current[newIdx];
  current[newIdx] = current[idx];
  current[idx] = tmp;
  saveLocalCategories(current);
  dispatchCategories(current);
  if(db){
    current.forEach((t, i) => {
      const k = slugifyKey(t);
      set(ref(db, categoriesPathForBoard() + '/' + k), { title: t, order: i }).catch(err => console.warn('Failed to write category', err));
    });
  }
}

// show modal when requested
// Keep track of whether admin has authenticated for category management.
window._CATSAdminAuthenticated = false;
window.addEventListener('admin-auth-success', (e)=>{
  try{
    const u = e?.detail?.username;
    if(u === 'admin'){
      window._CATSAdminAuthenticated = true;
    }
  }catch(err){}
});

window.addEventListener('categories-manage', ()=>{
  // require admin auth to open category manager; if not authed, request admin auth via app
  if(!window._CATSAdminAuthenticated){
    try{ window.dispatchEvent(new CustomEvent('request-admin-auth', { detail: { reason: 'categories-manage' } })); }catch(e){}
    return;
  }
  const m = buildCategoriesModal();
  const list = loadLocalCategories() || [];
  renderModalList(list);
  modalEl.style.display = 'flex';
  modalInputEl.focus();
});

// also listen for remote category changes to update local store (respect remote order)
if(db){
  const catRef = ref(db, categoriesPathForBoard());
  onValue(catRef, snap => {
    const val = snap.val();
    if(!val) return;
    try{
      const items = Object.keys(val || {}).map(k => {
        const entry = val[k] || {};
        return { title: entry.title || k, order: (typeof entry.order === 'number') ? entry.order : Number.MAX_SAFE_INTEGER };
      });
      items.sort((a,b) => a.order - b.order || a.title.localeCompare(b.title));
      const list = items.map(i => i.title);
      saveLocalCategories(list);
      // dispatch so other modules (like app.js) pick up new order
      dispatchCategories(list);
    }catch(e){
      console.warn('Failed to process remote categories', e);
    }
  }, err => console.warn('Failed to listen categories', err));
}


