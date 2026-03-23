// ==================== FIREBASE CONFIG ====================
const firebaseConfig = {
    apiKey: "AIzaSyBVw-llKk9Ia2yGMNI4t3awkX_RaNApNjQ",
    authDomain: "slc-bidding.firebaseapp.com",
    projectId: "slc-bidding",
    storageBucket: "slc-bidding.firebasestorage.app",
    messagingSenderId: "972353252534",
    appId: "1:972353252534:web:f552d870c013920b81ca17",
    measurementId: "G-YN5X517GPJ"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ==================== CONSTANTS ====================
const ADMIN_PASS = "00110011";
const PLAYER_FEE = 50;
const MANAGER_FEE = 200;
const PAYMENT_NUMBER = "01830038179";

// ==================== STATE ====================
let state = {
    role: null, // 'player' | 'manager' | 'admin'
    currentUser: null,
    players: [],
    managers: [],
    settings: { maxPlayers: 6, playersPerMatch: 6, teamBudget: 1500, baseBid: 50 },
    bidSession: null,
    currentBidPlayer: null,
    bidCountdown: null,
    bidHeld: false,
    remainingPlayers: [],
    unsoldPlayers: [],
    soldPlayers: [],
    matches: [],
    swapMatchId: null,
};

let confirmCallback = null;
let unsubscribers = [];
let paymentContext = null; // 'player' | 'manager'

// ==================== UTILS ====================
function toggleBtnLoading(isLoading, btn) {
    if (!btn) return;
    if (isLoading) {
        btn.disabled = true;
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin inline-block align-text-bottom mr-1"></i> PROCESSING...`;
        btn.classList.add('opacity-70', 'pointer-events-none');
        lucide.createIcons();
    } else {
        btn.disabled = false;
        if (btn.dataset.originalText) btn.innerHTML = btn.dataset.originalText;
        btn.classList.remove('opacity-70', 'pointer-events-none');
        lucide.createIcons();
    }
}
function notify(msg, icon = 'info') {
    const toast = document.getElementById('custom-toast');
    document.getElementById('toast-message').innerText = msg;
    document.getElementById('toast-icon').setAttribute('data-lucide', icon);
    lucide.createIcons();
    toast.classList.remove('hidden');
    toast.classList.add('animate-pop-in');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.classList.add('hidden'); toast.classList.remove('animate-pop-in'); }, 3200);
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); lucide.createIcons(); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function askConfirm(msg, cb) {
    document.getElementById('confirm-message').innerText = msg;
    openModal('modal-confirm');
    confirmCallback = cb;
}
document.getElementById('confirm-ok').onclick = () => { closeModal('modal-confirm'); if (confirmCallback) confirmCallback(); confirmCallback = null; };
document.getElementById('confirm-cancel').onclick = () => { closeModal('modal-confirm'); confirmCallback = null; };

function copyId() {
    const id = state.currentUser?.id || '';
    navigator.clipboard.writeText(id).then(() => notify('ID Copied!', 'copy')).catch(() => notify('Copy failed', 'x'));
}
function copyPaymentNumber() {
    navigator.clipboard.writeText('01830038179').then(() => {
        notify('Number Copied!', 'copy');
    }).catch(() => notify('Copy failed', 'x'));
}

function getAvatarUI(person, w = 'w-10', h = 'h-10', r = 'rounded-full') {
    const initial = (person?.name || 'U').charAt(0).toUpperCase();
    const color = person?.avatar ? '' : 'bg-slate-700';
    if (person?.avatar) {
        return `<img src="${person.avatar}" class="${w} ${h} ${r} object-cover border border-white/10" onerror="this.outerHTML='<div class=\\'${w} ${h} ${r} ${color} flex items-center justify-center font-black text-white text-sm border border-white/10\\'>${initial}</div>'">`;
    }
    return `<div class="${w} ${h} ${r} ${color} flex items-center justify-center font-black text-white text-sm border border-white/10">${initial}</div>`;
}

function generatePlayerId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let suffix = '';
    for (let i = 0; i < 7; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    return 'SBID' + suffix;
}

function generateManagerId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let suffix = '';
    for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    return 'SBIDT' + suffix;
}

function generateSerialNumber(existingCount) {
    return 'SBID' + String(existingCount + 1).padStart(2, '0');
}

function saveLocal(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {} }
function loadLocal(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch(e) { return null; } }

// ==================== AUTH ====================
function selectRole(role) {
    document.getElementById('role-select').classList.add('hidden');
    if (role === 'player') { document.getElementById('player-auth').classList.remove('hidden'); }
    else { document.getElementById('manager-auth').classList.remove('hidden'); }
    lucide.createIcons();
}

function backToRoles() {
    document.getElementById('player-auth').classList.add('hidden');
    document.getElementById('manager-auth').classList.add('hidden');
    document.getElementById('role-select').classList.remove('hidden');
}

function switchAuthTab(tab) {
    if (tab === 'p-login') {
        document.getElementById('p-login-form').classList.remove('hidden');
        document.getElementById('p-signup-form').classList.add('hidden');
        document.getElementById('btn-p-login').className = 'flex-1 py-2 text-[10px] font-black uppercase rounded-lg bg-emerald-600 text-white transition-all';
        document.getElementById('btn-p-signup').className = 'flex-1 py-2 text-[10px] font-black uppercase rounded-lg text-slate-500 transition-all';
    } else if (tab === 'p-signup') {
        document.getElementById('p-login-form').classList.add('hidden');
        document.getElementById('p-signup-form').classList.remove('hidden');
        document.getElementById('btn-p-signup').className = 'flex-1 py-2 text-[10px] font-black uppercase rounded-lg bg-emerald-600 text-white transition-all';
        document.getElementById('btn-p-login').className = 'flex-1 py-2 text-[10px] font-black uppercase rounded-lg text-slate-500 transition-all';
    } else if (tab === 'm-login') {
        document.getElementById('m-login-form').classList.remove('hidden');
        document.getElementById('m-signup-form').classList.add('hidden');
        document.getElementById('btn-m-login').className = 'flex-1 py-2 text-[10px] font-black uppercase rounded-lg bg-blue-600 text-white transition-all';
        document.getElementById('btn-m-signup').className = 'flex-1 py-2 text-[10px] font-black uppercase rounded-lg text-slate-500 transition-all';
    } else if (tab === 'm-signup') {
        document.getElementById('m-login-form').classList.add('hidden');
        document.getElementById('m-signup-form').classList.remove('hidden');
        document.getElementById('btn-m-signup').className = 'flex-1 py-2 text-[10px] font-black uppercase rounded-lg bg-blue-600 text-white transition-all';
        document.getElementById('btn-m-login').className = 'flex-1 py-2 text-[10px] font-black uppercase rounded-lg text-slate-500 transition-all';
    }
}

async function registerPlayer() {
    const btn = window.event ? window.event.target.closest('button') : null;
    const name = document.getElementById('p-name').value.trim();
    const fb = document.getElementById('p-fb').value.trim();
    const phone = document.getElementById('p-phone').value.trim();
    const avatar = document.getElementById('p-avatar').value.trim();
    const konamiId = document.getElementById('p-konami').value.trim();
    const deviceName = document.getElementById('p-device').value.trim();
    
    if (!name || !phone || !konamiId || !deviceName) return notify('Name, Phone, Konami ID & Device required!', 'alert-circle');

    toggleBtnLoading(true, btn);

    let pid;
    let unique = false;
    while (!unique) {
        pid = generatePlayerId();
        const snap = await db.collection('players').doc(pid).get();
        if (!snap.exists) unique = true;
    }

    const playerData = {
        id: pid, name, fb, phone, avatar,
        konamiId, deviceName, lastEditAt: null,
        role: 'player',
        paymentStatus: 'none',
        trxid: null,
        serialNumber: null,
        teamId: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection('players').doc(pid).set(playerData);
        notify(`Registered! Your ID: ${pid}`, 'check-circle');
        document.getElementById('p-login-id').value = pid;
        switchAuthTab('p-login');
        setTimeout(() => loginPlayerWithId(pid), 800);
    } catch (e) {
        notify('Registration failed. Try again.', 'x-circle');
    } finally {
        toggleBtnLoading(false, btn);
    }
}

async function loginPlayer() {
    const btn = window.event ? window.event.target.closest('button') : null;
    const id = document.getElementById('p-login-id').value.trim().toUpperCase();
    if (!id) return notify('Enter your ID', 'alert-circle');
    
    toggleBtnLoading(true, btn);
    try {
        await loginPlayerWithId(id);
    } finally {
        toggleBtnLoading(false, btn);
    }
}

async function loginPlayerWithId(id) {
    try {
        const snap = await db.collection('players').doc(id).get();
        if (!snap.exists) return notify('Player ID not found!', 'x-circle');
        const data = snap.data();
        state.role = 'player';
        state.currentUser = data;
        saveLocal('slc_session', { role: 'player', id: id });
        launchPlayerApp();
    } catch (e) {
        notify('Login failed. Check your connection.', 'x-circle');
    }
}

