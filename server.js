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
let capitals = {}; 
let armies = {}; // Храним все армии в мире

io.on('connection', (socket) => {
    socket.emit('initData', { players, territory, capitals, armies });

    socket.on('joinGame', (data) => {
        players[socket.id] = {
            name: data.name,
            flag: data.flag || '🏳️',
            color: data.color,
            cells: 0,
            gold: 500,
            manpower: 500, // Стартовые рекруты
            isSpawned: false
        };
        io.emit('playerJoined', { id: socket.id, player: players[socket.id] });
    });

    socket.on('spawnCapital', (data) => {
        const player = players[socket.id];
        if (!player || player.isSpawned) return;

        capitals[socket.id] = { x: data.x, y: data.y };
        player.isSpawned = true;

        const spawnTiles = [{dx:0,dy:0}, {dx:1,dy:0}, {dx:-1,dy:0}, {dx:0,dy:1}, {dx:0,dy:-1}];
        spawnTiles.forEach(offset => {
            const cellKey = `${data.x + offset.dx}_${data.y + offset.dy}`;
            territory[cellKey] = socket.id;
            player.cells++;
        });

        io.emit('updateMap', { players, territory, capitals });
    });

    // Механика: Спавн армии
    socket.on('mobilize', () => {
        const player = players[socket.id];
        const cap = capitals[socket.id];
        if (player && cap && player.manpower >= 1000) {
            player.manpower -= 1000; // Тратим рекрутов
            
            const armyId = Math.random().toString(36).substr(2, 9);
            armies[armyId] = {
                id: armyId,
                owner: socket.id,
                // Спавним в координатах пикселей (центр столицы)
                x: cap.x * 15 + 7.5, 
                y: cap.y * 15 + 7.5,
                targetX: null,
                targetY: null,
                speed: 3 // Скорость движения
            };
            io.emit('syncArmies', armies);
            io.emit('updateResources', players);
        }
    });

    // Механика: Приказ двигаться
    socket.on('moveArmy', (data) => {
        const army = armies[data.armyId];
        if (army && army.owner === socket.id) {
            army.targetX = data.targetX;
            army.targetY = data.targetY;
        }
    });

    socket.on('disconnect', () => {
        console.log(`Игрок отключился: ${socket.id}`);
    });
});

// ИГРОВОЙ ЦИКЛ (Экономика) - 1 раз в секунду
setInterval(() => {
    let changed = false;
    for (const id in players) {
        if (players[id].isSpawned) {
            players[id].gold += 5 + Math.floor(players[id].cells * 0.5);
            players[id].manpower += Math.floor(players[id].cells * 2); // Прирост рекрутов зависит от размера
            changed = true;
        }
    }
    if (changed) io.emit('updateResources', players);
}, 1000);

// ИГРОВОЙ ЦИКЛ (Движение армий) - 30 раз в секунду (плавное RTS движение)
setInterval(() => {
    let armiesMoved = false;
    for (const id in armies) {
        let a = armies[id];
        if (a.targetX !== null && a.targetY !== null) {
            let dx = a.targetX - a.x;
            let dy = a.targetY - a.y;
            let distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > a.speed) {
                // Двигаемся к цели
                a.x += (dx / distance) * a.speed;
                a.y += (dy / distance) * a.speed;
                armiesMoved = true;
            } else {
                // Прибыли на место
                a.x = a.targetX;
                a.y = a.targetY;
                a.targetX = null;
                a.targetY = null;
                armiesMoved = true;
            }
        }
    }
    if (armiesMoved) {
        io.emit('syncArmies', armies);
    }
}, 1000 / 30); // ~33ms

server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
