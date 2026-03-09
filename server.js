const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

// База данных сервера
let countries = {}; // Все страны в игре (в т.ч. оффлайн)
let playerSockets = {}; // Привязка socket.id -> countryId
let territory = {}; 
let armies = {}; 
let regions = {}; 

const TILE_SIZE = 5; 
const COLLISION_RADIUS = 4; // АРМИИ ТЕПЕРЬ МАЛЕНЬКИЕ (было 12)

let mapChangedForCauldrons = false; 

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
    // Отправляем лобби (существующие страны) при подключении
    socket.emit('initLobby', countries);
    socket.emit('initData', { countries, territory, armies, regions });

    socket.on('joinGame', (data) => {
        let cId;
        if (data.isNew) {
            cId = `c_${Math.random().toString(36).substr(2, 9)}`;
            countries[cId] = {
                id: cId, name: data.name, flag: data.flag, color: data.color,
                cells: 0, dollars: 10000, military: 5000, cap: 5000, isSpawned: false, online: true
            };
        } else {
            cId = data.countryId;
            if (countries[cId]) countries[cId].online = true;
        }
        
        playerSockets[socket.id] = cId;
        socket.emit('joinSuccess', cId);
        io.emit('initLobby', countries);
        io.emit('updateMap', { countries, territory, regions });
    });

    socket.on('spawnCapital', (data) => {
        const cId = playerSockets[socket.id]; if (!cId) return;
        const country = countries[cId];
        if (!country || country.isSpawned) return;

        country.isSpawned = true;
        const startRegionId = `reg_${cId}_cap`;
        regions[startRegionId] = { name: "Столичный регион", owner: cId, cells: 0, level: 1 };

        for(let dx = -6; dx <= 6; dx++) {
            for(let dy = -6; dy <= 6; dy++) {
                if(dx*dx + dy*dy <= 6*6) { 
                    const cellKey = `${data.x + dx}_${data.y + dy}`;
                    territory[cellKey] = { owner: cId, regionId: startRegionId };
                    country.cells++; regions[startRegionId].cells++;
                }
            }
        }
        mapChangedForCauldrons = true; 
        io.emit('updateMap', { countries, territory, regions });
    });

    socket.on('paintRegion', (data) => {
        const cId = playerSockets[socket.id]; if (!cId) return;
        const cellKey = `${data.x}_${data.y}`; const cell = territory[cellKey];
        if (cell && cell.owner === cId) {
            if (regions[cell.regionId]) regions[cell.regionId].cells--;
            cell.regionId = data.newRegionId;
            if (!regions[data.newRegionId]) {
                regions[data.newRegionId] = { name: `Регион ${Object.keys(regions).length + 1}`, owner: cId, cells: 0, level: 1 };
            }
            regions[data.newRegionId].cells++;
            io.emit('cellUpdate', { key: cellKey, cell: cell, regions: regions });
        }
    });

    socket.on('upgradeRegion', (regionId) => {
        const cId = playerSockets[socket.id]; if (!cId) return;
        const country = countries[cId]; const region = regions[regionId];
        if (country && region && region.owner === cId && region.level < 10) {
            const cost = region.cells * region.level * 50; 
            if (country.dollars >= cost) {
                country.dollars -= cost; region.level++;
                io.emit('syncTerritory', { territory, regions });
                io.emit('updateResources', countries);
            }
        }
    });

    socket.on('deployArmy', (data) => {
        const cId = playerSockets[socket.id]; if (!cId) return;
        const country = countries[cId];
        const amount = parseInt(data.amount); const center = calculateRegionCenter(data.regionId);
        
        if (country && center && amount > 0 && country.military >= amount) {
            country.military -= amount;
            const armyId = Math.random().toString(36).substr(2, 9);
            armies[armyId] = {
                id: armyId, owner: cId,
                x: center.x + (Math.random()*6 - 3), y: center.y + (Math.random()*6 - 3), 
                targetX: null, targetY: null, count: amount, speed: 0.25 
            };
            io.emit('syncArmies', armies); io.emit('updateResources', countries);
        }
    });

    socket.on('disbandArmies', (armyIds) => {
        const cId = playerSockets[socket.id]; if (!cId) return;
        armyIds.forEach(id => { if (armies[id] && armies[id].owner === cId) delete armies[id]; });
        io.emit('syncArmies', armies);
    });

    socket.on('moveArmies', (data) => {
        const cId = playerSockets[socket.id]; if (!cId) return;
        data.armyIds.forEach((id) => {
            if (armies[id] && armies[id].owner === cId) { armies[id].targetX = data.targetX; armies[id].targetY = data.targetY; }
        });
    });

    socket.on('disconnect', () => { 
        const cId = playerSockets[socket.id];
        if (cId && countries[cId]) {
            countries[cId].online = false; // СТРАНА ОСТАЕТСЯ, просто уходит в оффлайн!
            io.emit('initLobby', countries);
        }
        delete playerSockets[socket.id]; 
    });
});

