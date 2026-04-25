const API_BASE = "/app_api.php";
const SESSION_TIMEOUT_SEC = 60;

// ============================================================
// APP
// ============================================================
const app = {
  user: {
    telegramId: localStorage.getItem('telegram_id') || null,
    firstName:  localStorage.getItem('first_name')  || null,
  },
  dashboard: {},
  cards:     [],
  mapping:   { 1:null, 2:null, 3:null, 4:null, 5:null, 6:null, 7:null, 8:null },
  currentSlotSelection: null,

  init() {
    if (this.user.telegramId) this.checkLicenseAndBoot();
    else this.showScreen('login-screen');
    document.getElementById('slot-picker').addEventListener('click', (e) => {
      if (e.target.id === 'slot-picker') this.hideSlotPicker();
    });
  },

  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
  },

  togglePassword() {
    const i = document.getElementById('login-card');
    i.type = i.type === 'password' ? 'text' : 'password';
  },

  async apiCall(params) {
    const url = window.location.origin + API_BASE;
    const qs  = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
    const fullUrl = `${url}?${qs}`;
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 15000);
      const res  = await fetch(fullUrl, { method:'GET', headers:{'Accept':'application/json'}, signal:ctrl.signal });
      clearTimeout(tid);
      const text = await res.text();
      console.log(`[API - ${params.action}] ${res.status}`, text.substring(0,120));
      if (!res.ok) throw new Error(`Server ${res.status}: ${text.substring(0,80)}`);
      if (!text.trim()) throw new Error('Risposta vuota.');
      try { return JSON.parse(text); }
      catch(e) {
        const fb=text.indexOf('{'), fb2=text.indexOf('[');
        let s=-1; if(fb!==-1&&fb2!==-1)s=Math.min(fb,fb2); else if(fb!==-1)s=fb; else if(fb2!==-1)s=fb2;
        if(s!==-1){const arr=text[s]==='[',e2=arr?text.lastIndexOf(']'):text.lastIndexOf('}');if(e2>s)return JSON.parse(text.substring(s,e2+1));}
        throw new Error(`JSON non valido: ${text.substring(0,100)}`);
      }
    } catch(e) { console.error(`[API ERROR ${params.action}]`, e); throw e; }
  },

  async checkLicenseAndBoot() {
    this.showScreen('auth-gate');
    try {
      const d = await this.apiCall({ action:'check_license', user_id:this.user.telegramId });
      if (d.access === false) {
        document.querySelector('.spinner').classList.add('hidden');
        document.getElementById('auth-denied-content').classList.remove('hidden');
        document.getElementById('auth-gate').classList.add('denied');
      } else this.loadDashboard();
    } catch(e) { this.loadDashboard(); }
  },

  async login() {
    const user  = document.getElementById('login-username').value.trim();
    const card  = document.getElementById('login-card').value.trim();
    const errEl = document.getElementById('login-error');
    const btn   = document.getElementById('login-btn');
    if (!user || !card) { errEl.textContent='Compila tutti i campi.'; errEl.classList.remove('hidden'); return; }
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0 auto;"></div>';
    try {
      const d = await this.apiCall({ action:'login', username:user, card_number:card });
      if (d.success) {
        this.user.telegramId = d.telegram_id.toString();
        this.user.firstName  = d.first_name.toString();
        localStorage.setItem('telegram_id', this.user.telegramId);
        localStorage.setItem('first_name',  this.user.firstName);
        this.loadDashboard();
      } else {
        errEl.textContent = d.error || 'Accesso negato.';
        errEl.classList.remove('hidden');
      }
    } catch(e) { errEl.textContent='Errore di rete.'; errEl.classList.remove('hidden'); }
    finally { btn.disabled=false; btn.textContent='ACCEDI AL SISTEMA'; }
  },

  logout() {
    localStorage.clear();
    this.user    = { telegramId:null, firstName:null };
    this.mapping = { 1:null,2:null,3:null,4:null,5:null,6:null,7:null,8:null };
    document.querySelector('.spinner').classList.remove('hidden');
    document.getElementById('auth-denied-content').classList.add('hidden');
    document.getElementById('auth-gate').classList.remove('denied');
    document.getElementById('login-username').value = '';
    document.getElementById('login-card').value     = '';
    this.showScreen('login-screen');
  },

  async loadDashboard() {
    this.showScreen('auth-gate');
    document.getElementById('dash-header-title').textContent = `FOXSYNC • ${this.user.firstName}`;
    try {
      const dashData  = await this.apiCall({ action:'get_dashboard', user_id:this.user.telegramId });
      const cardsData = await this.apiCall({ action:'get_slots',     user_id:this.user.telegramId });
      if (dashData.error)  throw new Error('DASHBOARD: '+dashData.error);
      if (cardsData.error) throw new Error('SLOTS: '+cardsData.error);
      this.dashboard = dashData;
      this.cards     = Array.isArray(cardsData) ? cardsData : [];
      this.renderDashboard();
      this.renderSlots();
      this.showScreen('dashboard-screen');
    } catch(e) { console.error(e); alert(`Errore:\n${e.message||'Connessione fallita.'}`); this.logout(); }
  },

  renderDashboard() {
    const bal=parseFloat(this.dashboard.saldo||0), isPrem=!!this.dashboard.is_premium, isLow=bal<2.0;
    document.getElementById('dash-balance-val').textContent   = bal.toFixed(2);
    document.getElementById('dash-karma-val').textContent     = this.dashboard.karma||'0';
    document.getElementById('dash-tariff-val').textContent    = this.dashboard.loyalty_level||'Standard';
    document.getElementById('dash-card').className = 'dashboard-card'+(isPrem?' premium':'')+(isLow?' low-balance':'');
    document.getElementById('dash-premium-badge').textContent = isPrem?'FOX PREMIUM CLUB':'UTENTE STANDARD';
    const w=document.getElementById('dash-warning'); if(isLow)w.classList.remove('hidden'); else w.classList.add('hidden');
    const mn=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    document.getElementById('stats-month').textContent = mn[new Date().getMonth()];
    if (this.dashboard.monthly_stats) {
      document.getElementById('stat-energy').textContent    = `${this.dashboard.monthly_stats.energy_kwh||'0.00'} kWh`;
      document.getElementById('stat-spent').textContent     = `€ ${this.dashboard.monthly_stats.spent_eur||'0.00'}`;
      document.getElementById('stat-recharged').textContent = `€ ${this.dashboard.monthly_stats.recharged_eur||'0.00'}`;
    }
  },

  renderSlots() {
    // Popola solo la connect-screen (la dashboard ha solo il pulsante Collega)
    let canSync=false;
    const list=document.getElementById('connect-slot-list');
    if (list) {
      list.innerHTML='';
      for (let i=1;i<=8;i++) {
        const card=this.mapping[i]; if(card)canSync=true;
        const div=document.createElement('div');
        div.className=`slot-card ${card?'active':''}`;
        div.onclick=()=>this.openSlotPicker(i);
        div.innerHTML=`<div class="slot-num">${i}</div><div class="slot-title">${card?card.slot_label:'Nessun dato assegnato'}</div><div class="slot-icon">📝</div>`;
        list.appendChild(div);
      }
    }
    const syncBtn=document.getElementById('connect-proceed-btn');
    if (syncBtn) { if(canSync)syncBtn.classList.remove('hidden'); else syncBtn.classList.add('hidden'); }
  },

  openSlotPicker(slotNum) {
    this.currentSlotSelection=slotNum;
    const list=document.getElementById('slot-picker-list');
    list.innerHTML=`<div class="sheet-item clear" onclick="app.selectCardForSlot(null)"><div style="font-size:24px">🚫</div><div class="sheet-item-title">Svuota / Lascia vuoto</div></div>`;
    this.cards.forEach(card=>{
      const div=document.createElement('div'); div.className='sheet-item'; div.onclick=()=>this.selectCardForSlot(card);
      div.innerHTML=`<div style="font-size:24px;color:var(--primary-orange)">💳</div><div class="sheet-item-title">${card.slot_label}</div>`;
      list.appendChild(div);
    });
    document.getElementById('slot-picker').classList.remove('hidden');
  },

  hideSlotPicker() { document.getElementById('slot-picker').classList.add('hidden'); },

  selectCardForSlot(card) {
    if (this.currentSlotSelection) { this.mapping[this.currentSlotSelection]=card; this.renderSlots(); }
    this.hideSlotPicker();
  },

  // ── HELPERS ──
  _formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d=new Date(dateStr), ms=Date.now()-d;
      const min=Math.floor(ms/60000), h=Math.floor(ms/3600000), day=Math.floor(ms/86400000);
      if (min<1) return 'Adesso';
      if (min<60) return `${min} min fa`;
      if (h<24)   return `${h}h fa`;
      if (day<7)  return `${day}g fa`;
      return d.toLocaleDateString('it-IT',{day:'2-digit',month:'short',year:'numeric'});
    } catch(e) { return dateStr; }
  },
  _esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },

  // ── PROFILO ──
  async showProfile() {
    app.showScreen('profile-screen');
    const cont = document.getElementById('profile-content');
    cont.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
    try {
      const d = await this.apiCall({ action:'get_profile', user_id:this.user.telegramId });
      this._renderProfile(cont, d);
    } catch(e) {
      cont.innerHTML = '<div class="empty-state">❌<br>Errore nel caricamento</div>';
    }
  },

  _renderProfile(cont, d) {
    const isPremium = !!d.is_premium;
    const saldo     = parseFloat(d.saldo_kwh||0).toFixed(2);
    const since     = d.member_since
      ? new Date(d.member_since).toLocaleDateString('it-IT',{month:'long',year:'numeric'}) : '';

    // Card premium o standard
    let premiumHtml = '';
    if (isPremium && d.premium_expires) {
      const exp     = new Date(d.premium_expires);
      const days    = Math.max(0, Math.round((exp-Date.now())/86400000));
      const expStr  = exp.toLocaleDateString('it-IT',{day:'2-digit',month:'long',year:'numeric'});
      const urgCls  = days<=7 ? 'prem-expiry-urgent' : days<=30 ? 'prem-expiry-warn' : '';
      premiumHtml = `
        <div class="premium-card">
          <div class="premium-card-top">
            <div class="premium-star">⭐</div>
            <div style="flex:1">
              <div class="premium-title">FOX PREMIUM CLUB</div>
              <div class="premium-level">Membro attivo</div>
            </div>
            <div class="premium-days ${urgCls}">
              <div class="premium-days-num">${days}</div>
              <div class="premium-days-lbl">giorni</div>
            </div>
          </div>
          <div class="premium-expiry ${urgCls}">
            ${days<=7?'⚠️ ':'📅 '}Scade il ${expStr}
          </div>
        </div>`;
    } else {
      premiumHtml = `<div class="profile-level-badge">🦊 Fox Standard</div>`;
    }

    cont.innerHTML = `
      <div class="profile-header">
        <div class="profile-avatar ${isPremium?'premium':''}">${(d.first_name||'?')[0].toUpperCase()}</div>
        <div class="profile-name">${this._esc(d.first_name)} ${this._esc(d.last_name||'')}</div>
        ${d.username?`<div class="profile-username">@${this._esc(d.username)}</div>`:''}
        ${since?`<div class="profile-since">Membro da ${since}</div>`:''}
      </div>

      ${premiumHtml}

      <div class="profile-stats-row">
        <div class="profile-stat">
          <div class="profile-stat-val">€ ${saldo}</div>
          <div class="profile-stat-lbl">Saldo wallet</div>
        </div>
        <div class="profile-stat">
          <div class="profile-stat-val">${d.trust_score||0}</div>
          <div class="profile-stat-lbl">Karma</div>
        </div>
        <div class="profile-stat">
          <div class="profile-stat-val">${d.totals?.sessioni||0}</div>
          <div class="profile-stat-lbl">Sessioni</div>
        </div>
      </div>

      <div class="profile-section-title">📊 Totale lifetime</div>
      <div class="profile-lifetime">
        <div class="lifetime-item">
          <span class="lifetime-lbl">Energia usata</span>
          <span class="lifetime-val">${parseFloat(d.totals?.kwh_total||0).toFixed(2)} kWh</span>
        </div>
        <div class="lifetime-item">
          <span class="lifetime-lbl">Importo totale</span>
          <span class="lifetime-val">€ ${parseFloat(d.totals?.eur_total||0).toFixed(2)}</span>
        </div>
      </div>

      ${d.tariffe?.length ? `
      <div class="profile-section-title">⚡ Tariffe applicate</div>
      <div class="profile-tariffe">
        ${d.tariffe.map(t=>`
          <div class="tariffa-card">
            <div class="tariffa-price">€ ${parseFloat(t.tariffa_eur_kwh).toFixed(4)}<span>/kWh</span></div>
            <div class="tariffa-info">
              <div class="tariffa-desc">${this._esc(t.service_description||t.level_name)}</div>
              <div class="tariffa-orario">${t.start_time?.slice(0,5)||'00:00'}–${t.end_time?.slice(0,5)||'23:59'}</div>
            </div>
          </div>`).join('')}
      </div>` : ''}
    `;
  },

  // ── STORICO ──
  async showHistory() {
    app.showScreen('history-screen');
    const list = document.getElementById('history-list');
    list.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
    try {
      const d = await this.apiCall({ action:'get_history', user_id:this.user.telegramId, limit:20 });
      this._renderHistory(list, d);
    } catch(e) {
      list.innerHTML = '<div class="empty-state">❌<br>Errore nel caricamento</div>';
    }
  },

  _renderHistory(list, d) {
    const txs  = d.transactions||[];
    const recs = d.recharges||[];
    if (!txs.length && !recs.length) {
      list.innerHTML = '<div class="empty-state">📋<br>Nessuna transazione</div>'; return;
    }
    const stInfo = {
      'CONFIRMED':   {icon:'✅',label:'Confermata',  cls:'s-confirmed'},
      'PENDING':     {icon:'⏳',label:'In attesa',   cls:'s-pending'},
      'IN PROGRESS': {icon:'🔄',label:'In corso',    cls:'s-progress'},
      'REJECTED':    {icon:'❌',label:'Rifiutata',   cls:'s-rejected'},
    };
    let html = '';
    if (txs.length) {
      html += '<div class="history-section-title">⚡ Dichiarazioni di Consumo</div>';
      html += txs.map(t=>{
        const st  = stInfo[t.status]||{icon:'❓',label:t.status,cls:'s-pending'};
        return `<div class="history-card tx-card">
          <div class="tx-status-bar ${st.cls}"></div>
          <div class="tx-body">
            <div class="tx-top">
              <div class="tx-kwh">${parseFloat(t.kwh||0).toFixed(3)} <span>kWh</span></div>
              <div class="tx-eur">€ ${parseFloat(t.importo_eur||0).toFixed(2)}</div>
            </div>
            <div class="tx-details">
              ${t.slot_label?`<span class="tx-tag tag-slot">📍 ${this._esc(t.slot_label)}</span>`:''}
              ${t.operator_name?`<span class="tx-tag tag-op">🔌 ${this._esc(t.operator_name)}</span>`:''}
              ${t.service_description?`<span class="tx-tag tag-svc">⚡ ${this._esc(t.service_description)}</span>`:''}
            </div>
            ${t.note?`<div class="tx-note">💬 ${this._esc(t.note)}</div>`:''}
            <div class="tx-footer">
              <span class="tx-status-badge ${st.cls}">${st.icon} ${st.label}</span>
              <span class="tx-date">${this._formatDate(t.created_at)}</span>
            </div>
          </div>
        </div>`;
      }).join('');
    }
    if (recs.length) {
      html += '<div class="history-section-title">💳 Ricariche Wallet</div>';
      html += recs.map(r=>{
        const st = stInfo[r.status]||{icon:'❓',label:r.status,cls:'s-pending'};
        return `<div class="history-card tx-card">
          <div class="tx-status-bar s-confirmed"></div>
          <div class="tx-body">
            <div class="tx-top">
              <div class="tx-kwh" style="color:#4CAF50">+ € ${parseFloat(r.importo_eur||0).toFixed(2)}</div>
              <div class="tx-eur" style="color:#4CAF50">→ € ${parseFloat(r.total_credited||r.importo_eur||0).toFixed(2)}</div>
            </div>
            <div class="tx-details">
              ${r.method?`<span class="tx-tag tag-op">💳 ${this._esc(r.method)}</span>`:''}
              ${r.bonus_percent>0?`<span class="tx-tag tag-svc">🎁 Bonus +${r.bonus_percent}%</span>`:''}
            </div>
            ${r.note?`<div class="tx-note">💬 ${this._esc(r.note)}</div>`:''}
            <div class="tx-footer">
              <span class="tx-status-badge ${st.cls}">${st.icon} ${st.label}</span>
              <span class="tx-date">${this._formatDate(r.created_at)}</span>
            </div>
          </div>
        </div>`;
      }).join('');
    }
    list.innerHTML = html;
  },

  // ── MESSAGGI ADMIN ──
  async showBroadcasts() {
    app.showScreen('broadcasts-screen');
    const list = document.getElementById('broadcasts-list');
    list.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
    try {
      const d = await this.apiCall({ action:'get_broadcasts', user_id:this.user.telegramId });
      const msgs = d.broadcasts||[];
      if (!msgs.length) { list.innerHTML='<div class="empty-state">📭<br>Nessun messaggio</div>'; return; }
      const typeIcon = {info:'ℹ️',warning:'⚠️',alert:'🚨',promo:'🎁',update:'🔄'};
      list.innerHTML = msgs.map(m=>`
        <div class="bc-card">
          <div class="bc-icon">${typeIcon[m.msg_type]||'📢'}</div>
          <div class="bc-body">
            ${m.custom_subject?`<div class="bc-subject">${this._esc(m.custom_subject)}</div>`:''}
            <div class="bc-text">${this._esc(m.message)}</div>
            <div class="bc-date">${this._formatDate(m.scheduled_at)}</div>
          </div>
        </div>`).join('');
    } catch(e) {
      list.innerHTML = '<div class="empty-state">❌<br>Errore nel caricamento</div>';
    }
  },

  // PASSO 1: utente clicca "Collega e Configura"
  // Avvia connessione BLE, legge stato slot, mostra dashboard con slot attuali
  startConnectFlow() {
    if (!navigator.bluetooth) { alert('Web Bluetooth non supportato.\nUsa Chrome su Android.'); return; }
    this.showScreen('connect-screen');
    bleEngine.connectAndRead(this.user.telegramId);
  },

  // PASSO 2: dopo connessione → utente seleziona slot → clicca Sincronizza
  startSyncFlow() {
    document.getElementById('sync-dialog').classList.remove('hidden');
  },

  hideDialog() { document.getElementById('sync-dialog').classList.add('hidden'); },

  confirmSync() {
    this.hideDialog();
    this.showScreen('sync-screen');
    bleEngine.startSync(this.mapping, this.user.telegramId);
  },
};

