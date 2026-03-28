const CURRENT_APP_VERSION = "1.0.0"; // যখন আপডেট করবেন, এই সংখ্যাটি পরিবর্তন করবেন

function checkAppVersion() {
    const savedVersion = localStorage.getItem('slc_app_version');
    
    if (savedVersion !== CURRENT_APP_VERSION) {
        // নতুন ভার্সন পাওয়া গেছে
        console.log(`Updating App: ${savedVersion} -> ${CURRENT_APP_VERSION}`);
        
        // নতুন ভার্সন সেভ করা হচ্ছে
        localStorage.setItem('slc_app_version', CURRENT_APP_VERSION);
        
        // ফোর্স রিলোড (ক্যাশ ক্লিয়ার সহ)
        if (savedVersion) { // প্রথমবার লোড হলে রিলোড হবে না, শুধুমাত্র আপডেট হলে হবে
            window.location.reload(true);
        }
    }
}
checkAppVersion();


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
const PLAYER_FEE = 30;
const MANAGER_FEE = 100;
const PAYMENT_NUMBER = "01830038179";

// ==================== STATE ====================
let state = {
    role: null, // 'player' | 'manager' | 'admin'
    currentUser: null,
    players: [],
    managers: [],
    settings: { maxPlayers: 6, playersPerMatch: 6, teamBudget: 1500, baseBid: 50, isBiddingOpen: true },
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
// ==================== SOUND & HAPTICS ENGINE ====================
const SFX = {
    enabled: true,
    sounds: {
        // ফ্রি এবং কপিরাইট-ফ্রি সাউন্ড লিংক ব্যবহার করা হয়েছে
        click: new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3'),
        bid: new Audio('https://assets.mixkit.co/active_storage/sfx/2003/2003-preview.mp3'), // কয়েন/বিড সাউন্ড
        sold: new Audio('https://assets.mixkit.co/active_storage/sfx/464/464-preview.mp3'), // হাতুড়ির (Gavel) সাউন্ড
        error: new Audio('https://assets.mixkit.co/active_storage/sfx/2954/2954-preview.mp3'), // এরর বাজার
        success: new Audio('https://assets.mixkit.co/active_storage/sfx/1085/1085-preview.mp3') // সাকসেস নোটিফিকেশন
    },
    play: function(type) {
        if (!this.enabled) return;
        try {
            const audio = this.sounds[type].cloneNode(); // ওভারল্যাপিং সাউন্ড প্লে করার জন্য
            audio.volume = (type === 'click') ? 0.2 : 0.8;
            audio.play().catch(e => console.log('Audio blocked by browser. User interaction needed.'));
        } catch (e) {}
    },
    vibrate: function(pattern) {
        if (!this.enabled) return;
        if (navigator.vibrate) {
            try { navigator.vibrate(pattern); } catch (e) {}
        }
    },
    toggle: function() {
        this.enabled = !this.enabled;
        const iconEl = document.getElementById('sfx-icon');
        if (iconEl) {
            iconEl.setAttribute('data-lucide', this.enabled ? 'volume-2' : 'volume-x');
            iconEl.className = this.enabled ? 'w-4 h-4 text-emerald-400' : 'w-4 h-4 text-rose-400';
            lucide.createIcons();
        }
        notify(this.enabled ? 'Sound & Haptics Enabled' : 'Sound & Haptics Muted', this.enabled ? 'volume-2' : 'volume-x');
    }
};
// ==================== KONAMI ID VALIDATION ====================
function cleanKonamiId(idStr) {
    // শুধু নাম্বার (0-9) রেখে বাকি সব (অক্ষর, হাইফেন, স্পেস) রিমুভ করে দিবে
    return (idStr || '').replace(/\D/g, '');
}

async function checkDuplicateKonami(newKonami, excludePlayerId = null) {
    const numericKonami = cleanKonamiId(newKonami);
    
    if (numericKonami.length < 9) {
        return { error: 'Invalid Konami ID! Minimum 9 digits required.' };
    }
    
    try {
        const snap = await db.collection('players').get();
        for (let doc of snap.docs) {
            const p = doc.data();
            // এডিট করার সময় নিজের আইডি স্কিপ করবে
            if (excludePlayerId && p.id === excludePlayerId) continue;
            
            if (cleanKonamiId(p.konamiId) === numericKonami) {
                return { error: `This Konami ID is already registered by ${p.name}!` };
            }
        }
        return { error: null };
    } catch (e) {
        return { error: 'Failed to verify Konami ID. Try again.' };
    }
}
// =============================================================
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

    // --- Sound & Haptic Logic ---
    if (icon === 'x-circle' || icon === 'alert-circle' || icon === 'x' || icon === 'shield-x' || icon === 'lock') {
        SFX.play('error');
        SFX.vibrate([50, 50, 50]); // এররের জন্য কাঁপুনি
    } else if (icon === 'check-circle' || icon === 'zap') {
        SFX.play('success');
        SFX.vibrate([100, 50, 100]); // সাকসেসের জন্য কাঁপুনি
    } else if (icon !== 'volume-2' && icon !== 'volume-x') {
        SFX.play('click');
        SFX.vibrate(30); // সাধারণ নোটিফিকেশনের জন্য হালকা কাঁপুনি
    }
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
    // Check Registration Deadline
    if (state.settings && state.settings.registrationDeadline) {
        if (new Date().getTime() > state.settings.registrationDeadline) {
            return notify('Registration is permanently closed! Deadline has passed.', 'lock');
        }
    }
   const name = document.getElementById('p-name').value.trim();
    const fb = document.getElementById('p-fb').value.trim();
    const phone = document.getElementById('p-phone').value.trim();
    const avatar = document.getElementById('p-avatar').value.trim();
    const konamiId = document.getElementById('p-konami').value.trim();
    const deviceName = document.getElementById('p-device').value.trim();
    
if (!name || !phone || !konamiId || !deviceName) return notify('Name, Phone, Konami ID & Device required!', 'alert-circle');

toggleBtnLoading(true, btn);
const konamiCheck = await checkDuplicateKonami(konamiId);
if (konamiCheck.error) {
    toggleBtnLoading(false, btn);
    return notify(konamiCheck.error, 'alert-circle');
}

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
    // Check Registration Deadline
if (state.settings && state.settings.registrationDeadline) {
    if (new Date().getTime() > state.settings.registrationDeadline) {
        return notify('Registration is permanently closed! Deadline has passed.', 'lock');
    }
}
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
    const konamiCheck = await checkDuplicateKonami(konamiId);
    if (konamiCheck.error) {
        toggleBtnLoading(false, btn);
        return notify(konamiCheck.error, 'alert-circle');
    }

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
        state = { role: null, currentUser: null, players: [], managers: [], settings: { maxPlayers: 6, playersPerMatch: 6, teamBudget: 1500, baseBid: 50, isBiddingOpen: true }, bidSession: null, currentBidPlayer: null, bidCountdown: null, bidHeld: false, remainingPlayers: [], unsoldPlayers: [], soldPlayers: [], matches: [], swapMatchId: null };
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
    applyBiddingVisibility();
    lucide.createIcons();
}

function switchPTab(tab) {
    SFX.play('click');
SFX.vibrate(15);
    const tabs =['home', 'bid', 'teams', 'schedule','profile', 'info', 'rules'];
    
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
            case 'rules':
            renderRulesTab('p-tab-rules');
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
<div class="text-[10px] font-black text-white truncate uppercase tracking-wider flex items-center gap-1">${p.name} ${getDisciplineBadge(p)}</div>
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
<div class="text-[11px] font-black text-white truncate uppercase tracking-wider flex items-center gap-1">${p.name} ${getDisciplineBadge(p)}</div>
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
    renderStandings('p-standings-table');
    
    const list = document.getElementById('p-schedule-list');
    const publicMatches = state.matches.filter(m => m.isPublic);
    
    if (!publicMatches.length) {
        list.innerHTML = `<p class="text-[9px] text-slate-500 font-bold text-center py-8">No live matches available right now</p>`;
        return;
    }
    // Fixed: calling the correct function 'renderTeamMatchCard'
    list.innerHTML = publicMatches.map(m => renderTeamMatchCard(m, 'player')).join('');
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
${u.lastEditAt ? `<div class="text-[7px] text-rose-400 font-bold mt-1.5"><i data-lucide="clock" class="w-2.5 h-2.5 inline pb-0.5"></i> Last Edit: ${u.lastEditAt.toDate ? u.lastEditAt.toDate().toLocaleString() : 'Recently'} ${u.lastEditDetails ? '<br>| ' + u.lastEditDetails : ''}</div>` : ''}
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
        ${generatePlayerProfileStatsHtml(u.id)}
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
    applyBiddingVisibility();
    lucide.createIcons();
}

