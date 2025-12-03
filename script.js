// 1. CONFIG & SETUP
const SUPABASE_URL = 'https://zxcsqybwjldyltocrpdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4Y3NxeWJ3amxkeWx0b2NycGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1OTYwNjQsImV4cCI6MjA4MDE3MjA2NH0.Ff9XBydXZvRe7ELTjT6tfvCFF0SY5csOoPXV96sUqTQ';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Setup Peta
const map = L.map('map', { zoomControl: false }).setView([-7.7956, 110.3695], 13);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);

let markerCluster = L.markerClusterGroup({ maxClusterRadius: 40 });
map.addLayer(markerCluster);

// Layer Groups
let exploreLayer = L.featureGroup().addTo(map); // Untuk jalur explorasi
let userPathLayer = L.featureGroup().addTo(map); // KHUSUS Jalur User 
let routeLayers = []; // Array untuk menyimpan control routing

// Variabel Global
let dbJalur = [], dbHalte = [];
let userLat = null, userLng = null;
let userMarker = null, userAccuracyCircle = null;
let activeRouteCode = null; // Fitur Toggle
let watchId = null;

// Peta Warna Jalur
const routeColors = {
    '1A': '#EF4444', '1B': '#DC2626', '2A': '#F59E0B', '2B': '#D97706', 
    '3A': '#10B981', '3B': '#059669', '4A': '#3B82F6', '4B': '#2563EB', 
    '5A': '#8B5CF6', '5B': '#7C3AED', '6A': '#EC4899', '6B': '#DB2777', 
    '8':  '#6366F1', '9':  '#14B8A6', '10': '#F43F5E', '11': '#84CC16', 
    '12': '#A3E635', '13': '#06B6D4', '14': '#A855F7', '15': '#FB923C'
};
const defaultColor = '#64748B'; 

// Icons
const iconHalte = L.divIcon({ className: 'custom-pin', html: `<div style="background-color:#FACC15; width:16px; height:16px; border-radius:50%; border:2px solid black;"></div>`, iconSize: [16,16] });
const iconUser = L.divIcon({ className: 'custom-pin', html: `<div style="background-color:#2563EB; width:20px; height:20px; border-radius:50%; border:3px solid white; box-shadow: 0 0 10px rgba(37,99,235,0.5);"></div>`, iconSize: [20,20] });

// 2. FITUR GPS REALTIME
const locateControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function (map) {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
        Object.assign(container.style, {
            backgroundColor: 'white', width: '35px', height: '35px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', marginBottom: '10px'
        });
        container.innerHTML = '<span style="font-size: 20px;">🎯</span>';
        container.onclick = function() { startGPS(true); }
        return container;
    }
});
map.addControl(new locateControl());

function startGPS(forceCenter = false) {
    if (!navigator.geolocation) return alert("Browser tidak support GPS.");
    if (watchId) navigator.geolocation.clearWatch(watchId);

    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const { latitude, longitude, accuracy } = pos.coords;
            userLat = latitude; userLng = longitude;

            if (userMarker) {
                userMarker.setLatLng([userLat, userLng]);
                userAccuracyCircle.setLatLng([userLat, userLng]);
                userAccuracyCircle.setRadius(accuracy);
            } else {
                userMarker = L.marker([userLat, userLng], { icon: iconUser }).addTo(map).bindPopup("Lokasi Anda");
                userAccuracyCircle = L.circle([userLat, userLng], { radius: accuracy, color: '#2563EB', fillOpacity: 0.1, weight: 1 }).addTo(map);
                if (!forceCenter) map.flyTo([userLat, userLng], 15);
            }
            if(forceCenter) map.flyTo([userLat, userLng], 17);
            calculateNearby();
        },
        (err) => console.warn("GPS Error:", err.message),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// 3. INIT DATA
async function initApp() {
    try {
        let { data: dJalur } = await supabase.from('jalur_transjogja').select('*');
        let { data: dHalte } = await supabase.from('halte_transjogja').select('*');
        dbJalur = dJalur || [];
        dbHalte = dHalte || [];

        // Sorting
        dbHalte.sort((a,b) => a.nama_halte.localeCompare(b.nama_halte));

        setupSearchInput('startHalte');
        setupSearchInput('endHalte');
        setupExplorationUI();
        renderMarkers();
        startGPS(); 
        
        document.getElementById('loading').classList.add('hidden');
    } catch (e) {
        console.error(e);
        alert("Gagal koneksi database.");
    }
}

