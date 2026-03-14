const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const WORLD_WIDTH = 1920; const WORLD_HEIGHT = 1080;
canvas.width = window.innerWidth; canvas.height = window.innerHeight;

let countries = {}; let cities = {}; let armies = {};
let myId = null; let currentRoomId = null; let isPlaying = false; let isSpawned = false;
let isEditorMode = false;

let visualArmies = {}; let camera = { x: 0, y: 0, zoom: 1 };
let isPanning = false; let lastMouse = {x: 0, y: 0};
let selectedArmyId = null; let clickedCityId = null;

const sysMsg = document.getElementById('systemMsg');
function showMsg(text) { if(sysMsg) { sysMsg.innerText = text; setTimeout(() => sysMsg.innerText = "ЛКМ - выбор. ПКМ - приказ на марш.", 3000); } }

window.addEventListener('resize', () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; });

const keys = { w: false, a: false, s: false, d: false };
window.addEventListener('keydown', (e) => { if (!e.key) return; let key = e.key.toLowerCase(); if (key === 'w' || key === 'ц') keys.w = true; if (key === 'a' || key === 'ф') keys.a = true; if (key === 's' || key === 'ы') keys.s = true; if (key === 'd' || key === 'в') keys.d = true; });
window.addEventListener('keyup', (e) => { if (!e.key) return; let key = e.key.toLowerCase(); if (key === 'w' || key === 'ц') keys.w = false; if (key === 'a' || key === 'ф') keys.a = false; if (key === 's' || key === 'ы') keys.s = false; if (key === 'd' || key === 'в') keys.d = false; });

let base64Flag = null; let edBase64Flag = null;
function processFlag(file, isEd) { if (file) { const reader = new FileReader(); reader.onload = (ev) => { const img = new Image(); img.onload = () => { const tempCanvas = document.createElement('canvas'); tempCanvas.width = 64; tempCanvas.height = 64; const tCtx = tempCanvas.getContext('2d'); tCtx.drawImage(img, 0, 0, 64, 64); if(isEd) edBase64Flag = tempCanvas.toDataURL('image/png'); else base64Flag = tempCanvas.toDataURL('image/png'); }; img.src = ev.target.result; }; reader.readAsDataURL(file); } }
document.getElementById('countryFlagFile')?.addEventListener('change', (e) => processFlag(e.target.files[0], false));

window.createRoom = function() { socket.emit('createRoom', { presetName: document.getElementById('presetNameInput').value }, (res) => { if (res.success) { currentRoomId = res.roomId; document.getElementById('createRoomPanel').style.display = 'none'; document.getElementById('countryPanel').style.display = 'block'; document.getElementById('displaySetupRoomCode').innerText = res.roomId; document.getElementById('myRoomCode').innerText = res.roomId; } }); }
window.joinRoom = function() { const code = document.getElementById('roomCodeInput').value.toUpperCase(); socket.emit('joinRoom', code, (res) => { if (res.success) { currentRoomId = code; document.getElementById('joinRoomPanel').style.display = 'none'; document.getElementById('countryPanel').style.display = 'block'; document.getElementById('displaySetupRoomCode').innerText = code; document.getElementById('myRoomCode').innerText = code; } else alert("Операция не найдена!"); }); }

socket.on('initLobby', (cList) => {
    countries = cList; if (isPlaying) return; 
    const select = document.getElementById('countrySelect');
    if(select) { select.innerHTML = '<option value="new">-- Новая Фракция --</option>'; for (let cId in countries) { if (!countries[cId].online || !countries[cId].socketId) select.innerHTML += `<option value="${cId}">${countries[cId].name}</option>`; } }
});

document.getElementById('joinBtn')?.addEventListener('click', () => {
    const selectVal = document.getElementById('countrySelect').value;
    if (selectVal === 'new') {
        const name = document.getElementById('countryName').value || 'Фракция'; const color = document.getElementById('countryColor').value;
        let finalFlag = base64Flag; if (!finalFlag) { const tCnv = document.createElement('canvas'); tCnv.width = 64; tCnv.height = 64; const tCtx = tCnv.getContext('2d'); tCtx.fillStyle = color; tCtx.fillRect(0,0,64,64); finalFlag = tCnv.toDataURL(); }
        socket.emit('joinGame', { isNew: true, name, color, flag: finalFlag });
    } else { socket.emit('joinGame', { isNew: false, countryId: selectVal }); }
});