// Экономика (Работает даже для Оффлайн стран!)
setInterval(() => {
    let changed = false;
    for (const id in countries) {
        if (countries[id].isSpawned) {
            countries[id].cap = 5000 + (countries[id].cells * 50); 
            let maintenance = 0;
            for(const aId in armies) { if(armies[aId].owner === id) maintenance += armies[aId].count * 0.1; }
            let regionsIncome = 0;
            for (const rId in regions) { if (regions[rId].owner === id) regionsIncome += regions[rId].cells * 1.5 * regions[rId].level; }
            
            const income = 100 + regionsIncome - maintenance;
            countries[id].dollars += income; countries[id].lastIncome = income; 
            if (countries[id].military < countries[id].cap) {
                countries[id].military += Math.floor(countries[id].cells * 1.5); 
                if (countries[id].military > countries[id].cap) countries[id].military = countries[id].cap;
            }
            changed = true;
        }
    }
    if (changed) io.emit('updateResources', countries);
}, 1000);

// ФИЗИКА И НОВАЯ БОЕВКА (ОКРУЖЕНИЯ)
setInterval(() => {
    let stateChanged = false;
    const armyKeys = Object.keys(armies);
    
    // Сброс целей
    for(const id in armies) { armies[id].inCombat = false; armies[id].engagedEnemies = []; armies[id].damageToTake = 0; }

    // 1. КОЛЛИЗИИ (Находим всех, кто соприкоснулся)
    for (let i = 0; i < armyKeys.length; i++) {
        for (let j = i + 1; j < armyKeys.length; j++) {
            let a = armies[armyKeys[i]]; let b = armies[armyKeys[j]];
            let dx = a.x - b.x; let dy = a.y - b.y; let dist = Math.hypot(dx, dy);

            if (dist < COLLISION_RADIUS) {
                if (a.owner !== b.owner) {
                    a.targetX = null; a.targetY = null; b.targetX = null; b.targetY = null;
                    a.engagedEnemies.push(b.id);
                    b.engagedEnemies.push(a.id);
                } else {
                    if (dist === 0) { dx = Math.random()-0.5; dy = Math.random()-0.5; dist = 1; }
                    let overlap = COLLISION_RADIUS - dist;
                    let pushFactor = 0.5; 
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
        if (a.engagedEnemies.length === 0 && a.targetX !== null && a.targetY !== null) {
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
                if (prevOwner && countries[prevOwner]) {
                    countries[prevOwner].cells--;
                    if (cell.regionId && regions[cell.regionId]) regions[cell.regionId].cells--;
                }
                const newRegionId = `reg_${a.owner}_cap`;
                territory[cellKey] = { owner: a.owner, regionId: newRegionId };
                if (countries[a.owner]) countries[a.owner].cells++;
                if (regions[newRegionId]) regions[newRegionId].cells++;
                io.emit('cellUpdate', { key: cellKey, cell: territory[cellKey], regions, countries });
                stateChanged = true; mapChangedForCauldrons = true; 
            }
        }
    }
    
    // 3. БОЕВАЯ МАТЕМАТИКА (Штраф за окружение!)
    for (const id in armies) {
        let a = armies[id];
        if (a.engagedEnemies.length > 0) {
            a.inCombat = true;
            let targetId = a.engagedEnemies[0]; // Атакуем первую цель
            let e = armies[targetId];
            if (e) {
                let baseDmg = a.count * 0.005;
                // ЗАКОН ЛАНЧЕСТЕРА: Если цель окружена несколькими нашими армиями, она получает +50% урона за каждую!
                let flankMult = 1 + (e.engagedEnemies.length - 1) * 0.5;
                e.damageToTake += baseDmg * flankMult;
            }
        }
    }

    // Применение урона
    for(const id in armies) {
        let a = armies[id];
        if (a.damageToTake > 0) { a.count -= a.damageToTake; stateChanged = true; }
        if (a.count <= 0) delete armies[id];
    }
    
    if (stateChanged) io.emit('syncArmies', armies);

    // --- (Код котлов и асинхронного сканера остается тем же, не менялся) ---
}, 1000 / 30);


// --- АЛГОРИТМ КОТЛОВ (БЕЗ ИЗМЕНЕНИЙ) ---
const gridW = Math.ceil(1920 / TILE_SIZE); const gridH = Math.ceil(1080 / TILE_SIZE);
const totalCells = gridW * gridH;
let visited = new Uint8Array(totalCells); let queueX = new Int32Array(totalCells); let queueY = new Int32Array(totalCells);
let scanX = 0, scanY = 0; let bfsActive = false; let bfsHead = 0, bfsTail = 0; let bfsTouchesEdge = false; let bfsSurroundingOwners = new Set(); let bfsComponent = [];
let fillQueue = []; 

setInterval(() => {
    if (fillQueue.length > 0) {
        let batchSize = Math.max(10, Math.floor(fillQueue.length / 30)); 
        let batch = fillQueue.splice(0, batchSize); let updatedCells = {};
        batch.forEach(c => {
            const key = `${c.x}_${c.y}`;
            if (!territory[key]) {
                territory[key] = { owner: c.owner, regionId: c.regId };
                updatedCells[key] = territory[key];
                if (countries[c.owner]) countries[c.owner].cells++;
                if (regions[c.regId]) regions[c.regId].cells++;
            }
        });
        if (Object.keys(updatedCells).length > 0) io.emit('batchCellUpdate', { cells: updatedCells, regions, countries });
    }

    if (mapChangedForCauldrons && fillQueue.length === 0) {
        if (bfsActive) {
            let iterations = 0;
            while (bfsHead < bfsTail && iterations < 2000) {
                let currX = queueX[bfsHead]; let currY = queueY[bfsHead]; bfsHead++; iterations++;
                bfsComponent.push({x: currX, y: currY});
                if (currX <= 0 || currX >= gridW-1 || currY <= 0 || currY >= gridH-1) bfsTouchesEdge = true;
                const dx = [1, -1, 0, 0]; const dy = [0, 0, 1, -1];
                for(let i = 0; i < 4; i++) {
                    let nx = currX + dx[i]; let ny = currY + dy[i];
                    if(nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
                        let t = territory[`${nx}_${ny}`];
                        if (t) { bfsSurroundingOwners.add(t.owner); } else {
                            let nIdx = ny * gridW + nx;
                            if (visited[nIdx] === 0) { visited[nIdx] = 1; queueX[bfsTail] = nx; queueY[bfsTail] = ny; bfsTail++; }
                        }
                    }
                }
            }
            if (bfsHead >= bfsTail) {
                bfsActive = false;
                if (!bfsTouchesEdge && bfsSurroundingOwners.size === 1) {
                    let winnerId = Array.from(bfsSurroundingOwners)[0]; let regId = `reg_${winnerId}_cap`;
                    if (!regions[regId]) { regions[regId] = { name: "Столичный", owner: winnerId, cells: 0, level: 1 }; }
                    bfsComponent.reverse();
                    for (let i = 0; i < bfsComponent.length; i++) fillQueue.push({x: bfsComponent[i].x, y: bfsComponent[i].y, owner: winnerId, regId: regId});
                }
            }
        } else {
            let cellsChecked = 0;
            while (cellsChecked < 2000) {
                let idx = scanY * gridW + scanX;
                if (!territory[`${scanX}_${scanY}`] && visited[idx] === 0) {
                    bfsActive = true; bfsHead = 0; bfsTail = 0;
                    queueX[bfsTail] = scanX; queueY[bfsTail] = scanY; bfsTail++;
                    visited[idx] = 1; bfsTouchesEdge = false;
                    bfsSurroundingOwners.clear(); bfsComponent = []; break; 
                }
                scanX++; cellsChecked++;
                if (scanX >= gridW) {
                    scanX = 0; scanY++;
                    if (scanY >= gridH) { scanY = 0; scanX = 0; mapChangedForCauldrons = false; visited.fill(0); break; }
                }
            }
        }
    }
}, 1000 / 30);

server.listen(process.env.PORT || 3000, () => console.log('Сервер работает'));
