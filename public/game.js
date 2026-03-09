const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const WORLD_WIDTH = 1920; const WORLD_HEIGHT = 1080;
const TILE_SIZE = 15; const KM_PER_TILE = 25000; 

canvas.width = WORLD_WIDTH; canvas.height = WORLD_HEIGHT;

let territory = {}; let players = {}; let armies = {}; let regions = {};
let myId = null; let isPlaying = false; let isSpawned = false;

let camera = { x: 0, y: 0, zoom: 1 };
let isPanning = false; let lastMouse = { x: 0, y: 0 };

// Multi-select переменные
let selectedArmies = []; // Теперь массив!
let isSelecting = false;
let selectionBox = { startX: 0, startY: 0, endX: 0, endY: 0 };

let isDrawingRegion = false; let currentDrawingRegionId = null; let clickedRegionId = null;

const sysMsg = document.getElementById('systemMsg');
function showMsg(text) { sysMsg.innerText = text; setTimeout(() => sysMsg.innerText = "Ожидание приказа...", 3000); }

const bgMap = new Image(); bgMap.src = 'Map.png'; bgMap.onload = () => drawMap();

document.getElementById('joinBtn').addEventListener('click', () => {
    const name = document.getElementById('countryName').value || 'Империя';
    const flag = document.getElementById('countryFlag').value || '🏳️';
    const color = document.getElementById('countryColor').value;
    socket.emit('joinGame', { name, color, flag });
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('topBar').style.display = 'flex';
    document.getElementById('controlPanel').style.display = 'block';
    document.getElementById('myName').innerText = name; document.getElementById('myFlagUI').innerText = flag;
    isPlaying = true;
});

// Кнопка развертывания войск
document.getElementById('deployBtn').addEventListener('click', () => {
    const amount = document.getElementById('deployAmount').value;
    if (clickedRegionId) {
        socket.emit('deployArmy', { regionId: clickedRegionId, amount: amount });
        showMsg(`Приказ на развертывание ${amount} солдат отдан!`);
    }
});

document.getElementById('drawRegionBtn').addEventListener('click', () => {
    isDrawingRegion = !isDrawingRegion;
    document.getElementById('drawRegionBtn').innerText = isDrawingRegion ? "Сохранить регион" : "Выделить новый регион";
    if (isDrawingRegion) currentDrawingRegionId = `reg_${myId}_${Math.random().toString(36).substr(2, 5)}`;
});
document.getElementById('closeRegBtn').addEventListener('click', () => document.getElementById('regionPanel').style.display = 'none');

socket.on('connect', () => { myId = socket.id; });
socket.on('initData', (data) => { players = data.players; territory = data.territory; armies = data.armies; regions = data.regions; drawMap(); });
socket.on('updateMap', (data) => { players = data.players; territory = data.territory; regions = data.regions; if (players[myId] && players[myId].isSpawned) isSpawned = true; updateUI(); drawMap(); });
socket.on('syncTerritory', (data) => { territory = data.territory; regions = data.regions; drawMap(); updateRegionPanel(); });
socket.on('updateResources', (p) => { players = p; updateUI(); });
socket.on('syncArmies', (a) => { armies = a; drawMap(); });

function updateUI() {
    if (players[myId]) {
        document.getElementById('myArea').innerText = (players[myId].cells * KM_PER_TILE).toLocaleString();
        document.getElementById('myDollars').innerText = Math.floor(players[myId].dollars).toLocaleString();
        document.getElementById('myIncome').innerText = (players[myId].lastIncome >= 0 ? "+" : "") + Math.floor(players[myId].lastIncome);
        document.getElementById('myIncome').style.color = players[myId].lastIncome >= 0 ? '#27ae60' : '#c0392b';
        document.getElementById('myMilitary').innerText = Math.floor(players[myId].military).toLocaleString();
        document.getElementById('myCap').innerText = players[myId].cap.toLocaleString();
    }
}

