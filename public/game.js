const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const WORLD_WIDTH = 1920; const WORLD_HEIGHT = 1080;
canvas.width = WORLD_WIDTH; canvas.height = WORLD_HEIGHT;

let countries = {}; let cities = {}; let armies = {};
let myId = null; let currentRoomId = null; let isPlaying = false; let isSpawned = false;
let isEditorMode = false;

let visualArmies = {}; let camera = { x: 0, y: 0, zoom: 1 };
let isPanning = false; let lastMouse = {x: 0, y: 0};
let selectedArmyId = null; let clickedCityId = null;

const sysMsg = document.getElementById('systemMsg');
function showMsg(text) { if(sysMsg) { sysMsg.innerText = text; setTimeout(() => sysMsg.innerText = "ЛКМ - выбор, ПКМ - движение войск.", 3000); } }

const bgMap = new Image(); bgMap.src = 'Map.png'; let loopStarted = false;
function startGame() { if (!loopStarted) { loopStarted = true; requestAnimationFrame(gameLoop); } }
bgMap.onload = startGame; bgMap.onerror = () => { startGame(); }; setTimeout(startGame, 1000); 

const keys = { w: false, a: false, s: false, d: false };
window.addEventListener('keydown', (e) => { if (!e.key) return; let key = e.key.toLowerCase(); if (key === 'w' || key === 'ц') keys.w = true; if (key === 'a' || key === 'ф') keys.a = true; if (key === 's' || key === 'ы') keys.s = true; if (key === 'd' || key === 'в') keys.d = true; });
window.addEventListener('keyup', (e) => { if (!e.key) return; let key = e.key.toLowerCase(); if (key === 'w' || key === 'ц') keys.w = false; if (key === 'a' || key === 'ф') keys.a = false; if (key === 's' || key === 'ы') keys.s = false; if (key === 'd' || key === 'в') keys.d = false; });

let base64Flag = null; let edBase64Flag = null; const flagCache = {}; 
function getFlagImage(cId, base64Str) { if (!flagCache[cId]) { const img = new Image(); img.src = base64Str; flagCache[cId] = img; } return flagCache[cId]; }

function processFlag(file, isEd) {
    if (file) { const reader = new FileReader(); reader.onload = (ev) => { const img = new Image(); img.onload = () => { const tempCanvas = document.createElement('canvas'); tempCanvas.width = 64; tempCanvas.height = 64; const tCtx = tempCanvas.getContext('2d'); tCtx.drawImage(img, 0, 0, 64, 64); if(isEd) edBase64Flag = tempCanvas.toDataURL('image/png'); else base64Flag = tempCanvas.toDataURL('image/png'); }; img.src = ev.target.result; }; reader.readAsDataURL(file); }
}
document.getElementById('countryFlagFile')?.addEventListener('change', (e) => processFlag(e.target.files[0], false));
document.getElementById('edCountryFlagFile')?.addEventListener('change', (e) => processFlag(e.target.files[0], true));

// ЛОББИ И РЕДАКТОР
window.createRoom = function() { socket.emit('createRoom', { presetName: document.getElementById('presetNameInput').value }, (res) => { if (res.success) { currentRoomId = res.roomId; document.getElementById('createRoomPanel').style.display = 'none'; document.getElementById('countryPanel').style.display = 'block'; document.getElementById('displaySetupRoomCode').innerText = res.roomId; document.getElementById('myRoomCode').innerText = res.roomId; } }); }
window.joinRoom = function() { const code = document.getElementById('roomCodeInput').value.toUpperCase(); socket.emit('joinRoom', code, (res) => { if (res.success) { currentRoomId = code; document.getElementById('joinRoomPanel').style.display = 'none'; document.getElementById('countryPanel').style.display = 'block'; document.getElementById('displaySetupRoomCode').innerText = code; document.getElementById('myRoomCode').innerText = code; } else alert(res.msg || "Комната не найдена!"); }); }

socket.on('initLobby', (cList) => {
    countries = cList; if (isPlaying) return; 
    const select = document.getElementById('countrySelect');
    if(select) { select.innerHTML = '<option value="new">-- Новая (Пустошь) --</option>'; for (let cId in countries) { if (!countries[cId].online || !countries[cId].socketId) select.innerHTML += `<option value="${cId}">${countries[cId].name} (Свободна)</option>`; } }
});

document.getElementById('joinBtn')?.addEventListener('click', () => {
    const selectVal = document.getElementById('countrySelect').value;
    if (selectVal === 'new') {
        const name = document.getElementById('countryName').value || 'Империя'; const color = document.getElementById('countryColor').value;
        let finalFlag = base64Flag; if (!finalFlag) { const tCnv = document.createElement('canvas'); tCnv.width = 64; tCnv.height = 64; const tCtx = tCnv.getContext('2d'); tCtx.fillStyle = color; tCtx.fillRect(0,0,64,64); finalFlag = tCnv.toDataURL(); }
        socket.emit('joinGame', { isNew: true, name, color, flag: finalFlag });
    } else { socket.emit('joinGame', { isNew: false, countryId: selectVal }); }
});