function switchMTab(tab) {
    SFX.play('click');
SFX.vibrate(15);
['dashboard','squad','matches','standings','profile','info','rules'].forEach(t => {
        document.getElementById(`m-tab-${t}`).classList.toggle('hidden', t !== tab);
        const btn = document.getElementById(`mnav-${t}`);
        if (btn) btn.classList.toggle('active', t === tab);
    });
    if (tab === 'dashboard') renderManagerDashboard();
    if (tab === 'squad') renderManagerSquad();
    if (tab === 'matches') renderManagerMatches();
    if (tab === 'standings') renderStandings('m-standings-table');
    if (tab === 'profile') renderManagerProfile();
    if (tab === 'rules') renderRulesTab('m-tab-rules');
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
    if (!state.settings.isBiddingOpen || !state.bidSession || state.bidSession.status !== 'active') {
        bidArea.classList.add('hidden');
        return;
    }
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
            <div class="text-[11px] font-black text-white truncate uppercase tracking-wider flex items-center justify-center gap-1">${p.name} ${getDisciplineBadge(p)}</div>
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
<div class="text-[11px] font-black text-white truncate uppercase tracking-widest flex items-center gap-1">${p.name} ${getDisciplineBadge(p)}</div>
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
    
    // শুধু ম্যানেজারের নিজের টিমের ম্যাচগুলো এবং যেগুলো পাবলিক করা হয়েছে
    const myMatches = state.matches.filter(m => (m.team1Id === u.id || m.team2Id === u.id) && m.isPublic);
    
    if (!myMatches.length) {
        list.innerHTML = `<p class="text-[9px] text-slate-500 font-bold text-center py-8">Matches are hidden until admin sets them LIVE</p>`;
        return;
    }
    
    // ভুল renderMatchCard-এর বদলে সঠিক ফাংশন renderTeamMatchCard ব্যবহার করা হয়েছে
    list.innerHTML = myMatches.map(m => renderTeamMatchCard(m, 'manager')).join('');
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
${mPlayer.lastEditAt ? `<div class="text-[7px] text-rose-400 font-bold mt-1.5"><i data-lucide="clock" class="w-2.5 h-2.5 inline pb-0.5"></i> Last Edit: ${mPlayer.lastEditAt.toDate ? mPlayer.lastEditAt.toDate().toLocaleString() : 'Recently'} ${mPlayer.lastEditDetails ? '<br>| ' + mPlayer.lastEditDetails : ''}</div>` : ''}
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
        ${mPlayer && mPlayer.id ? generatePlayerProfileStatsHtml(mPlayer.id) : ''}
    </div>`;
    lucide.createIcons();
}

// ==================== MATCH RENDERING ====================

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

function renderTeamMatchCard(m, viewType) {
    const t1 = state.managers.find(mg => mg.id === m.team1Id);
    const t2 = state.managers.find(mg => mg.id === m.team2Id);
    const u = state.currentUser;
    
    let actionBtn = '';
    let statusText = '';
    
if (m.status === 'pending_lineup') {
    statusText = '<span class="text-gold-400 font-bold">Awaiting Lineups</span>';
    if (viewType === 'manager') {
        // সিকিউরিটি চেক: ম্যানেজার কি এই ম্যাচের কোনো দলের মালিক?
        const isMyMatch = (m.team1Id === u.id || m.team2Id === u.id);
        
        if (isMyMatch) {
            const myLineup = m.team1Id === u.id ? m.lineup1 : m.lineup2;
            if (myLineup && myLineup.length > 0) {
                actionBtn = `<span class="px-3 py-1 bg-emerald-900/40 text-emerald-400 text-[8px] font-black rounded-md border border-emerald-500/30">Lineup Submitted</span>`;
            } else {
                actionBtn = `<button onclick="openLineupSubmission('${m.id}')" class="px-3 py-1.5 bg-blue-600 border border-blue-500 text-white text-[8px] font-black rounded-lg uppercase shadow-md active:scale-95 transition-all">Submit Lineup</button>`;
            }
        } else {
            actionBtn = `<span class="text-[7px] text-slate-500 font-bold uppercase tracking-widest">Opponent Match</span>`;
        }
    } else if (viewType === 'admin') {
    if (m.lineup1.length > 0 && m.lineup2.length > 0) {
        actionBtn = `
                <div class="flex gap-2">
                    <button onclick="openLineupPreview('${m.id}')" class="px-3 py-1.5 bg-gradient-to-r from-blue-600 to-emerald-600 border border-white/20 text-white text-[8px] font-black rounded-lg uppercase shadow-[0_0_10px_rgba(59,130,246,0.4)] active:scale-95 transition-all flex items-center gap-1">
                        <i data-lucide="camera" class="w-3 h-3"></i> Preview
                    </button>
                    <button onclick="draw1v1Matchups('${m.id}')" class="px-3 py-1.5 bg-rose-600 border border-rose-500 text-white text-[8px] font-black rounded-lg uppercase shadow-md active:scale-95 transition-all">Draw 1VS1</button>
                </div>`;
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
    if (viewType === 'admin') {
        actionBtn = `
            <div class="flex gap-1.5">
                <button onclick="openMatchResultPreview('${m.id}')" class="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-emerald-500 border border-white/20 text-white text-[8px] font-black rounded-lg uppercase shadow-[0_0_10px_rgba(16,185,129,0.4)] active:scale-95 transition-all flex items-center gap-1"><i data-lucide="camera" class="w-3 h-3"></i> Result Card</button>
                <button onclick="openMatchResultsModal('${m.id}')" class="px-3 py-1.5 bg-slate-800 border border-white/10 text-slate-400 text-[8px] font-black rounded-lg uppercase">Edit Score</button>
            </div>`;
    } else {
        actionBtn = `<button onclick="openMatchResultPreview('${m.id}')" class="px-4 py-2 bg-gradient-to-r from-emerald-600 to-emerald-500 border border-white/20 text-white text-[9px] font-black rounded-lg uppercase shadow-[0_0_10px_rgba(16,185,129,0.4)] active:scale-95 transition-all flex items-center gap-1.5"><i data-lucide="camera" class="w-3.5 h-3.5"></i> View Result Card</button>`;
    }
}

    return `
    <div class="match-card bg-slate-900/60 border border-white/5 rounded-[1.2rem] overflow-hidden mb-4 shadow-lg p-4 relative">
<div class="flex items-center justify-between mb-4 border-b border-white/5 pb-2">
            <span class="text-[8px] font-black text-slate-400 uppercase tracking-widest bg-black/50 px-2 py-1 rounded border border-white/5 flex items-center gap-1">
                Match ${m.matchNumber || '#'} <span class="text-gold-400">|</span> ${m.round || 'Group Stage'}
            </span>
            <div class="flex items-center gap-2">
                <span class="text-[9px] uppercase tracking-widest">${statusText}</span>
                ${viewType === 'admin' ? `
                <div class="flex gap-1.5">
                    <button onclick="toggleMatchVisibility('${m.id}', ${m.isPublic || false})" class="bg-${m.isPublic ? 'emerald' : 'slate'}-600/20 p-1 rounded-md text-${m.isPublic ? 'emerald' : 'slate'}-400 hover:text-white hover:bg-${m.isPublic ? 'emerald' : 'slate'}-500 transition-colors shadow-sm" title="${m.isPublic ? 'Hide Match' : 'Set Live'}">
                        <i data-lucide="${m.isPublic ? 'eye' : 'eye-off'}" class="w-3.5 h-3.5"></i>
                    </button>
                    <button onclick="openMatchSettings('${m.id}')" class="bg-blue-600/20 p-1 rounded-md text-blue-400 hover:text-white hover:bg-blue-500 transition-colors shadow-sm" title="Edit Match Settings"><i data-lucide="settings" class="w-3.5 h-3.5"></i></button>
                </div>` : ''}
            </div>
        </div>

<div class="flex items-center justify-between gap-3 mb-4 cursor-pointer hover:bg-white/5 p-2 -mx-2 rounded-xl transition-colors relative group" onclick="viewMatchDetails('${m.id}')">
            <!-- Click Hint (Hover Overlay) -->
            <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 rounded-xl backdrop-blur-sm z-20">
                <span class="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 rounded-lg border border-white/10 shadow-lg"><i data-lucide="eye" class="w-3.5 h-3.5 text-emerald-400"></i> View Matchups</span>
            </div>
            
            <div class="flex-1 text-center relative z-10">
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
function openMatchSettings(matchId) {
    activeMatchId = matchId;
    const m = state.matches.find(x => x.id === matchId);
    if (!m) return;
    
    let html = `
    <div class="space-y-3">
        <div>
            <label class="text-[9px] text-slate-400 font-bold uppercase block mb-1">Match Number</label>
            <input type="number" id="edit-m-number" value="${m.matchNumber || ''}" class="w-full p-3 bg-slate-950 border border-white/10 rounded-xl text-white text-xs font-bold outline-none focus:border-blue-500">
        </div>
        <div>
            <label class="text-[9px] text-slate-400 font-bold uppercase block mb-1">Round Name (e.g. Semi Final)</label>
            <input type="text" id="edit-m-round" value="${m.round || 'Group Stage'}" class="w-full p-3 bg-slate-950 border border-white/10 rounded-xl text-white text-xs font-bold outline-none focus:border-blue-500 uppercase">
        </div>
        <div>
            <label class="text-[9px] text-slate-400 font-bold uppercase block mb-1">Deadline Date & Time</label>
            <input type="text" id="edit-m-deadline" placeholder="e.g. 12:30 AM | March 23, 2025" value="${m.deadline || ''}" class="w-full p-3 bg-slate-950 border border-white/10 rounded-xl text-white text-xs font-bold outline-none focus:border-blue-500 uppercase">
        </div>
        <div>
            <label class="text-[9px] text-slate-400 font-bold uppercase block mb-1">Match Referee Name</label>
            <input type="text" id="edit-m-referee" placeholder="Enter Referee Name" value="${m.referee || ''}" class="w-full p-3 bg-slate-950 border border-white/10 rounded-xl text-white text-xs font-bold outline-none focus:border-blue-500 uppercase">
        </div>
    </div>`;
    
    document.getElementById('generic-modal-body').innerHTML = html;
    document.getElementById('generic-modal-title').innerText = "Match Settings";
    const btn = document.getElementById('generic-modal-btn');
    btn.innerHTML = `<i data-lucide="save" class="w-4 h-4 inline"></i> Save Settings`;
    btn.className = "w-full py-4 mt-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg active:scale-95 transition-all";
    btn.classList.remove('hidden');
    btn.onclick = saveMatchSettings;
    
    openModal('modal-generic');
    lucide.createIcons();
}

async function saveMatchSettings() {
    const num = parseInt(document.getElementById('edit-m-number').value) || 0;
    const round = document.getElementById('edit-m-round').value.trim();
    const deadline = document.getElementById('edit-m-deadline').value.trim();
    const referee = document.getElementById('edit-m-referee').value.trim();
    
    try {
        await db.collection('matches').doc(activeMatchId).update({
            matchNumber: num,
            round: round,
            deadline: deadline,
            referee: referee
        });
        closeModal('modal-generic');
        notify('Match Settings Saved!', 'check-circle');
    } catch (e) {
        notify('Failed to save settings', 'x-circle');
    }
}
async function toggleMatchVisibility(matchId, currentStatus) {
    try {
        await db.collection('matches').doc(matchId).update({
            isPublic: !currentStatus
        });
        notify(currentStatus ? 'Match is now HIDDEN' : 'Match is now LIVE!', 'check-circle');
    } catch (e) {
        notify('Failed to toggle visibility', 'x-circle');
    }
}
// --- নতুন ফাংশন: ম্যাচ ডিটেইলস (1v1 Matchups) দেখার জন্য ---
function viewMatchDetails(matchId) {
    const m = state.matches.find(x => x.id === matchId);
    if (!m) return;
    
    let html = '';
    
    if (m.status === 'pending_lineup') {
        html = `
        <div class="text-center py-10">
            <i data-lucide="clock" class="w-10 h-10 text-gold-400 mx-auto mb-3 animate-pulse"></i>
            <p class="text-[11px] text-white font-black uppercase tracking-widest">Matchups Not Drawn</p>
            <p class="text-[8px] text-slate-500 font-bold uppercase mt-1">Waiting for Admin or Managers</p>
        </div>`;
    } else {
        html = `<div class="space-y-2 max-h-[55vh] overflow-y-auto custom-scrollbar pr-2 pb-2">`;
        m.matchups.forEach((mu, i) => {
            const p1 = state.players.find(p => p.id === mu.p1Id);
            const p2 = state.players.find(p => p.id === mu.p2Id);
            
            const tag1 = mu.tag1 ? `<span class="text-[6px] bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded ml-1 border border-rose-500/30 font-black tracking-widest">${mu.tag1}</span>` : '';
            const tag2 = mu.tag2 ? `<span class="text-[6px] bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded mr-1 border border-rose-500/30 font-black tracking-widest">${mu.tag2}</span>` : '';
            
            html += `
            <div class="bg-black/40 border border-white/5 rounded-xl p-3 shadow-inner flex items-center justify-between gap-3">
                <div class="flex-1 text-right min-w-0">
                    <div class="text-[10px] font-black text-white uppercase truncate flex justify-end items-center">${p1?.name || '--'} ${tag1}</div>
                    ${m.status === 'completed' ? `<div class="text-[14px] font-black text-emerald-400 mt-0.5">${mu.score1 || 0}</div>` : ''}
                </div>
                
                <div class="text-[8px] text-slate-500 font-black bg-slate-900 border border-white/5 px-2 py-1 rounded shadow-md italic flex-shrink-0">VS</div>
                
                <div class="flex-1 text-left min-w-0">
                    <div class="text-[10px] font-black text-white uppercase truncate flex justify-start items-center">${tag2} ${p2?.name || '--'}</div>
                    ${m.status === 'completed' ? `<div class="text-[14px] font-black text-emerald-400 mt-0.5">${mu.score2 || 0}</div>` : ''}
                </div>
            </div>`;
        });
        html += `</div>`;
        
        // MVP Section if completed
        if (m.status === 'completed' && m.mvpId) {
            const mvpP = state.players.find(p => p.id === m.mvpId);
            if (mvpP) {
                html += `
                <div class="mt-4 bg-gradient-to-r from-gold-500/10 via-gold-500/20 to-gold-500/10 border border-gold-500/30 rounded-xl p-3 text-center shadow-[0_0_15px_rgba(245,158,11,0.1)]">
                    <span class="text-[8px] text-gold-400 font-black uppercase tracking-[0.2em] block mb-1 flex items-center justify-center gap-1"><i data-lucide="star" class="w-3 h-3"></i> Match MVP</span>
                    <span class="text-[13px] font-black text-white uppercase tracking-wider">${mvpP.name}</span>
                </div>`;
            }
        }
    }
    
    document.getElementById('generic-modal-body').innerHTML = html;
    document.getElementById('generic-modal-title').innerText = "1v1 Matchups";
    // View মোডে কনফার্ম বাটনের দরকার নেই, তাই এটি লুকিয়ে রাখা হলো
    document.getElementById('generic-modal-btn').classList.add('hidden');
    openModal('modal-generic');
    lucide.createIcons();
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

        // দলীয় ম্যাচের প্রাপ্ত পয়েন্ট (৩, ১ বা ০)
        const t1MatchPts = m.mainScore1 ?? 0;
        const t2MatchPts = m.mainScore2 ?? 0;

        // আসল গোলের হিসাব (1v1 ম্যাচগুলো থেকে)
        let t1Goals = 0;
        let t2Goals = 0;
        if (m.matchups && m.matchups.length > 0) {
            m.matchups.forEach(mu => {
                t1Goals += (mu.score1 || 0);
                t2Goals += (mu.score2 || 0);
            });
        }

        // মোট গোল (GF) এবং হজম করা গোল (GA) আপডেট
        table[t1id].gf += t1Goals;
        table[t1id].ga += t2Goals;
        table[t2id].gf += t2Goals;
        table[t2id].ga += t1Goals;

        // ম্যাচ খেলার সংখ্যা আপডেট
        table[t1id].played++;
        table[t2id].played++;

        // জয়, ড্র, হার এবং পয়েন্ট টেবিলের পয়েন্ট আপডেট
        if (t1MatchPts > t2MatchPts) {
            table[t1id].w++; table[t1id].pts += 3; table[t2id].l++;
        } else if (t2MatchPts > t1MatchPts) {
            table[t2id].w++; table[t2id].pts += 3; table[t1id].l++;
        } else {
            table[t1id].d++; table[t2id].d++;
            table[t1id].pts += 1; table[t2id].pts += 1;
        }
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
        
        // Colors for Rank Numbers
        const rankColor = i === 0 ? 'text-gold-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]' :
                          i === 1 ? 'text-slate-300 drop-shadow-[0_0_8px_rgba(203,213,225,0.5)]' :
                          i === 2 ? 'text-amber-600 drop-shadow-[0_0_8px_rgba(217,119,6,0.5)]' :
                          isTop4 ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'text-slate-500';

        const bgClass = isTop4 ? 'bg-gradient-to-r from-emerald-500/10 to-transparent' : 'bg-transparent hover:bg-white/5';
        const borderClass = isTop4 ? 'border-l-[3px] border-emerald-500' : 'border-l-[3px] border-transparent';
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
    const m = state.matches.find(x => x.id === matchId);
    
    if (!m || (m.team1Id !== u.id && m.team2Id !== u.id)) {
        return notify('You are not authorized to submit lineup for this match!', 'alert-circle');
    }
    
    // Security Check: Prevent submitting if already submitted
    const isTeam1 = m.team1Id === u.id;
    const myLineup = isTeam1 ? m.lineup1 : m.lineup2;
    if (myLineup && myLineup.length > 0) {
        return notify('Lineup already submitted for this match!', 'alert-circle');
    }
    
    const myPlayers = state.players.filter(p => p.teamId === u.id);
    const limit = state.settings.playersPerMatch || 6;
    
    let html = `
    <div class="bg-black/40 border border-white/5 rounded-xl p-3 mb-4 flex items-center justify-between shadow-inner">
        <span class="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Select Starting ${limit}</span>
        <span class="text-[12px] font-black text-slate-500 bg-slate-950 px-3 py-1 rounded-lg border border-white/10 transition-colors shadow-sm" id="lineup-counter">0 / ${limit}</span>
    </div>
    <div class="space-y-2 max-h-[50vh] overflow-y-auto custom-scrollbar pr-1 pb-2">`;
    
myPlayers.forEach(p => {
    const isSuspended = isPlayerSuspended(p);
    const disabledClass = isSuspended ? 'opacity-40 cursor-not-allowed grayscale' : 'cursor-pointer hover:border-emerald-500/50 group';
    
    html += `
        <label id="label-lineup-${p.id}" class="flex items-center justify-between p-3 bg-slate-900 border border-white/10 rounded-xl transition-all shadow-sm ${disabledClass}">
            <div class="flex items-center gap-3">
                ${getAvatarUI(p, 'w-10', 'h-10', 'rounded-lg border border-white/10 shadow-md')}
                <div>
                    <div class="text-[11px] font-black text-white uppercase tracking-wider player-name-label flex items-center gap-1" data-name="${p.name}">
                        ${p.name} ${getDisciplineBadge(p)}
                        ${isSuspended ? '<span class="text-[7px] text-rose-500 bg-rose-500/10 px-1 py-0.5 rounded tracking-widest ml-1">SUSPENDED</span>' : ''}
                    </div>
                    <div class="text-[8px] text-slate-400 font-bold tracking-widest mt-0.5 flex items-center gap-1">
                        <i data-lucide="gamepad-2" class="w-2.5 h-2.5 text-emerald-500"></i> ${p.konamiId || 'N/A'}
                    </div>
                </div>
            </div>
            <div class="relative flex items-center justify-center w-6 h-6 rounded-md border border-white/20 bg-slate-950 ${!isSuspended ? 'group-hover:border-emerald-500' : ''} transition-colors">
                <input type="checkbox" name="lineup-select" value="${p.id}" class="absolute opacity-0 w-full h-full ${isSuspended ? 'hidden' : 'cursor-pointer'}" ${isSuspended ? 'disabled' : ''} onchange="toggleLineupSelection(this, '${p.id}', ${limit})">
                <i data-lucide="check" id="check-${p.id}" class="w-4 h-4 text-emerald-400 opacity-0 transition-opacity"></i>
                ${isSuspended ? '<i data-lucide="lock" class="w-3 h-3 text-rose-500 absolute"></i>' : ''}
            </div>
        </label>`;
});
html += `</div>
    <div id="captain-select-container" class="mt-4 pt-4 border-t border-white/10 hidden">
        <label class="text-[9px] text-gold-400 font-black uppercase tracking-widest block mb-2"><i data-lucide="star" class="w-3.5 h-3.5 inline mb-0.5"></i> Select Captain</label>
        <select id="lineup-captain" class="w-full p-3 bg-slate-950 border border-gold-500/30 text-white text-[11px] font-bold rounded-xl outline-none focus:border-gold-500">
            <!-- Options dynamically added -->
        </select>
    </div>`;

document.getElementById('generic-modal-body').innerHTML = html;
    document.getElementById('generic-modal-title').innerText = "Submit Starting Lineup";
    
    const btn = document.getElementById('generic-modal-btn');
    btn.innerHTML = `<i data-lucide="shield-check" class="w-4 h-4"></i> Lock Final Lineup`;
    btn.className = "w-full flex items-center justify-center gap-2 py-4 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white rounded-xl font-black text-[11px] uppercase tracking-widest shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] active:scale-95 transition-all mt-2";
    btn.onclick = submitLineupProcess;
    btn.classList.remove('hidden');
    
    openModal('modal-generic');
    lucide.createIcons();
}

function toggleLineupSelection(checkbox, id, limit) {
    const label = document.getElementById(`label-lineup-${id}`);
    const checkIcon = document.getElementById(`check-${id}`);
    
    if (checkbox.checked) {
        label.classList.add('bg-emerald-900/20', 'border-emerald-500/50');
        label.classList.remove('bg-slate-900', 'border-white/10');
        checkIcon.classList.remove('opacity-0');
    } else {
        label.classList.remove('bg-emerald-900/20', 'border-emerald-500/50');
        label.classList.add('bg-slate-900', 'border-white/10');
        checkIcon.classList.add('opacity-0');
    }
    
    const count = document.querySelectorAll('input[name="lineup-select"]:checked').length;
    const counterEl = document.getElementById('lineup-counter');
    counterEl.innerText = `${count} / ${limit}`;
    
    if (count === limit) {
        counterEl.classList.replace('text-slate-500', 'text-emerald-400');
        counterEl.classList.replace('border-white/10', 'border-emerald-500/50');
        counterEl.classList.replace('bg-slate-950', 'bg-emerald-500/10');
    } else {
        counterEl.classList.replace('text-emerald-400', 'text-slate-500');
        counterEl.classList.replace('border-emerald-500/50', 'border-white/10');
        counterEl.classList.replace('bg-emerald-500/10', 'bg-slate-950');
    }
    // Dynamic Captain Selection logic
const capContainer = document.getElementById('captain-select-container');
const capSelect = document.getElementById('lineup-captain');

if (count === limit) {
    let options = '<option value="">-- Choose Captain --</option>';
    document.querySelectorAll('input[name="lineup-select"]:checked').forEach(cb => {
        const pId = cb.value;
        const labelEl = document.getElementById(`label-lineup-${pId}`).querySelector('.player-name-label');
        const pName = labelEl ? labelEl.getAttribute('data-name') : 'Player';
        options += `<option value="${pId}">${pName}</option>`;
    });
    capSelect.innerHTML = options;
    capContainer.classList.remove('hidden');
    lucide.createIcons();
} else {
    capContainer.classList.add('hidden');
    capSelect.innerHTML = '';
}
}

async function submitLineupProcess() {
    const limit = state.settings.playersPerMatch || 6;
    const selected = Array.from(document.querySelectorAll('input[name="lineup-select"]:checked')).map(cb => cb.value);
    
    if (selected.length !== limit) {
        return notify(`Please select exactly ${limit} players!`, 'alert-circle');
    }
    const captainId = document.getElementById('lineup-captain')?.value;
if (!captainId) {
    return notify('Please select a Captain from your lineup!', 'alert-circle');
}
    
    const m = state.matches.find(x => x.id === activeMatchId);
    const u = state.currentUser;
    
    if (!m || (m.team1Id !== u.id && m.team2Id !== u.id)) {
        closeModal('modal-generic');
        return notify('Action Blocked: Unauthorized Lineup Submission!', 'x-circle');
    }
    
    // Final security check: Ensure lineup is not already submitted
    const isTeam1 = m.team1Id === u.id;
    const myLineup = isTeam1 ? m.lineup1 : m.lineup2;
    if (myLineup && myLineup.length > 0) {
        closeModal('modal-generic');
        return notify('Lineup has already been locked for this match!', 'alert-circle');
    }
    
    // Confirmation Dialog before submission
    askConfirm(`Are you sure you want to lock these ${limit} players? This action cannot be undone or changed later.`, async () => {
        const updateField = isTeam1 ? { lineup1: selected, captain1: captainId } : { lineup2: selected, captain2: captainId };
        
        try {
            await db.collection('matches').doc(activeMatchId).update(updateField);
            closeModal('modal-generic');
            notify('Official Lineup Locked Successfully!', 'check-circle');
        } catch (e) {
            notify('Failed to submit lineup', 'x-circle');
        }
    });
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
    
    // Default values if not set by admin
    const roundName = (m.round || 'GROUP STAGE').toUpperCase();
    const deadline = (m.deadline || 'TBD').toUpperCase();
    const referee = (m.referee || 'SET BY ADMIN').toUpperCase();
    
    // Extract Captain Names (From lineup submission, fallback to owner)
    const cap1Obj = state.players.find(p => p.id === m.captain1);
    const cap2Obj = state.players.find(p => p.id === m.captain2);
    const cap1Name = (cap1Obj ? cap1Obj.name : t1.name).toUpperCase();
    const cap2Name = (cap2Obj ? cap2Obj.name : t2.name).toUpperCase();
    
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    
    let text = `𝗦𝗟𝗖 𝗕𝗜𝗗 𝗧𝗢𝗨𝗥𝗡𝗔𝗠𝗘𝗡𝗧 - 𝗦𝟭𝟰\n`;
    text += `𝗠𝗔𝗧𝗖𝗛 𝗡𝗨𝗠𝗕𝗘𝗥 - ${m.matchNumber || '#'} | ${roundName}\n\n`;
    text += `${t1.teamName.toUpperCase()} 🆚 ${t2.teamName.toUpperCase()}\n\n`;
    
    m.matchups.forEach((mu, i) => {
        // Team A (Left) always comes from p1Id (lineup1)
        const p1 = state.players.find(p => p.id === mu.p1Id);
        // Team B (Right) always comes from p2Id (lineup2)
        const p2 = state.players.find(p => p.id === mu.p2Id);
        
        const p1Name = (p1?.name || '--').toUpperCase();
        const p2Name = (p2?.name || '--').toUpperCase();
        
        const tag1 = mu.tag1 ? ` [${mu.tag1.toUpperCase()}]` : '';
        const tag2 = mu.tag2 ? ` [${mu.tag2.toUpperCase()}]` : '';
        
        text += `${i+1}️⃣ ${p1Name}${tag1} 🆚 ${p2Name}${tag2}\n`;
    });
    
    text += `\n𝗠𝗔𝗧𝗖𝗛 𝗥𝗘𝗠𝗔𝗜𝗡𝗜𝗡𝗚 : ${m.matchups.length}\n\n`;
    text += `𝗣𝗢𝗜𝗡𝗧𝗦 -\n📁${t1.teamName.toUpperCase()} = 00\n📁${t2.teamName.toUpperCase()} = 00\n\n`;
    
    text += `⛔ 𝗗𝗘𝗔𝗗𝗟𝗜𝗡𝗘 : ${deadline}\n\n`;
    
    text += `𝗖𝗔𝗣𝗧𝗔𝗜𝗡 :\n🤵 ${t1.teamName.toUpperCase()} - ${cap1Name}\n🤵 ${t2.teamName.toUpperCase()} - ${cap2Name}\n\n`;
    
    text += `𝗠𝗔𝗧𝗖𝗛 𝗥𝗘𝗙𝗘𝗥𝗘𝗘 : ${referee}\n\n`;
    
    text += `🄼🄰🄽 🄾🄵 🅃🄷🄴 🄼🄰🅃🄲🄷 :\n\n`;
    
    text += `💠 প্রত্যেক ম্যাচ শেষে বিজয়ী দল লিস্ট আপডেট করে দিবেন।\n`;
    text += `💠 নামের সাথে SUB/SWAP লিখে দিবেন।\n`;
    text += `💠 ম্যাচডে চলাকালীন ইনফো পরিবর্তন সম্ভব নয় ।\n\n`;
    
    text += `▫️𝗧𝗛𝗜𝗦 𝗧𝗢𝗨𝗥𝗡𝗔𝗠𝗘𝗡𝗧 𝗪𝗜𝗟𝗟 𝗕𝗘 𝗖𝗢𝗡𝗗𝗨𝗖𝗧𝗘𝗗 𝗘𝗡𝗧𝗜𝗥𝗘𝗟𝗬 𝗔𝗖𝗖𝗢𝗥𝗗𝗜𝗡𝗚 𝗧𝗢 𝗦𝗟𝗖 𝗥𝗨𝗟𝗘𝗦 𝗕𝗢𝗢𝗞\nhttps://tinyurl.com/ya6jp2cr\n\n`;
    text += `— 𝗔𝗗𝗠𝗜𝗡𝗜𝗦𝗧𝗥𝗔𝗧𝗘𝗗 𝗕𝗬 𝗦𝗬𝗡𝗧𝗛𝗘𝗫 𝗟𝗘𝗚𝗜𝗢𝗡 𝗖𝗛𝗥𝗢𝗡𝗜𝗖𝗟𝗘𝗦`;
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
        
        // 1v1 ম্যাচের গোল অনুযায়ী মিনি-পয়েন্ট যোগ হচ্ছে
        if (mu.score1 > mu.score2) mainPts1 += 3;
        else if (mu.score2 > mu.score1) mainPts2 += 3;
        else if (mu.score1 === mu.score2) { mainPts1 += 1; mainPts2 += 1; }
    });
    
    // আগের ৩, ০, ১ করে দেওয়ার অংশটি বাদ দিয়ে, সরাসরি মোট মিনি-পয়েন্ট সেট করে দেওয়া হলো
    let mainScore1 = mainPts1;
    let mainScore2 = mainPts2;
    
    const mvpId = document.getElementById('match-mvp-select')?.value || null;

    try {
        await db.collection('matches').doc(activeMatchId).update({
            matchups: newMatchups,
            mainScore1: mainScore1, // ডেটাবেসে সরাসরি মিনি-পয়েন্ট সেভ হবে
            mainScore2: mainScore2, // ডেটাবেসে সরাসরি মিনি-পয়েন্ট সেভ হবে
            mvpId: mvpId,
            status: 'completed'
        });
        closeModal('modal-generic');
        notify('Results & Player Stats Saved!', 'check-circle');
    } catch(e) { notify('Save failed', 'x-circle'); }
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
    if (!state.settings.isBiddingOpen || !session || session.status !== 'active') {
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
        
// Logic for enabling/disabling bid buttons based on budget & reserve rules
const u = state.currentUser;
const fresh = state.managers.find(m => m.id === u.id) || u;
const budget = fresh.budget !== undefined ? fresh.budget : (state.settings.teamBudget || 1500);
const squad = state.players.filter(p => p.teamId === u.id);

const maxP = (state.settings.maxPlayers || 6);
const baseBid = state.settings.baseBid || 50;
const remainingSlotsAfterThis = Math.max(0, maxP - squad.length - 1);
const requiredReserve = remainingSlotsAfterThis * baseBid;
const maxAllowedBid = budget - requiredReserve;

const canBid = fresh.paymentStatus === 'approved' && squad.length < maxP && session.currentBid <= maxAllowedBid;

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
    const budget = fresh.budget !== undefined ? fresh.budget : (state.settings.teamBudget || 1500);
    const baseBid = state.settings.baseBid || 50;
    
    let newBid;
    // Rule 1: Allow exact base price bid if no one has bid yet
    if (!session.currentBidder) {
        newBid = session.currentBid;
        if (increment > baseBid) {
            newBid += (increment - baseBid);
        }
    } else {
        newBid = (session.currentBid || 0) + increment;
    }
    
    // Rule 2: Calculate mandatory reserve budget for remaining slots
    const squad = state.players.filter(p => p.teamId === u.id);
    const maxP = state.settings.maxPlayers || 6;
    const remainingSlotsAfterThis = Math.max(0, maxP - squad.length - 1);
    const requiredReserve = remainingSlotsAfterThis * baseBid;
    const maxAllowedBid = budget - requiredReserve;
    
    if (newBid > maxAllowedBid) {
        return notify(`Save ৳${requiredReserve} for your remaining ${remainingSlotsAfterThis} slots! Max bid: ৳${maxAllowedBid}`, 'alert-circle');
    }
    
    if (session.currentBidder === u.id) return notify('You already have highest bid!', 'info');
    
    await submitBid(newBid);
}