// === FUNGSI SEARCH DROPDOWN (FIXED TOGGLE) ===
function setupSearchInput(elementId) {
    const oldSelect = document.getElementById(elementId);
    if (!oldSelect) return;

    const wrapper = document.createElement('div');
    wrapper.className = "relative w-full search-wrapper"; // Class penanda

    const input = document.createElement('input');
    input.type = "text";
    input.id = elementId;
    input.className = "input input-bordered input-sm w-full bg-white cursor-pointer"; // Tambah cursor pointer
    input.placeholder = "Pilih / Ketik nama halte...";
    input.autocomplete = "off";

    const list = document.createElement('ul');
    list.className = "absolute z-[9999] bg-white w-full border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto hidden mt-1 left-0 search-list"; // Class penanda list
    
    oldSelect.parentNode.replaceChild(wrapper, oldSelect);
    wrapper.appendChild(input);
    wrapper.appendChild(list);

    // Fungsi Render List
    const renderList = (filterText = '') => {
        list.innerHTML = '';
        let filtered = dbHalte;
        if (filterText) filtered = dbHalte.filter(h => h.nama_halte.toLowerCase().includes(filterText.toLowerCase()));
        
        const displayData = filtered;

        if (displayData.length > 0) {
            displayData.forEach(h => {
                const li = document.createElement('li');
                li.className = "p-2 hover:bg-emerald-100 cursor-pointer text-xs text-slate-700 border-b border-slate-100";
                li.innerHTML = `<b>${h.nama_halte}</b>`;
                // Ganti onclick jadi onmousedown biar dieksekusi sebelum blur
                li.onmousedown = (e) => {
                    e.preventDefault(); // Mencegah input kehilangan fokus
                    input.value = h.nama_halte;
                    input.dataset.id = h.id; 
                    list.classList.add('hidden');
                };
                list.appendChild(li);
            });
            list.classList.remove('hidden');
        } else {
            list.innerHTML = '<li class="p-2 text-xs text-slate-400 text-center">Tidak ditemukan</li>';
            list.classList.remove('hidden');
        }
    };

    input.addEventListener('click', (e) => {
        e.stopPropagation(); 
        
        const isHidden = list.classList.contains('hidden');

        document.querySelectorAll('.search-list').forEach(el => el.classList.add('hidden'));

        if (isHidden) {
            renderList(input.value); 
        } else {
            list.classList.add('hidden');
        }
    });

    input.addEventListener('input', () => {
        document.querySelectorAll('.search-list').forEach(el => el.classList.add('hidden'));
        renderList(input.value);
    });

    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            list.classList.add('hidden');
        }
    });
}

// 4. EXPLORASI JALUR
function setupExplorationUI() {
    const contentExplore = document.getElementById('contentExplore');
    
    contentExplore.innerHTML = `
        <div class="mb-3">
            <h3 class="font-bold text-sm text-slate-700 mb-2">Pilih Jalur Bus:</h3>
            <div id="jalurGrid" class="grid grid-cols-4 gap-2"></div>
        </div>
        <div id="jalurDetail" class="hidden animate-fade-in transition-all">
            <div class="p-3 rounded-lg mb-3 shadow-sm border text-white" id="headerDetailJalur">
                <h4 class="font-bold text-lg" id="detailKodeJalur">-</h4>
                <p class="text-xs opacity-90" id="detailRute">-</p>
                <div class="mt-2 text-[10px] bg-black/20 inline-block px-2 py-1 rounded">
                    🕒 <span id="detailJam">-</span>
                </div>
            </div>
            <h4 class="font-bold text-xs text-slate-500 mb-2">Urutan Halte:</h4>
            <div class="overflow-y-auto max-h-[300px] pr-1">
                <ul id="listHalteExplorasi" class="steps steps-vertical w-full text-[10px]"></ul>
            </div>
        </div>
    `;

    const grid = document.getElementById('jalurGrid');
    dbJalur.sort((a,b) => a.kode_jalur.localeCompare(b.kode_jalur, undefined, {numeric: true}));

    dbJalur.forEach(j => {
        const btn = document.createElement('button');
        btn.className = "btn btn-sm btn-outline btn-success w-full font-bold";
        btn.innerText = j.kode_jalur;
        btn.onclick = () => showJalurRoute(j);
        grid.appendChild(btn);
    });
}

