import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, increment, collection, query, orderBy, limit, getDocs, addDoc, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// --- ফায়ারবেস কনফিগারেশন ---
const firebaseConfig = {
    apiKey: "AIzaSyAD0iYQhYwUWdssGzYFHR9kbP1ZQTlsm80",
    authDomain: "free-income-app-eeade.firebaseapp.com",
    projectId: "free-income-app-eeade",
    storageBucket: "free-income-app-eeade.firebasestorage.app",
    messagingSenderId: "780467222664",
    appId: "1:780467222664:web:5f09f8f03833e7b19f873d"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const tg = window.Telegram.WebApp;
tg.expand();

// --- অ্যাপ স্টেট এবং ভেরিয়েবল ---
let currentUser = { 
    id: "000000", name: "Loading...", pp: 0, usdt: 0, 
    totalDeposited: 0, referrals: 0, photo: "", lastBonus: 0, bonusDay: 0,
    miningStartTime: 0, uid: "" 
};
let isMining = false;
let miningTimer = null;
let selectedWithdrawAmount = 0;
let adCooldownMinutes = 5; 

// --- আপনার দেওয়া নতুন অ্যাপ শুরুর ইনিশিয়ালাইজেশন ফাংশন (আপডেটেড) ---
async function init() {
    const tgUser = tg.initDataUnsafe?.user;
    currentUser.id = tgUser ? tgUser.id.toString() : "99999";
    currentUser.name = tgUser ? (tgUser.first_name + (tgUser.last_name ? " " + tgUser.last_name : "")) : "Web User";
    currentUser.photo = tgUser?.photo_url || "";

    // ১. রেফারেল আইডি উদ্ধার করা (start_param: r_123456)
    const startParam = tg.initDataUnsafe?.start_param || null;
    let referrerId = null;
    if (startParam && startParam.startsWith("r_")) {
        referrerId = startParam.replace("r_", "");
    }

    try {
        const settingsSnap = await getDoc(doc(db, "settings", "config"));
        if (settingsSnap.exists()) {
            adCooldownMinutes = settingsSnap.data().adCooldown || 5;
        }
    } catch (e) { console.log("Settings not found."); }

    const userRef = doc(db, "users", currentUser.id);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
        currentUser = { ...currentUser, ...snap.data() };
    } else {
        // ২. নতুন ইউজার ডাটাবেজ তৈরি (Updated with Store Fields)
        const newUser = {
            id: currentUser.id,
            name: currentUser.name,
            pp: 0,
            usdt: 0,
            total_ref_earnings: 0,
            referral_count: 0,
            referredBy: (referrerId && referrerId !== currentUser.id) ? referrerId : null,
            referralRewarded: false, // বোনাস একবার দেওয়ার জন্য লক
            lastBonus: 0,
            bonusDay: 0,
            miningStartTime: 0,
            
            // --- স্টোর প্যাকেজের জন্য নতুন ফিল্ড ---
            isMining2x: false,        // বুস্ট কেনা আছে কি না
            isVerified: false,        // ভেরিফাইড কি না
            mining2xExpiry: 0,        // বুস্টের মেয়াদ শেষ হওয়ার সময়
            
            createdAt: serverTimestamp(),
            lastAdTime_adsgram: 0, 
            lastAdTime_monetag: 0, 
            lastAdTime_adexora: 0, 
            lastAdTime_adexium: 0
        };

        await setDoc(userRef, newUser);
        currentUser = newUser;

        // ৩. রেফারারকে বোনাস প্রদান (Registration সময় একবারই হবে)
        if (newUser.referredBy && !newUser.referralRewarded) {
            const refRef = doc(db, "users", newUser.referredBy);
            const refSnap = await getDoc(refRef);

            if (refSnap.exists()) {
                await updateDoc(refRef, { 
                    referral_count: increment(1), 
                    total_ref_earnings: increment(200), // ২০০ পিপি বোনাস
                    pp: increment(200) 
                });
                // বোনাস দেওয়া হয়েছে নিশ্চিত করতে ইউজারের প্রোফাইল আপডেট
                await updateDoc(userRef, { referralRewarded: true });
            }
        }
    }

    // ৪. রেফারেল লিঙ্ক জেনারেট করা (সঠিক ফরম্যাট: startapp=r_ID)
    const refLinkElement = document.getElementById('ref-link');
    if (refLinkElement) {
        refLinkElement.value = `https://t.me/PPCoin_bot/app?startapp=r_${currentUser.id}`;
    }
    
    checkExistingMining();
    ['adsgram', 'monetag', 'adexora', 'adexium'].forEach(type => checkSpecificAdCooldown(type));
    
    updateUI();
    loadLeaderboard();
    loadTasks();
    window.loadWithdrawHistory();
}

