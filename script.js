// ==========================================
// 1. CONFIG
// ==========================================
const SUPABASE_URL = 'https://zxcsqybwjldyltocrpdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4Y3NxeWJ3amxkeWx0b2NycGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1OTYwNjQsImV4cCI6MjA4MDE3MjA2NH0.Ff9XBydXZvRe7ELTjT6tfvCFF0SY5csOoPXV96sUqTQ';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// 2. SETUP PETA
// ==========================================
const map = L.map('map', { zoomControl: false }).setView([-7.7956, 110.3695], 13);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);

let markerCluster = L.markerClusterGroup({ maxClusterRadius: 40 });
map.addLayer(markerCluster);

// Variabel Global
let dbJalur = [], dbHalte = [];
let userLat = null, userLng = null, userMarker = null;
let routeControls = []; // Array untuk menyimpan banyak garis rute

// Icons
const iconHalte = L.divIcon({ className: 'custom-pin', html: `<div style="background-color:#FACC15; width:20px; height:20px; border-radius:50%; border:2px solid black;"></div>`, iconSize: [20,20] });
const iconUser = L.divIcon({ className: 'custom-pin', html: `<div style="background-color:#3B82F6; width:20px; height:20px; border-radius:50%; border:3px solid white; box-shadow:0 0 0 3px #3B82F6;"></div>`, iconSize: [20,20] });

// ==========================================
// 3. INIT DATA
// ==========================================
async function initApp() {
    try {
        let { data: dJalur } = await supabase.from('jalur_transjogja').select('*');
        let { data: dHalte } = await supabase.from('halte_transjogja').select('*');
        dbJalur = dJalur || [];
        dbHalte = dHalte || [];

        populateDropdowns();
        renderMarkers();
        locateUser(); // Auto locate saat mulai

        document.getElementById('loading').classList.add('hidden');
    } catch (e) {
        console.error(e);
        alert("Gagal koneksi database.");
    }
}

// Isi Dropdown (Start, End, Filter)
function populateDropdowns() {
    const startSel = document.getElementById('startHalte');
    const endSel = document.getElementById('endHalte');
    const filterSel = document.getElementById('filterJalur');

    // Sort Halte by Nama
    dbHalte.sort((a,b) => a.nama_halte.localeCompare(b.nama_halte));

    dbHalte.forEach(h => {
        const opt = `<option value="${h.id}">${h.nama_halte}</option>`;
        startSel.innerHTML += opt;
        endSel.innerHTML += opt;
    });

    dbJalur.forEach(j => {
        filterSel.innerHTML += `<option value="${j.kode_jalur}">Jalur ${j.kode_jalur}</option>`;
    });
}

// ==========================================
// 4. FITUR UTAMA: ROUTING ALGORITHM
// ==========================================
document.getElementById('btnFindRoute').addEventListener('click', () => {
    const startId = document.getElementById('startHalte').value;
    const endId = document.getElementById('endHalte').value;

    if(startId === endId) return alert("Halte Awal dan Tujuan tidak boleh sama!");
    if(!userLat) alert("Menunggu Lokasi GPS Anda...");

    const startObj = dbHalte.find(h => h.id == startId);
    const endObj = dbHalte.find(h => h.id == endId);

    if(!startObj || !endObj) return;

    calculateTransitRoute(startObj, endObj);
});

function calculateTransitRoute(startNode, endNode) {
    clearRoutes(); // Hapus rute lama

    // 1. Cek Rute Langsung
    const commonLines = startNode.jalur_terkait.filter(j => endNode.jalur_terkait.includes(j));

    if (commonLines.length > 0) {
        // ADA RUTE LANGSUNG
        displayResult(startNode, endNode, commonLines[0], null, null);
        drawDirectRoute(startNode, endNode);
    } else {
        // 2. Cek Rute Transit (2 Leg)
        let transitNode = null;
        let line1 = null;
        let line2 = null;

        // Algoritma: Cari halte penengah
        for (let halte of dbHalte) {
            // Jalur dari Start ke Halte ini
            const leg1 = startNode.jalur_terkait.filter(j => halte.jalur_terkait.includes(j));
            // Jalur dari Halte ini ke End
            const leg2 = endNode.jalur_terkait.filter(j => halte.jalur_terkait.includes(j));

            if (leg1.length > 0 && leg2.length > 0 && halte.id !== startNode.id && halte.id !== endNode.id) {
                transitNode = halte;
                line1 = leg1[0];
                line2 = leg2[0];
                break; // Ketemu satu aja cukup (Greedy)
            }
        }

        if (transitNode) {
            displayResult(startNode, endNode, line1, transitNode, line2);
            drawTransitRoute(startNode, transitNode, endNode);
        } else {
            alert("Maaf, rute terlalu kompleks (membutuhkan lebih dari 1 kali transit).");
        }
    }
}

