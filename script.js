const obs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) e.target.classList.add("show");
  });
});
document.querySelectorAll(".fade").forEach(el => obs.observe(el));

/* Reviews logic */
const REVIEWS_KEY = 'site_reviews_v1';
const SUBMIT_KEY = 'site_review_submitted_v1';
const DEVICE_KEY = 'site_device_id_v1';
let editingId = null;
let useRemote = false;
let firebaseDb = null;

function getDeviceId(){
  let id = localStorage.getItem(DEVICE_KEY);
  if(!id){ id = 'd_' + Date.now() + '_' + Math.floor(Math.random()*1000000); localStorage.setItem(DEVICE_KEY, id); }
  return id;
}

function getReviewsLocal(){
  try{return JSON.parse(localStorage.getItem(REVIEWS_KEY) || '[]')}catch(e){return []}
}
function saveReviewsLocal(arr){ localStorage.setItem(REVIEWS_KEY, JSON.stringify(arr)) }

// Remote helpers (Firebase Firestore). Initialization happens lazily if config provided on window.
function loadScript(src){ return new Promise((res, rej)=>{ const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }

async function initRemoteIfNeeded(){
  try{
    if(window.REMOTE_BACKEND === 'firebase' && window.FIREBASE_CONFIG){
      useRemote = true;
      // load compat SDKs for simplicity
      if(!window.firebase){
        await loadScript('https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js');
        await loadScript('https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js');
      }
      try{ firebase.initializeApp(window.FIREBASE_CONFIG); firebaseDb = firebase.firestore(); }catch(e){ console.warn('Firebase init failed', e); useRemote=false }
    }
  }catch(e){ console.warn('Remote init error', e); useRemote=false }
}

async function getReviewsRemote(){
  if(!firebaseDb) return [];
  const snap = await firebaseDb.collection('reviews').get();
  return snap.docs.map(d=> ({ ...(d.data()||{}), deviceId: d.id }));
}

async function saveReviewRemote(review){
  if(!firebaseDb) return;
  const id = getDeviceId();
  review.time = Date.now();
  await firebaseDb.collection('reviews').doc(id).set(review);
  // mark this device as having submitted (store device id)
  localStorage.setItem(SUBMIT_KEY, id);
}

async function deleteReviewRemoteByDeviceId(deviceId){
  if(!firebaseDb) return false;
  await firebaseDb.collection('reviews').doc(deviceId).delete();
  const myId = localStorage.getItem(SUBMIT_KEY);
  if(myId && String(myId) === String(deviceId)) localStorage.removeItem(SUBMIT_KEY);
  return true;
}

// Generic getters/savers that work with either local or remote backend
async function getAllReviews(){
  if(useRemote) return await getReviewsRemote();
  return getReviewsLocal();
}
function saveAllLocalReviews(arr){ saveReviewsLocal(arr); }

async function renderAverage(){
  const reviews = await getAllReviews();
  if(!reviews || !reviews.length){
    const starEl = document.querySelector('#rate-stars .stars-text');
    if(starEl) starEl.style.setProperty('--pct','0%');
    const num = document.getElementById('avg-number'); if(num) num.textContent = '(0)';
    return;
  }
  const avg = reviews.reduce((s,r)=>s + (r.total||0),0)/reviews.length;
  const val = (Math.round(avg*10)/10).toFixed(1).replace(/\.0$/,'');
  const starEl = document.querySelector('#rate-stars .stars-text');
  if(starEl){
    const pct = (avg/5) * 100;
    starEl.style.setProperty('--pct', pct + '%');
  }
  const num = document.getElementById('avg-number'); if(num) num.textContent = `(${val})`;
}

function editReview(review){
  const nameEl = document.getElementById('r-name');
  const textEl = document.getElementById('r-text');
  const codeSel = document.querySelectorAll('input[name="r-code"]');
  const charSel = document.querySelectorAll('input[name="r-character"]');
  const satSel = document.querySelectorAll('input[name="r-sat"]');
  const extra = document.getElementById('extra-criteria');
  const submit = document.getElementById('r-submit');
  const wordsLeft = document.getElementById('words-left');
  if(!nameEl) return;
  // enable and populate
  [nameEl,...codeSel,...charSel,...satSel,textEl,submit].forEach(i=>i && (i.disabled=false));
  extra && (extra.style.display = 'block');
  nameEl.value = review.name || '';
  if(review.code) { const r = document.querySelector('input[name="r-code"][value="'+review.code+'"]'); if(r) r.checked=true }
  if(review.character){ const r = document.querySelector('input[name="r-character"][value="'+review.character+'"]'); if(r) r.checked=true }
  if(review.sat){ const r = document.querySelector('input[name="r-sat"][value="'+review.sat+'"]'); if(r) r.checked=true }
  textEl.value = review.text || '';
  wordsLeft && (wordsLeft.textContent = Math.max(0,350 - (textEl.value||'').length));
  submit.textContent = 'Save changes';
  editingId = review.deviceId ? String(review.deviceId) : String(review.time);
  // scroll to form
  nameEl.scrollIntoView({behavior:'smooth', block:'center'});
}

async function deleteReviewByTime(time){
  // time may be a numeric time (local mode) or a deviceId (remote mode)
  if(useRemote){
    // if time looks like device id, delete directly, otherwise find the doc by time
    const maybeId = String(time);
    if(maybeId.startsWith('d_')){
      await deleteReviewRemoteByDeviceId(maybeId);
    }else{
      // find doc with matching time
      const all = await getAllReviews();
      const found = all.find(r=> String(r.time) === String(time));
      if(found && found.deviceId) await deleteReviewRemoteByDeviceId(found.deviceId);
    }
  }else{
    const arr = getReviewsLocal().filter(rv=> String(rv.time) !== String(time));
    saveAllLocalReviews(arr);
    const myId = localStorage.getItem(SUBMIT_KEY);
    if(myId && String(myId) === String(time)) localStorage.removeItem(SUBMIT_KEY);
  }
  // re-enable form for fresh submission (cleared)
  const nameEl = document.getElementById('r-name');
  const codeSel = document.querySelectorAll('input[name="r-code"]');
  const charSel = document.querySelectorAll('input[name="r-character"]');
  const satSel = document.querySelectorAll('input[name="r-sat"]');
  const textEl = document.getElementById('r-text');
  const submit = document.getElementById('r-submit');
  const extra = document.getElementById('extra-criteria');
  if(nameEl){ nameEl.value=''; nameEl.disabled=false }
  if(textEl){ textEl.value=''; textEl.disabled=false }
  [ ...codeSel, ...charSel, ...satSel ].forEach(i=>{ if(i){ i.checked=false; i.disabled=false } });
  if(submit){ submit.disabled=false; submit.textContent='Submit review'; }
  if(extra) extra.style.display='none';
  // update UI
  await renderReviewsList(); await renderAverage();
}

async function renderReviewsList(){
  const container = document.getElementById('reviews');
  if(!container) return;
  const all = await getAllReviews() || [];
  const myId = localStorage.getItem(SUBMIT_KEY);
  // find user's review: for remote we stored deviceId, for local we stored time
  let my = null;
  if(useRemote){ my = myId ? all.find(r=> String(r.deviceId) === String(myId)) : null; }
  else { my = myId ? all.find(r=> String(r.time) === String(myId)) : null; }
  if(!my && myId && all.length){
    const sorted = all.slice().sort((a,b)=> (b.time||0) - (a.time||0));
    my = sorted[0];
  }
  const others = all.filter(r=> !my || (useRemote ? String(r.deviceId) !== String(my.deviceId) : String(r.time) !== String(my.time))).sort((a,b)=> (b.time||0) - (a.time||0));
  const ordered = [];
  if(my) ordered.push(my);
  ordered.push(...others);
  container.innerHTML = '';
  if(!ordered.length){ container.innerHTML = '<div class="muted">No reviews yet.</div>'; return }
  ordered.forEach(r=>{
    const isMine = my && (useRemote ? String(r.deviceId) === String(my.deviceId) : String(r.time) === String(my.time));
    const item = document.createElement('div'); item.className='review-item';
    item.setAttribute('data-time', String(r.time || ''));
    const when = r.time ? new Date(r.time).toLocaleString() : '';
    item.innerHTML = `
      <div class="avatar"><img src="avatar.png" alt="avatar"></div>
      <div class="body">
        <div class="meta"><strong>${escapeHtml(r.name)}</strong> <span class="stars">${r.total}★</span> <span class="time">${when}</span></div>
        <p>${escapeHtml(r.text || '')}</p>
        ${isMine ? '<div class="inline-controls"><a href="#" class="inline-edit">Edit</a> <a href="#" class="inline-delete">Delete</a></div>' : ''}
      </div>`;
    container.appendChild(item);
    if(isMine){
      const editLink = item.querySelector('.inline-edit');
      const delLink = item.querySelector('.inline-delete');
      editLink && editLink.addEventListener('click', (ev)=>{ ev.preventDefault(); editReview(r); });
      delLink && delLink.addEventListener('click', (ev)=>{ ev.preventDefault(); showConfirm('Are you sure want to delete your review?', ()=> deleteReviewByTime(useRemote ? r.deviceId : r.time)); });
    }
  });
}

// create a modal confirm dialog. message: string, onYes: callback
function showConfirm(message, onYes){
  // avoid creating multiple
  if(document.getElementById('confirm-modal')) return;
  const overlay = document.createElement('div'); overlay.id = 'confirm-modal';
  const box = document.createElement('div'); box.className = 'confirm-box';
  overlay.appendChild(box);
  box.innerHTML = `<div class="confirm-message">${escapeHtml(message)}</div>
    <div class="confirm-actions">
      <button id="confirm-no" class="btn-cancel">No</button>
      <button id="confirm-yes" class="btn-yes">Yes</button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('confirm-no').addEventListener('click', ()=>{ overlay.remove(); });
  document.getElementById('confirm-yes').addEventListener('click', ()=>{ overlay.remove(); try{ onYes && onYes(); }catch(e){} });
}

// Admin helper: remove reviews matching sample data
function removeSampleReviews(){
  const targetName = 'Anh Thư';
  const targetText = 'Khùng';
  (async ()=>{
    const all = await getAllReviews();
    const removed = [];
    for(const r of all){
      if(((r.name||'').trim() === targetName) && ((r.text||'').trim() === targetText)){
        removed.push(r);
        if(useRemote && r.deviceId) await deleteReviewRemoteByDeviceId(r.deviceId);
      }
    }
    if(!removed.length){ alert('No matching sample reviews found.'); return; }
    if(!useRemote){
      const kept = getReviewsLocal().filter(r=> !removed.find(x=> (String(x.time) === String(r.time))));
      saveAllLocalReviews(kept);
      const myId = localStorage.getItem(SUBMIT_KEY);
      if(myId && removed.find(x=> String(x.time) === String(myId))) localStorage.removeItem(SUBMIT_KEY);
    }
    await renderReviewsList(); await renderAverage();
    alert('Removed ' + removed.length + ' sample review(s).');
  })();
}

// Show admin controls when ?admin=1 is present in the URL
function showAdminControls(){
  try{
    const params = new URLSearchParams(location.search);
    if(params.get('admin') === '1'){
      const btn = document.getElementById('admin-clear-sample');
      if(btn){
        btn.style.display = 'inline-block';
        btn.addEventListener('click', (ev)=>{ ev.preventDefault(); showConfirm('Delete sample review(s) by Anh Thư?', removeSampleReviews); });
      }
    }
  }catch(e){ /* ignore in old browsers */ }
}

function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]) }

function setupReviewForm(){
  const nameEl = document.getElementById('r-name');
  const codeRadios = document.querySelectorAll('input[name="r-code"]');
  const charRadios = document.querySelectorAll('input[name="r-character"]');
  const satRadios = document.querySelectorAll('input[name="r-sat"]');
  const textEl = document.getElementById('r-text');
  const extra = document.getElementById('extra-criteria');
  const submit = document.getElementById('r-submit');
  const msg = document.getElementById('form-message');
  const wordsLeft = document.getElementById('words-left');

  if(!nameEl || !codeRadios.length) return;

  // show extras when code star selected
  codeRadios.forEach(r=> r.addEventListener('change', ()=>{ extra.style.display='block'; }));

  // character count: count characters remaining (max 350)
  textEl && textEl.addEventListener('input', ()=>{
    const val = textEl.value || '';
    const remaining = Math.max(0, 350 - val.length);
    wordsLeft && (wordsLeft.textContent = remaining);
  });

  // enforce single submission per device: if submitted, lock the empty form and show a compact message
  const submitted = localStorage.getItem(SUBMIT_KEY);
  if(submitted){
    [nameEl,...codeRadios,...charRadios,...satRadios,textEl,submit].forEach(i=>i && (i.disabled = true));
    msg && (msg.textContent = 'You have already submitted a review from this device. Thank you!');
  }

  submit && submit.addEventListener('click', async ()=>{
    msg.textContent = '';
    if(!nameEl.value.trim()){ msg.textContent = 'Please enter your name to submit.'; return }
    // get selected stars; default to 5 if none selected
    const codeSel = document.querySelector('input[name="r-code"]:checked');
    const charSel = document.querySelector('input[name="r-character"]:checked');
    const satSel = document.querySelector('input[name="r-sat"]:checked');
    const code = parseInt(codeSel && codeSel.value) || 5;
    const character = parseInt(charSel && charSel.value) || 5;
    const sat = parseInt(satSel && satSel.value) || 5;
    const text = textEl && textEl.value.trim() || '';
    const total = Math.round(((code+character+sat)/3)*10)/10;

    if(editingId){
      // edit path: update existing (remote or local)
      if(useRemote){
        const toSave = { name: nameEl.value.trim(), code, character, sat, text, total, time: Date.now() };
        await saveReviewRemote(toSave);
        editingId = null;
        submit.textContent = 'Submit review';
        [nameEl,...codeRadios,...charRadios,...satRadios,textEl,submit].forEach(i=>i && (i.disabled = true));
        msg.textContent = 'You have already submitted a review from this device. Thank you!';
        await renderReviewsList(); await renderAverage();
        return;
      } else {
        const reviews = getReviewsLocal();
        const idx = reviews.findIndex(rv=> String(rv.time) === String(editingId));
        if(idx !== -1){
          reviews[idx].name = nameEl.value.trim();
          reviews[idx].code = code; reviews[idx].character = character; reviews[idx].sat = sat;
          reviews[idx].text = text; reviews[idx].total = total; reviews[idx].time = Date.now();
          saveAllLocalReviews(reviews);
          localStorage.setItem(SUBMIT_KEY, String(reviews[idx].time));
          editingId = null;
          submit.textContent = 'Submit review';
          nameEl.value=''; textEl.value=''; [...codeRadios].forEach(r=>r.checked=false); [...charRadios].forEach(r=>r.checked=false); [...satRadios].forEach(r=>r.checked=false);
          [nameEl,...codeRadios,...charRadios,...satRadios,textEl,submit].forEach(i=>i && (i.disabled = true));
          msg.textContent = 'You have already submitted a review from this device. Thank you!';
          await renderReviewsList(); await renderAverage();
          return;
        }
      }
    }
    // create new
    if(useRemote){
      const toSave = { name: nameEl.value.trim(), code, character, sat, text, total, time: Date.now() };
      await saveReviewRemote(toSave);
      nameEl.value=''; textEl.value=''; [...codeRadios].forEach(r=>r.checked=false); [...charRadios].forEach(r=>r.checked=false); [...satRadios].forEach(r=>r.checked=false);
      [nameEl,...codeRadios,...charRadios,...satRadios,textEl,submit].forEach(i=>i && (i.disabled = true));
      msg.textContent = 'You have already submitted a review from this device. Thank you!';
      await renderReviewsList(); await renderAverage();
    } else {
      const newR = { name: nameEl.value.trim(), code, character, sat, text, total, time: Date.now() };
      const reviews = getReviewsLocal();
      reviews.push(newR);
      saveAllLocalReviews(reviews);
      localStorage.setItem(SUBMIT_KEY, String(newR.time));
      nameEl.value=''; textEl.value=''; [...codeRadios].forEach(r=>r.checked=false); [...charRadios].forEach(r=>r.checked=false); [...satRadios].forEach(r=>r.checked=false);
      [nameEl,...codeRadios,...charRadios,...satRadios,textEl,submit].forEach(i=>i && (i.disabled = true));
      msg.textContent = 'You have already submitted a review from this device. Thank you!';
      await renderReviewsList(); await renderAverage();
    }
  });
}

// populate average on index page and set click
document.addEventListener('DOMContentLoaded', async ()=>{
  await initRemoteIfNeeded();
  await renderAverage();
  await renderReviewsList();
  setupReviewForm();
  showAdminControls();
});

