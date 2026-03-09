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

// Состояния интерфейса
let selectedArmyId = null; 
let isDrawingRegion = false;
let currentDrawingRegionId = null;

const sysMsg = document.getElementById('systemMsg');
function showMsg(text) { sysMsg.innerText = text; setTimeout(() => sysMsg.innerText = "Ожидание приказа...", 3000); }

const bgMap = new Image();
bgMap.src = 'Map.png';
bgMap.onload = () => drawMap();

// --- ВХОД В ИГРУ ---
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
});

// --- КНОПКИ УПРАВЛЕНИЯ ---
document.getElementById('mobilizeBtn').addEventListener('click', () => {
    if (players[myId] && players[myId].military >= 1000) {
        socket.emit('mobilize');
        showMsg("Дивизия мобилизована в столице!");
    } else {
        showMsg("❌ Недостаточно Военной силы!");
    }
});

document.getElementById('drawRegionBtn').addEventListener('click', () => {
    if (!isDrawingRegion) {
        isDrawingRegion = true;
        currentDrawingRegionId = `reg_${myId}_${Math.random().toString(36).substr(2, 5)}`;
        document.getElementById('drawRegionBtn').style.background = '#e67e22'; // Меняем цвет на оранжевый
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

// --- СЕТЬ ---
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

// --- ОТРИСОВКА ---
function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (bgMap.complete) ctx.drawImage(bgMap, 0, 0, canvas.width, canvas.height);

    // Территория
    ctx.globalAlpha = 0.6; 
    for (const key in territory) {
        const cell = territory[key];
        const owner = players[cell.owner];
        if (owner) {
            const [x, y] = key.split('_').map(Number);
            ctx.fillStyle = owner.color;
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            
            // Если включен режим рисования, выделяем текущий рисуемый регион
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

    // Армии
    for (const id in armies) {
        const army = armies[id];
        const owner = players[army.owner];
        if (!owner) continue;

        if (id === selectedArmyId) {
            ctx.beginPath(); ctx.arc(army.x, army.y, 18, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(46, 204, 113, 0.6)'; ctx.fill();
            // Рисуем линию к цели, если армия движется
            if (army.targetX !== null) {
                ctx.beginPath(); ctx.moveTo(army.x, army.y); ctx.lineTo(army.targetX, army.targetY);
                ctx.strokeStyle = 'rgba(46, 204, 113, 0.8)'; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
            }
        }

        ctx.beginPath(); ctx.arc(army.x, army.y, 14, 0, Math.PI * 2);
        ctx.fillStyle = owner.color; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#222'; ctx.stroke();
        ctx.fillStyle = 'white'; ctx.font = '14px Arial'; ctx.textBaseline = 'middle';
        ctx.fillText(owner.flag, army.x, army.y);
    }
}

// --- УПРАВЛЕНИЕ МЫШЬЮ ---
let isMouseDragging = false;
let clickedRegionId = null;

canvas.addEventListener('mousedown', (e) => { 
    isMouseDragging = true; 
    handleMouseAction(e); 
});
canvas.addEventListener('mouseup', () => isMouseDragging = false);
canvas.addEventListener('mousemove', (e) => { 
    if (isMouseDragging && isDrawingRegion) handleMouseAction(e); 
});

function handleMouseAction(event) {
    if (!isPlaying) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (event.clientX - rect.left) * scaleX;
    const mouseY = (event.clientY - rect.top) * scaleY;
    
    const gridX = Math.floor(mouseX / TILE_SIZE);
    const gridY = Math.floor(mouseY / TILE_SIZE);
    const cellKey = `${gridX}_${gridY}`;

    // ЛЕВЫЙ КЛИК
    if (event.button === 0) {
        if (!isSpawned) {
            socket.emit('spawnCapital', { x: gridX, y: gridY });
            return;
        }

        // Режим рисования региона (Зажата мышь)
        if (isDrawingRegion) {
            socket.emit('paintRegion', { x: gridX, y: gridY, newRegionId: currentDrawingRegionId });
            return;
        }

        // Выделение армии
        selectedArmyId = null;
        for (const id in armies) {
            const a = armies[id];
            if (a.owner === myId && Math.hypot(a.x - mouseX, a.y - mouseY) <= 18) {
                selectedArmyId = id;
                showMsg("Армия выбрана. ПКМ для движения.");
                drawMap();
                return; // Если кликнули по армии, регион не открываем
            }
        }

        // Информация о регионе
        const cell = territory[cellKey];
        if (cell) {
            clickedRegionId = cell.regionId;
            updateRegionPanel();
        } else {
            document.getElementById('regionPanel').style.display = 'none';
        }
        drawMap();
    }
    
    // ПРАВЫЙ КЛИК (Движение армии)
    else if (event.button === 2 && selectedArmyId && !isDrawingRegion) {
        socket.emit('moveArmy', { armyId: selectedArmyId, targetX: mouseX, targetY: mouseY });
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
    document.getElementById('regIncome').innerText = (reg.cells * 15).toLocaleString(); // ВВП региона (15$ за клетку)
}
