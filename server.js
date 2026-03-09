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

// --- ПЕРЕМЕННЫЕ АСИНХРОННОГО СКАНЕРА ---
const gridW = Math.ceil(1920 / TILE_SIZE);
const gridH = Math.ceil(1080 / TILE_SIZE);
const totalCells = gridW * gridH;

let visited = new Uint8Array(totalCells);
let queueX = new Int32Array(totalCells);
let queueY = new Int32Array(totalCells);

let mapChangedForCauldrons = false; 
let scanX = 0, scanY = 0;
let bfsActive = false;
let bfsHead = 0, bfsTail = 0;
let bfsTouchesEdge = false;
let bfsSurroundingOwners = new Set();
let bfsComponent = [];

// Очередь для визуального "красивого" заполнения
let fillQueue = []; 

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
        regions[startRegionId] = { name: "Столичный регион", owner: socket.id, cells: 0, level: 1 };

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
        mapChangedForCauldrons = true; 
        io.emit('updateMap', { players, territory, regions });
    });

    socket.on('paintRegion', (data) => {
        const cellKey = `${data.x}_${data.y}`;
        const cell = territory[cellKey];
        if (cell && cell.owner === socket.id) {
            if (regions[cell.regionId]) regions[cell.regionId].cells--;
            cell.regionId = data.newRegionId;
            if (!regions[data.newRegionId]) {
                regions[data.newRegionId] = { name: `Регион ${Object.keys(regions).length + 1}`, owner: socket.id, cells: 0, level: 1 };
            }
            regions[data.newRegionId].cells++;
            io.emit('cellUpdate', { key: cellKey, cell: cell, regions: regions });
        }
    });

    socket.on('upgradeRegion', (regionId) => {
        const player = players[socket.id];
        const region = regions[regionId];
        if (player && region && region.owner === socket.id && region.level < 10) {
            const cost = region.cells * region.level * 50; 
            if (player.dollars >= cost) {
                player.dollars -= cost;
                region.level++;
                io.emit('syncTerritory', { territory, regions });
                io.emit('updateResources', players);
            }
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
                x: center.x + (Math.random()*10 - 5), y: center.y + (Math.random()*10 - 5), 
                targetX: null, targetY: null,
                count: amount, speed: 0.25 
            };
            io.emit('syncArmies', armies);
            io.emit('updateResources', players);
        }
    });

    socket.on('disbandArmies', (armyIds) => {
        armyIds.forEach(id => { if (armies[id] && armies[id].owner === socket.id) delete armies[id]; });
        io.emit('syncArmies', armies);
    });

    socket.on('moveArmies', (data) => {
        data.armyIds.forEach((id) => {
            if (armies[id] && armies[id].owner === socket.id) {
                armies[id].targetX = data.targetX; armies[id].targetY = data.targetY;
            }
        });
    });

    socket.on('disconnect', () => { delete players[socket.id]; });
});

// Экономика
setInterval(() => {
    let changed = false;
    for (const id in players) {
        if (players[id].isSpawned) {
            players[id].cap = 5000 + (players[id].cells * 50); 
            let maintenance = 0;
            for(const aId in armies) { if(armies[aId].owner === id) maintenance += armies[aId].count * 0.1; }
            
            let regionsIncome = 0;
            for (const rId in regions) {
                if (regions[rId].owner === id) regionsIncome += regions[rId].cells * 1.5 * regions[rId].level;
            }
            
            const income = 100 + regionsIncome - maintenance;
            players[id].dollars += income; players[id].lastIncome = income; 
            if (players[id].military < players[id].cap) {
                players[id].military += Math.floor(players[id].cells * 1.5); 
                if (players[id].military > players[id].cap) players[id].military = players[id].cap;
            }
            changed = true;
        }
    }
    if (changed) io.emit('updateResources', players);
}, 1000);

