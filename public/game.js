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

// ПЕРЕМЕННЫЕ ЛАССО
let isDrawingRegion = false; let currentDrawingRegionId = null; let clickedRegionId = null;
let lassoPoints = [];

const sysMsg = document.getElementById('systemMsg');
function showMsg(text) { sysMsg.innerText = text; setTimeout(() => sysMsg.innerText = "Управление камерой: W A S D", 3000); }

const bgMap = new Image(); 
bgMap.src = 'Map.png'; 
bgMap.onload = () => { requestAnimationFrame(gameLoop); };

// УПРАВЛЕНИЕ WASD
const keys = { w: false, a: false, s: false, d: false };
window.addEventListener('keydown', (e) => {
    let key = e.key.toLowerCase();
    if (key === 'w' || key === 'ц') keys.w = true;
    if (key === 'a' || key === 'ф') keys.a = true;
    if (key === 's' || key === 'ы') keys.s = true;
    if (key === 'd' || key === 'в') keys.d = true;
});
window.addEventListener('keyup', (e) => {
    let key = e.key.toLowerCase();
    if (key === 'w' || key === 'ц') keys.w = false;
    if (key === 'a' || key === 'ф') keys.a = false;
    if (key === 's' || key === 'ы') keys.s = false;
    if (key === 'd' || key === 'в') keys.d = false;
});

// ЛОББИ И ФЛАГ
let base64Flag = null;
const flagCache = {}; 
function getFlagImage(cId, base64Str) {
    if (!flagCache[cId]) { const img = new Image(); img.src = base64Str; flagCache[cId] = img; }
    return flagCache[cId];
}

document.getElementById('countryFlagFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const tempCanvas = document.createElement('canvas'); tempCanvas.width = 64; tempCanvas.height = 64; 
                const tCtx = tempCanvas.getContext('2d'); tCtx.drawImage(img, 0, 0, 64, 64);
                base64Flag = tempCanvas.toDataURL('image/png');
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }
});

socket.on('initLobby', (cList) => {
    countries = cList;
    if (isPlaying) return; 
    const select = document.getElementById('countrySelect');
    select.innerHTML = '<option value="new">-- Основать новую страну --</option>';
    for (let cId in countries) { if (!countries[cId].online) select.innerHTML += `<option value="${cId}">${countries[cId].name} (Заброшена)</option>`; }
});

document.getElementById('countrySelect').addEventListener('change', (e) => {
    document.getElementById('newCountryForm').style.display = e.target.value === 'new' ? 'block' : 'none';
});

document.getElementById('joinBtn').addEventListener('click', () => {
    const selectVal = document.getElementById('countrySelect').value;
    if (selectVal === 'new') {
        const name = document.getElementById('countryName').value || 'Империя'; const color = document.getElementById('countryColor').value;
        if (!base64Flag) {
            const tCnv = document.createElement('canvas'); tCnv.width = 64; tCnv.height = 64;
            const tCtx = tCnv.getContext('2d'); tCtx.fillStyle = color; tCtx.fillRect(0,0,64,64); base64Flag = tCnv.toDataURL();
        }
        socket.emit('joinGame', { isNew: true, name, color, flag: base64Flag });
    } else { socket.emit('joinGame', { isNew: false, countryId: selectVal }); }
});

socket.on('joinSuccess', (cId) => {
    myId = cId; document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('topBar').style.display = 'flex'; document.getElementById('controlPanel').style.display = 'block';
    document.getElementById('myName').innerText = countries[myId].name; document.getElementById('myFlagUI').src = countries[myId].flag;
    isSpawned = countries[myId].isSpawned; isPlaying = true;
});


// КНОПКИ
document.getElementById('deployBtn').addEventListener('click', () => {
    const amount = document.getElementById('deployAmount').value;
    if (clickedRegionId) { socket.emit('deployArmy', { regionId: clickedRegionId, amount: amount }); showMsg(`Развертывание ${amount} солдат!`); }
});

document.getElementById('disbandBtn').addEventListener('click', () => {
    if (selectedArmies.length > 0) { socket.emit('disbandArmies', selectedArmies); showMsg("Дивизии распущены."); selectedArmies = []; document.getElementById('disbandBtn').style.display = 'none'; }
});

document.getElementById('upgradeBtn').addEventListener('click', () => { if (clickedRegionId) socket.emit('upgradeRegion', clickedRegionId); });
document.getElementById('upgradeDefBtn').addEventListener('click', () => { if (clickedRegionId) socket.emit('upgradeDefense', clickedRegionId); });

document.getElementById('drawRegionBtn').addEventListener('click', () => {
    isDrawingRegion = !isDrawingRegion;
    document.getElementById('drawRegionBtn').innerText = isDrawingRegion ? "Отменить" : "Новый регион (Обвести)";
    if (isDrawingRegion) { currentDrawingRegionId = `reg_${myId}_${Math.random().toString(36).substr(2, 5)}`; showMsg("Обведите территорию ЛКМ"); } 
    else { lassoPoints = []; }
});