// --- অ্যাড কুলডাউন চেক ---
function checkSpecificAdCooldown(type) {
    const now = Date.now();
    const lastAd = currentUser[`lastAdTime_${type}`] || 0;
    const cooldownMs = adCooldownMinutes * 60 * 1000;
    const diff = now - lastAd;

    if (diff < cooldownMs) {
        const remainingSec = Math.ceil((cooldownMs - diff) / 1000);
        updateSingleAdButton(type, false, remainingSec);
        
        const timer = setInterval(() => {
            const currentNow = Date.now();
            const currentDiff = currentNow - lastAd;
            if (currentDiff >= cooldownMs) {
                clearInterval(timer);
                updateSingleAdButton(type, true);
            } else {
                updateSingleAdButton(type, false, Math.ceil((cooldownMs - currentDiff) / 1000));
            }
        }, 1000);
    } else {
        updateSingleAdButton(type, true);
    }
}

// --- অ্যাড বাটন আপডেট ---
function updateSingleAdButton(type, enabled, seconds = 0) {
    const btn = document.getElementById(`btn-${type}`);
    if (!btn) return;

    if (enabled) {
        btn.disabled = false;
        btn.innerText = "WATCH";
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
    } else {
        btn.disabled = true;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        btn.innerText = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
    }
}

// --- ওয়ালেট কপি ---
window.copyWallet = () => {
    const address = "0x6e27f1aba0cc4e0a39e43efa71c4c2ce9ff46106";
    navigator.clipboard.writeText(address);
    tg.HapticFeedback.impactOccurred('light');
    alert("Wallet Address Copied!");
};

// --- মাইনিং স্ট্যাটাস চেক ---
function checkExistingMining() {
    if (currentUser && currentUser.miningStartTime > 0) {
        const now = Math.floor(Date.now() / 1000);
        const elapsed = now - currentUser.miningStartTime;
        if (elapsed < 900) {
            resumeMining(900 - elapsed, elapsed);
        } else {
            showClaimState();
        }
    }
}

// --- মাইনিং শুরু ---
window.startMining = async () => {
    if (isMining) return;
    const startTime = Math.floor(Date.now() / 1000);
    try {
        await updateDoc(doc(db, "users", currentUser.id), { miningStartTime: startTime });
        currentUser.miningStartTime = startTime;
        resumeMining(900, 0);
    } catch (e) {
        console.error("Mining Start Error:", e);
    }
};

// --- মাইনিং টাইমার (Mining 2x Support সহ আপডেটেড) ---
function resumeMining(remaining, alreadyMined) {
    isMining = true;
    document.getElementById('btn-start').classList.add('hidden');
    document.getElementById('mining-status').innerText = "ACTIVE";
    document.getElementById('robot-svg').classList.add('animate-pulse', 'scale-110');

    if (miningTimer) clearInterval(miningTimer);

    // ১. ইউজার কি ২ গুণ বুস্ট কিনেছে এবং মেয়াদ (৩০ দিন) কি এখনও আছে?
    const isBoostActive = currentUser.isMining2x && (currentUser.mining2xExpiry > Date.now());

    miningTimer = setInterval(() => {
        alreadyMined++;
        remaining--;
        
        // ২. যদি বুস্ট একটিভ থাকে তবে ১২০ পিপি পাবে, না থাকলে সাধারণ ৬০ পিপি
        let totalPP = isBoostActive ? 120 : 60;
        
        // ৩. প্রগতি অনুযায়ী স্ক্রিনে কাউন্টার আপডেট করা
        let currentPP = Math.floor((alreadyMined / 900) * totalPP); 
        
        document.getElementById('local-counter').innerText = currentPP;
        
        if (remaining <= 0) {
            clearInterval(miningTimer);
            // ৪. ক্লেম বাটনের জন্য টোটাল অ্যামাউন্ট পাঠানো
            showClaimState(totalPP);
        }
    }, 1000);
}

