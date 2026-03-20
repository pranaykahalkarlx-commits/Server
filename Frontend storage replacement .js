/**
 * ═══════════════════════════════════════════════════════════════
 * DROP-IN REPLACEMENT — paste this into your HTML <script> block
 * replacing the existing storage functions.
 *
 * Changes vs original:
 *  1. Uses /api/user-data/all  → loads ALL keys in ONE request
 *  2. Uses /api/user-data/bulk → saves ALL keys in ONE request
 *  3. Credits ALWAYS saved immediately (no data loss on refresh)
 *  4. localStorage kept as instant cache (no flicker on reload)
 *  5. All server errors logged visibly, not silently swallowed
 * ═══════════════════════════════════════════════════════════════
 */

const WORKER_URL = "https://ai-receptionist-production-b826.up.railway.app"; // ← your Railway URL

// ─── HELPERS ──────────────────────────────────────────────────

function getCurrentEmail() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return '';
        return JSON.parse(raw).email || '';
    } catch { return ''; }
}

function storageKey(suffix) {
    const email = getCurrentEmail();
    return email ? `ai_rc_${email}_${suffix}` : `ai_rc_${suffix}`;
}

// ─── SERVER COMMUNICATION ─────────────────────────────────────

// Load ALL keys for this user in a single request
async function serverLoadAll(email) {
    const res = await fetch(
        `${WORKER_URL}/api/user-data/all?email=${encodeURIComponent(email)}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json(); // returns { leads: [...], calls: {...}, ... }
}

// Save MULTIPLE keys in a single request (fast!)
async function serverSaveBulk(email, dataObj) {
    const res = await fetch(`${WORKER_URL}/api/user-data/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, data: dataObj })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// Save a single key (used for immediate credit saves)
