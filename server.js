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
let buildings = {}; 
let rockets = {};   
let pendingDeployments = [];
let pendingTrades = {};

const WORLD_WIDTH = 1920; 
const WORLD_HEIGHT = 1080;
const TILE_SIZE = 5; 

// ИСПРАВЛЕННЫЕ РАДИУСЫ
const ENGAGE_RADIUS = 25; // Начинают стрелять издалека
const COLLISION_RADIUS = 6; // Толкаются только вблизи

const BUILD_COSTS = {
    'factory': { cost: 5000, hp: 100 },
    'radar_1': { cost: 8000, hp: 100, radius: 150 },
    'pvo_1':   { cost: 12000, hp: 100, tier: 1, radius: 50 },
    'pvo_2':   { cost: 35000, hp: 150, tier: 2, radius: 100 },
    'silo':    { cost: 15000, hp: 200 }
};

const ROCKET_STATS = {
    'tochka':   { cost: 2000, keys: 50, speed: 2.0, tier: 1, dmgRad: 30, dmg: 100 },
    'tomahawk': { cost: 10000, keys: 200, speed: 3.5, tier: 2, dmgRad: 50, dmg: 500 },
    'oreshnik': { cost: 50000, keys: 1000, speed: 8.0, tier: 3, dmgRad: 150, dmg: 5000 }
};

let batchedCellUpdates = {};
let mapChangedForCauldrons = false; 
let forceRegionUpdate = false; 

function isWithinRadar(owner, x, y) {
    for (let id in buildings) {
        let b = buildings[id];
        if (b.owner === owner && b.type.startsWith('radar')) {
            const stats = BUILD_COSTS[b.type];
            if (Math.hypot(b.x - x, b.y - y) <= stats.radius) return true;
        }
    }
    return false;
}