async function registerManager() {
    const btn = window.event ? window.event.target.closest('button') : null;
    const teamName = document.getElementById('m-team-name').value.trim();
    const logo = document.getElementById('m-logo').value.trim();
    const ownerName = document.getElementById('m-owner-name').value.trim();
    const phone = document.getElementById('m-phone').value.trim();
    const fb = document.getElementById('m-fb').value.trim();
    const avatar = document.getElementById('m-avatar').value.trim();
    const konamiId = document.getElementById('m-konami').value.trim();
    const deviceName = document.getElementById('m-device').value.trim();
    
    if (!teamName || !ownerName || !phone || !konamiId || !deviceName) return notify('All fields including Konami & Device required!', 'alert-circle');

    toggleBtnLoading(true, btn);

    let mid, pid;
    let uniqueM = false, uniqueP = false;
    while (!uniqueM) {
        mid = generateManagerId();
        const snap = await db.collection('managers').doc(mid).get();
        if (!snap.exists) uniqueM = true;
    }
    while (!uniqueP) {
        pid = generatePlayerId();
        const snap = await db.collection('players').doc(pid).get();
        if (!snap.exists) uniqueP = true;
    }

    const managerData = {
        id: mid, teamName, name: ownerName, logo,
        role: 'manager', paymentStatus: 'none', trxid: null, budget: 0,
        players:[], swapUsed: false, managerPlayerId: pid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const playerData = {
        id: pid, name: ownerName, fb, phone, avatar,
        konamiId, deviceName, lastEditAt: null,
        role: 'player', paymentStatus: 'none', trxid: null,
        serialNumber: null, teamId: mid, isManager: true, bidPrice: 0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        const batch = db.batch();
        batch.set(db.collection('managers').doc(mid), managerData);
        batch.set(db.collection('players').doc(pid), playerData);
        await batch.commit();

        notify(`Team Registered! ID: ${mid}`, 'check-circle');
        document.getElementById('m-login-id').value = mid;
        switchAuthTab('m-login');
        setTimeout(() => loginManagerWithId(mid), 800);
    } catch (e) {
        notify('Registration failed.', 'x-circle');
    } finally {
        toggleBtnLoading(false, btn);
    }
}

async function loginManager() {
    const btn = window.event ? window.event.target.closest('button') : null;
    const id = document.getElementById('m-login-id').value.trim().toUpperCase();
    if (!id) return notify('Enter your Team ID', 'alert-circle');
    
    toggleBtnLoading(true, btn);
    try {
        await loginManagerWithId(id);
    } finally {
        toggleBtnLoading(false, btn);
    }
}

async function loginManagerWithId(id) {
    try {
        const snap = await db.collection('managers').doc(id).get();
        if (!snap.exists) return notify('Team ID not found!', 'x-circle');
        state.role = 'manager';
        state.currentUser = snap.data();
        saveLocal('slc_session', { role: 'manager', id: id });
        launchManagerApp();
    } catch (e) {
        notify('Login failed.', 'x-circle');
    }
}

function loginAsAdmin() {
    const pass = document.getElementById('admin-pass-input').value;
    if (pass !== ADMIN_PASS) return notify('Wrong Admin Password!', 'shield-x');
    state.role = 'admin';
    state.currentUser = { id: 'ADMIN', name: 'Admin' };
    saveLocal('slc_session', { role: 'admin' });
    launchAdminApp();
}

function logoutUser() {
    askConfirm('Are you sure you want to logout?', () => {
        unsubscribers.forEach(u => u());
        unsubscribers = [];
        clearBidCountdown();
        state = { role: null, currentUser: null, players: [], managers: [], settings: { maxPlayers: 6, teamBudget: 1500, baseBid: 50 }, bidSession: null, currentBidPlayer: null, bidCountdown: null, bidHeld: false, remainingPlayers: [], unsoldPlayers: [], soldPlayers: [], matches: [], swapMatchId: null };
        saveLocal('slc_session', null);
        document.getElementById('player-app').classList.add('hidden');
        document.getElementById('manager-app').classList.add('hidden');
        document.getElementById('admin-app').classList.add('hidden');
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('admin-pass-input').value = '';
        backToRoles();
        lucide.createIcons();
    });
}

// Auto-login on page load
window.addEventListener('load', async () => {
    lucide.createIcons();
    const session = loadLocal('slc_session');
    if (session) {
        if (session.role === 'player') await loginPlayerWithId(session.id);
        else if (session.role === 'manager') await loginManagerWithId(session.id);
        else if (session.role === 'admin') {
            state.role = 'admin';
            state.currentUser = { id: 'ADMIN', name: 'Admin' };
            launchAdminApp();
        }
    }
});

// ==================== PAYMENT ====================
function openPaymentModal(context) {
    paymentContext = context;
    document.getElementById('pay-amount').textContent = context === 'player' ? '৳' + PLAYER_FEE : '৳' + MANAGER_FEE;
    document.getElementById('pay-trxid').value = '';
    openModal('modal-payment');
}

async function submitPayment() {
    const btn = window.event ? window.event.target.closest('button') : null;
    const trxid = document.getElementById('pay-trxid').value.trim().toUpperCase();
    
    const trxidRegex = /^[A-Z0-9]{8,12}$/;
    
    if (!trxid) return notify('Please enter your TRXID!', 'alert-circle');
    if (!trxidRegex.test(trxid)) return notify('Invalid TRXID Format! (e.g. DCL7DCD581)', 'alert-triangle');
    
    const userId = state.currentUser.id;
    const col = paymentContext === 'player' ? 'players' : 'managers';
    
    toggleBtnLoading(true, btn);
    try {
        await db.collection(col).doc(userId).update({
            paymentStatus: 'pending',
            trxid: trxid,
            paymentSubmittedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        state.currentUser.paymentStatus = 'pending';
        state.currentUser.trxid = trxid;
        
        closeModal('modal-payment');
        notify('Payment verified! Waiting for admin approval.', 'check-circle');
        
        if (paymentContext === 'player') renderPlayerPaymentArea();
        else renderManagerPaymentArea();
    } catch (e) {
        notify('Verification failed. Try again.', 'x-circle');
    } finally {
        toggleBtnLoading(false, btn);
    }
}
// ==================== PLAYER APP ====================
function launchPlayerApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('player-app').classList.remove('hidden');
    const u = state.currentUser;
    document.getElementById('p-header-id').textContent = u.id;
    document.getElementById('p-header-name').textContent = u.name;
    document.getElementById('p-header-avatar').innerHTML = getAvatarUI(u, 'w-8', 'h-8', 'rounded-xl');
    switchPTab('home');
    subscribeAll();
    lucide.createIcons();
}

function switchPTab(tab) {
    const tabs = ['home', 'bid', 'teams', 'schedule','profile', 'info'];
    
    tabs.forEach(t => {
        const contentSection = document.getElementById(`p-tab-${t}`);
        const navItem = document.getElementById(`pnav-${t}`);
        if (contentSection) {
            contentSection.classList.toggle('hidden', t !== tab);
        }
        if (navItem) {
            navItem.classList.toggle('active', t === tab);
        }
    });
    switch (tab) {
        case 'home':
            renderPlayerHome();
            break;
        case 'teams':
            renderPlayerTeams();
            break;
        case 'schedule':
            renderPlayerSchedule();
            break;
        case 'profile':
            renderPlayerProfile();
            break;
            case 'info':
            renderInfoTab('p-info-container', document.getElementById('p-info-search').value);
            break;
        case 'bid':
            if (typeof renderBidHistory === 'function') renderBidHistory();
            break;
    }
    lucide.createIcons();
}

function renderPlayerHome() {
    const u = state.currentUser;
    const approved = state.players.filter(p => p.paymentStatus === 'approved');
    const pending = state.players.filter(p => p.paymentStatus === 'pending');
    const teams = state.managers.filter(m => m.paymentStatus === 'approved');

    document.getElementById('p-stat-registered').textContent = approved.length;
    document.getElementById('p-stat-pending').textContent = pending.length;
    document.getElementById('p-stat-teams').textContent = teams.length;
    renderPlayerPaymentArea();
    renderPlayersList();
}

function renderPlayerPaymentArea() {
    const u = state.currentUser;
    const area = document.getElementById('p-reg-status-area');
    if (u.paymentStatus === 'approved') {
        area.innerHTML = `
        <div class="space-y-2">
            <div class="flex items-center gap-2 bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-3">
                <i data-lucide="check-circle" class="w-4 h-4 text-emerald-400 flex-shrink-0"></i>
                <div>
                    <div class="text-[9px] font-black text-emerald-400 uppercase">Registration Complete</div>
                    <div class="text-[8px] text-slate-400 font-bold">Serial: ${u.serialNumber || '--'}</div>
                </div>
            </div>
        </div>`;
    } else if (u.paymentStatus === 'pending') {
        area.innerHTML = `
        <div class="bg-gold-900/20 border border-gold-500/30 rounded-xl p-3 flex items-center gap-2">
            <i data-lucide="clock" class="w-4 h-4 text-gold-400 flex-shrink-0"></i>
            <div>
                <div class="text-[9px] font-black text-gold-400 uppercase">Waiting for Admin Approval</div>
                <div class="text-[8px] text-slate-400 font-bold">TRXID: ${u.trxid}</div>
            </div>
        </div>`;
    } else {
        area.innerHTML = `
        <button onclick="openPaymentModal('player')" class="w-full py-4 bg-gradient-to-r from-gold-600 to-gold-700 text-black rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl active:scale-95 transition-transform flex items-center justify-center gap-2">
            <i data-lucide="zap" class="w-4 h-4"></i> REGISTER NOW
        </button>
        <p class="text-[8px] text-slate-500 text-center mt-2 font-bold">Entry Fee: ৳${PLAYER_FEE}</p>`;
    }
    lucide.createIcons();
}

function renderPlayersList() {
    const list = document.getElementById('p-players-list');
    const approved = state.players.filter(p => p.paymentStatus === 'approved').sort((a, b) => (a.serialNumber || '').localeCompare(b.serialNumber || ''));
    
    // Premium Empty State
    if (!approved.length) {
        list.innerHTML = `
        <div class="flex flex-col items-center justify-center py-8 bg-slate-950/40 rounded-xl border border-white/5 border-dashed">
            <i data-lucide="users" class="w-6 h-6 text-slate-600 mb-2"></i>
            <p class="text-[9px] text-slate-500 font-black text-center uppercase tracking-widest">No registered players yet</p>
        </div>`;
        lucide.createIcons();
        return;
    }
    
    // Slice to show only a maximum of 5 players
    const displayPlayers = approved.slice(0, 5);
    
    let html = displayPlayers.map(p => `
    <div class="flex items-center gap-3 p-3 bg-slate-950/60 border border-white/5 rounded-xl relative overflow-hidden group transition-all shadow-inner">
        <!-- Subtle Hover Glow -->
        <div class="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
        
        ${getAvatarUI(p, 'w-9', 'h-9', 'rounded-lg flex-shrink-0 shadow-md border border-white/10 relative z-10')}
        
        <div class="flex-1 min-w-0 relative z-10">
            <div class="text-[10px] font-black text-white truncate uppercase tracking-wider">${p.name}</div>
            <div class="text-[8px] text-emerald-400 font-bold tracking-widest mt-0.5">${p.serialNumber || 'Pending'}</div>
        </div>
        
        <div class="relative z-10 flex-shrink-0">
            ${p.teamId ? `<span class="text-[7px] font-black uppercase text-blue-400 bg-blue-500/10 px-2 py-1 rounded-md border border-blue-500/20 shadow-inner">${getTeamName(p.teamId)}</span>` : '<span class="text-[7px] font-black uppercase text-slate-400 bg-slate-800 px-2 py-1 rounded-md border border-slate-700 shadow-inner">Free Agent</span>'}
        </div>
    </div>`).join('');
    
    // Add 'View All' Button if there are more than 5 players
    if (approved.length > 5) {
        html += `
        <button onclick="openAllPlayersModal()" class="w-full mt-2 py-3.5 bg-gradient-to-r from-slate-900 to-slate-800 border border-white/10 hover:border-emerald-500/30 text-emerald-400 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-all active:scale-95 shadow-inner group">
            View All ${approved.length} Players <i data-lucide="arrow-right" class="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform"></i>
        </button>`;
    }
    
    list.innerHTML = html;
    lucide.createIcons();
}

// --- NEW FUNCTION TO HANDLE THE ALL PLAYERS PAGE/MODAL ---
function openAllPlayersModal() {
    const container = document.getElementById('all-players-list-container');
    const approved = state.players.filter(p => p.paymentStatus === 'approved').sort((a, b) => (a.serialNumber || '').localeCompare(b.serialNumber || ''));
    
    document.getElementById('all-players-count').textContent = approved.length;
    
    container.innerHTML = approved.map(p => `
    <div class="flex items-center gap-3 p-3.5 bg-slate-900 border border-white/5 rounded-[1.2rem] relative overflow-hidden group hover:border-emerald-500/30 transition-all shadow-lg mb-3">
        <!-- Premium Background Gradient -->
        <div class="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
        
        ${getAvatarUI(p, 'w-11', 'h-11', 'rounded-[0.9rem] flex-shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.15)] border border-emerald-500/20 relative z-10 object-cover')}
        
        <div class="flex-1 min-w-0 relative z-10">
            <div class="text-[11px] font-black text-white truncate uppercase tracking-wider">${p.name}</div>
            <div class="text-[8px] text-emerald-400 font-bold tracking-widest mt-1">${p.serialNumber || 'Pending Serial'}</div>
        </div>
        
        <div class="relative z-10 flex flex-col items-end gap-1.5 flex-shrink-0">
            ${p.teamId ? `<span class="text-[7px] font-black uppercase text-blue-400 bg-blue-500/10 px-2.5 py-1 rounded-md border border-blue-500/20 shadow-inner">${getTeamName(p.teamId)}</span>` : '<span class="text-[7px] font-black uppercase text-slate-400 bg-slate-800 px-2.5 py-1 rounded-md border border-slate-700 shadow-inner">Free Agent</span>'}
            ${p.bidPrice ? `<span class="text-[9px] font-black text-gold-400 tracking-wider">৳${p.bidPrice}</span>` : ''}
        </div>
    </div>`).join('');
    
    openModal('modal-all-players');
    lucide.createIcons();
}

function renderPlayerTeams() {
    const list = document.getElementById('p-teams-list');
    const teams = state.managers.filter(m => m.paymentStatus === 'approved');
    
    // Premium Empty State
    if (!teams.length) {
        list.innerHTML = `
        <div class="flex flex-col items-center justify-center py-16 bg-slate-900/30 rounded-[2rem] border border-white/5 border-dashed">
            <div class="w-14 h-14 bg-slate-800 rounded-full flex items-center justify-center mb-4 border border-slate-700 shadow-inner">
                <i data-lucide="shield-off" class="w-6 h-6 text-slate-500"></i>
            </div>
            <p class="text-[10px] text-slate-400 font-black uppercase tracking-widest text-center">No Franchise Teams Yet</p>
        </div>`;
        lucide.createIcons();
        return;
    }
    
    list.innerHTML = teams.map(m => {
        const squad = state.players.filter(p => p.teamId === m.id);
        const settings = state.settings;
        const budget = m.budget !== undefined ? m.budget : (settings.teamBudget || 1500);
        const maxP = settings.maxPlayers || 6;
        
        return `
        <div class="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-[1.5rem] overflow-hidden shadow-2xl relative mb-5">
            <!-- Top Gradient Ribbon -->
            <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-emerald-500 to-gold-500 z-10 opacity-70"></div>
            
            <!-- Team Header Area -->
            <div class="p-4 bg-gradient-to-b from-blue-900/10 to-transparent relative z-10 border-b border-white/5">
                <div class="flex items-center gap-3">
                    ${getAvatarUI({name: m.teamName, avatar: m.logo}, 'w-14', 'h-14', 'rounded-[1.2rem] flex-shrink-0 border-2 border-white/10 shadow-[0_0_15px_rgba(59,130,246,0.15)] bg-slate-800 object-cover')}
                    <div class="flex-1 min-w-0">
                        <h3 class="font-black text-white text-[13px] uppercase tracking-wider truncate leading-tight">${m.teamName}</h3>
                        <div class="flex items-center gap-1.5 mt-1">
                            <i data-lucide="user" class="w-2.5 h-2.5 text-slate-500"></i>
                            <span class="text-[8px] text-slate-400 font-bold uppercase tracking-widest truncate">Owner: <span class="text-white">${m.name}</span></span>
                        </div>
                        <!-- SECURE: Replaced Team ID with a premium verified badge -->
                        <div class="inline-flex items-center gap-1 mt-1.5 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                            <i data-lucide="shield-check" class="w-2.5 h-2.5 text-blue-400"></i>
                            <span class="text-[7px] text-blue-400 font-black tracking-widest uppercase">Official Franchise</span>
                        </div>
                    </div>
                    <div class="flex flex-col items-end flex-shrink-0 bg-black/40 px-3 py-2 rounded-xl border border-white/5">
                        <span class="text-[7px] text-slate-500 font-bold uppercase tracking-widest mb-0.5">Budget Left</span>
                        <span class="text-sm font-black text-gold-400 tracking-wider">৳${budget}</span>
                    </div>
                </div>
            </div>

            <!-- Squad List Area -->
            <div class="p-4">
                <div class="flex items-center justify-between mb-3">
                    <span class="text-[8px] text-slate-500 font-bold uppercase tracking-widest flex items-center gap-1.5"><i data-lucide="users" class="w-3 h-3 text-emerald-400"></i> Team Squad</span>
                    <span class="text-[9px] font-black text-white bg-slate-950 px-2 py-0.5 rounded-md border border-white/10 shadow-inner">${squad.length} / ${maxP}</span>
                </div>
                <div class="space-y-2">
                    ${squad.length ? squad.map((p, index) => `
                    <div class="flex items-center gap-3 bg-slate-950/60 border border-white/5 hover:border-white/10 rounded-xl p-2.5 transition-all shadow-inner relative overflow-hidden group">
                        <!-- Subtle Glow Effect -->
                        <div class="absolute inset-0 bg-gradient-to-r from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                        
                        ${getAvatarUI(p, 'w-8', 'h-8', 'rounded-lg flex-shrink-0 shadow-md border border-white/5 relative z-10')}
                        
                        <div class="flex-1 min-w-0 relative z-10">
                            <div class="text-[10px] font-black text-white truncate uppercase tracking-wide flex items-center gap-1.5">
                                ${p.name}
                                ${p.isManager ? '<span class="text-[6px] font-black uppercase text-blue-400 bg-blue-500/10 px-1 py-0.5 rounded border border-blue-500/20">MGR</span>' : ''}
                            </div>
                            <!-- SECURE: Only shows serial number -->
                            <div class="text-[8px] text-emerald-400 font-bold tracking-widest mt-0.5">${p.serialNumber || '--'}</div>
                        </div>
                        
                        ${p.bidPrice ? `
                        <div class="text-right relative z-10">
                            <div class="text-[6px] text-slate-500 font-bold uppercase tracking-widest mb-0.5">Bought For</div>
                            <div class="text-[10px] font-black text-gold-400 tracking-wider">৳${p.bidPrice}</div>
                        </div>` : `
                        <div class="text-right relative z-10">
                            <div class="text-[6px] text-slate-500 font-bold uppercase tracking-widest mb-0.5">Status</div>
                            <div class="text-[8px] font-black text-blue-400 tracking-wider">DRAFTED</div>
                        </div>`}
                    </div>`).join('') : `
                    <div class="flex flex-col items-center justify-center py-5 bg-slate-950/40 rounded-xl border border-white/5 border-dashed">
                        <span class="text-[8px] text-slate-600 font-black uppercase tracking-widest">Awaiting Draft</span>
                    </div>`}
                </div>
            </div>
        </div>`;
    }).join('');
    
    lucide.createIcons();
}

function renderPlayerSchedule() {
    // নতুন লাইন: পয়েন্ট টেবিল রেন্ডার করার জন্য existing ফাংশন কল করা হলো
    renderStandings('p-standings-table');
    
    // আগের কোড: ম্যাচগুলো রেন্ডার করার জন্য
    const list = document.getElementById('p-schedule-list');
    if (!state.matches.length) {
        list.innerHTML = `<p class="text-[9px] text-slate-500 font-bold text-center py-8">No matches scheduled yet</p>`;
        return;
    }
    list.innerHTML = state.matches.map(m => renderMatchCard(m, false)).join('');
    lucide.createIcons();
}

function renderPlayerProfile() {
    const u = state.currentUser;
    const team = state.managers.find(m => m.id === u.teamId);
    
    // Dynamic theme styling based on registration status
    const bannerGradient = u.paymentStatus === 'approved' ? 'from-emerald-600/30 to-slate-900' : 'from-gold-600/30 to-slate-900';
    const borderGlow = u.paymentStatus === 'approved' ? 'border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.2)]' : 'border-gold-500/50 shadow-[0_0_20px_rgba(245,158,11,0.2)]';
    const accentColor = u.paymentStatus === 'approved' ? 'text-emerald-400' : 'text-gold-400';
    
    document.getElementById('p-profile-container').innerHTML = `
    <div class="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl relative mb-4">
        <!-- Profile Banner -->
        <div class="h-28 w-full bg-gradient-to-b ${bannerGradient} relative border-b border-white/5">
            <div class="absolute inset-0 opacity-30 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.1)_0%,transparent_70%)]"></div>
        </div>
        
        <!-- Avatar & Main Info -->
        <div class="px-6 pb-6 relative -mt-14 text-center">
            <div class="w-28 h-28 mx-auto rounded-[1.5rem] bg-slate-950 p-1 border-2 ${borderGlow} backdrop-blur-md mb-4 relative">
                ${getAvatarUI(u, 'w-full', 'h-full', 'rounded-[1.2rem]')}
                ${u.paymentStatus === 'approved' ? `<div class="absolute -bottom-2 -right-2 bg-slate-950 border border-emerald-500 rounded-full p-1 shadow-lg"><i data-lucide="check-circle-2" class="w-5 h-5 text-emerald-400"></i></div>` : ''}
            </div>
            
            <h2 class="text-2xl font-black text-white uppercase tracking-tight">${u.name}</h2>
            
            <div class="flex items-center justify-center gap-2 mt-2 mb-5">
                <span class="text-[10px] ${accentColor} font-black tracking-widest bg-black/50 px-3 py-1.5 rounded-xl border border-white/5 flex items-center gap-1.5 cursor-pointer hover:bg-white/10 transition-colors" onclick="copyId()">
                    <i data-lucide="copy" class="w-3 h-3"></i> ${u.id}
                </span>
                ${u.serialNumber ? `<span class="text-[10px] text-white font-black tracking-[0.15em] bg-emerald-500/20 px-3 py-1.5 rounded-xl border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.15)]">Serial: ${u.serialNumber}</span>` : ''}
            </div>
            
            ${team ? `
            <div class="bg-gradient-to-r from-blue-900/40 via-blue-800/20 to-blue-900/40 border border-blue-500/30 rounded-2xl p-4 flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(59,130,246,0.15)]">
                <i data-lucide="shield-check" class="w-5 h-5 text-blue-400"></i>
                <span class="text-[11px] font-black text-white uppercase tracking-[0.15em]">Signed by <span class="text-blue-400">${team.teamName}</span></span>
            </div>` : ''}
        </div>
    </div>

    <!-- Contact & Status Details -->
    <div class="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-[2rem] p-5 shadow-2xl space-y-3">
        <h3 class="text-[10px] font-black text-white uppercase tracking-[0.15em] flex items-center gap-2 mb-4">
            <i data-lucide="info" class="w-4 h-4 text-emerald-400"></i> Account Details
        </h3>
        <div class="flex items-center justify-between p-4 bg-black/40 rounded-2xl border border-white/5 hover:border-emerald-500/30 transition-colors">
            <div>
                <div class="text-[8px] text-slate-500 font-bold uppercase tracking-widest mb-1">Game Identity</div>
                <div class="text-[11px] font-black text-white">Konami: <span class="text-emerald-400">${u.konamiId || 'N/A'}</span></div>
                <div class="text-[11px] font-black text-white mt-0.5">Device: <span class="text-blue-400">${u.deviceName || 'N/A'}</span></div>
                ${u.lastEditAt ? `<div class="text-[7px] text-rose-400 font-bold mt-1.5"><i data-lucide="clock" class="w-2.5 h-2.5 inline pb-0.5"></i> Edited: ${u.lastEditAt.toDate ? u.lastEditAt.toDate().toLocaleString() : 'Recently'}</div>` : ''}
            </div>
            <button onclick="openEditProfileModal()" class="px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-xl text-[9px] font-black uppercase transition-colors border border-emerald-500/30"><i data-lucide="edit-3" class="w-3 h-3 inline"></i> Edit</button>
        </div>
        <div class="flex items-center gap-4 p-3.5 bg-black/40 rounded-2xl border border-white/5 hover:bg-black/60 transition-colors">
            <div class="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                <i data-lucide="phone" class="w-4 h-4 text-emerald-400"></i>
            </div>
            <div class="flex-1 min-w-0">
                <div class="text-[8px] text-slate-500 font-bold uppercase tracking-widest mb-1">Phone Number</div>
                <div class="text-[12px] font-black text-white tracking-wide">${u.phone || '--'}</div>
            </div>
        </div>

        <div class="flex items-center gap-4 p-3.5 bg-black/40 rounded-2xl border border-white/5 hover:bg-black/60 transition-colors">
            <div class="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0 shadow-[0_0_10px_rgba(59,130,246,0.1)]">
                <i data-lucide="facebook" class="w-4 h-4 text-blue-400"></i>
            </div>
            <div class="flex-1 min-w-0">
                <div class="text-[8px] text-slate-500 font-bold uppercase tracking-widest mb-1">Facebook Profile</div>
                ${u.fb ? `<a href="${u.fb}" target="_blank" class="text-[11px] font-black text-blue-400 hover:text-blue-300 transition-colors truncate block flex items-center gap-1">View Profile <i data-lucide="external-link" class="w-3 h-3 inline"></i></a>` : `<div class="text-[11px] font-black text-slate-500">Not provided</div>`}
            </div>
        </div>

        <div class="flex items-center gap-4 p-3.5 bg-black/40 rounded-2xl border border-white/5 hover:bg-black/60 transition-colors">
            <div class="w-10 h-10 rounded-xl ${u.paymentStatus === 'approved' ? 'bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)] text-emerald-400' : 'bg-gold-500/10 border-gold-500/20 shadow-[0_0_10px_rgba(245,158,11,0.1)] text-gold-400'} flex items-center justify-center flex-shrink-0">
                <i data-lucide="${u.paymentStatus === 'approved' ? 'check-circle' : 'clock'}" class="w-5 h-5"></i>
            </div>
            <div class="flex-1 min-w-0 flex items-center justify-between">
                <div>
                    <div class="text-[8px] text-slate-500 font-bold uppercase tracking-widest mb-1">Registration Status</div>
                    <div class="text-[12px] font-black ${accentColor} uppercase tracking-wider">${u.paymentStatus || 'Unregistered'}</div>
                </div>
            </div>
        </div>
    </div>`;
    lucide.createIcons();
}

// ==================== MANAGER APP ====================
function launchManagerApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('manager-app').classList.remove('hidden');
    const u = state.currentUser;
    document.getElementById('m-header-id').textContent = u.id;
    document.getElementById('m-header-team').textContent = u.teamName;
    document.getElementById('m-header-logo').innerHTML = getAvatarUI({name: u.teamName, avatar: u.logo}, 'w-8', 'h-8', 'rounded-xl');
    switchMTab('dashboard');
    subscribeAll();
    lucide.createIcons();
}

function switchMTab(tab) {
    ['dashboard','squad','matches','standings','profile','info'].forEach(t => {
        document.getElementById(`m-tab-${t}`).classList.toggle('hidden', t !== tab);
        const btn = document.getElementById(`mnav-${t}`);
        if (btn) btn.classList.toggle('active', t === tab);
    });
    if (tab === 'dashboard') renderManagerDashboard();
    if (tab === 'squad') renderManagerSquad();
    if (tab === 'matches') renderManagerMatches();
    if (tab === 'standings') renderStandings('m-standings-table');
    if (tab === 'profile') renderManagerProfile();
    if (tab === 'info') renderInfoTab('m-info-container', document.getElementById('m-info-search').value);
    lucide.createIcons();
}

function renderManagerDashboard() {
    const u = state.currentUser;
    const fresh = state.managers.find(m => m.id === u.id) || u;
    state.currentUser = fresh;
    
    document.getElementById('m-dash-logo').innerHTML = getAvatarUI({ name: fresh.teamName, avatar: fresh.logo }, 'w-full', 'h-full', 'rounded-xl');
    document.getElementById('m-dash-team-name').textContent = fresh.teamName;
    document.getElementById('m-dash-owner').textContent = 'Owner: ' + fresh.name;
    document.getElementById('m-dash-id').textContent = 'ID: ' + fresh.id;
    
    const settings = state.settings;
    const maxP = settings.maxPlayers || 6;
    const budget = fresh.budget !== undefined ? fresh.budget : (settings.teamBudget || 1500);
    const squad = state.players.filter(p => p.teamId === fresh.id);
    
    // Fixed: Removed the - 1 here because manager is inherently part of squad array now
    const slotsLeft = Math.max(0, maxP - squad.length);
    
    document.getElementById('m-stat-budget').textContent = '৳' + budget;
    document.getElementById('m-stat-players').textContent = squad.length;
    document.getElementById('m-stat-slots').textContent = slotsLeft;
    
    renderManagerPaymentArea();
    renderManagerBidArea();
    lucide.createIcons();
}

function renderManagerPaymentArea() {
    const u = state.currentUser;
    const area = document.getElementById('m-payment-area');
    if (u.paymentStatus === 'approved') {
        area.innerHTML = `<div class="flex items-center gap-2 bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-3">
            <i data-lucide="check-circle" class="w-4 h-4 text-emerald-400"></i>
            <span class="text-[9px] font-black text-emerald-400 uppercase">Team Registration Approved</span>
        </div>`;
    } else if (u.paymentStatus === 'pending') {
        area.innerHTML = `<div class="bg-gold-900/20 border border-gold-500/30 rounded-xl p-3 flex items-center gap-2">
            <i data-lucide="clock" class="w-4 h-4 text-gold-400"></i>
            <div>
                <div class="text-[9px] font-black text-gold-400 uppercase">Waiting for Admin Approval</div>
                <div class="text-[8px] text-slate-400 font-bold">TRXID: ${u.trxid}</div>
            </div>
        </div>`;
    } else {
        area.innerHTML = `<button onclick="openPaymentModal('manager')" class="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl active:scale-95 transition-transform flex items-center justify-center gap-2">
            <i data-lucide="credit-card" class="w-4 h-4"></i> Pay Team Registration (৳${MANAGER_FEE})
        </button>`;
    }
    lucide.createIcons();
}

function renderManagerBidArea() {
    const bidArea = document.getElementById('m-live-bid-area');
    if (!state.bidSession || state.bidSession.status !== 'active') {
        bidArea.classList.add('hidden');
        return;
    }
    bidArea.classList.remove('hidden');
    updateManagerBidUI();
}

function renderManagerSquad() {
    const u = state.currentUser;
    const squad = state.players.filter(p => p.teamId === u.id);
    const list = document.getElementById('m-squad-list');
    
    // Update max player count in the UI
    const maxP = (state.settings.maxPlayers || 6);
    const countEl = document.getElementById('max-p-count');
    if (countEl) countEl.textContent = maxP;
    
    if (!squad.length) {
        list.className = "col-span-2"; // Remove grid layout temporarily
        list.innerHTML = `
        <div class="flex flex-col items-center justify-center py-12 bg-slate-900/40 rounded-[1.5rem] border border-white/5 border-dashed w-full shadow-inner">
            <div class="w-14 h-14 bg-slate-800/50 rounded-full flex items-center justify-center mb-3 border border-white/5">
                <i data-lucide="user-x" class="w-6 h-6 text-slate-500"></i>
            </div>
            <p class="text-[10px] text-slate-400 font-black uppercase tracking-widest">No players drafted yet</p>
        </div>`;
        document.getElementById('m-lineup-area').innerHTML = '';
        return;
    }
    
    // Switch to Grid layout for a card-based premium view
    list.className = "grid grid-cols-2 gap-3 mb-6";
    list.innerHTML = squad.map((p, index) => `
    <div class="bg-black/40 border border-white/5 rounded-[1.2rem] p-4 relative overflow-hidden group hover:border-blue-500/30 hover:bg-slate-900/80 transition-all shadow-lg flex flex-col items-center text-center">
        <!-- Hover Gradient -->
        <div class="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
        
        <div class="absolute top-2.5 left-2.5 text-[9px] font-black text-slate-600 bg-slate-950 px-1.5 py-0.5 rounded shadow-inner">#${index+1}</div>
        
        ${p.isManager ? '<div class="absolute top-2.5 right-2.5 bg-blue-500/20 text-blue-400 text-[7px] font-black px-1.5 py-1 rounded-md border border-blue-500/30 uppercase tracking-widest shadow-md">MGR</div>' : ''}
        
        ${getAvatarUI(p, 'w-14', 'h-14', 'rounded-[1rem] shadow-[0_4px_15px_rgba(0,0,0,0.5)] border-2 border-white/10 mb-3 object-cover relative z-10')}
        
        <div class="w-full relative z-10 mb-2">
            <div class="text-[11px] font-black text-white truncate uppercase tracking-wider">${p.name}</div>
            <div class="text-[8px] text-emerald-400 font-bold tracking-widest mt-1">${p.serialNumber||'--'}</div>
        </div>
        
        ${p.bidPrice ? `
        <div class="mt-auto w-full pt-3 border-t border-white/5 relative z-10">
            <div class="text-[11px] font-black text-gold-400 bg-gold-500/10 rounded-lg py-1.5 border border-gold-500/20 shadow-inner tracking-wider">৳${p.bidPrice}</div>
        </div>` : `
        <div class="mt-auto w-full pt-3 border-t border-white/5 relative z-10">
            <div class="text-[9px] font-black text-slate-500 uppercase tracking-widest py-1.5">Free Draft</div>
        </div>`}
    </div>`).join('');
    
    // Lineup rendering
    renderLineupArea(squad);
    lucide.createIcons();
}

function renderLineupArea(squad) {
    const area = document.getElementById('m-lineup-area');
    const maxP = (state.settings.maxPlayers || 6);
    const slots = Array.from({ length: maxP }, (_, i) => squad[i] || null);
    
    area.innerHTML = slots.map((p, i) => {
        if (p) {
            return `
            <div class="flex items-center gap-3 p-3.5 bg-gradient-to-r from-emerald-900/20 to-slate-900 border border-emerald-500/30 rounded-xl relative overflow-hidden shadow-[0_4px_20px_rgba(16,185,129,0.08)] group hover:border-emerald-500/50 transition-colors">
                <!-- Glowing left accent line -->
                <div class="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,1)]"></div>
                
                <div class="w-7 text-center text-[11px] font-black text-emerald-500 bg-emerald-500/10 rounded-lg border border-emerald-500/20 py-1.5 flex-shrink-0 shadow-inner">${i+1}</div>
                
                ${getAvatarUI(p, 'w-11', 'h-11', 'rounded-[0.8rem] flex-shrink-0 border-2 border-emerald-500/20 object-cover shadow-md')}
                
                <div class="flex-1 min-w-0">
                    <div class="text-[11px] font-black text-white truncate uppercase tracking-widest">${p.name}</div>
                    <div class="text-[8px] text-slate-400 font-bold flex items-center gap-1.5 mt-1 tracking-widest">
                        <i data-lucide="gamepad-2" class="w-3 h-3 text-emerald-400"></i> ${p.konamiId || 'NO ID'}
                    </div>
                </div>
                
                <div class="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 text-emerald-400 group-hover:bg-emerald-500 group-hover:text-slate-900 transition-all shadow-md">
                    <i data-lucide="check" class="w-4 h-4 font-black"></i>
                </div>
            </div>`;
        } else {
            return `
            <div class="flex items-center gap-3 p-3.5 bg-slate-900/40 border border-slate-700 border-dashed rounded-xl relative hover:bg-slate-900/70 transition-colors">
                <div class="w-7 text-center text-[10px] font-black text-slate-600 bg-slate-800 rounded-lg py-1.5 flex-shrink-0 border border-slate-700 shadow-inner">${i+1}</div>
                
                <div class="w-11 h-11 rounded-[0.8rem] flex-shrink-0 border-2 border-slate-700 border-dashed bg-slate-800/50 flex items-center justify-center">
                    <i data-lucide="user" class="w-5 h-5 text-slate-600"></i>
                </div>
                
                <div class="flex-1 min-w-0">
                    <div class="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Available Slot</div>
                    <div class="text-[7px] text-slate-600 font-bold mt-1 tracking-widest">Awaiting Player Draft</div>
                </div>
                
                <div class="flex-shrink-0 w-8 h-8 rounded-full bg-slate-800/50 flex items-center justify-center border border-slate-700 text-slate-600">
                    <i data-lucide="lock" class="w-3 h-3"></i>
                </div>
            </div>`;
        }
    }).join('');
    
    lucide.createIcons();
}

async function saveLineup() {
    const u = state.currentUser;
    const squad = state.players.filter(p => p.teamId === u.id);
    // Fixed: Removed the - 1
    const lineupIds = squad.slice(0, (state.settings.maxPlayers || 6)).map(p => p.id);
    try {
        await db.collection('managers').doc(u.id).update({ lineup: lineupIds });
        notify('Lineup saved!', 'check-circle');
    } catch (e) {
        notify('Save failed', 'x-circle');
    }
}

function renderManagerMatches() {
    const u = state.currentUser;
    const list = document.getElementById('m-matches-list');
    const myMatches = state.matches.filter(m => {
        // matches between my squad players vs opponent squad players
        const myPlayerIds = state.players.filter(p => p.teamId === u.id).map(p => p.id);
        return myPlayerIds.includes(m.player1Id) || myPlayerIds.includes(m.player2Id) || m.team1Id === u.id || m.team2Id === u.id;
    });
    if (!myMatches.length) { list.innerHTML = `<p class="text-[9px] text-slate-500 font-bold text-center py-8">No matches yet</p>`; return; }
    list.innerHTML = myMatches.map(m => renderMatchCard(m, true)).join('');
    lucide.createIcons();
}

function renderManagerProfile() {
    const u = state.currentUser;
const mPlayer = state.players.find(p => p.id === u.managerPlayerId) || {}; // NEW
    const squadCount = state.players.filter(p => p.teamId === u.id).length;
    const maxP = (state.settings.maxPlayers || 6) - 1; // Excluding manager
    
    // Dynamic theme styling
    const bannerGradient = u.paymentStatus === 'approved' ? 'from-blue-600/30 to-slate-900' : 'from-gold-600/30 to-slate-900';
    const borderGlow = u.paymentStatus === 'approved' ? 'border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.2)]' : 'border-gold-500/50 shadow-[0_0_20px_rgba(245,158,11,0.2)]';
    const accentColor = u.paymentStatus === 'approved' ? 'text-blue-400' : 'text-gold-400';
    
    document.getElementById('m-profile-container').innerHTML = `
    <div class="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl relative mb-4">
        <!-- Team Banner -->
        <div class="h-28 w-full bg-gradient-to-b ${bannerGradient} relative border-b border-white/5">
            <div class="absolute inset-0 opacity-30 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.1)_0%,transparent_70%)]"></div>
        </div>
        
        <!-- Logo & Main Info -->
        <div class="px-6 pb-6 relative -mt-14 text-center">
            <div class="w-28 h-28 mx-auto rounded-[1.5rem] bg-slate-950 p-1 border-2 ${borderGlow} backdrop-blur-md mb-4 relative">
                ${getAvatarUI({name: u.teamName, avatar: u.logo}, 'w-full', 'h-full', 'rounded-[1.2rem] object-contain bg-slate-800')}
                ${u.paymentStatus === 'approved' ? `<div class="absolute -bottom-2 -right-2 bg-slate-950 border border-blue-500 rounded-full p-1 shadow-lg"><i data-lucide="shield-check" class="w-5 h-5 text-blue-400"></i></div>` : ''}
            </div>
            
            <h2 class="text-2xl font-black text-white uppercase tracking-tight leading-none">${u.teamName}</h2>
            <p class="text-[11px] font-bold text-slate-400 mt-2 mb-4 uppercase tracking-[0.2em]">Owner: <span class="text-white">${u.name}</span></p>
            
            <div class="flex items-center justify-center gap-2">
                <span class="text-[10px] ${accentColor} font-black tracking-widest bg-black/50 px-4 py-2 rounded-xl border border-white/5 flex items-center gap-1.5 cursor-pointer hover:bg-white/10 transition-colors" onclick="copyId()">
                    <i data-lucide="copy" class="w-3.5 h-3.5"></i> ${u.id}
                </span>
            </div>
        </div>
    </div>

    <!-- Stats & Status Details -->
    <div class="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-[2rem] p-5 shadow-2xl space-y-3">
        <h3 class="text-[10px] font-black text-white uppercase tracking-[0.15em] flex items-center gap-2 mb-4">
            <i data-lucide="briefcase" class="w-4 h-4 text-blue-400"></i> Team Status
        </h3>
        <div class="flex items-center justify-between p-4 bg-black/40 rounded-2xl border border-white/5 hover:border-blue-500/30 transition-colors">
            <div>
                <div class="text-[8px] text-slate-500 font-bold uppercase tracking-widest mb-1">Manager's Game Identity</div>
                <div class="text-[11px] font-black text-white">Konami: <span class="text-emerald-400">${mPlayer.konamiId || 'N/A'}</span></div>
                <div class="text-[11px] font-black text-white mt-0.5">Device: <span class="text-blue-400">${mPlayer.deviceName || 'N/A'}</span></div>
                ${mPlayer.lastEditAt ? `<div class="text-[7px] text-rose-400 font-bold mt-1.5"><i data-lucide="clock" class="w-2.5 h-2.5 inline pb-0.5"></i> Edited: ${mPlayer.lastEditAt.toDate ? mPlayer.lastEditAt.toDate().toLocaleString() : 'Recently'}</div>` : ''}
            </div>
            <button onclick="openEditProfileModal()" class="px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-xl text-[9px] font-black uppercase transition-colors border border-blue-500/30"><i data-lucide="edit-3" class="w-3 h-3 inline"></i> Edit</button>
        </div>
        <div class="flex items-center gap-4 p-3.5 bg-black/40 rounded-2xl border border-white/5 hover:bg-black/60 transition-colors">
            <div class="w-10 h-10 rounded-xl bg-gold-500/10 border border-gold-500/20 flex items-center justify-center flex-shrink-0 shadow-[0_0_10px_rgba(245,158,11,0.1)]">
                <i data-lucide="coins" class="w-5 h-5 text-gold-400"></i>
            </div>
            <div class="flex-1 min-w-0 flex items-center justify-between">
                <div class="text-[8px] text-slate-500 font-bold uppercase tracking-widest">Available Budget</div>
                <div class="text-[14px] font-black text-gold-400 tracking-wider">৳${u.budget !== undefined ? u.budget : '--'}</div>
            </div>
        </div>

        <div class="flex items-center gap-4 p-3.5 bg-black/40 rounded-2xl border border-white/5 hover:bg-black/60 transition-colors">
            <div class="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0 shadow-[0_0_10px_rgba(59,130,246,0.1)]">
                <i data-lucide="users" class="w-5 h-5 text-blue-400"></i>
            </div>
            <div class="flex-1 min-w-0 flex items-center justify-between">
                <div class="text-[8px] text-slate-500 font-bold uppercase tracking-widest">Squad Spots Filled</div>
                <div class="text-[14px] font-black text-white tracking-wider">${squadCount} / <span class="text-slate-500">${maxP}</span></div>
            </div>
        </div>

        <div class="flex items-center gap-4 p-3.5 bg-black/40 rounded-2xl border border-white/5 hover:bg-black/60 transition-colors">
            <div class="w-10 h-10 rounded-xl ${u.paymentStatus === 'approved' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.1)]' : 'bg-gold-500/10 border-gold-500/20 text-gold-400 shadow-[0_0_10px_rgba(245,158,11,0.1)]'} flex items-center justify-center flex-shrink-0">
                <i data-lucide="${u.paymentStatus === 'approved' ? 'check-circle' : 'clock'}" class="w-5 h-5"></i>
            </div>
            <div class="flex-1 min-w-0 flex items-center justify-between">
                <div>
                    <div class="text-[8px] text-slate-500 font-bold uppercase tracking-widest mb-1">Registration Status</div>
                    <div class="text-[12px] font-black ${u.paymentStatus === 'approved' ? 'text-emerald-400' : 'text-gold-400'} uppercase tracking-wider">${u.paymentStatus || 'Unregistered'}</div>
                </div>
            </div>
        </div>
        
        ${u.trxid ? `
        <div class="flex items-center gap-4 p-3.5 bg-black/40 rounded-2xl border border-white/5 hover:bg-black/60 transition-colors">
            <div class="w-10 h-10 rounded-xl bg-slate-800/50 border border-slate-700/50 flex items-center justify-center flex-shrink-0">
                <i data-lucide="hash" class="w-4 h-4 text-slate-400"></i>
            </div>
            <div class="flex-1 min-w-0 flex items-center justify-between">
                <div class="text-[8px] text-slate-500 font-bold uppercase tracking-widest">Transaction ID</div>
                <div class="text-[10px] font-black text-white tracking-widest">${u.trxid}</div>
            </div>
        </div>` : ''}
    </div>`;
    lucide.createIcons();
}

// ==================== MATCH RENDERING ====================


// ==================== SWAP ====================
async function openSwapModal(matchId) {
    const match = state.matches.find(m => m.id === matchId);
    if (!match) return;
    if (match.swapUsed) return notify('Swap already used!', 'x-circle');
    state.swapMatchId = matchId;

    const u = state.currentUser;
    const myPlayers = state.players.filter(p => p.teamId === u.id);

    // Find which players are mine in this match
    const myP1 = myPlayers.find(p => p.id === match.player1Id);
    const myP2 = myPlayers.find(p => p.id === match.player2Id);

    const content = document.getElementById('swap-content');
    if (!myP1 && !myP2) { notify('No your players in this match', 'x'); return; }

    // Get all my players in the match group
    content.innerHTML = `
    <p class="text-[8px] text-slate-400 font-bold uppercase">Current matchups will be swapped within your team. Select which player to swap:</p>
    <div class="space-y-2 mt-3">
        ${myPlayers.map(p => `
        <label class="flex items-center gap-3 p-3 bg-slate-950 rounded-xl border border-white/10 cursor-pointer">
            <input type="checkbox" name="swap-player" value="${p.id}" class="accent-blue-500">
            ${getAvatarUI(p, 'w-8', 'h-8', 'rounded-lg')}
            <div>
                <div class="text-[9px] font-black text-white uppercase">${p.name}</div>
                <div class="text-[7px] text-emerald-400 font-bold">${p.serialNumber||''}</div>
            </div>
        </label>`).join('')}
    </div>`;
    openModal('modal-swap');
    lucide.createIcons();
}

function renderAdminMatches() {
    const list = document.getElementById('a-matches-list');
    if (!list) return;
    if (!state.matches || !state.matches.length) {
        list.innerHTML = `<p class="text-[9px] text-slate-500 font-bold text-center py-8">No matches yet. Click Draw Matches.</p>`;
        return;
    }
    list.innerHTML = state.matches.map(m => renderTeamMatchCard(m, 'admin')).join('');
    lucide.createIcons();
}

function renderManagerMatches() {
    const u = state.currentUser;
    const list = document.getElementById('m-matches-list');
    const myMatches = state.matches.filter(m => m.team1Id === u.id || m.team2Id === u.id);
    if (!myMatches.length) { list.innerHTML = `<p class="text-[9px] text-slate-500 font-bold text-center py-8">No matches yet</p>`; return; }
    list.innerHTML = myMatches.map(m => renderTeamMatchCard(m, 'manager')).join('');
    lucide.createIcons();
}

function renderTeamMatchCard(m, viewType) {
    const t1 = state.managers.find(mg => mg.id === m.team1Id);
    const t2 = state.managers.find(mg => mg.id === m.team2Id);
    const u = state.currentUser;
    
    let actionBtn = '';
    let statusText = '';
    
    if (m.status === 'pending_lineup') {
        statusText = '<span class="text-gold-400 font-bold">Awaiting Lineups</span>';
        if (viewType === 'manager') {
            const myLineup = m.team1Id === u.id ? m.lineup1 : m.lineup2;
            if (myLineup && myLineup.length > 0) {
                actionBtn = `<span class="px-3 py-1 bg-emerald-900/40 text-emerald-400 text-[8px] font-black rounded-md border border-emerald-500/30">Lineup Submitted</span>`;
            } else {
                actionBtn = `<button onclick="openLineupSubmission('${m.id}')" class="px-3 py-1.5 bg-blue-600 border border-blue-500 text-white text-[8px] font-black rounded-lg uppercase shadow-md active:scale-95 transition-all">Submit Lineup</button>`;
            }
        } else if (viewType === 'admin') {
            if (m.lineup1.length > 0 && m.lineup2.length > 0) {
                actionBtn = `<button onclick="draw1v1Matchups('${m.id}')" class="px-3 py-1.5 bg-rose-600 border border-rose-500 text-white text-[8px] font-black rounded-lg uppercase shadow-md active:scale-95 transition-all">Draw 1VS1</button>`;
            } else {
                actionBtn = `<span class="text-[7px] text-slate-500 font-bold">Waiting for Managers</span>`;
            }
        }
    } else if (m.status === 'ongoing') {
        statusText = '<span class="text-blue-400 font-bold">Match Ongoing</span>';
        if (viewType === 'manager') {
            actionBtn = `<button onclick="openManageMatch('${m.id}')" class="px-3 py-1.5 bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 text-[8px] font-black rounded-lg uppercase">Manage Match (Sub/Swap)</button>`;
        } else if (viewType === 'admin') {
            actionBtn = `
            <div class="flex gap-1">
                <button onclick="copyMatchSchedule('${m.id}')" class="px-3 py-1.5 bg-blue-600/20 border border-blue-500/30 text-blue-400 text-[8px] font-black rounded-lg uppercase">Copy Text</button>
                <button onclick="openMatchResultsModal('${m.id}')" class="px-3 py-1.5 bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 text-[8px] font-black rounded-lg uppercase">Results</button>
            </div>`;
        }
    } else if (m.status === 'completed') {
        statusText = '<span class="text-emerald-400 font-bold">Completed</span>';
        actionBtn = `<button onclick="openMatchResultsModal('${m.id}')" class="px-3 py-1.5 bg-slate-800 border border-white/10 text-slate-400 text-[8px] font-black rounded-lg uppercase">View Score</button>`;
    }

    return `
    <div class="match-card bg-slate-900/60 border border-white/5 rounded-[1.2rem] overflow-hidden mb-4 shadow-lg p-4 relative">
        <div class="flex items-center justify-between mb-4 border-b border-white/5 pb-2">
            <span class="text-[8px] font-black text-slate-400 uppercase tracking-widest bg-black/50 px-2 py-1 rounded border border-white/5">Match ${m.matchNumber || '#'}</span>
            <span class="text-[9px] uppercase tracking-widest">${statusText}</span>
        </div>
        
        <div class="flex items-center justify-between gap-3 mb-4">
            <div class="flex-1 text-center">
                ${getAvatarUI({name: t1?.teamName, avatar: t1?.logo}, 'w-12', 'h-12', 'rounded-xl mx-auto mb-2 border border-white/10 object-contain bg-slate-800')}
                <div class="text-[10px] font-black text-white truncate uppercase">${t1?.teamName || 'TBD'}</div>
                ${m.status === 'completed' ? `<div class="text-2xl font-black text-emerald-400 mt-1">${m.mainScore1 || 0}</div>` : ''}
            </div>
            <div class="text-center flex-shrink-0">
                <div class="text-[12px] font-black text-slate-500 italic px-3 py-1 bg-black/40 rounded-lg border border-white/5">VS</div>
            </div>
            <div class="flex-1 text-center">
                ${getAvatarUI({name: t2?.teamName, avatar: t2?.logo}, 'w-12', 'h-12', 'rounded-xl mx-auto mb-2 border border-white/10 object-contain bg-slate-800')}
                <div class="text-[10px] font-black text-white truncate uppercase">${t2?.teamName || 'TBD'}</div>
                ${m.status === 'completed' ? `<div class="text-2xl font-black text-emerald-400 mt-1">${m.mainScore2 || 0}</div>` : ''}
            </div>
        </div>
        
        <div class="flex items-center justify-center pt-2 border-t border-white/5">
            ${actionBtn}
        </div>
    </div>`;
}

function renderStandings(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const approvedManagers = state.managers.filter(m => m.paymentStatus === 'approved');
    const completedMatches = state.matches.filter(m => m.status === 'completed');

    // Build standings
    const table = {};
    approvedManagers.forEach(m => {
        table[m.id] = { manager: m, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, played: 0 };
    });

    completedMatches.forEach(m => {
        const t1id = m.team1Id;
        const t2id = m.team2Id;
        if (!table[t1id] || !table[t2id]) return;

        const s1 = m.score1 ?? 0;
        const s2 = m.score2 ?? 0;
        table[t1id].gf += s1; table[t1id].ga += s2; table[t1id].played++;
        table[t2id].gf += s2; table[t2id].ga += s1; table[t2id].played++;

        if (s1 > s2) { table[t1id].w++; table[t1id].pts += 3; table[t2id].l++; }
        else if (s2 > s1) { table[t2id].w++; table[t2id].pts += 3; table[t1id].l++; }
        else { table[t1id].d++; table[t2id].d++; table[t1id].pts++; table[t2id].pts++; }
    });

    const sorted = Object.values(table).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);

    // Premium Empty State
    if (sorted.length === 0) {
        container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-12 bg-slate-900/40 rounded-[1.5rem] border border-white/5 border-dashed">
            <i data-lucide="bar-chart-2" class="w-8 h-8 text-slate-600 mb-3"></i>
            <p class="text-[10px] text-slate-500 font-black uppercase tracking-widest text-center">No Teams Registered Yet</p>
        </div>`;
        lucide.createIcons();
        return;
    }

    const rowsHtml = sorted.map((row, i) => {
        const isTop4 = i < 4; // Checks if team is in Top 4
        
        // Colors for Rank Numbers (Gold, Silver, Bronze, Emerald for 4th)
        const rankColor = i === 0 ? 'text-gold-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]' :
                          i === 1 ? 'text-slate-300 drop-shadow-[0_0_8px_rgba(203,213,225,0.5)]' :
                          i === 2 ? 'text-amber-600 drop-shadow-[0_0_8px_rgba(217,119,6,0.5)]' :
                          isTop4 ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'text-slate-500';

        // Background and Border logic for Top 4 Highlight
        const bgClass = isTop4 ? 'bg-gradient-to-r from-emerald-500/10 to-transparent' : 'bg-transparent hover:bg-white/5';
        const borderClass = isTop4 ? 'border-l-[3px] border-emerald-500' : 'border-l-[3px] border-transparent';
        
        // Visual Cut-Off Line after the 4th position
        const isCutoff = i === 3;
        const bottomBorder = isCutoff ? 'border-b border-emerald-500/40 shadow-[0_4px_10px_-4px_rgba(16,185,129,0.3)] z-10' : 'border-b border-white/5';
        
        // Goal Difference Calculation
        const gd = row.gf - row.ga;
        const gdText = gd > 0 ? `+${gd}` : gd;
        const gdColor = gd > 0 ? 'text-emerald-400' : gd < 0 ? 'text-rose-400' : 'text-slate-400';

        return `
        <div class="grid grid-cols-[20px_1fr_16px_16px_16px_16px_20px_24px] gap-1.5 px-3 py-3 ${bgClass} ${borderClass} ${bottomBorder} items-center text-center transition-colors group relative">
            <div class="${rankColor} font-black text-[11px] text-left ml-1">${i + 1}</div>
            <div class="flex items-center gap-2 min-w-0 text-left">
                ${getAvatarUI({name: row.manager.teamName, avatar: row.manager.logo}, 'w-7', 'h-7', 'rounded-lg shadow-md border border-white/10 flex-shrink-0 object-cover bg-slate-800')}
                <div class="flex flex-col min-w-0">
                    <span class="text-white font-black text-[10px] truncate uppercase tracking-wider group-hover:text-emerald-400 transition-colors">${row.manager.teamName}</span>
                    <div class="flex items-center gap-1 mt-0.5">
                        ${isTop4 ? `<span class="text-[6px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1 py-0.5 rounded uppercase font-black tracking-widest leading-none">Qualified</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="text-[9px] font-bold text-slate-300">${row.played}</div>
            <div class="text-[9px] font-bold text-emerald-400">${row.w}</div>
            <div class="text-[9px] font-bold text-slate-400">${row.d}</div>
            <div class="text-[9px] font-bold text-rose-400">${row.l}</div>
            <div class="text-[9px] font-bold ${gdColor}">${gdText}</div>
            <div class="text-[12px] font-black text-white text-right pr-1 drop-shadow-md">${row.pts}</div>
        </div>`;
    }).join('');

    container.innerHTML = `
    <div class="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-[1.5rem] overflow-hidden shadow-2xl relative mb-4">
        <!-- Premium Header -->
        <div class="bg-gradient-to-r from-slate-800 to-slate-900 border-b border-white/10 px-4 py-4 flex items-center justify-between relative overflow-hidden">
            <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.05)_0%,transparent_70%)] pointer-events-none"></div>
            <h3 class="text-[12px] font-black text-white uppercase tracking-[0.15em] flex items-center gap-2 relative z-10">
                <i data-lucide="bar-chart-2" class="w-4 h-4 text-emerald-400"></i> Points Table
            </h3>
            <span class="text-[7px] font-black text-emerald-400 bg-emerald-500/10 px-2.5 py-1.5 rounded-lg border border-emerald-500/20 uppercase tracking-widest relative z-10 shadow-[0_0_10px_rgba(16,185,129,0.15)] flex items-center gap-1">
                <i data-lucide="arrow-up-circle" class="w-2.5 h-2.5"></i> Top 4 Qualify
            </span>
        </div>

        <!-- Dynamic Table Header -->
        <div class="grid grid-cols-[20px_1fr_16px_16px_16px_16px_20px_24px] gap-1.5 px-3 py-2.5 bg-black/40 border-b border-white/5 text-[7px] font-black text-slate-500 uppercase tracking-widest text-center items-center">
            <div class="text-left ml-1">#</div>
            <div class="text-left pl-1">Club</div>
            <div title="Played">P</div>
            <div title="Won">W</div>
            <div title="Drawn">D</div>
            <div title="Lost">L</div>
            <div title="Goal Difference">GD</div>
            <div class="text-right pr-1" title="Points">Pts</div>
        </div>

        <!-- Table Body -->
        <div class="flex flex-col relative pb-2 bg-black/20">
            ${rowsHtml}
        </div>
    </div>`;
    
    lucide.createIcons();
}