document.getElementById('closeRegBtn').addEventListener('click', () => { document.getElementById('regionPanel').style.display = 'none'; clickedRegionId = null; });

socket.on('initData', (data) => { territory = data.territory; armies = data.armies; regions = data.regions; });
socket.on('updateMap', (data) => { countries = data.countries; territory = data.territory; regions = data.regions; if (myId && countries[myId] && countries[myId].isSpawned) isSpawned = true; updateUI(); });
socket.on('syncTerritory', (data) => { territory = data.territory; regions = data.regions; updateRegionPanel(); });
socket.on('updateResources', (c) => { countries = c; updateUI(); updateRegionPanel(); });

socket.on('cellUpdate', (data) => { territory[data.key] = data.cell; regions = data.regions; if (data.countries) countries = data.countries; updateUI(); updateRegionPanel(); });
socket.on('batchCellUpdate', (data) => { for (const key in data.cells) { territory[key] = data.cells[key]; } regions = data.regions; if (data.countries) countries = data.countries; updateUI(); updateRegionPanel(); });

socket.on('syncArmies', (a) => { 
    armies = a; 
    for(let id in armies) { if(!visualArmies[id]) { visualArmies[id] = { x: armies[id].x, y: armies[id].y, count: armies[id].count }; } }
});

// Находим функцию gameLoop и заменяем управление камерой внутри неё:
function gameLoop() {
    // УПРАВЛЕНИЕ WASD с проверкой границ
    const camSpeed = 15 / camera.zoom;
    if (keys.w) camera.y += camSpeed;
    if (keys.s) camera.y -= camSpeed;
    if (keys.a) camera.x += camSpeed;
    if (keys.d) camera.x -= camSpeed;

    // ОГРАНИЧЕНИЕ КАМЕРЫ (чтобы не видеть пустоту)
    // Не даем камере уйти слишком далеко вправо/вниз (координаты не могут быть положительными больше 0)
    if (camera.x > 0) camera.x = 0;
    if (camera.y > 0) camera.y = 0;

    // Не даем камере уйти слишком далеко влево/вверх (с учетом зума)
    const minX = canvas.width - WORLD_WIDTH * camera.zoom;
    const minY = canvas.height - WORLD_HEIGHT * camera.zoom;
    
    if (camera.x < minX) camera.x = minX;
    if (camera.y < minY) camera.y = minY;

    // Обновление визуальных армий
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

// Заменяем обработчик Wheel (зум), чтобы он тоже соблюдал границы:
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomAmount = 0.1;
    const oldZoom = camera.zoom;
    
    // Минимальный зум вычисляем так, чтобы карта всегда заполняла экран
    const minZoom = Math.max(canvas.width / WORLD_WIDTH, canvas.height / WORLD_HEIGHT);
    camera.zoom = e.deltaY > 0 ? Math.max(minZoom, camera.zoom - zoomAmount) : Math.min(6, camera.zoom + zoomAmount);
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
    
    // Пересчитываем положение, чтобы зум шел в точку курсора
    camera.x = mouseX - (mouseX - camera.x) * (camera.zoom / oldZoom);
    camera.y = mouseY - (mouseY - camera.y) * (camera.zoom / oldZoom);
});

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

