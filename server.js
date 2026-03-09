const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

let players = {}; 
let territory = {}; 
let armies = {}; 
let regions = {}; 

const TILE_SIZE = 15; 

// Вспомогательная функция для расчета центра региона
function calculateRegionCenter(regionId) {
    let sumX = 0, sumY = 0, count = 0;
    for (const key in territory) {
        if (territory[key].regionId === regionId) {
            const [x, y] = key.split('_').map(Number);
            sumX += x; sumY += y; count++;
        }
    }
    if (count === 0) return null;
    return { x: (sumX / count) * TILE_SIZE + (TILE_SIZE/2), y: (sumY / count) * TILE_SIZE + (TILE_SIZE/2) };
}

io.on('connection', (socket) => {
    socket.emit('initData', { players, territory, armies, regions });

    socket.on('joinGame', (data) => {
        players[socket.id] = {
            name: data.name, flag: data.flag || '🏳️', color: data.color,
            cells: 0, dollars: 10000, military: 5000, cap: 5000, isSpawned: false
        };
        io.emit('playerJoined', { id: socket.id, player: players[socket.id] });
    });

    socket.on('spawnCapital', (data) => {
        const player = players[socket.id];
        if (!player || player.isSpawned) return;

        player.isSpawned = true;
        const startRegionId = `reg_${socket.id}_cap`;
        regions[startRegionId] = { name: "Столичный регион", owner: socket.id, cells: 0 };

        const spawnTiles = [{dx:0,dy:0}, {dx:1,dy:0}, {dx:-1,dy:0}, {dx:0,dy:1}, {dx:0,dy:-1}, {dx:1,dy:1}, {dx:-1,dy:-1}, {dx:1,dy:-1}, {dx:-1,dy:1}];
        spawnTiles.forEach(offset => {
            const cellKey = `${data.x + offset.dx}_${data.y + offset.dy}`;
            territory[cellKey] = { owner: socket.id, regionId: startRegionId };
            player.cells++;
            regions[startRegionId].cells++;
        });

        io.emit('updateMap', { players, territory, regions });
    });

    socket.on('paintRegion', (data) => {
        const cell = territory[`${data.x}_${data.y}`];
        if (cell && cell.owner === socket.id) {
            if (regions[cell.regionId]) regions[cell.regionId].cells--;
            cell.regionId = data.newRegionId;
            if (!regions[data.newRegionId]) {
                regions[data.newRegionId] = { name: `Регион ${Object.keys(regions).length + 1}`, owner: socket.id, cells: 0 };
            }
            regions[data.newRegionId].cells++;
            io.emit('syncTerritory', { territory, regions });
        }
    });

    // Мобилизация теперь принимает КОЛИЧЕСТВО войск и РЕГИОН
    socket.on('deployArmy', (data) => {
        const player = players[socket.id];
        const amount = parseInt(data.amount);
        const center = calculateRegionCenter(data.regionId);
        
        if (player && center && amount > 0 && player.military >= amount) {
            player.military -= amount;
            const armyId = Math.random().toString(36).substr(2, 9);
            armies[armyId] = {
                id: armyId, owner: socket.id,
                x: center.x, y: center.y,
                targetX: null, targetY: null,
                count: amount, // Число солдат
                speed: 0.25 
            };
            io.emit('syncArmies', armies);
            io.emit('updateResources', players);
        }
    });

    socket.on('moveArmies', (data) => {
        // Теперь принимаем массив ID армий для движения толпой
        data.armyIds.forEach(id => {
            if (armies[id] && armies[id].owner === socket.id) {
                // Добавляем небольшой разброс, чтобы они не слипались в 1 точку
                const offsetX = (Math.random() - 0.5) * 20;
                const offsetY = (Math.random() - 0.5) * 20;
                armies[id].targetX = data.targetX + offsetX;
                armies[id].targetY = data.targetY + offsetY;
            }
        });
    });

    socket.on('disconnect', () => { delete players[socket.id]; });
});

// Экономика (Тик 1 сек)
setInterval(() => {
    let changed = false;
    for (const id in players) {
        if (players[id].isSpawned) {
            players[id].cap = 5000 + (players[id].cells * 500); 
            
            // Расчет содержания армии
            let maintenance = 0;
            for(const aId in armies) {
                if(armies[aId].owner === id) maintenance += armies[aId].count * 0.1;
            }
            
            const income = 100 + (players[id].cells * 15) - maintenance;
            players[id].dollars += income; 
            players[id].lastIncome = income; // Для UI
            
            if (players[id].military < players[id].cap) {
                players[id].military += Math.floor(players[id].cells * 5); 
                if (players[id].military > players[id].cap) players[id].military = players[id].cap;
            }
            changed = true;
        }
    }
    if (changed) io.emit('updateResources', players);
}, 1000);

// Движение, Захват и БОЕВКА (Тик 30 FPS)
setInterval(() => {
    let stateChanged = false;

    // 1. Движение и захват
    for (const id in armies) {
        let a = armies[id];
        let isInCombat = false;

        // 2. БОЕВКА (Ищем врагов в радиусе 15px)
        for(const enemyId in armies) {
            if(enemyId !== id && armies[enemyId].owner !== a.owner) {
                let e = armies[enemyId];
                let dist = Math.hypot(e.x - a.x, e.y - a.y);
                if(dist < 15) {
                    isInCombat = true;
                    // Взаимный урон (зависит от размера армии)
                    a.count -= e.count * 0.01;
                    e.count -= a.count * 0.01;
                    stateChanged = true;
                }
            }
        }

        // Удаляем мертвые армии
        if(a.count <= 0) { delete armies[id]; continue; }

        // Если армия не в бою - она движется
        if (!isInCombat && a.targetX !== null && a.targetY !== null) {
            let dx = a.targetX - a.x;
            let dy = a.targetY - a.y;
            let distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > a.speed) {
                a.x += (dx / distance) * a.speed;
                a.y += (dy / distance) * a.speed;
                stateChanged = true;
            } else {
                a.x = a.targetX; a.y = a.targetY;
                a.targetX = null; a.targetY = null;
                stateChanged = true;
            }

            // Захват территории
            const cellKey = `${Math.floor(a.x / TILE_SIZE)}_${Math.floor(a.y / TILE_SIZE)}`;
            const cell = territory[cellKey];
            if (!cell || cell.owner !== a.owner) {
                const prevOwner = cell ? cell.owner : null;
                if (prevOwner && players[prevOwner]) {
                    players[prevOwner].cells--;
                    if (cell.regionId && regions[cell.regionId]) regions[cell.regionId].cells--;
                }
                const newRegionId = `reg_${a.owner}_cap`;
                territory[cellKey] = { owner: a.owner, regionId: newRegionId };
                if (players[a.owner]) players[a.owner].cells++;
                if (regions[newRegionId]) regions[newRegionId].cells++;
                stateChanged = true;
                io.emit('syncTerritory', { territory, regions });
            }
        }
    }
    
    if (stateChanged) io.emit('syncArmies', armies);
}, 1000 / 30);

server.listen(process.env.PORT || 3000, () => console.log('Сервер работает'));
