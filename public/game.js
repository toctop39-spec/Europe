const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const WORLD_WIDTH = 1920; const WORLD_HEIGHT = 1080;
const TILE_SIZE = 5; 
const KM_PER_TILE = 25; // Условные 25 км² на 1 клетку

canvas.width = WORLD_WIDTH; canvas.height = WORLD_HEIGHT;

let territory = {}; let countries = {}; let armies = {}; let regions = {};
let myId = null; let isPlaying = false; let isSpawned = false;

let visualArmies = {};
let camera = { x: 0, y: 0, zoom: 1 };
let isPanning = false; let lastMouse = {x: 0, y: 0};

let selectedArmies = []; let isSelecting = false; let selectionBox = { startX: 0, startY: 0, endX: 0, endY: 0 };
let isDrawingRegion = false; let currentDrawingRegionId = null; let clickedRegionId = null; let lassoPoints = [];

const sysMsg = document.getElementById('systemMsg');
function showMsg(text) { if(sysMsg) { sysMsg.innerText = text; setTimeout(() => sysMsg.innerText = "Камера: W A S D", 3000); } }

const bgMap = new Image(); bgMap.src = 'Map.png'; 
let loopStarted = false;
function startGame() { if (!loopStarted) { loopStarted = true; requestAnimationFrame(gameLoop); } }
bgMap.onload = startGame; bgMap.onerror = () => { startGame(); };
setTimeout(startGame, 1000); 

const keys = { w: false, a: false, s: false, d: false };
window.addEventListener('keydown', (e) => { if (!e.key) return; let key = e.key.toLowerCase(); if (key === 'w' || key === 'ц') keys.w = true; if (key === 'a' || key === 'ф') keys.a = true; if (key === 's' || key === 'ы') keys.s = true; if (key === 'd' || key === 'в') keys.d = true; });
window.addEventListener('keyup', (e) => { if (!e.key) return; let key = e.key.toLowerCase(); if (key === 'w' || key === 'ц') keys.w = false; if (key === 'a' || key === 'ф') keys.a = false; if (key === 's' || key === 'ы') keys.s = false; if (key === 'd' || key === 'в') keys.d = false; });

let base64Flag = null; const flagCache = {}; 
function getFlagImage(cId, base64Str) { if (!flagCache[cId]) { const img = new Image(); img.src = base64Str; flagCache[cId] = img; } return flagCache[cId]; }

document.getElementById('countryFlagFile')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => { const tempCanvas = document.createElement('canvas'); tempCanvas.width = 64; tempCanvas.height = 64; const tCtx = tempCanvas.getContext('2d'); tCtx.drawImage(img, 0, 0, 64, 64); base64Flag = tempCanvas.toDataURL('image/png'); };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }
});

socket.on('initLobby', (cList) => {
    countries = cList; if (isPlaying) return; 
    const select = document.getElementById('countrySelect');
    if(select) {
        select.innerHTML = '<option value="new">-- Новая страна --</option>';
        for (let cId in countries) { if (!countries[cId].online) select.innerHTML += `<option value="${cId}">${countries[cId].name} (Брошена)</option>`; }
    }
});

document.getElementById('countrySelect')?.addEventListener('change', (e) => { const form = document.getElementById('newCountryForm'); if(form) form.style.display = e.target.value === 'new' ? 'block' : 'none'; });

document.getElementById('joinBtn')?.addEventListener('click', () => {
    const selectVal = document.getElementById('countrySelect').value;
    if (selectVal === 'new') {
        const name = document.getElementById('countryName').value || 'Империя'; const color = document.getElementById('countryColor').value;
        if (!base64Flag) { const tCnv = document.createElement('canvas'); tCnv.width = 64; tCnv.height = 64; const tCtx = tCnv.getContext('2d'); tCtx.fillStyle = color; tCtx.fillRect(0,0,64,64); base64Flag = tCnv.toDataURL(); }
        socket.emit('joinGame', { isNew: true, name, color, flag: base64Flag });
    } else { socket.emit('joinGame', { isNew: false, countryId: selectVal }); }
});

