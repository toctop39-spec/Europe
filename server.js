const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

const rooms = {}; 
const presets = {}; 
let playerToRoom = {}; 

const WORLD_WIDTH = 1920; 
const WORLD_HEIGHT = 1080;
const TILE_SIZE = 5; 

const ENGAGE_RADIUS = 10; 
const COLLISION_RADIUS = 2; 

function createRoom(roomId, presetData = null) {
    let room = {
        id: roomId,
        countries: {}, territory: {}, armies: {}, regions: {},
        pendingDeployments: [], batchedCellUpdates: {},
        mapChangedForCauldrons: false, fillQ: [],
        sX: 0, sY: 0,
        vstd: new Uint8Array((WORLD_WIDTH / TILE_SIZE) * (WORLD_HEIGHT / TILE_SIZE)),
        qX: new Int32Array((WORLD_WIDTH / TILE_SIZE) * (WORLD_HEIGHT / TILE_SIZE)),
        qY: new Int32Array((WORLD_WIDTH / TILE_SIZE) * (WORLD_HEIGHT / TILE_SIZE))
    };
    if (presetData) {
        room.countries = JSON.parse(JSON.stringify(presetData.countries));
        room.territory = JSON.parse(JSON.stringify(presetData.territory));
        room.regions = JSON.parse(JSON.stringify(presetData.regions));
        // Фикс для старых пресетов: добавляем core
        for(let k in room.territory) {
            if (!room.territory[k].core) room.territory[k].core = room.territory[k].owner;
        }
    }
    rooms[roomId] = room; return room;
}

createRoom('MAIN');

// ФУНКЦИЯ ПРОВЕРКИ АННЕКСИИ
function checkCountryDeath(room, cId, roomId) {
    if (cId && room.countries[cId] && room.countries[cId].cells <= 0) {
        // Страна уничтожена! Ассимилируем все оккупированные ею земли (меняем core)
        for (let k in room.territory) {
            if (room.territory[k].core === cId) {
                room.territory[k].core = room.territory[k].owner; // Становится исконной территорией захватчика
                room.batchedCellUpdates[k] = room.territory[k];
            }
        }
        io.to(roomId).emit('newsEvent', `🏳️ ${room.countries[cId].name} капитулировала! Все земли аннексированы.`);
    }
}

