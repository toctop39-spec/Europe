const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

let countries = {}; 
let playerSockets = {}; 
let territory = {}; 
let armies = {}; 
let regions = {}; 
let pendingDeployments = [];

// ОПТИМИЗАЦИЯ СЕТИ: Накапливаем клетки и отправляем их раз в 200мс, а не 30 раз в секунду
let batchedCellUpdates = {};

const WORLD_WIDTH = 1920; 
const WORLD_HEIGHT = 1080;
const TILE_SIZE = 5; 
const COLLISION_RADIUS = 4; 
let mapChangedForCauldrons = false; 

io.on('connection', (socket) => {
    socket.emit('initLobby', countries);
    socket.emit('initData', { countries, territory, armies, regions });

    socket.on('joinGame', (data) => {
        let cId;
        if (data.isNew) {
            cId = `c_${Math.random().toString(36).substr(2, 9)}`;
            countries[cId] = {
                id: cId, name: data.name, flag: data.flag, color: data.color,
                cells: 0, dollars: 10000, 
                population: 100000, 
                military: 10000, cap: 10000, 
                isSpawned: false, online: true
            };
        } else {
            cId = data.countryId; if (countries[cId]) countries[cId].online = true;
        }
        playerSockets[socket.id] = cId;
        socket.emit('joinSuccess', cId); 
        io.emit('initLobby', countries);
        io.emit('updateMap', { countries, territory, regions });
    });

    socket.on('spawnCapital', (data) => {
        const cId = playerSockets[socket.id];
        const country = countries[cId];
        if (!country || country.isSpawned) return;

        country.isSpawned = true;
        const startRegionId = `reg_${cId}_cap`;
        
        regions[startRegionId] = { 
            name: "Столичный округ", owner: cId, cells: 0, level: 1, defLevel: 0,
            cityX: data.x, cityY: data.y, siegeProgress: 0 
        };

        for(let dx = -6; dx <= 6; dx++) {
            for(let dy = -6; dy <= 6; dy++) {
                if(dx*dx + dy*dy <= 36) { 
                    const cx = data.x + dx; const cy = data.y + dy;
                    if (cx >= 0 && cx < WORLD_WIDTH/TILE_SIZE && cy >= 0 && cy < WORLD_HEIGHT/TILE_SIZE) {
                        const key = `${cx}_${cy}`;
                        territory[key] = { owner: cId, regionId: startRegionId, captureProgress: 0 };
                        country.cells++; regions[startRegionId].cells++;
                    }
                }
            }
        }
        mapChangedForCauldrons = true;
        io.emit('updateMap', { countries, territory, regions });
        io.emit('newsEvent', { title: "НОВОЕ ГОСУДАРСТВО", text: `На мировой арене появилась новая сила: ${country.name}.` });
    });

    socket.on('lassoRegion', (data) => {
        const cId = playerSockets[socket.id];
        if (!cId || !data.tiles.length) return;
        let ownedTiles = [];
        data.tiles.forEach(key => { if (territory[key] && territory[key].owner === cId) ownedTiles.push(key); });
        if (ownedTiles.length === 0) return; 

        if (!regions[data.newRegionId]) {
            let sumX = 0, sumY = 0;
            ownedTiles.forEach(key => { const [x, y] = key.split('_').map(Number); sumX += x; sumY += y; });
            const avgX = Math.floor(sumX / ownedTiles.length); const avgY = Math.floor(sumY / ownedTiles.length);
            
            let bestKey = ownedTiles[0]; let minDist = Infinity;
            ownedTiles.forEach(key => {
                const [x, y] = key.split('_').map(Number); const d = Math.hypot(x - avgX, y - avgY);
                if (d < minDist) { minDist = d; bestKey = key; }
            });
            const [fX, fY] = bestKey.split('_').map(Number);
            
            regions[data.newRegionId] = { name: data.name, owner: cId, cells: 0, level: 1, defLevel: 0, cityX: fX, cityY: fY, siegeProgress: 0 };
        }

        ownedTiles.forEach(key => {
            const cell = territory[key];
            if (regions[cell.regionId]) regions[cell.regionId].cells--;
            cell.regionId = data.newRegionId; regions[data.newRegionId].cells++;
        });
        io.emit('syncTerritory', { territory, regions });
    });

    socket.on('renameRegion', (data) => {
        const cId = playerSockets[socket.id]; const reg = regions[data.regionId];
        if (reg && reg.owner === cId && data.newName) { reg.name = data.newName.substring(0, 20); io.emit('syncTerritory', { territory, regions }); }
    });

    socket.on('upgradeRegion', (rId) => {
        const cId = playerSockets[socket.id]; const reg = regions[rId];
        if (reg && reg.owner === cId && reg.level < 10) {
            const cost = reg.cells * reg.level * 50;
            if (countries[cId].dollars >= cost) { countries[cId].dollars -= cost; reg.level++; io.emit('syncTerritory', { territory, regions }); io.emit('updateResources', countries); }
        }
    });

    socket.on('upgradeDefense', (rId) => {
        const cId = playerSockets[socket.id]; const reg = regions[rId];
        if (reg && reg.owner === cId && (reg.defLevel || 0) < 10) {
            const next = (reg.defLevel || 0) + 1;
            const costD = reg.cells * next * 20; const costM = reg.cells * next * 10;
            if (countries[cId].dollars >= costD && countries[cId].military >= costM) {
                countries[cId].dollars -= costD; countries[cId].military -= costM;
                reg.defLevel = next;
                io.emit('syncTerritory', { territory, regions }); io.emit('updateResources', countries);
            }
        }
    });

    socket.on('deployArmy', (data) => {
        const cId = playerSockets[socket.id]; const reg = regions[data.regionId];
        if (reg && reg.owner === cId) {
            const isAlreadyDeploying = pendingDeployments.some(dep => dep.regionId === data.regionId);
            if (isAlreadyDeploying) {
                socket.emit('newsEvent', { title: "ОТМЕНА ПРИКАЗА", text: `В регионе ${reg.name} уже идет мобилизация.` });
                return;
            }
            if (countries[cId].military >= data.amount) {
                countries[cId].military -= data.amount;
                pendingDeployments.push({ owner: cId, amount: parseInt(data.amount), regionId: data.regionId, readyAt: Date.now() + 15000 });
                io.emit('updateResources', countries);
                socket.emit('newsEvent', { title: "МОБИЛИЗАЦИЯ", text: `Дивизия сформируется в регионе ${reg.name} через 15 сек.` });
            }
        }
    });

    socket.on('moveArmies', (data) => {
        const cId = playerSockets[socket.id];
        data.armyIds.forEach(id => {
            if (armies[id] && armies[id].owner === cId) {
                armies[id].targetX = Math.max(5, Math.min(WORLD_WIDTH - 5, data.targetX)); armies[id].targetY = Math.max(5, Math.min(WORLD_HEIGHT - 5, data.targetY));
            }
        });
    });

    socket.on('disbandArmies', (ids) => {
        const cId = playerSockets[socket.id];
        ids.forEach(id => { if (armies[id] && armies[id].owner === cId) { countries[cId].military += armies[id].count; delete armies[id]; } });
        io.emit('syncArmies', armies); io.emit('updateResources', countries);
    });
    
    socket.on('disconnect', () => {
        const cId = playerSockets[socket.id];
        if (cId && countries[cId]) countries[cId].online = false;
        io.emit('initLobby', countries); delete playerSockets[socket.id];
    });
});