socket.on('joinSuccess', (cId) => { myId = cId; document.getElementById('setupScreen').style.display = 'none'; document.getElementById('topBar').style.display = 'flex'; document.getElementById('sideMenu').style.display = 'block'; isPlaying = true; updateEditorList(); });

window.startEditor = function() { isEditorMode = true; socket.emit('createRoom', { presetName: '' }, (res) => { if (res.success) { currentRoomId = res.roomId; document.getElementById('setupScreen').style.display = 'none'; document.getElementById('topBar').style.display = 'flex'; document.getElementById('myRoomCode').innerText = "РЕДАКТОР"; document.getElementById('sideMenu').style.display = 'block'; document.getElementById('editorTabBtn').style.display = 'block'; switchTab('tab-editor'); showMsg("Вы в Редакторе! Создавайте страны и стройте города."); isPlaying = true; } }); }
window.edCreateCountry = function() { const name = document.getElementById('edCountryName').value || 'Новая Страна'; const color = document.getElementById('edCountryColor').value; let finalFlag = edBase64Flag; if (!finalFlag) { const tCnv = document.createElement('canvas'); tCnv.width = 64; tCnv.height = 64; const tCtx = tCnv.getContext('2d'); tCtx.fillStyle = color; tCtx.fillRect(0,0,64,64); finalFlag = tCnv.toDataURL(); } socket.emit('joinGame', { isNew: true, name, color, flag: finalFlag }); edBase64Flag = null; const fi = document.getElementById('edCountryFlagFile'); if(fi) fi.value = ""; }
window.edSwitchCountry = function(cId) { socket.emit('switchCountry', cId); }
window.edSaveAndExit = function() { const presetName = prompt("Название заготовки:"); if (presetName && presetName.trim() !== "") socket.emit('savePreset', presetName.trim()); }
socket.on('presetSaved', () => { alert("Успешно сохранено!"); location.reload(); });

function updateEditorList() {
    if (!isEditorMode) return; const list = document.getElementById('edCountryList'); if(!list) return; list.innerHTML = '';
    for (let cId in countries) { let isActive = (cId === myId) ? "border: 2px solid #fff;" : "border: 1px solid #333;"; list.innerHTML += `<button onclick="edSwitchCountry('${cId}')" style="background:${countries[cId].color}; width:100%; margin-bottom:5px; padding:8px; color:#fff; font-weight:bold; cursor:pointer; ${isActive}">${countries[cId].name}</button>`; }
}

// УПРАВЛЕНИЕ (ОСНОВАНИЕ ГОРОДОВ)
document.getElementById('buildCityBtn')?.addEventListener('click', () => {
    if (selectedArmyId) { socket.emit('buildCity', selectedArmyId); selectedArmyId = null; } else { showMsg("Сначала выберите армию ЛКМ!"); }
});

document.getElementById('deployBtn')?.addEventListener('click', () => { const amount = document.getElementById('deployAmount').value; if (clickedCityId) socket.emit('deployArmy', { cityId: clickedCityId, amount: amount }); });
document.getElementById('upgradeCityBtn')?.addEventListener('click', () => { if (clickedCityId) socket.emit('upgradeCity', clickedCityId); });
document.getElementById('closeCityBtn')?.addEventListener('click', () => { clickedCityId = null; updateCityPanel(); });
document.getElementById('renameCityBtn')?.addEventListener('click', () => { if (clickedCityId && cities[clickedCityId] && cities[clickedCityId].owner === myId) { const newName = prompt("Новое название:", cities[clickedCityId].name); if (newName) socket.emit('renameCity', { cityId: clickedCityId, newName: newName }); } });

socket.on('newsEvent', (data) => { showMsg(data.text); });
socket.on('initData', (data) => { countries = data.countries; cities = data.cities; armies = data.armies; });
socket.on('updateMap', (data) => { countries = data.countries; cities = data.cities; if (myId && countries[myId] && countries[myId].isSpawned) isSpawned = true; updateUI(); updateEditorList(); updateCityPanel(); });
socket.on('updateResources', (c) => { countries = c; updateUI(); updateCityPanel(); });
socket.on('syncArmies', (a) => { armies = a; for(let id in armies) { if(!visualArmies[id]) { visualArmies[id] = { x: armies[id].x, y: armies[id].y, count: armies[id].count }; } } });