// --- NEW TEAM MATCH FUNCTIONS ---

let activeMatchId = null;

function openLineupSubmission(matchId) {
    activeMatchId = matchId;
    const u = state.currentUser;
    const myPlayers = state.players.filter(p => p.teamId === u.id);
    const limit = state.settings.playersPerMatch || 6;
    
    let html = `<p class="text-[8px] text-slate-400 mb-3 uppercase font-bold">Select ${limit} players for this match:</p><div class="space-y-2">`;
    myPlayers.forEach(p => {
        html += `<label class="flex items-center gap-3 p-3 bg-slate-950 border border-white/10 rounded-xl cursor-pointer hover:border-blue-500/50">
            <input type="checkbox" name="lineup-select" value="${p.id}" class="w-4 h-4 accent-blue-500">
            ${getAvatarUI(p, 'w-8', 'h-8', 'rounded-lg')}
            <span class="text-[10px] font-black text-white uppercase">${p.name}</span>
        </label>`;
    });
    html += `</div>`;
    document.getElementById('generic-modal-body').innerHTML = html;
    document.getElementById('generic-modal-title').innerText = "Submit Lineup";
    document.getElementById('generic-modal-btn').innerText = "Lock Lineup";
    document.getElementById('generic-modal-btn').onclick = submitLineupProcess;
    openModal('modal-generic');
}

