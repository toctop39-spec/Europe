const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const WORLD_WIDTH = 1920; 
const WORLD_HEIGHT = 1080;
const TILE_SIZE = 15; 
const KM_PER_TILE = 25000; 

canvas.width = WORLD_WIDTH;
canvas.height = WORLD_HEIGHT;

let territory = {};
let players = {};
let capitals = {};
let armies = {};
let myId = null;
let isPlaying = false;
let isSpawned = false;

let selectedArmyId = null; // Какая армия сейчас выделена

const bgMap = new Image();
bgMap.src = 'Map.png';
bgMap.onload = () => drawMap();

// --- Интерфейс ---
document.getElementById('joinBtn').addEventListener('click', () => {
    const name = document.getElementById('countryName').value || 'Неизвестная Империя';
    const flag = document.getElementById('countryFlag').value || '🏳️';
    const color = document.getElementById('countryColor').value;
    
    socket.emit('joinGame', { name, color, flag });
    
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('ui').style.display = 'block';
    document.getElementById('myName').innerText = name;
    document.getElementById('myName').style.color = color;
    document.getElementById('myFlagUI').innerText = flag;
    isPlaying = true;
});

document.getElementById('mobilizeBtn').addEventListener('click', () => {
    socket.emit('mobilize');
});

// --- Сетевая логика ---
socket.on('connect', () => { myId = socket.id; });

socket.on('initData', (data) => {
    players = data.players;
    territory = data.territory;
    capitals = data.capitals;
    armies = data.armies;
    drawMap();
});

socket.on('updateMap', (data) => {
    players = data.players;
    territory = data.territory;
    capitals = data.capitals;
    
    if (players[myId] && players[myId].isSpawned) {
        isSpawned = true;
        document.getElementById('gameHint').innerText = "ЛКМ: Выделить армию | ПКМ: Отправить в атаку";
        document.getElementById('mobilizeBtn').style.display = 'block';
    }
    updateUI();
});

socket.on('updateResources', (updatedPlayers) => {
    players = updatedPlayers;
    updateUI();
});

socket.on('syncArmies', (syncedArmies) => {
    armies = syncedArmies;
    drawMap(); // Перерисовываем кадр при движении
});

function updateUI() {
    if (players[myId]) {
        document.getElementById('myArea').innerText = (players[myId].cells * KM_PER_TILE).toLocaleString();
        document.getElementById('myGold').innerText = players[myId].gold;
        document.getElementById('myManpower').innerText = players[myId].manpower.toLocaleString();
        
        // Кнопка активна только если хватает рекрутов
        document.getElementById('mobilizeBtn').disabled = players[myId].manpower < 1000;
        document.getElementById('mobilizeBtn').style.opacity = players[myId].manpower < 1000 ? '0.5' : '1';
    }
}

// --- Отрисовка ---
function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (bgMap.complete) ctx.drawImage(bgMap, 0, 0, canvas.width, canvas.height);

    // 1. Рисуем территорию
    ctx.globalAlpha = 0.5; 
    for (const key in territory) {
        const ownerId = territory[key];
        const owner = players[ownerId];
        if (owner) {
            const [x, y] = key.split('_').map(Number);
            ctx.fillStyle = owner.color;
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
    }
    ctx.globalAlpha = 1.0; 

    // 2. Рисуем Столицы и Названия
    for (const id in capitals) {
        const owner = players[id];
        const cap = capitals[id];
        if (owner && cap) {
            const pixelX = cap.x * TILE_SIZE + (TILE_SIZE / 2);
            const pixelY = cap.y * TILE_SIZE + (TILE_SIZE / 2);

            ctx.fillStyle = 'white';
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 3;
            ctx.strokeText(`${owner.flag} ${owner.name}`, pixelX, pixelY - 15);
            ctx.fillText(`${owner.flag} ${owner.name}`, pixelX, pixelY - 15);
        }
    }

    // 3. Рисуем Армии (Кружки с флагами)
    for (const id in armies) {
        const army = armies[id];
        const owner = players[army.owner];
        if (!owner) continue;

        // Если армия выделена нами - рисуем зеленую ауру (подсветку)
        if (id === selectedArmyId) {
            ctx.beginPath();
            ctx.arc(army.x, army.y, 16, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(46, 204, 113, 0.5)';
            ctx.fill();
        }

        // Сам кружок армии (цвета страны)
        ctx.beginPath();
        ctx.arc(army.x, army.y, 12, 0, Math.PI * 2);
        ctx.fillStyle = owner.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();

        // Флаг внутри кружка
        ctx.fillStyle = 'white';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(owner.flag, army.x, army.y);
    }
}

// --- Управление мышью (RTS Контроль) ---
canvas.addEventListener('mousedown', (event) => {
    if (!isPlaying) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (event.clientX - rect.left) * scaleX;
    const mouseY = (event.clientY - rect.top) * scaleY;

    // ЛЕВЫЙ КЛИК: Выбор армии или Спавн
    if (event.button === 0) {
        if (!isSpawned) {
            // Спавн столицы
            const gridX = Math.floor(mouseX / TILE_SIZE);
            const gridY = Math.floor(mouseY / TILE_SIZE);
            socket.emit('spawnCapital', { x: gridX, y: gridY });
            return;
        }

        // Пытаемся выделить армию (проверяем, кликнули ли мы по кружку)
        selectedArmyId = null;
        for (const id in armies) {
            const army = armies[id];
            if (army.owner === myId) {
                const dist = Math.sqrt(Math.pow(army.x - mouseX, 2) + Math.pow(army.y - mouseY, 2));
                if (dist <= 15) { // Радиус клика
                    selectedArmyId = id;
                    break;
                }
            }
        }
        drawMap();
    }
    
    // ПРАВЫЙ КЛИК: Отправить армию
    else if (event.button === 2) {
        if (selectedArmyId) {
            socket.emit('moveArmy', {
                armyId: selectedArmyId,
                targetX: mouseX,
                targetY: mouseY
            });
        }
    }
});