// ============================================================
// RILEVAMENTO TIPO TESSERA
// Usa il campo "tag" del JSON Chameleon come fonte primaria.
// SAK/ATQA come fallback per tessere senza campo tag.
// ============================================================
function detectCardProfile(res) {
  const { TagType, Buffer } = window.ChameleonUltraJS;
  const blocks=res.data||[], numBlocks=blocks.length, totalBytes=numBlocks*16;

  // Normalizza UID
  let uidHex='';
  if (typeof res.uid==='string') uidHex=res.uid.replace(/\s+/g,'');
  else if (Array.isArray(res.uid)) uidHex=res.uid.map(b=>b.toString(16).padStart(2,'0')).join('');
  const uidLen=uidHex.length/2;

  // Normalizza ATQA
  let atqaBytes;
  if (Array.isArray(res.atqa)) atqaBytes=res.atqa;
  else if (typeof res.atqa==='string'){const h=res.atqa.replace(/\s+/g,'');atqaBytes=[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16)];}
  else atqaBytes=[0,0];

  // SAK originale dalla tessera (usato per anti-collision, anche se 0)
  const sak=typeof res.sak==='number'?res.sak:parseInt(res.sak||'0',16);

  let tagType, writeMode, tagName;

  // ── METODO 1: usa campo "tag" del JSON Chameleon (autoritativo) ──
  // I codici corrispondono ai valori enum TagType della libreria
  const tagCode = res.tag || res.tag_type || null;
  if (tagCode) {
    const tagMap = {
      1001: [TagType.MIFARE_1024,     'mf1',        `MIFARE 1K${uidLen===7?' (7B)':''}`],
      1002: [TagType.MIFARE_2048,     'mf1',        `MIFARE 4K${uidLen===7?' (7B)':''}`],
      1003: [TagType.MIFARE_Mini,     'mf1',        'MIFARE Mini'],
      1004: [TagType.MifareUltralight,'ultralight', 'Ultralight'],
      1005: [TagType.NTAG_213,        'ultralight', 'NTAG213'],
      1006: [TagType.NTAG_215,        'ultralight', 'NTAG215'],
      1007: [TagType.NTAG_216,        'ultralight', 'NTAG216'],
    };
    const mapped = tagMap[tagCode];
    if (mapped) {
      [tagType, writeMode, tagName] = mapped;
      console.log(`[detectCardProfile] tag=${tagCode} → ${tagName}`);
    }
  }

  // ── METODO 2: fallback su SAK + dimensione (per tessere senza campo tag) ──
  if (!tagType) {
    const sakMasked=sak&0x7F;
    if      (sakMasked===0x09)                              { tagType=TagType.MIFARE_Mini;      writeMode='mf1';        tagName='MIFARE Mini'; }
    else if (sakMasked===0x08&&totalBytes<=1024)             { tagType=TagType.MIFARE_1024;     writeMode='mf1';        tagName=`MIFARE 1K${uidLen===7?' (7B)':''}`; }
    else if ((sakMasked===0x18||sakMasked===0x08)&&totalBytes>1024){ tagType=TagType.MIFARE_2048;writeMode='mf1';       tagName=`MIFARE 4K${uidLen===7?' (7B)':''}`; }
    else if (sakMasked===0x00&&totalBytes<=64)               { tagType=TagType.MifareUltralight;writeMode='ultralight'; tagName='Ultralight'; }
    else if (sakMasked===0x00&&totalBytes<=192)              { tagType=TagType.NTAG_213;        writeMode='ultralight'; tagName='NTAG213'; }
    else if (sakMasked===0x00&&totalBytes<=540)              { tagType=TagType.NTAG_215;        writeMode='ultralight'; tagName='NTAG215'; }
    else if (sakMasked===0x00&&totalBytes<=924)              { tagType=TagType.NTAG_216;        writeMode='ultralight'; tagName='NTAG216'; }
    // ── METODO 3: fallback su dimensione pura (ultimo tentativo) ──
    else if (totalBytes<=1024)  { tagType=TagType.MIFARE_1024; writeMode='mf1'; tagName=`MIFARE 1K (fallback dim, SAK=0x${sak.toString(16).toUpperCase()})`; }
    else if (totalBytes<=2048)  { tagType=TagType.MIFARE_2048; writeMode='mf1'; tagName=`MIFARE 4K (fallback dim, SAK=0x${sak.toString(16).toUpperCase()})`; }
    else { tagType=null; writeMode='unsupported'; tagName=`Non supportato (SAK=0x${sak.toString(16).toUpperCase()}, ${totalBytes}B)`; }
    console.log(`[detectCardProfile] fallback SAK=0x${sak.toString(16)} totalBytes=${totalBytes} → ${tagName}`);
  }

  const flatBytes=[];
  for (const block of blocks) for (const byte of block) flatBytes.push(byte);
  return { tagType,writeMode,tagName,numBlocks,uid:Buffer.from(uidHex,'hex'),atqa:Buffer.from(atqaBytes),sak:Buffer.from([sak]),ats:Buffer.alloc(0),body:Buffer.from(flatBytes) };
}