function gameLoop() {
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
        
        let cityCount = 0; for(let c in cities) { if(cities[c].owner === myId) cityCount++; }
        document.getElementById('myCities').innerText = cityCount;
        
        document.getElementById('myPop').innerText = Math.floor(countries[myId].population).toLocaleString();
        document.getElementById('myDollars').innerText = Math.floor(countries[myId].dollars).toLocaleString();
        const incEl = document.getElementById('myIncome'); if (incEl) { incEl.innerText = (countries[myId].lastIncome >= 0 ? "+" : "") + Math.floor(countries[myId].lastIncome); incEl.style.color = countries[myId].lastIncome >= 0 ? '#2ecc71' : '#e74c3c'; }
        document.getElementById('myMilitary').innerText = Math.floor(countries[myId].military).toLocaleString();
        document.getElementById('myCap').innerText = countries[myId].cap.toLocaleString();
    }
}

function updateCityPanel() {
    const cp = document.getElementById('cityPanel'); if (!cp) return;
    if (!clickedCityId || !cities[clickedCityId]) { cp.style.display = 'none'; return; }
    const city = cities[clickedCityId]; cp.style.display = 'block';
    
    document.getElementById('cityName').innerText = city.name;
    document.getElementById('cityOwner').innerText = countries[city.owner] ? countries[city.owner].name : "Неизвестно";
    document.getElementById('cityLevel').innerText = city.level;
    
    const upBtn = document.getElementById('upgradeCityBtn'); const renBtn = document.getElementById('renameCityBtn');
    if (city.owner === myId) {
        if(renBtn) renBtn.style.display = 'inline-block';
        if(upBtn) { upBtn.style.display = 'block'; const cost = city.level * 5000; upBtn.innerText = city.level >= 10 ? "Макс. Уровень" : `Улучшить (${cost} $)`; upBtn.disabled = city.level >= 10 || countries[myId].dollars < cost; upBtn.style.background = upBtn.disabled ? '#7f8c8d' : '#27ae60'; }
    } else { if(renBtn) renBtn.style.display = 'none'; if(upBtn) upBtn.style.display = 'none'; }
}

function getArmyRadius(count) { return Math.max(15, Math.min(250, Math.sqrt(count) * 0.8)); }
function getCityRadius(level) { return 40 + (level * 15); }