// АЛГОРИТМ ПРОВЕРКИ ТОЧКИ В ПОЛИГОНЕ (Для лассо)
function pointInPolygon(point, vs) {
    let x = point[0], y = point[1]; let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        let xi = vs[i][0], yi = vs[i][1]; let xj = vs[j][0], yj = vs[j][1];
        let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
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

for (const rId in regions) {
        const reg = regions[rId];
        if (reg.cityX !== undefined) {
            const tx = reg.cityX * TILE_SIZE + TILE_SIZE / 2;
            const ty = reg.cityY * TILE_SIZE + TILE_SIZE / 2;
            
            // ГОРОД (Тёмный квадрат) - теперь рисуется по фиксированным координатам
            ctx.fillStyle = 'rgba(10, 10, 10, 0.9)';
            ctx.fillRect(tx - 4, ty - 4, 8, 8);
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 / camera.zoom;
            ctx.strokeRect(tx - 4, ty - 4, 8, 8);

            // Название над городом
            ctx.fillStyle = 'white'; ctx.font = `bold ${10 / camera.zoom}px Arial`;
            ctx.textAlign = 'center';
            ctx.fillText(reg.name, tx, ty - 10 / camera.zoom);
        }
    }

    // ЛИНИЯ ЛАССО
    if (isDrawingRegion && lassoPoints.length > 0) {
        ctx.beginPath();
        ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
        for(let i=1; i<lassoPoints.length; i++) ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
        ctx.lineTo(lassoPoints[0].x, lassoPoints[0].y); // Замыкаем
        ctx.strokeStyle = '#f1c40f'; ctx.lineWidth = 2 / camera.zoom; ctx.stroke();
    }

    const radius = 8 / camera.zoom; 

    for(const id in visualArmies) {
        const army = visualArmies[id]; const owner = countries[army.owner];
        if (!owner) continue;

        if (selectedArmies.includes(id)) {
            ctx.beginPath(); ctx.arc(army.x, army.y, radius * 1.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(46, 204, 113, 0.5)'; ctx.fill();
            if (army.targetX !== null) {
                ctx.beginPath(); ctx.moveTo(army.x, army.y); ctx.lineTo(army.targetX, army.targetY);
                ctx.strokeStyle = 'rgba(46, 204, 113, 0.4)'; ctx.lineWidth = 2 / camera.zoom; ctx.setLineDash([4/camera.zoom, 4/camera.zoom]); ctx.stroke(); ctx.setLineDash([]);
            }
        }

        ctx.save();
        ctx.beginPath(); ctx.arc(army.x, army.y, radius, 0, Math.PI * 2); ctx.closePath(); ctx.clip(); 
        const flagImg = getFlagImage(army.owner, owner.flag);
        if (flagImg && flagImg.complete) { ctx.drawImage(flagImg, army.x - radius, army.y - radius, radius * 2, radius * 2);
        } else { ctx.fillStyle = owner.color; ctx.fill(); }
        ctx.restore();

        ctx.beginPath(); ctx.arc(army.x, army.y, radius, 0, Math.PI * 2);
        ctx.lineWidth = 1.5 / camera.zoom; ctx.strokeStyle = army.inCombat ? 'rgba(192, 57, 43, 1)' : owner.color; ctx.stroke();
        
        ctx.fillStyle = 'white'; ctx.font = `bold ${9 / camera.zoom}px Arial`; ctx.strokeStyle = 'black'; ctx.lineWidth = 2 / camera.zoom;
        const countText = Math.floor(army.count).toString();
        ctx.strokeText(countText, army.x, army.y + radius + (8 / camera.zoom)); ctx.fillText(countText, army.x, army.y + radius + (8 / camera.zoom));
    }

    if (isSelecting) {
        ctx.fillStyle = 'rgba(46, 204, 113, 0.2)'; ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 1;
        const w = selectionBox.endX - selectionBox.startX; const h = selectionBox.endY - selectionBox.startY;
        ctx.fillRect(selectionBox.startX, selectionBox.startY, w, h); ctx.strokeRect(selectionBox.startX, selectionBox.startY, w, h);
    }

    ctx.restore();
}

// УПРАВЛЕНИЕ МЫШЬЮ
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomAmount = 0.1; const oldZoom = camera.zoom;
    camera.zoom = e.deltaY > 0 ? Math.max(0.5, camera.zoom - zoomAmount) : Math.min(6, camera.zoom + zoomAmount);
    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
    camera.x = mouseX - (mouseX - camera.x) * (camera.zoom / oldZoom); camera.y = mouseY - (mouseY - camera.y) * (camera.zoom / oldZoom);
});

function getWorldCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const canvasMouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const canvasMouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
    
    let wx = (canvasMouseX - camera.x) / camera.zoom;
    let wy = (canvasMouseY - camera.y) / camera.zoom;

    // ИСПРАВЛЕНИЕ: Клик никогда не выйдет за границы 1920x1080
    return { 
        x: Math.max(2, Math.min(WORLD_WIDTH - 2, wx)), 
        y: Math.max(2, Math.min(WORLD_HEIGHT - 2, wy)) 
    };
}

canvas.addEventListener('mousedown', (e) => { 
    const world = getWorldCoords(e);
    if (e.button === 1) { isPanning = true; lastMouse = {x: e.clientX, y: e.clientY}; return; }

    if (e.button === 0) {
        if (!isSpawned) { socket.emit('spawnCapital', { x: Math.floor(world.x/TILE_SIZE), y: Math.floor(world.y/TILE_SIZE) }); return; }
        
        // НАЧАЛО ЛАССО
        if (isDrawingRegion) { lassoPoints = [world]; return; }

        isSelecting = true; selectionBox.startX = world.x; selectionBox.startY = world.y; selectionBox.endX = world.x; selectionBox.endY = world.y;
    }
    
    if (e.button === 2 && selectedArmies.length > 0 && !isDrawingRegion) { socket.emit('moveArmies', { armyIds: selectedArmies, targetX: world.x, targetY: world.y }); }
});

