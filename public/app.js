const API_BASE = "/app_api.php";

// ============================================================
// FUNZIONE DI RILEVAMENTO AUTOMATICO TIPO TESSERA
// ============================================================
function detectCardProfile(res) {
  const { TagType, Buffer } = window.ChameleonUltraJS;
  const blocks    = res.data || [];
  const numBlocks = blocks.length;
  const totalBytes = numBlocks * 16;

  let uidHex = '';
  if (typeof res.uid === 'string') {
    uidHex = res.uid.replace(/\s+/g, '');
  } else if (Array.isArray(res.uid)) {
    uidHex = res.uid.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const uidLen = uidHex.length / 2;

  let atqaBytes;
  if (Array.isArray(res.atqa)) {
    atqaBytes = res.atqa;
  } else if (typeof res.atqa === 'string') {
    const hex = res.atqa.replace(/\s+/g, '');
    atqaBytes = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16)];
  } else {
    atqaBytes = [0, 0];
  }

  const sak       = typeof res.sak === 'number' ? res.sak : parseInt(res.sak || '0', 16);
  const sakMasked = sak & 0x7F;

  let tagType, tagName;

  if (sakMasked === 0x09 && totalBytes <= 320) {
    tagType  = TagType.MIFARE_Mini;
    tagName  = 'MIFARE Mini (320B)';
  } else if (sakMasked === 0x08 && totalBytes <= 1024) {
    tagType  = TagType.MIFARE_1024;
    tagName  = `MIFARE Classic 1K${uidLen === 7 ? ' (7-byte UID)' : ''}`;
  } else if ((sakMasked === 0x18 || sakMasked === 0x08) && totalBytes > 1024) {
    tagType  = TagType.MIFARE_2048;
    tagName  = `MIFARE Classic 4K${uidLen === 7 ? ' (7-byte UID)' : ''}`;
  } else if (sakMasked === 0x00 && totalBytes <= 64) {
    tagType  = TagType.MifareUltralight;
    tagName  = 'MIFARE Ultralight';
  } else if (sakMasked === 0x00 && totalBytes <= 192) {
    tagType  = TagType.NTAG_213;
    tagName  = 'NTAG213';
  } else if (sakMasked === 0x00 && totalBytes <= 540) {
    tagType  = TagType.NTAG_215;
    tagName  = 'NTAG215';
  } else if (sakMasked === 0x00 && totalBytes <= 924) {
    tagType  = TagType.NTAG_216;
    tagName  = 'NTAG216';
  } else {
    const atqaWord = (atqaBytes[0] << 8) | atqaBytes[1];
    tagType  = null;
    tagName  = `Non supportato (SAK=0x${sak.toString(16).toUpperCase()}, ATQA=0x${atqaWord.toString(16).toUpperCase()}, ${totalBytes}B)`;
  }

  const flatBytes = [];
  for (const block of blocks) for (const byte of block) flatBytes.push(byte);

  return {
    tagType, tagName, numBlocks,
    uid:  window.ChameleonUltraJS.Buffer.from(uidHex, 'hex'),
    atqa: window.ChameleonUltraJS.Buffer.from(atqaBytes),
    sak:  window.ChameleonUltraJS.Buffer.from([sak]),
    ats:  window.ChameleonUltraJS.Buffer.alloc(0),
    body: window.ChameleonUltraJS.Buffer.from(flatBytes),
  };
}

