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

const WORLD_WIDTH = 1920; const WORLD_HEIGHT = 1080;
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
                cells: 0, dollars: 10000, military: 5000, cap: 5000, isSpawned: false, online: true
            };
        } else {
            cId = data.countryId; if (countries[cId]) countries[cId].online = true;
        }
        playerSockets[socket.id] = cId;
        socket.emit('joinSuccess', cId); io.emit('initLobby', countries);
    });

    socket.on('spawnCapital', (data) => {
        const cId = playerSockets[socket.id];
        const country = countries[cId];
        if (!country || country.isSpawned) return;

        country.isSpawned = true;
        const startRegionId = `reg_${cId}_cap`;
        regions[startRegionId] = { 
            name: "Столица", owner: cId, cells: 0, level: 1, defLevel: 0,
            cityX: data.x, cityY: data.y 
        };

        for(let dx = -6; dx <= 6; dx++) {
            for(let dy = -6; dy <= 6; dy++) {
                if(dx*dx + dy*dy <= 36) { 
                    const cx = data.x + dx; const cy = data.y + dy;
                    if (cx >= 0 && cx < WORLD_WIDTH/TILE_SIZE && cy >= 0 && cy < WORLD_HEIGHT/TILE_SIZE) {
                        const key = `${cx}_${cy}`;
                        territory[key] = { owner: cId, regionId: startRegionId };
                        country.cells++; regions[startRegionId].cells++;
                    }
                }
            }
        }
        mapChangedForCauldrons = true;
        io.emit('updateMap', { countries, territory, regions });
    });

    socket.on('lassoRegion', (data) => {
        const cId = playerSockets[socket.id];
        if (!cId || !data.tiles.length) return;

        let sumX = 0, sumY = 0;
        data.tiles.forEach(key => {
            const [x, y] = key.split('_').map(Number);
            sumX += x; sumY += y;
        });

        const avgX = Math.floor(sumX / data.tiles.length);
        const avgY = Math.floor(sumY / data.tiles.length);

        // Поиск ближайшей КЛЕТКИ к центру (чтобы город был внутри)
        let bestKey = data.tiles[0];
        let minDist = Infinity;
        data.tiles.forEach(key => {
            const [x, y] = key.split('_').map(Number);
            const d = Math.hypot(x - avgX, y - avgY);
            if (d < minDist) { minDist = d; bestKey = key; }
        });
        const [fX, fY] = bestKey.split('_').map(Number);

        if (!regions[data.newRegionId]) {
            regions[data.newRegionId] = { 
                name: data.name, owner: cId, cells: 0, level: 1, defLevel: 0,
                cityX: fX, cityY: fY 
            };
        }

        data.tiles.forEach(key => {
            const cell = territory[key];
            if (cell && cell.owner === cId) {
                if (regions[cell.regionId]) regions[cell.regionId].cells--;
                cell.regionId = data.newRegionId;
                regions[data.newRegionId].cells++;
            }
        });
        io.emit('syncTerritory', { territory, regions });
    });

    socket.on('renameRegion', (data) => {
        const cId = playerSockets[socket.id];
        const reg = regions[data.regionId];
        if (reg && reg.owner === cId) {
            reg.name = data.newName;
            io.emit('syncTerritory', { territory, regions });
        }
    });

    socket.on('upgradeRegion', (rId) => {
        const cId = playerSockets[socket.id];
        if (regions[rId] && regions[rId].owner === cId && countries[cId].dollars >= regions[rId].cells * regions[rId].level * 50) {
            countries[cId].dollars -= regions[rId].cells * regions[rId].level * 50;
            regions[rId].level++;
            io.emit('updateResources', countries); io.emit('syncTerritory', { territory, regions });
        }
    });

    socket.on('deployArmy', (data) => {
        const cId = playerSockets[socket.id];
        const reg = regions[data.regionId];
        if (reg && reg.owner === cId && countries[cId].military >= data.amount) {
            countries[cId].military -= data.amount;
            const id = Math.random().toString(36).substr(2, 9);
            armies[id] = { id, owner: cId, count: parseInt(data.amount), x: reg.cityX*TILE_SIZE, y: reg.cityY*TILE_SIZE, targetX: null, targetY: null, speed: 0.3 };
            io.emit('syncArmies', armies); io.emit('updateResources', countries);
        }
    });

    socket.on('moveArmies', (data) => {
        const cId = playerSockets[socket.id];
        data.armyIds.forEach(id => {
            if (armies[id] && armies[id].owner === cId) {
                armies[id].targetX = Math.max(5, Math.min(WORLD_WIDTH - 5, data.targetX));
                armies[id].targetY = Math.max(5, Math.min(WORLD_HEIGHT - 5, data.targetY));
            }
        });
    });

    socket.on('disconnect', () => {
        const cId = playerSockets[socket.id];
        if (cId && countries[cId]) countries[cId].online = false;
        delete playerSockets[socket.id];
    });
});

