const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const WORLD_WIDTH = 1920; 
const WORLD_HEIGHT = 1080;
const TILE_SIZE = 15; 
const KM_PER_TILE = 25000; // Правильный масштаб! 1 клетка = 25,000 км²

canvas.width = WORLD_WIDTH;
canvas.height = WORLD_HEIGHT;

let territory = {};
let players = {};
let capitals = {};
let myId = null;
let isPlaying = false;
let isSpawned = false;

const bgMap = new Image();
bgMap.src = 'Map.png';
bgMap.onload = () => drawMap();

// --- Интерфейс ---
document.getElementById('joinBtn').addEventListener('click', () => {
    const name = document.getElementById('countryName').value || 'Неизвестная Империя';
    const color = document.getElementById('countryColor').value;
    
    socket.emit('joinGame', { name, color });
    
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('ui').style.display = 'block';
    document.getElementById('myName').innerText = name;
    document.getElementById('myName').style.color = color;
    isPlaying = true;
});

// --- Сетевая логика ---
socket.on('connect', () => { myId = socket.id; });

socket.on('initData', (data) => {
    players = data.players;
    territory = data.territory;
    capitals = data.capitals || {};
    drawMap();
});

socket.on('updateMap', (data) => {
    players = data.players;
    territory = data.territory;
    capitals = data.capitals;
    
    if (players[myId] && players[myId].isSpawned) {
        isSpawned = true;
        document.getElementById('gameHint').innerText = "Ожидайте приказов...";
    }
    updateUI();
    drawMap();
});

socket.on('updateResources', (updatedPlayers) => {
    players = updatedPlayers;
    updateUI();
});

function updateUI() {
    if (players[myId]) {
        // Умножаем на наш реалистичный масштаб
        document.getElementById('myArea').innerText = (players[myId].cells * Math.floor(KM_PER_TILE)).toLocaleString();
        document.getElementById('myGold').innerText = players[myId].gold;
    }
}

// --- Отрисовка ---
function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (bgMap.complete) ctx.drawImage(bgMap, 0, 0, canvas.width, canvas.height);

    ctx.globalAlpha = 0.55; 

    // Рисуем территорию
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

    // Рисуем Столицы и Названия стран
    for (const id in capitals) {
        const owner = players[id];
        const cap = capitals[id];
        
        if (owner && cap) {
            const pixelX = cap.x * TILE_SIZE + (TILE_SIZE / 2);
            const pixelY = cap.y * TILE_SIZE + (TILE_SIZE / 2);

            // Значок столицы (звезда или кружок)
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(pixelX, pixelY, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Пишем название страны над столицей
            ctx.fillStyle = 'white';
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            // Добавляем черную обводку тексту, чтобы читалось на любом фоне
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 3;
            ctx.strokeText(owner.name, pixelX, pixelY - 15);
            ctx.fillText(owner.name, pixelX, pixelY - 15);
        }
    }
}

// --- Взаимодействие ---
// Теперь клик используется для спавна столицы, а не для рисования!
canvas.addEventListener('click', (event) => {
    if (!isPlaying || isSpawned) return; // Если уже заспавнился - клик ничего не делает

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const mouseX = (event.clientX - rect.left) * scaleX;
    const mouseY = (event.clientY - rect.top) * scaleY;

    const gridX = Math.floor(mouseX / TILE_SIZE);
    const gridY = Math.floor(mouseY / TILE_SIZE);

    if (mouseX >= 0 && mouseX <= canvas.width && mouseY >= 0 && mouseY <= canvas.height) {
        socket.emit('spawnCapital', { x: gridX, y: gridY });
    }
});