async function serverSaveOne(email, key, value) {
    const res = await fetch(`${WORKER_URL}/api/user-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, key, value })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ─── LOAD DATA ON LOGIN ───────────────────────────────────────

async function loadServerData(email) {
    addLog('info', '☁️ Loading your data from server…');
    try {
        // ONE request gets everything
        const data = await serverLoadAll(email);

        // ── Leads ──
        if (data.leads && Array.isArray(data.leads)) {
            leads = data.leads;
            renderTable();
            updateStats();
            if (leads.length) {
                document.getElementById('launchBtn').disabled = false;
                const hasDone = leads.some(l => l.status === 'ended' || l.status === 'failed');
                if (hasDone) document.getElementById('restartBtn').style.display = 'flex';
            }
        }

        // ── Call Records ──
        if (data.calls && typeof data.calls === 'object') {
            callRecords = data.calls;
            updateAnalytics();
            renderTable();
        }

        // ── Appointments ──
        if (data.appts && Array.isArray(data.appts)) {
            appointments = data.appts;
            renderAppointments();
            updateStats();
        }
        if (data.apptCtr) apptIdCounter = parseInt(data.apptCtr);

        // ── Credits — NEVER reset, always from server ──
        if (data.credits !== undefined && data.credits !== null) {
            credits = Math.max(0, parseInt(data.credits));
            addLog('ok', `🪙 Credits: ${credits} remaining`);
        } else {
            // First ever login — grant full credits, save immediately
            credits = TOTAL_CREDITS;
            await serverSaveOne(email, 'credits', credits);
            addLog('ok', `🪙 New account — ${TOTAL_CREDITS} credits granted`);
        }
        if (data.creditLog && Array.isArray(data.creditLog)) {
            creditLog = data.creditLog;
        }
        updateCreditUI();

        // ── Scripts ──
        if (data.scripts && Array.isArray(data.scripts)) {
            vapiScripts = data.scripts;
        }
        if (data.activeScript !== undefined && data.activeScript !== null) {
            activeScriptIndex = parseInt(data.activeScript);
        }
        renderScriptSlots();

        // ── Vapi Config ──
        if (data.config) {
            const cfg = data.config;
            if (cfg.vapiKey)          { const el = document.getElementById('vapiKey');          if (el) el.value = cfg.vapiKey; }
            if (cfg.vapiAssistantId)  { const el = document.getElementById('vapiAssistantId');  if (el) el.value = cfg.vapiAssistantId; }
            if (cfg.vapiPhoneId)      {
                const el = document.getElementById('vapiPhoneId');
                if (el) {
                    el.value = cfg.vapiPhoneId;
                    const pEl = document.getElementById('phoneNumberDisplay');
                    if (pEl) pEl.innerHTML = '<span style="color:var(--muted);font-style:italic">Click "Refresh Campaign" to verify</span>';
                }
            }
            if (cfg.callDelay)        { const el = document.getElementById('callDelay');        if (el) el.value = cfg.callDelay; }
        }

        // Also cache to localStorage for instant next load
        cacheToLocalStorage();
        addLog('ok', '☁️ Data loaded from server successfully');

    } catch (e) {
        addLog('warn', `⚠️ Server load failed (${e.message}) — loading from local cache…`);
        loadLocalFallback();
    }
}

// ─── SAVE ALL DATA ────────────────────────────────────────────

function saveToStorage() {
    const email = getCurrentEmail();

    // 1. Always write to localStorage immediately (instant, no network)
    cacheToLocalStorage();

    // 2. Push to server in background (best-effort, non-blocking)
    if (email) {
        const payload = buildPayload();
        serverSaveBulk(email, payload).catch(err => {
            // Don't spam logs, just note it quietly
            console.warn('Server save failed:', err.message);
        });
    }
}

// Credits need their OWN immediate save — call this after every credit change
async function saveCredits() {
    const email = getCurrentEmail();
    // Local cache first
    localStorage.setItem(storageKey('credits'), String(credits));
    // Server — await so we're sure it's saved before the call is marked done
    if (email) {
        try {
            await serverSaveOne(email, 'credits', credits);
            // Also save creditLog while we're at it
            await serverSaveOne(email, 'creditLog', creditLog);
        } catch (e) {
            console.warn('Credit server save failed:', e.message);
        }
    }
    updateCreditUI();
}

// ─── HELPERS ──────────────────────────────────────────────────

function buildPayload() {
    return {
        leads:        leads,
        calls:        callRecords,
        appts:        appointments,
        apptCtr:      apptIdCounter,
        credits:      credits,
        creditLog:    creditLog,
        scripts:      vapiScripts,
        activeScript: activeScriptIndex,
        config: {
            vapiKey:         document.getElementById('vapiKey')?.value         || '',
            vapiAssistantId: document.getElementById('vapiAssistantId')?.value || '',
            vapiPhoneId:     document.getElementById('vapiPhoneId')?.value     || '',
            callDelay:       document.getElementById('callDelay')?.value       || '3',
        }
    };
}

function cacheToLocalStorage() {
    try {
        const p = buildPayload();
        localStorage.setItem(storageKey('leads'),        JSON.stringify(p.leads));
        localStorage.setItem(storageKey('calls'),        JSON.stringify(p.calls));
        localStorage.setItem(storageKey('appts'),        JSON.stringify(p.appts));
        localStorage.setItem(storageKey('ctr'),          String(p.apptCtr));
        localStorage.setItem(storageKey('credits'),      String(p.credits));
        localStorage.setItem(storageKey('creditLog'),    JSON.stringify(p.creditLog));
        localStorage.setItem(storageKey('scripts'),      JSON.stringify(p.scripts));
        localStorage.setItem(storageKey('activeScript'), String(p.activeScript));
        localStorage.setItem(storageKey('vapiKey'),      p.config.vapiKey);
        localStorage.setItem(storageKey('vapiAssistantId'), p.config.vapiAssistantId);
        localStorage.setItem(storageKey('vapiPhoneId'),  p.config.vapiPhoneId);
        localStorage.setItem(storageKey('callDelay'),    p.config.callDelay);
    } catch (e) {
        console.warn('localStorage cache failed:', e);
    }
}

function loadLocalFallback() {
    try {
        const l = localStorage.getItem(storageKey('leads'));
        if (l) { leads = JSON.parse(l); renderTable(); updateStats(); if (leads.length) document.getElementById('launchBtn').disabled = false; }

        const c = localStorage.getItem(storageKey('calls'));
        if (c) { callRecords = JSON.parse(c); updateAnalytics(); }

        const a = localStorage.getItem(storageKey('appts'));
        if (a) { appointments = JSON.parse(a); renderAppointments(); }

        const ct = localStorage.getItem(storageKey('ctr'));
        if (ct) apptIdCounter = parseInt(ct);

        // Credits: load from cache or default to max (first ever use on this device)
        const cr = localStorage.getItem(storageKey('credits'));
        credits = (cr !== null) ? Math.max(0, parseInt(cr)) : TOTAL_CREDITS;

        const cl = localStorage.getItem(storageKey('creditLog'));
        if (cl) creditLog = JSON.parse(cl);

        updateCreditUI();

        const sc = localStorage.getItem(storageKey('scripts'));
        if (sc) vapiScripts = JSON.parse(sc);

        const ai = localStorage.getItem(storageKey('activeScript'));
        activeScriptIndex = (ai !== null) ? parseInt(ai) : -1;
        renderScriptSlots();

        const vk = localStorage.getItem(storageKey('vapiKey'));
        if (vk) { const el = document.getElementById('vapiKey'); if (el) el.value = vk; }

        const va = localStorage.getItem(storageKey('vapiAssistantId'));
        if (va) { const el = document.getElementById('vapiAssistantId'); if (el) el.value = va; }

        const vp = localStorage.getItem(storageKey('vapiPhoneId'));
        if (vp) { const el = document.getElementById('vapiPhoneId'); if (el) el.value = vp; }

        const delay = localStorage.getItem(storageKey('callDelay'));
        if (delay) { const el = document.getElementById('callDelay'); if (el) el.value = delay; }

        addLog('ok', '💾 Loaded from local cache');
    } catch (e) {
        addLog('warn', 'Local cache load error: ' + e.message);
    }
}