socket.on('joinSuccess', (cId) => { myId = cId; document.getElementById('setupScreen').style.display = 'none'; document.getElementById('topBar').style.display = 'flex'; document.getElementById('sideMenu').style.display = 'block'; isPlaying = true; updateEditorList(); requestAnimationFrame(gameLoop); });

window.startEditor = function() { isEditorMode = true; socket.emit('createRoom', { presetName: '' }, (res) => { if (res.success) { currentRoomId = res.roomId; document.getElementById('setupScreen').style.display = 'none'; document.getElementById('topBar').style.display = 'flex'; document.getElementById('myRoomCode').innerText = "РЕДАКТОР"; document.getElementById('sideMenu').style.display = 'block'; document.getElementById('editorTools').style.display = 'block'; showMsg("Режим Редактора активен."); isPlaying = true; requestAnimationFrame(gameLoop); } }); }
window.edCreateCountry = function() { const name = document.getElementById('edCountryName').value || 'Фракция'; const color = document.getElementById('edCountryColor').value; socket.emit('joinGame', { isNew: true, name, color, flag: "" }); }
window.edSwitchCountry = function(cId) { socket.emit('switchCountry', cId); }
window.edSaveAndExit = function() { const presetName = prompt("Название сценария:"); if (presetName && presetName.trim() !== "") socket.emit('savePreset', presetName.trim()); }
socket.on('presetSaved', () => { alert("Сценарий сохранен!"); location.reload(); });

function updateEditorList() {
    if (!isEditorMode) return; const list = document.getElementById('edCountryList'); if(!list) return; list.innerHTML = '';
    for (let cId in countries) { let isActive = (cId === myId) ? "border: 2px solid #111;" : "border: 1px solid #ccc;"; list.innerHTML += `<button onclick="edSwitchCountry('${cId}')" style="background:${countries[cId].color}; width:100%; margin-bottom:5px; padding:8px; color:#fff; font-weight:bold; cursor:pointer; border-radius:4px; ${isActive}">${countries[cId].name}</button>`; }
}

document.getElementById('buildCityBtn')?.addEventListener('click', () => { if (selectedArmyId) { socket.emit('buildCity', selectedArmyId); selectedArmyId = null; } else showMsg("Сначала выберите армию ЛКМ!"); });
document.getElementById('deployBtn')?.addEventListener('click', () => { const amount = document.getElementById('deployAmount').value; if (clickedCityId) socket.emit('deployArmy', { cityId: clickedCityId, amount: amount }); });
document.getElementById('closeCityBtn')?.addEventListener('click', () => { clickedCityId = null; updateCityPanel(); });

socket.on('initData', (data) => { countries = data.countries; cities = data.cities; armies = data.armies; });
socket.on('updateMap', (data) => { countries = data.countries; cities = data.cities; if (myId && countries[myId] && countries[myId].isSpawned) isSpawned = true; updateUI(); updateEditorList(); updateCityPanel(); });
socket.on('updateResources', (c) => { countries = c; updateUI(); updateCityPanel(); });
socket.on('syncArmies', (a) => { armies = a; for(let id in armies) { if(!visualArmies[id]) { visualArmies[id] = { x: armies[id].x, y: armies[id].y, count: armies[id].count }; } } });

function gameLoop() {
    if (!isPlaying) return;
    const camSpeed = 15 / camera.zoom;
    if (keys.w) camera.y += camSpeed; if (keys.s) camera.y -= camSpeed; if (keys.a) camera.x += camSpeed; if (keys.d) camera.x -= camSpeed;
    if (camera.x > 0) camera.x = 0; if (camera.y > 0) camera.y = 0;
    const minX = canvas.width - WORLD_WIDTH * camera.zoom; const minY = canvas.height - WORLD_HEIGHT * camera.zoom;
    if (camera.x < minX) camera.x = minX; if (camera.y < minY) camera.y = minY;

    for(let id in visualArmies) {
        if(armies[id]) { 
            visualArmies[id].x += (armies[id].x - visualArmies[id].x) * 0.4; 
            visualArmies[id].y += (armies[id].y - visualArmies[id].y) * 0.4; 
            visualArmies[id].count = armies[id].count; visualArmies[id].owner = armies[id].owner; 
        } else { if (selectedArmyId === id) selectedArmyId = null; delete visualArmies[id]; }
    }
    drawMap(); requestAnimationFrame(gameLoop);
}

