const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const playerIdSpan = document.getElementById('playerId');

// Настройка размера холста
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    draw(); // Перерисовываем при изменении окна
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let gameState = { cities: [] };
let myId = null;
let geoJSON = null;

// При подключении получаем свой ID
socket.on('connect', () => {
    myId = socket.id;
    playerIdSpan.innerText = myId.substring(0, 5);
});

// Получаем начальное состояние городов
socket.on('gameState', (state) => {
    gameState = state;
    draw();
});

// Обновление карты в реальном времени
socket.on('updateMap', (state) => {
    gameState = state;
    draw();
});

// Загружаем гео-данные мира (с помощью кода, никаких картинок)
fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json')
    .then(response => response.json())
    .then(data => {
        geoJSON = data;
        draw(); // Перерисовываем, когда данные загрузятся
    });

// Функция-проекция: переводит реальные координаты (широту и долготу) в пиксели на экране
function project(lng, lat) {
    // Рамки для Европы: от Атлантики до Урала, от Африки до Скандинавии
    const minLng = -15, maxLng = 45;
    const minLat = 35, maxLat = 70;

    // Высчитываем масштаб, чтобы карта сохраняла пропорции и не растягивалась
    const scaleX = canvas.width / (maxLng - minLng);
    const scaleY = canvas.height / (maxLat - minLat);
    const scale = Math.min(scaleX, scaleY); // Берем минимальный, чтобы влезло всё без искажений

    // Центрируем карту на экране
    const offsetX = (canvas.width - (maxLng - minLng) * scale) / 2;
    const offsetY = (canvas.height - (maxLat - minLat) * scale) / 2;

    const x = (lng - minLng) * scale + offsetX;
    // Широта инвертирована (в программировании Y идет вниз, а на картах вверх)
    const y = canvas.height - ((lat - minLat) * scale) - offsetY;

    return { x, y };
}

// Вспомогательная функция для отрисовки полигонов суши
function drawPolygon(coordinates) {
    ctx.beginPath();
    coordinates.forEach((coord, index) => {
        const point = project(coord[0], coord[1]);
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
    });
    ctx.fill();
    // Обрати внимание: мы НЕ используем ctx.stroke(), поэтому границ стран не будет!
}

// Главная функция отрисовки
function draw() {
    // 1. Рисуем море (фон)
    ctx.fillStyle = '#2c3e50'; // Темно-синий цвет океана
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Рисуем сушу кодом
    if (geoJSON) {
        ctx.fillStyle = '#ecf0f1'; // Светлый цвет суши
        geoJSON.features.forEach(feature => {
            if (feature.geometry.type === 'Polygon') {
                drawPolygon(feature.geometry.coordinates[0]);
            } else if (feature.geometry.type === 'MultiPolygon') {
                feature.geometry.coordinates.forEach(polygon => {
                    drawPolygon(polygon[0]);
                });
            }
        });
    }

    // 3. Рисуем города игроков
    gameState.cities.forEach(city => {
        ctx.fillStyle = city.owner === myId ? '#3498db' : '#e74c3c';
        ctx.beginPath();
        ctx.arc(city.x, city.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 2;
        ctx.stroke();
    });
}

// Обработка клика (постройка города)
canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    socket.emit('buildCity', { x: x, y: y });
});
