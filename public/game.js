const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const WORLD_WIDTH = 1920; const WORLD_HEIGHT = 1080;
const TILE_SIZE = 5; const KM_PER_TILE = 25; 

canvas.width = WORLD_WIDTH; canvas.height = WORLD_HEIGHT;

let territory = {}; let countries = {}; let armies = {}; let regions = {};
let myId = null; let currentRoomId = null; let isPlaying = false; let isSpawned = false;
let isEditorMode = false;

let visualArmies = {}; let camera = { x: 0, y: 0, zoom: 1 };
let isPanning = false; let lastMouse = {x: 0, y: 0};
let selectedArmies = []; let isSelecting = false; let selectionBox = { startX: 0, startY: 0, endX: 0, endY: 0 };
let isDrawingRegion = false; let currentDrawingRegionId = null; let clickedRegionId = null; let lassoPoints = [];

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

// === ЛОББИ И РЕДАКТОР ===
window.createRoom = function() { socket.emit('createRoom', { presetName: document.getElementById('presetNameInput').value }, (res) => { if (res.success) { currentRoomId = res.roomId; document.getElementById('createRoomPanel').style.display = 'none'; document.getElementById('countryPanel').style.display = 'block'; document.getElementById('displaySetupRoomCode').innerText = res.roomId; document.getElementById('myRoomCode').innerText = res.roomId; } }); }
window.joinRoom = function() { const code = document.getElementById('roomCodeInput').value.toUpperCase(); socket.emit('joinRoom', code, (res) => { if (res.success) { currentRoomId = code; document.getElementById('joinRoomPanel').style.display = 'none'; document.getElementById('countryPanel').style.display = 'block'; document.getElementById('displaySetupRoomCode').innerText = code; document.getElementById('myRoomCode').innerText = code; } else { alert(res.msg || "Комната не найдена!"); } }); }

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

window.startEditor = function() { isEditorMode = true; socket.emit('createRoom', { presetName: '' }, (res) => { if (res.success) { currentRoomId = res.roomId; document.getElementById('setupScreen').style.display = 'none'; document.getElementById('topBar').style.display = 'flex'; document.getElementById('myRoomCode').innerText = "РЕДАКТОР"; document.getElementById('sideMenu').style.display = 'block'; document.getElementById('editorTabBtn').style.display = 'block'; switchTab('tab-editor'); showMsg("Вы в Редакторе! Создавайте страны и рисуйте границы."); isPlaying = true; } }); }
window.edCreateCountry = function() { const name = document.getElementById('edCountryName').value || 'Новая Страна'; const color = document.getElementById('edCountryColor').value; let finalFlag = edBase64Flag; if (!finalFlag) { const tCnv = document.createElement('canvas'); tCnv.width = 64; tCnv.height = 64; const tCtx = tCnv.getContext('2d'); tCtx.fillStyle = color; tCtx.fillRect(0,0,64,64); finalFlag = tCnv.toDataURL(); } socket.emit('joinGame', { isNew: true, name, color, flag: finalFlag }); edBase64Flag = null; const fileInput = document.getElementById('edCountryFlagFile'); if(fileInput) fileInput.value = ""; }
window.edSwitchCountry = function(cId) { socket.emit('switchCountry', cId); }
window.edSaveAndExit = function() { const presetName = prompt("Введите название заготовки:"); if (presetName && presetName.trim() !== "") { socket.emit('savePreset', presetName.trim()); } }
socket.on('presetSaved', () => { alert("Заготовка успешно сохранена!"); location.reload(); });

function updateEditorList() {
    if (!isEditorMode) return; const list = document.getElementById('edCountryList'); if(!list) return; list.innerHTML = '';
    for (let cId in countries) { let isActive = (cId === myId) ? "border: 2px solid #fff;" : "border: 1px solid #333;"; list.innerHTML += `<button onclick="edSwitchCountry('${cId}')" style="background:${countries[cId].color}; width:100%; margin-bottom:5px; padding:8px; color:#fff; font-weight:bold; cursor:pointer; ${isActive}">${countries[cId].name}</button>`; }
}