io.on('connection', (socket) => {
    socket.on('joinRoom', (roomId, callback) => {
        if (!rooms[roomId]) return callback({ success: false, msg: "Комната не найдена" });
        socket.join(roomId); playerToRoom[socket.id] = roomId; callback({ success: true });
        socket.emit('initLobby', rooms[roomId].countries);
        socket.emit('initData', { countries: rooms[roomId].countries, territory: rooms[roomId].territory, armies: rooms[roomId].armies, regions: rooms[roomId].regions });
    });

    socket.on('createRoom', (data, callback) => {
        const newCode = Math.random().toString(36).substr(2, 5).toUpperCase();
        createRoom(newCode, data.presetName ? presets[data.presetName] : null);
        socket.join(newCode); playerToRoom[socket.id] = newCode; callback({ success: true, roomId: newCode });
        socket.emit('initLobby', rooms[newCode].countries);
        socket.emit('initData', { countries: rooms[newCode].countries, territory: rooms[newCode].territory, armies: rooms[newCode].armies, regions: rooms[newCode].regions });
    });

    socket.on('savePreset', (presetName) => {
        const roomId = playerToRoom[socket.id]; if (!roomId || !rooms[roomId]) return;
        let savedCountries = JSON.parse(JSON.stringify(rooms[roomId].countries));
        for(let k in savedCountries) { savedCountries[k].socketId = null; savedCountries[k].online = false; }
        presets[presetName] = { countries: savedCountries, territory: JSON.parse(JSON.stringify(rooms[roomId].territory)), regions: JSON.parse(JSON.stringify(rooms[roomId].regions)) };
        socket.emit('presetSaved');
    });

    socket.on('joinGame', (data) => {
        const roomId = playerToRoom[socket.id] || 'MAIN'; if (!rooms[roomId]) return; const room = rooms[roomId];
        for (let k in room.countries) { if (room.countries[k].socketId === socket.id) room.countries[k].socketId = null; }
        let cId = data.isNew ? `c_${Math.random().toString(36).substr(2, 9)}` : data.countryId;
        if (data.isNew) {
            room.countries[cId] = { id: cId, name: data.name, flag: data.flag, color: data.color, socketId: socket.id, cells: 0, dollars: 10000, population: 100000, military: 10000, cap: 10000, isSpawned: false, online: true };
            io.to(roomId).emit('newsEvent', `🌍 Новая нация "${data.name}" появилась на карте!`);
        } else if (room.countries[cId]) { room.countries[cId].online = true; room.countries[cId].socketId = socket.id; }
        socket.emit('joinSuccess', cId); io.to(roomId).emit('initLobby', room.countries); io.to(roomId).emit('updateMap', { countries: room.countries, territory: room.territory, regions: room.regions });
    });

    socket.on('switchCountry', (cId) => {
        const roomId = playerToRoom[socket.id]; if (!roomId || !rooms[roomId]) return; const room = rooms[roomId];
        if (room.countries[cId]) {
            for (let k in room.countries) if (room.countries[k].socketId === socket.id) room.countries[k].socketId = null;
            room.countries[cId].socketId = socket.id; socket.emit('joinSuccess', cId);
            io.to(roomId).emit('updateMap', { countries: room.countries, territory: room.territory, regions: room.regions });
        }
    });

    socket.on('spawnCapital', (data) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        const country = room.countries[cId]; if (!country || country.isSpawned) return;

        country.isSpawned = true;
        const startRegionId = `reg_${cId}_cap`;
        room.regions[startRegionId] = { name: "Столичный округ", owner: cId, cells: 0, level: 1, cityX: data.x, cityY: data.y };

        for(let dx = -6; dx <= 6; dx++) {
            for(let dy = -6; dy <= 6; dy++) {
                if(dx*dx + dy*dy <= 36) { 
                    const cx = data.x + dx; const cy = data.y + dy;
                    if (cx >= 0 && cx < WORLD_WIDTH/TILE_SIZE && cy >= 0 && cy < WORLD_HEIGHT/TILE_SIZE) {
                        const key = `${cx}_${cy}`; 
                        // CORE УСТАНАВЛИВАЕТСЯ ПРИ СПАВНЕ
                        room.territory[key] = { owner: cId, core: cId, regionId: startRegionId };
                        country.cells++; room.regions[startRegionId].cells++;
                    }
                }
            }
        }
        room.mapChangedForCauldrons = true;
        io.to(roomId).emit('newsEvent', `🏛️ ${country.name} основывает столицу!`);
        io.to(roomId).emit('updateMap', { countries: room.countries, territory: room.territory, regions: room.regions });
    });

    socket.on('lassoRegion', (data) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        if (!cId || !data.tiles.length) return;
        let ownedTiles = []; data.tiles.forEach(key => { if (room.territory[key] && room.territory[key].owner === cId) ownedTiles.push(key); });
        if (ownedTiles.length === 0) return; 

        if (!room.regions[data.newRegionId]) {
            let sumX = 0, sumY = 0;
            ownedTiles.forEach(key => { const [x, y] = key.split('_').map(Number); sumX += x; sumY += y; });
            const avgX = Math.floor(sumX / ownedTiles.length); const avgY = Math.floor(sumY / ownedTiles.length);
            let bestKey = ownedTiles[0]; let minDist = Infinity;
            ownedTiles.forEach(key => { const [x, y] = key.split('_').map(Number); const d = Math.hypot(x - avgX, y - avgY); if (d < minDist) { minDist = d; bestKey = key; } });
            const [fX, fY] = bestKey.split('_').map(Number);
            room.regions[data.newRegionId] = { name: data.name, owner: cId, cells: 0, level: 1, cityX: fX, cityY: fY };
        }

        ownedTiles.forEach(key => {
            const cell = room.territory[key];
            if (room.regions[cell.regionId]) room.regions[cell.regionId].cells--;
            cell.regionId = data.newRegionId; room.regions[data.newRegionId].cells++;
        });
        io.to(roomId).emit('syncTerritory', { territory: room.territory, regions: room.regions });
    });

    socket.on('renameRegion', (data) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        const reg = room.regions[data.regionId];
        if (reg && reg.owner === cId && data.newName) { reg.name = data.newName.substring(0, 20); io.to(roomId).emit('syncTerritory', { territory: room.territory, regions: room.regions }); }
    });

    socket.on('upgradeRegion', (regionId) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        const reg = room.regions[regionId];
        if (reg && reg.owner === cId && reg.level < 10) {
            const cost = reg.level * 5000;
            if (room.countries[cId].dollars >= cost) { 
                room.countries[cId].dollars -= cost; 
                reg.level++; 
                io.to(roomId).emit('syncTerritory', { territory: room.territory, regions: room.regions }); 
                io.to(roomId).emit('updateResources', room.countries); 
            }
        }
    });

    socket.on('deployArmy', (data) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        const reg = room.regions[data.regionId];
        
        if (reg && reg.owner === cId && room.countries[cId].military >= data.amount) {
            // ПРОВЕРКА НА ОККУПАЦИЮ (Нельзя спавнить на свежезахваченной территории)
            let cityCell = room.territory[`${reg.cityX}_${reg.cityY}`];
            if (cityCell && cityCell.core !== cId) {
                if (room.countries[cityCell.core] && room.countries[cityCell.core].cells > 0) {
                    return; // Враг жив, территория оккупирована
                }
            }

            room.countries[cId].military -= data.amount;
            room.pendingDeployments.push({ owner: cId, amount: parseInt(data.amount), regionId: data.regionId, readyAt: Date.now() + 5000 });
            io.to(roomId).emit('updateResources', room.countries);
        }
    });

    socket.on('disbandArmies', (armyIds) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        if (!Array.isArray(armyIds)) return;
        let stateChanged = false;
        armyIds.forEach(armyId => {
            if (room.armies[armyId] && room.armies[armyId].owner === cId) {
                room.countries[cId].military += Math.floor(room.armies[armyId].count); 
                delete room.armies[armyId]; 
                stateChanged = true;
            }
        });
        if (stateChanged) {
            io.to(roomId).emit('syncArmies', room.armies); 
            io.to(roomId).emit('updateResources', room.countries);
        }
    });

    socket.on('moveArmies', (data) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        data.armyIds.forEach(id => {
            if (room.armies[id] && room.armies[id].owner === cId) {
                room.armies[id].targetX = Math.max(5, Math.min(WORLD_WIDTH - 5, data.targetX)); 
                room.armies[id].targetY = Math.max(5, Math.min(WORLD_HEIGHT - 5, data.targetY));
                room.armies[id].autoTarget = null;
            }
        });
    });

    socket.on('autoAttack', (data) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        if (!data.armyIds || !Array.isArray(data.armyIds)) return;
        
        data.armyIds.forEach(aId => {
            if (room.armies[aId] && room.armies[aId].owner === cId) {
                room.armies[aId].autoTarget = data.targetCountry;
                room.armies[aId].targetX = null; room.armies[aId].targetY = null;
            }
        });
    });
    
    socket.on('disconnect', () => { delete playerToRoom[socket.id]; });
});