// ЦИКЛ ИГРЫ (Захват, Бой)
setInterval(() => {
    let stateChanged = false;
    const armyIds = Object.keys(armies);

    armyIds.forEach(id => { armies[id].targets = []; armies[id].dmg = 0; });

    // Осада городов и Коллизии
    for (let i = 0; i < armyIds.length; i++) {
        const a = armies[armyIds[i]];
        
        for (const rId in regions) {
            const reg = regions[rId];
            if (Math.floor(a.x/TILE_SIZE) === reg.cityX && Math.floor(a.y/TILE_SIZE) === reg.cityY && a.owner !== reg.owner) {
                // ЗАХВАТ: Имя НЕ меняем
                const oldOwner = reg.owner;
                reg.owner = a.owner;
                for (const k in territory) {
                    if (territory[k].regionId === rId) {
                        if (countries[oldOwner]) countries[oldOwner].cells--;
                        territory[k].owner = a.owner;
                        countries[a.owner].cells++;
                    }
                }
                io.emit('updateMap', { countries, territory, regions });
            }
        }

        for (let j = i + 1; j < armyIds.length; j++) {
            const b = armies[armyIds[j]];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < COLLISION_RADIUS * 2) {
                if (a.owner !== b.owner) { a.targets.push(b.id); b.targets.push(a.id); a.targetX = null; b.targetX = null; }
                else {
                    const p = (COLLISION_RADIUS * 2 - d) * 0.5;
                    const ang = Math.atan2(a.y-b.y, a.x-b.x);
                    a.x += Math.cos(ang)*p; a.y += Math.sin(ang)*p; b.x -= Math.cos(ang)*p; b.y -= Math.sin(ang)*p;
                    stateChanged = true;
                }
            }
        }
    }

    armyIds.forEach(id => {
        const a = armies[id];
        const cell = territory[`${Math.floor(a.x/TILE_SIZE)}_${Math.floor(a.y/TILE_SIZE)}`];
        if (cell && cell.owner !== a.owner && regions[cell.regionId]) {
            a.dmg += ((regions[cell.regionId].defLevel || 0) * 50) / 30;
        }
        if (!a.targets.length && a.targetX !== null) {
            const d = Math.hypot(a.targetX - a.x, a.targetY - a.y);
            if (d > a.speed) { a.x += ((a.targetX-a.x)/d)*a.speed; a.y += ((a.targetY-a.y)/d)*a.speed; stateChanged = true; }
            else { a.targetX = null; }
        }
    });

    armyIds.forEach(id => {
        const a = armies[id];
        if (a.targets.length) {
            const t = armies[a.targets[0]];
            if (t) t.dmg += (a.count * 0.005) * (1 + (t.targets.length - 1) * 0.5);
        }
    });

    armyIds.forEach(id => {
        if (armies[id].dmg > 0) { armies[id].count -= armies[id].dmg; stateChanged = true; }
        if (armies[id].count <= 0) delete armies[id];
    });

    if (stateChanged) io.emit('syncArmies', armies);
}, 33);