async function submitLineupProcess() {
    const limit = state.settings.playersPerMatch || 6;
    const selected = Array.from(document.querySelectorAll('input[name="lineup-select"]:checked')).map(cb => cb.value);
    if (selected.length !== limit) return notify(`Please select exactly ${limit} players!`, 'alert-circle');
    
    const m = state.matches.find(x => x.id === activeMatchId);
    const u = state.currentUser;
    const isTeam1 = m.team1Id === u.id;
    const updateField = isTeam1 ? { lineup1: selected } : { lineup2: selected };
    
    try {
        await db.collection('matches').doc(activeMatchId).update(updateField);
        closeModal('modal-generic');
        notify('Lineup Locked!', 'check-circle');
    } catch(e) { notify('Failed to submit lineup', 'x-circle'); }
}

async function draw1v1Matchups(matchId) {
    const m = state.matches.find(x => x.id === matchId);
    if (!m || m.lineup1.length === 0 || m.lineup2.length === 0) return;
    
    let l1 = [...m.lineup1];
    let l2 =[...m.lineup2];
    
    // Shuffle arrays for random pairing
    l1 = l1.sort(() => Math.random() - 0.5);
    l2 = l2.sort(() => Math.random() - 0.5);
    
    const matchups =[];
    const maxLen = Math.min(l1.length, l2.length);
    
    for (let i = 0; i < maxLen; i++) {
        matchups.push({
            p1Id: l1[i], p2Id: l2[i],
            score1: 0, score2: 0,
            tag1: '', tag2: '' // For SUB/SWAP tags
        });
    }
    
    try {
        await db.collection('matches').doc(matchId).update({ matchups: matchups, status: 'ongoing' });
        notify('1v1 Matchups Drawn!', 'zap');
    } catch(e) { notify('Failed to draw', 'x'); }
}

function copyMatchSchedule(matchId) {
    const m = state.matches.find(x => x.id === matchId);
    const t1 = state.managers.find(mg => mg.id === m.team1Id);
    const t2 = state.managers.find(mg => mg.id === m.team2Id);
    
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    
    let text = `𝗦𝗟𝗖 𝗕𝗜𝗗 𝗧𝗢𝗨𝗥𝗡𝗔𝗠𝗘𝗡𝗧 - 𝗦𝟭𝟰\n𝗠𝗔𝗧𝗖𝗛 𝗡𝗨𝗠𝗕𝗘𝗥 - ${m.matchNumber} | 𝗠𝗔𝗧𝗖𝗛𝗗𝗔𝗬 - ${dateStr}\n\n`;
    text += `${t1.teamName} 🆚 ${t2.teamName}\n\n`;
    
    m.matchups.forEach((mu, i) => {
        const p1 = state.players.find(p => p.id === mu.p1Id);
        const p2 = state.players.find(p => p.id === mu.p2Id);
        const tag1 = mu.tag1 ? `[${mu.tag1}]` : '';
        const tag2 = mu.tag2 ? ` [${mu.tag2}]` : '';
        text += `${i+1}️⃣ ${p1?.name}${tag1} 🆚 ${p2?.name}${tag2}\n`;
    });
    
    text += `\n𝗠𝗔𝗧𝗖𝗛 𝗥𝗘𝗠𝗔𝗜𝗡𝗜𝗡𝗚 : ${state.matches.filter(x => x.status !== 'completed').length}\n\n`;
    text += `𝗣𝗢𝗜𝗡𝗧𝗦 -\n📁${t1.teamName} = 00\n📁${t2.teamName} = 00\n\n`;
    text += `⛔ 𝗗𝗘𝗔𝗗𝗟𝗜𝗡𝗘 : 𝟭𝟮:𝟯𝟬 𝗔𝗠\n| 𝗠𝗔𝗥𝗖𝗛 𝟮𝟯 , 𝟮𝟬𝟮𝟱\n\n`;
    text += `𝗖𝗔𝗣𝗧𝗔𝗜𝗡 :\n🤵 ${t1.teamName} - ${t1.name}\n🤵 ${t2.teamName} - ${t2.name}\n\n`;
    text += `𝐌𝐀𝐓𝐂𝐇 𝐑𝐄𝐅𝐄𝐑𝐄𝐄 : Set by Admin\n\n🄼🄰🄽 🄾🄵 🅃🄷🄴 🄼🄰🅃🄲🄷 :\n\n`;
    text += `💠 প্রত্যেক ম্যাচ শেষে বিজয়ী দল লিস্ট আপডেট করে দিবেন।\n💠 নামের সাথে SUB/SWAP লিখে দিবেন।\n💠 ম্যাচডে চলাকালীন ইনফো পরিবর্তন সম্ভব নয় ।\n\n`;
    text += `▫️𝐓𝐡𝐢𝐬 𝐭𝐨𝐮𝐫𝐧𝐚𝐦𝐞𝐧𝐭 𝐰𝐢𝐥𝐥 𝐛𝐞 𝐜𝐨𝐧𝐝𝐮𝐜𝐭𝐞𝐝 𝐞𝐧𝐭𝐢𝐫𝐞𝐥𝐲 𝐚𝐜𝐜𝐨𝐫𝐝𝐢𝐧𝐠 𝐭𝐨 𝗦𝗟𝗖 𝗥𝗨𝗟𝗘𝗦 𝗕𝗢𝗢𝗞\nhttps://tinyurl.com/ya6jp2cr\n\n`;
    text += `— 𝗔𝗱𝗺𝗶𝗻𝘀𝘁𝗿𝗮𝘁𝗲𝗱 𝗯𝘆 𝗦𝗬𝗡𝗧𝗛𝗘𝗫 𝗟𝗘𝗚𝗜𝗢𝗡 𝗖𝗛𝗥𝗢𝗡𝗜𝗖𝗟𝗘𝗦`;

    navigator.clipboard.writeText(text).then(() => notify('Format Copied to Clipboard!', 'copy'));
}

function openManageMatch(matchId) {
    activeMatchId = matchId;
    document.getElementById('generic-modal-title').innerText = "Manage Match";
    document.getElementById('generic-modal-body').innerHTML = `
        <button onclick="triggerSwapModal()" class="w-full py-4 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-xl font-black text-[10px] uppercase mb-3">Swap Players (1 Time)</button>
        <button onclick="triggerSubModal()" class="w-full py-4 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded-xl font-black text-[10px] uppercase">Substitute Player</button>
    `;
    document.getElementById('generic-modal-btn').classList.add('hidden'); // Hide confirm button
    openModal('modal-generic');
}

function triggerSwapModal() {
    const m = state.matches.find(x => x.id === activeMatchId);
    const u = state.currentUser;
    const isTeam1 = m.team1Id === u.id;
    if ((isTeam1 && m.swapUsed1) || (!isTeam1 && m.swapUsed2)) return notify('Swap already used in this match!', 'x');
    
    let html = `<p class="text-[8px] text-slate-400 mb-3 uppercase">Select TWO players currently playing to swap their opponents:</p><div class="space-y-2">`;
    m.matchups.forEach((mu, i) => {
        const pId = isTeam1 ? mu.p1Id : mu.p2Id;
        const p = state.players.find(pl => pl.id === pId);
        if(p) html += `<label class="flex items-center gap-2 p-2 bg-slate-950 border border-white/10 rounded-lg"><input type="checkbox" name="swap-cb" value="${i}" class="accent-blue-500"><span class="text-[10px] font-bold text-white uppercase">${p.name}</span></label>`;
    });
    html += `</div>`;
    document.getElementById('generic-modal-body').innerHTML = html;
    document.getElementById('generic-modal-title').innerText = "Swap Players";
    const btn = document.getElementById('generic-modal-btn');
    btn.innerText = "Confirm Swap";
    btn.classList.remove('hidden');
    btn.onclick = executeSwap;
}

async function executeSwap() {
    const selectedIndexes = Array.from(document.querySelectorAll('input[name="swap-cb"]:checked')).map(cb => parseInt(cb.value));
    if (selectedIndexes.length !== 2) return notify('Select exactly TWO players!', 'alert-circle');
    
    const m = state.matches.find(x => x.id === activeMatchId);
    const u = state.currentUser;
    const isTeam1 = m.team1Id === u.id;
    const newMatchups = [...m.matchups];
    
    const idxA = selectedIndexes[0]; const idxB = selectedIndexes[1];
    if (isTeam1) {
        const temp = newMatchups[idxA].p1Id;
        newMatchups[idxA].p1Id = newMatchups[idxB].p1Id;
        newMatchups[idxB].p1Id = temp;
        newMatchups[idxA].tag1 = 'SWAP'; newMatchups[idxB].tag1 = 'SWAP';
    } else {
        const temp = newMatchups[idxA].p2Id;
        newMatchups[idxA].p2Id = newMatchups[idxB].p2Id;
        newMatchups[idxB].p2Id = temp;
        newMatchups[idxA].tag2 = 'SWAP'; newMatchups[idxB].tag2 = 'SWAP';
    }
    
    try {
        await db.collection('matches').doc(activeMatchId).update({
            matchups: newMatchups,
            ...(isTeam1 ? {swapUsed1: true} : {swapUsed2: true})
        });
        closeModal('modal-generic');
        notify('Swap successful!', 'check');
    } catch(e) { notify('Swap failed', 'x'); }
}

function triggerSubModal() {
    const m = state.matches.find(x => x.id === activeMatchId);
    const u = state.currentUser;
    const isTeam1 = m.team1Id === u.id;
    const myPlayers = state.players.filter(p => p.teamId === u.id);
    const subbedOut = isTeam1 ? (m.subbedOut1 || []) : (m.subbedOut2 ||[]);
    
    const playingIds = m.matchups.map(mu => isTeam1 ? mu.p1Id : mu.p2Id);
    const benchPlayers = myPlayers.filter(p => !playingIds.includes(p.id) && !subbedOut.includes(p.id));
    
    if (benchPlayers.length === 0) return notify('No available players on bench!', 'x');
    
    let html = `
    <div class="mb-3"><span class="text-[8px] text-slate-400 uppercase font-bold block mb-1">Select player to SUB OUT:</span><select id="sub-out-sel" class="w-full p-2 bg-slate-950 border border-rose-500/50 text-white text-[10px] rounded">`;
    playingIds.forEach((id, i) => { const p = state.players.find(pl=>pl.id===id); if(p) html += `<option value="${i}">${p.name}</option>`; });
    html += `</select></div>
    <div class="mb-3"><span class="text-[8px] text-slate-400 uppercase font-bold block mb-1">Select player to SUB IN:</span><select id="sub-in-sel" class="w-full p-2 bg-slate-950 border border-emerald-500/50 text-white text-[10px] rounded">`;
    benchPlayers.forEach(p => { html += `<option value="${p.id}">${p.name}</option>`; });
    html += `</select></div><p class="text-[7px] text-rose-400 mt-2">*Subbed out player cannot return for this match.</p>`;
    
    document.getElementById('generic-modal-body').innerHTML = html;
    document.getElementById('generic-modal-title').innerText = "Substitute Player";
    const btn = document.getElementById('generic-modal-btn');
    btn.innerText = "Confirm Sub";
    btn.classList.remove('hidden');
    btn.onclick = executeSub;
}

async function executeSub() {
    const outIdx = parseInt(document.getElementById('sub-out-sel').value);
    const inId = document.getElementById('sub-in-sel').value;
    
    const m = state.matches.find(x => x.id === activeMatchId);
    const u = state.currentUser;
    const isTeam1 = m.team1Id === u.id;
    const newMatchups = [...m.matchups];
    let newSubbedOut = isTeam1 ? [...(m.subbedOut1||[])] :[...(m.subbedOut2||[])];
    
    if (isTeam1) {
        newSubbedOut.push(newMatchups[outIdx].p1Id);
        newMatchups[outIdx].p1Id = inId;
        newMatchups[outIdx].tag1 = 'SUB';
    } else {
        newSubbedOut.push(newMatchups[outIdx].p2Id);
        newMatchups[outIdx].p2Id = inId;
        newMatchups[outIdx].tag2 = 'SUB';
    }
    
    try {
        await db.collection('matches').doc(activeMatchId).update({
            matchups: newMatchups,
            ...(isTeam1 ? {subbedOut1: newSubbedOut} : {subbedOut2: newSubbedOut})
        });
        closeModal('modal-generic');
        notify('Substitution successful!', 'check');
    } catch(e) { notify('Sub failed', 'x'); }
}