canvas.addEventListener('mousemove', (e) => { 
    if (isPanning) { camera.x += (e.clientX - lastMouse.x); camera.y += (e.clientY - lastMouse.y); lastMouse = {x: e.clientX, y: e.clientY}; return; }
    const world = getWorldCoords(e);
    if (isSelecting) { selectionBox.endX = world.x; selectionBox.endY = world.y;
    } else if (isDrawingRegion && e.buttons === 1) { 
        // ДОБАВЛЯЕМ ТОЧКИ В ЛАССО
        lassoPoints.push(world); 
    }
});

canvas.addEventListener('mouseup', (e) => { 
    if (e.button === 1) isPanning = false;
    
    // КОНЕЦ ЛАССО: Вычисляем что попало внутрь и отправляем на сервер
    if (isDrawingRegion && lassoPoints.length > 2) {
        let minX = WORLD_WIDTH, maxX = 0, minY = WORLD_HEIGHT, maxY = 0;
        let poly = [];
        lassoPoints.forEach(p => { 
            poly.push([p.x, p.y]);
            if(p.x < minX) minX = p.x; if(p.x > maxX) maxX = p.x;
            if(p.y < minY) minY = p.y; if(p.y > maxY) maxY = p.y; 
        });

        let tilesInside = [];
        let startCol = Math.max(0, Math.floor(minX / TILE_SIZE)); let endCol = Math.min(WORLD_WIDTH/TILE_SIZE, Math.ceil(maxX / TILE_SIZE));
        let startRow = Math.max(0, Math.floor(minY / TILE_SIZE)); let endRow = Math.min(WORLD_HEIGHT/TILE_SIZE, Math.ceil(maxY / TILE_SIZE));

        for(let c = startCol; c <= endCol; c++) {
            for(let r = startRow; r <= endRow; r++) {
                let px = c * TILE_SIZE + TILE_SIZE/2; let py = r * TILE_SIZE + TILE_SIZE/2;
                if (pointInPolygon([px, py], poly)) { tilesInside.push(`${c}_${r}`); }
            }
        }
        socket.emit('lassoRegion', { tiles: tilesInside, newRegionId: currentDrawingRegionId });
        isDrawingRegion = false; lassoPoints = []; document.getElementById('drawRegionBtn').innerText = "Новый регион (Обвести)"; showMsg("Регион сформирован!");
        return;
    }

    if (e.button === 0 && isSelecting) {
        isSelecting = false; const world = getWorldCoords(e); selectionBox.endX = world.x; selectionBox.endY = world.y;
        
        const minX = Math.min(selectionBox.startX, selectionBox.endX); const maxX = Math.max(selectionBox.startX, selectionBox.endX);
        const minY = Math.min(selectionBox.startY, selectionBox.endY); const maxY = Math.max(selectionBox.startY, selectionBox.endY);
        const isClick = (maxX - minX < 5 && maxY - minY < 5);
        selectedArmies = [];

        const hitRadius = (8 / camera.zoom) + 2; 

        for (const id in visualArmies) {
            const a = visualArmies[id];
            if (a.owner === myId) {
                if (isClick && Math.hypot(a.x - world.x, a.y - world.y) <= hitRadius) { selectedArmies.push(id); } 
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
    
    const defLevel = reg.defLevel || 0;
    document.getElementById('regDefLevel').innerText = defLevel;
    document.getElementById('regDefDmg').innerText = (defLevel * 50).toLocaleString(); 

    const btnEcon = document.getElementById('upgradeBtn');
    const btnDef = document.getElementById('upgradeDefBtn');
    
    if (reg.owner === myId) {
        btnEcon.style.display = 'block'; btnDef.style.display = 'block';
        
        // Кнопка Экономики
        const upgradeCost = reg.cells * reg.level * 50;
        if (reg.level >= 10) { btnEcon.innerText = "ВВП Макс"; btnEcon.disabled = true; btnEcon.style.background = '#7f8c8d'; } 
        else {
            btnEcon.innerText = `Улучшить ВВП (${upgradeCost.toLocaleString()} $)`;
            btnEcon.disabled = countries[myId].dollars < upgradeCost;
            btnEcon.style.background = btnEcon.disabled ? '#7f8c8d' : '#27ae60';
        }

        // Кнопка Обороны
        const defCostDol = reg.cells * (defLevel + 1) * 20;
        const defCostMil = reg.cells * (defLevel + 1) * 10;
        if (defLevel >= 10) { btnDef.innerText = "Защита Макс"; btnDef.disabled = true; btnDef.style.background = '#7f8c8d'; }
        else {
            btnDef.innerText = `Улучшить Защиту (${defCostDol.toLocaleString()} $, ${defCostMil.toLocaleString()} ⚔️)`;
            btnDef.disabled = (countries[myId].dollars < defCostDol || countries[myId].military < defCostMil);
            btnDef.style.background = btnDef.disabled ? '#7f8c8d' : '#c0392b';
        }
    } else { btnEcon.style.display = 'none'; btnDef.style.display = 'none'; }
}