// --- মাইনিং ক্লেম স্টেট (বুস্ট সাপোর্ট সহ সম্পূর্ণ আপডেটেড) ---
function showClaimState(amount) {
    isMining = false;
    
    // ১. যদি কোনো অ্যামাউন্ট না পাঠানো হয়, তবে বুস্ট চেক করে ভ্যালু বসাবে
    if (!amount) {
        const isBoostActive = currentUser.isMining2x && (currentUser.mining2xExpiry > Date.now());
        amount = isBoostActive ? 120 : 60;
    }
    
    // স্ক্রিনে রিওয়ার্ড অ্যামাউন্ট (৬০ বা ১২০) দেখানো
    document.getElementById('local-counter').innerText = amount; 
    document.getElementById('mining-status').innerText = "READY";
    document.getElementById('robot-svg').classList.remove('animate-pulse', 'scale-110');
    
    // বাটন কন্ট্রোল
    document.getElementById('btn-claim').classList.remove('hidden');
    document.getElementById('btn-start').classList.add('hidden');
}

// --- রিওয়ার্ড ক্লেম (Mining 2x Support সহ সম্পূর্ণ আপডেটেড) ---
// --- রিওয়ার্ড ক্লেম (Monetag & Adexora Dual Ad Integration) ---
window.claimReward = () => {
    // ১. দুটি অ্যাড এসডিকে লোড হয়েছে কি না তা নিশ্চিত করা
    if (typeof show_10373507 !== 'function' || typeof window.showAdexora !== 'function') {
        alert("Ads are still loading... Please wait 3-5 seconds.");
        return;
    }

    let isMonetagDone = false;
    let isAdexoraDone = false;

    // ২. রিওয়ার্ড প্রসেস ফাংশন (উভয় অ্যাড শেষ হলে কল হবে)
    const processFinalReward = async () => {
        if (isMonetagDone && isAdexoraDone) {
            try {
                const isBoostActive = currentUser.isMining2x && (currentUser.mining2xExpiry > Date.now());
                const rewardAmount = isBoostActive ? 120 : 60;
                const userRef = doc(db, "users", currentUser.id);

                await updateDoc(userRef, { 
                    pp: increment(rewardAmount), 
                    miningStartTime: 0 
                });

                currentUser.pp += rewardAmount;
                currentUser.miningStartTime = 0;

                document.getElementById('btn-claim').classList.add('hidden');
                document.getElementById('btn-start').classList.remove('hidden');
                document.getElementById('local-counter').innerText = "0";
                document.getElementById('mining-status').innerText = "OFFLINE";

                updateUI();
                if (window.Telegram?.WebApp?.HapticFeedback) {
                    tg.HapticFeedback.notificationOccurred('success');
                }
                alert(`Success! You watched both ads and received ${rewardAmount} PP.`);
            } catch (error) {
                console.error("Reward Process Error:", error);
                alert("Database error! Please try again.");
            }
        }
    };

    // ৩. বাটনে ক্লিক করার সাথে সাথে Monetag চালু হবে
    show_10373507().then(() => {
        isMonetagDone = true;
        processFinalReward();
    }).catch(() => {
        alert("Monetag ad not completed. No reward.");
    });

    // ৪. ক্লিক করার ঠিক ৩ সেকেন্ড (৩০০০ms) পর Adexora অটোমেটিক পপ-আপ হবে
    setTimeout(() => {
        window.showAdexora().then(() => {
            isAdexoraDone = true;
            processFinalReward();
        }).catch(() => {
            alert("Adexora ad not completed. No reward.");
        });
    }, 3000);
};
// --- ডেইলি বোনাস মডাল ---
const bonusRewards = [0.0005, 0.0005, 0.0007, 0.0007, 0.0015, 0.002, 0.003];
window.openBonusModal = () => {
    const grid = document.getElementById('bonus-grid');
    grid.innerHTML = '';
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    if (currentUser.lastBonus !== 0 && (now - currentUser.lastBonus) > (dayMs * 2)) {
        currentUser.bonusDay = 0;
    }
    for (let i = 0; i < 7; i++) {
        const box = document.createElement('div');
        box.className = `day-box ${i < currentUser.bonusDay ? 'completed' : (i === currentUser.bonusDay ? 'current' : '')}`;
        box.innerHTML = `<p class="text-[9px]">Day ${i+1}</p><p class="text-[8px]">$${bonusRewards[i]}</p>`;
        grid.appendChild(box);
    }
    const btn = document.getElementById('btn-bonus-claim');
    btn.disabled = (currentUser.lastBonus !== 0 && (now - currentUser.lastBonus) < dayMs);
    btn.innerText = btn.disabled ? "Claimed Today" : "Claim Reward";
    document.getElementById('modal-bonus').classList.remove('hidden');
};