// === УПРАВЛЕНИЕ ===
document.getElementById('drawRegionBtn')?.addEventListener('click', () => { 
    isDrawingRegion = !isDrawingRegion; document.getElementById('drawRegionBtn').innerText = isDrawingRegion ? "Отменить" : "Сформировать регион (Лассо)";
    if (isDrawingRegion) { currentDrawingRegionId = `reg_${myId}_${Math.random().toString(36).substr(2, 5)}`; showMsg("Обведите территорию ЛКМ"); } else { lassoPoints = []; } 
});
document.getElementById('deployBtn')?.addEventListener('click', () => { const amount = document.getElementById('deployAmount').value; if (clickedRegionId) { socket.emit('deployArmy', { regionId: clickedRegionId, amount: amount }); } });
document.getElementById('closeRegBtn')?.addEventListener('click', () => { clickedRegionId = null; updateRegionPanel(); });
document.getElementById('renameRegBtn')?.addEventListener('click', () => { if (clickedRegionId && regions[clickedRegionId] && regions[clickedRegionId].owner === myId) { const newName = prompt("Новое название:", regions[clickedRegionId].name); if (newName) socket.emit('renameRegion', { regionId: clickedRegionId, newName: newName }); } });

socket.on('initData', (data) => { territory = data.territory; armies = data.armies; regions = data.regions; });
socket.on('updateMap', (data) => { countries = data.countries; territory = data.territory; regions = data.regions; if (myId && countries[myId] && countries[myId].isSpawned) isSpawned = true; updateUI(); updateEditorList(); });
socket.on('syncTerritory', (data) => { territory = data.territory; regions = data.regions; updateRegionPanel(); });
socket.on('updateResources', (c) => { countries = c; updateUI(); updateRegionPanel(); });
socket.on('batchCellUpdate', (data) => { for (const key in data.cells) { territory[key] = data.cells[key]; } regions = data.regions; if (data.countries) countries = data.countries; updateUI(); updateRegionPanel(); });
socket.on('syncArmies', (a) => { armies = a; for(let id in armies) { if(!visualArmies[id]) { visualArmies[id] = { x: armies[id].x, y: armies[id].y, count: armies[id].count }; } } });

function pointInPolygon(point, vs) { let x = point[0], y = point[1]; let inside = false; for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) { let xi = vs[i][0], yi = vs[i][1]; let xj = vs[j][0], yj = vs[j][1]; let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi); if (intersect) inside = !inside; } return inside; }

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
        } else { delete visualArmies[id]; }
    }
    drawMap(); requestAnimationFrame(gameLoop);
}

function updateUI() {
    if (myId && countries[myId]) {
        const nameEl = document.getElementById('myName');
        if (nameEl && nameEl.innerText === "") { nameEl.innerText = countries[myId].name; document.getElementById('myFlagUI').src = countries[myId].flag; isSpawned = countries[myId].isSpawned; }
        document.getElementById('myArea').innerText = (countries[myId].cells * KM_PER_TILE).toLocaleString();
        document.getElementById('myPop').innerText = Math.floor(countries[myId].population).toLocaleString();
        document.getElementById('myDollars').innerText = Math.floor(countries[myId].dollars).toLocaleString();
        const incEl = document.getElementById('myIncome'); if (incEl) { incEl.innerText = (countries[myId].lastIncome >= 0 ? "+" : "") + Math.floor(countries[myId].lastIncome); incEl.style.color = countries[myId].lastIncome >= 0 ? '#2ecc71' : '#e74c3c'; }
        document.getElementById('myMilitary').innerText = Math.floor(countries[myId].military).toLocaleString();
        document.getElementById('myCap').innerText = countries[myId].cap.toLocaleString();
    }
}

