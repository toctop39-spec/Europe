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

function createRoom(roomId, presetData = null) {
    let room = {
        id: roomId, countries: {}, cities: {}, armies: {}, pendingDeployments: []
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
        socket.join(roomId); playerToRoom[socket.id] = roomId; callback({ success: true });
        socket.emit('initLobby', rooms[roomId].countries);
        socket.emit('initData', { countries: rooms[roomId].countries, cities: rooms[roomId].cities, armies: rooms[roomId].armies });
    });

    socket.on('createRoom', (data, callback) => {
        const newCode = Math.random().toString(36).substr(2, 5).toUpperCase();
        createRoom(newCode, data.presetName ? presets[data.presetName] : null);
        socket.join(newCode); playerToRoom[socket.id] = newCode; callback({ success: true, roomId: newCode });
        socket.emit('initLobby', rooms[newCode].countries);
        socket.emit('initData', { countries: rooms[newCode].countries, cities: rooms[newCode].cities, armies: rooms[newCode].armies });
    });

    socket.on('savePreset', (presetName) => {
        const roomId = playerToRoom[socket.id]; if (!roomId || !rooms[roomId]) return;
        let savedCountries = JSON.parse(JSON.stringify(rooms[roomId].countries));
        for(let k in savedCountries) { savedCountries[k].socketId = null; savedCountries[k].online = false; }
        presets[presetName] = { countries: savedCountries, cities: JSON.parse(JSON.stringify(rooms[roomId].cities)) };
        socket.emit('presetSaved');
    });

    socket.on('joinGame', (data) => {
        const roomId = playerToRoom[socket.id] || 'MAIN'; if (!rooms[roomId]) return; const room = rooms[roomId];
        for (let k in room.countries) { if (room.countries[k].socketId === socket.id) room.countries[k].socketId = null; }
        let cId;
        if (data.isNew) {
            cId = `c_${Math.random().toString(36).substr(2, 9)}`;
            room.countries[cId] = { id: cId, name: data.name, flag: data.flag, color: data.color, socketId: socket.id, cells: 0, dollars: 10000, population: 100000, military: 10000, cap: 10000, isSpawned: false, online: true };
        } else {
            cId = data.countryId; if (room.countries[cId]) { room.countries[cId].online = true; room.countries[cId].socketId = socket.id; }
        }
        socket.emit('joinSuccess', cId); io.to(roomId).emit('initLobby', room.countries); io.to(roomId).emit('updateMap', { countries: room.countries, cities: room.cities });
    });

    socket.on('switchCountry', (cId) => {
        const roomId = playerToRoom[socket.id]; if (!roomId || !rooms[roomId]) return; const room = rooms[roomId];
        if (room.countries[cId]) {
            for (let k in room.countries) if (room.countries[k].socketId === socket.id) room.countries[k].socketId = null;
            room.countries[cId].socketId = socket.id; socket.emit('joinSuccess', cId); io.to(roomId).emit('updateMap', { countries: room.countries, cities: room.cities });
        }
    });

    socket.on('spawnCapital', (data) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        if (!room.countries[cId] || room.countries[cId].isSpawned) return;
        room.countries[cId].isSpawned = true;
        const cityId = `city_${Math.random().toString(36).substr(2, 9)}`;
        room.cities[cityId] = { id: cityId, name: "Штаб", owner: cId, x: data.x, y: data.y, level: 2, siege: 0 };
        io.to(roomId).emit('updateMap', { countries: room.countries, cities: room.cities });
    });

    socket.on('buildCity', (armyId) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        const army = room.armies[armyId];
        if (army && army.owner === cId && army.count >= 1000) {
            army.count -= 1000;
            const cityId = `city_${Math.random().toString(36).substr(2, 9)}`;
            room.cities[cityId] = { id: cityId, name: "Форпост", owner: cId, x: army.x, y: army.y, level: 1, siege: 0 };
            io.to(roomId).emit('updateMap', { countries: room.countries, cities: room.cities });
        }
    });

    socket.on('deployArmy', (data) => {
        const roomId = playerToRoom[socket.id]; if (!roomId) return; const room = rooms[roomId];
        const cId = Object.keys(room.countries).find(key => room.countries[key].socketId === socket.id);
        if (room.cities[data.cityId] && room.cities[data.cityId].owner === cId && room.countries[cId].military >= data.amount) {
            room.countries[cId].military -= data.amount;
            room.pendingDeployments.push({ owner: cId, amount: parseInt(data.amount), cityId: data.cityId, readyAt: Date.now() + 3000 });
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
            }
        });
    });
    
    socket.on('disconnect', () => { delete playerToRoom[socket.id]; });
});