// --- ГЛАВНЫЙ ИГРОВОЙ ЦИКЛ (30 FPS) ---
setInterval(() => {
    let stateChanged = false;
    const armyKeys = Object.keys(armies);
    for(const id in armies) armies[id].inCombat = false;

    // 1. КОЛЛИЗИИ
    for (let i = 0; i < armyKeys.length; i++) {
        for (let j = i + 1; j < armyKeys.length; j++) {
            let a = armies[armyKeys[i]]; let b = armies[armyKeys[j]];
            let dx = a.x - b.x; let dy = a.y - b.y; let dist = Math.hypot(dx, dy);
            const COLLISION_RADIUS = 12; 

            if (dist < COLLISION_RADIUS) {
                if (a.owner !== b.owner) {
                    a.targetX = null; a.targetY = null; b.targetX = null; b.targetY = null;
                    a.inCombat = true; b.inCombat = true;
                    a.combatantId = b.id; b.combatantId = a.id;
                } else {
                    if (dist === 0) { dx = Math.random()-0.5; dy = Math.random()-0.5; dist = 1; }
                    let overlap = COLLISION_RADIUS - dist;
                    let pushFactor = 0.2; 
                    let pushX = (dx / dist) * overlap * pushFactor; let pushY = (dy / dist) * overlap * pushFactor;
                    a.x += pushX; a.y += pushY; b.x -= pushX; b.y -= pushY;
                    stateChanged = true;
                }
            }
        }
    }

    // 2. ДВИЖЕНИЕ И ЗАХВАТ
    for (const id in armies) {
        let a = armies[id];
        if (!a.inCombat && a.targetX !== null && a.targetY !== null) {
            let dx = a.targetX - a.x; let dy = a.targetY - a.y; let distance = Math.hypot(dx, dy);
            
            if (distance > a.speed) {
                a.x += (dx / distance) * a.speed; a.y += (dy / distance) * a.speed; stateChanged = true;
            } else {
                a.targetX = null; a.targetY = null; stateChanged = true;
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
                io.emit('cellUpdate', { key: cellKey, cell: territory[cellKey], regions, players });
                stateChanged = true;
                mapChangedForCauldrons = true; 
            }
        }
    }
    
    // 3. УРОН
    for(const id in armies) {
        let a = armies[id];
        if(a.inCombat && armies[a.combatantId]) {
            let e = armies[a.combatantId];
            a.count -= e.count * 0.005; e.count -= a.count * 0.005;
            stateChanged = true;
        }
    }
    for(const id in armies) { if(armies[id].count <= 0) delete armies[id]; }
    if (stateChanged) io.emit('syncArmies', armies);

    // --- 4. КРАСИВОЕ ВИЗУАЛЬНОЕ ЗАПОЛНЕНИЕ КОТЛОВ ---
    if (fillQueue.length > 0) {
        // Закрашиваем динамически: чтобы большой котел закрасился за ~1 секунду
        let batchSize = Math.max(10, Math.floor(fillQueue.length / 30)); 
        let batch = fillQueue.splice(0, batchSize);
        let updatedCells = {};
        
        batch.forEach(c => {
            const key = `${c.x}_${c.y}`;
            if (!territory[key]) {
                territory[key] = { owner: c.owner, regionId: c.regId };
                updatedCells[key] = territory[key];
                if (players[c.owner]) players[c.owner].cells++;
                if (regions[c.regId]) regions[c.regId].cells++;
            }
        });
        
        // Отправляем пачкой, чтобы клиент не лагал от перерисовок
        if (Object.keys(updatedCells).length > 0) {
            io.emit('batchCellUpdate', { cells: updatedCells, regions, players });
        }
    }

    // --- 5. АСИНХРОННЫЙ СКАНЕР (БЕЗ ФРИЗОВ) ---
    // Работает только если карта менялась и нет активной заливки
    if (mapChangedForCauldrons && fillQueue.length === 0) {
        
        // Если заливка активна (нашли пустоту)
        if (bfsActive) {
            let iterations = 0;
            // Делаем не больше 2000 шагов за кадр (никогда не повесит сервер)
            while (bfsHead < bfsTail && iterations < 2000) {
                let currX = queueX[bfsHead];
                let currY = queueY[bfsHead];
                bfsHead++; iterations++;

                bfsComponent.push({x: currX, y: currY});

                if (currX <= 0 || currX >= gridW-1 || currY <= 0 || currY >= gridH-1) bfsTouchesEdge = true;

                const dx = [1, -1, 0, 0]; const dy = [0, 0, 1, -1];
                for(let i = 0; i < 4; i++) {
                    let nx = currX + dx[i]; let ny = currY + dy[i];
                    if(nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
                        let t = territory[`${nx}_${ny}`];
                        if (t) {
                            bfsSurroundingOwners.add(t.owner);
                        } else {
                            let nIdx = ny * gridW + nx;
                            if (visited[nIdx] === 0) {
                                visited[nIdx] = 1;
                                queueX[bfsTail] = nx; queueY[bfsTail] = ny; bfsTail++;
                            }
                        }
                    }
                }
            }

            if (bfsHead >= bfsTail) {
                // Завершили проверку одного куска
                bfsActive = false;
                if (!bfsTouchesEdge && bfsSurroundingOwners.size === 1) {
                    let winnerId = Array.from(bfsSurroundingOwners)[0];
                    let regId = `reg_${winnerId}_cap`;
                    if (!regions[regId]) { regions[regId] = { name: "Столичный", owner: winnerId, cells: 0, level: 1 }; }
                    
                    // Реверс массива! Котел начнет закрашиваться от краев к центру (стягиваться)
                    bfsComponent.reverse();
                    for (let i = 0; i < bfsComponent.length; i++) {
                        fillQueue.push({x: bfsComponent[i].x, y: bfsComponent[i].y, owner: winnerId, regId: regId});
                    }
                }
            }
        } else {
            // Если ищем новую пустоту - сканируем 2000 клеток за кадр
            let cellsChecked = 0;
            while (cellsChecked < 2000) {
                let idx = scanY * gridW + scanX;
                if (!territory[`${scanX}_${scanY}`] && visited[idx] === 0) {
                    bfsActive = true; bfsHead = 0; bfsTail = 0;
                    queueX[bfsTail] = scanX; queueY[bfsTail] = scanY; bfsTail++;
                    visited[idx] = 1; bfsTouchesEdge = false;
                    bfsSurroundingOwners.clear(); bfsComponent = [];
                    break; // Нашли пустоту, выходим, начнем заливку в следующем кадре
                }
                
                scanX++; cellsChecked++;
                if (scanX >= gridW) {
                    scanX = 0; scanY++;
                    if (scanY >= gridH) {
                        // Обошли всю карту! Сбрасываем.
                        scanY = 0; scanX = 0;
                        mapChangedForCauldrons = false; 
                        visited.fill(0); 
                        break;
                    }
                }
            }
        }
    }
}, 1000 / 30);

server.listen(process.env.PORT || 3000, () => console.log('Сервер работает'));