// --- ডেইলি বোনাস ক্লেম ---
window.claimDailyBonus = async () => {
    if (!window.Adsgram) return alert("Ad SDK not loaded!");
    const AdController = window.Adsgram.init({ blockId: "19948" });
    AdController.show().then(async (res) => {
        if (res.done) {
            const reward = bonusRewards[currentUser.bonusDay];
            const nextDay = (currentUser.bonusDay + 1) % 7;
            const userRef = doc(db, "users", currentUser.id);
            await updateDoc(userRef, { usdt: increment(reward), lastBonus: Date.now(), bonusDay: nextDay });
            currentUser.usdt += reward; 
            currentUser.bonusDay = nextDay; 
            currentUser.lastBonus = Date.now();
            updateUI(); 
            closeModal('modal-bonus');
            tg.HapticFeedback.notificationOccurred('success');
            alert("Reward added successfully!");
        }
    }).catch(() => alert("Ads not available right now."));
};

// --- টাস্ক অ্যাড দেখা (Auto & Manual combined) ---
window.watchTaskAd = (type) => {
    if (type === 'adsgram') {
        window.Adsgram.init({ blockId: "int-19947" }).show()
            .then(r => r.done && processTask(0.001, 'adsgram'));
    } 
    else if (type === 'monetag') {
        if(typeof show_10373507 === 'function') {
            show_10373507().then(() => processTask(0.001, 'monetag'));
        } else {
            alert("Monetag SDK is not loaded!");
        }
    } 
    else if (type === 'adexora') {
        if (typeof window.showAdexora === 'function') {
            window.showAdexora()
                .then(() => processTask(0.0005, 'adexora'))
                .catch(() => alert("Adexora Ads not available."));
        } else {
            alert("Adexora SDK not loaded!");
        }
    } 
    else if (type === 'adexium') {
        // বাটন ক্লিকের মাধ্যমে রিওয়ার্ড পাওয়ার লজিক
        const instance = window.adexiumAds || window.adexiumInstance;
        
        if (instance) {
            const btn = document.getElementById('btn-adexium');
            const originalText = btn?.innerText || "WATCH";
            
            if(btn) {
                btn.disabled = true;
                btn.innerText = "Loading...";
            }

            instance.play()
                .then(() => {
                    processTask(0.001, 'adexium'); // বাটন ক্লিকের রিওয়ার্ড
                    if(btn) {
                        btn.disabled = false;
                        btn.innerText = "WATCH";
                    }
                })
                .catch(e => {
                    // এখানে alert সরিয়ে দিয়েছি যাতে ইউজার বিরক্ত না হয়
                    console.log("Adexium manual ad not ready.");
                    if(btn) {
                        btn.disabled = false;
                        btn.innerText = originalText;
                    }
                });
        } else {
            console.log("Adexium is still initializing...");
        }
    }
};