function updateUI() {
    if (myId && countries[myId]) {
        const nameEl = document.getElementById('myName');
        if (nameEl && nameEl.innerText === "") { nameEl.innerText = countries[myId].name; document.getElementById('myFlagUI').src = countries[myId].flag; isSpawned = countries[myId].isSpawned; }
        document.getElementById('myArea').innerText = (countries[myId].cells * 10).toLocaleString();
        document.getElementById('myMilitary').innerText = Math.floor(countries[myId].military).toLocaleString();
        document.getElementById('myCap').innerText = countries[myId].cap.toLocaleString();
        const incEl = document.getElementById('myIncome'); if (incEl) { incEl.innerText = (countries[myId].lastIncome >= 0 ? "+" : "") + Math.floor(countries[myId].lastIncome); incEl.style.color = countries[myId].lastIncome >= 0 ? '#10b981' : '#ef4444'; }
        document.getElementById('myDollars').innerText = Math.floor(countries[myId].dollars).toLocaleString();
    }
}

function updateCityPanel() {
    const cp = document.getElementById('cityPanel'); if (!cp) return;
    if (!clickedCityId || !cities[clickedCityId]) { cp.style.display = 'none'; return; }
    const city = cities[clickedCityId]; cp.style.display = 'block';
    document.getElementById('cityName').innerText = city.name;
    document.getElementById('cityOwner').innerText = countries[city.owner] ? countries[city.owner].name : "Неизвестно";
}

// ОСНОВНАЯ ОТРИСОВКА В СТИЛЕ REACT-ПРИМЕРА
function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 1. Фон (бежевый ландшафт)
    ctx.fillStyle = '#f3e5d8'; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save(); ctx.translate(camera.x, camera.y); ctx.scale(camera.zoom, camera.zoom);

    // Подготовка узлов влияния (Города и Армии)
    let nodes = [];
    for(let id in cities) nodes.push({x: cities[id].x, y: cities[id].y, power: 1.0 + cities[id].level*0.2, owner: cities[id].owner});
    for(let id in visualArmies) nodes.push({x: visualArmies[id].x, y: visualArmies[id].y, power: 0.5 + visualArmies[id].count/10000, owner: visualArmies[id].owner});

    // 2. Рендер Карты Влияния (Influence Mapping) по формуле из примера
    const step = 8; // Шаг пикселей как в примере
    for (let x = 0; x < WORLD_WIDTH; x += step) {
        for (let y = 0; y < WORLD_HEIGHT; y += step) {
            let infByOwner = {};
            for(let n of nodes) {
                // Нормализуем координаты для формулы экспоненты
                let dx = (x - n.x) / 1000;
                let dy = (y - n.y) / 1000;
                let distSq = dx * dx + dy * dy;
                // Формула из примера: influence = power / Math.exp(distSq * 45)
                let influence = n.power / Math.exp(distSq * 45);
                infByOwner[n.owner] = (infByOwner[n.owner] || 0) + influence;
            }

            let maxInf = 0; let bestOwner = null;
            for(let o in infByOwner) { if(infByOwner[o] > maxInf) { maxInf = infByOwner[o]; bestOwner = o; } }

            // Порог присутствия как в примере (0.05)
            if (maxInf > 0.05 && bestOwner && countries[bestOwner]) {
                // Рисуем полупрозрачные квадраты зоны контроля
                ctx.fillStyle = countries[bestOwner].color;
                ctx.globalAlpha = Math.min(0.4, maxInf * 0.3);
                ctx.fillRect(x, y, step + 1, step + 1); // +1 чтобы не было швов
            }
        }
    }
    ctx.globalAlpha = 1.0;

    // 3. Отрисовка Баз/Городов
    for (let cityId in cities) {
        const city = cities[cityId];
        ctx.beginPath(); ctx.arc(city.x, city.y, 8 / camera.zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.lineWidth = 3 / camera.zoom; ctx.strokeStyle = countries[city.owner] ? countries[city.owner].color : '#111'; ctx.stroke();
        
        if (clickedCityId === cityId) {
            ctx.beginPath(); ctx.arc(city.x, city.y, 14/camera.zoom, 0, Math.PI*2);
            ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2/camera.zoom; ctx.stroke();
        }
        ctx.fillStyle = '#1f2937'; ctx.font = `bold ${10 / camera.zoom}px Inter, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(city.name, city.x, city.y - (12 / camera.zoom));
    }

    // 4. Отрисовка Армий (в стиле НАТО из примера)
    for (let id in visualArmies) {
        const army = visualArmies[id]; const owner = countries[army.owner]; if (!owner) continue;
        
        // Тень юнита
        ctx.shadowBlur = 15; ctx.shadowColor = owner.color;

        // Тело юнита (ромб)
        ctx.save();
        ctx.translate(army.x, army.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = owner.color;
        ctx.fillRect(-10/camera.zoom, -10/camera.zoom, 20/camera.zoom, 20/camera.zoom);
        ctx.strokeStyle = 'white'; ctx.lineWidth = 2/camera.zoom;
        ctx.strokeRect(-10/camera.zoom, -10/camera.zoom, 20/camera.zoom, 20/camera.zoom);
        
        // Выделение желтым ромбом
        if (selectedArmyId === id) {
            ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 3/camera.zoom;
            ctx.strokeRect(-13/camera.zoom, -13/camera.zoom, 26/camera.zoom, 26/camera.zoom);
        }
        ctx.restore();
        ctx.shadowBlur = 0;

        // Текст и полоска силы (Healthbar)
        ctx.fillStyle = '#1f2937'; ctx.font = `bold ${10 / camera.zoom}px Inter, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(`${Math.floor(army.count)} ед.`, army.x, army.y + (25 / camera.zoom));
        
        ctx.fillStyle = '#e5e7eb'; ctx.fillRect(army.x - 15/camera.zoom, army.y - 20/camera.zoom, 30/camera.zoom, 4/camera.zoom);
        ctx.fillStyle = '#10b981'; 
        const powerRatio = Math.min(1.0, army.count / 20000); // 20к = макс полоска
        ctx.fillRect(army.x - 15/camera.zoom, army.y - 20/camera.zoom, (30/camera.zoom) * powerRatio, 4/camera.zoom);
    }
    ctx.restore();

    // Экран Спавна
    if (myId && !isSpawned) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; ctx.fillRect(0, canvas.height / 2 - 60, canvas.width, 120);
        ctx.fillStyle = '#2563eb'; ctx.font = '900 30px Arial'; ctx.textAlign = 'center'; 
        ctx.fillText("УКАЖИТЕ ТОЧКУ ВЫСАДКИ ШТАБА НА КАРТЕ", canvas.width / 2, canvas.height / 2 + 10);
    }
}