function updateRegionPanel() {
    const rp = document.getElementById('regionPanel'); if (!rp) return;
    if (!clickedRegionId || !regions[clickedRegionId]) { rp.style.display = 'none'; return; }
    const reg = regions[clickedRegionId]; rp.style.display = 'block';
    
    document.getElementById('regName').innerText = reg.name;
    document.getElementById('regOwner').innerText = countries[reg.owner] ? countries[reg.owner].name : "Неизвестно";
    document.getElementById('regCells').innerText = reg.cells;
    
    const renBtn = document.getElementById('renameRegBtn');
    if (reg.owner === myId) { if(renBtn) renBtn.style.display = 'inline-block'; } else { if(renBtn) renBtn.style.display = 'none'; }
}

const getCellOwner = (nx, ny) => { const nCell = territory[`${nx}_${ny}`]; return nCell ? nCell.owner : null; };

function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!bgMap.complete || bgMap.naturalWidth === 0) { ctx.fillStyle = '#222'; ctx.fillRect(0, 0, canvas.width, canvas.height); }

    ctx.save(); ctx.translate(camera.x, camera.y); ctx.scale(camera.zoom, camera.zoom);
    if (bgMap.complete && bgMap.naturalWidth > 0) ctx.drawImage(bgMap, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // --- НОВЫЙ АЛГОРИТМ СГЛАЖИВАНИЯ ГРАНИЦ (Анти-Майнкрафт) ---
    ctx.globalAlpha = 0.65; 
    
    // 1. Рисуем базовую заливку (чуть больше размера тайла, чтобы скрыть швы)
    for (const key in territory) {
        const owner = countries[territory[key].owner];
        if (owner) { 
            const [ix, iy] = key.split('_').map(Number); 
            ctx.fillStyle = owner.color; 
            ctx.fillRect(ix * TILE_SIZE, iy * TILE_SIZE, TILE_SIZE + 0.5, TILE_SIZE + 0.5); 
        }
    }

    // 2. Скругляем все внешние углы границ кругами!
    for (const key in territory) {
        const cell = territory[key];
        const [ix, iy] = key.split('_').map(Number);
        const owner = cell.owner;

        // Проверяем соседей. Если мы на границе - рисуем круг
        if (getCellOwner(ix, iy - 1) !== owner || getCellOwner(ix, iy + 1) !== owner || 
            getCellOwner(ix - 1, iy) !== owner || getCellOwner(ix + 1, iy) !== owner) {
            
            ctx.fillStyle = countries[owner].color;
            ctx.beginPath();
            ctx.arc(ix * TILE_SIZE + TILE_SIZE/2, iy * TILE_SIZE + TILE_SIZE/2, TILE_SIZE * 0.9, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    ctx.globalAlpha = 1.0;
    
    // ОТРИСОВКА СТОЛИЦ РЕГИОНОВ
    for (const rId in regions) {
        const reg = regions[rId];
        if (reg.cityX !== undefined) {
            const tx = reg.cityX * TILE_SIZE + TILE_SIZE/2; const ty = reg.cityY * TILE_SIZE + TILE_SIZE/2;
            ctx.fillStyle = 'rgba(10, 10, 10, 0.9)'; ctx.fillRect(tx - 4, ty - 4, 8, 8);
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 / camera.zoom; ctx.strokeRect(tx - 4, ty - 4, 8, 8);
            ctx.fillStyle = 'white'; ctx.font = `bold ${10 / camera.zoom}px Arial`; ctx.textAlign = 'center'; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2 / camera.zoom;
            ctx.strokeText(reg.name, tx, ty - (15 / camera.zoom)); ctx.fillText(reg.name, tx, ty - (15 / camera.zoom));
        }
    }

    // ОТРИСОВКА ЛИНИИ ЛАССО (Если ты рисуешь регион)
    if (isDrawingRegion && lassoPoints.length > 0) {
        ctx.beginPath(); ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
        for(let i=1; i<lassoPoints.length; i++) ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
        ctx.lineTo(lassoPoints[0].x, lassoPoints[0].y); ctx.strokeStyle = '#f1c40f'; ctx.lineWidth = 2 / camera.zoom; ctx.stroke();
    }

    // ОТРИСОВКА АРМИЙ
    const radius = 8 / camera.zoom; 
    for(const id in visualArmies) {
        const army = visualArmies[id]; const owner = countries[army.owner]; if (!owner) continue;
        if (selectedArmies.includes(id)) { ctx.beginPath(); ctx.arc(army.x, army.y, radius * 1.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(46, 204, 113, 0.5)'; ctx.fill(); }
        ctx.save(); ctx.beginPath(); ctx.arc(army.x, army.y, radius, 0, Math.PI * 2); ctx.closePath(); ctx.clip(); 
        const flagImg = getFlagImage(army.owner, owner.flag);
        if (flagImg && flagImg.complete) { ctx.drawImage(flagImg, army.x - radius, army.y - radius, radius * 2, radius * 2); } else { ctx.fillStyle = owner.color; ctx.fill(); }
        ctx.restore();
        ctx.beginPath(); ctx.arc(army.x, army.y, radius, 0, Math.PI * 2); ctx.lineWidth = 1.5 / camera.zoom; ctx.strokeStyle = owner.color; ctx.stroke();
        ctx.fillStyle = 'white'; ctx.font = `bold ${9 / camera.zoom}px Arial`; ctx.strokeStyle = 'black'; ctx.lineWidth = 2 / camera.zoom; const countText = Math.floor(army.count).toString();
        ctx.strokeText(countText, army.x, army.y + radius + (8 / camera.zoom)); ctx.fillText(countText, army.x, army.y + radius + (8 / camera.zoom));
    }

    if (isSelecting && !isDrawingRegion) {
        ctx.fillStyle = 'rgba(46, 204, 113, 0.2)'; ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 1 / camera.zoom;
        const w = selectionBox.endX - selectionBox.startX; const h = selectionBox.endY - selectionBox.startY;
        ctx.fillRect(selectionBox.startX, selectionBox.startY, w, h); ctx.strokeRect(selectionBox.startX, selectionBox.startY, w, h);
    }
    ctx.restore();

    if (myId && !isSpawned) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; ctx.fillRect(0, canvas.height / 2 - 60, canvas.width, 120);
        ctx.fillStyle = '#f1c40f'; ctx.font = 'bold 35px Arial'; ctx.textAlign = 'center'; ctx.fillText("КЛИКНИТЕ В ЛЮБОЕ МЕСТО КАРТЫ, ЧТОБЫ ОСНОВАТЬ СТОЛИЦУ", canvas.width / 2, canvas.height / 2 + 10);
    }
}

canvas.addEventListener('wheel', (e) => {
    e.preventDefault(); const zoomAmount = 0.1; const oldZoom = camera.zoom; const minZoom = Math.max(canvas.width / WORLD_WIDTH, canvas.height / WORLD_HEIGHT);
    camera.zoom = e.deltaY > 0 ? Math.max(minZoom, camera.zoom - zoomAmount) : Math.min(6, camera.zoom + zoomAmount);
    const rect = canvas.getBoundingClientRect(); const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width); const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
    camera.x = mouseX - (mouseX - camera.x) * (camera.zoom / oldZoom); camera.y = mouseY - (mouseY - camera.y) * (camera.zoom / oldZoom);
});

function getWorldCoords(e) {
    const rect = canvas.getBoundingClientRect(); const canvasMouseX = (e.clientX - rect.left) * (canvas.width / rect.width); const canvasMouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
    let wx = (canvasMouseX - camera.x) / camera.zoom; let wy = (canvasMouseY - camera.y) / camera.zoom; return { x: Math.max(0, Math.min(WORLD_WIDTH, wx)), y: Math.max(0, Math.min(WORLD_HEIGHT, wy)) };
}

canvas.addEventListener('mousedown', (e) => { 
    const world = getWorldCoords(e);
    if (e.button === 1) { isPanning = true; lastMouse = {x: e.clientX, y: e.clientY}; return; }
    if (e.button === 0) {
        if (!isSpawned) { socket.emit('spawnCapital', { x: Math.floor(world.x/TILE_SIZE), y: Math.floor(world.y/TILE_SIZE) }); return; }
        if (isDrawingRegion) { lassoPoints = [world]; return; }
        isSelecting = true; selectionBox.startX = world.x; selectionBox.startY = world.y; selectionBox.endX = world.x; selectionBox.endY = world.y;
    }
    if (e.button === 2 && selectedArmies.length > 0 && !isDrawingRegion) { socket.emit('moveArmies', { armyIds: selectedArmies, targetX: world.x, targetY: world.y }); }
});

canvas.addEventListener('mousemove', (e) => { 
    if (isPanning) { camera.x += (e.clientX - lastMouse.x); camera.y += (e.clientY - lastMouse.y); lastMouse = {x: e.clientX, y: e.clientY}; return; }
    const world = getWorldCoords(e);
    if (isSelecting) { selectionBox.endX = world.x; selectionBox.endY = world.y; } else if (isDrawingRegion && e.buttons === 1) { lassoPoints.push(world); }
});

canvas.addEventListener('mouseup', (e) => { 
    if (e.button === 1) isPanning = false;
    if (isDrawingRegion) {
        if (lassoPoints.length > 2) {
            let minX = WORLD_WIDTH, maxX = 0, minY = WORLD_HEIGHT, maxY = 0;
            let poly = lassoPoints.map(p => { if(p.x < minX) minX = p.x; if(p.x > maxX) maxX = p.x; if(p.y < minY) minY = p.y; if(p.y > maxY) maxY = p.y; return [p.x, p.y]; });
            let tilesInside = [];
            for(let c = Math.max(0, Math.floor(minX/TILE_SIZE)); c <= Math.min(WORLD_WIDTH/TILE_SIZE-1, Math.ceil(maxX/TILE_SIZE)); c++) {
                for(let r = Math.max(0, Math.floor(minY/TILE_SIZE)); r <= Math.min(WORLD_HEIGHT/TILE_SIZE-1, Math.ceil(maxY/TILE_SIZE)); r++) {
                    if (pointInPolygon([c*TILE_SIZE+2, r*TILE_SIZE+2], poly)) tilesInside.push(`${c}_${r}`);
                }
            }
            if (tilesInside.length > 0) { 
                const name = prompt("Назовите регион:", `Регион ${Object.keys(regions).length + 1}`); 
                if (name !== null) { socket.emit('lassoRegion', { tiles: tilesInside, newRegionId: currentDrawingRegionId, name: name || "Без названия" }); showMsg("Оформляем документы..."); } 
            }
        }
        isDrawingRegion = false; lassoPoints = []; document.getElementById('drawRegionBtn').innerText = "Сформировать регион (Лассо)"; return;
    }

    if (e.button === 0 && isSelecting) {
        isSelecting = false; const world = getWorldCoords(e);
        const minX = Math.min(selectionBox.startX, world.x); const maxX = Math.max(selectionBox.startX, world.x); const minY = Math.min(selectionBox.startY, world.y); const maxY = Math.max(selectionBox.startY, world.y);
        const isClick = (maxX - minX < 5 && maxY - minY < 5); selectedArmies = []; const hr = (8 / camera.zoom) + 2;
        for (const id in visualArmies) {
            const a = visualArmies[id];
            if (a.owner === myId) { if (isClick && Math.hypot(a.x - world.x, a.y - world.y) <= hr) selectedArmies.push(id); else if (!isClick && a.x >= minX && a.x <= maxX && a.y >= minY && a.y <= maxY) selectedArmies.push(id); }
        }
        if (isClick && selectedArmies.length === 0) {
            const key = `${Math.floor(world.x/TILE_SIZE)}_${Math.floor(world.y/TILE_SIZE)}`;
            if (territory[key] && territory[key].owner === myId) { clickedRegionId = territory[key].regionId; updateRegionPanel(); } else { clickedRegionId = null; updateRegionPanel(); }
        } else if (!isClick || selectedArmies.length > 0) { clickedRegionId = null; updateRegionPanel(); }
    }
});