socket.on('joinSuccess', (cId) => {
    myId = cId; document.getElementById('setupScreen').style.display = 'none'; document.getElementById('topBar').style.display = 'flex'; document.getElementById('controlPanel').style.display = 'block';
    isPlaying = true;
});

socket.on('newsEvent', (data) => {
    const t = document.getElementById('newsTitle'); const txt = document.getElementById('newsText'); const overlay = document.getElementById('newsOverlay');
    if (t && txt && overlay) { t.innerText = data.title; txt.innerText = data.text; overlay.style.display = 'block'; }
});

document.getElementById('deployBtn')?.addEventListener('click', () => { const amount = document.getElementById('deployAmount').value; if (clickedRegionId) { socket.emit('deployArmy', { regionId: clickedRegionId, amount: amount }); } });
document.getElementById('disbandBtn')?.addEventListener('click', () => { if (selectedArmies.length > 0) { socket.emit('disbandArmies', selectedArmies); showMsg("Дивизии распущены."); selectedArmies = []; document.getElementById('disbandBtn').style.display = 'none'; } });
document.getElementById('upgradeBtn')?.addEventListener('click', () => { if (clickedRegionId) socket.emit('upgradeRegion', clickedRegionId); });
document.getElementById('upgradeDefBtn')?.addEventListener('click', () => { if (clickedRegionId) socket.emit('upgradeDefense', clickedRegionId); });

document.getElementById('drawRegionBtn')?.addEventListener('click', () => {
    isDrawingRegion = !isDrawingRegion; document.getElementById('drawRegionBtn').innerText = isDrawingRegion ? "Отменить" : "Сформировать регион";
    if (isDrawingRegion) { currentDrawingRegionId = `reg_${myId}_${Math.random().toString(36).substr(2, 5)}`; showMsg("Обведите территорию ЛКМ"); } else { lassoPoints = []; }
});

document.getElementById('renameRegBtn')?.addEventListener('click', () => { if (clickedRegionId && regions[clickedRegionId] && regions[clickedRegionId].owner === myId) { const newName = prompt("Новое название:", regions[clickedRegionId].name); if (newName) socket.emit('renameRegion', { regionId: clickedRegionId, newName: newName }); } });
document.getElementById('closeRegBtn')?.addEventListener('click', () => { document.getElementById('regionPanel').style.display = 'none'; clickedRegionId = null; });

socket.on('initData', (data) => { territory = data.territory; armies = data.armies; regions = data.regions; });
socket.on('updateMap', (data) => { countries = data.countries; territory = data.territory; regions = data.regions; if (myId && countries[myId] && countries[myId].isSpawned) isSpawned = true; updateUI(); });
socket.on('syncTerritory', (data) => { territory = data.territory; regions = data.regions; updateRegionPanel(); });
socket.on('updateResources', (c) => { countries = c; updateUI(); updateRegionPanel(); });

socket.on('cellUpdate', (data) => { territory[data.key] = data.cell; regions = data.regions; if (data.countries) countries = data.countries; updateUI(); updateRegionPanel(); });
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
            visualArmies[id].x += (armies[id].x - visualArmies[id].x) * 0.4; visualArmies[id].y += (armies[id].y - visualArmies[id].y) * 0.4;
            visualArmies[id].count = armies[id].count; visualArmies[id].owner = armies[id].owner; visualArmies[id].inCombat = armies[id].inCombat; visualArmies[id].targetX = armies[id].targetX; visualArmies[id].targetY = armies[id].targetY;
        } else { delete visualArmies[id]; }
    }
    drawMap(); requestAnimationFrame(gameLoop);
}