function openMatchResultsModal(matchId) {
    activeMatchId = matchId;
    const m = state.matches.find(x => x.id === matchId);
    let html = `<div class="space-y-3 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">`;
    
    let allPlayersInMatch = [];
    
    m.matchups.forEach((mu, i) => {
        const p1 = state.players.find(p => p.id === mu.p1Id);
        const p2 = state.players.find(p => p.id === mu.p2Id);
        if (p1) allPlayersInMatch.push(p1);
        if (p2) allPlayersInMatch.push(p2);
        
        html += `
        <div class="bg-slate-950 border border-white/5 rounded-xl p-3 shadow-inner">
            <div class="flex items-center justify-between gap-2 mb-3">
                <div class="flex-1 text-center"><span class="text-[9px] font-black text-white uppercase">${p1?.name||'--'}</span></div>
                <span class="text-[8px] text-slate-500 font-bold bg-black/50 px-2 py-0.5 rounded">VS</span>
                <div class="flex-1 text-center"><span class="text-[9px] font-black text-white uppercase">${p2?.name||'--'}</span></div>
            </div>
<div class="flex items-center justify-between gap-4 px-2">
                <div class="flex-1">
                    <input type="number" id="sc1-${i}" placeholder="Goals Scored" value="${mu.score1||0}" class="w-full text-center bg-black text-emerald-400 text-[13px] font-black py-2.5 rounded-lg border border-white/10 outline-none focus:border-emerald-500 placeholder-slate-700" ${state.role !== 'admin' ? 'disabled' : ''}>
                </div>
                <div class="flex-1">
                    <input type="number" id="sc2-${i}" placeholder="Goals Scored" value="${mu.score2||0}" class="w-full text-center bg-black text-emerald-400 text-[13px] font-black py-2.5 rounded-lg border border-white/10 outline-none focus:border-emerald-500 placeholder-slate-700" ${state.role !== 'admin' ? 'disabled' : ''}>
                </div>
            </div>
        </div>`;
    });
    
    html += `</div>`;
    
    // Admin এর জন্য MVP সিলেক্ট করার ড্রপডাউন
    if (state.role === 'admin') {
        html += `
        <div class="mt-4 pt-4 border-t border-white/10">
            <label class="text-[10px] text-gold-400 font-black uppercase tracking-widest block mb-2 flex items-center gap-1.5"><i data-lucide="star" class="w-3.5 h-3.5"></i> Select Match MVP</label>
            <select id="match-mvp-select" class="w-full p-3 bg-slate-950 border border-gold-500/30 text-white text-[11px] font-bold rounded-xl outline-none focus:border-gold-500">
                <option value="">-- No MVP Selected --</option>
                ${allPlayersInMatch.map(p => `<option value="${p.id}" ${m.mvpId === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
            </select>
        </div>`;
    } else {
        // প্লেয়ার বা ম্যানেজারের জন্য শুধু MVP এর নাম দেখাবে
        const mvpP = state.players.find(p => p.id === m.mvpId);
        if (mvpP) {
            html += `<div class="mt-4 pt-4 border-t border-white/10 text-center bg-gradient-to-r from-transparent via-gold-500/10 to-transparent rounded-lg pb-2">
                <span class="text-[8px] text-gold-400 font-black uppercase tracking-widest block mb-1">Match MVP</span>
                <span class="text-[14px] font-black text-white uppercase">${mvpP.name}</span>
            </div>`;
        }
    }
    
    document.getElementById('generic-modal-body').innerHTML = html;
    document.getElementById('generic-modal-title').innerText = "Match Results & Stats";
    
    const btn = document.getElementById('generic-modal-btn');
    if (state.role === 'admin') {
        btn.innerText = "Save Results & Stats";
        btn.classList.remove('hidden');
        btn.onclick = saveTeamMatchResults;
    } else {
        btn.classList.add('hidden');
    }
    openModal('modal-generic');
    lucide.createIcons();
}

async function saveTeamMatchResults() {
    const m = state.matches.find(x => x.id === activeMatchId);
    const newMatchups = [...m.matchups];
    let mainPts1 = 0, mainPts2 = 0;
    
    newMatchups.forEach((mu, i) => {
            mu.score1 = parseInt(document.getElementById(`sc1-${i}`).value) || 0;
            mu.score2 = parseInt(document.getElementById(`sc2-${i}`).value) || 0;
        
        if (mu.score1 > mu.score2) mainPts1 += 3;
        else if (mu.score2 > mu.score1) mainPts2 += 3;
        else if (mu.score1 === mu.score2) { mainPts1 += 1; mainPts2 += 1; }
    });
    
    let mainScore1 = 0, mainScore2 = 0;
    if (mainPts1 > mainPts2) mainScore1 = 3;
    else if (mainPts2 > mainPts1) mainScore2 = 3;
    else { mainScore1 = 1; mainScore2 = 1; }
    
    const mvpId = document.getElementById('match-mvp-select')?.value || null;

    try {
        await db.collection('matches').doc(activeMatchId).update({
            matchups: newMatchups,
            mainScore1: mainScore1,
            mainScore2: mainScore2,
            mvpId: mvpId,
            status: 'completed'
        });
        closeModal('modal-generic');
        notify('Results & Player Stats Saved!', 'check-circle');
    } catch(e) { notify('Save failed', 'x-circle'); }
}

async function confirmSwap() {
    const matchId = state.swapMatchId;
    const match = state.matches.find(m => m.id === matchId);
    if (!match) return;

    const selected = Array.from(document.querySelectorAll('input[name="swap-player"]:checked')).map(i => i.value);
    if (selected.length !== 2) return notify('Select exactly 2 players to swap', 'alert-circle');

    // Swap their opponent assignments
    try {
        const updatedMatches = state.matches.map(m => {
            if (m.id === matchId) {
                const newM = {...m};
                if (newM.player1Id === selected[0]) newM.player1Id = selected[1];
                else if (newM.player1Id === selected[1]) newM.player1Id = selected[0];
                if (newM.player2Id === selected[0]) newM.player2Id = selected[1];
                else if (newM.player2Id === selected[1]) newM.player2Id = selected[0];
                newM.swapUsed = true;
                return newM;
            }
            return m;
        });

        const matchRef = db.collection('matches').doc(matchId);
        const swapped = updatedMatches.find(m => m.id === matchId);
        await matchRef.update({ player1Id: swapped.player1Id, player2Id: swapped.player2Id, swapUsed: true });
        closeModal('modal-swap');
        notify('Swap applied!', 'check-circle');
    } catch(e) {
        notify('Swap failed', 'x-circle');
    }
}

// ==================== BIDDING (VIEWER) ====================
// Tracking variables for smooth state transitions (Green/Red flashes)
let transientBidState = null;
let transientTimer = null;
let cachedPlayer = null;
let cachedBid = null;
let cachedTeam = null;
// Tracking variables for smooth Manager state transitions
let mTransientBidState = null;
let mTransientTimer = null;
let mCachedPlayer = null;
let mCachedBid = null;
let mCachedTeam = null;
// Tracking variables for smooth Admin state transitions
let aTransientBidState = null;
let aTransientTimer = null;
let aCachedPlayer = null;
let aCachedBid = null;
let aCachedTeam = null;

function updatePlayerBidUI() {
    const session = state.bidSession;
    const banner = document.getElementById('p-live-bid-banner');
    const idle = document.getElementById('p-bid-idle');
    const active = document.getElementById('p-bid-active');
    const premiumCard = document.getElementById('p-premium-bid-card');
    
    if (!session || session.status !== 'active') {
        banner?.classList.add('hidden');
        idle.classList.remove('hidden');
        active.classList.add('hidden');
        transientBidState = null;
        return;
    }
    
    banner?.classList.remove('hidden');
    
    if (session.currentPlayer) {
        // Auction actively running
        clearTimeout(transientTimer);
        transientBidState = null;
        cachedPlayer = session.currentPlayer;
        cachedBid = session.currentBid;
        cachedTeam = session.currentBidder ? getTeamName(session.currentBidder) : 'No bids yet';
        
        idle.classList.add('hidden');
        active.classList.remove('hidden');
        
        renderActivePlayer(premiumCard, cachedPlayer, cachedBid, cachedTeam, session, 'running');
    } else {
        // Player removed from stage, let's determine if they were Sold or Skipped
        if (cachedPlayer && !transientBidState) {
            const wasSold = (session.soldPlayers || []).some(s => s.playerId === cachedPlayer.id);
            const wasUnsold = (session.unsoldPool || []).includes(cachedPlayer.id);
            
            if (wasSold) {
                transientBidState = 'sold';
                const saleRecord = (session.soldPlayers || []).find(s => s.playerId === cachedPlayer.id);
                if (saleRecord) {
                    cachedBid = saleRecord.amount;
                    cachedTeam = getTeamName(saleRecord.managerId);
                }
            } else if (wasUnsold) {
                transientBidState = 'skipped';
            } else {
                transientBidState = 'idle';
            }
            
            // Show transient state (Green or Red flash) for 3.5 seconds before hiding
            if (transientBidState === 'sold' || transientBidState === 'skipped') {
                renderActivePlayer(premiumCard, cachedPlayer, cachedBid, cachedTeam, session, transientBidState);
                transientTimer = setTimeout(() => {
                    cachedPlayer = null;
                    updatePlayerBidUI(); // Re-render to show idle screen
                }, 3500);
                return;
            }
        }
        
        if (!cachedPlayer) {
            // Fully idle between players
            idle.classList.remove('hidden');
            active.classList.add('hidden');
        }
    }
}

function renderActivePlayer(cardEl, cp, bidAmt, teamName, session, stateType) {
    document.getElementById('p-current-player-name').textContent = cp.name || '--';
    document.getElementById('p-current-player-serial').textContent = cp.serialNumber || '--';
    const img = document.getElementById('p-current-player-img');
    if (cp.avatar) { img.src = cp.avatar; img.style.display = 'block'; }
    else { img.style.display = 'none'; }

    document.getElementById('p-current-bid-amount').textContent = '৳' + (bidAmt || 0);
    document.getElementById('p-current-bid-team').textContent = teamName;

    const countdownRing = document.getElementById('p-countdown-ring');
    const countdownNum = document.getElementById('p-countdown-num');
    const statusText = document.getElementById('p-bid-status-text');
    const overlay = document.getElementById('p-bid-state-overlay');

    // Reset Classes
    cardEl.className = 'premium-bid-card flex flex-col items-center p-6 w-full relative overflow-hidden';
    overlay.classList.add('hidden');

    // Apply specific UI styles based on Phase
    if (stateType === 'sold') {
        cardEl.classList.add('bid-status-sold');
        statusText.innerHTML = '<span class="text-emerald-400">SUCCESSFULLY SOLD!</span>';
        countdownNum.textContent = '✓';
        countdownRing.classList.remove('urgent');
        countdownRing.style.borderColor = '#10b981';
        
        // Show the giant green Sold overlay mask
        overlay.innerHTML = `
            <div class="absolute inset-0 bg-emerald-950/80 flex items-center justify-center backdrop-blur-md rounded-[1.2rem]">
                <div class="text-center animate-pop-in">
                    <i data-lucide="gavel" class="w-12 h-12 text-emerald-400 mx-auto mb-3"></i>
                    <span class="text-4xl font-black text-emerald-400 tracking-widest border-4 border-emerald-400 px-6 py-2 rounded-2xl bg-slate-950 block shadow-[0_0_30px_rgba(16,185,129,0.5)]">SOLD</span>
                    <p class="text-white mt-3 text-[10px] tracking-widest uppercase font-bold">To ${teamName}</p>
                </div>
            </div>`;
        overlay.classList.remove('hidden');
        lucide.createIcons();
    } else if (stateType === 'skipped') {
        cardEl.classList.add('bid-status-skipped');
        statusText.innerHTML = '<span class="text-rose-400">PLAYER UNSOLD / SKIPPED</span>';
        countdownNum.textContent = '✕';
        countdownRing.classList.remove('urgent');
        countdownRing.style.borderColor = '#f43f5e';
        
        // Show the giant red Unsold overlay mask
        overlay.innerHTML = `
            <div class="absolute inset-0 bg-rose-950/80 flex items-center justify-center backdrop-blur-md rounded-[1.2rem]">
                <div class="text-center animate-pop-in">
                    <i data-lucide="x-circle" class="w-12 h-12 text-rose-400 mx-auto mb-3"></i>
                    <span class="text-4xl font-black text-rose-400 tracking-widest border-4 border-rose-400 px-6 py-2 rounded-2xl bg-slate-950 block shadow-[0_0_30px_rgba(244,63,94,0.5)]">UNSOLD</span>
                    <p class="text-white mt-3 text-[10px] tracking-widest uppercase font-bold">Skipped by Admin</p>
                </div>
            </div>`;
        overlay.classList.remove('hidden');
        lucide.createIcons();
    } else {
        // Normal Running Setup
        cardEl.classList.add('bid-status-running');
        countdownRing.style.borderColor = ''; // reset to CSS default
        if(typeof updateCountdownUI === 'function') {
            updateCountdownUI('p-countdown-ring', 'p-countdown-num', session);
        }
        statusText.textContent = session.held ? '⏸ AUCTION PAUSED' : (session.currentBidder ? 'Bidding in progress...' : 'Waiting for first bid...');
    }
}

function updateManagerBidUI() {
    const session = state.bidSession;
    if (!session || session.status !== 'active') return;
    
    const premiumCard = document.getElementById('m-premium-bid-card');
    
    if (session.currentPlayer) {
        clearTimeout(mTransientTimer);
        mTransientBidState = null;
        mCachedPlayer = session.currentPlayer;
        mCachedBid = session.currentBid;
        mCachedTeam = session.currentBidder ? getTeamName(session.currentBidder) : 'No bids yet';
        
        renderManagerActivePlayer(premiumCard, mCachedPlayer, mCachedBid, mCachedTeam, session, 'running');
    } else {
        if (mCachedPlayer && !mTransientBidState) {
            const wasSold = (session.soldPlayers || []).some(s => s.playerId === mCachedPlayer.id);
            const wasUnsold = (session.unsoldPool || []).includes(mCachedPlayer.id);
            
            if (wasSold) {
                mTransientBidState = 'sold';
                const saleRecord = (session.soldPlayers || []).find(s => s.playerId === mCachedPlayer.id);
                if (saleRecord) {
                    mCachedBid = saleRecord.amount;
                    mCachedTeam = getTeamName(saleRecord.managerId);
                }
            } else if (wasUnsold) {
                mTransientBidState = 'skipped';
            } else {
                mTransientBidState = 'idle';
            }
            
            if (mTransientBidState === 'sold' || mTransientBidState === 'skipped') {
                renderManagerActivePlayer(premiumCard, mCachedPlayer, mCachedBid, mCachedTeam, session, mTransientBidState);
                mTransientTimer = setTimeout(() => {
                    mCachedPlayer = null;
                    renderManagerBidArea(); // re-evaluates hiding area
                }, 3500);
                return;
            }
        }
    }
}

function renderManagerActivePlayer(cardEl, cp, bidAmt, teamName, session, stateType) {
    if(!cp) return;
    
    document.getElementById('m-bid-player-name').textContent = cp.name || '--';
    document.getElementById('m-bid-player-serial').textContent = cp.serialNumber || '--';
    const img = document.getElementById('m-bid-player-img');
    if (cp.avatar) { img.src = cp.avatar; img.style.display = 'block'; }
    else { img.style.display = 'none'; }

    document.getElementById('m-bid-current-amt').textContent = '৳' + (bidAmt || 0);
    document.getElementById('m-bid-current-team').textContent = teamName;

    const countdownRing = document.getElementById('m-countdown-ring');
    const countdownNum = document.getElementById('m-countdown-num');
    const overlay = document.getElementById('m-bid-state-overlay');
    const bidButtons = document.getElementById('m-bid-buttons');

    // Reset base classes
    cardEl.className = 'premium-bid-card flex flex-col items-center p-6 w-full relative overflow-hidden';
    overlay.classList.add('hidden');

    if (stateType === 'sold') {
        cardEl.classList.add('bid-status-sold');
        countdownNum.textContent = '✓';
        countdownRing.classList.remove('urgent');
        countdownRing.style.borderColor = '#10b981';
        
        // Dim buttons on completion
        bidButtons.style.opacity = '0.3';
        bidButtons.style.pointerEvents = 'none';
        
        overlay.innerHTML = `
            <div class="absolute inset-0 bg-emerald-950/80 flex items-center justify-center backdrop-blur-md rounded-[1.2rem]">
                <div class="text-center animate-pop-in">
                    <i data-lucide="gavel" class="w-12 h-12 text-emerald-400 mx-auto mb-3"></i>
                    <span class="text-4xl font-black text-emerald-400 tracking-widest border-4 border-emerald-400 px-6 py-2 rounded-2xl bg-slate-950 block shadow-[0_0_30px_rgba(16,185,129,0.5)]">SOLD</span>
                    <p class="text-white mt-3 text-[10px] tracking-widest uppercase font-bold">To ${teamName}</p>
                </div>
            </div>`;
        overlay.classList.remove('hidden');
        lucide.createIcons();
        
    } else if (stateType === 'skipped') {
        cardEl.classList.add('bid-status-skipped');
        countdownNum.textContent = '✕';
        countdownRing.classList.remove('urgent');
        countdownRing.style.borderColor = '#f43f5e';
        
        // Dim buttons on completion
        bidButtons.style.opacity = '0.3';
        bidButtons.style.pointerEvents = 'none';
        
        overlay.innerHTML = `
            <div class="absolute inset-0 bg-rose-950/80 flex items-center justify-center backdrop-blur-md rounded-[1.2rem]">
                <div class="text-center animate-pop-in">
                    <i data-lucide="x-circle" class="w-12 h-12 text-rose-400 mx-auto mb-3"></i>
                    <span class="text-4xl font-black text-rose-400 tracking-widest border-4 border-rose-400 px-6 py-2 rounded-2xl bg-slate-950 block shadow-[0_0_30px_rgba(244,63,94,0.5)]">UNSOLD</span>
                    <p class="text-white mt-3 text-[10px] tracking-widest uppercase font-bold">Skipped by Admin</p>
                </div>
            </div>`;
        overlay.classList.remove('hidden');
        lucide.createIcons();
        
    } else {
        cardEl.classList.add('bid-status-running');
        countdownRing.style.borderColor = ''; 
        if(typeof updateCountdownUI === 'function') {
            updateCountdownUI('m-countdown-ring', 'm-countdown-num', session);
        }
        
// Logic for enabling/disabling bid buttons based on budget
const u = state.currentUser;
const fresh = state.managers.find(m => m.id === u.id) || u;
const budget = fresh.budget !== undefined ? fresh.budget : (state.settings.teamBudget || 1500);
const squad = state.players.filter(p => p.teamId === u.id);

// Fixed: Removed the - 1
const maxP = (state.settings.maxPlayers || 6);
const canBid = fresh.paymentStatus === 'approved' && budget > 0 && squad.length < maxP;

bidButtons.style.opacity = (!canBid || session.held) ? '0.4' : '1';
bidButtons.style.pointerEvents = (!canBid || session.held) ? 'none' : 'auto';
    }
}

function updateCountdownUI(ringId, numId, session) {
    const ring = document.getElementById(ringId);
    const num = document.getElementById(numId);
    if (!ring || !num) return;
    
    if (session.held) {
        num.textContent = session.countdown ?? '--';
        ring.classList.remove('urgent');
        num.style.color = '#f59e0b';
        return;
    }
    
    // Always use the real countdown value, default to 30
    const c = session.countdown ?? 30;
    num.textContent = c;
    num.style.color = '#fff';
    
    // Add pulsing red effect if 5 seconds or less remain
    if (c <= 5) {
        ring.classList.add('urgent');
    } else {
        ring.classList.remove('urgent');
    }
}

async function placeBid(increment) {
    const session = state.bidSession;
    if (!session || session.status !== 'active' || session.held) return notify('Cannot bid now', 'x');
    const u = state.currentUser;
    const fresh = state.managers.find(m => m.id === u.id) || u;
    const newBid = (session.currentBid || 0) + increment;
    const budget = fresh.budget !== undefined ? fresh.budget : (state.settings.teamBudget || 1500);

    if (newBid > budget) return notify('Insufficient budget!', 'alert-circle');
    if (session.currentBidder === u.id) return notify('You already have highest bid!', 'info');

    await submitBid(newBid);
}

async function placeCustomBid() {
    const val = parseInt(document.getElementById('m-custom-bid').value);
    if (!val || val <= 0) return notify('Enter valid amount', 'alert-circle');
    const session = state.bidSession;
    if (!session) return;
    const currentBid = session.currentBid || 0;
    if (val <= currentBid) return notify('Bid must be higher than current bid (৳' + currentBid + ')', 'alert-circle');
    const u = state.currentUser;
    const fresh = state.managers.find(m => m.id === u.id) || u;
    const budget = fresh.budget !== undefined ? fresh.budget : (state.settings.teamBudget || 1500);
    if (val > budget) return notify('Insufficient budget!', 'alert-circle');
    await submitBid(val);
    document.getElementById('m-custom-bid').value = '';
}

async function submitBid(amount) {
    const u = state.currentUser;
    const fresh = state.managers.find(m => m.id === u.id) || u;
    const budget = fresh.budget !== undefined ? fresh.budget : (state.settings.teamBudget || 1500);
    if (amount > budget) {
        return notify('Action Blocked: Insufficient budget!', 'x-circle');
    }
    const currentCountdown = state.bidSession?.countdown ?? 30;
    const newCountdown = Math.min(currentCountdown + 10, 30);
    
    try {
        await db.collection('bidSession').doc('current').update({
            currentBid: amount,
            currentBidder: u.id,
            currentBidderName: u.teamName,
            countdown: newCountdown,
            lastBidAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        notify('Bid placed: ৳' + amount, 'zap');
    } catch (e) {
        notify('Bid failed', 'x-circle');
    }
}

// ==================== ADMIN APP ====================
function launchAdminApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('admin-app').classList.remove('hidden');
    switchATab('overview');
    subscribeAll();
    lucide.createIcons();
}

function switchATab(tab) {
    const allTabs = ['overview', 'payments', 'bidding', 'players', 'teams', 'matches', 'info'];
    
    // 1. Loop through all tabs safely and toggle UI
    allTabs.forEach(t => {
        // Safely toggle content area
        const contentEl = document.getElementById(`a-tab-${t}`);
        if (contentEl) {
            contentEl.classList.toggle('hidden', t !== tab);
        }
        
        // Safely toggle bottom navigation buttons
        const navBtn = document.getElementById(`anav-${t}`);
        if (navBtn) {
            navBtn.classList.toggle('active', t === tab);
        }
    });
    
    // 2. Call the specific render function for the active tab
    if (tab === 'overview') renderAdminOverview();
    if (tab === 'payments') renderAdminPayments();
    if (tab === 'bidding') renderAdminBidding();
    if (tab === 'players') renderAdminPlayers();
    if (tab === 'teams') renderAdminTeams();
    if (tab === 'matches') renderAdminMatches();
    if (tab === 'info') {
        const searchInput = document.getElementById('a-info-search');
        renderInfoTab('a-info-container', searchInput ? searchInput.value : '');
    }
    
    // 3. Re-initialize Lucide Icons for newly rendered elements
    lucide.createIcons();
}
function renderAdminOverview() {
    const statPlayers = document.getElementById('a-stat-players');
    if (statPlayers) statPlayers.textContent = state.players.length;
    
    const statManagers = document.getElementById('a-stat-managers');
    if (statManagers) statManagers.textContent = state.managers.length;
    
    const statPending = document.getElementById('a-stat-pending');
    if (statPending) statPending.textContent = [...state.players, ...state.managers].filter(x => x.paymentStatus === 'pending').length;
    
    const statRegistered = document.getElementById('a-stat-registered');
    if (statRegistered) statRegistered.textContent = state.players.filter(p => p.paymentStatus === 'approved').length;
    
    const s = state.settings || { maxPlayers: 6, teamBudget: 1500, baseBid: 50 };
    
    const maxPInput = document.getElementById('a-max-players');
    if (maxPInput && maxPInput.value === '') maxPInput.value = s.maxPlayers || 6;
    const ppmInput = document.getElementById('a-players-per-match');
if (ppmInput && ppmInput.value === '') ppmInput.value = s.playersPerMatch || 6;
    
    const budgetInput = document.getElementById('a-team-budget');
    if (budgetInput && budgetInput.value === '') budgetInput.value = s.teamBudget || 1500;
    
    const bidInput = document.getElementById('a-base-bid');
    if (bidInput && bidInput.value === '') bidInput.value = s.baseBid || 50;
}

async function saveSettings(key) {
    let val;
    if (key === 'maxPlayers') val = parseInt(document.getElementById('a-max-players').value);
    else if (key === 'playersPerMatch') val = parseInt(document.getElementById('a-players-per-match').value);
    else if (key === 'teamBudget') val = parseInt(document.getElementById('a-team-budget').value);
    else if (key === 'baseBid') val = parseInt(document.getElementById('a-base-bid').value);
    if (!val || val <= 0) return notify('Enter valid number', 'alert-circle');

    try {
        await db.collection('settings').doc('tournament').set({ [key]: val }, { merge: true });
        state.settings[key] = val;
        notify('Setting saved!', 'check-circle');

        // If setting teamBudget, update all approved managers
        if (key === 'teamBudget') {
            const approvedManagers = state.managers.filter(m => m.paymentStatus === 'approved' && m.budget === undefined);
            const batch = db.batch();
            approvedManagers.forEach(m => batch.update(db.collection('managers').doc(m.id), { budget: val }));
            await batch.commit();
        }
    } catch(e) {
        notify('Save failed', 'x-circle');
    }
}

function renderAdminPayments() {
    // Players
    const pp = document.getElementById('a-pending-players');
    const pendingPlayers = state.players.filter(p => p.paymentStatus === 'pending');
    if (!pendingPlayers.length) { pp.innerHTML = `<p class="text-[8px] text-slate-500 font-bold text-center py-4">No pending player payments</p>`; }
    else { pp.innerHTML = pendingPlayers.map(p => adminPaymentItem(p, 'player')).join(''); }

    // Managers
    const pm = document.getElementById('a-pending-managers');
    const pendingManagers = state.managers.filter(m => m.paymentStatus === 'pending');
    if (!pendingManagers.length) { pm.innerHTML = `<p class="text-[8px] text-slate-500 font-bold text-center py-4">No pending manager payments</p>`; }
    else { pm.innerHTML = pendingManagers.map(m => adminPaymentItem(m, 'manager')).join(''); }

    lucide.createIcons();
}

function adminPaymentItem(person, type) {
    return `
    <div class="flex items-center gap-3 p-3 border-b border-white/5 last:border-none">
        ${getAvatarUI(type === 'manager' ? {name: person.teamName, avatar: person.logo} : person, 'w-10', 'h-10', 'rounded-xl flex-shrink-0')}
        <div class="flex-1 min-w-0">
            <div class="text-[9px] font-black text-white truncate uppercase">${type === 'manager' ? person.teamName : person.name}</div>
            <div class="text-[7px] text-slate-500 font-bold">${person.id}</div>
            <div class="text-[8px] text-gold-400 font-bold">TRXID: ${person.trxid}</div>
            <div class="text-[7px] text-slate-500 font-bold">Amount: ${type === 'player' ? '৳'+PLAYER_FEE : '৳'+MANAGER_FEE}</div>
        </div>
        <div class="flex flex-col gap-1.5 flex-shrink-0">
            <button onclick="approvePayment('${person.id}','${type}')" class="px-3 py-1.5 bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 text-[8px] font-black rounded-xl uppercase">Approve</button>
            <button onclick="rejectPayment('${person.id}','${type}')" class="px-3 py-1.5 bg-rose-600/10 border border-rose-500/20 text-rose-400 text-[8px] font-black rounded-xl uppercase">Reject</button>
        </div>
    </div>`;
}

async function approvePayment(id, type) {
    const col = type === 'player' ? 'players' : 'managers';
    try {
        const updateData = { paymentStatus: 'approved', approvedAt: firebase.firestore.FieldValue.serverTimestamp() };
        const batch = db.batch();
        
        if (type === 'player') {
            const approvedCount = state.players.filter(p => p.paymentStatus === 'approved').length;
            updateData.serialNumber = generateSerialNumber(approvedCount);
            batch.update(db.collection('players').doc(id), updateData);
        } else {
            const budget = state.settings.teamBudget || 1500;
            updateData.budget = budget;
            batch.update(db.collection('managers').doc(id), updateData);
            
            // Find linked manager's player profile and approve it
            const m = state.managers.find(x => x.id === id);
            if (m && m.managerPlayerId) {
                const approvedCount = state.players.filter(p => p.paymentStatus === 'approved').length;
                batch.update(db.collection('players').doc(m.managerPlayerId), {
                    paymentStatus: 'approved',
                    approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    serialNumber: generateSerialNumber(approvedCount)
                });
            }
        }
        
        await batch.commit();
        notify('Payment approved!', 'check-circle');
    } catch (e) {
        notify('Failed to approve', 'x-circle');
    }
}

async function rejectPayment(id, type) {
    askConfirm('Reject this payment?', async () => {
        const col = type === 'player' ? 'players' : 'managers';
        const batch = db.batch();
        batch.update(db.collection(col).doc(id), { paymentStatus: 'none', trxid: null });
        
        if (type === 'manager') {
            const m = state.managers.find(x => x.id === id);
            if (m && m.managerPlayerId) {
                batch.update(db.collection('players').doc(m.managerPlayerId), { paymentStatus: 'none', trxid: null });
            }
        }
        
        await batch.commit();
        notify('Payment rejected', 'x-circle');
    });
}

// ==================== ADMIN BIDDING ====================
async function startBiddingSession() {
    const approvedPlayers = state.players.filter(p => p.paymentStatus === 'approved' && !p.teamId);
    if (approvedPlayers.length === 0) return notify('No players available to bid!', 'alert-circle');
    const approvedManagers = state.managers.filter(m => m.paymentStatus === 'approved');
    if (approvedManagers.length === 0) return notify('No approved managers!', 'alert-circle');

    const playerPool = approvedPlayers.map(p => p.id);

    try {
        await db.collection('bidSession').doc('current').set({
            status: 'active',
            playerPool: playerPool,
            unsoldPool: [],
            soldPlayers: [],
            currentPlayer: null,
            currentBid: 0,
            currentBidder: null,
            currentBidderName: null,
            countdown: 30,
            held: false,
            phase: 'waiting', // waiting | bidding
            startedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        notify('Bidding session started!', 'zap');
        switchATab('bidding');
    } catch(e) {
        notify('Failed to start session', 'x-circle');
    }
}

async function pickNextPlayer() {
    const session = state.bidSession;
    if (!session) return;

    let pool = [...(session.playerPool || [])];
    // If pool empty, use unsold
    if (pool.length === 0) {
        pool = [...(session.unsoldPool || [])];
        if (pool.length === 0) {
            notify('All players have been auctioned!', 'check-circle');
            await adminEndBidding();
            return;
        }
        // Clear unsold, use them as new pool
        await db.collection('bidSession').doc('current').update({ playerPool: pool, unsoldPool: [] });
    }

    // Pick random
    const randomIndex = Math.floor(Math.random() * pool.length);
    const pickedId = pool[randomIndex];
    const newPool = pool.filter((_, i) => i !== randomIndex);
    const pickedPlayer = state.players.find(p => p.id === pickedId);

    if (!pickedPlayer) {
        await db.collection('bidSession').doc('current').update({ playerPool: newPool });
        pickNextPlayer();
        return;
    }

    const baseBid = state.settings.baseBid || 50;

    await db.collection('bidSession').doc('current').update({
        playerPool: newPool,
        currentPlayer: { id: pickedId, name: pickedPlayer.name, serialNumber: pickedPlayer.serialNumber, avatar: pickedPlayer.avatar || null },
        currentBid: baseBid,
        currentBidder: null,
        currentBidderName: null,
        countdown: 30,
        held: false,
        phase: 'bidding',
        pickedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Start server-side countdown simulation on client (admin)
    startAdminCountdown();
    notify(`Picked: ${pickedPlayer.name}`, 'user');
}

let adminCountdownInterval = null;
function clearBidCountdown() { if (adminCountdownInterval) { clearInterval(adminCountdownInterval); adminCountdownInterval = null; } }

function startAdminCountdown() {
    clearBidCountdown();
    adminCountdownInterval = setInterval(async () => {
        const session = state.bidSession;
        if (!session || session.status !== 'active' || session.held || !session.currentPlayer) {
            clearBidCountdown(); return;
        }

        const current = session.countdown ?? 30;
        if (current <= 1) {
            clearBidCountdown();
            // Time's up
            if (session.currentBidder) {
                // Sell to highest bidder
                await sellPlayer(session.currentPlayer.id, session.currentBidder, session.currentBid);
            } else {
                // Unsold
                await markUnsold(session.currentPlayer.id);
            }
        } else {
            await db.collection('bidSession').doc('current').update({ countdown: current - 1 });
        }
    }, 1000);
}

async function adminHoldBid() {
    const session = state.bidSession;
    if (!session) return;
    const nowHeld = !session.held;
    await db.collection('bidSession').doc('current').update({ held: nowHeld });
    const btn = document.getElementById('a-hold-btn');
    if (btn) btn.innerHTML = nowHeld ?
        `<i data-lucide="play" class="w-4 h-4 mx-auto mb-1"></i>RESUME` :
        `<i data-lucide="pause" class="w-4 h-4 mx-auto mb-1"></i>HOLD`;

    if (nowHeld) clearBidCountdown();
    else startAdminCountdown();
    lucide.createIcons();
}

async function adminForceSell() {
    try {
        const session = state.bidSession;
        if (!session || !session.currentPlayer) return;
        
        if (!session.currentBidder) {
            return notify('No bids yet! Cannot sell.', 'alert-circle');
        }
        clearBidCountdown();
        await sellPlayer(session.currentPlayer.id, session.currentBidder, session.currentBid);
    } catch (error) {
        console.error("Sell action failed:", error);
        notify('Failed to process sale', 'x-circle');
    }
}

async function adminSkipPlayer() {
    try {
        const session = state.bidSession;
        if (!session || !session.currentPlayer) return;
        clearBidCountdown();
        await markUnsold(session.currentPlayer.id);
    } catch (error) {
        console.error("Skip action failed:", error);
        notify('Failed to skip player', 'x-circle');
    }
}

async function markUnsold(playerId) {
    const session = state.bidSession;
    const unsold = [...(session.unsoldPool || []), playerId];
    const sold = session.soldPlayers || [];
    await db.collection('bidSession').doc('current').update({
        currentPlayer: null,
        currentBid: 0,
        currentBidder: null,
        currentBidderName: null,
        countdown: 30,
        phase: 'waiting',
        unsoldPool: unsold
    });
    notify('Player marked UNSOLD', 'user-x');
}

async function sellPlayer(playerId, managerId, amount) {
        const session = state.bidSession;
        const sold = [...(session.soldPlayers || []), { playerId, managerId, amount }];
        const manager = state.managers.find(m => m.id === managerId);
        const newBudget = (manager?.budget || state.settings.teamBudget || 1500) - amount;
        
        const batch = db.batch();
        // Update player
        batch.update(db.collection('players').doc(playerId), {
            teamId: managerId,
            bidPrice: amount,
            draftedAt: firebase.firestore.FieldValue.serverTimestamp() // Added Timestamp
        });
    // Update manager budget
    batch.update(db.collection('managers').doc(managerId), { budget: newBudget });
    // Update bid session
    batch.update(db.collection('bidSession').doc('current'), {
        currentPlayer: null,
        currentBid: 0,
        currentBidder: null,
        currentBidderName: null,
        countdown: 30,
        phase: 'waiting',
        soldPlayers: sold
    });
    await batch.commit();
    const player = state.players.find(p => p.id === playerId);
    const managerName = manager?.teamName || managerId;
    notify(`${player?.name || 'Player'} SOLD to ${managerName} for ৳${amount}!`, 'check-circle');
}

async function adminEndBidding() {
    askConfirm('End bidding session?', async () => {
        clearBidCountdown();
        await db.collection('bidSession').doc('current').update({ status: 'ended' });
        notify('Bidding session ended', 'check-circle');
    });
}

function renderAdminBidding() {
    const session = state.bidSession;
    const idle = document.getElementById('a-bid-idle');
    const active = document.getElementById('a-bid-active');

    if (!session || session.status !== 'active') {
        idle.classList.remove('hidden');
        active.classList.add('hidden');
        return;
    }
    idle.classList.add('hidden');
    active.classList.remove('hidden');
    updateAdminBidUI();
}

function updateAdminBidUI() {
    const session = state.bidSession;
    const idle = document.getElementById('a-bid-idle');
    const active = document.getElementById('a-bid-active');
    const premiumCard = document.getElementById('a-premium-bid-card');
    const pickNextBtn = document.getElementById('a-pick-next-btn');
    
    if (!session || session.status !== 'active') {
        idle.classList.remove('hidden');
        active.classList.add('hidden');
        aTransientBidState = null;
        return;
    }
    idle.classList.add('hidden');
    active.classList.remove('hidden');
    
    if (session.currentPlayer) {
        clearTimeout(aTransientTimer);
        aTransientBidState = null;
        aCachedPlayer = session.currentPlayer;
        aCachedBid = session.currentBid;
        aCachedTeam = session.currentBidderName || 'No bids yet';
        
        pickNextBtn.classList.add('hidden');
        renderAdminActivePlayer(premiumCard, aCachedPlayer, aCachedBid, aCachedTeam, session, 'running');
    } else {
        if (aCachedPlayer && !aTransientBidState) {
            const wasSold = (session.soldPlayers || []).some(s => s.playerId === aCachedPlayer.id);
            const wasUnsold = (session.unsoldPool || []).includes(aCachedPlayer.id);
            
            if (wasSold) {
                aTransientBidState = 'sold';
                const saleRecord = (session.soldPlayers || []).find(s => s.playerId === aCachedPlayer.id);
                if (saleRecord) {
                    aCachedBid = saleRecord.amount;
                    const m = state.managers.find(mg => mg.id === saleRecord.managerId);
                    aCachedTeam = m ? m.teamName : 'Team';
                }
            } else if (wasUnsold) {
                aTransientBidState = 'skipped';
            } else {
                aTransientBidState = 'idle';
            }
            
            if (aTransientBidState === 'sold' || aTransientBidState === 'skipped') {
                pickNextBtn.classList.add('hidden');
                renderAdminActivePlayer(premiumCard, aCachedPlayer, aCachedBid, aCachedTeam, session, aTransientBidState);
                aTransientTimer = setTimeout(() => {
                    aCachedPlayer = null;
                    updateAdminBidUI(); // Re-eval to show pick next button
                }, 3500);
                return;
            }
        }
        
        if (!aCachedPlayer) {
            // State where the stage is empty, ready for Admin to pick next
            document.getElementById('a-bid-player-name').textContent = 'Awaiting Next';
            document.getElementById('a-bid-player-serial').textContent = '--';
            document.getElementById('a-bid-current-amt').textContent = '৳0';
            document.getElementById('a-bid-current-team').textContent = '--';
            document.getElementById('a-countdown-num').textContent = '--';
            
            const img = document.getElementById('a-bid-player-img');
            img.style.display = 'none';
            
            premiumCard.className = 'premium-bid-card flex flex-col items-center p-6 w-full relative overflow-hidden border border-white/5';
            premiumCard.style.boxShadow = 'none';
            document.getElementById('a-bid-state-overlay').classList.add('hidden');
            
            pickNextBtn.classList.remove('hidden');
            document.getElementById('a-admin-controls').style.opacity = '0.3';
            document.getElementById('a-admin-controls').style.pointerEvents = 'none';
        }
    }
    
    // Remaining players list render
    const remaining = (session.playerPool || []).length;
    const unsold = (session.unsoldPool || []).length;
    document.getElementById('a-remaining-count').textContent = `(${remaining} left, ${unsold} unsold)`;
    
    const remainingList = document.getElementById('a-remaining-list');
    const allRemaining = [...(session.playerPool || []), ...(session.unsoldPool || [])];
    remainingList.innerHTML = allRemaining.map(pid => {
        const p = state.players.find(pl => pl.id === pid);
        const isUnsold = (session.unsoldPool || []).includes(pid);
        return p ? `<div class="flex items-center gap-3 p-2 bg-black/40 border border-white/5 rounded-xl">
            ${getAvatarUI(p, 'w-8', 'h-8', 'rounded-lg flex-shrink-0')}
            <div class="flex-1 min-w-0">
                <div class="text-[9px] font-black text-white truncate uppercase tracking-wider">${p.name}</div>
                <div class="text-[7px] text-slate-400 font-bold mt-0.5">${p.serialNumber||''}</div>
            </div>
            ${isUnsold ? '<span class="badge badge-rose">Unsold</span>' : ''}
        </div>` : '';
    }).join('');
    lucide.createIcons();
}

function renderAdminActivePlayer(cardEl, cp, bidAmt, teamName, session, stateType) {
    if(!cp) return;

    document.getElementById('a-bid-player-name').textContent = cp.name || '--';
    document.getElementById('a-bid-player-serial').textContent = cp.serialNumber || '--';
    const img = document.getElementById('a-bid-player-img');
    if (cp.avatar) { img.src = cp.avatar; img.style.display = 'block'; }
    else { img.style.display = 'none'; }

    document.getElementById('a-bid-current-amt').textContent = '৳' + (bidAmt || 0);
    document.getElementById('a-bid-current-team').textContent = teamName;

    const countdownRing = document.getElementById('a-countdown-ring');
    const countdownNum = document.getElementById('a-countdown-num');
    const overlay = document.getElementById('a-bid-state-overlay');
    const controls = document.getElementById('a-admin-controls');

    // --- NEW DYNAMIC SKIP/SELL LOGIC ---
    const skipBtn = document.getElementById('a-skip-btn');
    if (skipBtn) {
        if (session.currentBidder) {
            skipBtn.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4"></i>SELL`;
            skipBtn.className = `py-3 bg-gradient-to-t from-emerald-900/40 to-emerald-800/20 border border-emerald-500/40 text-emerald-300 text-[9px] font-black rounded-xl uppercase tracking-widest hover:bg-emerald-600/30 transition-all flex flex-col items-center justify-center gap-1 shadow-[0_4px_15px_rgba(16,185,129,0.2)]`;
        } else {
            skipBtn.innerHTML = `<i data-lucide="skip-forward" class="w-4 h-4"></i>SKIP`;
            skipBtn.className = `py-3 bg-gradient-to-t from-slate-800/60 to-slate-700/40 border border-slate-500/40 text-slate-300 text-[9px] font-black rounded-xl uppercase tracking-widest hover:bg-slate-600/50 transition-all flex flex-col items-center justify-center gap-1 shadow-[0_4px_15px_rgba(100,116,139,0.2)]`;
        }
        lucide.createIcons();
    }
    cardEl.className = 'premium-bid-card flex flex-col items-center p-6 w-full relative overflow-hidden';
    overlay.classList.add('hidden');
    controls.style.opacity = '1';
    controls.style.pointerEvents = 'auto';
const sellBtn = document.getElementById('a-sell-btn');
if (sellBtn) {
    if (session.currentBidder) {
        sellBtn.style.opacity = '1';
        sellBtn.style.pointerEvents = 'auto';
    } else {
        sellBtn.style.opacity = '0.3';
        sellBtn.style.pointerEvents = 'none';
    }
}
    if (stateType === 'sold') {
        cardEl.classList.add('bid-status-sold');
        countdownNum.textContent = '✓';
        countdownRing.classList.remove('urgent');
        countdownRing.style.borderColor = '#10b981';
        
        controls.style.opacity = '0.3';
        controls.style.pointerEvents = 'none';
        
        overlay.innerHTML = `
            <div class="absolute inset-0 bg-emerald-950/80 flex items-center justify-center backdrop-blur-md rounded-[1.2rem]">
                <div class="text-center animate-pop-in">
                    <i data-lucide="gavel" class="w-12 h-12 text-emerald-400 mx-auto mb-3"></i>
                    <span class="text-4xl font-black text-emerald-400 tracking-widest border-4 border-emerald-400 px-6 py-2 rounded-2xl bg-slate-950 block shadow-[0_0_30px_rgba(16,185,129,0.5)]">SOLD</span>
                    <p class="text-white mt-3 text-[10px] tracking-widest uppercase font-bold">To ${teamName}</p>
                </div>
            </div>`;
        overlay.classList.remove('hidden');
        lucide.createIcons();
        
    } else if (stateType === 'skipped') {
        cardEl.classList.add('bid-status-skipped');
        countdownNum.textContent = '✕';
        countdownRing.classList.remove('urgent');
        countdownRing.style.borderColor = '#f43f5e';
        
        controls.style.opacity = '0.3';
        controls.style.pointerEvents = 'none';
        
        overlay.innerHTML = `
            <div class="absolute inset-0 bg-rose-950/80 flex items-center justify-center backdrop-blur-md rounded-[1.2rem]">
                <div class="text-center animate-pop-in">
                    <i data-lucide="x-circle" class="w-12 h-12 text-rose-400 mx-auto mb-3"></i>
                    <span class="text-4xl font-black text-rose-400 tracking-widest border-4 border-rose-400 px-6 py-2 rounded-2xl bg-slate-950 block shadow-[0_0_30px_rgba(244,63,94,0.5)]">UNSOLD</span>
                    <p class="text-white mt-3 text-[10px] tracking-widest uppercase font-bold">Skipped</p>
                </div>
            </div>`;
        overlay.classList.remove('hidden');
        lucide.createIcons();
        
    } else {
        cardEl.classList.add('bid-status-running');
        countdownRing.style.borderColor = ''; 
        if(typeof updateCountdownUI === 'function') {
            updateCountdownUI('a-countdown-ring', 'a-countdown-num', session);
        }
    }
}

