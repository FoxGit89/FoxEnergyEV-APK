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
      console.log(`[API RESPONSE - ${params.action}] Status: ${res.status}\nRaw Text:`, text);

      if (!res.ok) {
         throw new Error(`Server returned ${res.status}: ${text.substring(0, 80)}`);
      }

      try {
        if (text.trim() === '') {
             throw new Error('Risposta vuota dal server.');
        }

        // Prima cerchiamo di parsare l'intera stringa in modo standard
        try {
            return JSON.parse(text);
        } catch (e) {
            // Se fallisce, cerchiamo il primo '{' o '[' per pulire l'output da eventuali warning PHP
            const firstBrace = text.indexOf('{');
            const firstBracket = text.indexOf('[');

            let startIndex = -1;
            if (firstBrace !== -1 && firstBracket !== -1) {
                startIndex = Math.min(firstBrace, firstBracket);
            } else if (firstBrace !== -1) {
                startIndex = firstBrace;
            } else if (firstBracket !== -1) {
                startIndex = firstBracket;
            }

            if (startIndex !== -1) {
                // Troviamo l'ultima parentesi corrispondente
                const isArray = text[startIndex] === '[';
                const lastIndex = isArray ? text.lastIndexOf(']') : text.lastIndexOf('}');

                if (lastIndex !== -1 && startIndex < lastIndex) {
                    const cleanJsonStr = text.substring(startIndex, lastIndex + 1);
                    return JSON.parse(cleanJsonStr);
                }
            }
            throw e; // Rilanciamo se non riusciamo a salvarlo
        }
      } catch (parseError) {
        throw new Error(`Invalid JSON. Raw: ${text.substring(0, 100)}...`);
      }

    } catch (e) {
      console.error(`[API ERROR - ${params.action}]:`, e);
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
      // Dobbiamo fare le chiamate in sequenza perché il server built-in di PHP
      // è single-threaded e non gestisce bene le richieste simultanee (Promise.all)
      const dashData = await this.apiCall({ action: 'get_dashboard', user_id: this.user.telegramId });
      const cardsData = await this.apiCall({ action: 'get_slots', user_id: this.user.telegramId });

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

// ============================================================ 
// FUNZIONE UNIVERSALE DI RILEVAMENTO TIPO TESSERA 
// Da incollare in app.js, prima di bleEngine 
// ============================================================ 
 
function detectCardProfile(res) { 
  const { TagType } = window.ChameleonUltraJS; 
  const blocks = res.data || []; 
  const numBlocks = blocks.length; 
  const totalBytes = numBlocks * 16; 
 
  // ── 1. Normalizza UID (stringa con spazi o array o hex plain) ── 
  let uidHex = ''; 
  if (typeof res.uid === 'string') { 
    uidHex = res.uid.replace(/\s+/g, ''); 
  } else if (Array.isArray(res.uid)) { 
    uidHex = res.uid.map(b => b.toString(16).padStart(2, '0')).join(''); 
  } 
  const uidLen = uidHex.length / 2; // in byte 
 
  // ── 2. Normalizza ATQA ── 
  // Il tuo formato: array [0, 68] → i due byte ATQA 
  // Alcune app li salvano in little-endian, altre big-endian 
  let atqaBytes; 
  if (Array.isArray(res.atqa)) { 
    atqaBytes = res.atqa;                         // [0, 68] 
  } else if (typeof res.atqa === 'string') { 
    const hex = res.atqa.replace(/\s+/g, ''); 
    atqaBytes = [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16)]; 
  } else { 
    atqaBytes = [0, 0]; 
  } 
  // ATQA convenzionale: byte[0]=MSB, byte[1]=LSB 
  // Nel tuo esempio [0, 68] → 0x0044 → bit 6 set → 4K, bit 0 = 4-byte UID (ma UID è 7 byte → contraddizione tipica di cloni) 
  const atqaWord = (atqaBytes[0] << 8) | atqaBytes[1]; // 0x0044 nel tuo esempio 
 
  // ── 3. Normalizza SAK ── 
  const sak = typeof res.sak === 'number' ? res.sak : parseInt(res.sak, 16); 
 
  // ── 4. Rileva TagType dalla tripletta SAK + ATQA + dimensione dump ── 
  // 
  //  SAK  | ATQA     | Note 
  //  0x08 | 0x0004   | MIFARE Classic 1K  (64 blocchi  = 1024 byte) 
  //  0x18 | 0x0002   | MIFARE Classic 4K  (256 blocchi... ma dump 128 blocchi = 2048 byte con settori grandi) 
  //  0x09 | 0x0004   | MIFARE Mini        (20 blocchi  =  320 byte) 
  //  0x08 | 0x0044   | MIFARE Classic 1K con UID 7 byte (caso tuo: sak=8, atqa=[0,68]) 
  //  0x18 | 0x0044   | MIFARE Classic 4K con UID 7 byte 
  //  0x00 | 0x0044   | MIFARE Ultralight / NTAG (UID 7 byte, nessuna cifratura) 
  //  0x20 | 0x0344   | MIFARE DESFire (non supportato in emulazione MF1) 
 
  let tagType; 
  let writeMode;   // 'mf1' | 'ultralight' | 'unsupported' 
  let tagName; 
 
  const sakMasked = sak & 0x7F; // bit 7 non rilevante per tipo 
 
  if (sakMasked === 0x09) { 
    // MIFARE Mini: 5 settori × 4 blocchi = 20 blocchi = 320 byte 
    tagType  = TagType.MIFARE_Mini; 
    writeMode = 'mf1'; 
    tagName  = 'MIFARE Mini (320 B)'; 
 
  } else if (sakMasked === 0x08 && totalBytes <= 1024) { 
    // MIFARE Classic 1K 
    tagType  = TagType.MIFARE_1024; 
    writeMode = 'mf1'; 
    tagName  = `MIFARE Classic 1K${uidLen === 7 ? ' (7-byte UID)' : ''}`; 
 
  } else if (sakMasked === 0x18 || (sakMasked === 0x08 && totalBytes > 1024)) { 
    // MIFARE Classic 4K — SAK 0x18 oppure SAK 0x08 con dump grande 
    tagType  = TagType.MIFARE_2048; 
    writeMode = 'mf1'; 
    tagName  = `MIFARE Classic 4K${uidLen === 7 ? ' (7-byte UID)' : ''}`; 
 
  } else if (sakMasked === 0x00 && totalBytes <= 64) { 
    // MIFARE Ultralight standard: 16 pagine × 4 byte = 64 byte 
    tagType  = TagType.MifareUltralight; 
    writeMode = 'ultralight'; 
    tagName  = 'MIFARE Ultralight'; 
 
  } else if (sakMasked === 0x00 && totalBytes <= 192) { 
    // NTAG213: 45 pagine × 4 byte = 180 byte 
    tagType  = TagType.NTAG_213; 
    writeMode = 'ultralight'; 
    tagName  = 'NTAG213'; 
 
  } else if (sakMasked === 0x00 && totalBytes <= 540) { 
    // NTAG215: 135 pagine × 4 byte = 540 byte 
    tagType  = TagType.NTAG_215; 
    writeMode = 'ultralight'; 
    tagName  = 'NTAG215'; 
 
  } else if (sakMasked === 0x00 && totalBytes <= 924) { 
    // NTAG216: 231 pagine × 4 byte = 924 byte 
    tagType  = TagType.NTAG_216; 
    writeMode = 'ultralight'; 
    tagName  = 'NTAG216'; 
 
  } else { 
    // Tipo non supportato per emulazione (es. DESFire, ISO15693...) 
    tagType  = null; 
    writeMode = 'unsupported'; 
    tagName  = `Sconosciuto (SAK=0x${sak.toString(16).toUpperCase()}, ATQA=0x${atqaWord.toString(16).toUpperCase()}, ${totalBytes}B)`; 
  } 
 
  const { Buffer } = window.ChameleonUltraJS; 
 
  // ── 5. Costruisci il body buffer ── 
  const flatBytes = []; 
  for (const block of blocks) { 
    for (const byte of block) flatBytes.push(byte); 
  } 
 
  return { 
    tagType, 
    writeMode, 
    tagName, 
    numBlocks, 
    uid: Buffer.from(uidHex, 'hex'), 
    atqa: Buffer.from(atqaBytes), 
    sak: Buffer.from([sak]), 
    ats: Buffer.alloc(0), 
    body: Buffer.from(flatBytes), 
  }; 
}

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

  async startSync(mapping, telegramId) { 
    this.updateUI(0, "Connessione al Chameleon Ultra...\nSeleziona il dispositivo nel popup.", 'working'); 
   
    try { 
      const { ChameleonUltra, Buffer, TagType, FreqType, DeviceMode, Slot } = window.ChameleonUltraJS; 
   
      // Reset ultra se in stato corrotto da sync precedente 
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
   
      // ── FASE 1: Reset globale tutti e 8 gli slot ── 
      this.updateUI(5, "Reset globale degli 8 slot...", 'working'); 
      for (let i = 0; i < 8; i++) { 
        await this.ultra.cmdSlotChangeTagType(i, TagType.MIFARE_1024); 
        await this.ultra.cmdSlotResetTagType(i, TagType.MIFARE_1024); 
        await this.ultra.cmdSlotSetEnable(i, FreqType.HF, false); 
        await this.ultra.cmdSlotDeleteFreqName(i, FreqType.HF).catch(() => {}); 
        await new Promise(r => setTimeout(r, 30)); // delay BLE 
      } 
      await this.ultra.cmdSlotSaveSettings(); 
      await new Promise(r => setTimeout(r, 100)); 
   
      // ── FASE 2: Scrittura slot per slot ── 
      const total = slotsToWrite.length; 
      for (let idx = 0; idx < total; idx++) { 
        const { slotIdx, card } = slotsToWrite[idx]; 
        const baseProgress = 10 + (idx / total) * 80; 
   
        this.updateUI(baseProgress, `[${idx+1}/${total}] Download: ${card.slot_label}...`, 'working'); 
   
        // Download JSON da Telegram 
        const res = await app.apiCall({ 
          action: 'get_json_content', 
          user_id: telegramId, 
          file_id: card.json_file_id 
        }); 
   
        const profile = detectCardProfile(res); 
        
        if (profile.writeMode === 'unsupported') { 
          throw new Error(`Tessera non supportata: ${profile.tagName}`); 
        } 
        
        console.log(`[SLOT ${slotIdx+1}] Rilevata: ${profile.tagName} | ${profile.numBlocks} blocchi | UID: ${profile.uid.toString('hex')}`); 
        
        this.updateUI(baseProgress + (80/total)*0.3, `[${idx+1}/${total}] Configurazione slot ${slotIdx+1}...`, 'working'); 

        // Configura slot 
        await this.ultra.cmdSlotSetActive(slotIdx); 
        await this.ultra.cmdSlotChangeTagType(slotIdx, profile.tagType); 
        await this.ultra.cmdSlotResetTagType(slotIdx, profile.tagType); 
        await this.ultra.cmdSlotSetEnable(slotIdx, FreqType.HF, true); 
        await new Promise(r => setTimeout(r, 50)); 
        await this.ultra.cmdSlotSetFreqName(slotIdx, FreqType.HF, card.slot_label); 
        
        // Anti-collision 
        await this.ultra.cmdHf14aSetAntiCollData({ 
          uid: profile.uid, 
          atqa: profile.atqa, 
          sak: profile.sak, 
          ats: profile.ats, 
        }); 
        
        this.updateUI(baseProgress + (80/total)*0.5, `[${idx+1}/${total}] Scrittura ${profile.numBlocks} blocchi...`, 'working'); 

        // Scrittura blocchi (uguale per tutti i tipi MF1) 
        for (let block = 0; block < profile.numBlocks; block++) { 
          const chunk = profile.body.slice(block * 16, (block + 1) * 16); 
          await this.ultra.cmdMf1EmuWriteBlock(block, chunk); 
          if (block % 8 === 0) { 
            const wp = baseProgress + (80/total)*0.5 + (80/total)*0.45*(block/profile.numBlocks); 
            this.updateUI(wp, `[${idx+1}/${total}] Blocco ${block}/${profile.numBlocks}...`, 'working'); 
          } 
        } 
   
        this.updateUI(baseProgress + (80/total)*0.98, `Slot ${slotIdx+1} scritto ✓`, 'working'); 
        await new Promise(r => setTimeout(r, 80)); 
      } 
   
      // ── FASE 3: Salvataggio e reload ── 
      this.updateUI(92, "Salvataggio impostazioni...", 'working'); 
      await this.ultra.cmdSlotSaveSettings(); 
      await new Promise(r => setTimeout(r, 150)); 
   
      // Ciclo READER→TAG per forzare reload chiavi dalla flash 
      await this.ultra.cmdChangeDeviceMode(DeviceMode.READER); 
      await new Promise(r => setTimeout(r, 300)); 
      await this.ultra.cmdChangeDeviceMode(DeviceMode.TAG); 
   
      await this.ultra.disconnect(); 
      this.ultra = null; 
   
      this.updateUI(100, "✅ SINCRONIZZAZIONE COMPLETATA!\nLe tessere sono state caricate con successo.", 'success'); 
   
    } catch (err) { 
      console.error(err); 
      this.updateUI(0, `❌ ERRORE:\n${err.message || err}`, 'error'); 
      if (this.ultra) { 
        try { await this.ultra.disconnect(); } catch(e) {} 
        this.ultra = null; // ← reset sempre dopo errore 
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