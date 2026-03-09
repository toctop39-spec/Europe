const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- НАСТРОЙКИ МИРА ---
// Укажи здесь размер твоей картинки Map.png! (например 1920x1080)
const WORLD_WIDTH = 1920; 
const WORLD_HEIGHT = 1080;
const TILE_SIZE = 15; // Размер одной клетки

// Жестко фиксируем внутренний размер холста
canvas.width = WORLD_WIDTH;
canvas.height = WORLD_HEIGHT;

let territory = {};
let players = {};
let myId = null;
let isPlaying = false;

// Загружаем карту
const bgMap = new Image();
bgMap.src = 'Map.png';

bgMap.onload = () => {
    drawMap(); // Рисуем, как только картинка загрузится
};

// --- ИНТЕРФЕЙС И ВХОД ---
document.getElementById('joinBtn').addEventListener('click', () => {
    const name = document.getElementById('countryName').value || 'Неизвестная Империя';
    const color = document.getElementById('countryColor').value;
    
    socket.emit('joinGame', { name, color });
    
    // Прячем меню, показываем счетчик
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('ui').style.display = 'block';
    document.getElementById('myName').innerText = name;
    document.getElementById('myName').style.color = color;
    isPlaying = true;
});

// --- СЕТЕВАЯ ЛОГИКА ---
socket.on('connect', () => { myId = socket.id; });

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

// --- ОТРИСОВКА ---
function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 1. Рисуем картинку на фоне
    if (bgMap.complete) {
        ctx.drawImage(bgMap, 0, 0, canvas.width, canvas.height);
    }

    // 2. Включаем полупрозрачность для стран (чтобы видеть рельеф карты)
    ctx.globalAlpha = 0.55; 

    // 3. Рисуем захваченные клетки
    for (const key in territory) {
        const ownerId = territory[key];
        const owner = players[ownerId];
        
        if (owner) {
            const [x, y] = key.split('_').map(Number);
            
            ctx.fillStyle = owner.color;
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            
            // Легкая обводка клеток (если хочешь бесшовную заливку - удали эти 2 строки)
            ctx.strokeStyle = 'rgba(0,0,0,0.1)';
            ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
    }

    ctx.globalAlpha = 1.0; // Возвращаем нормальную прозрачность
}

// --- ВЗАИМОДЕЙСТВИЕ И РАСЧЕТ КООРДИНАТ ---
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
    
    // Вычисляем масштаб (как сильно CSS сжал или растянул картинку)
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Переводим координаты экрана в координаты нашего виртуального мира 1920x1080
    const mouseX = (event.clientX - rect.left) * scaleX;
    const mouseY = (event.clientY - rect.top) * scaleY;

    // Высчитываем номер клетки
    const gridX = Math.floor(mouseX / TILE_SIZE);
    const gridY = Math.floor(mouseY / TILE_SIZE);

    // Отправляем на сервер только если кликнули в пределах карты
    if (mouseX >= 0 && mouseX <= canvas.width && mouseY >= 0 && mouseY <= canvas.height) {
        socket.emit('claimCell', { x: gridX, y: gridY });
    }
}