// Вспомогательная: Расчет центров всех регионов для текста
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

    // 1. Рисуем заливку суши
    ctx.globalAlpha = 0.5; 
    for (const key in territory) {
        const owner = players[territory[key].owner];
        if (owner) {
            const [x, y] = key.split('_').map(Number);
            ctx.fillStyle = owner.color;
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
    }
    ctx.globalAlpha = 1.0; 

    // 2. Рисуем ЖЕСТКИЕ ГРАНИЦЫ (Линии)
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'black';
    for (const key in territory) {
        const cell = territory[key];
        const [x, y] = key.split('_').map(Number);
        const px = x * TILE_SIZE; const py = y * TILE_SIZE;
        
        // Функция проверки соседа
        const drawEdge = (nx, ny, x1, y1, x2, y2) => {
            const nKey = `${nx}_${ny}`;
            const nCell = territory[nKey];
            // Если соседа нет (вода) или он чужой - рисуем черную линию
            if (!nCell || nCell.owner !== cell.owner) {
                ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
            }
        };
        drawEdge(x, y-1, px, py, px+TILE_SIZE, py); // Верх
        drawEdge(x, y+1, px, py+TILE_SIZE, px+TILE_SIZE, py+TILE_SIZE); // Низ
        drawEdge(x-1, y, px, py, px, py+TILE_SIZE); // Лево
        drawEdge(x+1, y, px+TILE_SIZE, py, px+TILE_SIZE, py+TILE_SIZE); // Право
    }

    // 3. Названия регионов
    const regCenters = getRegionCenters();
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center';
    for (const rId in regCenters) {
        const c = regCenters[rId];
        if (c.count > 0) {
            ctx.fillText(c.name, (c.sumX/c.count)*TILE_SIZE, (c.sumY/c.count)*TILE_SIZE);
        }
    }

    // 4. Армии
    for (const id in armies) {
        const army = armies[id];
        const owner = players[army.owner];
        if (!owner) continue;

        if (selectedArmies.includes(id)) {
            ctx.beginPath(); ctx.arc(army.x, army.y, 12, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(46, 204, 113, 0.5)'; ctx.fill();
            if (army.targetX !== null) {
                ctx.beginPath(); ctx.moveTo(army.x, army.y); ctx.lineTo(army.targetX, army.targetY);
                ctx.strokeStyle = 'rgba(46, 204, 113, 0.5)'; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
            }
        }

        ctx.beginPath(); ctx.arc(army.x, army.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = owner.color; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
        
        ctx.fillStyle = 'white'; ctx.font = '10px Arial'; ctx.textBaseline = 'middle';
        ctx.fillText(owner.flag, army.x, army.y);
        
        // Цифра количества войск под значком
        ctx.fillStyle = 'white'; ctx.font = 'bold 10px Arial'; ctx.strokeStyle = 'black'; ctx.lineWidth = 2;
        const countText = Math.floor(army.count).toString();
        ctx.strokeText(countText, army.x, army.y + 14);
        ctx.fillText(countText, army.x, army.y + 14);
    }

    // 5. Рамка выделения
    if (isSelecting) {
        ctx.fillStyle = 'rgba(46, 204, 113, 0.2)';
        ctx.strokeStyle = '#2ecc71';
        ctx.lineWidth = 1;
        const w = selectionBox.endX - selectionBox.startX;
        const h = selectionBox.endY - selectionBox.startY;
        ctx.fillRect(selectionBox.startX, selectionBox.startY, w, h);
        ctx.strokeRect(selectionBox.startX, selectionBox.startY, w, h);
    }

    ctx.restore();
}

// --- УПРАВЛЕНИЕ КАМЕРОЙ И ВЫДЕЛЕНИЕМ ---
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomAmount = 0.1; const oldZoom = camera.zoom;
    camera.zoom = e.deltaY > 0 ? Math.max(0.5, camera.zoom - zoomAmount) : Math.min(4, camera.zoom + zoomAmount);
    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
    camera.x = mouseX - (mouseX - camera.x) * (camera.zoom / oldZoom);
    camera.y = mouseY - (mouseY - camera.y) * (camera.zoom / oldZoom);
    drawMap();
});

function getWorldCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const canvasMouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const canvasMouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
    return {
        x: (canvasMouseX - camera.x) / camera.zoom,
        y: (canvasMouseY - camera.y) / camera.zoom
    };
}

canvas.addEventListener('mousedown', (e) => { 
    const world = getWorldCoords(e);

    if (e.button === 1) { isPanning = true; lastMouse = {x: e.clientX, y: e.clientY}; return; }

    if (e.button === 0) {
        if (!isSpawned) {
            socket.emit('spawnCapital', { x: Math.floor(world.x/TILE_SIZE), y: Math.floor(world.y/TILE_SIZE) });
            return;
        }
        
        if (isDrawingRegion) return;

        // Начинаем выделение рамкой
        isSelecting = true;
        selectionBox.startX = world.x; selectionBox.startY = world.y;
        selectionBox.endX = world.x; selectionBox.endY = world.y;
    }
    
    if (e.button === 2 && selectedArmies.length > 0 && !isDrawingRegion) {
        socket.emit('moveArmies', { armyIds: selectedArmies, targetX: world.x, targetY: world.y });
    }
});

canvas.addEventListener('mousemove', (e) => { 
    if (isPanning) {
        camera.x += (e.clientX - lastMouse.x); camera.y += (e.clientY - lastMouse.y);
        lastMouse = {x: e.clientX, y: e.clientY};
        drawMap(); return;
    }
    
    const world = getWorldCoords(e);
    
    if (isSelecting) {
        selectionBox.endX = world.x; selectionBox.endY = world.y;
        drawMap();
    } else if (isDrawingRegion && e.buttons === 1) {
        socket.emit('paintRegion', { x: Math.floor(world.x/TILE_SIZE), y: Math.floor(world.y/TILE_SIZE), newRegionId: currentDrawingRegionId });
    }
});

canvas.addEventListener('mouseup', (e) => { 
    if (e.button === 1) isPanning = false;
    
    if (e.button === 0 && isSelecting) {
        isSelecting = false;
        selectedArmies = []; // Сброс старого выделения
        
        // Нормализуем координаты рамки
        const minX = Math.min(selectionBox.startX, selectionBox.endX);
        const maxX = Math.max(selectionBox.startX, selectionBox.endX);
        const minY = Math.min(selectionBox.startY, selectionBox.endY);
        const maxY = Math.max(selectionBox.startY, selectionBox.endY);

        // Проверяем, кто попал в рамку (или если рамка маленькая - это был просто клик)
        const isClick = (maxX - minX < 5 && maxY - minY < 5);

        for (const id in armies) {
            const a = armies[id];
            if (a.owner === myId) {
                if (isClick && Math.hypot(a.x - minX, a.y - minY) <= 12) {
                    selectedArmies.push(id); break; // Выделили одну по клику
                } else if (!isClick && a.x >= minX && a.x <= maxX && a.y >= minY && a.y <= maxY) {
                    selectedArmies.push(id); // Выделили рамкой
                }
            }
        }

        // Если никого не выделили, открываем панель региона
        if (selectedArmies.length === 0 && isClick) {
            const cellKey = `${Math.floor(minX/TILE_SIZE)}_${Math.floor(minY/TILE_SIZE)}`;
            if (territory[cellKey]) {
                clickedRegionId = territory[cellKey].regionId;
                updateRegionPanel();
            } else {
                document.getElementById('regionPanel').style.display = 'none';
                clickedRegionId = null;
            }
        }
        drawMap();
    }
});

function updateRegionPanel() {
    if (!clickedRegionId || !regions[clickedRegionId]) return;
    const reg = regions[clickedRegionId];
    document.getElementById('regionPanel').style.display = 'block';
    document.getElementById('regName').innerText = reg.name;
    document.getElementById('regOwner').innerText = players[reg.owner] ? players[reg.owner].name : "Неизвестно";
    document.getElementById('regIncome').innerText = (reg.cells * 15).toLocaleString(); 
}