// Отправка накопленных клеток раз в 200мс (убивает лаги интерфейса)
setInterval(() => {
    if (Object.keys(batchedCellUpdates).length > 0) {
        io.emit('batchCellUpdate', { cells: batchedCellUpdates, regions, countries });
        batchedCellUpdates = {}; // Очищаем после отправки
    }
}, 200);

// --- ГЛАВНЫЙ ИГРОВОЙ ЦИКЛ (30 FPS) ---
setInterval(() => {
    let stateChanged = false; const now = Date.now();

    for (let i = pendingDeployments.length - 1; i >= 0; i--) {
        const dep = pendingDeployments[i];
        if (now >= dep.readyAt) {
            const reg = regions[dep.regionId];
            if (reg && reg.owner === dep.owner) {
                const id = Math.random().toString(36).substr(2, 9);
                armies[id] = { id, owner: dep.owner, count: dep.amount, x: reg.cityX*TILE_SIZE, y: reg.cityY*TILE_SIZE, targetX: null, targetY: null, speed: 0.3 };
                stateChanged = true;
            } else {
                if (countries[dep.owner]) countries[dep.owner].military += dep.amount;
            }
            pendingDeployments.splice(i, 1); io.emit('updateResources', countries);
        }
    }

    const armyIds = Object.keys(armies);
    armyIds.forEach(id => { armies[id].targets = []; armies[id].dmg = 0; });

    // Осада городов
    for (const rId in regions) {
        const reg = regions[rId]; let beingSiegedBy = null;
        for (let i = 0; i < armyIds.length; i++) {
            const a = armies[armyIds[i]];
            if (reg.cityX !== undefined && Math.floor(a.x/TILE_SIZE) === reg.cityX && Math.floor(a.y/TILE_SIZE) === reg.cityY && a.owner !== reg.owner) {
                beingSiegedBy = a.owner; break; 
            }
        }
        if (beingSiegedBy) {
            reg.siegeProgress = (reg.siegeProgress || 0) + 1;
            if (reg.siegeProgress >= 90) { 
                const oldOwner = reg.owner; reg.owner = beingSiegedBy; reg.siegeProgress = 0;
                for (const k in territory) {
                    if (territory[k].regionId === rId) {
                        if (countries[oldOwner]) countries[oldOwner].cells--;
                        territory[k].owner = beingSiegedBy; territory[k].captureProgress = 0;
                        if (countries[beingSiegedBy]) countries[beingSiegedBy].cells++;
                        batchedCellUpdates[k] = territory[k]; // В батч
                    }
                }
                io.emit('newsEvent', { title: "ПАДЕНИЕ РЕГИОНА", text: `Регион ${reg.name} захвачен войсками ${countries[beingSiegedBy].name}!` });
                io.emit('updateMap', { countries, territory, regions });
            }
        } else { reg.siegeProgress = 0; }
    }

    // Линия фронта и движение
    armyIds.forEach(id => {
        const a = armies[id];
        const cellX = Math.floor(a.x/TILE_SIZE); const cellY = Math.floor(a.y/TILE_SIZE);
        const cellKey = `${cellX}_${cellY}`;
        const cell = territory[cellKey];
        
        let currentSpeed = a.speed;

        if (!cell || cell.owner !== a.owner) {
            currentSpeed = 0.05; 
            if (cell && regions[cell.regionId]) a.dmg += ((regions[cell.regionId].defLevel || 0) * 50) / 30; 
            
            if (!territory[cellKey]) territory[cellKey] = { owner: null, captureProgress: 0 };
            territory[cellKey].captureProgress = (territory[cellKey].captureProgress || 0) + 1;
            
            if (territory[cellKey].captureProgress > 20) { 
                const oldOwner = territory[cellKey].owner;
                if (oldOwner && countries[oldOwner]) countries[oldOwner].cells--;
                if (territory[cellKey].regionId && regions[territory[cellKey].regionId]) regions[territory[cellKey].regionId].cells--;
                
                const newRegId = `reg_${a.owner}_cap`;
                territory[cellKey] = { owner: a.owner, regionId: newRegId, captureProgress: 0 };
                
                countries[a.owner].cells++;
                if (regions[newRegId]) regions[newRegId].cells++;
                
                batchedCellUpdates[cellKey] = territory[cellKey]; // В батч, убираем лаги!
                mapChangedForCauldrons = true;
            }
        }

        if (!a.targets.length && a.targetX !== null) {
            const d = Math.hypot(a.targetX - a.x, a.targetY - a.y);
            if (d > currentSpeed) { 
                a.x += ((a.targetX-a.x)/d)*currentSpeed; a.y += ((a.targetY-a.y)/d)*currentSpeed; stateChanged = true; 
            } else { a.targetX = null; }
        }
    });

    // Боевка армий
    for (let i = 0; i < armyIds.length; i++) {
        const a = armies[armyIds[i]];
        for (let j = i + 1; j < armyIds.length; j++) {
            const b = armies[armyIds[j]]; const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < COLLISION_RADIUS * 2) {
                if (a.owner !== b.owner) { 
                    a.targets.push(b.id); b.targets.push(a.id); a.targetX = null; b.targetX = null; 
                } else {
                    const p = (COLLISION_RADIUS * 2 - d) * 0.5; const ang = Math.atan2(a.y-b.y, a.x-b.x);
                    a.x += Math.cos(ang)*p; a.y += Math.sin(ang)*p; b.x -= Math.cos(ang)*p; b.y -= Math.sin(ang)*p; stateChanged = true;
                }
            }
        }
    }

    armyIds.forEach(id => {
        const a = armies[id];
        if (a.targets.length) { const t = armies[a.targets[0]]; if (t) t.dmg += (a.count * 0.005) * (1 + (t.targets.length - 1) * 0.5); }
    });

    armyIds.forEach(id => {
        if (armies[id].dmg > 0) { armies[id].count -= armies[id].dmg; stateChanged = true; }
        if (armies[id].count <= 0) delete armies[id];
    });

    if (stateChanged) io.emit('syncArmies', armies);
}, 33);

