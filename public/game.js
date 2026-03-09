const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const playerIdSpan = document.getElementById('playerId');

// Настройка размера холста
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Загрузка карты
const mapImage = new Image();
// Твоя ссылка на карту (лучше скачать ее и положить в папку public, чтобы не было ошибок CORS)
mapImage.src = 'https://tse2.mm.bing.net/th/id/OIP.sbVKHGXTxvzkekMpQxhsNwHaHv?rs=1&pid=ImgDetMain&o=7&rm=3'; 

let gameState = { cities: [] };
let myId = null;

// При подключении получаем свой ID
socket.on('connect', () => {
    myId = socket.id;
    playerIdSpan.innerText = myId.substring(0, 5);
});

// Получаем начальное состояние
socket.on('gameState', (state) => {
    gameState = state;
    draw();
});

// Обновление карты в реальном времени
socket.on('updateMap', (state) => {
    gameState = state;
    draw();
});

// Главная функция отрисовки
function draw() {
    // Очищаем экран
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Рисуем карту (растягиваем по центру или во весь экран)
    if (mapImage.complete) {
        ctx.drawImage(mapImage, 0, 0, canvas.width, canvas.height);
    }

    // Рисуем города
    gameState.cities.forEach(city => {
        // Если это наш город - синий, если чужой - красный
        ctx.fillStyle = city.owner === myId ? '#00a8ff' : '#e84118';
        ctx.beginPath();
        ctx.arc(city.x, city.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.stroke();

        // Подпись инфраструктуры
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.fillText(`Ур. ${city.level}`, city.x + 10, city.y + 5);
    });
}

// Рисуем карту, когда картинка загрузится
mapImage.onload = () => draw();

// Обработка клика (постройка города)
canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Отправляем на сервер команду построить город
    socket.emit('buildCity', { x: x, y: y });
});

// Перерисовка при изменении размера окна
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    draw();
});