canvas.addEventListener('wheel', (e) => { e.preventDefault(); const zoomAmount = 0.1; const oldZoom = camera.zoom; const minZoom = Math.max(canvas.width / WORLD_WIDTH, canvas.height / WORLD_HEIGHT); camera.zoom = e.deltaY > 0 ? Math.max(minZoom, camera.zoom - zoomAmount) : Math.min(6, camera.zoom + zoomAmount); const rect = canvas.getBoundingClientRect(); const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width); const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height); camera.x = mouseX - (mouseX - camera.x) * (camera.zoom / oldZoom); camera.y = mouseY - (mouseY - camera.y) * (camera.zoom / oldZoom); });

function getWorldCoords(e) { const rect = canvas.getBoundingClientRect(); const canvasMouseX = (e.clientX - rect.left) * (canvas.width / rect.width); const canvasMouseY = (e.clientY - rect.top) * (canvas.height / rect.height); let wx = (canvasMouseX - camera.x) / camera.zoom; let wy = (canvasMouseY - camera.y) / camera.zoom; return { x: Math.max(0, Math.min(WORLD_WIDTH, wx)), y: Math.max(0, Math.min(WORLD_HEIGHT, wy)) }; }

canvas.addEventListener('mousedown', (e) => { 
    const world = getWorldCoords(e);
    if (e.button === 1) { isPanning = true; lastMouse = {x: e.clientX, y: e.clientY}; return; }
    
    if (e.button === 0) {
        if (!isSpawned) { socket.emit('spawnCapital', { x: world.x, y: world.y }); return; }
        
        selectedArmyId = null; clickedCityId = null; let found = false;
        for (let id in visualArmies) {
            if (visualArmies[id].owner === myId && Math.hypot(visualArmies[id].x - world.x, visualArmies[id].y - world.y) < 15 / camera.zoom) { selectedArmyId = id; found = true; break; }
        }
        if (!found) {
            for (let id in cities) { if (Math.hypot(cities[id].x - world.x, cities[id].y - world.y) < 20 / camera.zoom) { clickedCityId = id; break; } }
        }
        updateCityPanel();
    }
    
    if (e.button === 2 && selectedArmyId) { socket.emit('moveArmies', { armyIds: [selectedArmyId], targetX: world.x, targetY: world.y }); }
});

canvas.addEventListener('mousemove', (e) => { if (isPanning) { camera.x += (e.clientX - lastMouse.x); camera.y += (e.clientY - lastMouse.y); lastMouse = {x: e.clientX, y: e.clientY}; } });
canvas.addEventListener('mouseup', (e) => { if (e.button === 1) isPanning = false; });
