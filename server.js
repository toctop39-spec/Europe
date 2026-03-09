const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

let players = {}; 
let territory = {}; 
let capitals = {}; // Храним координаты столиц: id -> {x, y}

io.on('connection', (socket) => {
    socket.emit('initData', { players, territory, capitals });

    socket.on('joinGame', (data) => {
        players[socket.id] = {
            name: data.name,
            color: data.color,
            cells: 0,
            gold: 100, // Стартовые деньги
            isSpawned: false
        };
        io.emit('playerJoined', { id: socket.id, player: players[socket.id] });
    });

    // Механика спавна (Выбор стартовой точки)
    socket.on('spawnCapital', (data) => {
        const player = players[socket.id];
        if (!player || player.isSpawned) return; // Нельзя спавниться дважды

        const { x, y } = data;
        capitals[socket.id] = { x, y };
        player.isSpawned = true;

        // Захватываем стартовую территорию (крестик 3x3 вокруг столицы)
        const spawnTiles = [
            {dx: 0, dy: 0}, {dx: 1, dy: 0}, {dx: -1, dy: 0}, 
            {dx: 0, dy: 1}, {dx: 0, dy: -1}
        ];

        spawnTiles.forEach(offset => {
            const tileX = x + offset.dx;
            const tileY = y + offset.dy;
            const cellKey = `${tileX}_${tileY}`;
            
            if (!territory[cellKey]) {
                territory[cellKey] = socket.id;
                player.cells++;
            }
        });

        io.emit('updateMap', { players, territory, capitals });
    });

    socket.on('disconnect', () => {
        console.log(`Игрок отключился: ${socket.id}`);
    });
});

// ИГРОВОЙ ЦИКЛ (Game Loop) - работает каждую секунду
setInterval(() => {
    let changed = false;
    for (const id in players) {
        if (players[id].isSpawned) {
            // Начисляем золото: базовая прибыль + бонус за размер территории
            players[id].gold += 5 + (players[id].cells * 2);
            changed = true;
        }
    }
    
    // Если у кого-то изменились ресурсы, отправляем обновление всем
    if (changed) {
        io.emit('updateResources', players);
    }
}, 1000); // 1000 мс = 1 секунда

server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