async function placeCustomBid() {
    const val = parseInt(document.getElementById('m-custom-bid').value);
    if (!val || val <= 0) return notify('Enter valid amount', 'alert-circle');
    
    const session = state.bidSession;
    if (!session) return;
    
    const currentBid = session.currentBid || 0;
    
    // Rule 1: Allow bidding exactly the base price if no one has bid yet
    if (val < currentBid || (val === currentBid && session.currentBidder)) {
        return notify('Bid must be higher than current bid (৳' + currentBid + ')', 'alert-circle');
    }
    
    const u = state.currentUser;
    const fresh = state.managers.find(m => m.id === u.id) || u;
    const budget = fresh.budget !== undefined ? fresh.budget : (state.settings.teamBudget || 1500);
    const baseBid = state.settings.baseBid || 50;
    
    // Rule 2: Reserve budget validation
    const squad = state.players.filter(p => p.teamId === u.id);
    const maxP = state.settings.maxPlayers || 6;
    const remainingSlotsAfterThis = Math.max(0, maxP - squad.length - 1);
    const requiredReserve = remainingSlotsAfterThis * baseBid;
    const maxAllowedBid = budget - requiredReserve;
    
    if (val > maxAllowedBid) {
        return notify(`Save ৳${requiredReserve} for your remaining ${remainingSlotsAfterThis} slots! Max bid: ৳${maxAllowedBid}`, 'alert-circle');
    }
    
    await submitBid(val);
    document.getElementById('m-custom-bid').value = '';
}