function renderAdminPlayers() {
    const list = document.getElementById('a-players-list');
    if (!state.players.length) { list.innerHTML = `<p class="text-[9px] text-slate-500 font-bold text-center py-8">No players registered</p>`; return; }
    list.innerHTML = state.players.map(p => `
    <div class="player-card flex items-center gap-3 p-3">
        ${getAvatarUI(p, 'w-10', 'h-10', 'rounded-xl flex-shrink-0')}
        <div class="flex-1 min-w-0">
            <div class="text-[10px] font-black text-white truncate uppercase">${p.name}</div>
            <div class="text-[7px] text-slate-500 font-bold">${p.id}</div>
            <div class="text-[8px] text-emerald-400 font-bold">${p.serialNumber || ''}</div>
        </div>
        <div class="flex flex-col items-end gap-1">
            <span class="badge ${p.paymentStatus==='approved'?'badge-emerald':p.paymentStatus==='pending'?'badge-gold':'badge-slate'}">${p.paymentStatus||'none'}</span>
            ${p.teamId ? `<span class="badge badge-blue">${getTeamName(p.teamId)}</span>` : ''}
        </div>
        <button onclick="deletePlayer('${p.id}')" class="text-slate-600 hover:text-rose-400 ml-1"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
    </div>`).join('');
    lucide.createIcons();
}