setInterval(() => {
    for (let roomId in rooms) {
        let room = rooms[roomId];
        if (Object.keys(room.batchedCellUpdates).length > 0) {
            io.to(roomId).emit('batchCellUpdate', { cells: room.batchedCellUpdates, regions: room.regions, countries: room.countries });
            room.batchedCellUpdates = {}; 
        }
    }
}, 200);

setInterval(() => {
    for (let roomId in rooms) {
        let room = rooms[roomId];
        let enemyData = {};
        let activeTargets = new Set();
        for (let aId in room.armies) if (room.armies[aId].autoTarget) activeTargets.add(room.armies[aId].autoTarget);
        
        if (activeTargets.size > 0) {
            for (let t of activeTargets) enemyData[t] = { armies: [], cities: [], tiles: [] };
            for (let eId in room.armies) {
                let e = room.armies[eId];
                if (enemyData[e.owner]) enemyData[e.owner].armies.push({x: e.x, y: e.y});
            }
            for (let rId in room.regions) {
                let r = room.regions[rId];
                if (enemyData[r.owner] && r.cityX !== undefined) {
                    enemyData[r.owner].cities.push({x: r.cityX * TILE_SIZE, y: r.cityY * TILE_SIZE});
                }
            }
            for (let key in room.territory) {
                let owner = room.territory[key].owner;
                if (enemyData[owner]) {
                    let splitIdx = key.indexOf('_');
                    enemyData[owner].tiles.push({
                        x: Number(key.slice(0, splitIdx)) * TILE_SIZE, 
                        y: Number(key.slice(splitIdx + 1)) * TILE_SIZE
                    });
                }
            }
        }

        for (let aId in room.armies) {
            let a = room.armies[aId];
            if (a.autoTarget) {
                let data = enemyData[a.autoTarget];
                if (!data || (data.armies.length === 0 && data.cities.length === 0 && data.tiles.length === 0)) {
                    a.autoTarget = null; continue;
                }
                let bestTarget = null; let bestDist = Infinity;
                if (data.armies.length > 0) {
                    for (let pt of data.armies) { let d = Math.hypot(a.x - pt.x, a.y - pt.y); if (d < bestDist) { bestDist = d; bestTarget = pt; } }
                } else if (data.cities.length > 0) {
                    for (let pt of data.cities) { let d = Math.hypot(a.x - pt.x, a.y - pt.y); if (d < bestDist) { bestDist = d; bestTarget = pt; } }
                } else {
                    let sampleCount = Math.min(100, data.tiles.length);
                    for (let i = 0; i < sampleCount; i++) {
                        let idx = Math.floor(Math.random() * data.tiles.length);
                        let pt = data.tiles[idx];
                        let d = Math.hypot(a.x - pt.x, a.y - pt.y);
                        if (d < bestDist) { bestDist = d; bestTarget = pt; }
                    }
                }
                if (bestTarget) { a.targetX = bestTarget.x + (Math.random() * 10 - 5); a.targetY = bestTarget.y + (Math.random() * 10 - 5); }
            }
        }
    }
}, 1000);