// --- টাস্ক রিওয়ার্ড প্রসেস ---
async function processTask(amount, adType) {
    const now = Date.now();
    const userRef = doc(db, "users", currentUser.id);
    const updateData = { usdt: increment(amount) };
    updateData[`lastAdTime_${adType}`] = now;
    await updateDoc(userRef, updateData);
    currentUser.usdt += amount; 
    currentUser[`lastAdTime_${adType}`] = now;
    updateUI(); 
    checkSpecificAdCooldown(adType); 
    alert("Reward Added!");
}

// --- অ্যাড টাস্ক ফর্ম ওপেন ---
window.openAdTaskForm = () => document.getElementById('modal-adtask').classList.remove('hidden');

// --- অ্যাড টাস্ক জমা দেওয়া ---
window.submitAdTask = async () => {
    const name = document.getElementById('ad-name').value;
    const link = document.getElementById('ad-link').value;
    const target = document.getElementById('ad-target').value;
    const costs = { "100": 1.00, "500": 4.50, "1000": 8.00 };
    const cost = costs[target];
    if (currentUser.usdt < cost) return alert("Insufficient USDT Balance!");
    if (!name || !link) return alert("Fill all fields!");
    await updateDoc(doc(db, "users", currentUser.id), { usdt: increment(-cost) });
    await addDoc(collection(db, "tasks"), {
        name, link, target: parseInt(target), completedCount: 0,
        creatorId: currentUser.id, status: "pending", createdAt: Date.now()
    });
    currentUser.usdt -= cost; 
    updateUI(); 
    closeModal('modal-adtask'); 
    alert("Task submitted for approval!");
    loadTasks();
};

// --- ইউজারের টাস্ক লোড ---
async function loadTasks() {
    const myQ = query(collection(db, "tasks"), where("creatorId", "==", currentUser.id));
    const mySnap = await getDocs(myQ);
    let myHtml = '';
    mySnap.forEach(docSnap => {
        const task = docSnap.data();
        const statusBadge = `<span class="status-badge status-${task.status}">${task.status}</span>`;
        myHtml += `<div class="glass p-3 rounded-xl text-[10px]"><div class="flex justify-between mb-1 font-bold"><span>${task.name}</span>${statusBadge}</div></div>`;
    });
    document.getElementById('my-tasks-list').innerHTML = myHtml || '<p class="text-[10px] text-slate-600 italic">No tasks created.</p>';
}

// --- মডাল ওপেন ---
window.openModal = (id) => document.getElementById(id).classList.remove('hidden');

// --- ডিপোজিট সাবমিট ---
window.submitDeposit = async () => {
    const amount = document.getElementById('dep-amount').value;
    const screenshot = document.getElementById('dep-screenshot').files[0];
    if (!amount || amount <= 0) return alert("Enter a valid amount!");
    if (!screenshot) return alert("Please upload a payment screenshot!");
    try {
        await addDoc(collection(db, "deposits"), {
            userId: currentUser.id, userName: currentUser.name,
            amount: parseFloat(amount), status: "pending", time: Date.now()
        });
        alert("Deposit submitted for Admin Approval!"); 
        closeModal('modal-deposit');
    } catch (e) { alert("Error!"); }
};

// --- উইথড্র অ্যামাউন্ট সিলেকশন ---
window.selectWithdraw = (amt, btnElement) => {
    selectedWithdrawAmount = amt;
    const withdrawBtn = document.getElementById('btn-withdraw');
    if (currentUser.pp >= amt) {
        withdrawBtn.disabled = false;
        withdrawBtn.classList.remove('opacity-50', 'bg-slate-700');
        withdrawBtn.classList.add('bg-blue-600');
    } else {
        withdrawBtn.disabled = true;
        withdrawBtn.classList.add('opacity-50', 'bg-slate-700');
        withdrawBtn.classList.remove('bg-blue-600');
    }
    document.querySelectorAll('.w-btn').forEach(b => {
        b.classList.remove('bg-blue-600', 'text-white', 'border-blue-500');
        b.classList.add('bg-white/5');
    });
    btnElement.classList.add('bg-blue-600', 'text-white', 'border-blue-500');
    btnElement.classList.remove('bg-white/5');
};