function showJalurRoute(jalurData) {
    // FITUR TOGGLE
    if (activeRouteCode === jalurData.kode_jalur) {
        clearRoutes(); 
        renderMarkers(); 
        document.getElementById('jalurDetail').classList.add('hidden');
        activeRouteCode = null;
        return;
    }
    
    activeRouteCode = jalurData.kode_jalur;
    clearRoutes(); 
    markerCluster.clearLayers(); 

    const color = routeColors[jalurData.kode_jalur] || defaultColor;

    let rawHaltes = dbHalte.filter(h => {
        const routes = Array.isArray(h.jalur_terkait) ? h.jalur_terkait : [];
        return routes.includes(jalurData.kode_jalur);
    });

    if (rawHaltes.length === 0) return alert("Belum ada data halte untuk jalur ini.");

    let sortedHaltes = sortHalteByLocation(rawHaltes);
    const waypoints = [];
    
    sortedHaltes.forEach((h, index) => {
        L.circleMarker([h.latitude, h.longitude], {
            radius: 6, fillColor: color, color: 'white', weight: 2, fillOpacity: 1
        }).addTo(exploreLayer).bindPopup(`<b>${h.nama_halte}</b><br>Jalur ${jalurData.kode_jalur}`);
        waypoints.push(L.latLng(h.latitude, h.longitude));
    });

    // Sampling Routing
    let routingWaypoints = waypoints;
    if (waypoints.length > 25) {
        routingWaypoints = waypoints.filter((_, i) => i % 2 === 0);
        if(routingWaypoints[routingWaypoints.length-1] !== waypoints[waypoints.length-1]) {
            routingWaypoints.push(waypoints[waypoints.length-1]);
        }
    }

    const control = L.Routing.control({
        waypoints: routingWaypoints,
        lineOptions: { styles: [{ color: color, opacity: 0.8, weight: 6 }] },
        createMarker: () => null, 
        addWaypoints: false, draggableWaypoints: false, fitSelectedRoutes: true, showAlternatives: false,
        containerClassName: 'hidden'
    }).addTo(map);
    routeLayers.push(control);

    // Sidebar
    const detailBox = document.getElementById('jalurDetail');
    const headerBox = document.getElementById('headerDetailJalur');
    detailBox.classList.remove('hidden');
    headerBox.style.backgroundColor = color; headerBox.style.borderColor = color;

    document.getElementById('detailKodeJalur').innerText = `Jalur ${jalurData.kode_jalur}`;
    document.getElementById('detailRute').innerText = jalurData.rute_simpel || "Rute Trans Jogja";
    document.getElementById('detailJam').innerText = jalurData.jam_ops || "05.30 - 21.30";

    const listContainer = document.getElementById('listHalteExplorasi');
    listContainer.innerHTML = '';
    sortedHaltes.forEach(h => {
        listContainer.innerHTML += `
            <li class="step step-neutral" data-content="●">
                <span class="text-left font-medium text-slate-700 cursor-pointer hover:text-emerald-600" onclick="focusMap(${h.latitude}, ${h.longitude})">
                    ${h.nama_halte}
                </span>
            </li>`;
    });
}

function sortHalteByLocation(halteList) {
    if (halteList.length === 0) return [];
    let startNode = halteList.find(h => h.nama_halte.includes('Terminal') || h.nama_halte.includes('Bandara')) || halteList[0];
    let sorted = [startNode];
    let current = startNode;
    let remaining = halteList.filter(h => h.id !== startNode.id);

    while (remaining.length > 0) {
        let nearest = null; let minDist = Infinity;
        remaining.forEach(h => {
            const dist = getDistance(current.latitude, current.longitude, h.latitude, h.longitude);
            if (dist < minDist) { minDist = dist; nearest = h; }
        });
        if (nearest) {
            sorted.push(nearest); current = nearest; remaining = remaining.filter(h => h.id !== nearest.id);
        } else {
            sorted = sorted.concat(remaining); break;
        }
    }
    return sorted;
}

