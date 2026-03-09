const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Раздаем статические файлы из папки public
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Игровое состояние (хранится в памяти сервера)
let gameState = {
    cities: [] // Список всех построенных городов
};

// Обработка подключений
io.on('connection', (socket) => {
    console.log(`Игрок подключился: ${socket.id}`);
    
    // Отправляем новому игроку текущее состояние карты
    socket.emit('gameState', gameState);

    // Игрок кликает и строит город/базу
    socket.on('buildCity', (data) => {
        const newCity = {
            id: Math.random().toString(36).substr(2, 9),
            x: data.x,
            y: data.y,
            owner: socket.id,
            level: 1
        };
        gameState.cities.push(newCity);
        
        // Отправляем обновление ВСЕМ игрокам
        io.emit('updateMap', gameState);
    });

    socket.on('disconnect', () => {
        console.log(`Игрок отключился: ${socket.id}`);
        // В будущем здесь можно удалять юниты отключившегося игрока
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