async function deletePlayer(id) {
    askConfirm('Delete this player permanently?', async () => {
        await db.collection('players').doc(id).delete();
        notify('Player deleted', 'trash-2');
    });
}

function renderAdminTeams() {
    const list = document.getElementById('a-teams-list');
    if (!state.managers.length) { list.innerHTML = `<p class="text-[9px] text-slate-500 font-bold text-center py-8">No managers registered</p>`; return; }
    list.innerHTML = state.managers.map(m => {
        const squad = state.players.filter(p => p.teamId === m.id);
        return `
        <div class="bg-slate-900/50 border border-white/5 rounded-2xl p-4">
            <div class="flex items-center gap-3 mb-3">
                ${getAvatarUI({name: m.teamName, avatar: m.logo}, 'w-12', 'h-12', 'rounded-xl flex-shrink-0')}
                <div class="flex-1 min-w-0">
                    <div class="font-black text-white uppercase truncate">${m.teamName}</div>
                    <div class="text-[8px] text-slate-400 font-bold">Owner: ${m.name}</div>
                    <div class="text-[7px] text-blue-400 font-bold">${m.id}</div>
                </div>
                <div class="text-right flex-shrink-0">
                    <span class="badge ${m.paymentStatus==='approved'?'badge-emerald':m.paymentStatus==='pending'?'badge-gold':'badge-slate'}">${m.paymentStatus||'none'}</span>
                    <div class="text-[8px] text-gold-400 font-black mt-1">৳${m.budget ?? (state.settings.teamBudget||1500)}</div>
                </div>
                <button onclick="deleteManager('${m.id}')" class="text-slate-600 hover:text-rose-400 ml-2"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            </div>
            <div class="text-[7px] text-slate-500 font-bold uppercase mb-2">Squad (${squad.length})</div>
            <div class="space-y-1">
                ${squad.length ? squad.map(p => `<div class="flex items-center gap-2 bg-black/20 rounded-lg p-2">
                    ${getAvatarUI(p, 'w-6', 'h-6', 'rounded-lg')}
                    <span class="text-[8px] font-bold text-white truncate uppercase flex-1">${p.name}</span>
                    ${p.bidPrice ? `<span class="text-[7px] text-gold-400 font-black">৳${p.bidPrice}</span>` : ''}
                    <button onclick="removePlayerFromTeam('${p.id}')" class="text-slate-600 hover:text-rose-400"><i data-lucide="x" class="w-3 h-3"></i></button>
                </div>`).join('') : '<p class="text-[7px] text-slate-600 font-bold py-1">No players</p>'}
            </div>
        </div>`;
    }).join('');
    lucide.createIcons();
}

async function deleteManager(id) {
    askConfirm('Delete this manager permanently?', async () => {
        await db.collection('managers').doc(id).delete();
        notify('Manager deleted', 'trash-2');
    });
}

async function removePlayerFromTeam(playerId) {
    askConfirm('Remove player from team?', async () => {
        await db.collection('players').doc(playerId).update({ teamId: null, bidPrice: null });
        notify('Player removed from team', 'check-circle');
    });
}