// ============================================================
// APP OBJECT
// ============================================================
const app = {
  user: {
    telegramId: localStorage.getItem('telegram_id') || null,
    firstName:  localStorage.getItem('first_name')  || null,
  },
  dashboard:     {},
  cards:         [],
  notifications: [],
  history:       [],
  mapping: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null, 8: null },
  currentSlotSelection: null,

  init() {
    if (this.user.telegramId) {
      this.checkLicenseAndBoot();
    } else {
      this.showScreen('login-screen');
    }
    document.getElementById('slot-picker').addEventListener('click', (e) => {
      if (e.target.id === 'slot-picker') this.hideSlotPicker();
    });
  },

  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
  },

  togglePassword() {
    const input = document.getElementById('login-card');
    input.type  = input.type === 'password' ? 'text' : 'password';
  },

  // ============================================================
  // API CALL HELPER
  // Usa POST per il login (credenziali nel body JSON),
  // GET per tutte le altre action (nessun dato sensibile)
  // ============================================================
  async apiCall(params) {
    const url       = window.location.origin + API_BASE;
    const isLogin   = params.action === 'login';

    let fullUrl, fetchOptions;

    if (isLogin) {
      // POST: action in query string, credenziali nel body JSON
      fullUrl      = `${url}?action=login`;
      fetchOptions = {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body:    JSON.stringify(params),
      };
    } else {
      // GET: tutti i parametri in query string
      const qs = Object.keys(params)
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
        .join('&');
      fullUrl      = `${url}?${qs}`;
      fetchOptions = {
        method:  'GET',
        headers: { 'Accept': 'application/json' },
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 15000);
      const res        = await fetch(fullUrl, { ...fetchOptions, signal: controller.signal });
      clearTimeout(timeoutId);

      const text = await res.text();
      console.log(`[API ${fetchOptions.method} - ${params.action}] Status: ${res.status}\nRaw:`, text);

      if (!res.ok) throw new Error(`Server returned ${res.status}: ${text.substring(0, 80)}`);

      if (text.trim() === '') throw new Error('Risposta vuota dal server.');

      try {
        return JSON.parse(text);
      } catch (e) {
        // Pulizia output PHP sporco (warning prima del JSON)
        const fb   = text.indexOf('{');
        const fb2  = text.indexOf('[');
        let start  = -1;
        if (fb !== -1 && fb2 !== -1)    start = Math.min(fb, fb2);
        else if (fb !== -1)             start = fb;
        else if (fb2 !== -1)            start = fb2;

        if (start !== -1) {
          const isArr = text[start] === '[';
          const end   = isArr ? text.lastIndexOf(']') : text.lastIndexOf('}');
          if (end !== -1 && start < end) return JSON.parse(text.substring(start, end + 1));
        }
        throw new Error(`Invalid JSON. Raw: ${text.substring(0, 100)}...`);
      }
    } catch (e) {
      console.error(`[API ERROR - ${params.action}]:`, e);
      throw e;
    }
  },

  // ============================================================
  // AUTH FLOW
  // ============================================================
  async checkLicenseAndBoot() {
    this.showScreen('auth-gate');
    try {
      const data = await this.apiCall({ action: 'check_license', user_id: this.user.telegramId });
      if (data.access === false) {
        document.querySelector('.spinner').classList.add('hidden');
        document.getElementById('auth-denied-content').classList.remove('hidden');
        document.getElementById('auth-gate').classList.add('denied');
      } else {
        this.loadDashboard();
      }
    } catch (e) {
      this.loadDashboard(); // ottimistico se offline
    }
  },

  async login() {
    const user  = document.getElementById('login-username').value.trim();
    const card  = document.getElementById('login-card').value.trim();
    const errEl = document.getElementById('login-error');
    const btn   = document.getElementById('login-btn');

    if (!user || !card) {
      errEl.textContent = "Compila tutti i campi richiesti.";
      errEl.classList.remove('hidden');
      return;
    }

    errEl.classList.add('hidden');
    btn.disabled  = true;
    btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0 auto;"></div>';

    try {
      const data = await this.apiCall({ action: 'login', username: user, card_number: card });

      if (data.success) {
        this.user.telegramId = data.telegram_id.toString();
        this.user.firstName  = data.first_name.toString();
        localStorage.setItem('telegram_id', this.user.telegramId);
        localStorage.setItem('first_name',  this.user.firstName);
        this.loadDashboard();
      } else {
        errEl.textContent = data.error || "Accesso negato.";
        errEl.classList.remove('hidden');

        // Se rate limited, disabilita il pulsante per 30 secondi
        if (data.rate_limited) {
          btn.disabled = true;
          let secs = 30;
          const interval = setInterval(() => {
            secs--;
            btn.textContent = `Attendi ${secs}s...`;
            if (secs <= 0) {
              clearInterval(interval);
              btn.disabled    = false;
              btn.textContent = "ACCEDI AL SISTEMA";
            }
          }, 1000);
          return; // skip il finally
        }
      }
    } catch (e) {
      errEl.textContent = "Errore di rete. Controlla la connessione.";
      errEl.classList.remove('hidden');
    } finally {
      if (!btn.disabled) {
        btn.disabled    = false;
        btn.textContent = "ACCEDI AL SISTEMA";
      }
    }
  },

  logout() {
    localStorage.clear();
    this.user          = { telegramId: null, firstName: null };
    this.notifications = [];
    this.history       = [];
    this.mapping       = { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null, 8: null };

    document.querySelector('.spinner').classList.remove('hidden');
    document.getElementById('auth-denied-content').classList.add('hidden');
    document.getElementById('auth-gate').classList.remove('denied');
    document.getElementById('login-username').value = '';
    document.getElementById('login-card').value     = '';

    this.showScreen('login-screen');
  },

  // ============================================================
  // DASHBOARD
  // ============================================================
  async loadDashboard() {
    this.showScreen('auth-gate');
    document.getElementById('dash-header-title').textContent = `CALISYNC • ${this.user.firstName}`;

    try {
      const dashData  = await this.apiCall({ action: 'get_dashboard', user_id: this.user.telegramId });
      const cardsData = await this.apiCall({ action: 'get_slots',     user_id: this.user.telegramId });

      if (dashData.error)  throw new Error("DASHBOARD: " + dashData.error);
      if (cardsData.error) throw new Error("SLOTS: "     + cardsData.error);

      this.dashboard = dashData;
      this.cards     = Array.isArray(cardsData) ? cardsData : [];

      this.renderDashboard();
      this.renderSlots();
      this.showScreen('dashboard-screen');
      this.loadNotificationsQuiet();
    } catch (e) {
      console.error(e);
      alert(`Errore di caricamento:\n${e.message || "Connessione fallita."}`);
      this.logout();
    }
  },

  renderDashboard() {
    const bal       = parseFloat(this.dashboard.saldo || 0);
    const isPremium = !!this.dashboard.is_premium;
    const isLow     = bal < 2.0;

    document.getElementById('dash-balance-val').textContent   = bal.toFixed(2);
    document.getElementById('dash-karma-val').textContent     = this.dashboard.karma || "0";
    document.getElementById('dash-tariff-val').textContent    = this.dashboard.loyalty_level || "Standard";

    const dashCard = document.getElementById('dash-card');
    dashCard.className = 'dashboard-card' + (isPremium ? ' premium' : '') + (isLow ? ' low-balance' : '');
    document.getElementById('dash-premium-badge').textContent = isPremium ? "FOX PREMIUM CLUB" : "UTENTE STANDARD";

    const warnEl = document.getElementById('dash-warning');
    if (isLow) warnEl.classList.remove('hidden');
    else       warnEl.classList.add('hidden');

    const monthNames = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
    document.getElementById('stats-month').textContent = monthNames[new Date().getMonth()];

    if (this.dashboard.monthly_stats) {
      document.getElementById('stat-energy').textContent    = `${this.dashboard.monthly_stats.energy_kwh    || '0.00'} kWh`;
      document.getElementById('stat-spent').textContent     = `€ ${this.dashboard.monthly_stats.spent_eur   || '0.00'}`;
      document.getElementById('stat-recharged').textContent = `€ ${this.dashboard.monthly_stats.recharged_eur || '0.00'}`;
    }

    this.renderQuickActions();
  },

  // ============================================================
  // SLOT MANAGEMENT
  // ============================================================
  renderSlots() {
    const list = document.getElementById('slot-list');
    list.innerHTML = '';
    let canSync = false;

    for (let i = 1; i <= 8; i++) {
      const card = this.mapping[i];
      if (card) canSync = true;

      const div       = document.createElement('div');
      div.className   = `slot-card ${card ? 'active' : ''}`;
      div.onclick     = () => this.openSlotPicker(i);
      div.innerHTML   = `
        <div class="slot-num">${i}</div>
        <div class="slot-title">${card ? card.slot_label : 'Nessun dato assegnato'}</div>
        <div class="slot-icon">📝</div>
      `;
      list.appendChild(div);
    }

    const syncBtn     = document.getElementById('start-sync-btn');
    syncBtn.disabled  = !canSync;
    if (canSync) syncBtn.classList.add('active');
    else         syncBtn.classList.remove('active');
  },

  openSlotPicker(slotNum) {
    this.currentSlotSelection = slotNum;
    const list = document.getElementById('slot-picker-list');
    list.innerHTML = `
      <div class="sheet-item clear" onclick="app.selectCardForSlot(null)">
        <div style="font-size: 24px;">🚫</div>
        <div class="sheet-item-title">Svuota / Lascia vuoto</div>
      </div>
    `;
    this.cards.forEach(card => {
      const div     = document.createElement('div');
      div.className = 'sheet-item';
      div.onclick   = () => this.selectCardForSlot(card);
      div.innerHTML = `
        <div style="font-size: 24px; color: var(--primary-orange);">💳</div>
        <div class="sheet-item-title">${card.slot_label}</div>
      `;
      list.appendChild(div);
    });
    document.getElementById('slot-picker').classList.remove('hidden');
  },

  hideSlotPicker() {
    document.getElementById('slot-picker').classList.add('hidden');
  },

  selectCardForSlot(card) {
    if (this.currentSlotSelection) {
      this.mapping[this.currentSlotSelection] = card;
      this.renderSlots();
    }
    this.hideSlotPicker();
  },

  // ============================================================
  // SYNC FLOW
  // ============================================================
  startSyncFlow() {
    if (!navigator.bluetooth) {
      alert('Web Bluetooth non supportato.\nUsa Chrome su Android o Chrome Desktop.');
      return;
    }
    document.getElementById('sync-dialog').classList.remove('hidden');
  },

  hideDialog() {
    document.getElementById('sync-dialog').classList.add('hidden');
  },

  confirmSync() {
    this.hideDialog();
    this.showScreen('sync-screen');
    if (window.bleEngine) {
      window.bleEngine.startSync(this.mapping, this.user.telegramId);
    } else {
      document.getElementById('sync-status-text').innerText = "Motore BLE non inizializzato.";
      document.getElementById('sync-back-btn').classList.remove('hidden');
    }
  },

  // ============================================================
  // NOTIFICHE
  // ============================================================
  async loadNotificationsQuiet() {
    try {
      const data         = await this.apiCall({ action: 'get_notifications', user_id: this.user.telegramId });
      this.notifications = data.notifications || [];
      this.updateNotifBadge();
    } catch(e) {}
  },

  updateNotifBadge() {
    const count    = this.notifications.length;
    const dot      = document.getElementById('notif-header-dot');
    const qbtnNotif = document.getElementById('qbtn-notif');

    if (dot) {
      dot.textContent = count > 9 ? '9+' : (count || '');
      if (count > 0) dot.classList.remove('hidden');
      else           dot.classList.add('hidden');
    }
    if (qbtnNotif) {
      const sub = qbtnNotif.querySelector('.qbtn-sub');
      if (sub) sub.textContent = count > 0 ? `${count} nuove` : 'Nessuna';
      if (count > 0) qbtnNotif.classList.add('has-badge');
      else           qbtnNotif.classList.remove('has-badge');
    }
  },

  showNotifications() {
    this.renderNotifications();
    this.showScreen('notifications-screen');
  },

  renderNotifications() {
    const list = document.getElementById('notif-list');
    if (!list) return;

    if (!this.notifications || this.notifications.length === 0) {
      list.innerHTML = `
        <div class="notif-empty">
          <div style="font-size: 48px; margin-bottom: 16px;">🔔</div>
          <div style="color: var(--text-muted); font-size: 15px;">Nessuna notifica</div>
        </div>`;
      return;
    }

    const iconMap   = { warning: '⚠️', info: 'ℹ️', success: '✅', danger: '❌', alert: '🚨' };
    const srcLabel  = { admin: 'Fox Energy', system: 'Sistema' };

    list.innerHTML = this.notifications.map(n => `
      <div class="notif-card type-${n.type || 'info'}">
        <div class="notif-icon type-${n.type || 'info'}">${iconMap[n.type] || '🔔'}</div>
        <div class="notif-body">
          <div class="notif-source">${srcLabel[n.source] || n.source}</div>
          <div class="notif-msg">${this._escapeHtml(n.message)}</div>
          <div class="notif-date">${this._formatDate(n.date)}</div>
        </div>
      </div>`).join('');
  },

  // ============================================================
  // STORICO
  // ============================================================
  async showHistory() {
    this.showScreen('history-screen');
    const list   = document.getElementById('history-list');
    list.innerHTML = Array(4).fill('<div class="skeleton"></div>').join('');

    try {
      const data   = await this.apiCall({ action: 'get_history', user_id: this.user.telegramId, limit: 20 });
      this.history = data.history || [];
      this.renderHistory();
    } catch(e) {
      list.innerHTML = `<div class="notif-empty">
        <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
        <div style="color: #FF5252; font-size: 15px;">Errore nel caricamento</div>
      </div>`;
    }
  },

  renderHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;

    if (!this.history || this.history.length === 0) {
      list.innerHTML = `
        <div class="notif-empty">
          <div style="font-size: 48px; margin-bottom: 16px;">⚡</div>
          <div style="color: var(--text-muted); font-size: 15px;">Nessuna sessione trovata</div>
        </div>`;
      return;
    }

    const statusMap = {
      'CONFIRMED': ['confirmed', 'Confermata'], 'confirmed': ['confirmed', 'Confermata'],
      'pending':   ['pending',   'In attesa'],  'pending_approval': ['pending', 'In approvazione'],
      'active':    ['active',    'Attiva'],
      'failed':    ['failed',    'Fallita'],    'FAILED': ['failed', 'Fallita'],
    };

    list.innerHTML = this.history.map(h => {
      const [sc, sl] = statusMap[h.status] || ['pending', h.status];
      const sub      = [this._formatDate(h.date), h.duration ? `⏱ ${h.duration}` : ''].filter(Boolean).join(' · ');
      return `
        <div class="history-card">
          <div class="history-icon">⚡</div>
          <div class="history-body">
            <div class="history-title">${this._escapeHtml(h.slot_label || 'Ricarica')}</div>
            <div class="history-sub">${sub}</div>
          </div>
          <div class="history-right">
            <div class="history-kwh">${h.kwh ? h.kwh + ' kWh' : '— kWh'}</div>
            ${h.eur ? `<div class="history-eur">€ ${h.eur}</div>` : ''}
            <div class="history-status status-${sc}">${sl}</div>
          </div>
        </div>`;
    }).join('');
  },

  // ============================================================
  // QUICK ACTIONS (Storico + Notifiche nella dashboard)
  // ============================================================
  renderQuickActions() {
    const existing = document.getElementById('quick-actions-row');
    if (existing) existing.remove();

    const count     = (this.notifications || []).length;
    const container = document.getElementById('slot-list');
    if (!container) return;

    const row       = document.createElement('div');
    row.id          = 'quick-actions-row';
    row.className   = 'dash-quick-actions';
    row.innerHTML   = `
      <button id="qbtn-history" class="dash-quick-btn" onclick="app.showHistory()">
        <div class="qbtn-icon">📋</div>
        <div>
          <div class="qbtn-label">Storico</div>
          <div class="qbtn-sub">Ultime ricariche</div>
        </div>
      </button>
      <button id="qbtn-notif" class="dash-quick-btn ${count > 0 ? 'has-badge' : ''}" onclick="app.showNotifications()">
        <div class="qbtn-icon">🔔</div>
        <div>
          <div class="qbtn-label">Notifiche</div>
          <div class="qbtn-sub">${count > 0 ? `${count} nuove` : 'Nessuna'}</div>
        </div>
      </button>
    `;
    container.parentNode.insertBefore(row, container);
  },

  // ============================================================
  // HELPERS
  // ============================================================
  _formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d     = new Date(dateStr);
      const diffMs  = Date.now() - d;
      const diffMin = Math.floor(diffMs / 60000);
      const diffH   = Math.floor(diffMs / 3600000);
      const diffD   = Math.floor(diffMs / 86400000);
      if (diffMin < 1)  return 'Adesso';
      if (diffMin < 60) return `${diffMin} min fa`;
      if (diffH   < 24) return `${diffH}h fa`;
      if (diffD   <  7) return `${diffD}g fa`;
      return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch(e) { return dateStr; }
  },

  _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
};

