// ==========================================
// 1. KONFIGURASI DATABASE
// ==========================================
const SUPABASE_URL = 'https://zxcsqybwjldyltocrpdh.supabase.co'; // <--- URL PROYEK KAMU
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4Y3NxeWJ3amxkeWx0b2NycGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1OTYwNjQsImV4cCI6MjA4MDE3MjA2NH0.Ff9XBydXZvRe7ELTjT6tfvCFF0SY5csOoPXV96sUqTQ'; // <--- KUNCI ANON KAMU
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

console.log("Menghubungkan ke:", SUPABASE_URL);

// ==========================================
// 2. SETUP PETA LEAFLET
// ==========================================
const map = L.map('map', { zoomControl: false }).setView([-7.7956, 110.3695], 13);
L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// GANTI DARI CLUSTER KE LAYER GROUP BIASA (BIAR GAK ERROR)
let markersLayer = L.layerGroup().addTo(map);

// Variabel Global
let dbJalur = [];
let dbHalte = [];
let userLat, userLng, userMarker, routingControl;

// Icon Custom
const halteIcon = L.divIcon({
    className: 'custom-pin',
    html: `<div style="background-color:#FACC15; width:24px; height:24px; border-radius:50%; border:2px solid #000; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:bold;">TJ</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
});

const userIcon = L.divIcon({
    className: 'user-pin',
    html: `<div style="background-color:#3b82f6; width:20px; height:20px; border-radius:50%; border:3px solid white; box-shadow:0 0 0 4px rgba(59,130,246,0.4);"></div>`,
    iconSize: [20, 20]
});

// ==========================================
// 3. LOGIKA UTAMA (FETCH DATA)
// ==========================================
async function initApp() {
    try {
        // Ambil Data JALUR
        let { data: dataJalur, error: errJalur } = await supabase.from('jalur_transjogja').select('*').order('kode_jalur');
        if (errJalur) throw errJalur;
        dbJalur = dataJalur;

        // Ambil Data HALTE
        let { data: dataHalte, error: errHalte } = await supabase.from('halte_transjogja').select('*');
        if (errHalte) throw errHalte;
        dbHalte = dataHalte;

        // Render UI
        isiDropdownJalur();
        renderMarkers();
        
        // Sembunyikan Loading
        document.getElementById('loading').classList.add('hidden');

    } catch (error) {
        console.error("Error:", error);
        alert("Terjadi kesalahan koneksi! Cek Console.");
        document.getElementById('loading').innerHTML = `<p class="text-red-500 font-bold">Gagal Memuat Data.<br>Cek API Key & URL.</p>`;
    }
}

function isiDropdownJalur() {
    const select = document.getElementById('filterJalur');
    dbJalur.forEach(item => {
        const option = document.createElement('option');
        option.value = item.kode_jalur;
        option.innerText = `[${item.kode_jalur}] ${item.rute_simpel}`;
        select.appendChild(option);
    });
}

// ==========================================
// 4. RENDER PETA & FILTER
// ==========================================
function renderMarkers(filterKode = 'all', keyword = '') {
    markersLayer.clearLayers(); // Bersihkan marker lama

    // Update Info Box
    const infoBox = document.getElementById('infoRuteBox');
    if (filterKode !== 'all') {
        const detail = dbJalur.find(j => j.kode_jalur === filterKode);
        if (detail) {
            infoBox.classList.remove('hidden');
            document.getElementById('infoKode').innerText = detail.kode_jalur;
            document.getElementById('infoNamaRute').innerText = detail.rute_simpel;
            document.getElementById('infoJam').innerText = detail.jam_ops;
            document.getElementById('infoDetail').innerText = detail.rute_lengkap;
        }
    } else {
        infoBox.classList.add('hidden');
    }

    // Loop Halte
    dbHalte.forEach(halte => {
        let matchJalur = true;
        if (filterKode !== 'all') {
            matchJalur = halte.jalur_terkait && halte.jalur_terkait.includes(filterKode);
        }
        
        const matchSearch = halte.nama_halte.toLowerCase().includes(keyword.toLowerCase());

        if (matchJalur && matchSearch) {
            const marker = L.marker([halte.latitude, halte.longitude], {icon: halteIcon});
            
            marker.bindTooltip(halte.nama_halte, { direction: 'top', offset: [0, -15] });
            
            marker.on('click', () => {
                bukaDetailPanel(halte);
                map.flyTo([halte.latitude, halte.longitude], 16);
            });

            markersLayer.addLayer(marker); // Pake Layer biasa, bukan Cluster
        }
    });
}

// ==========================================
// 5. INTERAKSI UI
// ==========================================
function bukaDetailPanel(halte) {
    document.getElementById('detailPanel').classList.remove('hidden');
    document.getElementById('detNama').innerText = halte.nama_halte;
    document.getElementById('detInfo').innerHTML = `<span>📍</span> ${halte.info_lokasi || 'Lokasi Halte'}`;
    document.getElementById('detFoto').src = halte.foto_url || 'https://via.placeholder.com/400x200?text=No+Image';

    const badges = document.getElementById('detBadges');
    badges.innerHTML = '';
    
    if (halte.jalur_terkait) {
        halte.jalur_terkait.forEach(kode => {
            const span = document.createElement('span');
            span.className = 'badge badge-neutral text-xs font-bold';
            span.innerText = kode;
            badges.appendChild(span);
        });
    }

    document.getElementById('btnRute').onclick = () => {
        hitungRute(halte.latitude, halte.longitude);
    };
}

// ==========================================
// 6. GPS & RUTE
// ==========================================
document.getElementById('btnGPS').addEventListener('click', () => {
    if(!navigator.geolocation) return alert("Browser tidak support GPS");
    
    navigator.geolocation.getCurrentPosition(pos => {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;

        if (userMarker) map.removeLayer(userMarker);
        
        userMarker = L.marker([userLat, userLng], {icon: userIcon})
            .addTo(map)
            .bindPopup("Lokasi Kamu").openPopup();

        map.setView([userLat, userLng], 15);
    }, () => alert("Gagal mengambil lokasi GPS."));
});

function hitungRute(destLat, destLng) {
    if (!userLat) return alert("Klik tombol 'Temukan Lokasi Saya' dulu!");

    if (routingControl) map.removeControl(routingControl);

    routingControl = L.Routing.control({
        waypoints: [
            L.latLng(userLat, userLng),
            L.latLng(destLat, destLng)
        ],
        lineOptions: { styles: [{color: '#16a34a', opacity: 0.8, weight: 6}] },
        createMarker: () => null,
        addWaypoints: false,
        draggableWaypoints: false,
        showAlternatives: false,
        fitSelectedRoutes: true
    }).addTo(map);
}

// ==========================================
// 7. START APP
// ==========================================
document.getElementById('filterJalur').addEventListener('change', (e) => {
    renderMarkers(e.target.value, document.getElementById('searchInput').value);
});

document.getElementById('searchInput').addEventListener('input', (e) => {
    renderMarkers(document.getElementById('filterJalur').value, e.target.value);
});

if (supabase) {
    initApp();
}