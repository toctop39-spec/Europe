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

// ФОРМУЛЫ РАДИУСОВ (Зон влияния)
function getArmyRadius(count) { return Math.max(15, Math.min(250, Math.sqrt(count) * 0.8)); }
function getCityRadius(level) { return 40 + (level * 15); }

function createRoom(roomId, presetData = null) {
    let room = {
        id: roomId,
        countries: {},
        cities: {}, // Раньше были regions
        armies: {},
        pendingDeployments: []
    };
    if (presetData) {
        room.countries = JSON.parse(JSON.stringify(presetData.countries));
        room.cities = JSON.parse(JSON.stringify(presetData.cities));
    }
    rooms[roomId] = room; return room;
}

createRoom('MAIN');

io.on('connection', (socket) => {
    
    socket.on('joinRoom', (roomId, callback) => {
        if (!rooms[roomId]) return callback({ success: false, msg: "Комната не найдена" });
        socket.join(roomId); playerToRoom[socket.id] = roomId;
        callback({ success: true });
        const room = rooms[roomId];
        socket.emit('initLobby', room.countries);
        socket.emit('initData', { countries: room.countries, cities: room.cities, armies: room.armies });
    });

    socket.on('createRoom', (data, callback) => {
        const newCode = Math.random().toString(36).substr(2, 5).toUpperCase();
        let preset = data.presetName ? presets[data.presetName] : null;
        createRoom(newCode, preset);
        socket.join(newCode); playerToRoom[socket.id] = newCode;
        callback({ success: true, roomId: newCode });
        const room = rooms[newCode];
        socket.emit('initLobby', room.countries);
        socket.emit('initData', { countries: room.countries, cities: room.cities, armies: room.armies });
    });

    socket.on('savePreset', (presetName) => {
        const roomId = playerToRoom[socket.id]; if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        let savedCountries = JSON.parse(JSON.stringify(room.countries));
        for(let k in savedCountries) { savedCountries[k].socketId = null; savedCountries[k].online = false; }
        presets[presetName] = { countries: savedCountries, cities: JSON.parse(JSON.stringify(room.cities)) };
        socket.emit('presetSaved');
    });

    socket.on('joinGame', (data) => {
        const roomId = playerToRoom[socket.id] || 'MAIN'; if (!rooms[roomId]) return;
        const room = rooms[roomId];
        for (let k in room.countries) { if (room.countries[k].socketId === socket.id) room.countries[k].socketId = null; }
        let cId;
        if (data.isNew) {
            cId = `c_${Math.random().toString(36).substr(2, 9)}`;
            room.countries[cId] = { id: cId, name: data.name, flag: data.flag, color: data.color, socketId: socket.id, dollars: 10000, population: 10000, military: 5000, cap: 10000, isSpawned: false, online: true };
        } else {
            cId = data.countryId; if (room.countries[cId]) { room.countries[cId].online = true; room.countries[cId].socketId = socket.id; }
        }
        socket.emit('joinSuccess', cId); 
        io.to(roomId).emit('initLobby', room.countries);
        io.to(roomId).emit('updateMap', { countries: room.countries, cities: room.cities });
    });

    socket.on('switchCountry', (cId) => {
        const roomId = playerToRoom[socket.id]; if (!roomId || !rooms[roomId]) return; const room = rooms[roomId];
        if (room.countries[cId]) {
            for (let k in room.countries) { if (room.countries[k].socketId === socket.id) room.countries[k].socketId = null; }
            room.countries[cId].socketId = socket.id; socket.emit('joinSuccess', cId);
            io.to(roomId).emit('updateMap', { countries: room.countries, cities: room.cities });
        }
    });

    // СПАВН СТОЛИЦЫ (ПЕРВАЯ ТОЧКА)
    socket.on('spawnCapital', (data) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        const country = room.countries[cId];
        if (!country || country.isSpawned) return;

        country.isSpawned = true;
        const cityId = `city_${Math.random().toString(36).substr(2, 9)}`;
        room.cities[cityId] = { id: cityId, name: "Столица", owner: cId, x: data.x, y: data.y, level: 2, siege: 0 };
        io.to(roomId).emit('updateMap', { countries: room.countries, cities: room.cities });
    });

    // ПОСТРОЙКА НОВОГО ГОРОДА ИЗ АРМИИ
    socket.on('buildCity', (armyId) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        const army = room.armies[armyId];
        if (army && army.owner === cId && army.count >= 1000) {
            // Проверка, нет ли рядом других городов
            let tooClose = false;
            for(let id in room.cities) { if (Math.hypot(room.cities[id].x - army.x, room.cities[id].y - army.y) < 150) tooClose = true; }
            if (tooClose) { socket.emit('newsEvent', { title: "ОШИБКА", text: "Слишком близко к другому городу!" }); return; }

            army.count -= 1000;
            const cityId = `city_${Math.random().toString(36).substr(2, 9)}`;
            room.cities[cityId] = { id: cityId, name: "Новый город", owner: cId, x: army.x, y: army.y, level: 1, siege: 0 };
            io.to(roomId).emit('updateMap', { countries: room.countries, cities: room.cities });
        } else { socket.emit('newsEvent', { title: "ОШИБКА", text: "Нужно минимум 1000 войск для основания города!" }); }
    });

    socket.on('deployArmy', (data) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        const city = room.cities[data.cityId];
        if (city && city.owner === cId) {
            if (room.countries[cId].military >= data.amount) {
                room.countries[cId].military -= data.amount;
                room.pendingDeployments.push({ owner: cId, amount: parseInt(data.amount), cityId: data.cityId, readyAt: Date.now() + 5000 });
                io.to(roomId).emit('updateResources', room.countries);
            }
        }
    });

    socket.on('moveArmies', (data) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        data.armyIds.forEach(id => {
            if (room.armies[id] && room.armies[id].owner === cId) {
                room.armies[id].targetX = Math.max(5, Math.min(WORLD_WIDTH - 5, data.targetX)); 
                room.armies[id].targetY = Math.max(5, Math.min(WORLD_HEIGHT - 5, data.targetY));
            }
        });
    });

    socket.on('upgradeCity', (cityId) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        const city = room.cities[cityId];
        if (city && city.owner === cId && city.level < 10) {
            const cost = city.level * 5000;
            if (room.countries[cId].dollars >= cost) {
                room.countries[cId].dollars -= cost; city.level++;
                io.to(roomId).emit('updateMap', { countries: room.countries, cities: room.cities });
                io.to(roomId).emit('updateResources', room.countries);
            }
        }
    });

    socket.on('renameCity', (data) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        const city = room.cities[data.cityId];
        if (city && city.owner === cId && data.newName) { city.name = data.newName.substring(0, 20); io.to(roomId).emit('updateMap', { countries: room.countries, cities: room.cities }); }
    });
    
    socket.on('disconnect', () => {
        const roomId = playerToRoom[socket.id];
        if (roomId && rooms[roomId]) {
            const cId = Object.keys(rooms[roomId].countries).find(key => rooms[roomId].countries[key].socketId === socket.id);
            if (cId) rooms[roomId].countries[cId].online = false;
            io.to(roomId).emit('initLobby', rooms[roomId].countries); 
        }
        delete playerToRoom[socket.id];
    });
});