// 5. ALGORITMA RUTE (MULTI-TRANSIT BFS)
document.getElementById('btnFindRoute').addEventListener('click', () => {
    const startInput = document.getElementById('startHalte');
    const endInput = document.getElementById('endHalte');
    
    let startId = startInput.dataset.id;
    let endId = endInput.dataset.id;

    if (!startId) startId = dbHalte.find(h => h.nama_halte.toLowerCase() === startInput.value.toLowerCase())?.id;
    if (!endId) endId = dbHalte.find(h => h.nama_halte.toLowerCase() === endInput.value.toLowerCase())?.id;

    if(!startId || !endId) return alert("Mohon pilih halte dari daftar!");
    if(startId == endId) return alert("Asal dan Tujuan sama.");

    clearRoutes(); 
    activeRouteCode = null; 
    document.getElementById('jalurDetail').classList.add('hidden');

    const startObj = dbHalte.find(h => h.id == startId);
    const endObj = dbHalte.find(h => h.id == endId);

    renderMarkers();

    drawUserPath(startObj);
    calculateMultiLegRoute(startObj, endObj);
});

function drawUserPath(startHalte) {
    userPathLayer.clearLayers(); 

    if (userLat && userLng) {
        const control = L.Routing.control({
            waypoints: [L.latLng(userLat, userLng), L.latLng(startHalte.latitude, startHalte.longitude)],
            lineOptions: { styles: [{ color: '#64748B', opacity: 0.8, weight: 6, dashArray: '10, 10' }] },
            createMarker: () => null, addWaypoints: false, draggableWaypoints: false, fitSelectedRoutes: false, showAlternatives: false,
            containerClassName: 'hidden'
        }).addTo(map);
        routeLayers.push(control); 
        
        map.fitBounds(L.latLngBounds([[userLat, userLng], [startHalte.latitude, startHalte.longitude]]), {padding: [100,100]});
    } else {
        alert("Lokasi GPS belum ditemukan. Pastikan GPS aktif.");
    }
}

function calculateMultiLegRoute(startNode, endNode) {
    let queue = [{ node: startNode, path: [startNode], lines: [] }];
    let visited = new Set();
    visited.add(startNode.id);
    let foundPath = null;
    let count = 0;

    while (queue.length > 0 && count < 5000) {
        count++;
        let current = queue.shift();
        if (current.node.id === endNode.id) { foundPath = current; break; }

        const currentLines = Array.isArray(current.node.jalur_terkait) ? current.node.jalur_terkait : [];
        for (let halte of dbHalte) {
            if (visited.has(halte.id)) continue;
            const neighborLines = Array.isArray(halte.jalur_terkait) ? halte.jalur_terkait : [];
            const commonLine = currentLines.find(line => neighborLines.includes(line));

            if (commonLine) {
                const prevLine = current.lines[current.lines.length - 1];
                let lineToUse = commonLine;
                if (neighborLines.includes(prevLine)) lineToUse = prevLine;

                queue.push({
                    node: halte,
                    path: [...current.path, halte],
                    lines: [...current.lines, lineToUse]
                });
                visited.add(halte.id);
            }
        }
    }

    if (foundPath) renderMultiLegResult(foundPath);
    else alert("Rute tidak ditemukan. Coba kombinasi halte lain.");
}