setInterval(() => {
    const now = Date.now();
    for (let roomId in rooms) {
        let room = rooms[roomId]; let stateChanged = false;

        for (let i = room.pendingDeployments.length - 1; i >= 0; i--) {
            const dep = room.pendingDeployments[i];
            if (now >= dep.readyAt) {
                const reg = room.regions[dep.regionId];
                if (reg && reg.owner === dep.owner) {
                    const id = `a_${Math.random().toString(36).substr(2, 9)}`;
                    const speed = Math.max(0.025, 0.1 - (dep.amount / 200000));
                    room.armies[id] = { id, owner: dep.owner, count: dep.amount, x: reg.cityX*TILE_SIZE, y: reg.cityY*TILE_SIZE, targetX: null, targetY: null, speed: speed, autoTarget: null };
                    stateChanged = true;
                } else { if (room.countries[dep.owner]) room.countries[dep.owner].military += dep.amount; }
                room.pendingDeployments.splice(i, 1); io.to(roomId).emit('updateResources', room.countries);
            }
        }

        const armyIds = Object.keys(room.armies);
        armyIds.forEach(id => { room.armies[id].targets = []; room.armies[id].dmg = 0; });

        for (let i = 0; i < armyIds.length; i++) {
            const a = room.armies[armyIds[i]];
            for (let j = i + 1; j < armyIds.length; j++) {
                const b = room.armies[armyIds[j]]; const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d < COLLISION_RADIUS * 2) {
                    if (a.owner !== b.owner) { a.targets.push(b.id); b.targets.push(a.id); } 
                    else { const p = (COLLISION_RADIUS * 2 - d) * 0.5; const ang = Math.atan2(a.y-b.y, a.x-b.x); a.x += Math.cos(ang)*p; a.y += Math.sin(ang)*p; b.x -= Math.cos(ang)*p; b.y -= Math.sin(ang)*p; stateChanged = true; }
                } else if (d < ENGAGE_RADIUS && a.owner !== b.owner) {
                    a.targets.push(b.id); b.targets.push(a.id); 
                }
            }
        }

        let cityCells = {};
        for (let rId in room.regions) {
            if (room.regions[rId].cityX !== undefined) {
                cityCells[`${room.regions[rId].cityX}_${room.regions[rId].cityY}`] = rId;
            }
        }

        armyIds.forEach(id => {
            const a = room.armies[id];
            
            // --- УСКОРЕНИЕ ОТ ДОРОГ ---
            let speedMult = 1;
            const cellX = Math.floor(a.x/TILE_SIZE); const cellY = Math.floor(a.y/TILE_SIZE);
            const cellCenter = room.territory[`${cellX}_${cellY}`];
            if (cellCenter && room.regions[cellCenter.regionId]) {
                const reg = room.regions[cellCenter.regionId];
                if (reg.owner === a.owner) {
                    speedMult = 1 + (reg.level * 0.07); // До +70% на 10 уровне
                }
            }

            if (!a.targets.length && a.targetX !== null) {
                const d = Math.hypot(a.targetX - a.x, a.targetY - a.y);
                const actualSpeed = a.speed * speedMult;
                if (d > actualSpeed) { a.x += ((a.targetX-a.x)/d)*actualSpeed; a.y += ((a.targetY-a.y)/d)*actualSpeed; stateChanged = true; } 
                else { a.targetX = null; }
            }
            
            const brushR = Math.max(0, Math.min(4, Math.floor(Math.sqrt(a.count) / 40))); 
            
            for(let dx = -brushR; dx <= brushR; dx++) {
                for(let dy = -brushR; dy <= brushR; dy++) {
                    if(dx*dx + dy*dy <= brushR*brushR || brushR === 0) {
                        const cx = cellX + dx; const cy = cellY + dy;
                        if(cx < 0 || cx >= WORLD_WIDTH/TILE_SIZE || cy < 0 || cy >= WORLD_HEIGHT/TILE_SIZE) continue;
                        const cellKey = `${cx}_${cy}`; 
                        
                        // Захват города
                        if (cityCells[cellKey]) {
                            let rId = cityCells[cellKey]; let reg = room.regions[rId];
                            if (reg && reg.owner !== a.owner && reg.owner !== null) {
                                let oldOwner = reg.owner; reg.owner = a.owner;
                                let deathChecks = new Set();
                                for (let tKey in room.territory) {
                                    if (room.territory[tKey].regionId === rId) {
                                        let tOldOwner = room.territory[tKey].owner;
                                        if (room.countries[tOldOwner]) {
                                            room.countries[tOldOwner].cells--;
                                            deathChecks.add(tOldOwner);
                                        }
                                        room.territory[tKey].owner = a.owner;
                                        if (!room.territory[tKey].core) room.territory[tKey].core = tOldOwner; // Сохраняем исконного владельца
                                        if (room.countries[a.owner]) room.countries[a.owner].cells++;
                                        room.batchedCellUpdates[tKey] = room.territory[tKey];
                                    }
                                }
                                io.to(roomId).emit('newsEvent', `🚩 Город взят! ${reg.name} оккупирован войсками ${room.countries[a.owner]?.name}!`);
                                room.mapChangedForCauldrons = true;
                                deathChecks.forEach(dId => checkCountryDeath(room, dId, roomId));
                            }
                        }

                        // Обычный захват клетки
                        const cell = room.territory[cellKey];
                        if (!cell || cell.owner !== a.owner) {
                            const oldOwner = cell ? cell.owner : null;
                            const oldCore = cell && cell.core ? cell.core : (oldOwner ? oldOwner : a.owner);
                            
                            if (oldOwner && room.countries[oldOwner]) {
                                room.countries[oldOwner].cells--;
                            }
                            if (cell && cell.regionId && room.regions[cell.regionId]) room.regions[cell.regionId].cells--;
                            
                            const newRegId = `reg_${a.owner}_cap`;
                            room.territory[cellKey] = { owner: a.owner, core: oldCore, regionId: newRegId }; // Захватываем, но Core остается вражеским
                            if (room.countries[a.owner]) room.countries[a.owner].cells++;
                            if (room.regions[newRegId]) room.regions[newRegId].cells++;
                            room.batchedCellUpdates[cellKey] = room.territory[cellKey];
                            room.mapChangedForCauldrons = true;
                            
                            if (oldOwner) checkCountryDeath(room, oldOwner, roomId);
                        }
                    }
                }
            }
        });

        armyIds.forEach(id => {
            const a = room.armies[id];
            if (a.targets.length) { 
                let dmgToDeal = (a.count * 0.0075) / a.targets.length; 
                a.targets.forEach(tId => {
                    const t = room.armies[tId];
                    if (t) t.dmg += dmgToDeal * (1 + (t.targets.length - 1) * 0.2); 
                });
            }
        });

        armyIds.forEach(id => {
            if (room.armies[id].dmg > 0) { room.armies[id].count -= room.armies[id].dmg; stateChanged = true; }
            if (room.armies[id].count <= 0) {
                if (room.countries[room.armies[id].owner]) io.to(roomId).emit('newsEvent', `💀 Дивизия ${room.countries[room.armies[id].owner].name} уничтожена!`);
                delete room.armies[id];
            }
        });

        if (stateChanged) io.to(roomId).emit('syncArmies', room.armies);
    }
}, 33);