// --- উইথড্র রিকোয়েস্ট এক্সিকিউট ---
window.executeWithdraw = async () => {
    const binanceUID = document.getElementById('withdraw-uid').value.trim();
    const btn = document.getElementById('btn-withdraw');
    if (selectedWithdrawAmount === 0) return alert("Please select a withdrawal amount!");
    if (!binanceUID) return alert("Please provide your Binance UID!");
    if (currentUser.pp < selectedWithdrawAmount) return alert("Insufficient balance!");

    try {
        btn.disabled = true;
        btn.innerText = "Processing...";
        await addDoc(collection(db, "withdrawals"), {
            userId: currentUser.id,
            userName: currentUser.name || "Unknown",
            amount: selectedWithdrawAmount,
            wallet: binanceUID,
            method: "Binance",
            status: "pending",
            createdAt: serverTimestamp() 
        });
        await updateDoc(doc(db, "users", currentUser.id), { 
            pp: increment(-selectedWithdrawAmount) 
        });
        currentUser.pp -= selectedWithdrawAmount; 
        updateUI(); 
        alert("Withdrawal request submitted successfully!");
        window.loadWithdrawHistory(); 
    } catch (error) {
        alert("Error: " + error.message);
        btn.disabled = false;
        btn.innerText = "Withdraw PP Now";
    }
};

// --- উইথড্র হিস্ট্রি লোড ---
window.loadWithdrawHistory = async () => {
    const historyList = document.getElementById('withdraw-history-list');
    if (!historyList) return;
    const q = query(collection(db, "withdrawals"), where("userId", "==", currentUser.id));
    try {
        const snap = await getDocs(q);
        let historyData = [];
        snap.forEach(docSnap => {
            historyData.push({ id: docSnap.id, ...docSnap.data() });
        });
        historyData.sort((a, b) => {
            const timeA = a.createdAt?.seconds || 0;
            const timeB = b.createdAt?.seconds || 0;
            return timeB - timeA;
        });
        let html = '';
        if (historyData.length === 0) {
            historyList.innerHTML = '<p class="text-[10px] text-slate-600 italic px-1">No history found.</p>';
            return;
        }
        historyData.slice(0, 10).forEach(data => {
            const date = data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleDateString() : 'Pending...';
            let statusColor = "text-yellow-500"; 
            if(data.status === "successful") statusColor = "text-green-500";
            if(data.status === "rejected") statusColor = "text-red-500";
            html += `<div class="glass p-3 rounded-xl border border-white/5 mb-2"><div class="flex justify-between items-center mb-1"><span class="text-white font-bold text-[11px]">${data.amount} PP Coin</span><span class="text-[9px] font-bold uppercase ${statusColor}">${data.status}</span></div><div class="flex justify-between items-center text-[9px] text-slate-400"><span class="truncate w-32">Binance ID: ${data.wallet}</span><span>${date}</span></div></div>`;
        });
        historyList.innerHTML = html;
    } catch (e) { console.error("History Load Error:", e); }
};

// --- ইন্টারফেস আপডেট (UI) ---
function updateUI() {
    document.getElementById('user-name').innerText = currentUser.name;
    document.getElementById('user-id').innerText = currentUser.id;
    document.getElementById('pp-header').innerText = (currentUser.pp || 0).toFixed(2);
    document.getElementById('usdt-header').innerText = (currentUser.usdt || 0).toFixed(4);
    
    if (document.getElementById('total-ref')) {
        document.getElementById('total-ref').innerText = currentUser.referral_count || 0;
    }
    if (document.getElementById('ref-earn')) {
        document.getElementById('ref-earn').innerText = (currentUser.total_ref_earnings || 0).toFixed(0) + " PP";
    }

    if (currentUser.photo) {
        const img = document.getElementById('user-photo');
        if (img) {
            img.src = currentUser.photo; 
            img.classList.remove('hidden');
        }
        const placeholder = document.getElementById('user-placeholder');
        if (placeholder) placeholder.classList.add('hidden');
    }

    // ৩০ রেফার অথবা কেনা থাকলে ভেরিফাইড ব্যাজ দেখাবে
if ((currentUser.referral_count || 0) >= 30 || currentUser.isVerified) {
    const badge = document.getElementById('verified-badge');
    if (badge) badge.classList.remove('hidden');
}
}