// --- АСИНХРОННЫЕ КОТЛЫ (ВКЛЮЧАЯ ЗАХВАТ ВРАГОВ) ---
const gridW = WORLD_WIDTH / TILE_SIZE; const gridH = WORLD_HEIGHT / TILE_SIZE;
const total = gridW * gridH;
let vstd = new Uint8Array(total); let qX = new Int32Array(total); let qY = new Int32Array(total);
let sX = 0, sY = 0, fillQ = [];

setInterval(() => {
    // 1. Плавная закраска
    if (fillQ.length) {
        let btch = fillQ.splice(0, Math.max(20, Math.floor(fillQ.length/20)));
        let updates = {};
        btch.forEach(c => {
            const k = `${c.x}_${c.y}`;
            const old = territory[k] ? territory[k].owner : null;
            if (old !== c.owner) {
                if (old && countries[old]) countries[old].cells--;
                territory[k] = { owner: c.owner, regionId: c.regId };
                if (countries[c.owner]) countries[c.owner].cells++;
                updates[k] = territory[k];
            }
        });
        if (Object.keys(updates).length) io.emit('batchCellUpdate', { cells: updates, regions, countries });
        return;
    }

    // 2. Сканер
    if (!mapChangedForCauldrons) return;
    let checked = 0;
    while (checked < 3000) {
        let idx = sY * gridW + sX;
        if (vstd[idx] === 0) {
            let h = 0, t = 0, edge = false, owners = new Set(), comp = [];
            const startOwner = territory[`${sX}_${sY}`] ? territory[`${sX}_${sY}`].owner : null;
            
            // Проверка на наличие армии внутри
            let hasArmy = false;
            
            qX[t] = sX; qY[t] = sY; t++; vstd[idx] = 1;
            while(h < t) {
                let cx = qX[h]; let cy = qY[h]; h++;
                comp.push({x: cx, y: cy});
                if (cx <= 0 || cx >= gridW-1 || cy <= 0 || cy >= gridH-1) edge = true;
                
                // Если в клетке есть хоть одна армия владельца территории - котел не закроется
                for(let id in armies) {
                    if (Math.floor(armies[id].x/TILE_SIZE) === cx && Math.floor(armies[id].y/TILE_SIZE) === cy && armies[id].owner === startOwner) hasArmy = true;
                }

                [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx, dy]) => {
                    let nx = cx + dx, ny = cy + dy;
                    if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
                        let nKey = `${nx}_${ny}`;
                        let nOwn = territory[nKey] ? territory[nKey].owner : null;
                        if (nOwn === startOwner) {
                            let nIdx = ny * gridW + nx;
                            if (vstd[nIdx] === 0) { vstd[nIdx] = 1; qX[t] = nx; qY[t] = ny; t++; }
                        } else if (nOwn !== null) owners.add(nOwn);
                    }
                });
            }

            if (!edge && owners.size === 1 && !hasArmy) {
                let winId = Array.from(owners)[0];
                let rId = `reg_${winId}_cap`;
                comp.reverse().forEach(c => fillQ.push({...c, owner: winId, regId: rId}));
                break;
            }
        }
        sX++; checked++;
        if (sX >= gridW) { sX = 0; sY++; if (sY >= gridH) { sY = 0; mapChangedForCauldrons = false; vstd.fill(0); break; } }
    }
}, 50);

// Экономика
setInterval(() => {
    for (let id in countries) {
        if (!countries[id].isSpawned) continue;
        let main = 0;
        for (let a in armies) if (armies[a].owner === id) main += armies[a].count * 0.1;
        let inc = 100 - main;
        for (let r in regions) if (regions[r].owner === id) inc += regions[r].cells * 1.5 * regions[r].level;
        countries[id].dollars += inc; countries[id].lastIncome = inc;
        countries[id].cap = 5000 + countries[id].cells * 50;
        if (countries[id].military < countries[id].cap) countries[id].military += Math.floor(countries[id].cells * 1.5);
    }
    io.emit('updateResources', countries);
}, 1000);

server.listen(3000, () => console.log('WAR ENGINE ONLINE'));

