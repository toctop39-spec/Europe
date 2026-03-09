const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Хранилище игры
let players = {}; // Данные стран (цвет, имя, площадь)
let territory = {}; // Сетка карты: "x_y" -> socket.id

io.on('connection', (socket) => {
    // Отправляем новому игроку текущую карту
    socket.emit('initData', { players, territory });

    // Игрок основывает страну
    socket.on('joinGame', (data) => {
        players[socket.id] = {
            name: data.name,
            color: data.color,
            cells: 0
        };
        io.emit('playerJoined', { id: socket.id, player: players[socket.id] });
    });

    // Обработка закрашивания клетки
    socket.on('claimCell', (data) => {
        if (!players[socket.id]) return; // Запрещаем красить, если не создал страну

        const cellKey = `${data.x}_${data.y}`;
        const previousOwner = territory[cellKey];

        // Если отбираем клетку у другого игрока — уменьшаем его счетчик
        if (previousOwner && previousOwner !== socket.id && players[previousOwner]) {
            players[previousOwner].cells--;
        }

        // Записываем клетку на нового владельца
        if (previousOwner !== socket.id) {
            territory[cellKey] = socket.id;
            players[socket.id].cells++;
            
            // Рассылаем обновление всем игрокам
            io.emit('cellUpdated', { 
                key: cellKey, 
                owner: socket.id,
                players: players
            });
        }
    });

    socket.on('disconnect', () => {
        // Игрок ушел, но его империя (цвет на карте) остается
        console.log(`Игрок отключился: ${socket.id}`);
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