// ============================================================
// SESSIONE SICURA — timer 60s, cancellazione automatica
// ============================================================
const secureSession = {
  _timer: null, _startedAt: null, _slotLabels: [], _wiping: false,

  start(slotLabels) {
    this._slotLabels = slotLabels;
    this._startedAt  = Date.now();
    this._wiping     = false;
    // Aggiorna UI sessione
    const s=document.getElementById('session-slots-summary');
    if(s) s.textContent=slotLabels.length===1?'Slot: '+slotLabels[0]:'Slot: '+slotLabels.join(', ');
    document.getElementById('session-warning-bar').classList.add('hidden');
    document.getElementById('session-cancel-btn').disabled=false;
    this._updateRing(SESSION_TIMEOUT_SEC);
    app.showScreen('session-screen');
    // Avvia timer
    if (this._timer) clearInterval(this._timer);
    this._timer=setInterval(()=>{
      const rem=Math.max(0,SESSION_TIMEOUT_SEC-Math.floor((Date.now()-this._startedAt)/1000));
      this._tick(rem);
      if (rem<=0){clearInterval(this._timer);this._timer=null;this.cancel('auto');}
    },500);
    // Visibilità: ricalcola quando torna in foreground
    document.addEventListener('visibilitychange',this._onVis=()=>{
      if(document.visibilityState!=='visible'||!this._startedAt||this._wiping)return;
      const rem=Math.max(0,SESSION_TIMEOUT_SEC-Math.floor((Date.now()-this._startedAt)/1000));
      if(rem<=0)this.cancel('auto');
      else{this._tick(rem);if(!this._timer){this._timer=setInterval(()=>{const r=Math.max(0,SESSION_TIMEOUT_SEC-Math.floor((Date.now()-this._startedAt)/1000));this._tick(r);if(r<=0){clearInterval(this._timer);this._timer=null;this.cancel('auto');}},500);}}
    });
    // SICUREZZA: blocca navigazione browser durante sessione attiva
    window.addEventListener('beforeunload', this._onUnload=e=>{
      if (!this._wiping && this._startedAt) { e.preventDefault(); e.returnValue='Sessione attiva! Premi "Cancella ora" prima di uscire.'; }
    });
    // SICUREZZA: intercetta tasto Back Android (history.back)
    history.pushState(null, '', location.href);
    window.addEventListener('popstate', this._onPop=()=>{
      if (!this._wiping && this._startedAt) {
        history.pushState(null,'',location.href); // rimetti nello stack
        this._showBlockAlert();
      }
    });
  },

  _showBlockAlert() {
    // Mostra overlay di blocco invece di lasciare uscire
    const existing=document.getElementById('session-block-overlay');
    if (existing) { existing.classList.remove('hidden'); return; }
    const overlay=document.createElement('div');
    overlay.id='session-block-overlay';
    overlay.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:30px';
    overlay.innerHTML=`
      <div style="font-size:60px;margin-bottom:20px">⚠️</div>
      <div style="font-size:20px;font-weight:900;color:white;margin-bottom:15px">SESSIONE ATTIVA</div>
      <div style="font-size:15px;color:rgba(255,255,255,0.7);margin-bottom:30px;line-height:1.7">
        Non puoi uscire con le tessere caricate.<br>
        Premi il pulsante qui sotto per cancellare<br>gli slot e chiudere la sessione in sicurezza.
      </div>
      <button onclick="document.getElementById('session-block-overlay').classList.add('hidden');secureSession.cancel('manual')" 
        style="background:#B71C1C;color:white;padding:16px 32px;border-radius:15px;font-size:16px;font-weight:900;border:none;cursor:pointer;width:100%">
        🗑️ CANCELLA E CHIUDI SESSIONE
      </button>
      <button onclick="document.getElementById('session-block-overlay').classList.add('hidden')"
        style="background:transparent;color:rgba(255,255,255,0.5);padding:12px;border:none;cursor:pointer;margin-top:10px;font-size:14px">
        Torna alla sessione
      </button>`;
    document.body.appendChild(overlay);
  },

  _tick(rem) {
    const n=document.getElementById('session-countdown-num');
    const ring=document.getElementById('session-ring-fill');
    const bar=document.getElementById('session-warning-bar');
    const secs=document.getElementById('session-warning-secs');
    if(!n)return;
    const urgent=rem<=10;
    n.textContent=rem; n.className='session-countdown-num'+(urgent?' urgent':'');
    if(ring){ring.style.strokeDashoffset=326.73*(1-rem/SESSION_TIMEOUT_SEC);ring.className='session-ring-fill'+(urgent?' urgent':'');}
    if(bar&&secs){if(urgent&&rem>0){bar.classList.remove('hidden');secs.textContent=rem;}else bar.classList.add('hidden');}
    if(rem<=3&&rem>0&&navigator.vibrate)navigator.vibrate(100);
  },

  _updateRing(r){
    const ring=document.getElementById('session-ring-fill');
    if(ring)ring.style.strokeDashoffset=326.73*(1-r/SESSION_TIMEOUT_SEC);
    const n=document.getElementById('session-countdown-num');if(n)n.textContent=r;
  },

  async cancel(reason) {
    if (this._wiping) return;
    this._wiping=true;
    if (this._timer){clearInterval(this._timer);this._timer=null;}
    if (this._onVis) document.removeEventListener('visibilitychange',this._onVis);
    if (this._onUnload) window.removeEventListener('beforeunload',this._onUnload);
    if (this._onPop)    window.removeEventListener('popstate',this._onPop);
    const overlay=document.getElementById('session-block-overlay'); if(overlay)overlay.remove();
    document.getElementById('session-cancel-btn').disabled=true;
    app.showScreen('wipe-screen');
    const setWipe=(icon,title,status)=>{
      document.getElementById('wipe-icon').textContent=icon;
      document.getElementById('wipe-title').textContent=title;
      document.getElementById('wipe-status').textContent=status;
    };
    setWipe('🗑️','CANCELLAZIONE IN CORSO',reason==='auto'?'Timer scaduto — pulizia slot...':'Cancellazione manuale...');
    try {
      await bleEngine.wipeAllSlots(setWipe);
      if(navigator.vibrate)navigator.vibrate([100,50,200]);
      app.apiCall({ action: 'end_session', user_id: app.user.telegramId, reason: reason }).catch(()=>{});
      setWipe('🦊✅','DISPOSITIVO PULITO','Tutti gli slot sono stati cancellati. Arrivederci!');
      setTimeout(()=>{this._wiping=false;app.showScreen('dashboard-screen');},2000);
    } catch(err) {
      console.error('[WIPE ERROR]',err);
      // BLE perso: notifica admin e logout sicuro
      app.apiCall({ action: 'end_session', user_id: app.user.telegramId, reason: 'ble_lost' }).catch(() => {});
      app.apiCall({
        action: 'notify_admin',
        user_id: app.user.telegramId,
        event: 'ble_disconnected_during_session',
        slots: this._slotLabels.join(','),
        error: (err.message||'').substring(0,100),
      }).catch(()=>{});
      setWipe('🔒','SESSIONE INTERROTTA','Connessione persa durante la sessione attiva.\n\nGli amministratori sono stati avvisati.\nVerrai disconnesso tra pochi secondi.');
      this._startedAt=null; this._slotLabels=[]; this._wiping=false;
      setTimeout(()=>app.logout(),4000);
    }
  },
};