// ГЛАВНЫЙ ЦИКЛ БОЯ И ДВИЖЕНИЯ
setInterval(() => {
    const now = Date.now();
    for (let roomId in rooms) {
        let room = rooms[roomId]; let stateChanged = false;

        for (let i = room.pendingDeployments.length - 1; i >= 0; i--) {
            const dep = room.pendingDeployments[i];
            if (now >= dep.readyAt) {
                const city = room.cities[dep.cityId];
                if (city && city.owner === dep.owner) {
                    const id = `a_${Math.random().toString(36).substr(2, 9)}`;
                    room.armies[id] = { id, owner: dep.owner, count: dep.amount, x: city.x, y: city.y, targetX: null, targetY: null };
                    stateChanged = true;
                } else { if (room.countries[dep.owner]) room.countries[dep.owner].military += dep.amount; }
                room.pendingDeployments.splice(i, 1); io.to(roomId).emit('updateResources', room.countries);
            }
        }

        const armyIds = Object.keys(room.armies);
        armyIds.forEach(id => room.armies[id].dmg = 0);

        for (let i = 0; i < armyIds.length; i++) {
            const a = room.armies[armyIds[i]];
            // Движение
            if (a.targetX !== null) {
                const d = Math.hypot(a.targetX - a.x, a.targetY - a.y);
                const speed = 1.0; 
                if (d > speed) { a.x += ((a.targetX-a.x)/d)*speed; a.y += ((a.targetY-a.y)/d)*speed; stateChanged = true; } else { a.targetX = null; }
            }
            // Бой с другими армиями (радиус столкновения)
            for (let j = i + 1; j < armyIds.length; j++) {
                const b = room.armies[armyIds[j]]; const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d < 30 && a.owner !== b.owner) { a.dmg += (b.count * 0.02); b.dmg += (a.count * 0.02); a.targetX = null; b.targetX = null; }
            }
            // Осада городов
            for (let cId in room.cities) {
                const city = room.cities[cId]; const d = Math.hypot(a.x - city.x, a.y - city.y);
                if (d < 30 && a.owner !== city.owner) {
                    city.siege += (a.count * 0.01); a.targetX = null;
                    if (city.siege > city.level * 1000) { city.owner = a.owner; city.siege = 0; io.to(roomId).emit('updateMap', { countries: room.countries, cities: room.cities }); }
                } else if (a.owner === city.owner && city.siege > 0) { city.siege = Math.max(0, city.siege - 50); }
            }
        }

        armyIds.forEach(id => {
            if (room.armies[id].dmg > 0) { room.armies[id].count -= room.armies[id].dmg; stateChanged = true; }
            if (room.armies[id].count <= 0) delete room.armies[id];
        });

        if (stateChanged) io.to(roomId).emit('syncArmies', room.armies);
    }
}, 33);

// ЦИКЛ ЭКОНОМИКИ (КАРТА ВЛИЯНИЯ НА СЕРВЕРЕ)
setInterval(() => {
    for (let roomId in rooms) {
        let room = rooms[roomId]; let changed = false;
        
        // Сервер строит "сетку влияния" для подсчета площади
        let areaCounts = {};
        const step = 20; 
        for (let x = 0; x < WORLD_WIDTH; x += step) {
            for (let y = 0; y < WORLD_HEIGHT; y += step) {
                let infByOwner = {};
                for(let id in room.cities) {
                    let dx = (x - room.cities[id].x)/1000; let dy = (y - room.cities[id].y)/1000;
                    infByOwner[room.cities[id].owner] = (infByOwner[room.cities[id].owner] || 0) + (1.0 + room.cities[id].level*0.2) / Math.exp((dx*dx+dy*dy)*45);
                }
                for(let id in room.armies) {
                    let dx = (x - room.armies[id].x)/1000; let dy = (y - room.armies[id].y)/1000;
                    infByOwner[room.armies[id].owner] = (infByOwner[room.armies[id].owner] || 0) + (0.5 + room.armies[id].count/10000) / Math.exp((dx*dx+dy*dy)*45);
                }
                let maxInf = 0; let bestOwner = null;
                for(let o in infByOwner) { if(infByOwner[o] > maxInf) { maxInf = infByOwner[o]; bestOwner = o; } }
                if (maxInf > 0.05 && bestOwner) { areaCounts[bestOwner] = (areaCounts[bestOwner] || 0) + 1; }
            }
        }

        for (let id in room.countries) {
            if (!room.countries[id].isSpawned) continue;
            room.countries[id].cells = areaCounts[id] || 0;
            room.countries[id].population += Math.floor(room.countries[id].cells * 5);
            room.countries[id].cap = 10000 + Math.floor(room.countries[id].population * 0.1);
            let main = 0; for (let a in room.armies) if (room.armies[a].owner === id) main += room.armies[a].count; 
            let inc = (room.countries[id].cells * 10) - Math.floor(main * 0.01);
            room.countries[id].dollars += inc; room.countries[id].lastIncome = inc;
            if (room.countries[id].military < room.countries[id].cap) {
                room.countries[id].military += Math.floor(room.countries[id].cells * 5);
                if (room.countries[id].military > room.countries[id].cap) room.countries[id].military = room.countries[id].cap;
            }
            changed = true;
        }
        if (changed) io.to(roomId).emit('updateResources', room.countries);
    }
}, 1000);

server.listen(process.env.PORT || 3000, () => console.log('HOI4 INFLUENCE ENGINE ONLINE'));