function updateUI() {
    if (myId && countries[myId]) {
        const nameEl = document.getElementById('myName');
        if (nameEl && nameEl.innerText === "") { nameEl.innerText = countries[myId].name; document.getElementById('myFlagUI').src = countries[myId].flag; isSpawned = countries[myId].isSpawned; }
        
        // Площадь (кол-во клеток * КМ на клетку)
        const areaEl = document.getElementById('myArea'); if(areaEl) areaEl.innerText = (countries[myId].cells * KM_PER_TILE).toLocaleString();
        
        const popEl = document.getElementById('myPop'); if(popEl) popEl.innerText = Math.floor(countries[myId].population).toLocaleString();
        const dolEl = document.getElementById('myDollars'); if(dolEl) dolEl.innerText = Math.floor(countries[myId].dollars).toLocaleString();
        const incEl = document.getElementById('myIncome'); if (incEl) { incEl.innerText = (countries[myId].lastIncome >= 0 ? "+" : "") + Math.floor(countries[myId].lastIncome); incEl.style.color = countries[myId].lastIncome >= 0 ? '#2ecc71' : '#e74c3c'; }
        const milEl = document.getElementById('myMilitary'); if(milEl) milEl.innerText = Math.floor(countries[myId].military).toLocaleString();
        const capEl = document.getElementById('myCap'); if(capEl) capEl.innerText = countries[myId].cap.toLocaleString();
        const regPanel = document.getElementById('regionPanel'); if (regPanel && regPanel.style.display === 'block') updateRegionPanel();
    }
}

