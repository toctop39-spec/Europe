const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const WORLD_WIDTH = 1920; 
const WORLD_HEIGHT = 1080;
const TILE_SIZE = 15; 
const KM_PER_TILE = 25000; 

canvas.width = WORLD_WIDTH;
canvas.height = WORLD_HEIGHT;

let territory = {}; let players = {}; let capitals = {}; let armies = {}; let regions = {};
let myId = null; let isPlaying = false; let isSpawned = false;

// --- КАМЕРА И ЗУМ ---
let camera = { x: 0, y: 0, zoom: 1 };
let isPanning = false; // Для перетаскивания карты
let lastMouse = { x: 0, y: 0 };

let selectedArmyId = null; 
let isDrawingRegion = false;
let currentDrawingRegionId = null;

const sysMsg = document.getElementById('systemMsg');
function showMsg(text) { sysMsg.innerText = text; setTimeout(() => sysMsg.innerText = "Ожидание приказа...", 3000); }

const bgMap = new Image();
bgMap.src = 'Map.png';
bgMap.onload = () => drawMap();

// Вход в игру
document.getElementById('joinBtn').addEventListener('click', () => {
    const name = document.getElementById('countryName').value || 'Империя';
    const flag = document.getElementById('countryFlag').value || '🏳️';
    const color = document.getElementById('countryColor').value;
    socket.emit('joinGame', { name, color, flag });
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('topBar').style.display = 'flex';
    document.getElementById('controlPanel').style.display = 'block';
    document.getElementById('myName').innerText = name;
    document.getElementById('myName').style.color = color;
    document.getElementById('myFlagUI').innerText = flag;
    isPlaying = true;
    showMsg("Колесико — зум. Колесико (зажать) — двигать карту.");
});

// Кнопки
document.getElementById('mobilizeBtn').addEventListener('click', () => {
    if (players[myId] && players[myId].military >= 1000) {
        socket.emit('mobilize');
        showMsg("Дивизия мобилизована в столице!");
    } else { showMsg("❌ Недостаточно Военной силы!"); }
});

document.getElementById('drawRegionBtn').addEventListener('click', () => {
    if (!isDrawingRegion) {
        isDrawingRegion = true;
        currentDrawingRegionId = `reg_${myId}_${Math.random().toString(36).substr(2, 5)}`;
        document.getElementById('drawRegionBtn').style.background = '#e67e22'; 
        document.getElementById('drawRegionBtn').innerText = "Сохранить регион";
        showMsg("Зажмите ЛКМ на своей территории, чтобы нарисовать регион");
    } else {
        isDrawingRegion = false;
        document.getElementById('drawRegionBtn').style.background = '#2980b9';
        document.getElementById('drawRegionBtn').innerText = "Выделить новый регион";
        showMsg("Регион сохранен");
    }
});

document.getElementById('closeRegBtn').addEventListener('click', () => {
    document.getElementById('regionPanel').style.display = 'none';
});

// Сеть
socket.on('connect', () => { myId = socket.id; });
socket.on('initData', (data) => { players = data.players; territory = data.territory; capitals = data.capitals; armies = data.armies; regions = data.regions; drawMap(); });
socket.on('updateMap', (data) => { players = data.players; territory = data.territory; capitals = data.capitals; regions = data.regions; if (players[myId] && players[myId].isSpawned) isSpawned = true; updateUI(); drawMap(); });
socket.on('syncTerritory', (data) => { territory = data.territory; regions = data.regions; drawMap(); updateRegionPanel(); });
socket.on('updateResources', (p) => { players = p; updateUI(); });
socket.on('syncArmies', (a) => { armies = a; drawMap(); });

function updateUI() {
    if (players[myId]) {
        document.getElementById('myArea').innerText = (players[myId].cells * KM_PER_TILE).toLocaleString();
        document.getElementById('myDollars').innerText = players[myId].dollars.toLocaleString();
        document.getElementById('myMilitary').innerText = players[myId].military.toLocaleString();
        document.getElementById('myCap').innerText = players[myId].cap.toLocaleString();
    }
}

// --- ОТРИСОВКА (С УЧЕТОМ КАМЕРЫ) ---
function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Применяем зум и смещение камеры
    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    if (bgMap.complete) ctx.drawImage(bgMap, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    ctx.globalAlpha = 0.6; 
    for (const key in territory) {
        const cell = territory[key];
        const owner = players[cell.owner];
        if (owner) {
            const [x, y] = key.split('_').map(Number);
            ctx.fillStyle = owner.color;
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            if (isDrawingRegion && cell.regionId === currentDrawingRegionId) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            }
        }
    }
    ctx.globalAlpha = 1.0; 

    // Столицы
    for (const id in capitals) {
        const owner = players[id];
        const cap = capitals[id];
        if (owner && cap) {
            const px = cap.x * TILE_SIZE + (TILE_SIZE / 2);
            const py = cap.y * TILE_SIZE + (TILE_SIZE / 2);
            ctx.fillStyle = 'white'; ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center';
            ctx.strokeStyle = 'black'; ctx.lineWidth = 3;
            ctx.strokeText(`${owner.flag} ${owner.name}`, px, py - 15);
            ctx.fillText(`${owner.flag} ${owner.name}`, px, py - 15);
        }
    }

    // Армии (УМЕНЬШЕНЫ)
    for (const id in armies) {
        const army = armies[id];
        const owner = players[army.owner];
        if (!owner) continue;

        if (id === selectedArmyId) {
            ctx.beginPath(); ctx.arc(army.x, army.y, 10, 0, Math.PI * 2); // Аура была 18, стала 10
            ctx.fillStyle = 'rgba(46, 204, 113, 0.6)'; ctx.fill();
            if (army.targetX !== null) {
                ctx.beginPath(); ctx.moveTo(army.x, army.y); ctx.lineTo(army.targetX, army.targetY);
                ctx.strokeStyle = 'rgba(46, 204, 113, 0.8)'; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
            }
        }

        ctx.beginPath(); ctx.arc(army.x, army.y, 6, 0, Math.PI * 2); // Сама армия была 14, стала 6
        ctx.fillStyle = owner.color; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.fillStyle = 'white'; ctx.font = '8px Arial'; ctx.textBaseline = 'middle';
        ctx.fillText(owner.flag, army.x, army.y); // Флаг меньше
    }
    
    ctx.restore(); // Сбрасываем трансформацию для следующего кадра
}