function renderMultiLegResult(result) {
    const container = document.getElementById('resultContainer');
    container.classList.remove('hidden');
    document.getElementById('resRoute1').innerHTML = ''; 
    document.getElementById('stepTransit').classList.add('hidden');
    document.getElementById('resStartHalte').innerText = result.path[0].nama_halte;
    const stepsList = document.getElementById('resRoute1');
    
    let segments = [];
    let currentSegment = { line: result.lines[0], from: result.path[0], to: null, stops: [] };

    for (let i = 0; i < result.lines.length; i++) {
        const line = result.lines[i];
        const nextNode = result.path[i+1];
        if (line !== currentSegment.line) {
            currentSegment.to = result.path[i]; segments.push(currentSegment);
            currentSegment = { line: line, from: result.path[i], to: null, stops: [] };
        }
        currentSegment.stops.push(nextNode);
    }
    currentSegment.to = result.path[result.path.length - 1]; segments.push(currentSegment);

    segments.forEach((seg, idx) => {
        const color = routeColors[seg.line] || defaultColor;
        const waypoints = [L.latLng(seg.from.latitude, seg.from.longitude)];
        seg.stops.forEach(s => waypoints.push(L.latLng(s.latitude, s.longitude)));

        let routingWp = waypoints;
        if(waypoints.length > 20) {
             routingWp = waypoints.filter((_, i) => i % 2 === 0);
             if(routingWp[routingWp.length-1] !== waypoints[waypoints.length-1]) routingWp.push(waypoints[waypoints.length-1]);
        }

        const control = L.Routing.control({
            waypoints: routingWp,
            lineOptions: { styles: [{ color: color, opacity: 0.9, weight: 6 }] },
            createMarker: function(i, wp, n) {
                if (idx > 0 && i === 0) {
                    return L.marker(wp.latLng, { icon: L.divIcon({ className:'bg-white rounded-full border-2 border-slate-800 text-[10px] flex items-center justify-center font-bold w-6 h-6 shadow-md', html:'🔄'}) }).bindPopup(`Transit: ${seg.from.nama_halte}`);
                }
                return null;
            },
            addWaypoints: false, draggableWaypoints: false, fitSelectedRoutes: true, showAlternatives: false,
            containerClassName: 'hidden'
        }).addTo(map);
        routeLayers.push(control);

        stepsList.innerHTML += `
            <div class="mb-4 relative pl-4 border-l-4" style="border-color: ${color}">
                <div class="absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 bg-white" style="border-color: ${color}"></div>
                <div class="font-bold text-sm text-slate-800">Naik Bus Jalur ${seg.line}</div>
                <div class="text-xs text-slate-600">
                    <p>📍 Dari: <b>${seg.from.nama_halte}</b></p>
                    <p>🏁 Turun: <b>${seg.to.nama_halte}</b></p>
                </div>
                <div class="text-[10px] text-slate-400 mt-1 italic">(${seg.stops.length} perhentian)</div>
            </div>`;
    });
}

// 6. HELPER LAINNYA
function clearRoutes() {
    // 1. Hapus Control Routing
    routeLayers.forEach(control => { try { map.removeControl(control); } catch(e){} });
    routeLayers = []; 
    // 2. Hapus Layer Visual
    exploreLayer.clearLayers();
    userPathLayer.clearLayers();
    // 3. Hapus Marker Transit (Manual check)
    map.eachLayer(layer => {
        if(layer instanceof L.Marker && layer.options.icon && layer.options.icon.options.html === '🔄') {
            map.removeLayer(layer);
        }
    });
}

function renderMarkers() {
    markerCluster.clearLayers();
    dbHalte.forEach(h => {
        const m = L.marker([h.latitude, h.longitude], {icon: iconHalte});
        m.bindPopup(`<b>${h.nama_halte}</b><br>${h.info_lokasi}`);
        m.on('click', () => {
            const startIn = document.getElementById('startHalte');
            const endIn = document.getElementById('endHalte');
            if(!startIn.value) { startIn.value = h.nama_halte; startIn.dataset.id = h.id; }
            else { endIn.value = h.nama_halte; endIn.dataset.id = h.id; }
        });
        markerCluster.addLayer(m);
    });
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function calculateNearby() {
    if(!userLat) return;
    const withDist = dbHalte.map(h => {
        return { ...h, dist: getDistance(userLat, userLng, h.latitude, h.longitude) };
    });
    withDist.sort((a,b) => a.dist - b.dist);
    const top3 = withDist.slice(0, 3);
    const container = document.getElementById('nearbyContainer');
    container.innerHTML = '';
    top3.forEach(h => {
        container.innerHTML += `
            <div class="bg-white p-2 rounded border border-slate-200 flex justify-between items-center cursor-pointer hover:bg-slate-50 transition-colors mb-1" onclick="focusMap(${h.latitude}, ${h.longitude})">
                <div>
                    <p class="font-bold text-xs text-slate-700">${h.nama_halte}</p>
                    <p class="text-[10px] text-slate-400">${h.dist.toFixed(2)} km</p>
                </div>
                <span class="text-lg opacity-50"></span>
            </div>`;
    });
}

function focusMap(lat, lng) {
    map.flyTo([lat, lng], 17);
}

window.swapHalte = function() {
    const s = document.getElementById('startHalte');
    const e = document.getElementById('endHalte');
    const tempVal = s.value; const tempId = s.dataset.id;
    s.value = e.value; s.dataset.id = e.dataset.id;
    e.value = tempVal; e.dataset.id = tempId;
}

document.getElementById('btnRefreshGPS').addEventListener('click', () => startGPS(true));

if(supabase) initApp();