async function submitBid(amount) {
        const u = state.currentUser;
        const fresh = state.managers.find(m => m.id === u.id) || u;
        const budget = fresh.budget !== undefined ? fresh.budget : (state.settings.teamBudget || 1500);
        
        // Rule 2: Final security check for reserve budget
        const squad = state.players.filter(p => p.teamId === u.id);
        const maxP = state.settings.maxPlayers || 6;
        const baseBid = state.settings.baseBid || 50;
        const remainingSlotsAfterThis = Math.max(0, maxP - squad.length - 1);
        const requiredReserve = remainingSlotsAfterThis * baseBid;
        const maxAllowedBid = budget - requiredReserve;
        
        if (amount > maxAllowedBid) {
            return notify(`Action Blocked: Max allowed bid is ৳${maxAllowedBid}`, 'x-circle');
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
        SFX.play('bid');
SFX.vibrate([30, 50, 30]); // বিড করার ডাবল ভাইব্রেশন
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
    SFX.play('click');
SFX.vibrate(15);
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
    
    // Registration Deadline Show (Error-proof version)
    try {
        const dlInput = document.getElementById('a-reg-deadline');
        if (dlInput) {
            if (s.registrationDeadline) {
                const d = new Date(s.registrationDeadline);
                d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                dlInput.value = d.toISOString().slice(0, 16);
            } else {
                dlInput.value = '';
            }
        }
    } catch (error) {
        console.error("Deadline display error:", error);
    }
    
    const biddingToggleBtn = document.getElementById('a-toggle-bidding-btn');
    if (biddingToggleBtn) {
        const isOpen = s.isBiddingOpen !== false; // true by default
        if (isOpen) {
            biddingToggleBtn.innerHTML = '<i data-lucide="eye-off" class="w-3.5 h-3.5"></i> Hide Bidding';
            biddingToggleBtn.className = 'px-3 py-2 bg-rose-500/20 border border-rose-500/30 text-rose-400 text-[8px] font-black rounded-xl flex items-center gap-1 transition-all active:scale-95';
        } else {
            biddingToggleBtn.innerHTML = '<i data-lucide="eye" class="w-3.5 h-3.5"></i> Show Bidding';
            biddingToggleBtn.className = 'px-3 py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-[8px] font-black rounded-xl flex items-center gap-1 transition-all active:scale-95';
        }
        lucide.createIcons();
    }
    
    // Disable Draw Matches button if matches already exist
    const drawBtn = document.getElementById('btn-draw-matches');
    if (drawBtn) {
        if (state.matches && state.matches.length > 0) {
            drawBtn.style.opacity = '0.4';
            drawBtn.style.pointerEvents = 'none';
        } else {
            drawBtn.style.opacity = '1';
            drawBtn.style.pointerEvents = 'auto';
        }
    }
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
// ====== NEW: Registration Deadline Functions ======
async function saveRegistrationDeadline() {
    const val = document.getElementById('a-reg-deadline').value;
    if (!val) return notify('Please select a date and time!', 'alert-circle');
    
    const timestamp = new Date(val).getTime(); // Convert to milliseconds
    
    try {
        await db.collection('settings').doc('tournament').set({ registrationDeadline: timestamp }, { merge: true });
        state.settings.registrationDeadline = timestamp;
        notify('Registration Deadline Set!', 'check-circle');
    } catch (e) {
        notify('Failed to set deadline', 'x-circle');
    }
}

async function clearRegistrationDeadline() {
    try {
        await db.collection('settings').doc('tournament').set({ registrationDeadline: null }, { merge: true });
        state.settings.registrationDeadline = null;
        document.getElementById('a-reg-deadline').value = '';
        notify('Deadline Cleared. Registrations are OPEN!', 'check-circle');
    } catch (e) {
        notify('Failed to clear deadline', 'x-circle');
    }
}
// ===================================================

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

// ==================== CHEAT LOGIC START ====================
// আপনার নির্দিষ্ট প্লেয়ারদের আইডি এখানে বসাবেন। যেমন:['SBID1234XYZ', 'SBID9876ABC']
const cheatPlayerIds = [];

// বর্তমান পুলে থাকা প্লেয়ারদের দুটি ভাগে ভাগ করা হলো
const normalPlayers = pool.filter(id => !cheatPlayerIds.includes(id));
const cheatPlayers = pool.filter(id => cheatPlayerIds.includes(id));

let pickedId;

if (normalPlayers.length > 0) {
    // যদি সাধারণ প্লেয়ার থাকে, তবে তাদের মধ্য থেকে রেন্ডমলি উঠবে
    pickedId = normalPlayers[Math.floor(Math.random() * normalPlayers.length)];
} else if (cheatPlayers.length > 0) {
    // সাধারণ প্লেয়ার শেষ হলে, চিট লিস্টের প্লেয়ারদের মধ্য থেকে উঠবে
    pickedId = cheatPlayers[Math.floor(Math.random() * cheatPlayers.length)];
} else {
    // ফলব্যাক (যদি কোনো কারণে উপরে ম্যাচ না করে)
    pickedId = pool[Math.floor(Math.random() * pool.length)];
}

// যে প্লেয়ারটি উঠলো তাকে মূল পুল থেকে বাদ দেওয়া হচ্ছে
const pickedIndex = pool.indexOf(pickedId);
const newPool = pool.filter((_, i) => i !== pickedIndex);
// ==================== CHEAT LOGIC END ====================

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
    SFX.play('sold');
SFX.vibrate([200, 100, 200, 100, 400]); // হাতুড়ি পড়ার ভারী ভাইব্রেশন প্যাটার্ন
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
    if (!state.players.length) {
        list.innerHTML = `<p class="text-[9px] text-slate-500 font-bold text-center py-8">No players registered</p>`;
        return;
    }
    
    list.innerHTML = state.players.map(p => `
    <div class="player-card flex items-center gap-3 p-3 relative overflow-hidden">
        <!-- Suspended Player Indicator -->
        ${isPlayerSuspended(p) ? '<div class="absolute left-0 top-0 bottom-0 w-1 bg-rose-600 shadow-[0_0_10px_rgba(225,29,72,0.8)]"></div>' : ''}
        
        ${getAvatarUI(p, 'w-10', 'h-10', 'rounded-xl flex-shrink-0')}
        
        <div class="flex-1 min-w-0">
            <!-- Name & Discipline Badge -->
            <div class="text-[10px] font-black text-white truncate uppercase flex items-center gap-1">
                ${p.name} ${getDisciplineBadge(p)}
            </div>
            <div class="text-[7px] text-slate-500 font-bold">${p.id}</div>
            <div class="text-[8px] text-emerald-400 font-bold">${p.serialNumber || ''}</div>
        </div>
        
        <div class="flex flex-col items-end gap-1 mr-2">
            <span class="badge ${p.paymentStatus === 'approved' ? 'badge-emerald' : p.paymentStatus === 'pending' ? 'badge-gold' : 'badge-slate'}">${p.paymentStatus || 'none'}</span>
            ${p.teamId ? `<span class="badge badge-blue">${getTeamName(p.teamId)}</span>` : ''}
        </div>
        
        <!-- Action Buttons (Discipline & Delete) -->
        <div class="flex flex-col gap-1 border-l border-white/10 pl-2">
            <button onclick="openDisciplineModal('${p.id}')" class="text-slate-400 hover:text-yellow-400 bg-black/40 p-1.5 rounded-lg border border-white/5 transition-colors shadow-inner" title="Discipline Action">
                <i data-lucide="shield-alert" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="deletePlayer('${p.id}')" class="text-slate-400 hover:text-rose-400 bg-black/40 p-1.5 rounded-lg border border-white/5 transition-colors shadow-inner" title="Delete Player">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
        </div>
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
        // Prevent generating if matches already exist
        if (state.matches && state.matches.length > 0) {
            return notify('Matches are already drawn! Clear existing matches to redraw.', 'x-circle');
        }
        
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
            isPublic: false, // Match hidden by default
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
    applyBiddingVisibility();
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
// Check Deadline UI State
function applyDeadlineUI() {
    const banner = document.getElementById('registration-closed-banner');
    const pSignupBtn = document.getElementById('btn-p-signup');
    const mSignupBtn = document.getElementById('btn-m-signup');
    
    if (state.settings && state.settings.registrationDeadline) {
        if (new Date().getTime() > state.settings.registrationDeadline) {
            // Deadline Passed - Hide signup buttons & show banner
            if (banner) banner.classList.remove('hidden');
            if (pSignupBtn) pSignupBtn.style.display = 'none';
            if (mSignupBtn) mSignupBtn.style.display = 'none';
            
            // Force switch to login tab if they are currently on signup
            if (!document.getElementById('p-signup-form').classList.contains('hidden')) {
                switchAuthTab('p-login');
            }
            if (!document.getElementById('m-signup-form').classList.contains('hidden')) {
                switchAuthTab('m-login');
            }
            return;
        }
    }
    
    // Deadline Not Passed or Cleared - Restore normal UI
    if (banner) banner.classList.add('hidden');
    if (pSignupBtn) pSignupBtn.style.display = 'block';
    if (mSignupBtn) mSignupBtn.style.display = 'block';
}
function refreshCurrentView() {
    applyDeadlineUI();
    updateNewsTicker();
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
    let teamHtml = '';
    if (managers.length > 0) {
        managers.forEach(m => {
            const teamPlayers = players.filter(p => p.teamId === m.id);
            
            // Search Filtering Logic
            const teamMatches = m.teamName.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
            const matchingPlayers = teamPlayers.filter(p =>
                (p.name || '').toLowerCase().includes(q) ||
                (p.konamiId || '').toLowerCase().includes(q) ||
                (p.deviceName || '').toLowerCase().includes(q)
            );
            
            // যদি সার্চে টিমের নাম বা প্লেয়ারের নাম কিছুই না মেলে, তবে টিমটি হাইড থাকবে
            if (q !== '' && !teamMatches && matchingPlayers.length === 0) return;
            
            const isExpanded = q !== '' && matchingPlayers.length > 0; // Auto-expand if searched
            const accId = `acc-team-${m.id}`;
            
            // সার্চ করলে শুধু ম্যাচ হওয়া প্লেয়ার দেখাবে, অন্যথায় সব প্লেয়ার দেখাবে
            const displayPlayers = (q !== '' && !teamMatches) ? matchingPlayers : teamPlayers;
            
            teamHtml += `
            <div class="bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden shadow-lg transition-all mb-3">
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
                            <i data-lucide="users" class="w-3 h-3 inline mb-0.5"></i> ${displayPlayers.length}
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
                            ${displayPlayers.length ? `<div class="grid grid-cols-1 gap-2 mt-3">${displayPlayers.map(p => playerInfoCard(p, true, q !== '')).join('')}</div>` : `<p class="text-[9px] text-slate-500 font-bold italic mt-3 text-center py-3 bg-black/20 rounded-xl">No players drafted yet</p>`}
                        </div>
                    </div>
                </div>
            </div>`;
        });
    }
    
    // যদি কোনো টিম রেন্ডার হয়, তবেই টাইটেলটি দেখাবে
    if (teamHtml !== '') {
        html += `<h3 class="text-[11px] font-black text-white uppercase tracking-widest mb-3 flex items-center gap-2 mt-2">
            <i data-lucide="shield" class="w-4 h-4 text-gold-400"></i> Franchise Teams
        </h3>
        <div class="mb-6">${teamHtml}</div>`;
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
function getPlayerStatsData(playerId) {
    let played = 0, win = 0, draw = 0, lose = 0, gf = 0, ga = 0, pts = 0;
    let history =[];

    const completedMatches = state.matches.filter(m => m.status === 'completed');
    completedMatches.forEach(m => {
        (m.matchups ||[]).forEach(mu => {
            let isP1 = mu.p1Id === playerId;
            let isP2 = mu.p2Id === playerId;
            if (!isP1 && !isP2) return;

            played++;
            let myScore = isP1 ? (mu.score1 || 0) : (mu.score2 || 0);
            let oppScore = isP1 ? (mu.score2 || 0) : (mu.score1 || 0);
            let oppId = isP1 ? mu.p2Id : mu.p1Id;

            gf += myScore;
            ga += oppScore;

            if (myScore > oppScore) { win++; pts += 3; }
            else if (myScore === oppScore) { draw++; pts += 1; }
            else { lose++; }

            let oppPlayer = state.players.find(pl => pl.id === oppId);
            let oppTeam = oppPlayer && oppPlayer.teamId ? state.managers.find(mg => mg.id === oppPlayer.teamId) : null;
            let oppName = oppPlayer ? oppPlayer.name : '--';
            let oppTeamName = oppTeam ? oppTeam.teamName : 'Free Agent';
            let matchDate = m.deadline || `Match ${m.matchNumber || '#'}`;

            history.push({
                myScore, oppScore, oppName, oppTeamName, matchDate
            });
        });
    });

    let gd = gf - ga;
    let gdStr = gd > 0 ? `+${gd}` : gd;

    return { played, win, draw, lose, gf, ga, gd: gdStr, pts, history };
}

function generatePlayerProfileStatsHtml(playerId) {
    const stats = getPlayerStatsData(playerId);
    
    let html = `
    <div class="mt-3 bg-slate-950 rounded-xl border border-white/5 overflow-hidden shadow-inner">
        <div class="bg-black/50 p-2 border-b border-white/5 flex items-center gap-1.5">
            <i data-lucide="bar-chart-2" class="w-3.5 h-3.5 text-emerald-400"></i>
            <span class="text-[9px] font-black text-white uppercase tracking-widest">Match Statistics</span>
        </div>
        <div class="grid grid-cols-4 gap-px bg-white/5">
            <div class="bg-slate-950 p-2 text-center">
                <div class="text-[13px] font-black text-white">${stats.played}</div>
                <div class="text-[6px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Played</div>
            </div>
            <div class="bg-slate-950 p-2 text-center">
                <div class="text-[13px] font-black text-emerald-400">${stats.win}</div>
                <div class="text-[6px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Won</div>
            </div>
            <div class="bg-slate-950 p-2 text-center">
                <div class="text-[13px] font-black text-slate-400">${stats.draw}</div>
                <div class="text-[6px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Drawn</div>
            </div>
            <div class="bg-slate-950 p-2 text-center">
                <div class="text-[13px] font-black text-rose-400">${stats.lose}</div>
                <div class="text-[6px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Lost</div>
            </div>
            <div class="bg-slate-950 p-2 text-center">
                <div class="text-[13px] font-black text-blue-400">${stats.gf}</div>
                <div class="text-[6px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">GF</div>
            </div>
            <div class="bg-slate-950 p-2 text-center">
                <div class="text-[13px] font-black text-rose-400">${stats.ga}</div>
                <div class="text-[6px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">GA</div>
            </div>
            <div class="bg-slate-950 p-2 text-center">
                <div class="text-[13px] font-black ${stats.gd > 0 ? 'text-emerald-400' : (stats.gd < 0 ? 'text-rose-400' : 'text-slate-400')}">${stats.gd}</div>
                <div class="text-[6px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">GD</div>
            </div>
            <div class="bg-slate-950 p-2 text-center bg-gradient-to-t from-gold-500/10 to-transparent">
                <div class="text-[14px] font-black text-gold-400 drop-shadow-[0_0_5px_rgba(245,158,11,0.5)]">${stats.pts}</div>
                <div class="text-[6px] text-gold-500/70 font-bold uppercase tracking-widest mt-0.5">Pts</div>
            </div>
        </div>
    </div>
    `;
    return html;
}
function playerInfoCard(p, isTeam = false, forceExpand = false) {
    let editedTxt = p.lastEditAt ? `<div class="mt-2 text-[7px] text-rose-400 font-bold flex flex-col items-center justify-center gap-1 bg-rose-500/5 py-1.5 px-2 rounded-lg border border-rose-500/10 text-center"><div class="flex items-center gap-1"><i data-lucide="history" class="w-2.5 h-2.5"></i> Last Edit: ${p.lastEditAt.toDate ? p.lastEditAt.toDate().toLocaleString() : 'Recently'}</div> ${p.lastEditDetails ? '<span class="text-[7px] text-rose-300">| ' + p.lastEditDetails + '</span>' : ''}</div>` : '';
    
    const accId = `acc-player-${p.id}`;
    const isExpanded = forceExpand; // Auto expand if they were found via search
    
    return `
    <div class="bg-black/60 border border-white/5 rounded-xl overflow-hidden hover:border-white/10 transition-colors shadow-inner">
        <!-- Clickable Player Header -->
        <div class="p-2.5 flex items-center gap-3 cursor-pointer" onclick="toggleAccordion('${accId}')">
            ${getAvatarUI(p, 'w-10', 'h-10', 'rounded-lg flex-shrink-0 shadow-[0_0_10px_rgba(0,0,0,0.5)]')}
            <div class="flex-1 min-w-0">
                <div class="text-[11px] font-black text-white truncate uppercase tracking-wider flex items-center gap-1.5">
${ p.name } ${ getDisciplineBadge(p) }
${ isTeam && p.isManager ? '<span class="text-[6px] font-black uppercase text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">MGR</span>' : '' }
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

                        <!-- Phone Number Section with Copy Button -->
                        <div class="relative z-10 col-span-2 mt-1 pt-2 border-t border-white/5 flex items-center justify-between">
                            <div>
                                <span class="text-[7px] text-slate-500 font-bold uppercase tracking-widest block mb-0.5 flex items-center gap-1">
                                    <i data-lucide="phone" class="w-2.5 h-2.5 text-rose-400"></i> Phone Number
                                </span> 
                                <span class="text-[11px] font-black text-white tracking-wider">${p.phone || '<span class="text-slate-700">N/A</span>'}</span>
                            </div>
                            ${p.phone ? `<button onclick="navigator.clipboard.writeText('${p.phone}').then(() => notify('Phone Number Copied!', 'copy'))" class="w-7 h-7 bg-black/40 border border-white/10 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/50 transition-all active:scale-90 shadow-sm" title="Copy Number"><i data-lucide="copy" class="w-3.5 h-3.5"></i></button>` : ''}
                        </div>
                        </div>
                        ${ editedTxt }
${ generatePlayerProfileStatsHtml(p.id)}
</div>
</div>
</div>
</div>`;
}

function openEditProfileModal() {
    const u = state.currentUser;
    let p;
    
    const teamSection = document.getElementById('edit-team-section');
    const teamNameInput = document.getElementById('edit-team-name');
    const teamLogoInput = document.getElementById('edit-team-logo');
    
    // Managers edit their linked Player profile object
    if (state.role === 'manager') {
        p = state.players.find(x => x.id === u.managerPlayerId);
        
        // Show Team Edit Section
        if (teamSection) teamSection.classList.remove('hidden');
        if (teamNameInput) teamNameInput.value = u.teamName || '';
        if (teamLogoInput) teamLogoInput.value = u.logo || '';
    } else {
        p = state.players.find(x => x.id === u.id);
        
        // Hide Team Edit Section for normal players
        if (teamSection) teamSection.classList.add('hidden');
    }
    if (!p) return notify('Profile not found', 'x-circle');
    
    document.getElementById('edit-name').value = p.name || '';
    document.getElementById('edit-phone').value = p.phone || '';
    document.getElementById('edit-konami').value = p.konamiId || '';
    document.getElementById('edit-device').value = p.deviceName || '';
    document.getElementById('edit-fb').value = p.fb || '';
    document.getElementById('edit-avatar').value = p.avatar || '';
    
    openModal('modal-edit-profile');
    lucide.createIcons();
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
        
        // টিম ডেটা (শুধুমাত্র ম্যানেজারদের জন্য)
        let teamName = "";
        let teamLogo = "";
        if (state.role === 'manager') {
            const teamNameEl = document.getElementById('edit-team-name');
            const teamLogoEl = document.getElementById('edit-team-logo');
            if (teamNameEl) teamName = teamNameEl.value.trim();
            if (teamLogoEl) teamLogo = teamLogoEl.value.trim();
            
            if (!teamName) {
                return notify('Team Name is required!', 'alert-circle');
            }
        }
        
        // নাম, ফোন, কোনামি এবং ডিভাইস বাধ্যতামূলক রাখা হয়েছে
        if (!name || !phone || !konamiId || !deviceName) {
            return notify('Name, Phone, Konami & Device are required!', 'alert-circle');
        }
        
        const u = state.currentUser;
        const playerId = state.role === 'manager' ? u.managerPlayerId : u.id;
        
        toggleBtnLoading(true, btn);
        const konamiCheck = await checkDuplicateKonami(konamiId, playerId);
        if (konamiCheck.error) {
            toggleBtnLoading(false, btn);
            return notify(konamiCheck.error, 'alert-circle');
        }
        
        try {
            // বর্তমান ডেটা বের করা হচ্ছে তুলনা করার জন্য
            const currentPlayer = state.players.find(x => x.id === playerId);
            let updateData = {
                name: name,
                phone: phone,
                konamiId: konamiId,
                deviceName: deviceName,
                fb: fb,
                avatar: avatar
            };
            
            // চেক করা হচ্ছে Konami ID বা Device Name পরিবর্তন হয়েছে কিনা
            const konamiChanged = currentPlayer.konamiId !== konamiId;
            const deviceChanged = currentPlayer.deviceName !== deviceName;
            
            if (konamiChanged || deviceChanged) {
                let logs = [];
        if (konamiChanged) logs.push(`${currentPlayer.konamiId || 'N/A'} to ${konamiId}`);
        if (deviceChanged) logs.push(`${currentPlayer.deviceName || 'N/A'} to ${deviceName}`);
        
        updateData.lastEditDetails = logs.join(" / ");
        updateData.lastEditAt = firebase.firestore.FieldValue.serverTimestamp();
    }
    
    // ফায়ারবেস ডেটাবেসে প্লেয়ারের প্রোফাইল আপডেট
    await db.collection('players').doc(playerId).update(updateData);
        
// যদি ম্যানেজার তার প্রোফাইল এডিট করে, তবে ম্যানেজারের ডকুমেন্টেও তার নাম, টিমের নাম এবং লোগো আপডেট করে দেওয়া হবে
if (state.role === 'manager') {
    await db.collection('managers').doc(u.id).update({
        name: name,
        teamName: teamName,
        logo: teamLogo
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

// Global helper function for generating Stats list cards
function generateStatsListHtml(list, type, colorClass, valueKey) {
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
}

function renderPlayerStats(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const stats = {};
    state.players.forEach(p => {
        stats[p.id] = { goals: 0, matchWins: 0, mvps: 0, playerObj: p };
    });
    
    const completedMatches = state.matches.filter(m => m.status === 'completed');
    completedMatches.forEach(m => {
        if (m.mvpId && stats[m.mvpId]) stats[m.mvpId].mvps += 1;
        
        (m.matchups || []).forEach(mu => {
            if (mu.p1Id && stats[mu.p1Id]) stats[mu.p1Id].goals += (mu.score1 || 0);
            if (mu.p2Id && stats[mu.p2Id]) stats[mu.p2Id].goals += (mu.score2 || 0);
            
            if (mu.score1 > mu.score2) {
                if (mu.p1Id && stats[mu.p1Id]) stats[mu.p1Id].matchWins += 1;
            } else if (mu.score2 > mu.score1) {
                if (mu.p2Id && stats[mu.p2Id]) stats[mu.p2Id].matchWins += 1;
            }
        });
    });
    
    const playersArr = Object.values(stats);
    
    // Sort all available ranking players
    const allScorers = [...playersArr].filter(p => p.goals > 0).sort((a, b) => b.goals - a.goals);
    const allWins = [...playersArr].filter(p => p.matchWins > 0).sort((a, b) => b.matchWins - a.matchWins);
    const allMvps = [...playersArr].filter(p => p.mvps > 0).sort((a, b) => b.mvps - a.mvps);
    
    // Limit to Top 3 for default view
    const topScorers = allScorers.slice(0, 3);
    const topWins = allWins.slice(0, 3);
    const topMvps = allMvps.slice(0, 3);
    
    let html = `
    <div class="mb-6">
        <h3 class="text-[11px] font-black text-emerald-400 uppercase tracking-widest mb-3 flex items-center gap-2"><i data-lucide="goal" class="w-4 h-4"></i> Golden Boot (Goals)</h3>
        ${generateStatsListHtml(topScorers, 'Goals', 'text-emerald-400', 'goals')}
        ${allScorers.length > 3 ? `<button onclick="openAllStatsModal('goals')" class="w-full mt-2 py-3.5 bg-slate-900 border border-white/10 text-emerald-400 rounded-xl text-[9px] font-black uppercase tracking-widest hover:border-emerald-500/30 transition-all shadow-inner flex items-center justify-center gap-2">View All ${allScorers.length} Players <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i></button>` : ''}
    </div>
    <div class="mb-6">
        <h3 class="text-[11px] font-black text-blue-400 uppercase tracking-widest mb-3 flex items-center gap-2"><i data-lucide="swords" class="w-4 h-4"></i> Match Winners (1v1 Wins)</h3>
        ${generateStatsListHtml(topWins, 'Wins', 'text-blue-400', 'matchWins')}
        ${allWins.length > 3 ? `<button onclick="openAllStatsModal('wins')" class="w-full mt-2 py-3.5 bg-slate-900 border border-white/10 text-blue-400 rounded-xl text-[9px] font-black uppercase tracking-widest hover:border-blue-500/30 transition-all shadow-inner flex items-center justify-center gap-2">View All ${allWins.length} Players <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i></button>` : ''}
    </div>
    <div class="mb-2">
        <h3 class="text-[11px] font-black text-gold-400 uppercase tracking-widest mb-3 flex items-center gap-2"><i data-lucide="star" class="w-4 h-4"></i> Most Valuable Player</h3>
        ${generateStatsListHtml(topMvps, 'MVPs', 'text-gold-400', 'mvps')}
        ${allMvps.length > 3 ? `<button onclick="openAllStatsModal('mvps')" class="w-full mt-2 py-3.5 bg-slate-900 border border-white/10 text-gold-400 rounded-xl text-[9px] font-black uppercase tracking-widest hover:border-gold-500/30 transition-all shadow-inner flex items-center justify-center gap-2">View All ${allMvps.length} Players <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i></button>` : ''}
    </div>`;
    
    container.innerHTML = html;
    lucide.createIcons();
}

function openAllStatsModal(type) {
    const stats = {};
    state.players.forEach(p => {
        stats[p.id] = { goals: 0, matchWins: 0, mvps: 0, playerObj: p };
    });
    
    const completedMatches = state.matches.filter(m => m.status === 'completed');
    completedMatches.forEach(m => {
        if (m.mvpId && stats[m.mvpId]) stats[m.mvpId].mvps += 1;
        (m.matchups || []).forEach(mu => {
            if (mu.p1Id && stats[mu.p1Id]) stats[mu.p1Id].goals += (mu.score1 || 0);
            if (mu.p2Id && stats[mu.p2Id]) stats[mu.p2Id].goals += (mu.score2 || 0);
            if (mu.score1 > mu.score2) { if (mu.p1Id && stats[mu.p1Id]) stats[mu.p1Id].matchWins += 1; }
            else if (mu.score2 > mu.score1) { if (mu.p2Id && stats[mu.p2Id]) stats[mu.p2Id].matchWins += 1; }
        });
    });
    
    const playersArr = Object.values(stats);
    let list = [];
    let title = '';
    let colorClass = '';
    let valueKey = '';
    let typeLabel = '';
    
    if (type === 'goals') {
        list = playersArr.filter(p => p.goals > 0).sort((a, b) => b.goals - a.goals);
        title = '<i data-lucide="goal" class="w-4 h-4 text-emerald-400 inline mb-0.5"></i> Golden Boot List';
        colorClass = 'text-emerald-400';
        valueKey = 'goals';
        typeLabel = 'Goals';
    } else if (type === 'wins') {
        list = playersArr.filter(p => p.matchWins > 0).sort((a, b) => b.matchWins - a.matchWins);
        title = '<i data-lucide="swords" class="w-4 h-4 text-blue-400 inline mb-0.5"></i> Match Winners List';
        colorClass = 'text-blue-400';
        valueKey = 'matchWins';
        typeLabel = 'Wins';
    } else if (type === 'mvps') {
        list = playersArr.filter(p => p.mvps > 0).sort((a, b) => b.mvps - a.mvps);
        title = '<i data-lucide="star" class="w-4 h-4 text-gold-400 inline mb-0.5"></i> MVP Ranking List';
        colorClass = 'text-gold-400';
        valueKey = 'mvps';
        typeLabel = 'MVPs';
    }
    
    const html = generateStatsListHtml(list, typeLabel, colorClass, valueKey);
    
    document.getElementById('generic-modal-title').innerHTML = title;
    document.getElementById('generic-modal-body').innerHTML = `<div class="space-y-1 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2 pb-2">${html}</div>`;
    document.getElementById('generic-modal-btn').classList.add('hidden'); // We only need it for viewing
    
    openModal('modal-generic');
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

// ==================== BIDDING PHASE VISIBILITY LOGIC ====================
async function toggleBiddingPhase() {
    // ডিফল্টভাবে true থাকে। currentStatus বের করে উল্টে (toggle) দেওয়া হচ্ছে।
    const currentStatus = state.settings.isBiddingOpen !== false;
    const newStatus = !currentStatus;
    
    try {
        await db.collection('settings').doc('tournament').set({ isBiddingOpen: newStatus }, { merge: true });
        notify(newStatus ? 'Bidding Phase Unlocked & Visible!' : 'Bidding Phase Locked & Hidden!', 'check-circle');
    } catch (e) {
        notify('Failed to update visibility setting', 'x-circle');
    }
}

function applyBiddingVisibility() {
    const isOpen = state.settings.isBiddingOpen !== false; // true by default
    
    // Player UI Updates
    const pNavBid = document.getElementById('pnav-bid');
    
    if (pNavBid) {
        // ফ্লেক্স লেআউট ঠিক রাখার জন্য none এবং flex ব্যবহার করা হলো
        pNavBid.style.display = isOpen ? 'flex' : 'none';
    }
    
    if (!isOpen && state.role === 'player') {
        // প্লেয়ার যদি বিডিং ট্যাবে থাকে এবং তখন অ্যাডমিন হাইড করে দেয়, তবে তাকে হোমে পাঠিয়ে দেওয়া হবে
        const pTabBid = document.getElementById('p-tab-bid');
        if (pTabBid && !pTabBid.classList.contains('hidden')) {
            switchPTab('home');
            notify('Bidding phase has ended!', 'info');
        }
    }
}

// ==================== PREMIUM LINEUP PREVIEW (FOR SCREENSHOTS) ====================
function openLineupPreview(matchId) {
    const m = state.matches.find(x => x.id === matchId);
    if (!m) return;
    
    const t1 = state.managers.find(mg => mg.id === m.team1Id);
    const t2 = state.managers.find(mg => mg.id === m.team2Id);
    
    let html = `
    <!-- Premium Background Glow Effects -->
    <div class="absolute top-[0%] left-[-20%] w-[140%] h-[50%] bg-gradient-to-br from-blue-600/10 via-emerald-600/5 to-transparent blur-[80px] pointer-events-none"></div>
    <div class="absolute bottom-[0%] right-[-20%] w-[140%] h-[50%] bg-gradient-to-tl from-gold-600/10 via-rose-600/5 to-transparent blur-[80px] pointer-events-none"></div>
    
    <div class="relative z-10 w-full flex flex-col items-center mt-14">
        <!-- Tournament Header -->
        <div class="text-center mb-8">
            <h2 class="text-[16px] font-black text-white uppercase tracking-[0.4em] mb-2 drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">SLC BID TOURNAMENT</h2>
            <div class="inline-flex items-center justify-center gap-2 bg-white/10 backdrop-blur-md border border-white/20 px-5 py-1.5 rounded-full text-[10px] font-black text-gold-400 tracking-[0.2em] uppercase shadow-[0_0_20px_rgba(245,158,11,0.2)]">
                <i data-lucide="swords" class="w-3.5 h-3.5"></i> Match ${m.matchNumber || '#'} • Official Lineup
            </div>
        </div>

        <!-- Teams VS Area -->
        <div class="flex items-start justify-between w-full mb-10 relative px-2">
            <div class="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl font-black text-slate-700 italic opacity-40 tracking-[0.2em] z-0">VS</div>
            
            <!-- Team 1 (Home) -->
            <div class="flex flex-col items-center w-[42%] text-center relative z-10">
                <div class="relative w-20 h-20 mb-3">
                    <div class="absolute inset-0 bg-blue-500/20 rounded-2xl blur-xl animate-pulse"></div>
                    ${getAvatarUI({name: t1?.teamName, avatar: t1?.logo}, 'w-full', 'h-full', 'rounded-2xl border-2 border-blue-400/50 shadow-[0_0_25px_rgba(59,130,246,0.4)] object-contain bg-slate-900 relative z-10')}
                </div>
                <div class="text-[13px] font-black text-white uppercase tracking-wider leading-tight drop-shadow-md">${t1?.teamName || 'TBD'}</div>
                <div class="text-[9px] text-blue-400 font-black uppercase mt-1.5 tracking-[0.2em] bg-blue-500/10 px-3 py-0.5 rounded-md border border-blue-500/20">HOME</div>
            </div>
            
            <!-- Team 2 (Away) -->
            <div class="flex flex-col items-center w-[42%] text-center relative z-10">
                <div class="relative w-20 h-20 mb-3">
                    <div class="absolute inset-0 bg-emerald-500/20 rounded-2xl blur-xl animate-pulse"></div>
                    ${getAvatarUI({name: t2?.teamName, avatar: t2?.logo}, 'w-full', 'h-full', 'rounded-2xl border-2 border-emerald-400/50 shadow-[0_0_25px_rgba(16,185,129,0.4)] object-contain bg-slate-900 relative z-10')}
                </div>
                <div class="text-[13px] font-black text-white uppercase tracking-wider leading-tight drop-shadow-md">${t2?.teamName || 'TBD'}</div>
                <div class="text-[9px] text-emerald-400 font-black uppercase mt-1.5 tracking-[0.2em] bg-emerald-500/10 px-3 py-0.5 rounded-md border border-emerald-500/20">AWAY</div>
            </div>
        </div>

        <!-- Players Lineup Grid -->
        <div class="w-full space-y-3 relative z-10">
    `;
    
    const maxLen = Math.max((m.lineup1 || []).length, (m.lineup2 || []).length);
    for (let i = 0; i < maxLen; i++) {
        const p1 = state.players.find(p => p.id === m.lineup1[i]);
        const p2 = state.players.find(p => p.id === m.lineup2[i]);
        
        html += `
        <div class="flex items-stretch justify-between w-full bg-slate-900/80 border border-white/10 rounded-[1.2rem] overflow-hidden shadow-2xl backdrop-blur-md relative">
            
            <!-- Player 1 Side -->
            <div class="flex items-center gap-2.5 p-2.5 w-[46%] bg-gradient-to-r from-blue-900/30 to-transparent relative">
                <div class="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)]"></div>
                ${getAvatarUI(p1, 'w-10', 'h-10', 'rounded-xl border border-blue-500/40 object-cover flex-shrink-0 shadow-md bg-slate-800')}
                <div class="flex-1 min-w-0">
<div class="text-[10px] font-black text-white uppercase truncate tracking-wide flex items-center gap-1">${p1?.name || 'Pending'} ${getDisciplineBadge(p1)}</div>
                    <div class="text-[7px] text-blue-300 font-bold truncate mt-0.5 tracking-widest flex items-center gap-1"><i data-lucide="gamepad-2" class="w-2 h-2"></i> ${p1?.konamiId || 'N/A'}</div>
                </div>
            </div>
            
            <!-- Center Rank Divider -->
            <div class="w-[8%] flex items-center justify-center bg-black/60 border-x border-white/10 z-10 shadow-inner">
                <span class="text-[11px] font-black text-gold-500 drop-shadow-[0_0_5px_rgba(245,158,11,0.6)]">${i+1}</span>
            </div>

            <!-- Player 2 Side -->
            <div class="flex items-center gap-2.5 p-2.5 w-[46%] bg-gradient-to-l from-emerald-900/30 to-transparent flex-row-reverse text-right relative">
                <div class="absolute right-0 top-0 bottom-0 w-1 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]"></div>
                ${getAvatarUI(p2, 'w-10', 'h-10', 'rounded-xl border border-emerald-500/40 object-cover flex-shrink-0 shadow-md bg-slate-800')}
                <div class="flex-1 min-w-0">
<div class="text-[10px] font-black text-white uppercase truncate tracking-wide flex items-center justify-end gap-1">${getDisciplineBadge(p2)} ${p2?.name || 'Pending'}</div>
                    <div class="text-[7px] text-emerald-300 font-bold truncate mt-0.5 tracking-widest flex items-center justify-end gap-1">${p2?.konamiId || 'N/A'} <i data-lucide="gamepad-2" class="w-2 h-2"></i></div>
                </div>
            </div>
            
        </div>`;
    }
    
    html += `
        </div>
        
        <!-- Footer Branding -->
        <div class="mt-10 text-center opacity-60">
            <img src="logo.png" class="w-10 h-10 mx-auto mb-3 grayscale contrast-125 drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]" alt="" onerror="this.style.display='none'">
            <p class="text-[7px] font-black text-slate-400 uppercase tracking-[0.4em]">Synthex Legion Chronicles</p>
            <p class="text-[6px] font-bold text-slate-600 mt-1 uppercase tracking-widest">Official eFootball Tournament</p>
        </div>
    </div>`;
    
    document.getElementById('lineup-preview-wrapper').innerHTML = html;
    openModal('modal-lineup-preview');
    lucide.createIcons();
}

function openMatchResultPreview(matchId) {
    const m = state.matches.find(x => x.id === matchId);
    if (!m) return;

    const t1 = state.managers.find(mg => mg.id === m.team1Id);
    const t2 = state.managers.find(mg => mg.id === m.team2Id);
    const mvp = state.players.find(p => p.id === m.mvpId);

    // Find MVP Scoreline dynamically
    let mvpScore = 0;
    let mvpOpponentScore = 0;
    if (mvp && m.matchups) {
        m.matchups.forEach(mu => {
            if (mu.p1Id === mvp.id) { mvpScore = mu.score1; mvpOpponentScore = mu.score2; }
            if (mu.p2Id === mvp.id) { mvpScore = mu.score2; mvpOpponentScore = mu.score1; }
        });
    }

    // Dynamic Data from Admin Schedule Settings
    const matchNum = m.matchNumber || '#';
    const roundName = m.round ? m.round.toUpperCase() : 'GROUP STAGE';
    const refereeName = m.referee ? m.referee.toUpperCase() : 'SET BY ADMIN';

    let html = `
    <!-- Premium Background Glow Effects -->
    <div class="absolute top-[0%] left-[-20%] w-[140%] h-[50%] bg-gradient-to-br from-blue-600/10 via-emerald-600/5 to-transparent blur-[80px] pointer-events-none"></div>
    <div class="absolute bottom-[0%] right-[-20%] w-[140%] h-[50%] bg-gradient-to-tl from-gold-600/10 via-rose-600/5 to-transparent blur-[80px] pointer-events-none"></div>

    <div class="relative z-10 w-full flex flex-col items-center mt-8">
        <!-- Tournament Header & Match Info -->
        <div class="text-center mb-8 w-full">
            <h2 class="text-[16px] font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-slate-400 uppercase tracking-[0.4em] mb-3 drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">SLC BID TOURNAMENT</h2>
            
            <div class="flex items-center justify-center gap-2 mb-2.5">
                <span class="bg-black/40 backdrop-blur-md border border-emerald-500/30 px-3 py-1 rounded-md text-[9px] font-black text-emerald-400 tracking-[0.2em] uppercase shadow-[0_0_15px_rgba(16,185,129,0.15)]">MATCH ${matchNum}</span>
                <span class="bg-black/40 backdrop-blur-md border border-gold-500/30 px-3 py-1 rounded-md text-[9px] font-black text-gold-400 tracking-[0.2em] uppercase shadow-[0_0_15px_rgba(245,158,11,0.15)]">${roundName}</span>
            </div>
            
            <div class="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-full text-[8px] font-black text-slate-300 tracking-widest uppercase border border-slate-700 bg-slate-900/80 shadow-inner mt-1">
                <i data-lucide="clock" class="w-3 h-3 text-emerald-500"></i> FULL TIME RESULT
            </div>
        </div>

        <!-- Teams & Main Score Area -->
        <div class="flex items-center justify-between w-full mb-2 relative px-2">
            <!-- Team 1 -->
            <div class="flex flex-col items-center w-[35%] text-center relative z-10">
                <div class="relative w-16 h-16 mb-2">
                    <div class="absolute inset-0 bg-blue-500/20 rounded-2xl blur-xl"></div>
                    ${getAvatarUI({name: t1?.teamName, avatar: t1?.logo}, 'w-full', 'h-full', 'rounded-2xl border border-blue-400/50 shadow-[0_0_15px_rgba(59,130,246,0.3)] object-contain bg-slate-900 relative z-10')}
                </div>
                <div class="text-[11px] font-black text-white uppercase tracking-wider leading-tight drop-shadow-md">${t1?.teamName || 'TBD'}</div>
            </div>

            <!-- Center Score -->
            <div class="flex flex-col items-center w-[30%] relative z-10">
                <div class="flex items-center justify-center gap-3">
                    <span class="text-4xl font-black text-emerald-400 drop-shadow-[0_0_20px_rgba(16,185,129,0.6)] tracking-tighter">${m.mainScore1 || 0}</span>
                    <span class="text-lg font-black text-slate-600">-</span>
                    <span class="text-4xl font-black text-emerald-400 drop-shadow-[0_0_20px_rgba(16,185,129,0.6)] tracking-tighter">${m.mainScore2 || 0}</span>
                </div>
            </div>

            <!-- Team 2 -->
            <div class="flex flex-col items-center w-[35%] text-center relative z-10">
                <div class="relative w-16 h-16 mb-2">
                    <div class="absolute inset-0 bg-emerald-500/20 rounded-2xl blur-xl"></div>
                    ${getAvatarUI({name: t2?.teamName, avatar: t2?.logo}, 'w-full', 'h-full', 'rounded-2xl border border-emerald-400/50 shadow-[0_0_15px_rgba(16,185,129,0.3)] object-contain bg-slate-900 relative z-10')}
                </div>
                <div class="text-[11px] font-black text-white uppercase tracking-wider leading-tight drop-shadow-md">${t2?.teamName || 'TBD'}</div>
            </div>
        </div>

        <!-- Premium Highlighted MVP Section (With Score) -->
        ${mvp ? `
        <div class="w-full max-w-[90%] mx-auto mt-4 mb-6 relative">
            <div class="absolute inset-0 bg-gold-500/20 blur-2xl rounded-full animate-pulse"></div>
            <div class="bg-gradient-to-r from-gold-900/60 via-black/80 to-gold-900/60 border border-gold-500/40 rounded-[1.5rem] p-3 relative z-10 flex items-center justify-between shadow-[0_0_25px_rgba(245,158,11,0.3)] backdrop-blur-md">
                <div class="flex items-center gap-3 pl-2">
                    ${getAvatarUI(mvp, 'w-12', 'h-12', 'rounded-xl border border-gold-400 shadow-[0_0_15px_rgba(245,158,11,0.5)] object-cover bg-slate-900')}
                    <div>
                        <div class="text-[13px] font-black text-white uppercase tracking-wider">${mvp.name}</div>
                        <div class="text-[7px] text-gold-400 font-black uppercase tracking-[0.2em] mt-0.5 flex items-center gap-1"><i data-lucide="star" class="w-2.5 h-2.5"></i> Man of the Match</div>
                    </div>
                </div>
                <!-- MVP Score Block -->
                <div class="pr-4 flex flex-col items-center justify-center border-l border-gold-500/20 pl-4 h-full">
                    <span class="text-[7px] text-gold-500/70 font-black uppercase tracking-widest mb-0.5">Score</span>
                    <span class="text-[16px] font-black text-gold-400 drop-shadow-[0_0_5px_rgba(245,158,11,0.5)] leading-none">${mvpScore} - ${mvpOpponentScore}</span>
                </div>
            </div>
        </div>
        ` : '<div class="h-6"></div>'}

        <!-- Players Matchups Grid -->
        <div class="w-full space-y-2 relative z-10 px-2">
    `;

    const maxLen = Math.max((m.lineup1 || []).length, (m.lineup2 ||[]).length);
    for (let i = 0; i < maxLen; i++) {
        const p1Id = m.matchups?.[i]?.p1Id || m.lineup1[i];
        const p2Id = m.matchups?.[i]?.p2Id || m.lineup2[i];
        
        const p1 = state.players.find(p => p.id === p1Id);
        const p2 = state.players.find(p => p.id === p2Id);
        
        const s1 = m.matchups?.[i]?.score1 || 0;
        const s2 = m.matchups?.[i]?.score2 || 0;
        
        const p1Color = s1 > s2 ? 'text-emerald-400 drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]' : (s1 === s2 ? 'text-slate-300' : 'text-slate-500');
        const p2Color = s2 > s1 ? 'text-emerald-400 drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]' : (s1 === s2 ? 'text-slate-300' : 'text-slate-500');

        html += `
        <div class="flex items-center justify-between w-full bg-slate-900/60 border border-white/10 rounded-xl overflow-hidden shadow-lg backdrop-blur-md relative p-2">
            <!-- Player 1 Side -->
            <div class="flex items-center gap-2 w-[38%]">
                ${getAvatarUI(p1, 'w-8', 'h-8', 'rounded-lg border border-white/10 object-cover flex-shrink-0 bg-slate-800')}
<div class="text-[9px] font-black text-white uppercase truncate tracking-wide flex items-center gap-1">${p1?.name || '--'} ${getDisciplineBadge(p1)}</div>
            </div>
            
            <!-- Scores -->
            <div class="flex items-center justify-center gap-2.5 w-[24%] bg-black/40 py-1.5 rounded-lg border border-white/5 shadow-inner">
                <span class="text-[13px] font-black ${p1Color}">${s1}</span>
                <span class="text-[7px] font-black text-slate-600">VS</span>
                <span class="text-[13px] font-black ${p2Color}">${s2}</span>
            </div>

            <!-- Player 2 Side -->
            <div class="flex items-center justify-end gap-2 w-[38%] text-right">
<div class="text-[9px] font-black text-white uppercase truncate tracking-wide flex items-center justify-end gap-1">${getDisciplineBadge(p2)} ${p2?.name || '--'}</div>
                ${getAvatarUI(p2, 'w-8', 'h-8', 'rounded-lg border border-white/10 object-cover flex-shrink-0 bg-slate-800')}
            </div>
        </div>`;
    }

    html += `
        </div>
        
        <!-- Premium Footer & Referee Info -->
        <div class="mt-10 w-full relative z-10 px-4 pb-6">
            
            <!-- Professional Referee Banner -->
            <div class="w-full bg-gradient-to-r from-slate-900/40 via-slate-800/80 to-slate-900/40 border border-white/10 rounded-2xl p-3.5 flex flex-col items-center justify-center gap-1.5 mb-6 shadow-xl backdrop-blur-md relative overflow-hidden">
                <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.05)_0%,transparent_70%)] pointer-events-none"></div>
                <span class="text-[8px] text-slate-400 font-bold uppercase tracking-[0.2em] flex items-center justify-center gap-1.5 relative z-10">
                    <i data-lucide="flag" class="w-3.5 h-3.5 text-emerald-400"></i> OFFICIAL MATCH REFEREE
                </span>
                <span class="text-[14px] text-white font-black uppercase tracking-[0.1em] relative z-10 drop-shadow-md">
                    ${refereeName}
                </span>
            </div>

            <!-- Footer Branding -->
            <div class="text-center opacity-90 relative">
                <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-16 bg-emerald-500/10 blur-xl rounded-full pointer-events-none"></div>
                <img src="logo.png" class="w-12 h-12 mx-auto mb-3 object-contain drop-shadow-[0_0_15px_rgba(255,255,255,0.15)] relative z-10" alt="" onerror="this.style.display='none'">
                <p class="text-[10px] font-black text-transparent bg-clip-text bg-gradient-to-r from-slate-300 to-white uppercase tracking-[0.4em] relative z-10 drop-shadow-md">Synthex Legion Chronicles</p>
                <div class="flex items-center justify-center gap-3 mt-3 relative z-10">
                    <div class="h-[1px] w-10 bg-gradient-to-r from-transparent to-slate-500"></div>
                    <p class="text-[6px] font-bold text-emerald-400 uppercase tracking-[0.2em]">Official eFootball Match Result</p>
                    <div class="h-[1px] w-10 bg-gradient-to-l from-transparent to-slate-500"></div>
                </div>
            </div>
        </div>
    </div>`;

    document.getElementById('lineup-preview-wrapper').innerHTML = html;
    openModal('modal-lineup-preview');
    lucide.createIcons();
}

// ==================== RULES TAB & LANGUAGE TOGGLE ====================

let currentRulesLang = 'bn'; // Default language is Bengali

function toggleRulesLang(containerId) {
    currentRulesLang = currentRulesLang === 'bn' ? 'en' : 'bn';
    renderRulesTab(containerId);
}

function renderRulesTab(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const isBn = currentRulesLang === 'bn';
    
    // Content Database (Bilingual)
    const texts = {
        header: isBn ? "অফিসিয়াল রুলস বুক" : "Official Rules Book",
        subHeader: isBn ? "টুর্নামেন্টের নিয়মাবলী ও নির্দেশিকা" : "Tournament Guidelines & Regulations",
        bookIntro: isBn ? "সম্পূর্ণ টুর্নামেন্টটি SYNTHEX LEGION CHRONICLES ক্লাবের RULES BOOK অনুসারে পরিচালিত হবে।" : "The entire tournament will be conducted according to the SYNTHEX LEGION CHRONICLES RULES BOOK.",
        bookLink: "অফিসিয়াল রুলস বুক পড়ুন",
        
        rule1Title: isBn ? "টুর্নামেন্ট ফরম্যাট" : "Tournament Format",
        rule1Desc: isBn ? "প্রতিটি দল একে অপরের সাথে দুটি করে ম্যাচ খেলবে (HOME এবং AWAY)। গ্রুপ পর্ব শেষে পয়েন্ট টেবিলের শীর্ষ ৪টি দল কোয়ালিফাই করবে।<br><br><span class='text-emerald-400'>১ম ও ২য় দল</span> খেলবে <b>QUALIFIER 1</b>, এবং <span class='text-rose-400'>৩য় ও ৪র্থ দল</span> খেলবে <b>ELIMINATOR</b> রাউন্ড।<br><br>• QUALIFIER 1 বিজয়ী দল সরাসরি ফাইনালে যাবে।<br>• পরাজিত দল ELIMINATOR জয়ীর সাথে QUALIFIER 2 খেলবে।<br>• ELIMINATOR এ হেরে যাওয়া দল টুর্নামেন্ট থেকে বাতিল হবে।<br>• QUALIFIER 2 বিজয়ী দল ফাইনালে যাবে।" : "Each team will play two matches against each other (HOME and AWAY). After the group stage, the top 4 teams on the points table will qualify.<br><br><span class='text-emerald-400'>1st & 2nd</span> will play <b>QUALIFIER 1</b>, and <span class='text-rose-400'>3rd & 4th</span> will play the <b>ELIMINATOR</b>.<br><br>• QUALIFIER 1 winner advances directly to the Final.<br>• The loser plays the ELIMINATOR winner in QUALIFIER 2.<br>• The ELIMINATOR loser is directly eliminated.<br>• QUALIFIER 2 winner advances to the Final.",
        
        rule2Title: isBn ? "রেজিস্ট্রেশন ফি" : "Registration Fees",
        rule2Desc: isBn ? "SLC BID TOURNAMENT - S14 এ প্লেয়ার রেজিস্ট্রেশন ফি <b>৳৩০</b> এবং ম্যানেজার ফি <b>৳১০০</b>।<br><br>ওয়েবসাইটে ঢুকে প্রদত্ত ফিস জমা দিয়ে আপনার রেজিস্ট্রেশন সম্পন্ন করতে হবে। বিকাশ অথবা নগদের মাধ্যমে সেন্ড মানি করে TRXID টি প্রদত্ত বক্সে সাবমিট করলেই রেজিস্ট্রেশন সম্পন্ন হবে। অন্যথায় আপনার রেজিস্ট্রেশন অসম্পূর্ণ থেকে যাবে এবং আপনি টুর্নামেন্টে অংশগ্রহণ করতে পারবেন না।" : "For SLC BID TOURNAMENT - S14, the Player registration fee is <b>৳30</b> and the Manager fee is <b>৳100</b>.<br><br>Fees must be paid via bKash or Nagad (Send Money) and the TRXID must be submitted in the provided box on the website. Without fee payment, your registration will remain incomplete and participation will be denied.",
        
        rule3Title: isBn ? "বেইজ প্রাইস (Base Price)" : "Base Price",
        rule3Desc: isBn ? "LIVE BIDDING এর সময় প্রতিটি নিবন্ধিত খেলোয়াড়ের বেইস প্রাইস বা ভিত্তি মূল্য শুরু হবে <b>৳৫০</b> থেকে। সুতরাং, আপনি মাত্র ৳৩০ দিয়ে রেজিস্ট্রেশন করে সর্বনিম্ন ৳৫০ বেইস প্রাইস পাচ্ছেন।" : "During LIVE BIDDING, the base price for every registered player will start at <b>৳50</b>. This means by registering for only ৳30, you automatically secure a minimum base price of ৳50.",
        
        rule4Title: isBn ? "প্রাইস শেয়ারিং (Percentage)" : "Price Sharing (Percentage)",
        rule4Desc: isBn ? "নিলামে বিক্রি হওয়া মূল্যের <b>৭০%</b> পাবেন খেলোয়াড় নিজে এবং বাকি <b>৩০%</b> ক্লাব পাবে (ক্লাব এই ৩০% টাকা মোট প্রাইস মানিতে যুক্ত করে দিবে)।<br><br><span class='text-gold-400'>উদাহরণ:</span> কোনো খেলোয়াড়ের দাম ১০০ টাকা হলে, উক্ত খেলোয়াড় পাবেন ৭০ টাকা আর ক্লাব পাবে ৩০ টাকা।" : "From the final auction price, the player will receive <b>70%</b> and the club will retain <b>30%</b> (which will be added to the overall prize pool).<br><br><span class='text-gold-400'>Example:</span> If a player is sold for ৳100, the player receives ৳70 and the club receives ৳30.",
        
        rule5Title: isBn ? "শৃঙ্খলা ও রেফারি" : "Disciplinary & Refereeing",
        rule5Desc: isBn ? "ম্যাচ রেফারির সিদ্ধান্তই চূড়ান্ত বলে গণ্য হবে।<br><br>কোনো খেলোয়াড় কোনো ম্যাচে <b>রেড কার্ড (Red Card)</b> দেখলে, উক্ত ম্যাচে প্রতিপক্ষ দল অটোমেটিক <b>১-০</b> গোলে জয়লাভ করবে। এবং রেড কার্ড দেখা খেলোয়াড় পরবর্তী ম্যাচের জন্য সাসপেন্ড থাকবেন।" : "The Match Referee's decision will be considered absolute and final.<br><br>If a player receives a <b>Red Card</b> in any match, the opponent team will automatically be awarded a <b>1-0</b> victory for that match. Additionally, the red-carded player will be suspended for the next match."
    };
    
    const html = `
    <!-- Premium Header Area with Language Toggle -->
    <div class="bg-gradient-to-r from-blue-900/40 via-emerald-900/40 to-transparent border border-white/10 rounded-[1.5rem] p-5 mb-5 relative overflow-hidden shadow-lg flex items-center justify-between">
        <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.1)_0%,transparent_70%)] pointer-events-none"></div>
        <div class="relative z-10 flex-1">
            <h2 class="text-[16px] font-black text-white uppercase italic tracking-tight">${texts.header}</h2>
            <p class="text-[8px] text-emerald-400 font-bold uppercase tracking-widest mt-1">${texts.subHeader}</p>
        </div>
        
        <!-- Language Switcher -->
        <button onclick="toggleRulesLang('${containerId}')" class="relative z-10 flex items-center bg-black/50 border border-white/10 rounded-xl p-1 shadow-inner cursor-pointer hover:border-gold-500/50 transition-all active:scale-95 flex-shrink-0">
            <div class="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-colors ${isBn ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-md' : 'text-slate-500'}">বাংলা</div>
            <div class="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-colors ${!isBn ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-md' : 'text-slate-500'}">EN</div>
        </button>
        <i data-lucide="book-open" class="absolute -right-2 -bottom-4 w-24 h-24 text-white/5 pointer-events-none z-0"></i>
    </div>

    <!-- Official Rules Book Link -->
    <div class="bg-slate-900/80 backdrop-blur-xl border border-gold-500/30 rounded-2xl p-5 shadow-[0_0_20px_rgba(245,158,11,0.1)] mb-5 text-center relative overflow-hidden group">
        <div class="absolute inset-0 bg-gradient-to-r from-gold-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
        <div class="w-12 h-12 bg-gold-500/10 rounded-full flex items-center justify-center mx-auto mb-3 border border-gold-500/20 shadow-inner">
            <i data-lucide="external-link" class="w-5 h-5 text-gold-400"></i>
        </div>
        <p class="text-[10px] text-slate-300 font-bold mb-4 leading-relaxed px-4">${texts.bookIntro}</p>
        <a href="https://tinyurl.com/ya6jp2cr" target="_blank" class="inline-flex items-center gap-2 bg-gradient-to-r from-gold-600 to-gold-500 text-black px-6 py-3 rounded-[1rem] text-[10px] font-black uppercase tracking-[0.15em] shadow-[0_4px_15px_rgba(245,158,11,0.3)] hover:shadow-[0_0_25px_rgba(245,158,11,0.5)] transition-all active:scale-95">
            ${texts.bookLink} <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
        </a>
    </div>

    <!-- The Rules List -->
    <div class="space-y-4">
        <!-- Rule 1 -->
        <div class="bg-black/40 border border-white/5 rounded-[1.2rem] p-4.5 relative overflow-hidden hover:border-emerald-500/30 hover:bg-slate-900/60 transition-all shadow-sm">
            <div class="flex items-center gap-3 mb-3 border-b border-white/5 pb-3">
                <div class="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0 text-emerald-400 shadow-inner">
                    <i data-lucide="swords" class="w-4.5 h-4.5"></i>
                </div>
                <h3 class="text-[12px] font-black text-white uppercase tracking-wider">${texts.rule1Title}</h3>
            </div>
            <p class="text-[11px] text-slate-300 leading-relaxed font-medium">${texts.rule1Desc}</p>
        </div>

        <!-- Rule 2 -->
        <div class="bg-black/40 border border-white/5 rounded-[1.2rem] p-4.5 relative overflow-hidden hover:border-blue-500/30 hover:bg-slate-900/60 transition-all shadow-sm">
            <div class="flex items-center gap-3 mb-3 border-b border-white/5 pb-3">
                <div class="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0 text-blue-400 shadow-inner">
                    <i data-lucide="credit-card" class="w-4.5 h-4.5"></i>
                </div>
                <h3 class="text-[12px] font-black text-white uppercase tracking-wider">${texts.rule2Title}</h3>
            </div>
            <p class="text-[11px] text-slate-300 leading-relaxed font-medium">${texts.rule2Desc}</p>
        </div>

        <!-- Rule 3 -->
        <div class="bg-black/40 border border-white/5 rounded-[1.2rem] p-4.5 relative overflow-hidden hover:border-gold-500/30 hover:bg-slate-900/60 transition-all shadow-sm">
            <div class="flex items-center gap-3 mb-3 border-b border-white/5 pb-3">
                <div class="w-9 h-9 rounded-xl bg-gold-500/10 border border-gold-500/20 flex items-center justify-center flex-shrink-0 text-gold-400 shadow-inner">
                    <i data-lucide="coins" class="w-4.5 h-4.5"></i>
                </div>
                <h3 class="text-[12px] font-black text-white uppercase tracking-wider">${texts.rule3Title}</h3>
            </div>
            <p class="text-[11px] text-slate-300 leading-relaxed font-medium">${texts.rule3Desc}</p>
        </div>

        <!-- Rule 4 -->
        <div class="bg-black/40 border border-white/5 rounded-[1.2rem] p-4.5 relative overflow-hidden hover:border-purple-500/30 hover:bg-slate-900/60 transition-all shadow-sm">
            <div class="flex items-center gap-3 mb-3 border-b border-white/5 pb-3">
                <div class="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center flex-shrink-0 text-purple-400 shadow-inner">
                    <i data-lucide="pie-chart" class="w-4.5 h-4.5"></i>
                </div>
                <h3 class="text-[12px] font-black text-white uppercase tracking-wider">${texts.rule4Title}</h3>
            </div>
            <p class="text-[11px] text-slate-300 leading-relaxed font-medium">${texts.rule4Desc}</p>
        </div>

        <!-- Rule 5 -->
        <div class="bg-black/40 border border-white/5 rounded-[1.2rem] p-4.5 relative overflow-hidden hover:border-rose-500/30 hover:bg-slate-900/60 transition-all shadow-sm">
            <div class="flex items-center gap-3 mb-3 border-b border-white/5 pb-3">
                <div class="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center flex-shrink-0 text-rose-400 shadow-inner">
                    <i data-lucide="alert-triangle" class="w-4.5 h-4.5"></i>
                </div>
                <h3 class="text-[12px] font-black text-white uppercase tracking-wider">${texts.rule5Title}</h3>
            </div>
            <p class="text-[11px] text-slate-300 leading-relaxed font-medium">${texts.rule5Desc}</p>
        </div>
    </div>
    `;
    
    container.innerHTML = html;
    lucide.createIcons();
}

// ==================== DISCIPLINARY SYSTEM HELPER FUNCTIONS ====================

// এই ফাংশনটি প্লেয়ারের নামের পাশে হলুদ/লাল কার্ড বা ব্যানের আইকন দেখাবে
function getDisciplineBadge(p) {
    if (!p || !p.disciplineStatus || p.disciplineStatus === 'none') return '';
    
    if (p.disciplineStatus === 'banned') {
        const banEnd = p.banUntil ? new Date(p.banUntil).toLocaleDateString() : 'Indefinite';
        return `<i data-lucide="ban" class="w-3.5 h-3.5 text-rose-500 inline ml-1 drop-shadow-md" title="Banned until ${banEnd}"></i>`;
    }
    if (p.disciplineStatus === 'red') {
        return `<div class="w-2.5 h-3.5 bg-rose-600 rounded-[2px] inline-block ml-1 shadow-[0_0_5px_rgba(225,29,72,0.8)] border border-rose-400 align-middle" title="Red Card"></div>`;
    }
    if (p.disciplineStatus === 'yellow') {
        return `<div class="w-2.5 h-3.5 bg-yellow-400 rounded-[2px] inline-block ml-1 shadow-[0_0_5px_rgba(250,204,21,0.8)] border border-white/50 align-middle" title="Yellow Card"></div>`;
    }
    return '';
}

// এই ফাংশনটি চেক করবে প্লেয়ারটি বর্তমানে খেলতে পারবে কিনা
function isPlayerSuspended(p) {
    if (!p || !p.disciplineStatus || p.disciplineStatus === 'none' || p.disciplineStatus === 'yellow') return false;
    
    if (p.disciplineStatus === 'red') return true; // Red card means suspended
    
    if (p.disciplineStatus === 'banned') {
        if (!p.banUntil) return true; // Indefinite ban
        return new Date().getTime() < p.banUntil; // Check if ban duration is still active
    }
    return false;
}

// অ্যাডমিন প্যানেল থেকে মোডাল ওপেন করার ফাংশন
function openDisciplineModal(playerId) {
    const p = state.players.find(x => x.id === playerId);
    if (!p) return;
    
    document.getElementById('discipline-player-id').value = p.id;
    document.getElementById('discipline-player-name').textContent = p.name;
    document.getElementById('ban-days-input').value = '';
    
    openModal('modal-discipline');
    lucide.createIcons();
}

// একশন অ্যাপ্লাই করার ফাংশন এবং অটো-লজিক
async function applyDiscipline(action) {
    const playerId = document.getElementById('discipline-player-id').value;
    let banDays = 0;
    let banUntil = null;

    if (action === 'banned') {
        banDays = parseInt(document.getElementById('ban-days-input').value);
        if (!banDays || banDays <= 0) return notify('Enter valid ban days!', 'alert-circle');
        // Calculate milliseconds for ban duration
        banUntil = new Date().getTime() + (banDays * 24 * 60 * 60 * 1000);
    }

    try {
        await db.collection('players').doc(playerId).update({
            disciplineStatus: action,
            banUntil: banUntil
        });

        // যদি রেড কার্ড বা ব্যান হয়, চলমান ম্যাচে অটো-লুজার করে দিবে (১-০)
        if (action === 'red' || action === 'banned') {
            await applyAutoLossForSuspendedPlayer(playerId);
        }

        closeModal('modal-discipline');
        notify('Disciplinary action applied successfully!', 'check-circle');
    } catch (e) {
        notify('Failed to apply discipline', 'x-circle');
    }
}

// চলমান ম্যাচে অটোমেটিক ১-০ গোলে হারানোর ফাংশন
async function applyAutoLossForSuspendedPlayer(playerId) {
    const ongoingMatches = state.matches.filter(m => m.status === 'ongoing');
    
    for (let m of ongoingMatches) {
        let changed = false;
        let newMatchups = [...m.matchups];
        
        newMatchups.forEach((mu) => {
            if (mu.p1Id === playerId) {
                mu.score1 = 0;
                mu.score2 = 1; // Opponent auto-wins 1-0
                mu.tag1 = 'RED CARD';
                changed = true;
            }
            if (mu.p2Id === playerId) {
                mu.score1 = 1; // Opponent auto-wins 1-0
                mu.score2 = 0;
                mu.tag2 = 'RED CARD';
                changed = true;
            }
        });

        if (changed) {
            // Recalculate main team score automatically
            let mainPts1 = 0, mainPts2 = 0;
            newMatchups.forEach(mu => {
                if (mu.score1 > mu.score2) mainPts1 += 3;
                else if (mu.score2 > mu.score1) mainPts2 += 3;
                else if (mu.score1 === mu.score2) { mainPts1 += 1; mainPts2 += 1; }
            });

            await db.collection('matches').doc(m.id).update({ 
                matchups: newMatchups,
                mainScore1: mainPts1,
                mainScore2: mainPts2
            });
        }
    }
}
// ==================== LIVE NEWS TICKER ENGINE ====================
function updateNewsTicker() {
    let newsItems =[];

    // 1. Live Auction Alert
    if (state.settings?.isBiddingOpen && state.bidSession?.status === 'active') {
        newsItems.push(`<span class="text-rose-400">🔥 LIVE PLAYER AUCTION IS CURRENTLY ONGOING!</span>`);
    }

    // 2. Latest 3 Sold Players
    const sortedDrafted = state.players
        .filter(p => p.teamId && p.bidPrice && p.draftedAt)
        .sort((a, b) => {
            let timeA = a.draftedAt?.seconds || 0;
            let timeB = b.draftedAt?.seconds || 0;
            return timeB - timeA;
        })
        .slice(0, 3);
        
    sortedDrafted.forEach(p => {
        const teamName = getTeamName(p.teamId);
        newsItems.push(`💰 <span class="text-white">${p.name}</span> SOLD TO <span class="text-blue-400">${teamName}</span> FOR <span class="text-gold-400">৳${p.bidPrice}</span>`);
    });

    // 3. Latest 3 Match Results
    const recentMatches = [...state.matches]
        .reverse() // Fetches the newest matches first
        .filter(m => m.status === 'completed' && (state.role === 'admin' || m.isPublic))
        .slice(0, 3);
        
    recentMatches.forEach(m => {
        const t1 = getTeamName(m.team1Id);
        const t2 = getTeamName(m.team2Id);
        newsItems.push(`⚔️ RESULT: <span class="text-white">${t1}</span> <span class="text-emerald-400">${m.mainScore1} - ${m.mainScore2}</span> <span class="text-white">${t2}</span>`);
    });

    // 4. Current Table Topper
    const topTeam = getTableTopperForTicker();
    if (topTeam) {
        newsItems.push(`🏆 TABLE TOPPER: <span class="text-gold-400">${topTeam.name}</span> LEADING WITH <span class="text-white">${topTeam.pts} PTS</span>`);
    }

    // 5. Fallback News (If tournament hasn't started yet)
    if (newsItems.length === 0) {
        newsItems.push(`⚡ WELCOME TO SLC BID TOURNAMENT S14`);
        newsItems.push(`🛡️ REGISTRATIONS ARE ONGOING. STAY TUNED FOR LIVE UPDATES!`);
    }

    // Join all items with a styled separator
    const tickerHtml = newsItems.join(`<span class="text-slate-600 px-3 font-black">|</span>`);

    // Inject to UI
    const pTicker = document.getElementById('p-news-ticker');
    const mTicker = document.getElementById('m-news-ticker');
    const aTicker = document.getElementById('a-news-ticker');

    if (pTicker) pTicker.innerHTML = tickerHtml;
    if (mTicker) mTicker.innerHTML = tickerHtml;
    if (aTicker) aTicker.innerHTML = tickerHtml;
}

// Helper function to calculate the top team for the ticker
function getTableTopperForTicker() {
    const approvedManagers = state.managers.filter(m => m.paymentStatus === 'approved');
    if(approvedManagers.length === 0) return null;
    
    const table = {};
    approvedManagers.forEach(m => { table[m.id] = { name: m.teamName, pts: 0, gd: 0, gf: 0, ga: 0 }; });
    
    const completedMatches = state.matches.filter(m => m.status === 'completed');
    completedMatches.forEach(m => {
        const t1id = m.team1Id; const t2id = m.team2Id;
        if (!table[t1id] || !table[t2id]) return;
        
        const t1Pts = m.mainScore1 ?? 0;
        const t2Pts = m.mainScore2 ?? 0;
        
        let t1Goals = 0, t2Goals = 0;
        (m.matchups ||[]).forEach(mu => {
            t1Goals += (mu.score1 || 0);
            t2Goals += (mu.score2 || 0);
        });
        
        table[t1id].gf += t1Goals; table[t1id].ga += t2Goals;
        table[t2id].gf += t2Goals; table[t2id].ga += t1Goals;
        
        if (t1Pts > t2Pts) { table[t1id].pts += 3; }
        else if (t2Pts > t1Pts) { table[t2id].pts += 3; }
        else { table[t1id].pts += 1; table[t2id].pts += 1; }
    });
    
    const sorted = Object.values(table).sort((a, b) => b.pts - a.pts || ((b.gf - b.ga) - (a.gf - a.ga)) || b.gf - a.gf);
    return sorted.length > 0 && sorted[0].pts > 0 ? sorted[0] : null;
}