const gridW = WORLD_WIDTH / TILE_SIZE; const gridH = WORLD_HEIGHT / TILE_SIZE;

setInterval(() => {
    for (let roomId in rooms) {
        let room = rooms[roomId];
        if (room.fillQ.length) {
            let btch = room.fillQ.splice(0, Math.max(20, Math.floor(room.fillQ.length/20)));
            let deathChecks = new Set();
            btch.forEach(c => {
                const k = `${c.x}_${c.y}`; 
                const oldCell = room.territory[k];
                const oldOwner = oldCell ? oldCell.owner : null;
                const oldCore = oldCell && oldCell.core ? oldCell.core : (oldOwner ? oldOwner : c.owner);
                
                if (oldOwner !== c.owner) {
                    if (oldOwner && room.countries[oldOwner]) {
                        room.countries[oldOwner].cells--;
                        deathChecks.add(oldOwner);
                    }
                    if (oldCell && room.regions[oldCell.regionId]) room.regions[oldCell.regionId].cells--;
                    room.territory[k] = { owner: c.owner, core: oldCore, regionId: c.regId };
                    if (room.countries[c.owner]) room.countries[c.owner].cells++;
                    if (room.regions[c.regId]) room.regions[c.regId].cells++;
                    room.batchedCellUpdates[k] = room.territory[k]; 
                }
            });
            deathChecks.forEach(dId => checkCountryDeath(room, dId, roomId));
            continue;
        }
        
        if (!room.mapChangedForCauldrons) continue;
        let armyLocs = {}; for(let id in room.armies) { let k = `${Math.floor(room.armies[id].x/TILE_SIZE)}_${Math.floor(room.armies[id].y/TILE_SIZE)}`; if(!armyLocs[k]) armyLocs[k] = []; armyLocs[k].push(room.armies[id].owner); }
        
        let checked = 0; let totalOwnedCells = 0;
        for (let c in room.countries) { if(room.countries[c].isSpawned) totalOwnedCells += room.countries[c].cells; }

        while (checked < 3000) {
            let idx = room.sY * gridW + room.sX;
            if (room.vstd[idx] === 0) {
                const startOwner = room.territory[`${room.sX}_${room.sY}`] ? room.territory[`${room.sX}_${room.sY}`].owner : null;
                if (startOwner === null && totalOwnedCells < 40) {
                    room.vstd[idx] = 1; room.sX++; checked++; 
                    if (room.sX >= gridW) { room.sX = 0; room.sY++; if (room.sY >= gridH) { room.sY = 0; room.mapChangedForCauldrons = false; room.vstd.fill(0); break; } }
                    continue;
                }

                let h = 0, t = 0, edge = false, owners = new Set(), comp = []; let hasDefendingArmy = false;
                room.qX[t] = room.sX; room.qY[t] = room.sY; t++; room.vstd[idx] = 1;
                
                while(h < t) {
                    let cx = room.qX[h]; let cy = room.qY[h]; h++; comp.push({x: cx, y: cy});
                    if (comp.length > 500) edge = true; 
                    if (cx <= 0 || cx >= gridW-1 || cy <= 0 || cy >= gridH-1) edge = true;
                    if (startOwner !== null && armyLocs[`${cx}_${cy}`] && armyLocs[`${cx}_${cy}`].includes(startOwner)) hasDefendingArmy = true;
                    
                    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx, dy]) => {
                        let nx = cx + dx, ny = cy + dy;
                        if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
                            let nKey = `${nx}_${ny}`; let nOwn = room.territory[nKey] ? room.territory[nKey].owner : null;
                            if (nOwn === startOwner) { 
                                let nIdx = ny * gridW + nx; if (room.vstd[nIdx] === 0) { room.vstd[nIdx] = 1; room.qX[t] = nx; room.qY[t] = ny; t++; }
                            } else { owners.add(nOwn === null ? 'neutral' : nOwn); }
                        }
                    });
                }
                if (!edge && owners.size === 1 && !hasDefendingArmy) {
                    let winId = Array.from(owners)[0];
                    if (winId !== startOwner && winId !== 'neutral') { 
                        let rId = `reg_${winId}_cap`; if (!room.regions[rId]) room.regions[rId] = { name: "Столица", owner: winId, cells: 0, level: 1 };
                        comp.reverse().forEach(c => room.fillQ.push({...c, owner: winId, regId: rId})); 
                        if (startOwner) io.to(roomId).emit('newsEvent', `⚔️ Окружение! Войска ${room.countries[winId] ? room.countries[winId].name : 'врага'} замкнули котел!`);
                        break;
                    }
                }
            }
            room.sX++; checked++;
            if (room.sX >= gridW) { room.sX = 0; room.sY++; if (room.sY >= gridH) { room.sY = 0; room.mapChangedForCauldrons = false; room.vstd.fill(0); break; } }
        }
    }
}, 50);

setInterval(() => {
    for (let roomId in rooms) {
        let room = rooms[roomId]; let changed = false;
        for (let id in room.countries) {
            if (!room.countries[id].isSpawned) continue;
            const popGrowth = Math.floor(room.countries[id].cells * 0.5); room.countries[id].population += popGrowth;
            room.countries[id].cap = Math.floor(room.countries[id].population * 0.1);
            let main = 0; for (let a in room.armies) if (room.armies[a].owner === id) main += room.armies[a].count * 1; 
            let inc = 100 - main;
            for (let r in room.regions) if (room.regions[r].owner === id) inc += room.regions[r].cells * 1.5 * room.regions[r].level;
            room.countries[id].dollars += inc; room.countries[id].lastIncome = inc;
            if (room.countries[id].military < room.countries[id].cap) {
                room.countries[id].military += Math.floor(room.countries[id].cells * 2);
                if (room.countries[id].military > room.countries[id].cap) room.countries[id].military = room.countries[id].cap;
            }
            changed = true;
        }
        if (changed) io.to(roomId).emit('updateResources', room.countries);
    }
}, 1000);

server.listen(process.env.PORT || 3000, () => console.log('HOI4 SERVER ONLINE'));
