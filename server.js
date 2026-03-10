const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

// --- ГЛОБАЛЬНЫЕ ДАННЫЕ ---
let countries = {}; 
let playerSockets = {}; 
let territory = {}; 
let armies = {}; 
let regions = {}; 

const WORLD_WIDTH = 1920; 
const WORLD_HEIGHT = 1080;
const TILE_SIZE = 5; 
const COLLISION_RADIUS = 4; // Маленькие фишки армий

let mapChangedForCauldrons = false; 

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
function getCellKey(x, y) { return `${Math.floor(x)}_${Math.floor(y)}`; }

// --- СЕТЕВАЯ ЛОГИКА ---
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
            cId = data.countryId;
            if (countries[cId]) countries[cId].online = true;
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
        
        // ГОРОД-СТОЛИЦА (Никогда не меняет место)
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

        if (!regions[data.newRegionId]) {
            regions[data.newRegionId] = { 
                name: `Регион ${Object.keys(regions).length + 1}`, 
                owner: cId, cells: 0, level: 1, defLevel: 0,
                cityX: Math.floor(sumX / data.tiles.length),
                cityY: Math.floor(sumY / data.tiles.length)
            };
        }

        data.tiles.forEach(key => {
            const cell = territory[key];
            if (cell && cell.owner === cId && cell.regionId !== data.newRegionId) {
                if (regions[cell.regionId]) regions[cell.regionId].cells--;
                cell.regionId = data.newRegionId;
                regions[data.newRegionId].cells++;
            }
        });
        io.emit('syncTerritory', { territory, regions });
    });

    socket.on('upgradeRegion', (rId) => {
        const cId = playerSockets[socket.id];
        const reg = regions[rId];
        if (reg && reg.owner === cId && reg.level < 10) {
            const cost = reg.cells * reg.level * 50;
            if (countries[cId].dollars >= cost) {
                countries[cId].dollars -= cost; reg.level++;
                io.emit('syncTerritory', { territory, regions });
                io.emit('updateResources', countries);
            }
        }
    });

    socket.on('upgradeDefense', (rId) => {
        const cId = playerSockets[socket.id];
        const reg = regions[rId];
        if (reg && reg.owner === cId && (reg.defLevel || 0) < 10) {
            const next = (reg.defLevel || 0) + 1;
            const costD = reg.cells * next * 20;
            const costM = reg.cells * next * 10;
            if (countries[cId].dollars >= costD && countries[cId].military >= costM) {
                countries[cId].dollars -= costD; countries[cId].military -= costM;
                reg.defLevel = next;
                io.emit('syncTerritory', { territory, regions });
                io.emit('updateResources', countries);
            }
        }
    });

    socket.on('deployArmy', (data) => {
        const cId = playerSockets[socket.id];
        const reg = regions[data.regionId];
        if (reg && reg.owner === cId && countries[cId].military >= data.amount) {
            countries[cId].military -= data.amount;
            const id = Math.random().toString(36).substr(2, 9);
            armies[id] = {
                id, owner: cId, count: parseInt(data.amount),
                x: reg.cityX * TILE_SIZE, y: reg.cityY * TILE_SIZE,
                targetX: null, targetY: null, speed: 0.25
            };
            io.emit('syncArmies', armies);
            io.emit('updateResources', countries);
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

    socket.on('disbandArmies', (ids) => {
        const cId = playerSockets[socket.id];
        ids.forEach(id => { if (armies[id] && armies[id].owner === cId) delete armies[id]; });
        io.emit('syncArmies', armies);
    });

    socket.on('disconnect', () => {
        const cId = playerSockets[socket.id];
        if (cId && countries[cId]) { countries[cId].online = false; io.emit('initLobby', countries); }
        delete playerSockets[socket.id];
    });
});

// --- ГЛАВНЫЙ ИГРОВОЙ ЦИКЛ (30 FPS) ---
setInterval(() => {
    let changed = false;
    const armyIds = Object.keys(armies);

    // 1. Очистка боевых данных
    armyIds.forEach(id => { 
        armies[id].inCombat = false; 
        armies[id].targets = []; 
        armies[id].dmg = 0; 
    });

    // 2. Коллизии и Осада городов
    for (let i = 0; i < armyIds.length; i++) {
        const a = armies[armyIds[i]];
        
        // Проверка захвата города
        for (const rId in regions) {
            const reg = regions[rId];
            if (Math.floor(a.x/TILE_SIZE) === reg.cityX && Math.floor(a.y/TILE_SIZE) === reg.cityY && a.owner !== reg.owner) {
                const oldOwner = reg.owner;
                const newOwner = a.owner;
                reg.owner = newOwner;
                for (const k in territory) {
                    if (territory[k].regionId === rId) {
                        if (countries[oldOwner]) countries[oldOwner].cells--;
                        territory[k].owner = newOwner;
                        if (countries[newOwner]) countries[newOwner].cells++;
                    }
                }
                io.emit('updateMap', { countries, territory, regions });
            }
        }

        for (let j = i + 1; j < armyIds.length; j++) {
            const b = armies[armyIds[j]];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            if (dist < COLLISION_RADIUS * 2) {
                if (a.owner !== b.owner) {
                    a.targets.push(b.id); b.targets.push(a.id);
                    a.targetX = null; b.targetX = null;
                } else {
                    const push = (COLLISION_RADIUS * 2 - dist) * 0.5;
                    const angle = Math.atan2(a.y - b.y, a.x - b.x);
                    a.x += Math.cos(angle) * push; a.y += Math.sin(angle) * push;
                    b.x -= Math.cos(angle) * push; b.y -= Math.sin(angle) * push;
                    changed = true;
                }
            }
        }
    }

    // 3. Движение, Захват и Аттришн (Истощение)
    armyIds.forEach(id => {
        const a = armies[id];
        const key = getCellKey(a.x / TILE_SIZE, a.y / TILE_SIZE);
        const cell = territory[key];

        // Урон от защиты региона (Attrition)
        if (cell && cell.owner !== a.owner && regions[cell.regionId]) {
            const def = regions[cell.regionId].defLevel || 0;
            if (def > 0) a.dmg += (def * 50) / 30; // 500/сек на макс уровне
        }

        // Движение и обычный захват
        if (!a.targets.length && a.targetX !== null) {
            const dist = Math.hypot(a.targetX - a.x, a.targetY - a.y);
            if (dist > a.speed) {
                a.x += ((a.targetX - a.x) / dist) * a.speed;
                a.y += ((a.targetY - a.y) / dist) * a.speed;
                changed = true;
            } else { a.targetX = null; }

            if (!cell || cell.owner !== a.owner) {
                if (cell && countries[cell.owner]) {
                    countries[cell.owner].cells--;
                    if (regions[cell.regionId]) regions[cell.regionId].cells--;
                }
                const regId = `reg_${a.owner}_cap`;
                territory[key] = { owner: a.owner, regionId: regId };
                countries[a.owner].cells++;
                if (regions[regId]) regions[regId].cells++;
                io.emit('cellUpdate', { key, cell: territory[key], regions, countries });
                mapChangedForCauldrons = true;
            }
        }
    });

    // 4. Боевая математика (Закон Ланчестера)
    armyIds.forEach(id => {
        const a = armies[id];
        if (a.targets.length) {
            a.inCombat = true;
            const target = armies[a.targets[0]];
            if (target) {
                const flankBonus = 1 + (target.targets.length - 1) * 0.5;
                target.dmg += (a.count * 0.005) * flankBonus;
                changed = true;
            }
        }
    });

    // Применение урона
    armyIds.forEach(id => {
        if (armies[id].dmg > 0) { armies[id].count -= armies[id].dmg; changed = true; }
        if (armies[id].count <= 0) delete armies[id];
    });

    if (changed) io.emit('syncArmies', armies);
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
