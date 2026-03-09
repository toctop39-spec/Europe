const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const TILE_SIZE = 20; // Размер одной клетки территории в пикселях

let territory = {};
let players = {};
let myId = null;
let isPlaying = false;

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
        document.getElementById('myScore').innerText = players[myId].cells * 10; // условно 10 км2 за клетку
    }
}

// --- Отрисовка ---
function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Рисуем фон (море/пустошь)
    ctx.fillStyle = '#1e272e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Рисуем захваченные территории
    for (const key in territory) {
        const ownerId = territory[key];
        const owner = players[ownerId];
        
        if (owner) {
            const [x, y] = key.split('_').map(Number);
            
            ctx.fillStyle = owner.color;
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            
            // Легкая обводка для стиля (границы)
            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
    }
}

// --- Взаимодействие (Клик = Захват) ---
// Для удобства сделаем так, чтобы можно было зажать мышку и "красить" карту
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

    // Вычисляем, в какую клетку попал клик
    const gridX = Math.floor(mouseX / TILE_SIZE);
    const gridY = Math.floor(mouseY / TILE_SIZE);

    socket.emit('claimCell', { x: gridX, y: gridY });
}

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    drawMap();
});
