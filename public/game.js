const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const WORLD_WIDTH = 1920; const WORLD_HEIGHT = 1080;
const TILE_SIZE = 5; 
const KM_PER_TILE = TILE_SIZE * TILE_SIZE * 111.32 * 111.32; 

canvas.width = WORLD_WIDTH; canvas.height = WORLD_HEIGHT;

let territory = {}; let countries = {}; let armies = {}; let regions = {};
let myId = null; let isPlaying = false; let isSpawned = false;

let visualArmies = {};
let camera = { x: 0, y: 0, zoom: 1 };
let isPanning = false; let lastMouse = {x: 0, y: 0};

let selectedArmies = [];
let isSelecting = false;
let selectionBox = { startX: 0, startY: 0, endX: 0, endY: 0 };

let isDrawingRegion = false; let currentDrawingRegionId = null; let clickedRegionId = null;

const sysMsg = document.getElementById('systemMsg');
function showMsg(text) { sysMsg.innerText = text; setTimeout(() => sysMsg.innerText = "Ожидание приказа...", 3000); }

const bgMap = new Image(); 
bgMap.src = 'Map.png'; 
bgMap.onload = () => { requestAnimationFrame(gameLoop); };

// ЛОББИ И ПОДКЛЮЧЕНИЕ
socket.on('initLobby', (cList) => {
    countries = cList;
    if (isPlaying) return; // Если мы уже в игре, не трогаем меню
    const select = document.getElementById('countrySelect');
    select.innerHTML = '<option value="new">-- Основать новую страну --</option>';
    for (let cId in countries) {
        if (!countries[cId].online) {
            select.innerHTML += `<option value="${cId}">${countries[cId].flag} ${countries[cId].name} (Заброшена)</option>`;
        }
    }
});

document.getElementById('countrySelect').addEventListener('change', (e) => {
    document.getElementById('newCountryForm').style.display = e.target.value === 'new' ? 'block' : 'none';
});

document.getElementById('joinBtn').addEventListener('click', () => {
    const selectVal = document.getElementById('countrySelect').value;
    if (selectVal === 'new') {
        const name = document.getElementById('countryName').value || 'Империя';
        const flag = document.getElementById('countryFlag').value || '🏳️';
        const color = document.getElementById('countryColor').value;
        socket.emit('joinGame', { isNew: true, name, color, flag });
    } else {
        socket.emit('joinGame', { isNew: false, countryId: selectVal });
    }
});

socket.on('joinSuccess', (cId) => {
    myId = cId;
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('topBar').style.display = 'flex';
    document.getElementById('controlPanel').style.display = 'block';
    document.getElementById('myName').innerText = countries[myId].name; 
    document.getElementById('myFlagUI').innerText = countries[myId].flag;
    isSpawned = countries[myId].isSpawned;
    isPlaying = true;
});


// КНОПКИ УПРАВЛЕНИЯ
document.getElementById('deployBtn').addEventListener('click', () => {
    const amount = document.getElementById('deployAmount').value;
    if (clickedRegionId) { socket.emit('deployArmy', { regionId: clickedRegionId, amount: amount }); showMsg(`Развертывание ${amount} солдат!`); }
});

document.getElementById('disbandBtn').addEventListener('click', () => {
    if (selectedArmies.length > 0) { socket.emit('disbandArmies', selectedArmies); showMsg("Дивизии распущены."); selectedArmies = []; document.getElementById('disbandBtn').style.display = 'none'; }
});

document.getElementById('upgradeBtn').addEventListener('click', () => {
    if (clickedRegionId && regions[clickedRegionId]) socket.emit('upgradeRegion', clickedRegionId);
});

document.getElementById('drawRegionBtn').addEventListener('click', () => {
    isDrawingRegion = !isDrawingRegion;
    document.getElementById('drawRegionBtn').innerText = isDrawingRegion ? "Сохранить регион" : "Выделить новый регион";
    if (isDrawingRegion) { currentDrawingRegionId = `reg_${myId}_${Math.random().toString(36).substr(2, 5)}`; showMsg("Зажмите ЛКМ и проведите по территории");
    } else { showMsg("Регион сохранен!"); }
});

document.getElementById('closeRegBtn').addEventListener('click', () => { document.getElementById('regionPanel').style.display = 'none'; clickedRegionId = null; });