function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!bgMap.complete || bgMap.naturalWidth === 0) { ctx.fillStyle = '#222'; ctx.fillRect(0, 0, canvas.width, canvas.height); }

    ctx.save(); ctx.translate(camera.x, camera.y); ctx.scale(camera.zoom, camera.zoom);
    if (bgMap.complete && bgMap.naturalWidth > 0) ctx.drawImage(bgMap, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    ctx.globalAlpha = 0.55; 
    for (const key in territory) {
        const owner = countries[territory[key].owner];
        if (owner) {
            const [ix, iy] = key.split('_').map(Number);
            ctx.fillStyle = owner.color; ctx.fillRect(ix * TILE_SIZE, iy * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            if (territory[key].captureProgress > 0) { ctx.fillStyle = 'rgba(255, 0, 0, 0.4)'; ctx.fillRect(ix * TILE_SIZE, iy * TILE_SIZE, TILE_SIZE, TILE_SIZE); }
        }
    }

    ctx.globalAlpha = 1.0;
    const LINE_W = 1.5; const step = TILE_SIZE;
    const getCellOwner = (nx, ny) => { const nCell = territory[`${nx}_${ny}`]; return nCell ? nCell.owner : null; };
    const getCellRegion = (nx, ny) => { const nCell = territory[`${nx}_${ny}`]; return nCell ? nCell.regionId : null; };

    for (const key in territory) {
        const cell = territory[key]; const [ix, iy] = key.split('_').map(Number); const x = ix * step; const y = iy * step; const owner = cell.owner;
        ctx.fillStyle = 'rgba(20, 20, 20, 0.9)'; 
        if (getCellOwner(ix, iy - 1) !== owner) ctx.fillRect(x, y, step, LINE_W); 
        if (getCellOwner(ix, iy + 1) !== owner) ctx.fillRect(x, y + step - LINE_W, step, LINE_W); 
        if (getCellOwner(ix - 1, iy) !== owner) ctx.fillRect(x, y, LINE_W, step); 
        if (getCellOwner(ix + 1, iy) !== owner) ctx.fillRect(x + step - LINE_W, y, LINE_W, step); 
        ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
        if (getCellOwner(ix, iy - 1) === owner && getCellRegion(ix, iy - 1) !== cell.regionId) ctx.fillRect(x, y, step, 1);
        if (getCellOwner(ix - 1, iy) === owner && getCellRegion(ix - 1, iy) !== cell.regionId) ctx.fillRect(x, y, 1, step);
    }

    for (const rId in regions) {
        const reg = regions[rId];
        if (reg.cityX !== undefined) {
            const tx = reg.cityX * TILE_SIZE + TILE_SIZE/2; const ty = reg.cityY * TILE_SIZE + TILE_SIZE/2;
            ctx.fillStyle = 'rgba(10, 10, 10, 0.9)'; ctx.fillRect(tx - 4, ty - 4, 8, 8);
            ctx.strokeStyle = (reg.siegeProgress > 0) ? '#e74c3c' : '#fff'; ctx.lineWidth = (reg.siegeProgress > 0) ? 2 / camera.zoom : 1 / camera.zoom; ctx.strokeRect(tx - 4, ty - 4, 8, 8);
            ctx.fillStyle = 'white'; ctx.font = `bold ${10 / camera.zoom}px Arial`; ctx.textAlign = 'center'; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2 / camera.zoom;
            ctx.strokeText(reg.name, tx, ty - (10 / camera.zoom)); ctx.fillText(reg.name, tx, ty - (10 / camera.zoom));
        }
    }

    if (isDrawingRegion && lassoPoints.length > 0) {
        ctx.beginPath(); ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
        for(let i=1; i<lassoPoints.length; i++) ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
        ctx.lineTo(lassoPoints[0].x, lassoPoints[0].y); ctx.strokeStyle = '#f1c40f'; ctx.lineWidth = 2 / camera.zoom; ctx.stroke();
    }

    const radius = 8 / camera.zoom; 
    for(const id in visualArmies) {
        const army = visualArmies[id]; const owner = countries[army.owner]; if (!owner) continue;
        if (selectedArmies.includes(id)) {
            ctx.beginPath(); ctx.arc(army.x, army.y, radius * 1.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(46, 204, 113, 0.5)'; ctx.fill();
            if (army.targetX !== null) { ctx.beginPath(); ctx.moveTo(army.x, army.y); ctx.lineTo(army.targetX, army.targetY); ctx.strokeStyle = 'rgba(46, 204, 113, 0.4)'; ctx.lineWidth = 2 / camera.zoom; ctx.setLineDash([4/camera.zoom, 4/camera.zoom]); ctx.stroke(); ctx.setLineDash([]); }
        }
        ctx.save(); ctx.beginPath(); ctx.arc(army.x, army.y, radius, 0, Math.PI * 2); ctx.closePath(); ctx.clip(); 
        const flagImg = getFlagImage(army.owner, owner.flag);
        if (flagImg && flagImg.complete) { ctx.drawImage(flagImg, army.x - radius, army.y - radius, radius * 2, radius * 2); } else { ctx.fillStyle = owner.color; ctx.fill(); }
        ctx.restore();
        ctx.beginPath(); ctx.arc(army.x, army.y, radius, 0, Math.PI * 2); ctx.lineWidth = 1.5 / camera.zoom; ctx.strokeStyle = army.inCombat ? 'rgba(192, 57, 43, 1)' : owner.color; ctx.stroke();
        ctx.fillStyle = 'white'; ctx.font = `bold ${9 / camera.zoom}px Arial`; ctx.strokeStyle = 'black'; ctx.lineWidth = 2 / camera.zoom; const countText = Math.floor(army.count).toString();
        ctx.strokeText(countText, army.x, army.y + radius + (8 / camera.zoom)); ctx.fillText(countText, army.x, army.y + radius + (8 / camera.zoom));
    }

    if (isSelecting) {
        ctx.fillStyle = 'rgba(46, 204, 113, 0.2)'; ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 1 / camera.zoom;
        const w = selectionBox.endX - selectionBox.startX; const h = selectionBox.endY - selectionBox.startY;
        ctx.fillRect(selectionBox.startX, selectionBox.startY, w, h); ctx.strokeRect(selectionBox.startX, selectionBox.startY, w, h);
    }
    ctx.restore();

    if (myId && !isSpawned) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; ctx.fillRect(0, canvas.height / 2 - 60, canvas.width, 120);
        ctx.fillStyle = '#f1c40f'; ctx.font = 'bold 35px Arial'; ctx.textAlign = 'center';
        ctx.fillText("КЛИКНИТЕ В ЛЮБОЕ МЕСТО КАРТЫ, ЧТОБЫ ОСНОВАТЬ СТОЛИЦУ", canvas.width / 2, canvas.height / 2 + 10);
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
            if (tilesInside.length > 0) { const name = prompt("Назовите регион:", `Регион ${Object.keys(regions).length + 1}`); if (name !== null) { socket.emit('lassoRegion', { tiles: tilesInside, newRegionId: currentDrawingRegionId, name: name || "Без названия" }); showMsg("Оформляем документы..."); } }
        }
        isDrawingRegion = false; lassoPoints = []; const drawBtn = document.getElementById('drawRegionBtn'); if(drawBtn) drawBtn.innerText = "Сформировать регион"; return;
    }
    if (e.button === 0 && isSelecting) {
        isSelecting = false; const world = getWorldCoords(e);
        const minX = Math.min(selectionBox.startX, world.x); const maxX = Math.max(selectionBox.startX, world.x); const minY = Math.min(selectionBox.startY, world.y); const maxY = Math.max(selectionBox.startY, world.y);
        const isClick = (maxX - minX < 5 && maxY - minY < 5); selectedArmies = []; const hr = (8 / camera.zoom) + 2;
        for (const id in visualArmies) {
            const a = visualArmies[id];
            if (a.owner === myId) { if (isClick && Math.hypot(a.x - world.x, a.y - world.y) <= hr) selectedArmies.push(id); else if (!isClick && a.x >= minX && a.x <= maxX && a.y >= minY && a.y <= maxY) selectedArmies.push(id); }
        }
        const disbBtn = document.getElementById('disbandBtn'); if(disbBtn) disbBtn.style.display = selectedArmies.length > 0 ? 'block' : 'none';
        if (isClick && selectedArmies.length === 0) {
            const key = `${Math.floor(world.x/TILE_SIZE)}_${Math.floor(world.y/TILE_SIZE)}`;
            if (territory[key] && territory[key].owner === myId) { clickedRegionId = territory[key].regionId; updateRegionPanel(); } else { const rp = document.getElementById('regionPanel'); if(rp) rp.style.display = 'none'; clickedRegionId = null; }
        } else if (!isClick || selectedArmies.length > 0) { const rp = document.getElementById('regionPanel'); if(rp) rp.style.display = 'none'; clickedRegionId = null; }
    }
});