// Menampilkan Info Rute di UI
function displayResult(start, end, line1Code, transit, line2Code) {
    const container = document.getElementById('resultContainer');
    container.classList.remove('hidden');

    document.getElementById('resStartHalte').innerText = start.nama_halte;
    
    // Setup Bus 1
    const bus1 = dbJalur.find(j => j.kode_jalur === line1Code);
    document.getElementById('resBus1').innerText = `Bus Jalur ${line1Code}`;
    document.getElementById('resRoute1').innerHTML = `
        <li>Naik di: <b>${start.nama_halte}</b></li>
        <li class="text-xs text-slate-500">${bus1.rute_simpel}</li>
        <li>Turun di: <b>${transit ? transit.nama_halte : end.nama_halte}</b></li>
    `;

    // Setup Bus 2 (Transit)
    const stepTransit = document.getElementById('stepTransit');
    if (transit) {
        stepTransit.classList.remove('hidden');
        const bus2 = dbJalur.find(j => j.kode_jalur === line2Code);
        document.getElementById('resTransitHalte').innerText = transit.nama_halte;
        document.getElementById('resBus2').innerText = `Ganti ke Bus Jalur ${line2Code}`;
        document.getElementById('resRoute2').innerHTML = `
            <li>Naik di: <b>${transit.nama_halte}</b></li>
            <li class="text-xs text-slate-500">${bus2.rute_simpel}</li>
            <li>Sampai di: <b>${end.nama_halte}</b></li>
        `;
    } else {
        stepTransit.classList.add('hidden');
    }
}

// ==========================================
// 5. VISUALISASI RUTE (WARNA-WARNI)
// ==========================================
function clearRoutes() {
    routeControls.forEach(c => map.removeControl(c));
    routeControls = [];
}

function addRoutingControl(p1, p2, color, style = 'solid') {
    const control = L.Routing.control({
        waypoints: [L.latLng(p1.latitude, p1.longitude), L.latLng(p2.latitude, p2.longitude)],
        lineOptions: { 
            styles: [{ 
                color: color, 
                opacity: 0.8, 
                weight: 6, 
                dashArray: style === 'dotted' ? '10, 10' : null 
            }] 
        },
        createMarker: () => null, // Hide default markers
        addWaypoints: false,
        draggableWaypoints: false,
        fitSelectedRoutes: false,
        showAlternatives: false,
        containerClassName: 'hidden' // Sembunyikan instruksi teks di peta
    }).addTo(map);
    routeControls.push(control);
}

function drawDirectRoute(start, end) {
    // 1. User -> Start (Abu Dotted)
    if(userLat) addRoutingControl({latitude: userLat, longitude: userLng}, start, '#94a3b8', 'dotted');
    // 2. Start -> End (Kuning)
    addRoutingControl(start, end, '#F59E0B');
    
    // Zoom biar muat
    const bounds = L.latLngBounds([
        [userLat, userLng], 
        [start.latitude, start.longitude], 
        [end.latitude, end.longitude]
    ]);
    map.fitBounds(bounds, {padding: [50,50]});
}

function drawTransitRoute(start, transit, end) {
    // 1. User -> Start (Abu Dotted)
    if(userLat) addRoutingControl({latitude: userLat, longitude: userLng}, start, '#94a3b8', 'dotted');
    // 2. Start -> Transit (Kuning)
    addRoutingControl(start, transit, '#F59E0B');
    // 3. Transit -> End (Biru)
    addRoutingControl(transit, end, '#2563EB');

    const bounds = L.latLngBounds([
        [userLat, userLng], 
        [start.latitude, start.longitude], 
        [transit.latitude, transit.longitude], 
        [end.latitude, end.longitude]
    ]);
    map.fitBounds(bounds, {padding: [50,50]});
}

// ==========================================
// 6. FITUR NEARBY HALTE
// ==========================================
function locateUser() {
    if(!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;

        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.marker([userLat, userLng], {icon: iconUser}).addTo(map).bindPopup("Anda").openPopup();
        map.setView([userLat, userLng], 14);

        calculateNearby();
    });
}

// Rumus Haversine (Hitung Jarak)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius bumi km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function calculateNearby() {
    if(!userLat) return;
    
    // Hitung jarak ke semua halte
    const withDist = dbHalte.map(h => {
        return { ...h, dist: getDistance(userLat, userLng, h.latitude, h.longitude) };
    });

    // Sort terdekat
    withDist.sort((a,b) => a.dist - b.dist);

    // Ambil 3 teratas
    const top3 = withDist.slice(0, 3);
    const container = document.getElementById('nearbyContainer');
    container.innerHTML = '';

    top3.forEach(h => {
        container.innerHTML += `
            <div class="bg-white p-2 rounded border border-slate-200 flex justify-between items-center cursor-pointer hover:bg-slate-50" onclick="focusMap(${h.latitude}, ${h.longitude})">
                <div>
                    <p class="font-bold text-xs text-slate-700">${h.nama_halte}</p>
                    <p class="text-[10px] text-slate-400">${h.dist.toFixed(2)} km dari sini</p>
                </div>
                <span class="text-lg">👉</span>
            </div>
        `;
    });
}

function focusMap(lat, lng) {
    map.flyTo([lat, lng], 17);
}

// Helper Swap
window.swapHalte = function() {
    const s = document.getElementById('startHalte');
    const e = document.getElementById('endHalte');
    const temp = s.value;
    s.value = e.value;
    e.value = temp;
}

// Marker Logic
function renderMarkers() {
    markerCluster.clearLayers();
    dbHalte.forEach(h => {
        const m = L.marker([h.latitude, h.longitude], {icon: iconHalte});
        m.bindPopup(`<b>${h.nama_halte}</b><br>${h.info_lokasi}`);
        m.on('click', () => {
            // Auto set ke Start Halte kalau diklik
            document.getElementById('startHalte').value = h.id;
        });
        markerCluster.addLayer(m);
    });
}

// Event Listeners Lain
document.getElementById('btnRefreshGPS').addEventListener('click', locateUser);

// Start
if(supabase) initApp();