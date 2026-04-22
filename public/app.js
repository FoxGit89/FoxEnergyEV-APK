const API_BASE = "/app_api.php";

const app = {
  // State
  user: {
    telegramId: localStorage.getItem('telegram_id') || null,
    firstName: localStorage.getItem('first_name') || null,
  },
  dashboard: {},
  cards: [],
  mapping: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null, 8: null },
  currentSlotSelection: null,

  // Initialization
  init() {
    if (this.user.telegramId) {
      this.checkLicenseAndBoot();
    } else {
      this.showScreen('login-screen');
    }

    // Close bottom sheet if clicked outside
    document.getElementById('slot-picker').addEventListener('click', (e) => {
      if (e.target.id === 'slot-picker') this.hideSlotPicker();
    });
  },

  // UI Routing
  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
  },

  togglePassword() {
    const input = document.getElementById('login-card');
    input.type = input.type === 'password' ? 'text' : 'password';
  },

  // API Call helper
  async apiCall(params) {
    const url = window.location.origin + API_BASE;
    // Append parameters to URL
    const queryString = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
    const fullUrl = `${url}?${queryString}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(fullUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const text = await res.text(); // Leggiamo come testo prima per debug

      if (!res.ok) {
         throw new Error(`Server returned ${res.status}: ${text.substring(0, 50)}`);
      }

      try {
        return JSON.parse(text);
      } catch (parseError) {
        throw new Error(`Il server non ha restituito JSON valido. Raw: ${text.substring(0, 80)}...`);
      }

    } catch (e) {
      console.error('API Error details:', e);
      throw e;
    }
  },

  // Auth Flow
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
      // Offline or error, let them in if they have local session (optimistic)
      this.loadDashboard();
    }
  },

  async login() {
    const user = document.getElementById('login-username').value.trim();
    const card = document.getElementById('login-card').value.trim();
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');

    if (!user || !card) {
      errEl.textContent = "Compila tutti i campi richiesti.";
      errEl.classList.remove('hidden');
      return;
    }

    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0 auto;"></div>';

    try {
      const data = await this.apiCall({ action: 'login', username: user, card_number: card });
      if (data.success) {
        this.user.telegramId = data.telegram_id.toString();
        this.user.firstName = data.first_name.toString();
        localStorage.setItem('telegram_id', this.user.telegramId);
        localStorage.setItem('first_name', this.user.firstName);
        this.loadDashboard();
      } else {
        errEl.textContent = data.error || "Accesso negato.";
        errEl.classList.remove('hidden');
      }
    } catch (e) {
      errEl.textContent = "Errore di rete. Controlla la connessione.";
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = "ACCEDI AL SISTEMA";
    }
  },

  logout() {
    localStorage.clear();
    this.user = { telegramId: null, firstName: null };
    this.mapping = { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null, 8: null };

    // Reset auth gate styling if needed
    document.querySelector('.spinner').classList.remove('hidden');
    document.getElementById('auth-denied-content').classList.add('hidden');
    document.getElementById('auth-gate').classList.remove('denied');

    document.getElementById('login-username').value = '';
    document.getElementById('login-card').value = '';

    this.showScreen('login-screen');
  },

  // Dashboard Flow
  async loadDashboard() {
    this.showScreen('auth-gate'); // Show loading
    document.getElementById('dash-header-title').textContent = `CALISYNC • ${this.user.firstName}`;

    try {
      const [dashData, cardsData] = await Promise.all([
        this.apiCall({ action: 'get_dashboard', user_id: this.user.telegramId }),
        this.apiCall({ action: 'get_slots', user_id: this.user.telegramId })
      ]);

      if (dashData.error) {
        throw new Error("DASHBOARD: " + dashData.error);
      }
      if (cardsData.error) {
         throw new Error("SLOTS: " + cardsData.error);
      }

      this.dashboard = dashData;
      this.cards = Array.isArray(cardsData) ? cardsData : [];

      this.renderDashboard();
      this.renderSlots();
      this.showScreen('dashboard-screen');
    } catch (e) {
      console.error(e);
      alert(`Errore di caricamento:\n${e.message || "Connessione fallita."}`);
      this.logout();
    }
  },

  renderDashboard() {
    const bal = parseFloat(this.dashboard.saldo || 0);
    const isPremium = !!this.dashboard.is_premium;
    const isLow = bal < 2.0;

    document.getElementById('dash-balance-val').textContent = bal.toFixed(2);
    document.getElementById('dash-karma-val').textContent = this.dashboard.karma || "0";
    document.getElementById('dash-tariff-val').textContent = this.dashboard.loyalty_level || "Standard";

    const dashCard = document.getElementById('dash-card');
    dashCard.className = 'dashboard-card' + (isPremium ? ' premium' : '') + (isLow ? ' low-balance' : '');

    document.getElementById('dash-premium-badge').textContent = isPremium ? "FOX PREMIUM CLUB" : "UTENTE STANDARD";

    const warnEl = document.getElementById('dash-warning');
    if (isLow) warnEl.classList.remove('hidden');
    else warnEl.classList.add('hidden');

    // Populate Stats Screen data
    const monthNames = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
    document.getElementById('stats-month').textContent = monthNames[new Date().getMonth()];

    if (this.dashboard.monthly_stats) {
      document.getElementById('stat-energy').textContent = `${this.dashboard.monthly_stats.energy_kwh || '0.00'} kWh`;
      document.getElementById('stat-spent').textContent = `€ ${this.dashboard.monthly_stats.spent_eur || '0.00'}`;
      document.getElementById('stat-recharged').textContent = `€ ${this.dashboard.monthly_stats.recharged_eur || '0.00'}`;
    }
  },

  // Slot Management
  renderSlots() {
    const list = document.getElementById('slot-list');
    list.innerHTML = '';
    let canSync = false;

    for (let i = 1; i <= 8; i++) {
      const card = this.mapping[i];
      if (card) canSync = true;

      const div = document.createElement('div');
      div.className = `slot-card ${card ? 'active' : ''}`;
      div.onclick = () => this.openSlotPicker(i);
      div.innerHTML = `
        <div class="slot-num">${i}</div>
        <div class="slot-title">${card ? card.slot_label : 'Nessun dato assegnato'}</div>
        <div class="slot-icon">📝</div>
      `;
      list.appendChild(div);
    }

    const syncBtn = document.getElementById('start-sync-btn');
    if (canSync) {
      syncBtn.disabled = false;
      syncBtn.classList.add('active');
    } else {
      syncBtn.disabled = true;
      syncBtn.classList.remove('active');
    }
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
      const div = document.createElement('div');
      div.className = 'sheet-item';
      div.onclick = () => this.selectCardForSlot(card);
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

  // Sync Flow trigger
  startSyncFlow() {
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
  }
};

// ==========================================
// BLE & Chameleon Ultra Engine
// ==========================================
window.bleEngine = {
  ultra: null,

  updateUI(progress, text, state = 'working') {
    document.getElementById('sync-progress-fill').style.width = `${progress}%`;
    document.getElementById('sync-progress-text').innerText = `${Math.round(progress)}% Completato`;
    document.getElementById('sync-status-text').innerText = text;

    const icon = document.getElementById('sync-icon');
    icon.className = `sync-status-icon ${state}`;
    if (state === 'working') icon.innerText = '📶';
    else if (state === 'success') icon.innerText = '✅';
    else if (state === 'error') icon.innerText = '❌';

    if (state !== 'working') {
      document.getElementById('sync-back-btn').classList.remove('hidden');
    } else {
      document.getElementById('sync-back-btn').classList.add('hidden');
    }
  },

  parseCardData(json) {
    const result = {
      blocks: Array.from({ length: 64 }, () => new Array(16).fill(0)),
      uid: [],
      atqa: 0,
      sak: 0,
      ats: []
    };

    if (typeof json !== 'object') return result;

    if (json.uid && typeof json.uid === 'string') {
      const uidStr = json.uid.replace(/[^0-9A-Fa-f]/g, '');
      for (let i = 0; i < uidStr.length && result.uid.length < 7; i += 2) {
        result.uid.push(parseInt(uidStr.substring(i, i + 2), 16));
      }
    }

    if (json.data && Array.isArray(json.data)) {
      for (let i = 0; i < json.data.length && i < 64; i++) {
        if (typeof json.data[i] === 'string') {
          const blockStr = json.data[i].replace(/[^0-9A-Fa-f]/g, '');
          for (let j = 0; j < 32 && j < blockStr.length; j += 2) {
            result.blocks[i][j / 2] = parseInt(blockStr.substring(j, j + 2), 16);
          }
        }
      }
    }

    if (json.atqa && Array.isArray(json.atqa) && json.atqa.length >= 2) {
      result.atqa = (json.atqa[0] << 8) | json.atqa[1];
    } else if (typeof json.atqa === 'string') {
        const atqaStr = json.atqa.replace(/[^0-9A-Fa-f]/g, '');
        if (atqaStr.length >= 4) {
            result.atqa = parseInt(atqaStr, 16);
        }
    }

    if (json.sak !== undefined) {
      if (typeof json.sak === 'number') {
        result.sak = json.sak;
      } else if (typeof json.sak === 'string') {
        const sakStr = json.sak.replace(/[^0-9A-Fa-f]/g, '');
        if (sakStr) result.sak = parseInt(sakStr, 16);
      }
    }

    return result;
  },

  async startSync(mapping, telegramId) {
    this.updateUI(0, "Connessione al Chameleon Ultra in corso...\nSeleziona il dispositivo nel popup.", 'working');

    try {
      const { ChameleonUltra, Buffer, TagType, FreqType } = window.ChameleonUltraJS;

      if (!this.ultra) {
        this.ultra = new ChameleonUltra();
        this.ultra.use(new window.ChameleonUltraJS.WebbleAdapter());
      }

      await this.ultra.disconnect().catch(() => {}); // Ensure clean state
      await this.ultra.connect();

      const slotsToWrite = [];
      for (let i = 1; i <= 8; i++) {
        if (mapping[i]) slotsToWrite.push({ slotIdx: i - 1, card: mapping[i] });
      }

      const total = slotsToWrite.length;
      if (total === 0) throw new Error("Nessuno slot selezionato.");

      // First, completely clear and disable all 8 slots as requested
      this.updateUI(5, "Reset globale degli 8 slot in corso...", 'working');
      for (let i = 0; i < 8; i++) {
        await this.ultra.cmdSlotChangeTagType(i, TagType.MIFARE_1024);
        await this.ultra.cmdSlotResetTagType(i, TagType.MIFARE_1024);
        await this.ultra.cmdSlotSetEnable(i, FreqType.HF, false);
      }
      await this.ultra.cmdSlotSaveSettings();

      // Now process the active mappings
      let done = 0;
      for (const item of slotsToWrite) {
        const { slotIdx, card } = item;
        done++;

        this.updateUI((done / total) * 100 * 0.9, `Download dati per ${card.slot_label}...`, 'working');

        // Fetch JSON
        const res = await app.apiCall({ action: 'get_json_content', user_id: telegramId, file_id: card.json_file_id });
        const cardData = this.parseCardData(res);

        if (!cardData.uid || cardData.uid.length === 0) {
           throw new Error(`Dati non validi (UID mancante) per lo slot ${slotIdx + 1}`);
        }

        this.updateUI((done / total) * 100 * 0.9 + 5, `Scrittura Slot ${slotIdx + 1} (${card.slot_label})...`, 'working');

        // Set active and enable
        await this.ultra.cmdSlotChangeTagType(slotIdx, TagType.MIFARE_1024);
        await this.ultra.cmdSlotResetTagType(slotIdx, TagType.MIFARE_1024);
        await this.ultra.cmdSlotSetEnable(slotIdx, FreqType.HF, true);
        await this.ultra.cmdSlotSetActive(slotIdx);

        // Anti-collision
        const uidBuf = Buffer.from(cardData.uid);
        // Default values if not parsed correctly
        let atqaStr = cardData.atqa.toString(16).padStart(4, '0');
        // Webble adapter expects ATQA in little-endian sometimes, but let's send standard bytes
        // The flutter code sent `atqa & 0xFF`, `(atqa >> 8) & 0xFF` which is Little Endian.
        // Buffer.from('0400', 'hex') is what the JS docs show for standard 1K
        const atqaBuf = Buffer.from([(cardData.atqa >> 8) & 0xFF, cardData.atqa & 0xFF]);
        const sakBuf = Buffer.from([cardData.sak || 0x08]);

        await this.ultra.cmdHf14aSetAntiCollData({
          uid: uidBuf,
          atqa: atqaBuf.length === 2 ? Buffer.from([...atqaBuf].reverse()) : Buffer.from('0400', 'hex'), // reverse to match standard LE '0400'
          sak: sakBuf,
        });

        // Write blocks
        for (let b = 0; b < 64; b++) {
          const blockData = Buffer.from(cardData.blocks[b]);
          await this.ultra.cmdMf1EmuWriteBlock(b, blockData);
        }
      }

      // Final save and set tag mode
      this.updateUI(98, "Salvataggio impostazioni hardware...", 'working');
      await this.ultra.cmdSlotSaveSettings();
      await this.ultra.cmdChangeDeviceMode(window.ChameleonUltraJS.DeviceMode.TAG);

      await this.ultra.disconnect();
      this.updateUI(100, "✅ SINCRONIZZAZIONE COMPLETATA!\nLe tessere sono state caricate con successo.", 'success');

    } catch (err) {
      console.error(err);
      this.updateUI(0, `❌ ERRORE:\n${err.message || err}`, 'error');
      if (this.ultra) {
         try { await this.ultra.disconnect(); } catch(e){}
      }
    }
  }
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(reg => console.log('Service Worker registered', reg))
    .catch(err => console.error('Service Worker registration failed', err));
}

window.onload = () => app.init();