// СИНХРОНИЗАЦИЯ СЕРВЕРА
socket.on('initData', (data) => { territory = data.territory; armies = data.armies; regions = data.regions; });
socket.on('updateMap', (data) => { countries = data.countries; territory = data.territory; regions = data.regions; if (myId && countries[myId] && countries[myId].isSpawned) isSpawned = true; updateUI(); });
socket.on('syncTerritory', (data) => { territory = data.territory; regions = data.regions; updateRegionPanel(); });
socket.on('updateResources', (c) => { countries = c; updateUI(); updateRegionPanel(); });

socket.on('cellUpdate', (data) => {
    territory[data.key] = data.cell; regions = data.regions; if (data.countries) countries = data.countries;
    updateUI(); updateRegionPanel();
});

socket.on('batchCellUpdate', (data) => {
    for (const key in data.cells) { territory[key] = data.cells[key]; }
    regions = data.regions; if (data.countries) countries = data.countries;
    updateUI(); updateRegionPanel();
});

socket.on('syncArmies', (a) => { 
    armies = a; 
    for(let id in armies) { if(!visualArmies[id]) { visualArmies[id] = { x: armies[id].x, y: armies[id].y, count: armies[id].count }; } }
});

// ДВИЖОК И ОТРИСОВКА
function gameLoop() {
    for(let id in visualArmies) {
        if(armies[id]) {
            visualArmies[id].x += (armies[id].x - visualArmies[id].x) * 0.4;
            visualArmies[id].y += (armies[id].y - visualArmies[id].y) * 0.4;
            visualArmies[id].count = armies[id].count; visualArmies[id].owner = armies[id].owner;
            visualArmies[id].inCombat = armies[id].inCombat; visualArmies[id].targetX = armies[id].targetX; visualArmies[id].targetY = armies[id].targetY;
        } else { delete visualArmies[id]; }
    }
    drawMap();
    requestAnimationFrame(gameLoop);
}

function updateUI() {
    if (myId && countries[myId]) {
        document.getElementById('myArea').innerText = Math.floor(countries[myId].cells * KM_PER_TILE / 1000).toLocaleString(); 
        document.getElementById('myDollars').innerText = Math.floor(countries[myId].dollars).toLocaleString();
        document.getElementById('myIncome').innerText = (countries[myId].lastIncome >= 0 ? "+" : "") + Math.floor(countries[myId].lastIncome);
        document.getElementById('myIncome').style.color = countries[myId].lastIncome >= 0 ? '#27ae60' : '#c0392b';
        document.getElementById('myMilitary').innerText = Math.floor(countries[myId].military).toLocaleString();
        document.getElementById('myCap').innerText = countries[myId].cap.toLocaleString();
    }
}

function getRegionCenters() {
    let centers = {};
    for (const key in territory) {
        const cell = territory[key];
        if (!centers[cell.regionId]) centers[cell.regionId] = { sumX: 0, sumY: 0, count: 0, name: regions[cell.regionId]?.name || '' };
        const [x, y] = key.split('_').map(Number);
        centers[cell.regionId].sumX += x; centers[cell.regionId].sumY += y; centers[cell.regionId].count++;
    }
    return centers;
}

