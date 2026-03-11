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
                population: 100000, // НАСЕЛЕНИЕ (Старт со 100 тыс.)
                military: 10000, // Со старта даем максимум
                cap: 10000, // 10% от 100,000
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
        
        // Отправляем глобальную новость
        io.emit('newsEvent', { title: "НОВОЕ ГОСУДАРСТВО", text: `На мировой арене появилась новая сила: ${country.name}. Мировое сообщество напряжено.` });
    });

    // ... (Обработчики lassoRegion, renameRegion, upgradeRegion, deployArmies остаются без изменений, они работают отлично) ...
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
            if (countries[cId].dollars >= cost) { countries[cId].dollars -= cost; reg.level++; io.emit('syncTerritory', { territory, regions }); }
        }
    });

    socket.on('deployArmy', (data) => {
        const cId = playerSockets[socket.id]; const reg = regions[data.regionId];
        if (reg && reg.owner === cId && countries[cId].military >= data.amount) {
            countries[cId].military -= data.amount;
            const id = Math.random().toString(36).substr(2, 9);
            armies[id] = { id, owner: cId, count: parseInt(data.amount), x: reg.cityX*TILE_SIZE, y: reg.cityY*TILE_SIZE, targetX: null, targetY: null, speed: 0.3 };
            io.emit('syncArmies', armies);
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
        io.emit('syncArmies', armies);
    });
});

// --- ГЛАВНЫЙ ИГРОВОЙ ЦИКЛ (30 FPS) ---
setInterval(() => {
    let stateChanged = false;
    const armyIds = Object.keys(armies);

    armyIds.forEach(id => { armies[id].targets = []; armies[id].dmg = 0; });

    // 1. ОСАДА ГОРОДОВ (Теперь нужно время, а не мгновенно)
    for (const rId in regions) {
        const reg = regions[rId];
        let beingSiegedBy = null;

        for (let i = 0; i < armyIds.length; i++) {
            const a = armies[armyIds[i]];
            if (reg.cityX !== undefined && Math.floor(a.x/TILE_SIZE) === reg.cityX && Math.floor(a.y/TILE_SIZE) === reg.cityY && a.owner !== reg.owner) {
                beingSiegedBy = a.owner; break; // Нашли врага в городе
            }
        }

        if (beingSiegedBy) {
            reg.siegeProgress = (reg.siegeProgress || 0) + 1;
            // 90 тиков = 3 секунды стояния на городе для его захвата
            if (reg.siegeProgress >= 90) {
                const oldOwner = reg.owner;
                reg.owner = beingSiegedBy;
                reg.siegeProgress = 0;
                for (const k in territory) {
                    if (territory[k].regionId === rId) {
                        if (countries[oldOwner]) countries[oldOwner].cells--;
                        territory[k].owner = beingSiegedBy;
                        territory[k].captureProgress = 0;
                        if (countries[beingSiegedBy]) countries[beingSiegedBy].cells++;
                    }
                }
                io.emit('newsEvent', { title: "ПАДЕНИЕ РЕГИОНА", text: `Регион ${reg.name} был захвачен войсками ${countries[beingSiegedBy].name}!` });
                io.emit('updateMap', { countries, territory, regions });
            }
        } else {
            reg.siegeProgress = 0; // Сброс, если враг ушел
        }
    }

    // 2. ДВИЖЕНИЕ И ТЯЖЕЛЫЙ ЗАХВАТ ТЕРРИТОРИИ
    armyIds.forEach(id => {
        const a = armies[id];
        const cellX = Math.floor(a.x/TILE_SIZE); const cellY = Math.floor(a.y/TILE_SIZE);
        const cellKey = `${cellX}_${cellY}`;
        const cell = territory[cellKey];
        
        let currentSpeed = a.speed;

        // Если клетка чужая, армия вязнет в боях
        if (cell && cell.owner !== a.owner) {
            currentSpeed = 0.05; // СИЛЬНОЕ замедление (Эффект сопротивления фронта)
            
            // Если есть защита региона, получаем урон
            if (regions[cell.regionId]) {
                a.dmg += ((regions[cell.regionId].defLevel || 0) * 50) / 30; 
            }

            // Медленный захват обычной клетки
            cell.captureProgress = (cell.captureProgress || 0) + 1;
            if (cell.captureProgress > 20) { // Около 0.6 сек на 1 пиксель земли
                const oldOwner = cell.owner;
                if (countries[oldOwner]) countries[oldOwner].cells--;
                if (regions[cell.regionId]) regions[cell.regionId].cells--;
                
                const newRegId = `reg_${a.owner}_cap`;
                territory[cellKey] = { owner: a.owner, regionId: newRegId, captureProgress: 0 };
                
                countries[a.owner].cells++;
                if (regions[newRegId]) regions[newRegId].cells++;
                io.emit('cellUpdate', { key: cellKey, cell: territory[cellKey], regions, countries });
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

    // ... (Код урона друг по другу (Ланчестер) остается тем же) ...
    armyIds.forEach(id => {
        if (armies[id].dmg > 0) { armies[id].count -= armies[id].dmg; stateChanged = true; }
        if (armies[id].count <= 0) delete armies[id];
    });

    if (stateChanged) io.emit('syncArmies', armies);
}, 33);

// --- ДЕМОГРАФИЯ И ЭКОНОМИКА (1 раз в секунду) ---
setInterval(() => {
    let changed = false;
    for (let id in countries) {
        if (!countries[id].isSpawned) continue;
        
        // Рост населения (зависит от размера территории)
        const popGrowth = Math.floor(countries[id].cells * 0.5);
        countries[id].population += popGrowth;
        
        // Лимит военных (10% от населения)
        countries[id].cap = Math.floor(countries[id].population * 0.1);

        let main = 0;
        for (let a in armies) if (armies[a].owner === id) main += armies[a].count * 0.1;
        let inc = 100 - main;
        for (let r in regions) if (regions[r].owner === id) inc += regions[r].cells * 1.5 * regions[r].level;
        
        countries[id].dollars += inc; countries[id].lastIncome = inc;
        
        // Пассивный прирост рекрутов
        if (countries[id].military < countries[id].cap) {
            countries[id].military += Math.floor(countries[id].cells * 2);
            if (countries[id].military > countries[id].cap) countries[id].military = countries[id].cap;
        }
        changed = true;
    }
    if (changed) io.emit('updateResources', countries);
}, 1000);

server.listen(process.env.PORT || 3000, () => console.log('HOI4 ENGINE ONLINE'));