// ============================================================
// BLE & Chameleon Ultra Engine
// ============================================================
window.bleEngine = {
  ultra: null,

  updateUI(progress, text, state = 'working') {
    document.getElementById('sync-progress-fill').style.width = `${progress}%`;
    document.getElementById('sync-progress-text').innerText   = `${Math.round(progress)}% Completato`;
    document.getElementById('sync-status-text').innerText     = text;

    const icon = document.getElementById('sync-icon');
    icon.className = `sync-status-icon ${state}`;
    icon.innerText = state === 'success' ? '✅' : state === 'error' ? '❌' : '📶';

    const backBtn = document.getElementById('sync-back-btn');
    if (state !== 'working') backBtn.classList.remove('hidden');
    else                     backBtn.classList.add('hidden');
  },

  async startSync(mapping, telegramId) {
    this.updateUI(0, "Connessione al Chameleon Ultra...\nSeleziona il dispositivo nel popup Bluetooth.", 'working');

    try {
      const { ChameleonUltra, Buffer, TagType, FreqType, DeviceMode } = window.ChameleonUltraJS;

      if (this.ultra) {
        try { await this.ultra.disconnect(); } catch(e) {}
        this.ultra = null;
      }

      this.ultra = new ChameleonUltra();
      this.ultra.use(new window.ChameleonUltraJS.WebbleAdapter());
      await this.ultra.connect();

      const slotsToWrite = [];
      for (let i = 1; i <= 8; i++) {
        if (mapping[i]) slotsToWrite.push({ slotIdx: i - 1, card: mapping[i] });
      }
      if (slotsToWrite.length === 0) throw new Error("Nessuno slot selezionato.");

      // ── Fase 1: pulizia globale tutti gli 8 slot ──
      this.updateUI(5, "🧹 Pulizia completa di tutti gli 8 slot...", 'working');
      for (let i = 0; i < 8; i++) {
        await this.ultra.cmdSlotChangeTagType(i, TagType.MIFARE_1024);
        await this.ultra.cmdSlotResetTagType(i, TagType.MIFARE_1024);
        await this.ultra.cmdSlotSetEnable(i, FreqType.HF, false);
        await this.ultra.cmdSlotDeleteFreqName(i, FreqType.HF).catch(() => {});
        await new Promise(r => setTimeout(r, 30));
      }
      await this.ultra.cmdSlotSaveSettings();
      await new Promise(r => setTimeout(r, 100));

      // ── Fase 2: scrittura slot per slot ──
      const total = slotsToWrite.length;
      for (let idx = 0; idx < total; idx++) {
        const { slotIdx, card } = slotsToWrite[idx];
        const baseProgress      = 10 + (idx / total) * 80;

        this.updateUI(baseProgress, `[${idx+1}/${total}] 📥 Download: ${card.slot_label}...`, 'working');

        const res     = await app.apiCall({ action: 'get_json_content', user_id: telegramId, file_id: card.json_file_id });
        const profile = detectCardProfile(res);

        if (!profile.tagType) throw new Error(`Tessera non supportata: ${profile.tagName}\nSlot: ${card.slot_label}`);

        console.log(`[SLOT ${slotIdx+1}] ${profile.tagName} | ${profile.numBlocks} blocchi | UID: ${profile.uid.toString('hex')}`);

        this.updateUI(baseProgress + (80/total)*0.25, `[${idx+1}/${total}] ⚙️ Configurazione slot ${slotIdx+1}...`, 'working');

        await this.ultra.cmdSlotSetActive(slotIdx);
        await this.ultra.cmdSlotChangeTagType(slotIdx, profile.tagType);
        await this.ultra.cmdSlotResetTagType(slotIdx, profile.tagType);
        await this.ultra.cmdSlotSetEnable(slotIdx, FreqType.HF, true);
        await new Promise(r => setTimeout(r, 50));
        await this.ultra.cmdSlotSetFreqName(slotIdx, FreqType.HF, card.slot_label);
        await this.ultra.cmdHf14aSetAntiCollData({ uid: profile.uid, atqa: profile.atqa, sak: profile.sak, ats: profile.ats });

        this.updateUI(baseProgress + (80/total)*0.4, `[${idx+1}/${total}] 💾 Scrittura ${profile.numBlocks} blocchi...`, 'working');

        for (let block = 0; block < profile.numBlocks; block++) {
          const chunk = profile.body.slice(block * 16, (block + 1) * 16);
          await this.ultra.cmdMf1EmuWriteBlock(block, chunk);
          if (block % 8 === 0 || block === profile.numBlocks - 1) {
            const wp = baseProgress + (80/total)*0.4 + (80/total)*0.55 * (block / profile.numBlocks);
            this.updateUI(wp, `[${idx+1}/${total}] Blocco ${block+1}/${profile.numBlocks}...`, 'working');
          }
        }

        this.updateUI(baseProgress + (80/total)*0.98, `✓ Slot ${slotIdx+1} scritto`, 'working');
        await new Promise(r => setTimeout(r, 80));
      }

      // ── Fase 3: salvataggio e reload ──
      this.updateUI(92, "💾 Salvataggio impostazioni hardware...", 'working');
      await this.ultra.cmdSlotSaveSettings();
      await new Promise(r => setTimeout(r, 150));

      this.updateUI(96, "🔄 Reload firmware del dispositivo...", 'working');
      await this.ultra.cmdChangeDeviceMode(DeviceMode.READER);
      await new Promise(r => setTimeout(r, 300));
      await this.ultra.cmdChangeDeviceMode(DeviceMode.TAG);

      await this.ultra.disconnect();
      this.ultra = null;

      this.updateUI(100, "✅ SINCRONIZZAZIONE COMPLETATA!\nLe tessere sono state caricate con successo.", 'success');

    } catch (err) {
      console.error('[BLE SYNC ERROR]', err);
      this.updateUI(0, `❌ ERRORE:\n${err.message || err}`, 'error');
      if (this.ultra) {
        try { await this.ultra.disconnect(); } catch(e) {}
        this.ultra = null;
      }
    }
  }
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(reg => console.log('SW registered', reg))
    .catch(err => console.error('SW failed', err));
}

window.onload = () => app.init();
