const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Данные игры
let players = {}; // Страны игроков
let territory = {}; // Сетка карты. Формат: "x_y" -> id владельца

io.on('connection', (socket) => {
    
    // Отправляем текущую карту при подключении
    socket.emit('initData', { players, territory });

    // Игрок создает страну
    socket.on('joinGame', (data) => {
        players[socket.id] = {
            name: data.name,
            color: data.color,
            cells: 0
        };
        io.emit('playerJoined', { id: socket.id, player: players[socket.id] });
    });

    // Игрок захватывает клетку (красит карту)
    socket.on('claimCell', (data) => {
        if (!players[socket.id]) return; // Если еще не создал страну - игнорим

        const cellKey = `${data.x}_${data.y}`;
        const previousOwner = territory[cellKey];

        // Если клетка чужая, отнимаем у него очки территории
        if (previousOwner && previousOwner !== socket.id && players[previousOwner]) {
            players[previousOwner].cells--;
        }

        // Захватываем клетку
        if (previousOwner !== socket.id) {
            territory[cellKey] = socket.id;
            players[socket.id].cells++;
            
            // Рассылаем обновление всем
            io.emit('cellUpdated', { 
                key: cellKey, 
                owner: socket.id,
                players: players // обновленная статистика
            });
        }
    });

    socket.on('disconnect', () => {
        // Страна остается на карте (как бот/нейтрал), но игрок выходит
        delete players[socket.id];
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