function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.translate(camera.x, camera.y); ctx.scale(camera.zoom, camera.zoom);

    if (bgMap.complete) ctx.drawImage(bgMap, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    ctx.globalAlpha = 0.55; 
    for (const key in territory) {
        const owner = countries[territory[key].owner];
        if (owner) {
            const [ix, iy] = key.split('_').map(Number);
            ctx.fillStyle = owner.color; ctx.fillRect(ix * TILE_SIZE, iy * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
    }

    ctx.globalAlpha = 1.0;
    const LINE_W = 1.5; const step = TILE_SIZE;

    const getCellOwner = (nx, ny) => { const nCell = territory[`${nx}_${ny}`]; return nCell ? nCell.owner : null; };
    const getCellRegion = (nx, ny) => { const nCell = territory[`${nx}_${ny}`]; return nCell ? nCell.regionId : null; };

    for (const key in territory) {
        const cell = territory[key];
        const [ix, iy] = key.split('_').map(Number);
        const x = ix * step; const y = iy * step; const owner = cell.owner;

        ctx.fillStyle = 'rgba(20, 20, 20, 0.9)'; 
        if (getCellOwner(ix, iy - 1) !== owner) ctx.fillRect(x, y, step, LINE_W); 
        if (getCellOwner(ix, iy + 1) !== owner) ctx.fillRect(x, y + step - LINE_W, step, LINE_W); 
        if (getCellOwner(ix - 1, iy) !== owner) ctx.fillRect(x, y, LINE_W, step); 
        if (getCellOwner(ix + 1, iy) !== owner) ctx.fillRect(x + step - LINE_W, y, LINE_W, step); 

        ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
        if (getCellOwner(ix, iy - 1) === owner && getCellRegion(ix, iy - 1) !== cell.regionId) ctx.fillRect(x, y, step, 1);
        if (getCellOwner(ix - 1, iy) === owner && getCellRegion(ix - 1, iy) !== cell.regionId) ctx.fillRect(x, y, 1, step);
    }

    const regCenters = getRegionCenters();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
    for (const rId in regCenters) {
        const c = regCenters[rId];
        if (c.count > 0) {
            const tx = (c.sumX/c.count)*TILE_SIZE + (TILE_SIZE/2); const ty = (c.sumY/c.count)*TILE_SIZE + (TILE_SIZE/2);
            ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2;
            ctx.strokeText(c.name, tx, ty); ctx.fillText(c.name, tx, ty);
        }
    }

    // --- КРОШЕЧНЫЕ АРМИИ ---
    for(const id in visualArmies) {
        const army = visualArmies[id]; const owner = countries[army.owner];
        if (!owner) continue;

        if (selectedArmies.includes(id)) {
            // Ауру тоже уменьшили (радиус 4)
            ctx.beginPath(); ctx.arc(army.x, army.y, 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(46, 204, 113, 0.5)'; ctx.fill();
            if (army.targetX !== null) {
                ctx.beginPath(); ctx.moveTo(army.x, army.y); ctx.lineTo(army.targetX, army.targetY);
                ctx.strokeStyle = 'rgba(46, 204, 113, 0.4)'; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]);
            }
        }

        // Само тело армии теперь радиусом 2 (было 6)
        ctx.beginPath(); ctx.arc(army.x, army.y, 2, 0, Math.PI * 2); 
        ctx.fillStyle = owner.color; ctx.fill();
        
        if(army.inCombat) { ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(192, 57, 43, 1)'; } else { ctx.lineWidth = 0.5; ctx.strokeStyle = '#fff'; }
        ctx.stroke();

        // Флаг рисуем ЧУТЬ ВЫШЕ кружка
        ctx.fillStyle = 'white'; ctx.font = '7px Arial'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; 
        ctx.fillText(owner.flag, army.x, army.y - 5);
        
        // Цифры рисуем ЧУТЬ НИЖЕ кружка
        ctx.fillStyle = 'white'; ctx.font = 'bold 7px Arial'; ctx.strokeStyle = 'black'; ctx.lineWidth = 1.5;
        const countText = Math.floor(army.count).toString();
        ctx.strokeText(countText, army.x, army.y + 5); ctx.fillText(countText, army.x, army.y + 5);
    }

    if (isSelecting) {
        ctx.fillStyle = 'rgba(46, 204, 113, 0.2)'; ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 1;
        const w = selectionBox.endX - selectionBox.startX; const h = selectionBox.endY - selectionBox.startY;
        ctx.fillRect(selectionBox.startX, selectionBox.startY, w, h); ctx.strokeRect(selectionBox.startX, selectionBox.startY, w, h);
    }

    ctx.restore();
}

// УПРАВЛЕНИЕ
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomAmount = 0.1; const oldZoom = camera.zoom;
    camera.zoom = e.deltaY > 0 ? Math.max(0.5, camera.zoom - zoomAmount) : Math.min(4, camera.zoom + zoomAmount);
    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
    camera.x = mouseX - (mouseX - camera.x) * (camera.zoom / oldZoom); camera.y = mouseY - (mouseY - camera.y) * (camera.zoom / oldZoom);
});

function getWorldCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const canvasMouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const canvasMouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
    return { x: (canvasMouseX - camera.x) / camera.zoom, y: (canvasMouseY - camera.y) / camera.zoom };
}