function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!bgMap.complete || bgMap.naturalWidth === 0) { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height); }

    ctx.save(); ctx.translate(camera.x, camera.y); ctx.scale(camera.zoom, camera.zoom);
    if (bgMap.complete && bgMap.naturalWidth > 0) ctx.drawImage(bgMap, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // ОТРИСОВКА ВЕКТОРНЫХ ЗОН ВЛИЯНИЯ (Metaballs)
    ctx.globalCompositeOperation = 'source-over';
    
    // Рисуем единым блобом (круги одного цвета сливаются)
    ctx.globalAlpha = 0.6;
    for (let cId in countries) {
        ctx.fillStyle = countries[cId].color;
        ctx.beginPath();
        // Добавляем зоны городов
        for (let cityId in cities) {
            if (cities[cityId].owner === cId) {
                const r = getCityRadius(cities[cityId].level);
                ctx.moveTo(cities[cityId].x + r, cities[cityId].y);
                ctx.arc(cities[cityId].x, cities[cityId].y, r, 0, Math.PI * 2);
            }
        }
        // Добавляем зоны армий
        for (let armyId in visualArmies) {
            if (visualArmies[armyId].owner === cId) {
                const r = getArmyRadius(visualArmies[armyId].count);
                ctx.moveTo(visualArmies[armyId].x + r, visualArmies[armyId].y);
                ctx.arc(visualArmies[armyId].x, visualArmies[armyId].y, r, 0, Math.PI * 2);
            }
        }
        ctx.fill(); // Заливаем всю территорию страны
    }
    
    ctx.globalAlpha = 1.0;

    // ОТРИСОВКА ЦЕНТРОВ ГОРОДОВ
    for (let cityId in cities) {
        const city = cities[cityId];
        const r = 10 / camera.zoom;
        ctx.beginPath(); ctx.arc(city.x, city.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.lineWidth = 3 / camera.zoom; ctx.strokeStyle = countries[city.owner] ? countries[city.owner].color : '#555'; ctx.stroke();
        
        if (clickedCityId === cityId) {
            ctx.beginPath(); ctx.arc(city.x, city.y, r + 5/camera.zoom, 0, Math.PI*2);
            ctx.strokeStyle = '#f1c40f'; ctx.lineWidth = 2/camera.zoom; ctx.stroke();
        }

        ctx.fillStyle = 'white'; ctx.font = `bold ${12 / camera.zoom}px Arial`; ctx.textAlign = 'center'; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2 / camera.zoom;
        ctx.strokeText(city.name, city.x, city.y - (15 / camera.zoom)); ctx.fillText(city.name, city.x, city.y - (15 / camera.zoom));
    }

    // ОТРИСОВКА ИКОНОК АРМИЙ
    for (let id in visualArmies) {
        const army = visualArmies[id]; const owner = countries[army.owner]; if (!owner) continue;
        const iconSize = 12 / camera.zoom;
        
        if (selectedArmyId === id) { ctx.beginPath(); ctx.arc(army.x, army.y, iconSize * 1.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(241, 196, 15, 0.5)'; ctx.fill(); }
        
        ctx.save(); ctx.beginPath(); ctx.arc(army.x, army.y, iconSize, 0, Math.PI * 2); ctx.closePath(); ctx.clip(); 
        const flagImg = getFlagImage(army.owner, owner.flag);
        if (flagImg && flagImg.complete) { ctx.drawImage(flagImg, army.x - iconSize, army.y - iconSize, iconSize * 2, iconSize * 2); } else { ctx.fillStyle = owner.color; ctx.fill(); }
        ctx.restore();
        
        ctx.beginPath(); ctx.arc(army.x, army.y, iconSize, 0, Math.PI * 2); ctx.lineWidth = 2 / camera.zoom; ctx.strokeStyle = owner.color; ctx.stroke();
        
        ctx.fillStyle = 'white'; ctx.font = `bold ${10 / camera.zoom}px Arial`; ctx.strokeStyle = 'black'; ctx.lineWidth = 2 / camera.zoom; const countText = Math.floor(army.count).toString();
        ctx.strokeText(countText, army.x, army.y + iconSize + (10 / camera.zoom)); ctx.fillText(countText, army.x, army.y + iconSize + (10 / camera.zoom));
    }

    ctx.restore();

    if (myId && !isSpawned) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; ctx.fillRect(0, canvas.height / 2 - 60, canvas.width, 120);
        ctx.fillStyle = '#f1c40f'; ctx.font = 'bold 35px Arial'; ctx.textAlign = 'center'; ctx.fillText("КЛИКНИТЕ КУДА УГОДНО, ЧТОБЫ ОСНОВАТЬ СТОЛИЦУ", canvas.width / 2, canvas.height / 2 + 10);
    }
}

canvas.addEventListener('wheel', (e) => { e.preventDefault(); const zoomAmount = 0.1; const oldZoom = camera.zoom; const minZoom = Math.max(canvas.width / WORLD_WIDTH, canvas.height / WORLD_HEIGHT); camera.zoom = e.deltaY > 0 ? Math.max(minZoom, camera.zoom - zoomAmount) : Math.min(6, camera.zoom + zoomAmount); const rect = canvas.getBoundingClientRect(); const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width); const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height); camera.x = mouseX - (mouseX - camera.x) * (camera.zoom / oldZoom); camera.y = mouseY - (mouseY - camera.y) * (camera.zoom / oldZoom); });

function getWorldCoords(e) { const rect = canvas.getBoundingClientRect(); const canvasMouseX = (e.clientX - rect.left) * (canvas.width / rect.width); const canvasMouseY = (e.clientY - rect.top) * (canvas.height / rect.height); let wx = (canvasMouseX - camera.x) / camera.zoom; let wy = (canvasMouseY - camera.y) / camera.zoom; return { x: Math.max(0, Math.min(WORLD_WIDTH, wx)), y: Math.max(0, Math.min(WORLD_HEIGHT, wy)) }; }

canvas.addEventListener('mousedown', (e) => { 
    const world = getWorldCoords(e);
    if (e.button === 1) { isPanning = true; lastMouse = {x: e.clientX, y: e.clientY}; return; }
    
    if (e.button === 0) {
        if (!isSpawned) { socket.emit('spawnCapital', { x: world.x, y: world.y }); return; }
        
        selectedArmyId = null; clickedCityId = null;
        let found = false;
        
        // Клик по армии
        for (let id in visualArmies) {
            if (visualArmies[id].owner === myId && Math.hypot(visualArmies[id].x - world.x, visualArmies[id].y - world.y) < 15 / camera.zoom) {
                selectedArmyId = id; found = true; break;
            }
        }
        
        // Клик по городу
        if (!found) {
            for (let id in cities) {
                if (Math.hypot(cities[id].x - world.x, cities[id].y - world.y) < 20 / camera.zoom) {
                    clickedCityId = id; break;
                }
            }
        }
        updateCityPanel();
    }
    
    if (e.button === 2 && selectedArmyId) { socket.emit('moveArmies', { armyIds: [selectedArmyId], targetX: world.x, targetY: world.y }); }
});

canvas.addEventListener('mousemove', (e) => { if (isPanning) { camera.x += (e.clientX - lastMouse.x); camera.y += (e.clientY - lastMouse.y); lastMouse = {x: e.clientX, y: e.clientY}; } });
canvas.addEventListener('mouseup', (e) => { if (e.button === 1) isPanning = false; });
