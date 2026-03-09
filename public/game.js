const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const TILE_SIZE = 15; // Размер одной клетки захвата (можешь сделать меньше/больше)

let territory = {};
let players = {};
let myId = null;
let isPlaying = false;

// Загружаем твою карту
const bgMap = new Image();
bgMap.src = 'Map.png'; // Имя твоего файла в папке public

// Когда карта загрузится, перерисовываем экран
bgMap.onload = () => {
    drawMap();
};

// --- UI Логика ---
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
socket.on('connect', () => {
    myId = socket.id;
});

socket.on('initData', (data) => {
    players = data.players;
    territory = data.territory;
    drawMap();
});

socket.on('playerJoined', (data) => {
    players[data.id] = data.player;
});

socket.on('cellUpdated', (data) => {
    territory[data.key] = data.owner;
    players = data.players;
    updateUI();
    drawMap();
});

function updateUI() {
    if (players[myId]) {
        document.getElementById('myScore').innerText = players[myId].cells * 10;
    }
}

// --- Отрисовка ---
function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 1. Сначала рисуем твою картинку карты на весь экран
    if (bgMap.complete) {
        ctx.drawImage(bgMap, 0, 0, canvas.width, canvas.height);
    } else {
        // Если картинка еще не загрузилась, рисуем черный фон
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 2. Включаем полупрозрачность для стран, чтобы видеть карту под ними
    ctx.globalAlpha = 0.6; // 60% непрозрачности

    // 3. Рисуем захваченные территории поверх карты
    for (const key in territory) {
        const ownerId = territory[key];
        const owner = players[ownerId];
        
        if (owner) {
            const [x, y] = key.split('_').map(Number);
            
            ctx.fillStyle = owner.color;
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            
            // Легкая обводка границ клеток
            ctx.strokeStyle = 'rgba(0,0,0,0.1)';
            ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
    }

    // Возвращаем нормальную непрозрачность
    ctx.globalAlpha = 1.0;
}

// --- Взаимодействие (Захват территории) ---
let isDragging = false;

canvas.addEventListener('mousedown', () => isDragging = true);
canvas.addEventListener('mouseup', () => isDragging = false);
canvas.addEventListener('mousemove', (e) => {
    if (isDragging && isPlaying) claimArea(e);
});
canvas.addEventListener('click', (e) => {
    if (isPlaying) claimArea(e);
});

function claimArea(event) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const gridX = Math.floor(mouseX / TILE_SIZE);
    const gridY = Math.floor(mouseY / TILE_SIZE);

    socket.emit('claimCell', { x: gridX, y: gridY });
}

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    drawMap();
});