io.on('connection', (socket) => {
    socket.emit('initLobby', countries);
    socket.emit('initData', { countries, territory, armies, regions, buildings, rockets });

    socket.on('joinGame', (data) => {
        let cId;
        if (data.isNew) {
            cId = `c_${Math.random().toString(36).substr(2, 9)}`;
            countries[cId] = {
                id: cId, name: data.name, flag: data.flag, color: data.color, socketId: socket.id,
                cells: 0, dollars: 50000, keys: 0, population: 100000, military: 10000, cap: 10000, isSpawned: false, online: true
            };
        } else {
            cId = data.countryId; 
            if (countries[cId]) {
                countries[cId].online = true; 
                countries[cId].socketId = socket.id;
            }
        }
        playerSockets[socket.id] = cId;
        socket.emit('joinSuccess', cId); 
        io.emit('initLobby', countries); 
        io.emit('updateMap', { countries, territory, regions, buildings });
    });

    socket.on('spawnCapital', (data) => {
        const cId = playerSockets[socket.id];
        const country = countries[cId];
        if (!country || country.isSpawned) return;

        country.isSpawned = true;
        const startRegionId = `reg_${cId}_cap`;
        
        regions[startRegionId] = { 
            name: "Столица", owner: cId, cells: 0, level: 1, defLevel: 0,
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
        io.emit('updateMap', { countries, territory, regions, buildings });
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

    socket.on('buildStructure', (data) => {
        const cId = playerSockets[socket.id];
        if (!cId || !territory[`${data.cx}_${data.cy}`] || territory[`${data.cx}_${data.cy}`].owner !== cId) return;
        
        const type = data.type; const stats = BUILD_COSTS[type];
        if (stats && countries[cId].dollars >= stats.cost) {
            countries[cId].dollars -= stats.cost;
            const bId = `b_${Math.random().toString(36).substr(2, 9)}`;
            buildings[bId] = { id: bId, type: type, owner: cId, x: data.cx * TILE_SIZE, y: data.cy * TILE_SIZE, hp: stats.hp };
            io.emit('syncBuildings', buildings); io.emit('updateResources', countries);
        }
    });

    socket.on('launchRocket', (data) => {
        const cId = playerSockets[socket.id];
        if (!cId || !buildings[data.siloId] || buildings[data.siloId].owner !== cId) return;
        
        const rStats = ROCKET_STATS[data.rocketType];
        if (rStats && countries[cId].dollars >= rStats.cost && countries[cId].keys >= rStats.keys) {
            countries[cId].dollars -= rStats.cost; countries[cId].keys -= rStats.keys;
            const rId = `r_${Math.random().toString(36).substr(2, 9)}`;
            rockets[rId] = { 
                id: rId, type: data.rocketType, owner: cId, 
                x: buildings[data.siloId].x, y: buildings[data.siloId].y,
                targetX: data.targetX, targetY: data.targetY, speed: rStats.speed, tier: rStats.tier
            };
            io.emit('syncRockets', rockets); io.emit('updateResources', countries);
        }
    });

    socket.on('proposeTrade', (data) => {
        const cFrom = playerSockets[socket.id];
        const cTo = data.targetId;
        if (!cFrom || !countries[cTo] || cFrom === cTo) return;

        const tradeId = `tr_${Math.random().toString(36).substr(2, 9)}`;
        pendingTrades[tradeId] = { from: cFrom, to: cTo, give: data.give, take: data.take };
        
        if (countries[cTo].socketId) {
            io.to(countries[cTo].socketId).emit('incomingTrade', { tradeId: tradeId, fromName: countries[cFrom].name, give: data.give, take: data.take });
        }
    });

    socket.on('resolveTrade', (data) => {
        const trade = pendingTrades[data.tradeId];
        if (!trade || !data.accept) { delete pendingTrades[data.tradeId]; return; }
        
        const cFrom = countries[trade.from]; const cTo = countries[trade.to];
        
        if (cFrom.dollars < trade.give.money || cFrom.keys < trade.give.keys || cFrom.military < trade.give.mil) return;
        if (cTo.dollars < trade.take.money || cTo.keys < trade.take.keys || cTo.military < trade.take.mil) return;

        cFrom.dollars -= trade.give.money; cFrom.dollars += trade.take.money;
        cTo.dollars -= trade.take.money; cTo.dollars += trade.give.money;
        
        cFrom.keys -= trade.give.keys; cFrom.keys += trade.take.keys;
        cTo.keys -= trade.take.keys; cTo.keys += trade.give.keys;

        cFrom.military -= trade.give.mil; cFrom.military += trade.take.mil;
        cTo.military -= trade.take.mil; cTo.military += trade.give.mil;

        if (trade.give.regionId && regions[trade.give.regionId] && regions[trade.give.regionId].owner === trade.from) {
            regions[trade.give.regionId].owner = trade.to;
            for (let k in territory) if (territory[k].regionId === trade.give.regionId) territory[k].owner = trade.to;
        }
        if (trade.take.regionId && regions[trade.take.regionId] && regions[trade.take.regionId].owner === trade.to) {
            regions[trade.take.regionId].owner = trade.from;
            for (let k in territory) if (territory[k].regionId === trade.take.regionId) territory[k].owner = trade.from;
        }

        delete pendingTrades[data.tradeId];
        io.emit('updateResources', countries); io.emit('syncTerritory', { territory, regions });
        io.emit('newsEvent', { title: "ДИПЛОМАТИЧЕСКОЕ СОГЛАШЕНИЕ", text: `${cFrom.name} и ${cTo.name} заключили крупный торговый договор.` });
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
                armies[id].targetX = Math.max(5, Math.min(WORLD_WIDTH - 5, data.targetX)); 
                armies[id].targetY = Math.max(5, Math.min(WORLD_HEIGHT - 5, data.targetY));
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
        io.emit('initLobby', countries); 
        delete playerSockets[socket.id];
    });
});

setInterval(() => {
    if (Object.keys(batchedCellUpdates).length > 0 || forceRegionUpdate) {
        io.emit('batchCellUpdate', { cells: batchedCellUpdates, regions, countries }); 
        batchedCellUpdates = {};
        forceRegionUpdate = false;
    }
}, 200);

setInterval(() => {
    let stateChanged = false; const now = Date.now();

    for (let rId in rockets) {
        let r = rockets[rId];
        let d = Math.hypot(r.targetX - r.x, r.targetY - r.y);
        if (d > r.speed) {
            r.x += ((r.targetX - r.x) / d) * r.speed; r.y += ((r.targetY - r.y) / d) * r.speed;
            
            for (let bId in buildings) {
                let b = buildings[bId];
                if (b.owner !== r.owner && b.type.startsWith('pvo')) {
                    const pvoStats = BUILD_COSTS[b.type];
                    if (Math.hypot(b.x - r.x, b.y - r.y) <= pvoStats.radius) {
                        if (isWithinRadar(b.owner, b.x, b.y) && isWithinRadar(b.owner, r.x, r.y)) {
                            if (pvoStats.tier >= r.tier || (Math.random() > 0.8)) { 
                                delete rockets[rId]; 
                                stateChanged = true; break;
                            }
                        }
                    }
                }
            }
            stateChanged = true;
        } else {
            const rStats = ROCKET_STATS[r.type];
            for (let aId in armies) {
                if (Math.hypot(armies[aId].x - r.x, armies[aId].y - r.y) <= rStats.dmgRad && armies[aId].owner !== r.owner) {
                    armies[aId].count -= rStats.dmg; if (armies[aId].count <= 0) delete armies[aId];
                }
            }
            for (let bId in buildings) {
                if (Math.hypot(buildings[bId].x - r.x, buildings[bId].y - r.y) <= rStats.dmgRad && buildings[bId].owner !== r.owner) {
                    buildings[bId].hp -= rStats.dmg; if (buildings[bId].hp <= 0) delete buildings[bId];
                }
            }
            delete rockets[rId]; stateChanged = true;
        }
    }

    const armyIds = Object.keys(armies);
    
    // 1. ОЧИСТКА
    armyIds.forEach(id => { armies[id].targets = []; armies[id].dmg = 0; });

    // 2. СНАЧАЛА ПРОСЧИТЫВАЕМ БОЙ И КОЛЛИЗИЮ (ИСПРАВЛЕН ПОРЯДОК!)
    for (let i = 0; i < armyIds.length; i++) {
        const a = armies[armyIds[i]];
        for (let j = i + 1; j < armyIds.length; j++) {
            const b = armies[armyIds[j]]; 
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            
            // Если враги на дистанции огня - они СТОПОРЯТСЯ И СТРЕЛЯЮТ
            if (a.owner !== b.owner && d < ENGAGE_RADIUS) {
                a.targets.push(b.id); 
                b.targets.push(a.id); 
                a.targetX = null; // Приказ стоять
                b.targetX = null; // Приказ стоять
            }
            
            // Мягкая коллизия (если подошли слишком близко друг к другу)
            if (d < COLLISION_RADIUS * 2 && d > 0) {
                const p = (COLLISION_RADIUS * 2 - d) * 0.1;
                const ang = Math.atan2(a.y - b.y, a.x - b.x);
                a.x += Math.cos(ang) * p; a.y += Math.sin(ang) * p; 
                b.x -= Math.cos(ang) * p; b.y -= Math.sin(ang) * p; 
                stateChanged = true;
            }
        }
    }

    // 3. ЗАТЕМ ДВИЖЕНИЕ (ЕСЛИ НЕ В БОЮ)
    armyIds.forEach(id => {
        const a = armies[id]; 
        const cellKey = `${Math.floor(a.x/TILE_SIZE)}_${Math.floor(a.y/TILE_SIZE)}`;
        const cell = territory[cellKey]; 
        let currentSpeed = a.speed || 0.3;

        if (!cell || cell.owner !== a.owner) {
            currentSpeed = 0.15; // Раньше тут было 0.05, поэтому они вязли!
            if (!territory[cellKey]) territory[cellKey] = { owner: null, captureProgress: 0 };
            territory[cellKey].captureProgress = (territory[cellKey].captureProgress || 0) + 1;
            
            if (territory[cellKey].captureProgress > 20) { 
                const oldOwner = territory[cellKey].owner;
                if (oldOwner && countries[oldOwner]) countries[oldOwner].cells--;
                
                const newRegId = `reg_${a.owner}_cap`;
                territory[cellKey] = { owner: a.owner, regionId: newRegId, captureProgress: 0 };
                countries[a.owner].cells++;
                batchedCellUpdates[cellKey] = territory[cellKey]; 
                
                for(let bId in buildings) {
                    if (Math.floor(buildings[bId].x/TILE_SIZE) === Math.floor(a.x/TILE_SIZE) && Math.floor(buildings[bId].y/TILE_SIZE) === Math.floor(a.y/TILE_SIZE)) {
                        buildings[bId].owner = a.owner; stateChanged = true;
                    }
                }
                mapChangedForCauldrons = true;
            }
        }
        
        // Движемся только если нет таргетов (не в бою)
        if (a.targets.length === 0 && a.targetX !== null) {
            const d = Math.hypot(a.targetX - a.x, a.targetY - a.y);
            if (d > currentSpeed) { 
                a.x += ((a.targetX-a.x)/d)*currentSpeed; 
                a.y += ((a.targetY-a.y)/d)*currentSpeed; 
                stateChanged = true; 
            } else { 
                a.targetX = null; 
            }
        }
    });

    // 4. НАНЕСЕНИЕ УРОНА (РАСЧЕТ МАССОВКИ)
    armyIds.forEach(id => {
        const a = armies[id];
        if (a.targets.length) { 
            const t = armies[a.targets[0]]; 
            if (t) {
                // Если армию 't' бьют несколько отрядов, урон каждого умножается!
                t.dmg += (a.count * 0.015) * (1 + (t.targets.length - 1) * 0.5); 
            }
        }
    });

    armyIds.forEach(id => {
        if (armies[id].dmg > 0) { armies[id].count -= armies[id].dmg; stateChanged = true; }
        if (armies[id].count <= 0) delete armies[id];
    });

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
            forceRegionUpdate = true;
            
            if (reg.siegeProgress >= 90) { 
                const oldOwner = reg.owner; reg.owner = beingSiegedBy; reg.siegeProgress = 0;
                for (const k in territory) {
                    if (territory[k].regionId === rId) {
                        if (countries[oldOwner]) countries[oldOwner].cells--;
                        territory[k].owner = beingSiegedBy; territory[k].captureProgress = 0;
                        if (countries[beingSiegedBy]) countries[beingSiegedBy].cells++;
                        batchedCellUpdates[k] = territory[k]; 
                    }
                }
                io.emit('newsEvent', { title: "ПАДЕНИЕ РЕГИОНА", text: `Регион ${reg.name} захвачен войсками ${countries[beingSiegedBy].name}!` });
                io.emit('updateMap', { countries, territory, regions, buildings });
            }
        } else { reg.siegeProgress = 0; }
    }

    for (let i = pendingDeployments.length - 1; i >= 0; i--) {
        const dep = pendingDeployments[i];
        if (now >= dep.readyAt) {
            const reg = regions[dep.regionId];
            if (reg && reg.owner === dep.owner) {
                armies[`a_${Math.random().toString(36).substr(2)}`] = { owner: dep.owner, count: dep.amount, x: reg.cityX*TILE_SIZE, y: reg.cityY*TILE_SIZE, targetX: null, targetY: null, speed: 0.3 }; stateChanged = true;
            } else { if (countries[dep.owner]) countries[dep.owner].military += dep.amount; }
            pendingDeployments.splice(i, 1); io.emit('updateResources', countries);
        }
    }

    if (stateChanged) { io.emit('syncArmies', armies); io.emit('syncBuildings', buildings); io.emit('syncRockets', rockets); }
}, 33);

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
                batchedCellUpdates[k] = territory[k]; 
            }
        });
        return;
    }
    
    if (!mapChangedForCauldrons) return;
    let armyLocs = {}; for(let id in armies) { let k = `${Math.floor(armies[id].x/TILE_SIZE)}_${Math.floor(armies[id].y/TILE_SIZE)}`; if(!armyLocs[k]) armyLocs[k] = []; armyLocs[k].push(armies[id].owner); }
    
    let checked = 0;

    let totalOwnedCells = 0;
    for (let c in countries) { if(countries[c].isSpawned) totalOwnedCells += countries[c].cells; }

    while (checked < 3000) {
        let idx = sY * gridW + sX;
        if (vstd[idx] === 0) {
            const startOwner = territory[`${sX}_${sY}`] ? territory[`${sX}_${sY}`].owner : null;
            
            if (startOwner === null && totalOwnedCells < 40) {
                vstd[idx] = 1; sX++; checked++; 
                if (sX >= gridW) { sX = 0; sY++; if (sY >= gridH) { sY = 0; mapChangedForCauldrons = false; vstd.fill(0); break; } }
                continue;
            }

            let h = 0, t = 0, edge = false, owners = new Set(), comp = [];
            let hasDefendingArmy = false;
            qX[t] = sX; qY[t] = sY; t++; vstd[idx] = 1;
            
            while(h < t) {
                let cx = qX[h]; let cy = qY[h]; h++; comp.push({x: cx, y: cy});
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
                            owners.add(nOwn === null ? 'neutral' : nOwn); 
                        }
                    }
                });
            }
            if (!edge && owners.size === 1 && !hasDefendingArmy) {
                let winId = Array.from(owners)[0];
                if (winId !== startOwner && winId !== 'neutral') { 
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
    let factoryCounts = {};
    for (let b in buildings) { if (buildings[b].type === 'factory') { factoryCounts[buildings[b].owner] = (factoryCounts[buildings[b].owner] || 0) + 1; } }

    for (let id in countries) {
        if (!countries[id].isSpawned) continue;
        countries[id].population += Math.floor(countries[id].cells * 0.5);
        countries[id].cap = Math.floor(countries[id].population * 0.1);
        
        let main = 0; for (let a in armies) if (armies[a].owner === id) main += armies[a].count * 1; 
        let inc = 100 - main;
        for (let r in regions) if (regions[r].owner === id) inc += regions[r].cells * 1.5 * regions[r].level;
        
        countries[id].dollars += inc; countries[id].lastIncome = inc;
        
        if (factoryCounts[id]) countries[id].keys += factoryCounts[id] * 5;

        if (countries[id].military < countries[id].cap) {
            countries[id].military += Math.floor(countries[id].cells * 2);
            if (countries[id].military > countries[id].cap) countries[id].military = countries[id].cap;
        }
        changed = true;
    }
    if (changed) io.emit('updateResources', countries);
}, 1000);

server.listen(process.env.PORT || 3000, () => console.log('HOI4 ENGINE FULLY ONLINE'));