// ГЛАВНЫЙ ИГРОВОЙ ЦИКЛ (ФИЗИКА И БОЙ)
setInterval(() => {
    const now = Date.now();
    for (let roomId in rooms) {
        let room = rooms[roomId];
        let stateChanged = false;

        // Развертывание
        for (let i = room.pendingDeployments.length - 1; i >= 0; i--) {
            const dep = room.pendingDeployments[i];
            if (now >= dep.readyAt) {
                const city = room.cities[dep.cityId];
                if (city && city.owner === dep.owner) {
                    const id = `a_${Math.random().toString(36).substr(2, 9)}`;
                    // Базовая скорость 1.5, но чем больше армия, тем она чуть медленнее
                    room.armies[id] = { id, owner: dep.owner, count: dep.amount, x: city.x, y: city.y, targetX: null, targetY: null };
                    stateChanged = true;
                } else { if (room.countries[dep.owner]) room.countries[dep.owner].military += dep.amount; }
                room.pendingDeployments.splice(i, 1); io.to(roomId).emit('updateResources', room.countries);
            }
        }

        const armyIds = Object.keys(room.armies);
        armyIds.forEach(id => { room.armies[id].dmg = 0; room.armies[id].inCombat = false; });

        // БОЙ МЕЖДУ АРМИЯМИ (Столкновение зон влияния)
        for (let i = 0; i < armyIds.length; i++) {
            const a = room.armies[armyIds[i]];
            const rA = getArmyRadius(a.count);
            for (let j = i + 1; j < armyIds.length; j++) {
                const b = room.armies[armyIds[j]]; 
                const rB = getArmyRadius(b.count);
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                
                // Если зоны соприкасаются
                if (d < rA + rB) {
                    if (a.owner !== b.owner) { 
                        // Нанесение урона друг другу
                        a.dmg += (b.count * 0.02); b.dmg += (a.count * 0.02);
                        a.inCombat = true; b.inCombat = true;
                        a.targetX = null; b.targetX = null; // Остановка для боя
                    } else {
                        // Толкание своих же, чтобы не слипались в 1 точку
                        const overlap = (rA + rB) - d;
                        if (overlap > 5 && d > 0) {
                            const p = overlap * 0.05; const ang = Math.atan2(a.y-b.y, a.x-b.x); 
                            a.x += Math.cos(ang)*p; a.y += Math.sin(ang)*p; b.x -= Math.cos(ang)*p; b.y -= Math.sin(ang)*p; stateChanged = true; 
                        }
                    }
                }
            }
            
            // ОСАДА ГОРОДОВ
            for (let cId in room.cities) {
                const city = room.cities[cId];
                const rCity = getCityRadius(city.level);
                const d = Math.hypot(a.x - city.x, a.y - city.y);
                
                if (d < rA + rCity && a.owner !== city.owner) {
                    a.inCombat = true; a.targetX = null;
                    city.siege += (a.count * 0.01);
                    if (city.siege >= city.level * 2000) {
                        city.owner = a.owner; city.siege = 0; city.level = Math.max(1, city.level - 1);
                        io.to(roomId).emit('newsEvent', { title: "ГОРОД ЗАХВАЧЕН", text: `Город ${city.name} пал под натиском врага!` });
                        io.to(roomId).emit('updateMap', { countries: room.countries, cities: room.cities });
                    }
                } else if (a.owner === city.owner && city.siege > 0) {
                    city.siege = Math.max(0, city.siege - 50); // Восстановление
                }
            }
        }

        // ДВИЖЕНИЕ АРМИЙ
        armyIds.forEach(id => {
            const a = room.armies[id];
            if (!a.inCombat && a.targetX !== null) {
                const d = Math.hypot(a.targetX - a.x, a.targetY - a.y);
                const speed = Math.max(0.5, 2.5 - (a.count / 50000)); // Крупные армии чуть медленнее
                if (d > speed) { a.x += ((a.targetX-a.x)/d)*speed; a.y += ((a.targetY-a.y)/d)*speed; stateChanged = true; } else { a.targetX = null; }
            }
        });

        // ПРИМЕНЕНИЕ УРОНА
        armyIds.forEach(id => {
            if (room.armies[id].dmg > 0) { room.armies[id].count -= room.armies[id].dmg; stateChanged = true; }
            if (room.armies[id].count <= 0) delete room.armies[id];
        });

        if (stateChanged) io.to(roomId).emit('syncArmies', room.armies);
    }
}, 33);

