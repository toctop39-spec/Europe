const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const WORLD_WIDTH = 1920; const WORLD_HEIGHT = 1080;
// --- СИНХРОНИЗАЦИЯ: МЕЛКАЯ КЛЕТКА ---
const TILE_SIZE = 5; 
const KM_PER_TILE = TILE_SIZE * TILE_SIZE * 111.32 * 111.32; // км² (приблизительно)

canvas.width = WORLD_WIDTH; canvas.height = WORLD_HEIGHT;

let territory = {}; let players = {}; let armies = {}; let regions = {};
let myId = null; let isPlaying = false; let isSpawned = false;

let camera = { x: 0, y: 0, zoom: 1 };
let isPanning = false; let lastMouse = {x: 0, y: 0};

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

// Кнопка развертывания
document.getElementById('deployBtn').addEventListener('click', () => {
    const amount = document.getElementById('deployAmount').value;
    if (clickedRegionId) {
        socket.emit('deployArmy', { regionId: clickedRegionId, amount: amount });
        showMsg(`Приказ на развертывание ${amount} солдат отдан!`);
    }
});

// Кнопка роспуска
document.getElementById('disbandBtn').addEventListener('click', () => {
    if (selectedArmies.length > 0) {
        socket.emit('disbandArmies', selectedArmies);
        showMsg("Дивизии распущены.");
        selectedArmies = []; // Сброс выделения
        drawMap();
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
        // Умножаем на наш реалистичный масштаб (ТЕРРИТОРИЯ)
        document.getElementById('myArea').innerText = Math.floor(players[myId].cells * KM_PER_TILE / 1000).toLocaleString(); // км² * 10^3
        document.getElementById('myDollars').innerText = Math.floor(players[myId].dollars).toLocaleString();
        document.getElementById('myIncome').innerText = (players[myId].lastIncome >= 0 ? "+" : "") + Math.floor(players[myId].lastIncome);
        document.getElementById('myIncome').style.color = players[myId].lastIncome >= 0 ? '#27ae60' : '#c0392b';
        document.getElementById('myMilitary').innerText = Math.floor(players[myId].military).toLocaleString();
        document.getElementById('myCap').innerText = players[myId].cap.toLocaleString();
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

// --- ОТРИСОВКА (С КАМЕРОЙ) ---
function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.translate(camera.x, camera.y); ctx.scale(camera.zoom, camera.zoom);

    if (bgMap.complete) ctx.drawImage(bgMap, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // 1. Заливка территорий
    ctx.globalAlpha = 0.55; 
    for (const key in territory) {
        const owner = players[territory[key].owner];
        if (owner) {
            const [x, y] = key.split('_').map(Number);
            ctx.fillStyle = owner.color;
            ctx.fillRect(x * TILE_SIZE - 0.5, y * TILE_SIZE - 0.5, TILE_SIZE + 1, TILE_SIZE + 1);
        }
    }
    ctx.globalAlpha = 1.0; 

    // 2. Линии границ (ЖЕСТКИЕ, ТОНКИЕ)
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(10, 10, 10, 0.9)'; ctx.setLineDash([]);
    for (const key in territory) {
        const cell = territory[key];
        const [x, y] = key.split('_').map(Number);
        const px = x * TILE_SIZE; const py = y * TILE_SIZE;
        
        const drawEdge = (nx, ny, x1, y1, x2, y2) => {
            const nCell = territory[`${nx}_${ny}`];
            if (!nCell || nCell.owner !== cell.owner) {
                ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
            }
        };
        drawEdge(x, y-1, px, py, px+TILE_SIZE, py);
        drawEdge(x, y+1, px, py+TILE_SIZE, px+TILE_SIZE, py+TILE_SIZE);
        drawEdge(x-1, y, px, py, px, py+TILE_SIZE);
        drawEdge(x+1, y, px+TILE_SIZE, py, px+TILE_SIZE, py+TILE_SIZE);
    }

    // 3. Названия регионов
    const regCenters = getRegionCenters();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
    for (const rId in regCenters) {
        const c = regCenters[rId];
        if (c.count > 0) {
            const tx = (c.sumX/c.count)*TILE_SIZE + (TILE_SIZE/2);
            const ty = (c.sumY/c.count)*TILE_SIZE + (TILE_SIZE/2);
            ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2;
            ctx.strokeText(c.name, tx, ty); ctx.fillText(c.name, tx, ty);
        }
    }

    // 4. --- ФИНАЛЬНОЕ УМЕНЬШЕНИЕ: АРМИИ УМЕНЬШЕНЫ В 3 РАЗА (РАДИУС 4) ---
    // И СТЕКИРОВАНИЕ В СТОПКИ
    ctx.lineWidth = 1; ctx.strokeStyle = '#fff';

    // Создаем стеки по координатам плитки (например 40x40px)
    let stacks = {}; 
    const stackGridSize = 35; // Размер плитки для стекирования
    for(const id in armies) {
        const army = armies[id];
        const gridKey = `${Math.floor(army.x / stackGridSize)}_${Math.floor(army.y / stackGridSize)}`;
        if(!stacks[gridKey]) stacks[gridKey] = { owner: army.owner, count: 0, flag: players[army.owner]?.flag || '🏳️', armies: [], inCombat: false };
        stacks[gridKey].count += army.count;
        stacks[gridKey].armies.push(id);
        if(army.inCombat) stacks[gridKey].inCombat = true; // Стек в бою
    }

    // Отрисовываем стеки
    for(const key in stacks) {
        const stack = stacks[key];
        const owner = players[stack.owner];
        const [gx, gy] = key.split('_').map(Number);
        const armyX = gx * stackGridSize + stackGridSize/2;
        const armyY = gy * stackGridSize + stackGridSize/2;

        // Определяем, выделен ли стек (если хотя бы 1 армия внутри выделена)
        let stackSelected = stack.armies.some(aId => selectedArmies.includes(aId));

        if (stackSelected) {
            ctx.beginPath(); ctx.arc(armyX, armyY, 12, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(46, 204, 113, 0.5)'; ctx.fill();
        }

        // --- ВИЗУАЛИЗАЦИЯ СТЕКА (КАК В image_6.png) ---
        // Рисуем стопку флагов (например, до 3-х)
        const stackSize = Math.min(3, Math.ceil(stack.count / 1000)); // 1 флаг за 1000 солдат
        
        for(let i = 0; i < stackSize; i++) {
            const offsetX = i * 4;
            const offsetY = i * 4;

            ctx.beginPath(); ctx.arc(armyX + offsetX, armyY - offsetY, 7, 0, Math.PI * 2); // Было 14, стало 7 (Уменьшили в 2 раза)
            ctx.fillStyle = owner.color; ctx.fill();
            if(stack.inCombat) { // Красная аура в бою
                ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(192, 57, 43, 0.8)';
            } else {
                ctx.lineWidth = 1; ctx.strokeStyle = '#222';
            }
            ctx.stroke();

            ctx.fillStyle = 'white'; ctx.font = '8px Arial'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
            ctx.fillText(stack.flag, armyX + offsetX, armyY - offsetY);
        }

        // Цифра общей численности под значком
        ctx.fillStyle = 'white'; ctx.font = 'bold 10px Arial'; ctx.strokeStyle = 'black'; ctx.lineWidth = 2.5;
        const countText = Math.floor(stack.count).toString();
        ctx.strokeText(countText, armyX, armyY + 14);
        ctx.fillText(countText, armyX, armyY + 14);
    }

    // 5. Рамка выделения мыши
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

// --- УПРАВЛЕНИЕ КАМЕРОЙ И МУЛЬТИВЫДЕЛЕНИЕМ ---
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

        // Пытаемся выделить армию кликом (проверяем, кликнули ли мы по значку)
        for (const id in armies) {
            const army = armies[id];
            if (army.owner === myId) {
                const dist = Math.sqrt(Math.pow(army.x - world.x, 2) + Math.pow(army.y - world.y, 2));
                if (dist <= 15) { // Радиус клика
                    selectedArmies = [id]; // Сброс старого выделения, оставляем 1
                    document.getElementById('disbandBtn').style.display = 'block';
                    drawMap();
                    return; 
                }
            }
        }

        // Если не кликнули по армии, начинаем выделение рамкой
        isSelecting = true;
        selectionBox.startX = world.x; selectionBox.startY = world.y;
        selectionBox.endX = world.x; selectionBox.endY = world.y;
    }
    
    // ПРАВЫЙ КЛИК (Движение группы)
    else if (e.button === 2 && selectedArmies.length > 0 && !isDrawingRegion) {
        socket.emit('moveArmies', { armyIds: selectedArmies, targetX: world.x, targetY: world.y });
    }
});

canvas.addEventListener('mousemove', (e) => { 
    if (isPanning) {
        camera.x += (e.clientX - lastMouse.x);
        camera.y += (e.clientY - lastMouse.y);
        lastMouse = {x: e.clientX, y: e.clientY};
        drawMap();
        return;
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
        
        // Нормализуем координаты рамки
        const minX = Math.min(selectionBox.startX, selectionBox.endX);
        const maxX = Math.max(selectionBox.startX, selectionBox.endX);
        const minY = Math.min(selectionBox.startY, selectionBox.endY);
        const maxY = Math.max(selectionBox.startY, selectionBox.endY);

        // Проверяем, кто попал в рамку
        selectedArmies = []; // Сброс старого выделения
        for (const id in armies) {
            const a = armies[id];
            if (a.owner === myId) {
                if (a.x >= minX && a.x <= maxX && a.y >= minY && a.y <= maxY) {
                    selectedArmies.push(id);
                }
            }
        }

        // Показываем кнопку роспуска только если выделили кого-то
        document.getElementById('disbandBtn').style.display = selectedArmies.length > 0 ? 'block' : 'none';

        // Клик ЛКМ по территории (открытие региона)
        if (selectedArmies.length === 0 && Math.abs(selectionBox.startX - selectionBox.endX) < 5 && Math.abs(selectionBox.startY - selectionBox.endY) < 5) {
            const cellKey = `${Math.floor(worldCoords.x/TILE_SIZE)}_${Math.floor(worldCoords.y/TILE_SIZE)}`;
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
    const ownerName = players[reg.owner] ? players[reg.owner].name : "Неизвестно";
    
    document.getElementById('regionPanel').style.display = 'block';
    document.getElementById('regName').innerText = reg.name;
    document.getElementById('regOwner').innerText = ownerName;
    document.getElementById('regIncome').innerText = (reg.cells * 1.5).toLocaleString(); // ВВП региона (зависит от мелких клеток)
}