canvas.addEventListener('mousedown', (e) => { 
    const world = getWorldCoords(e);
    if (e.button === 1) { isPanning = true; lastMouse = {x: e.clientX, y: e.clientY}; return; }

    if (e.button === 0) {
        if (!isSpawned) { socket.emit('spawnCapital', { x: Math.floor(world.x/TILE_SIZE), y: Math.floor(world.y/TILE_SIZE) }); return; }
        if (isDrawingRegion) return;
        isSelecting = true; selectionBox.startX = world.x; selectionBox.startY = world.y; selectionBox.endX = world.x; selectionBox.endY = world.y;
    }
    
    if (e.button === 2 && selectedArmies.length > 0 && !isDrawingRegion) { socket.emit('moveArmies', { armyIds: selectedArmies, targetX: world.x, targetY: world.y }); }
});

canvas.addEventListener('mousemove', (e) => { 
    if (isPanning) { camera.x += (e.clientX - lastMouse.x); camera.y += (e.clientY - lastMouse.y); lastMouse = {x: e.clientX, y: e.clientY}; return; }
    const world = getWorldCoords(e);
    if (isSelecting) { selectionBox.endX = world.x; selectionBox.endY = world.y;
    } else if (isDrawingRegion && e.buttons === 1) { socket.emit('paintRegion', { x: Math.floor(world.x/TILE_SIZE), y: Math.floor(world.y/TILE_SIZE), newRegionId: currentDrawingRegionId }); }
});

canvas.addEventListener('mouseup', (e) => { 
    if (e.button === 1) isPanning = false;
    if (e.button === 0 && isSelecting) {
        isSelecting = false; const world = getWorldCoords(e); selectionBox.endX = world.x; selectionBox.endY = world.y;
        
        const minX = Math.min(selectionBox.startX, selectionBox.endX); const maxX = Math.max(selectionBox.startX, selectionBox.endX);
        const minY = Math.min(selectionBox.startY, selectionBox.endY); const maxY = Math.max(selectionBox.startY, selectionBox.endY);
        const isClick = (maxX - minX < 5 && maxY - minY < 5);
        selectedArmies = [];

        for (const id in visualArmies) {
            const a = visualArmies[id];
            if (a.owner === myId) {
                // Радиус клика уменьшен до 6, так как армии стали крошечными
                if (isClick && Math.hypot(a.x - world.x, a.y - world.y) <= 6) { selectedArmies.push(id); } 
                else if (!isClick && a.x >= minX && a.x <= maxX && a.y >= minY && a.y <= maxY) { selectedArmies.push(id); }
            }
        }

        document.getElementById('disbandBtn').style.display = selectedArmies.length > 0 ? 'block' : 'none';

        if (isClick && selectedArmies.length === 0) {
            const cellKey = `${Math.floor(world.x/TILE_SIZE)}_${Math.floor(world.y/TILE_SIZE)}`;
            if (territory[cellKey] && territory[cellKey].owner === myId) { clickedRegionId = territory[cellKey].regionId; updateRegionPanel();
            } else { document.getElementById('regionPanel').style.display = 'none'; clickedRegionId = null; }
        } else if (!isClick || selectedArmies.length > 0) { document.getElementById('regionPanel').style.display = 'none'; clickedRegionId = null; }
    }
});

function updateRegionPanel() {
    if (!clickedRegionId || !regions[clickedRegionId]) return;
    const reg = regions[clickedRegionId];
    
    document.getElementById('regionPanel').style.display = 'block';
    document.getElementById('regName').innerText = reg.name;
    document.getElementById('regOwner').innerText = countries[reg.owner] ? countries[reg.owner].name : "Неизвестно";
    document.getElementById('regLevel').innerText = reg.level;
    document.getElementById('regIncome').innerText = (reg.cells * 1.5 * reg.level).toLocaleString(); 

    const upgradeCost = reg.cells * reg.level * 50;
    const btn = document.getElementById('upgradeBtn');
    
    if (reg.owner === myId) {
        btn.style.display = 'block';
        if (reg.level >= 10) {
            btn.innerText = "Макс. уровень"; btn.disabled = true; btn.style.background = '#7f8c8d';
        } else {
            btn.innerText = `Прокачать (${upgradeCost.toLocaleString()} $)`;
            btn.disabled = countries[myId].dollars < upgradeCost;
            btn.style.background = btn.disabled ? '#7f8c8d' : '#27ae60';
        }
    } else { btn.style.display = 'none'; }
}