// ЭКОНОМИКА (1 РАЗ В СЕКУНДУ)
setInterval(() => {
    for (let roomId in rooms) {
        let room = rooms[roomId]; let changed = false;
        
        let cityCounts = {}; let cityLevels = {};
        for(let c in room.cities) {
            const owner = room.cities[c].owner;
            cityCounts[owner] = (cityCounts[owner] || 0) + 1;
            cityLevels[owner] = (cityLevels[owner] || 0) + room.cities[c].level;
        }

        for (let id in room.countries) {
            if (!room.countries[id].isSpawned) continue;
            
            const nodes = cityCounts[id] || 0;
            const levels = cityLevels[id] || 0;

            room.countries[id].population += nodes * 50;
            room.countries[id].cap = 10000 + (levels * 5000);
            
            let main = 0; for (let a in room.armies) if (room.armies[a].owner === id) main += room.armies[a].count; 
            
            let inc = (levels * 250) - Math.floor(main * 0.01); // Доход зависит от уровня городов минус содержание армии
            room.countries[id].dollars += inc; room.countries[id].lastIncome = inc;
            
            if (room.countries[id].military < room.countries[id].cap) {
                room.countries[id].military += nodes * 150;
                if (room.countries[id].military > room.countries[id].cap) room.countries[id].military = room.countries[id].cap;
            }
            changed = true;
        }
        if (changed) io.to(roomId).emit('updateResources', room.countries);
    }
}, 1000);

server.listen(process.env.PORT || 3000, () => console.log('HOI4 VECTOR ENGINE ONLINE'));