function updateRegionPanel() {
    if (!clickedRegionId || !regions[clickedRegionId]) return;
    const reg = regions[clickedRegionId]; const rp = document.getElementById('regionPanel'); if(rp) rp.style.display = 'block';
    const rName = document.getElementById('regName'); if(rName) rName.innerText = reg.name;
    const rOwner = document.getElementById('regOwner'); if(rOwner) rOwner.innerText = countries[reg.owner] ? countries[reg.owner].name : "Неизвестно";
    const rLvl = document.getElementById('regLevel'); if(rLvl) rLvl.innerText = reg.level;
    const rInc = document.getElementById('regIncome'); if(rInc) rInc.innerText = (reg.cells * 1.5 * reg.level).toLocaleString(); 
    const defLevel = reg.defLevel || 0; const rDefLvl = document.getElementById('regDefLevel'); if(rDefLvl) rDefLvl.innerText = defLevel;
    const btnEcon = document.getElementById('upgradeBtn'); const btnDef = document.getElementById('upgradeDefBtn'); const renBtn = document.getElementById('renameRegBtn');
    
    if (reg.owner === myId) {
        if(btnEcon) btnEcon.style.display = 'block'; if(btnDef) btnDef.style.display = 'block'; if(renBtn) renBtn.style.display = 'inline-block';
        const upgradeCost = reg.cells * reg.level * 50;
        if (btnEcon) { if (reg.level >= 10) { btnEcon.innerText = "Инфраструктура Макс"; btnEcon.disabled = true; btnEcon.style.background = '#7f8c8d'; } else { btnEcon.innerText = `Улучшить Инфраструктуру (${upgradeCost.toLocaleString()} $)`; btnEcon.disabled = countries[myId].dollars < upgradeCost; btnEcon.style.background = btnEcon.disabled ? '#7f8c8d' : '#27ae60'; } }
        const defCostDol = reg.cells * (defLevel + 1) * 20; const defCostMil = reg.cells * (defLevel + 1) * 10;
        if (btnDef) { if (defLevel >= 10) { btnDef.innerText = "Оборона Макс"; btnDef.disabled = true; btnDef.style.background = '#7f8c8d'; } else { btnDef.innerText = `Укрепить Оборону (${defCostDol.toLocaleString()} $, ${defCostMil.toLocaleString()} ⚔️)`; btnDef.disabled = (countries[myId].dollars < defCostDol || countries[myId].military < defCostMil); btnDef.style.background = btnDef.disabled ? '#7f8c8d' : '#c0392b'; } }
    } else { 
        if(btnEcon) btnEcon.style.display = 'none'; if(btnDef) btnDef.style.display = 'none'; if(renBtn) renBtn.style.display = 'none';
    }
}