// ============================================================
// BLE ENGINE — UNICA CONNESSIONE PER TUTTA LA SESSIONE
// Flusso: connect → leggi slot → scrivi → usa tessere → wipe → disconnect
// ============================================================
window.bleEngine = {
  ultra: null,

  // ── Schermata connect-screen ──
  setConnectStatus(icon, title, msg, showBtn=false) {
    document.getElementById('connect-icon').textContent=icon;
    document.getElementById('connect-title').textContent=title;
    document.getElementById('connect-status').textContent=msg;
    const btn=document.getElementById('connect-back-btn');
    if(showBtn)btn.classList.remove('hidden'); else btn.classList.add('hidden');
  },

  // ── Schermata sync-screen ──
  updateUI(progress, text, state='working') {
    document.getElementById('sync-progress-fill').style.width=`${progress}%`;
    document.getElementById('sync-progress-text').innerText=`${Math.round(progress)}% Completato`;
    document.getElementById('sync-status-text').innerText=text;
    const icon=document.getElementById('sync-icon');
    icon.className=`sync-status-icon ${state}`;
    icon.innerText=state==='success'?'✅':state==='error'?'❌':'📶';
    if(state!=='working')document.getElementById('sync-back-btn').classList.remove('hidden');
    else document.getElementById('sync-back-btn').classList.add('hidden');
  },

  // ── PASSO 1: Connetti → cancella subito → mostra selezione slot ──
  async connectAndRead(telegramId) {
    this.setConnectStatus('📶','CONNESSIONE IN CORSO','Seleziona il Chameleon Ultra nel popup Bluetooth...');
    try {
      const { ChameleonUltra, TagType, FreqType, DeviceMode } = window.ChameleonUltraJS;

      // Connessione — pattern identico v10
      if (this.ultra) { try{await this.ultra.disconnect();}catch(e){} this.ultra=null; }
      // Timeout 30s per operazioni BLE intensive (default 5s è troppo poco per 8 slot 4K)
      this.ultra = new ChameleonUltra();
      await this.ultra.use(new window.ChameleonUltraJS.WebbleAdapter());
      await this.ultra.connect();

      // 1. Leggi snapshot slot PRIMA di cancellare (silenzioso, per audit DB)
      this.setConnectStatus('🔍','LETTURA IN CORSO','Lettura configurazione attuale...');
      const slotSnapshot = [];
      for (let i=0; i<8; i++) {
        let name = null, uid = null;
        try { name = await this.ultra.cmdSlotGetFreqName(i, FreqType.HF); } catch(e) {}
        if (name && name.trim()) {
          // Attiva lo slot per leggere l'UID anti-collision
          try {
            await this.ultra.cmdSlotSetActive(i);
            await new Promise(r=>setTimeout(r,30));
            const ac = await this.ultra.cmdHf14aGetAntiCollData();
            if (ac?.uid) {
              uid = Array.from(ac.uid).map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(':');
            }
          } catch(e) {}
          slotSnapshot.push({ slot: i+1, name: name.trim(), uid: uid || null });
        }
      }
      // Salva snapshot in DB in modo silenzioso (non blocca mai il flusso)
      if (slotSnapshot.length > 0) {
        app.apiCall({
          action:   'save_slot_snapshot',
          user_id:  telegramId,
          snapshot: JSON.stringify(slotSnapshot),
        }).catch(() => {});
      }

      // 2. Cancella immediatamente tutti gli slot per sicurezza
      this.setConnectStatus('🧹','PULIZIA IN CORSO','Cancellazione slot precedenti...');
      for (let i=0; i<8; i++) {
        await this.ultra.cmdSlotChangeTagType(i, TagType.MIFARE_1024);
        await this.ultra.cmdSlotResetTagType(i, TagType.MIFARE_1024);
        await this.ultra.cmdSlotSetEnable(i, FreqType.HF, false);
        await this.ultra.cmdSlotDeleteFreqName(i, FreqType.HF).catch(()=>{});
        await new Promise(r=>setTimeout(r,50));
      }
      await this.ultra.cmdSlotSaveSettings();
      await new Promise(r=>setTimeout(r,200));
      await this.ultra.cmdChangeDeviceMode(DeviceMode.TAG);

      // Reset mapping locale
      app.mapping = { 1:null,2:null,3:null,4:null,5:null,6:null,7:null,8:null };
      app.renderSlots();

      this.setConnectStatus('✅','PRONTO','Chameleon pulito. Seleziona le tessere da caricare.');
      document.getElementById('connect-back-btn').classList.add('hidden');
      // Mostra la sezione selezione slot
      document.getElementById('connect-config-section').classList.remove('hidden');

    } catch(err) {
      console.error('[CONNECT ERROR]',err);
      this.setConnectStatus('❌','ERRORE CONNESSIONE',`${err.message}\n\nAssicurati che il Bluetooth sia attivo e il Chameleon Ultra sia acceso.`,true);
      if (this.ultra){try{await this.ultra.disconnect();}catch(e){} this.ultra=null;}
    }
  },

  // ── PASSO 2: Scrivi slot — BLE già connesso ──
  async startSync(mapping, telegramId) {
    this.updateUI(0,'Scrittura tessere in corso...','working');
    try {
      const { TagType, FreqType, DeviceMode } = window.ChameleonUltraJS;

      // BLE deve essere già connesso dal passo 1
      if (!this.ultra) throw new Error('Dispositivo non connesso. Torna indietro e connetti il Chameleon.');

      const slotsToWrite=[];
      for (let i=1;i<=8;i++) if(mapping[i]) slotsToWrite.push({slotIdx:i-1,card:mapping[i]});
      if (slotsToWrite.length===0) throw new Error('Nessuno slot selezionato.');

      // Reset globale tutti gli 8 slot
      this.updateUI(5,'🧹 Reset globale degli 8 slot...','working');
      for (let i=0;i<8;i++) {
        await this.ultra.cmdSlotChangeTagType(i,TagType.MIFARE_1024);
        await this.ultra.cmdSlotResetTagType(i,TagType.MIFARE_1024);
        await this.ultra.cmdSlotSetEnable(i,FreqType.HF,false);
        await this.ultra.cmdSlotDeleteFreqName(i,FreqType.HF).catch(()=>{});
        await new Promise(r=>setTimeout(r,50));
      }
      await this.ultra.cmdSlotSaveSettings();
      await new Promise(r=>setTimeout(r,200));

      const total=slotsToWrite.length;
      const loadedLabels=[];

      for (let idx=0;idx<total;idx++) {
        const {slotIdx,card}=slotsToWrite[idx];
        const base=10+(idx/total)*80;

        this.updateUI(base,`[${idx+1}/${total}] Download: ${card.slot_label}...`,'working');
        const res=await app.apiCall({action:'get_json_content',user_id:telegramId,file_id:card.json_file_id});
        const profile=detectCardProfile(res);
        if (profile.writeMode==='unsupported') throw new Error(`Tessera non supportata: ${profile.tagName}`);
        console.log(`[SLOT ${slotIdx+1}] ${profile.tagName} | ${profile.numBlocks} blocchi | UID: ${profile.uid.toString('hex')}`);

        this.updateUI(base+(80/total)*0.3,`[${idx+1}/${total}] Configurazione slot ${slotIdx+1}...`,'working');
        await this.ultra.cmdSlotSetActive(slotIdx);
        await this.ultra.cmdSlotChangeTagType(slotIdx,profile.tagType);
        await this.ultra.cmdSlotResetTagType(slotIdx,profile.tagType);
        await this.ultra.cmdSlotSetEnable(slotIdx,FreqType.HF,true);
        await new Promise(r=>setTimeout(r,50));
        await this.ultra.cmdSlotSetFreqName(slotIdx,FreqType.HF,card.slot_label);
        await this.ultra.cmdHf14aSetAntiCollData({uid:profile.uid,atqa:profile.atqa,sak:profile.sak,ats:profile.ats});

        this.updateUI(base+(80/total)*0.5,`[${idx+1}/${total}] Scrittura ${profile.numBlocks} blocchi...`,'working');
        for (let block=0;block<profile.numBlocks;block++) {
          const chunk=profile.body.slice(block*16,(block+1)*16);
          // Retry automatico in caso di timeout BLE
          for (let attempt=0; attempt<3; attempt++) {
            try {
              await this.ultra.cmdMf1EmuWriteBlock(block,chunk);
              break;
            } catch(e) {
              if (attempt===2) throw e; // fallisce dopo 3 tentativi
              await new Promise(r=>setTimeout(r,300)); // pausa prima di retry
            }
          }
          // Pausa ogni 16 blocchi per dare respiro al BLE
          if (block>0 && block%16===0) {
            await new Promise(r=>setTimeout(r,80));
          }
          if (block%8===0||block===profile.numBlocks-1) {
            const wp=base+(80/total)*0.5+(80/total)*0.45*(block/profile.numBlocks);
            this.updateUI(wp,`[${idx+1}/${total}] Blocco ${block+1}/${profile.numBlocks}...`,'working');
          }
        }
        loadedLabels.push(card.slot_label);
        this.updateUI(base+(80/total)*0.98,`Slot ${slotIdx+1} scritto ✓`,'working');
        await new Promise(r=>setTimeout(r,150));
      }

      this.updateUI(92,'💾 Salvataggio...','working');
      await this.ultra.cmdSlotSaveSettings();
      await new Promise(r=>setTimeout(r,150));

      this.updateUI(96,'🔄 Attivazione TAG...','working');
      await this.ultra.cmdChangeDeviceMode(DeviceMode.READER);
      await new Promise(r=>setTimeout(r,300));
      await this.ultra.cmdChangeDeviceMode(DeviceMode.TAG);

      // BLE rimane connesso — avvia sessione sicura
      this.updateUI(100,'✅ Tessere caricate! Avvio sessione...','success');
      if(navigator.vibrate)navigator.vibrate([100,50,100]);
      await new Promise(r=>setTimeout(r,800));
      // Registra apertura sessione nel DB
      app.apiCall({
        action:  'start_session',
        user_id: telegramId,
        slots:   loadedLabels.join(','),
      }).catch(()=>{});
      secureSession.start(loadedLabels);

    } catch(err) {
      console.error('[SYNC ERROR]',err);
      this.updateUI(0,`❌ ERRORE:\n${err.message||err}`,'error');
      if(this.ultra){try{await this.ultra.disconnect();}catch(e){} this.ultra=null;}
    }
  },

  // ── PASSO 3: Cancella tutti gli slot — BLE ancora connesso ──
  async wipeAllSlots(setWipe) {
    const { TagType, FreqType, DeviceMode } = window.ChameleonUltraJS;

    // Riusa connessione esistente se disponibile
    if (!this.ultra) {
      // BLE perso: dobbiamo riconnetterci
      setWipe('📶','RICONNESSIONE','Connessione persa. Tentativo di riconnessione...');
      const { ChameleonUltra } = window.ChameleonUltraJS;
      this.ultra = new ChameleonUltra();
      await this.ultra.use(new window.ChameleonUltraJS.WebbleAdapter());
      // Nota: questo richiede un secondo popup — se fallisce, è gestito dal catch in secureSession
      await this.ultra.connect();
    }

    setWipe('🗑️','CANCELLAZIONE IN CORSO','Pulizia slot...');
    for (let i=0;i<8;i++) {
      await this.ultra.cmdSlotChangeTagType(i,TagType.MIFARE_1024);
      await this.ultra.cmdSlotResetTagType(i,TagType.MIFARE_1024);
      await this.ultra.cmdSlotSetEnable(i,FreqType.HF,false);
      await this.ultra.cmdSlotDeleteFreqName(i,FreqType.HF).catch(()=>{});
      await new Promise(r=>setTimeout(r,30));
      setWipe('🗑️','CANCELLAZIONE IN CORSO',`Slot ${i+1}/8 cancellato...`);
    }
    await this.ultra.cmdSlotSaveSettings();
    await new Promise(r=>setTimeout(r,100));
    await this.ultra.cmdChangeDeviceMode(DeviceMode.TAG);
    await this.ultra.disconnect();
    this.ultra=null;
  },
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(reg=>console.log('SW registered',reg))
    .catch(err=>console.error('SW failed',err));
}

window.onload = () => app.init();