// --- ИСПРАВЛЕННЫЕ АСИНХРОННЫЕ КОТЛЫ ---
const gridW = WORLD_WIDTH / TILE_SIZE; const gridH = WORLD_HEIGHT / TILE_SIZE;
const total = gridW * gridH;
let vstd = new Uint8Array(total); let qX = new Int32Array(total); let qY = new Int32Array(total);
let sX = 0, sY = 0, fillQ = [];

setInterval(() => {
    if (fillQ.length) {
        let btch = fillQ.splice(0, Math.max(20, Math.floor(fillQ.length/20)));
        btch.forEach(c => {
            const k = `${c.x}_${c.y}`; const old = territory[k] ? territory[k].owner : null;
            if (old !== c.owner) {
                if (old && countries[old]) countries[old].cells--;
                if (territory[k] && regions[territory[k].regionId]) regions[territory[k].regionId].cells--;
                territory[k] = { owner: c.owner, regionId: c.regId };
                if (countries[c.owner]) countries[c.owner].cells++;
                if (regions[c.regId]) regions[c.regId].cells++;
                batchedCellUpdates[k] = territory[k]; // В батч!
            }
        });
        return;
    }
    
    if (!mapChangedForCauldrons) return;
    let armyLocs = {}; for(let id in armies) { let k = `${Math.floor(armies[id].x/TILE_SIZE)}_${Math.floor(armies[id].y/TILE_SIZE)}`; if(!armyLocs[k]) armyLocs[k] = []; armyLocs[k].push(armies[id].owner); }
    
    let checked = 0;
    while (checked < 3000) {
        let idx = sY * gridW + sX;
        if (vstd[idx] === 0) {
            let h = 0, t = 0, edge = false, owners = new Set(), comp = [];
            const startOwner = territory[`${sX}_${sY}`] ? territory[`${sX}_${sY}`].owner : null;
            let hasDefendingArmy = false;
            qX[t] = sX; qY[t] = sY; t++; vstd[idx] = 1;
            
            while(h < t) {
                let cx = qX[h]; let cy = qY[h]; h++; comp.push({x: cx, y: cy});
                
                // ИСПРАВЛЕНИЕ: Ограничение размера котла. Огромные материки больше не исчезают.
                if (comp.length > 500) edge = true; 
                
                if (cx <= 0 || cx >= gridW-1 || cy <= 0 || cy >= gridH-1) edge = true;
                if (startOwner !== null && armyLocs[`${cx}_${cy}`] && armyLocs[`${cx}_${cy}`].includes(startOwner)) hasDefendingArmy = true;
                
                [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx, dy]) => {
                    let nx = cx + dx, ny = cy + dy;
                    if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
                        let nKey = `${nx}_${ny}`; let nOwn = territory[nKey] ? territory[nKey].owner : null;
                        if (nOwn === startOwner) { 
                            let nIdx = ny * gridW + nx; if (vstd[nIdx] === 0) { vstd[nIdx] = 1; qX[t] = nx; qY[t] = ny; t++; }
                        } else {
                            // ИСПРАВЛЕНИЕ: Нейтральные земли считаются границей. Нельзя "окружить" прижав к пустыне.
                            owners.add(nOwn === null ? 'neutral' : nOwn); 
                        }
                    }
                });
            }
            if (!edge && owners.size === 1 && !hasDefendingArmy) {
                let winId = Array.from(owners)[0];
                if (winId !== startOwner && winId !== 'neutral') { // 'neutral' не может захватывать котлы
                    let rId = `reg_${winId}_cap`; if (!regions[rId]) regions[rId] = { name: "Столица", owner: winId, cells: 0, level: 1, defLevel: 0 };
                    comp.reverse().forEach(c => fillQ.push({...c, owner: winId, regId: rId})); break;
                }
            }
        }
        sX++; checked++;
        if (sX >= gridW) { sX = 0; sY++; if (sY >= gridH) { sY = 0; mapChangedForCauldrons = false; vstd.fill(0); break; } }
    }
}, 50);

setInterval(() => {
    let changed = false;
    for (let id in countries) {
        if (!countries[id].isSpawned) continue;
        const popGrowth = Math.floor(countries[id].cells * 0.5); countries[id].population += popGrowth;
        countries[id].cap = Math.floor(countries[id].population * 0.1);
        let main = 0; for (let a in armies) if (armies[a].owner === id) main += armies[a].count * 1; 
        let inc = 100 - main;
        for (let r in regions) if (regions[r].owner === id) inc += regions[r].cells * 1.5 * regions[r].level;
        countries[id].dollars += inc; countries[id].lastIncome = inc;
        if (countries[id].military < countries[id].cap) {
            countries[id].military += Math.floor(countries[id].cells * 2);
            if (countries[id].military > countries[id].cap) countries[id].military = countries[id].cap;
        }
        changed = true;
    }
    if (changed) io.emit('updateResources', countries);
}, 1000);

server.listen(process.env.PORT || 3000, () => console.log('HOI4 ENGINE ONLINE'));