// --- ট্যাব সুইচিং (সম্পূর্ণ আপডেট করা কোড) ---
window.switchTab = (tab, el) => {
    // ১. সব পেজ আগে লুকিয়ে ফেলুন
    document.querySelectorAll('.page-content').forEach(p => p.classList.add('hidden'));
    
    // ২. নেভিগেশন বারের সব বাটন থেকে 'active' স্টাইল সরিয়ে ফেলুন
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    // ৩. এখন কাঙ্ক্ষিত পেজটি দেখান
    const targetPage = document.getElementById(`page-${tab}`);
    if (targetPage) {
        targetPage.classList.remove('hidden');
    }

    // ৪. নেভিগেশন আইকন হাইলাইট করার লজিক
    if (el) {
        // যদি সরাসরি নেভিগেশন বার থেকে ক্লিক করা হয়
        el.classList.add('active');
    } else {
        // যদি হোমপেজের স্টোর বাটন বা অন্য কোথাও থেকে ক্লিক করা হয়,
        // তবে নিচের বারের সঠিক আইকনটি খুঁজে বের করে সেটাকে নীল (Active) করবে।
        const navBtn = document.querySelector(`.nav-btn[onclick*="'${tab}'"]`);
        if (navBtn) navBtn.classList.add('active');
    }
    
    // ৫. টেলিগ্রাম ভাইব্রেশন ফিডব্যাক
    if (window.Telegram?.WebApp?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
};

window.closeModal = (id) => document.getElementById(id).classList.add('hidden');

// --- কপি এবং শেয়ার লিঙ্ক ---
window.copyLink = () => {
    const link = document.getElementById('ref-link').value;
    navigator.clipboard.writeText(link);
    tg.HapticFeedback.impactOccurred('medium'); 
    alert("Copied!");
};

window.shareLink = () => {
    const link = `https://t.me/PPCoin_bot/app?startapp=r_${currentUser.id}`;
    const text = encodeURIComponent("🚀 Start Mining PP Coin and earn 200 PP Bonus! Join now:");
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`);
};

// --- লিডারবোর্ড ফাংশন (রেফারেল অনুযায়ী সাজানো এবং হাইলাইট করা) ---
async function loadLeaderboard() {
    // ১. ডাটাবেজ থেকে সর্বোচ্চ রেফারেল করা ১০০ জনকে নিয়ে আসা
    const q = query(collection(db, "users"), orderBy("referral_count", "desc"), limit(100));
    const snap = await getDocs(q);
    
    let html = '';
    let myRank = 0;
    let myData = null;

    const docs = snap.docs;

    for (let i = 0; i < docs.length; i++) {
        const userData = docs[i].data();
        const isMe = userData.id === currentUser.id;
        
        // ২. বর্তমানে যে ইউজার অ্যাপ দেখছে তার র‍্যাঙ্ক পজিশন খুঁজে বের করা
        if (isMe) {
            myRank = i + 1;
            myData = userData;
        }

        // ৩. প্রধান লিস্টে সেরা ১০ জনকে দেখানো
        if (i < 20) {
            // র‍্যাঙ্ক নাম্বার বা মেডেল লজিক
            let rankDisplay = `#${i + 1}`;
            if (i === 0) rankDisplay = "🥇";
            else if (i === 1) rankDisplay = "🥈";
            else if (i === 2) rankDisplay = "🥉";

            // ভেরিফাইড ব্যাজ লজিক (৩০+ রেফার হলে নীল টিক)
            const isVerified = (userData.referral_count || 0) >= 30;
            const verifiedIcon = isVerified ? `<svg class="w-4 h-4 fill-blue-500 inline-block ml-1" viewBox="0 0 24 24"><path d="M23 12l-2.44-2.79.34-3.69-3.61-.82-1.89-3.2L12 2.96 8.6 1.5 6.71 4.7l-3.61.81.34 3.68L1 12l2.44 2.79-.34 3.69 3.61.82 1.89 3.2L12 21.04l3.4 1.46 1.89-3.2 3.61-.82-.34-3.69L23 12zm-12.91 4.72l-3.8-3.81 1.48-1.48 2.32 2.33 5.85-5.87 1.48 1.48-7.33 7.35z"/></svg>` : '';

            // প্রোফাইল ছবি বা ডিফল্ট আইকন
            const photoUrl = userData.photo || '';
            const photoHTML = photoUrl 
                ? `<img src="${photoUrl}" class="w-8 h-8 rounded-full border border-blue-500/30 object-cover">`
                : `<div class="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-[10px] text-blue-400 font-bold border border-blue-500/20">PP</div>`;

            // ৪. লিডারবোর্ড রো তৈরি (রেফারেল সংখ্যাকে বড় এবং হাইলাইট করা হয়েছে)
            html += `
                <div class="flex justify-between items-center p-4 border-b border-white/5 ${isMe ? 'bg-blue-600/10' : ''}">
                    <div class="flex items-center gap-3 overflow-hidden">
                        <span class="text-sm font-black w-6 text-center">${rankDisplay}</span>
                        ${photoHTML}
                        <div class="flex flex-col">
                            <span class="text-xs font-bold flex items-center ${isMe ? 'text-blue-400' : 'text-white'}">
                                ${userData.name}${verifiedIcon}
                            </span>
                            <span class="text-[10px] text-slate-400 font-bold tracking-tight">${(userData.pp || 0).toFixed(0)} PP COIN</span>
                        </div>
                    </div>
                    
                    <div class="text-right flex flex-col items-end">
                        <span class="text-sm font-black text-green-400 uppercase tracking-tighter">${userData.referral_count || 0} REFS</span>
                        <span class="text-[8px] text-slate-500 font-bold uppercase">Referrals</span>
                    </div>
                </div>`;
        }
    }

    document.getElementById('leaderboard-list').innerHTML = html;

    // ৫. ইউজারের নিজের র‍্যাঙ্ক কার্ড আপডেট (যা সবার উপরে থাকে)
    const myRankContainer = document.getElementById('my-rank-container');
    if (myRankContainer) {
        myRankContainer.classList.remove('hidden');
        
        document.getElementById('my-rank-number').innerText = myRank > 0 ? `#${myRank}` : "100+";
        
        document.getElementById('my-rank-pp').innerHTML = `
            <div class="flex items-center gap-4">
                <div class="text-right">
                    <p class="text-sm font-black text-green-400">${currentUser.referral_count || 0} REFS</p>
                    <p class="text-[10px] font-bold text-blue-400">${(currentUser.pp || 0).toFixed(0)} PP COIN</p>
                </div>
            </div>
        `;
    }
}
// --- স্টোর পারচেজ লজিক ---
window.buyUpgrade = async (plan) => {
    const userRef = doc(db, "users", currentUser.id);
    const cost = 1.00; // আপনার উভয় প্ল্যানের দাম ১ ডলার

    if (currentUser.usdt < cost) {
        alert("Insufficient USDT Balance! Please deposit first.");
        window.switchTab('profile'); // ব্যালেন্স না থাকলে প্রোফাইল/ডিপোজিট পেজে নিয়ে যাবে
        return;
    }

    if (!confirm(`Are you sure you want to buy this upgrade for ${cost} USDT?`)) return;

    try {
        if (plan === 'mining_2x') {
            // মাইনিং ২ গুণ লজিক (ভবিষ্যতে আপনি এটি দিয়ে mining rate ডাবল করবেন)
            await updateDoc(userRef, { 
                usdt: increment(-cost),
                isMining2x: true,
                mining2xExpiry: Date.now() + (30 * 24 * 60 * 60 * 1000) // ৩০ দিন
            });
            alert("Success! Mining 2x activated for 30 days.");
        } 
        else if (plan === 'verification') {
            // ভেরিফিকেশন ব্যাজ লজিক
            await updateDoc(userRef, { 
                usdt: increment(-cost),
                isVerified: true 
            });
            alert("Success! You are now a Verified user.");
        }

        currentUser.usdt -= cost;
        updateUI();
        tg.HapticFeedback.notificationOccurred('success');
    } catch (e) {
        console.error("Purchase Error:", e);
        alert("Something went wrong. Try again.");
    }
};
// অ্যাপ শুরু
init();