// --- УПРАВЛЕНИЕ КАМЕРОЙ И МЫШЬЮ ---
let isMouseDragging = false;
let clickedRegionId = null;

// Зум колесиком
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomAmount = 0.1;
    const oldZoom = camera.zoom;
    
    if (e.deltaY > 0) camera.zoom = Math.max(0.5, camera.zoom - zoomAmount); // Отдаление
    else camera.zoom = Math.min(4, camera.zoom + zoomAmount); // Приближение

    // Зум в точку курсора
    const rect = canvas.getBoundingClientRect();
    const cssScaleX = canvas.width / rect.width;
    const cssScaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * cssScaleX;
    const mouseY = (e.clientY - rect.top) * cssScaleY;

    camera.x = mouseX - (mouseX - camera.x) * (camera.zoom / oldZoom);
    camera.y = mouseY - (mouseY - camera.y) * (camera.zoom / oldZoom);
    drawMap();
});

canvas.addEventListener('mousedown', (e) => { 
    const rect = canvas.getBoundingClientRect();
    const cssScaleX = canvas.width / rect.width;
    const cssScaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * cssScaleX;
    const mouseY = (e.clientY - rect.top) * cssScaleY;

    // СРЕДНЯЯ КНОПКА (КОЛЕСИКО) - Перетаскивание карты
    if (e.button === 1) {
        isPanning = true;
        lastMouse = { x: mouseX, y: mouseY };
        return;
    }

    isMouseDragging = true; 
    handleMouseAction(e, mouseX, mouseY); 
});

canvas.addEventListener('mouseup', (e) => { 
    if (e.button === 1) isPanning = false;
    isMouseDragging = false; 
});

canvas.addEventListener('mousemove', (e) => { 
    const rect = canvas.getBoundingClientRect();
    const cssScaleX = canvas.width / rect.width;
    const cssScaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * cssScaleX;
    const mouseY = (e.clientY - rect.top) * cssScaleY;

    if (isPanning) {
        camera.x += (mouseX - lastMouse.x);
        camera.y += (mouseY - lastMouse.y);
        lastMouse = { x: mouseX, y: mouseY };
        drawMap();
        return;
    }

    if (isMouseDragging && isDrawingRegion) handleMouseAction(e, mouseX, mouseY); 
});

function handleMouseAction(event, canvasMouseX, canvasMouseY) {
    if (!isPlaying) return;

    // Переводим координаты экрана в координаты МИРА (с учетом зума и камеры)
    const worldX = (canvasMouseX - camera.x) / camera.zoom;
    const worldY = (canvasMouseY - camera.y) / camera.zoom;
    
    const gridX = Math.floor(worldX / TILE_SIZE);
    const gridY = Math.floor(worldY / TILE_SIZE);
    const cellKey = `${gridX}_${gridY}`;

    // ЛЕВЫЙ КЛИК
    if (event.button === 0) {
        if (!isSpawned) {
            socket.emit('spawnCapital', { x: gridX, y: gridY });
            return;
        }

        if (isDrawingRegion) {
            socket.emit('paintRegion', { x: gridX, y: gridY, newRegionId: currentDrawingRegionId });
            return;
        }

        selectedArmyId = null;
        for (const id in armies) {
            const a = armies[id];
            if (a.owner === myId && Math.hypot(a.x - worldX, a.y - worldY) <= 12) { // Радиус клика уменьшен
                selectedArmyId = id;
                showMsg("Армия выбрана. ПКМ для движения.");
                drawMap();
                return; 
            }
        }

        const cell = territory[cellKey];
        if (cell) {
            clickedRegionId = cell.regionId;
            updateRegionPanel();
        } else {
            document.getElementById('regionPanel').style.display = 'none';
        }
        drawMap();
    }
    
    // ПРАВЫЙ КЛИК
    else if (event.button === 2 && selectedArmyId && !isDrawingRegion) {
        socket.emit('moveArmy', { armyId: selectedArmyId, targetX: worldX, targetY: worldY });
        showMsg("Приказ на марш отдан!");
    }
}

function updateRegionPanel() {
    if (!clickedRegionId || !regions[clickedRegionId]) return;
    const reg = regions[clickedRegionId];
    const ownerName = players[reg.owner] ? players[reg.owner].name : "Неизвестно";
    
    document.getElementById('regionPanel').style.display = 'block';
    document.getElementById('regName').innerText = reg.name;
    document.getElementById('regOwner').innerText = ownerName;
    document.getElementById('regArea').innerText = (reg.cells * KM_PER_TILE).toLocaleString();
    document.getElementById('regIncome').innerText = (reg.cells * 15).toLocaleString(); 
}
