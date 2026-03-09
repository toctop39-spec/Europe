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

const TILE_SIZE = 5; 

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

        for(let dx = -6; dx <= 6; dx++) {
            for(let dy = -6; dy <= 6; dy++) {
                if(dx*dx + dy*dy <= 6*6) { 
                    const cellKey = `${data.x + dx}_${data.y + dy}`;
                    territory[cellKey] = { owner: socket.id, regionId: startRegionId };
                    player.cells++;
                    regions[startRegionId].cells++;
                }
            }
        }
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
                count: amount, 
                speed: 0.25 
            };
            io.emit('syncArmies', armies);
            io.emit('updateResources', players);
        }
    });

    socket.on('disbandArmies', (armyIds) => {
        armyIds.forEach(id => {
            if (armies[id] && armies[id].owner === socket.id) {
                delete armies[id];
            }
        });
        io.emit('syncArmies', armies);
    });

    socket.on('moveArmies', (data) => {
        // ИСПРАВЛЕНИЕ: Аккуратное выстраивание армий вокруг точки без разброса и телепортаций
        data.armyIds.forEach((id, index) => {
            if (armies[id] && armies[id].owner === socket.id) {
                const offsetX = (index % 3) * 3 - 3; 
                const offsetY = Math.floor(index / 3) * 3 - 3;
                armies[id].targetX = data.targetX + offsetX;
                armies[id].targetY = data.targetY + offsetY;
            }
        });
    });

    socket.on('disconnect', () => { delete players[socket.id]; });
});

setInterval(() => {
    let changed = false;
    for (const id in players) {
        if (players[id].isSpawned) {
            players[id].cap = 5000 + (players[id].cells * 50); 
            
            let maintenance = 0;
            for(const aId in armies) {
                if(armies[aId].owner === id) maintenance += armies[aId].count * 0.1;
            }
            
            const income = 100 + (players[id].cells * 1.5) - maintenance;
            players[id].dollars += income; 
            players[id].lastIncome = income; 
            
            if (players[id].military < players[id].cap) {
                players[id].military += Math.floor(players[id].cells * 1.5); 
                if (players[id].military > players[id].cap) players[id].military = players[id].cap;
            }
            changed = true;
        }
    }
    if (changed) io.emit('updateResources', players);
}, 1000);

setInterval(() => {
    let stateChanged = false;

    for(const id in armies) armies[id].inCombat = false;

    for (const id in armies) {
        let a = armies[id];

        for(const enemyId in armies) {
            if(enemyId !== id && armies[enemyId].owner !== a.owner) {
                let e = armies[enemyId];
                if(Math.hypot(e.x - a.x, e.y - a.y) < 18) { 
                    a.targetX = null; a.targetY = null;
                    e.targetX = null; e.targetY = null;
                    a.inCombat = true; e.inCombat = true;
                    a.combatantId = enemyId;
                }
            }
        }

        if (!a.inCombat && a.targetX !== null && a.targetY !== null) {
            let dx = a.targetX - a.x;
            let dy = a.targetY - a.y;
            let distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > a.speed) {
                a.x += (dx / distance) * a.speed;
                a.y += (dy / distance) * a.speed;
                stateChanged = true;
            } else {
                // ИСПРАВЛЕНИЕ: Жесткая фиксация координат по прибытии (убирает прыжки)
                a.x = a.targetX; 
                a.y = a.targetY;
                a.targetX = null; 
                a.targetY = null;
                stateChanged = true;
            }

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
    
    for(const id in armies) {
        let a = armies[id];
        if(a.inCombat) {
            let e = armies[a.combatantId];
            if(e) {
                a.count -= e.count * 0.005; 
                e.count -= a.count * 0.005;
                stateChanged = true;
            }
        }
    }

    for(const id in armies) {
        if(armies[id].count <= 0) { delete armies[id]; continue; }
    }
    
    if (stateChanged) io.emit('syncArmies', armies);
}, 1000 / 30);

server.listen(process.env.PORT || 3000, () => console.log('Сервер работает'));
