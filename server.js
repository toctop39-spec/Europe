const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {}; 
let territory = {}; 
let capitals = {}; 
let armies = {}; 
let regions = {}; 

const TILE_SIZE = 15; // Размер клетки

io.on('connection', (socket) => {
    socket.emit('initData', { players, territory, capitals, armies, regions });

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

        capitals[socket.id] = { x: data.x, y: data.y };
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

        io.emit('updateMap', { players, territory, capitals, regions });
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

    socket.on('mobilize', () => {
        const player = players[socket.id];
        const cap = capitals[socket.id];
        if (player && cap && player.military >= 1000) {
            player.military -= 1000;
            const armyId = Math.random().toString(36).substr(2, 9);
            armies[armyId] = {
                id: armyId, owner: socket.id,
                x: cap.x * TILE_SIZE + (TILE_SIZE / 2), 
                y: cap.y * TILE_SIZE + (TILE_SIZE / 2),
                targetX: null, targetY: null, 
                speed: 0.25 // ЗАМЕДЛИЛИ АРМИЮ В 10 РАЗ (было 2.5)
            };
            io.emit('syncArmies', armies);
            io.emit('updateResources', players);
        }
    });

    socket.on('moveArmy', (data) => {
        if (armies[data.armyId] && armies[data.armyId].owner === socket.id) {
            armies[data.armyId].targetX = data.targetX;
            armies[data.armyId].targetY = data.targetY;
        }
    });

    socket.on('disconnect', () => { delete players[socket.id]; });
});

// Экономика (Тик 1 сек)
setInterval(() => {
    let changed = false;
    for (const id in players) {
        if (players[id].isSpawned) {
            players[id].cap = 5000 + (players[id].cells * 500); 
            players[id].dollars += 100 + (players[id].cells * 15); 
            
            if (players[id].military < players[id].cap) {
                players[id].military += Math.floor(players[id].cells * 5); 
                if (players[id].military > players[id].cap) players[id].military = players[id].cap;
            }
            changed = true;
        }
    }
    if (changed) io.emit('updateResources', players);
}, 1000);

// Движение армий и ЗАХВАТ ТЕРРИТОРИЙ (Тик 30 FPS)
setInterval(() => {
    let armiesMoved = false;
    let territoryChanged = false;

    for (const id in armies) {
        let a = armies[id];
        if (a.targetX !== null && a.targetY !== null) {
            let dx = a.targetX - a.x;
            let dy = a.targetY - a.y;
            let distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > a.speed) {
                a.x += (dx / distance) * a.speed;
                a.y += (dy / distance) * a.speed;
                armiesMoved = true;
            } else {
                a.x = a.targetX; a.y = a.targetY;
                a.targetX = null; a.targetY = null;
                armiesMoved = true;
            }

            // --- ЛОГИКА ЗАХВАТА ---
            const gridX = Math.floor(a.x / TILE_SIZE);
            const gridY = Math.floor(a.y / TILE_SIZE);
            const cellKey = `${gridX}_${gridY}`;
            
            const cell = territory[cellKey];
            // Если клетка пустая или чужая — забираем её
            if (!cell || cell.owner !== a.owner) {
                const prevOwner = cell ? cell.owner : null;
                
                // Отнимаем у старого владельца
                if (prevOwner && players[prevOwner]) {
                    players[prevOwner].cells--;
                    if (cell.regionId && regions[cell.regionId]) regions[cell.regionId].cells--;
                }

                // Назначаем новому владельцу (присоединяем к его столичному региону)
                const newRegionId = `reg_${a.owner}_cap`;
                territory[cellKey] = { owner: a.owner, regionId: newRegionId };
                
                if (players[a.owner]) players[a.owner].cells++;
                if (regions[newRegionId]) regions[newRegionId].cells++;

                territoryChanged = true;
            }
        }
    }
    if (armiesMoved) io.emit('syncArmies', armies);
    if (territoryChanged) io.emit('syncTerritory', { territory, regions });
}, 1000 / 30);

server.listen(process.env.PORT || 3000, () => console.log('Сервер работает'));