// ==================== MATCHES (ADMIN) ====================
async function generateMatches() {
    const approvedManagers = state.managers.filter(m => m.paymentStatus === 'approved');
    if (approvedManagers.length < 2) return notify('Need at least 2 teams!', 'alert-circle');
    
    const allMatchups = [];
    let matchCounter = 1;
    for (let i = 0; i < approvedManagers.length; i++) {
        for (let j = 0; j < approvedManagers.length; j++) {
            if (i !== j) {
                const t1 = approvedManagers[i];
                const t2 = approvedManagers[j];
                
                allMatchups.push({
                    matchNumber: matchCounter++,
                    team1Id: t1.id,
                    team2Id: t2.id,
                    round: `Group Stage`,
                    status: 'pending_lineup', //
                    lineup1: [],
                    lineup2: [],
                    matchups: [],
                    subbedOut1: [],
                    subbedOut2: [],
                    swapUsed1: false,
                    swapUsed2: false,
                    isTeamMatch: true
                });
            }
        }
    }
    for (let i = allMatchups.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allMatchups[i], allMatchups[j]] = [allMatchups[j], allMatchups[i]];
    }
    allMatchups.forEach((m, index) => {
        m.matchNumber = index + 1;
    });
    
    // Save to database
    const batch = db.batch();
    allMatchups.forEach(m => {
        const ref = db.collection('matches').doc();
        batch.set(ref, { ...m, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
    
    await batch.commit();
    notify(`${allMatchups.length} Team Matches generated!`, 'check-circle');
}

async function clearMatches() {
    askConfirm('Clear all matches?', async () => {
        const snap = await db.collection('matches').get();
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        notify('All matches cleared', 'trash-2');
    });
}

function renderAdminMatches() {
    const list = document.getElementById('a-matches-list');
    
    // 1. SAFETY CHECK: If the HTML container is missing, stop immediately to prevent a crash
    if (!list) return;
    
    // 2. SAFETY CHECK: Ensure state.matches exists and has items before checking length
    if (!state.matches || !state.matches.length) {
        list.innerHTML = `<p class="text-[9px] text-slate-500 font-bold text-center py-8">No matches yet. Click Draw Matches.</p>`;
        return;
    }
    
    // 3. Keep all existing features, UI, and rendering logic exactly the same
    list.innerHTML = state.matches.map(m => `
    <div class="match-card">
        <div class="p-4">
            <div class="flex items-center justify-between mb-3">
                <span class="badge ${m.status==='completed'?'badge-emerald':'badge-slate'}">${m.status}</span>
                <span class="text-[7px] text-slate-500 font-bold">${m.round||''}</span>
                ${m.status !== 'completed' ? `<button onclick="openResultModal('${m.id}')" class="px-3 py-1.5 bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 text-[8px] font-black rounded-xl uppercase">Result</button>` : ''}
            </div>
            ${renderMatchVS(m)}
        </div>
    </div>`).join('');
    
    lucide.createIcons();
}

function renderMatchVS(m) {
    const p1 = m.isTeamMatch ? state.managers.find(mg => mg.id === m.player1Id) : getPlayerById(m.player1Id);
    const p2 = m.isTeamMatch ? state.managers.find(mg => mg.id === m.player2Id) : getPlayerById(m.player2Id);
    const p1name = m.isTeamMatch ? (p1?.teamName || 'Team 1') : (p1?.name || 'TBD');
    const p2name = m.isTeamMatch ? (p2?.teamName || 'Team 2') : (p2?.name || 'TBD');
    const avatar1 = m.isTeamMatch ? {name: p1name, avatar: p1?.logo} : p1;
    const avatar2 = m.isTeamMatch ? {name: p2name, avatar: p2?.logo} : p2;

    return `<div class="flex items-center justify-between gap-3">
        <div class="flex-1 text-center">
            ${getAvatarUI(avatar1||{name:p1name}, 'w-10', 'h-10', 'rounded-xl mx-auto mb-1')}
            <div class="text-[8px] font-black text-white truncate uppercase">${p1name}</div>
        </div>
        <div class="text-center flex-shrink-0">
            ${m.status==='completed' ? `<div class="text-lg font-black text-white">${m.score1??0}-${m.score2??0}</div>` : `<div class="text-[10px] font-black text-slate-500">VS</div>`}
        </div>
        <div class="flex-1 text-center">
            ${getAvatarUI(avatar2||{name:p2name}, 'w-10', 'h-10', 'rounded-xl mx-auto mb-1')}
            <div class="text-[8px] font-black text-white truncate uppercase">${p2name}</div>
        </div>
    </div>`;
}

function openResultModal(matchId) {
    const m = state.matches.find(x => x.id === matchId);
    if (!m) return;
    const p1 = m.isTeamMatch ? state.managers.find(mg => mg.id === m.player1Id) : getPlayerById(m.player1Id);
    const p2 = m.isTeamMatch ? state.managers.find(mg => mg.id === m.player2Id) : getPlayerById(m.player2Id);
    document.getElementById('result-match-id').value = matchId;
    document.getElementById('result-t1-name').textContent = m.isTeamMatch ? (p1?.teamName||'Team 1') : (p1?.name||'P1');
    document.getElementById('result-t2-name').textContent = m.isTeamMatch ? (p2?.teamName||'Team 2') : (p2?.name||'P2');
    document.getElementById('result-s1').value = '';
    document.getElementById('result-s2').value = '';
    openModal('modal-match-result');
}

async function saveMatchResult() {
    const matchId = document.getElementById('result-match-id').value;
    const s1 = parseInt(document.getElementById('result-s1').value);
    const s2 = parseInt(document.getElementById('result-s2').value);
    if (isNaN(s1) || isNaN(s2)) return notify('Enter valid scores', 'alert-circle');

    try {
        await db.collection('matches').doc(matchId).update({ score1: s1, score2: s2, status: 'completed' });
        closeModal('modal-match-result');
        notify('Result saved!', 'check-circle');
    } catch(e) {
        notify('Save failed', 'x-circle');
    }
}

// ==================== REALTIME SUBSCRIPTIONS ====================
function subscribeAll() {
    unsubscribers.forEach(u => u());
    unsubscribers = [];

    // Players
    unsubscribers.push(db.collection('players').onSnapshot(snap => {
        state.players = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Update current user if player
        if (state.role === 'player' && state.currentUser) {
            const fresh = state.players.find(p => p.id === state.currentUser.id);
            if (fresh) state.currentUser = fresh;
        }
        refreshCurrentView();
    }));

    // Managers
    unsubscribers.push(db.collection('managers').onSnapshot(snap => {
        state.managers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (state.role === 'manager' && state.currentUser) {
            const fresh = state.managers.find(m => m.id === state.currentUser.id);
            if (fresh) state.currentUser = fresh;
        }
        refreshCurrentView();
    }));

    // Settings
    unsubscribers.push(db.collection('settings').doc('tournament').onSnapshot(snap => {
        if (snap.exists) state.settings = { ...state.settings, ...snap.data() };
        refreshCurrentView();
    }));

    // Bid Session
    unsubscribers.push(db.collection('bidSession').doc('current').onSnapshot(snap => {
        if (snap.exists) {
            const prevPhase = state.bidSession?.phase;
            const prevBidder = state.bidSession?.currentBidder;
            state.bidSession = snap.data();
            // If admin and new bid came in, restart countdown
            if (state.role === 'admin' && state.bidSession.status === 'active' && state.bidSession.currentPlayer) {
                if (state.bidSession.currentBidder !== prevBidder && !state.bidSession.held) {
                    clearBidCountdown();
                    startAdminCountdown();
                }
            }
        } else {
            state.bidSession = null;
        }
        onBidSessionUpdate();
    }));

    // Matches
    unsubscribers.push(db.collection('matches').orderBy('createdAt', 'asc').onSnapshot(snap => {
        state.matches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        refreshCurrentView();
    }));
}

function onBidSessionUpdate() {
    if (state.role === 'player') {
        updatePlayerBidUI();
    } else if (state.role === 'manager') {
        renderManagerBidArea();
    } else if (state.role === 'admin') {
        updateAdminBidUI();
    }
}

function refreshCurrentView() {
    if (state.role === 'player') {
        if (state.currentUser) {
            const pIdEl = document.getElementById('p-header-id');
            if (pIdEl) pIdEl.textContent = state.currentUser.id;
            const pNameEl = document.getElementById('p-header-name');
            if (pNameEl) pNameEl.textContent = state.currentUser.name;
        }
        renderPlayerHome();
    } else if (state.role === 'manager') {
        renderManagerDashboard();
    } else if (state.role === 'admin') {
        renderAdminOverview();
        
        const paymentsTab = document.getElementById('a-tab-payments');
        if (paymentsTab && !paymentsTab.classList.contains('hidden')) renderAdminPayments();
        
        const playersTab = document.getElementById('a-tab-players');
        if (playersTab && !playersTab.classList.contains('hidden')) renderAdminPlayers();
        
        const teamsTab = document.getElementById('a-tab-teams');
        if (teamsTab && !teamsTab.classList.contains('hidden')) renderAdminTeams();
        
        const matchesTab = document.getElementById('a-tab-matches');
        if (matchesTab && !matchesTab.classList.contains('hidden')) renderAdminMatches();
        
        const biddingTab = document.getElementById('a-tab-bidding');
        if (biddingTab && !biddingTab.classList.contains('hidden')) updateAdminBidUI();
        
        // Safely updates Info tab in Admin panel without crashing
        const infoTab = document.getElementById('a-tab-info');
        if (infoTab && !infoTab.classList.contains('hidden')) {
            const searchInput = document.getElementById('a-info-search');
            renderInfoTab('a-info-container', searchInput ? searchInput.value : '');
        }
    }
}

// ==================== HELPERS ====================
function getPlayerById(id) { return state.players.find(p => p.id === id) || null; }
function getTeamName(managerId) { const m = state.managers.find(mg => mg.id === managerId); return m ? m.teamName : managerId; }

// Bid history rendering
function renderBidHistory() {
    const session = state.bidSession;
    const histEl = document.getElementById('p-bid-history');
    if (!histEl || !session) return;
    const sold = session.soldPlayers || [];
    if (!sold.length) { histEl.innerHTML = `<p class="text-[9px] text-slate-500 font-bold text-center py-6">No players sold yet</p>`; return; }
    
    histEl.innerHTML = [...sold].reverse().slice(0, 10).map(s => {
        const p = state.players.find(pl => pl.id === s.playerId);
        const m = state.managers.find(mg => mg.id === s.managerId);
        return `
        <div class="flex items-center gap-3 p-3 bg-slate-950/60 border border-white/5 rounded-2xl hover:bg-slate-900/90 transition-all shadow-sm">
            ${getAvatarUI(p, 'w-10', 'h-10', 'rounded-xl shadow-[0_0_10px_rgba(16,185,129,0.2)] flex-shrink-0 border border-emerald-500/20')}
            <div class="flex-1 min-w-0">
                <div class="text-[10px] font-black text-white truncate uppercase tracking-wide">${p?.name||'Player'}</div>
                <div class="text-[8px] text-slate-400 font-bold flex items-center gap-1.5 mt-0.5">
                    <i data-lucide="arrow-right-circle" class="w-3 h-3 text-emerald-500"></i> <span class="truncate">${m?.teamName||'Team'}</span>
                </div>
            </div>
            <div class="text-right">
                <div class="text-[7px] text-slate-500 font-bold uppercase tracking-widest mb-0.5">Sold For</div>
                <span class="text-[12px] font-black text-gold-400 drop-shadow-[0_0_5px_rgba(245,158,11,0.5)]">৳${s.amount}</span>
            </div>
        </div>`;
    }).join('');
    lucide.createIcons();
}

// Listen to bid session for history
setInterval(() => {
    if (state.role === 'player' && state.bidSession) renderBidHistory();
}, 2000);

// ==================== INFO TAB & EDIT PROFILE ====================
// ==================== INFO TAB & EDIT PROFILE ====================

// Interactive function to open/close teams and players smoothly
function toggleAccordion(id) {
    const content = document.getElementById(id);
    const icon = document.getElementById(`icon-${id}`);
    if (!content) return;
    
    if (content.classList.contains('expanded')) {
        content.classList.remove('expanded');
        if (icon) {
            icon.setAttribute('data-lucide', 'chevron-down');
            lucide.createIcons();
        }
    } else {
        content.classList.add('expanded');
        if (icon) {
            icon.setAttribute('data-lucide', 'chevron-up');
            lucide.createIcons();
        }
    }
}

function renderInfoTab(containerId, searchQuery = '') {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const q = searchQuery.toLowerCase();
    let players = state.players.filter(p => p.paymentStatus === 'approved');
    const managers = state.managers.filter(m => m.paymentStatus === 'approved');
    
    let html = '';
    
    // --- 1. FRANCHISE TEAMS SECTION ---
    if (managers.length > 0) {
        html += `<h3 class="text-[11px] font-black text-white uppercase tracking-widest mb-3 flex items-center gap-2 mt-2">
            <i data-lucide="shield" class="w-4 h-4 text-gold-400"></i> Franchise Teams
        </h3>
        <div class="space-y-3 mb-6">`;
        
        managers.forEach(m => {
            const teamPlayers = players.filter(p => p.teamId === m.id);
            
            // Search Filtering Logic
            const teamMatches = m.teamName.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
            const matchingPlayers = teamPlayers.filter(p =>
                (p.name || '').toLowerCase().includes(q) ||
                (p.konamiId || '').toLowerCase().includes(q) ||
                (p.deviceName || '').toLowerCase().includes(q)
            );
            
            if (q !== '' && !teamMatches && matchingPlayers.length === 0) return; // Hide if no match
            const isExpanded = q !== '' && matchingPlayers.length > 0; // Auto-expand if searched
            const accId = `acc-team-${m.id}`;
            
            html += `
            <div class="bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden shadow-lg transition-all">
                <!-- Clickable Team Header -->
                <div class="p-3 flex items-center gap-3 cursor-pointer hover:bg-white/5 transition-colors" onclick="toggleAccordion('${accId}')">
                    ${getAvatarUI({name: m.teamName, avatar: m.logo}, 'w-12', 'h-12', 'rounded-xl border border-gold-500/30 shadow-[0_0_10px_rgba(245,158,11,0.2)] flex-shrink-0 bg-slate-800 object-contain')}
                    <div class="flex-1 min-w-0">
                        <div class="text-[12px] font-black text-white truncate uppercase tracking-wider">${m.teamName}</div>
                        <div class="flex items-center gap-1.5 mt-1">
                            ${getAvatarUI({name: m.name}, 'w-4', 'h-4', 'rounded-full flex-shrink-0')}
                            <span class="text-[9px] text-slate-400 font-bold truncate">Owner: <span class="text-gold-400">${m.name}</span></span>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0">
                        <div class="bg-black/40 px-2 py-1 rounded-lg border border-white/5 text-[9px] font-black text-slate-300">
                            <i data-lucide="users" class="w-3 h-3 inline mb-0.5"></i> ${teamPlayers.length}
                        </div>
                        <div class="flex items-center justify-center w-6 h-6 bg-slate-800/50 rounded-full border border-white/5">
                            <i data-lucide="${isExpanded ? 'chevron-up' : 'chevron-down'}" id="icon-${accId}" class="w-3 h-3 text-slate-400 transition-transform"></i>
                        </div>
                    </div>
                </div>
                
                <!-- Expanding Team Squad Content -->
                <div id="${accId}" class="accordion-content ${isExpanded ? 'expanded' : ''}">
                    <div class="accordion-inner">
                        <div class="p-3 pt-0 border-t border-white/5 bg-black/40">
                            ${teamPlayers.length ? `<div class="grid grid-cols-1 gap-2 mt-3">${teamPlayers.map(p => playerInfoCard(p, true, q !== '')).join('')}</div>` : `<p class="text-[9px] text-slate-500 font-bold italic mt-3 text-center py-3 bg-black/20 rounded-xl">No players drafted yet</p>`}
                        </div>
                    </div>
                </div>
            </div>`;
        });
        html += `</div>`;
    }
    
    // --- 2. FREE AGENTS / ALL PLAYERS SECTION ---
    const unassigned = players.filter(p => !p.teamId);
    const filteredUnassigned = q === '' ? unassigned : unassigned.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.konamiId || '').toLowerCase().includes(q) ||
        (p.deviceName || '').toLowerCase().includes(q)
    );
    
    if (filteredUnassigned.length > 0) {
        html += `<h3 class="text-[11px] font-black text-white uppercase tracking-widest mb-3 flex items-center gap-2">
            <i data-lucide="user-minus" class="w-4 h-4 text-emerald-400"></i> Free Agents
        </h3>
        <div class="space-y-2 mb-6">
            ${filteredUnassigned.map(p => playerInfoCard(p, false, q !== '')).join('')}
        </div>`;
    }
    
    // Fallback if empty
    if (html === '') {
        html = `<div class="text-center py-10"><i data-lucide="search-x" class="w-8 h-8 text-slate-600 mx-auto mb-2"></i><p class="text-[10px] uppercase font-bold text-slate-500">No matching records found</p></div>`;
    }
    
    container.innerHTML = html;
    lucide.createIcons();
}

function playerInfoCard(p, isTeam = false, forceExpand = false) {
    let editedTxt = p.lastEditAt ? `<div class="mt-2 text-[7px] text-rose-400 font-bold flex items-center justify-center gap-1 bg-rose-500/5 py-1.5 rounded-lg border border-rose-500/10"><i data-lucide="history" class="w-2.5 h-2.5"></i> Profile Edited: ${p.lastEditAt.toDate ? p.lastEditAt.toDate().toLocaleString() : 'Recently'}</div>` : '';
    
    const accId = `acc-player-${p.id}`;
    const isExpanded = forceExpand; // Auto expand if they were found via search
    
    return `
    <div class="bg-black/60 border border-white/5 rounded-xl overflow-hidden hover:border-white/10 transition-colors shadow-inner">
        <!-- Clickable Player Header -->
        <div class="p-2.5 flex items-center gap-3 cursor-pointer" onclick="toggleAccordion('${accId}')">
            ${getAvatarUI(p, 'w-10', 'h-10', 'rounded-lg flex-shrink-0 shadow-[0_0_10px_rgba(0,0,0,0.5)]')}
            <div class="flex-1 min-w-0">
                <div class="text-[11px] font-black text-white truncate uppercase tracking-wider flex items-center gap-1.5">
                    ${p.name}
                    ${isTeam && p.isManager ? '<span class="text-[6px] font-black uppercase text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">MGR</span>' : ''}
                </div>
                <div class="text-[8px] text-emerald-400 font-bold mt-0.5">${p.serialNumber || 'Pending Serial'}</div>
            </div>
            <div class="flex items-center justify-center w-5 h-5 bg-slate-800/50 rounded-full border border-white/5 flex-shrink-0">
                <i data-lucide="${isExpanded ? 'chevron-up' : 'chevron-down'}" id="icon-${accId}" class="w-3 h-3 text-slate-400 transition-transform"></i>
            </div>
        </div>
        
        <!-- Expanding Player Info Content -->
        <div id="${accId}" class="accordion-content ${isExpanded ? 'expanded' : ''}">
            <div class="accordion-inner">
                <div class="p-2.5 pt-0">
                    <div class="grid grid-cols-2 gap-2 bg-slate-950 p-2.5 rounded-lg border border-white/5 shadow-inner relative overflow-hidden mt-1">
                        <!-- Subtle Background Glow inside the card -->
                        <div class="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-blue-500/5 pointer-events-none"></div>
                        
                        <div class="relative z-10">
                            <span class="text-[7px] text-slate-500 font-bold uppercase tracking-widest block mb-0.5 flex items-center gap-1">
                                <i data-lucide="gamepad-2" class="w-2.5 h-2.5 text-emerald-500"></i> Konami ID
                            </span> 
                            <span class="text-[10px] font-black text-emerald-400 tracking-wider break-all">${p.konamiId || '<span class="text-slate-700">N/A</span>'}</span>
                        </div>
                        <div class="relative z-10">
                            <span class="text-[7px] text-slate-500 font-bold uppercase tracking-widest block mb-0.5 flex items-center gap-1">
                                <i data-lucide="smartphone" class="w-2.5 h-2.5 text-blue-500"></i> Device Name
                            </span> 
                            <span class="text-[10px] font-black text-blue-400 tracking-wider break-all">${p.deviceName || '<span class="text-slate-700">N/A</span>'}</span>
                        </div>
                    </div>
                    ${editedTxt}
                </div>
            </div>
        </div>
    </div>`;
}

function openEditProfileModal() {
    const u = state.currentUser;
    let p;
    // Managers edit their linked Player profile object
    if (state.role === 'manager') {
        p = state.players.find(x => x.id === u.managerPlayerId);
    } else {
        p = state.players.find(x => x.id === u.id);
    }
    if (!p) return notify('Profile not found', 'x-circle');
    
    document.getElementById('edit-name').value = p.name || '';
    document.getElementById('edit-phone').value = p.phone || '';
    document.getElementById('edit-konami').value = p.konamiId || '';
    document.getElementById('edit-device').value = p.deviceName || '';
    document.getElementById('edit-fb').value = p.fb || '';
    document.getElementById('edit-avatar').value = p.avatar || '';
    
    openModal('modal-edit-profile');
}

async function saveProfileEdit() {
    const btn = window.event ? window.event.target.closest('button') : null;
    
    // নতুন ইনপুট ফিল্ড থেকে ডেটা সংগ্রহ
    const name = document.getElementById('edit-name').value.trim();
    const phone = document.getElementById('edit-phone').value.trim();
    const konamiId = document.getElementById('edit-konami').value.trim();
    const deviceName = document.getElementById('edit-device').value.trim();
    const fb = document.getElementById('edit-fb').value.trim();
    const avatar = document.getElementById('edit-avatar').value.trim();
    
    // নাম, ফোন, কোনামি এবং ডিভাইস বাধ্যতামূলক রাখা হয়েছে
    if (!name || !phone || !konamiId || !deviceName) {
        return notify('Name, Phone, Konami & Device are required!', 'alert-circle');
    }
    
    const u = state.currentUser;
    const playerId = state.role === 'manager' ? u.managerPlayerId : u.id;
    
    toggleBtnLoading(true, btn);
    try {
        // ফায়ারবেস ডেটাবেসে প্লেয়ারের প্রোফাইল আপডেট
        await db.collection('players').doc(playerId).update({
            name: name,
            phone: phone,
            konamiId: konamiId,
            deviceName: deviceName,
            fb: fb,
            avatar: avatar,
            lastEditAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        // যদি ম্যানেজার তার প্রোফাইল এডিট করে, তবে ম্যানেজারের ডকুমেন্টেও তার নাম আপডেট করে দেওয়া হবে
        if (state.role === 'manager') {
            await db.collection('managers').doc(u.id).update({
                name: name
            });
        }
        
        closeModal('modal-edit-profile');
        notify('Profile updated successfully!', 'check-circle');
    } catch (e) {
        notify('Update failed. Try again.', 'x-circle');
    } finally {
        toggleBtnLoading(false, btn);
    }
}
lucide.createIcons();

// ==================== DRAFT REPORT ====================
function openDraftReport() {
    const container = document.getElementById('draft-report-content');
    
    // Sort players by highest bid price
    const draftedPlayers = state.players.filter(p => p.teamId && p.bidPrice).sort((a, b) => b.bidPrice - a.bidPrice);
    
    if (!draftedPlayers.length) {
        notify('No players have been drafted yet!', 'alert-circle');
        return;
    }
    
    const rows = draftedPlayers.map((p, index) => {
        const teamName = getTeamName(p.teamId);
        
        // Format Date/Time cleanly
        const timeStr = p.draftedAt && p.draftedAt.toDate ?
            p.draftedAt.toDate().toLocaleString('en-US', { timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) :
            'Time Unavailable';
        
        return `
        <div class="flex items-center gap-3 p-3.5 border-b border-white/5 bg-slate-950/40 hover:bg-slate-900 transition-colors">
            <div class="w-6 text-[10px] font-black text-slate-500 text-center">${index + 1}</div>
            
            <div class="flex-1 min-w-0">
                <div class="text-[12px] font-black text-white uppercase tracking-wider truncate">${p.name}</div>
                <div class="text-[8px] text-emerald-400 font-bold tracking-widest mt-0.5">${p.serialNumber || '--'}</div>
            </div>
            
            <div class="flex-1 min-w-0 border-l border-white/10 pl-3">
                <div class="text-[6px] text-slate-500 font-bold uppercase tracking-widest mb-0.5">Drafted By</div>
                <div class="text-[10px] font-black text-blue-400 uppercase tracking-widest truncate">${teamName}</div>
            </div>
            
            <div class="flex-shrink-0 text-right w-16">
                <div class="text-[13px] font-black text-gold-400 tracking-wider">৳${p.bidPrice}</div>
            </div>
            
            <div class="w-24 border-l border-white/10 pl-3 text-right">
                <div class="text-[7px] font-bold text-slate-500 uppercase tracking-widest leading-tight">${timeStr.replace(', ', '<br>')}</div>
            </div>
        </div>`;
    }).join('');
    
    const totalSpent = draftedPlayers.reduce((sum, p) => sum + p.bidPrice, 0);
    
    container.innerHTML = `
    <div class="bg-slate-900/80 border border-white/10 rounded-[1.5rem] overflow-hidden shadow-2xl backdrop-blur-xl mb-8">
        <!-- Report Header -->
        <div class="bg-gradient-to-r from-blue-900/40 via-emerald-900/40 to-gold-900/40 p-6 sm:p-8 border-b border-white/10 text-center relative overflow-hidden">
            <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.05)_0%,transparent_70%)] pointer-events-none"></div>
            
            <i data-lucide="clipboard-list" class="w-10 h-10 text-white mx-auto mb-3 relative z-10 opacity-90 drop-shadow-md"></i>
            <h1 class="text-xl sm:text-2xl font-black text-white uppercase tracking-[0.2em] relative z-10 leading-tight">Auction Result List</h1>
            <p class="text-[9px] text-slate-400 font-bold tracking-widest mt-2 relative z-10">
                Generated: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true })}
            </p>
        </div>
        
        <!-- Summary Stats -->
        <div class="flex items-center justify-between p-4 bg-black/60 border-b border-white/5">
            <div>
                <span class="text-[7px] text-slate-500 font-bold uppercase tracking-widest block mb-0.5">Total Sold</span>
                <span class="text-[12px] font-black text-white">${draftedPlayers.length} Players</span>
            </div>
            <div class="text-right">
                <span class="text-[7px] text-slate-500 font-bold uppercase tracking-widest block mb-0.5">Total Economy</span>
                <span class="text-[12px] font-black text-gold-400">৳${totalSpent}</span>
            </div>
        </div>

        <!-- The List -->
        <div class="flex flex-col">
            ${rows}
        </div>
        
        <!-- Footer -->
        <div class="p-4 bg-slate-950 text-center">
            <p class="text-[7px] font-black text-slate-600 uppercase tracking-[0.3em]">End of Report</p>
        </div>
    </div>`;
    
    openModal('modal-draft-report');
    lucide.createIcons();
}

function renderPlayerStats(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // ১. সম্পন্ন হওয়া ম্যাচ থেকে অটোমেটিক পয়েন্ট হিসেব করা হচ্ছে
    const stats = {};
    state.players.forEach(p => {
        // assists এর বদলে matchWins ট্র্যাক করছি
        stats[p.id] = { goals: 0, matchWins: 0, mvps: 0, playerObj: p };
    });
    
    const completedMatches = state.matches.filter(m => m.status === 'completed');
    completedMatches.forEach(m => {
        if (m.mvpId && stats[m.mvpId]) stats[m.mvpId].mvps += 1;
        
        (m.matchups || []).forEach(mu => {
            // গোল হিসেব
            if (mu.p1Id && stats[mu.p1Id]) stats[mu.p1Id].goals += (mu.score1 || 0);
            if (mu.p2Id && stats[mu.p2Id]) stats[mu.p2Id].goals += (mu.score2 || 0);
            
            // একক ম্যাচ জয় (1v1 Wins) হিসেব
            if (mu.score1 > mu.score2) {
                if (mu.p1Id && stats[mu.p1Id]) stats[mu.p1Id].matchWins += 1;
            } else if (mu.score2 > mu.score1) {
                if (mu.p2Id && stats[mu.p2Id]) stats[mu.p2Id].matchWins += 1;
            }
        });
    });
    
    const playersArr = Object.values(stats);
    
    // সর্বোচ্চ গোল, ম্যাচ জয় এবং MVP আলাদা করে সাজানো হচ্ছে (Top 10)
    const topScorers = [...playersArr].filter(p => p.goals > 0).sort((a, b) => b.goals - a.goals).slice(0, 10);
    const topWins = [...playersArr].filter(p => p.matchWins > 0).sort((a, b) => b.matchWins - a.matchWins).slice(0, 10);
    const topMvps = [...playersArr].filter(p => p.mvps > 0).sort((a, b) => b.mvps - a.mvps).slice(0, 10);
    
    let html = ``;
    
    // কার্ড বানানোর হেল্পার ফাংশন
    const generateList = (list, type, colorClass, valueKey) => {
        if (list.length === 0) return `<p class="text-[9px] text-slate-500 font-bold italic py-6 text-center bg-slate-900/30 rounded-2xl border border-white/5 border-dashed">No stats available yet</p>`;
        
        return list.map((p, i) => {
            const rankColor = i === 0 ? 'text-gold-400 drop-shadow-[0_0_5px_rgba(245,158,11,0.5)]' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-600' : 'text-slate-500';
            const teamName = getTeamName(p.playerObj.teamId) || 'Free Agent';
            return `
            <div class="flex items-center gap-3 p-3 bg-slate-900/60 border border-white/5 rounded-[1.2rem] mb-2 hover:bg-slate-800 transition-colors shadow-sm">
                <div class="w-5 text-[14px] font-black ${rankColor} text-center">${i+1}</div>
                ${getAvatarUI(p.playerObj, 'w-10', 'h-10', 'rounded-xl border border-white/10 shadow-md object-cover')}
                <div class="flex-1 min-w-0">
                    <div class="text-[11px] font-black text-white uppercase truncate tracking-wider">${p.playerObj.name}</div>
                    <div class="text-[7px] text-slate-400 font-bold uppercase truncate mt-0.5 flex items-center gap-1"><i data-lucide="shield" class="w-2.5 h-2.5"></i> ${teamName}</div>
                </div>
                <div class="flex flex-col items-center justify-center bg-black/50 min-w-[45px] py-1.5 rounded-lg border border-white/5 shadow-inner">
                    <span class="text-[16px] font-black ${colorClass} leading-none">${p[valueKey]}</span>
                    <span class="text-[6px] text-slate-500 font-black uppercase tracking-[0.2em] mt-1">${type}</span>
                </div>
            </div>`;
        }).join('');
    };
    
    // ৩টি ক্যাটাগরির HTML লেআউট
    html += `
    <div class="mb-6">
        <h3 class="text-[11px] font-black text-emerald-400 uppercase tracking-widest mb-3 flex items-center gap-2"><i data-lucide="goal" class="w-4 h-4"></i> Golden Boot (Goals)</h3>
        ${generateList(topScorers, 'Goals', 'text-emerald-400', 'goals')}
    </div>
    <div class="mb-6">
        <h3 class="text-[11px] font-black text-blue-400 uppercase tracking-widest mb-3 flex items-center gap-2"><i data-lucide="swords" class="w-4 h-4"></i> Match Winners (1v1 Wins)</h3>
        ${generateList(topWins, 'Wins', 'text-blue-400', 'matchWins')}
    </div>
    <div class="mb-2">
        <h3 class="text-[11px] font-black text-gold-400 uppercase tracking-widest mb-3 flex items-center gap-2"><i data-lucide="star" class="w-4 h-4"></i> Most Valuable Player</h3>
        ${generateList(topMvps, 'MVPs', 'text-gold-400', 'mvps')}
    </div>`;
    
    container.innerHTML = html;
    lucide.createIcons();
}

// টগল বাটন কন্ট্রোল করার ফাংশন
function toggleView(tabPrefix, view) {
    const isPlayer = tabPrefix === 'p';
    const mainThemeColor = isPlayer ? 'bg-emerald-600' : 'bg-blue-600';
    
    document.getElementById(`${tabPrefix}-view-standings`).classList.toggle('hidden', view === 'stats');
    document.getElementById(`${tabPrefix}-view-stats`).classList.toggle('hidden', view === 'standings');
    
    const stdBtn = document.getElementById(`btn-toggle-${tabPrefix}-std`);
    const staBtn = document.getElementById(`btn-toggle-${tabPrefix}-sta`);
    
    stdBtn.className = view === 'standings' ? `flex-1 py-2.5 text-[10px] font-black uppercase rounded-lg ${mainThemeColor} text-white transition-all tracking-widest` : `flex-1 py-2.5 text-[10px] font-black uppercase rounded-lg text-slate-500 hover:text-white transition-all tracking-widest`;
    
    staBtn.className = view === 'stats' ? `flex-1 py-2.5 text-[10px] font-black uppercase rounded-lg ${mainThemeColor} text-white transition-all tracking-widest` : `flex-1 py-2.5 text-[10px] font-black uppercase rounded-lg text-slate-500 hover:text-white transition-all tracking-widest`;
    
    if (view === 'stats') renderPlayerStats(`${tabPrefix}-stats-container`);
}