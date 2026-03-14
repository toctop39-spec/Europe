const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const WORLD_WIDTH = 1920; 
const WORLD_HEIGHT = 1080;
const TILE_SIZE = 5; 
const KM_PER_TILE = 250; 

canvas.width = WORLD_WIDTH; 
canvas.height = WORLD_HEIGHT;

let territory = {}; let countries = {}; let armies = {}; let regions = {};
let myId = null; let currentRoomId = null; let isPlaying = false; let isSpawned = false;
let isEditorMode = false;

let visualArmies = {}; let camera = { x: 0, y: 0, zoom: 1 };
let isPanning = false; let lastMouse = {x: 0, y: 0};
let selectedArmies = []; let isSelecting = false; let selectionBox = { startX: 0, startY: 0, endX: 0, endY: 0 };
let isDrawingRegion = false; let currentDrawingRegionId = null; let clickedRegionId = null; let lassoPoints = [];
let isSelectingAutoAttackTarget = false;

const sysMsg = document.getElementById('systemMsg');
function showMsg(text) { 
    if(sysMsg) { 
        sysMsg.innerText = text; 
        setTimeout(() => sysMsg.innerText = "ЛКМ - выбор, ПКМ - марш армий.", 3000); 
    } 
}

socket.on('newsEvent', (text) => {
    const box = document.getElementById('newsBox');
    if(box) { 
        box.innerText = text; box.style.opacity = 1; 
        setTimeout(() => box.style.opacity = 0, 4000); 
    }
});

const bgMap = new Image(); 
bgMap.src = 'Map.png'; 
let loopStarted = false;
function startGame() { if (!loopStarted) { loopStarted = true; requestAnimationFrame(gameLoop); } }
bgMap.onload = startGame; 
bgMap.onerror = () => { startGame(); }; 
setTimeout(startGame, 1000); 

const keys = { w: false, a: false, s: false, d: false };
window.addEventListener('keydown', (e) => { if (!e.key) return; let key = e.key.toLowerCase(); if (key === 'w' || key === 'ц') keys.w = true; if (key === 'a' || key === 'ф') keys.a = true; if (key === 's' || key === 'ы') keys.s = true; if (key === 'd' || key === 'в') keys.d = true; });
window.addEventListener('keyup', (e) => { if (!e.key) return; let key = e.key.toLowerCase(); if (key === 'w' || key === 'ц') keys.w = false; if (key === 'a' || key === 'ф') keys.a = false; if (key === 's' || key === 'ы') keys.s = false; if (key === 'd' || key === 'в') keys.d = false; });

let base64Flag = null; let edBase64Flag = null; 

// === УЛУЧШЕННАЯ ОБРАБОТКА ФЛАГОВ ИЗ ФАЙЛОВ ===
function processFlag(file, isEd) { 
    if (file) { 
        const reader = new FileReader(); 
        reader.onload = (ev) => { 
            const img = new Image(); 
            img.onload = () => { 
                const tempCanvas = document.createElement('canvas'); 
                tempCanvas.width = 64; tempCanvas.height = 64; 
                const tCtx = tempCanvas.getContext('2d'); 
                tCtx.drawImage(img, 0, 0, 64, 64); 
                const processedBase64 = tempCanvas.toDataURL('image/png');
                if(isEd) { edBase64Flag = processedBase64; }
                else { base64Flag = processedBase64; }
                console.log("Флаг успешно конвертирован и готов к отправке!");
            }; 
            img.src = ev.target.result; 
        }; 
        reader.readAsDataURL(file); 
    } 
}
document.getElementById('countryFlagFile')?.addEventListener('change', (e) => processFlag(e.target.files[0], false));
document.getElementById('edCountryFlagFile')?.addEventListener('change', (e) => processFlag(e.target.files[0], true));

window.createRoom = function() { socket.emit('createRoom', { presetName: document.getElementById('presetNameInput').value }, (res) => { if (res.success) { currentRoomId = res.roomId; document.getElementById('createRoomPanel').style.display = 'none'; document.getElementById('countryPanel').style.display = 'block'; document.getElementById('displaySetupRoomCode').innerText = res.roomId; document.getElementById('myRoomCode').innerText = res.roomId; } }); }
window.joinRoom = function() { const code = document.getElementById('roomCodeInput').value.toUpperCase(); socket.emit('joinRoom', code, (res) => { if (res.success) { currentRoomId = code; document.getElementById('joinRoomPanel').style.display = 'none'; document.getElementById('countryPanel').style.display = 'block'; document.getElementById('displaySetupRoomCode').innerText = code; document.getElementById('myRoomCode').innerText = code; } else { alert(res.msg || "Комната не найдена!"); } }); }

socket.on('initLobby', (cList) => { 
    countries = cList; 
    if (isPlaying) return; 
    const select = document.getElementById('countrySelect'); 
    if(select) { 
        select.innerHTML = '<option value="new">-- Новая (Пустошь) --</option>'; 
        for (let cId in countries) { 
            if (!countries[cId].online || !countries[cId].socketId) 
                select.innerHTML += `<option value="${cId}">${countries[cId].name} (Свободна)</option>`; 
        } 
    } 
});

document.getElementById('joinBtn')?.addEventListener('click', () => {
    const selectVal = document.getElementById('countrySelect').value;
    if (selectVal === 'new') {
        const name = document.getElementById('countryName').value || 'Империя'; 
        const color = document.getElementById('countryColor').value;
        let finalFlag = base64Flag; 
        
        // Надежный фоллбэк при создании страны
        if (!finalFlag || !finalFlag.startsWith('data:image')) { 
            console.warn("Флаг не был выбран или не успел загрузиться. Генерируем цветовой флаг.");
            const tCnv = document.createElement('canvas'); tCnv.width = 64; tCnv.height = 64; 
            const tCtx = tCnv.getContext('2d'); tCtx.fillStyle = color; tCtx.fillRect(0,0,64,64); 
            finalFlag = tCnv.toDataURL('image/png'); 
        }
        socket.emit('joinGame', { isNew: true, name, color, flag: finalFlag });
    } else { 
        socket.emit('joinGame', { isNew: false, countryId: selectVal }); 
    }
});

socket.on('joinSuccess', (cId) => { 
    myId = cId; 
    document.getElementById('setupScreen').style.display = 'none'; 
    document.getElementById('topBar').style.display = 'flex'; 
    document.getElementById('sideMenu').style.display = 'block'; 
    isPlaying = true; 
    updateEditorList(); 
    if (countries[myId]) updateUI(); 
});

window.startEditor = function() { isEditorMode = true; socket.emit('createRoom', { presetName: '' }, (res) => { if (res.success) { currentRoomId = res.roomId; document.getElementById('setupScreen').style.display = 'none'; document.getElementById('topBar').style.display = 'flex'; document.getElementById('myRoomCode').innerText = "РЕДАКТОР"; document.getElementById('sideMenu').style.display = 'block'; document.getElementById('editorTabBtn').style.display = 'block'; switchTab('tab-editor'); showMsg("Вы в Редакторе!"); isPlaying = true; } }); }
window.edCreateCountry = function() { const name = document.getElementById('edCountryName').value || 'Новая Страна'; const color = document.getElementById('edCountryColor').value; let finalFlag = edBase64Flag; if (!finalFlag) { const tCnv = document.createElement('canvas'); tCnv.width = 64; tCnv.height = 64; const tCtx = tCnv.getContext('2d'); tCtx.fillStyle = color; tCtx.fillRect(0,0,64,64); finalFlag = tCnv.toDataURL(); } socket.emit('joinGame', { isNew: true, name, color, flag: finalFlag }); edBase64Flag = null; const fi = document.getElementById('edCountryFlagFile'); if(fi) fi.value = ""; }
window.edSwitchCountry = function(cId) { socket.emit('switchCountry', cId); }
window.edSaveAndExit = function() { const presetName = prompt("Введите название заготовки:"); if (presetName && presetName.trim() !== "") { socket.emit('savePreset', presetName.trim()); } }
socket.on('presetSaved', () => { alert("Заготовка сохранена!"); location.reload(); });

document.getElementById('drawRegionBtn')?.addEventListener('click', () => { isDrawingRegion = !isDrawingRegion; document.getElementById('drawRegionBtn').innerText = isDrawingRegion ? "Отменить" : "Сформировать регион (Лассо)"; if (isDrawingRegion) { currentDrawingRegionId = `reg_${myId}_${Math.random().toString(36).substr(2, 5)}`; showMsg("Обведите территорию ЛКМ"); } else { lassoPoints = []; } });
document.getElementById('deployBtn')?.addEventListener('click', () => { const amount = document.getElementById('deployAmount').value; if (clickedRegionId) socket.emit('deployArmy', { regionId: clickedRegionId, amount: amount }); });
document.getElementById('closeRegBtn')?.addEventListener('click', () => { clickedRegionId = null; updateRegionPanel(); });
document.getElementById('renameRegBtn')?.addEventListener('click', () => { if (clickedRegionId && regions[clickedRegionId] && regions[clickedRegionId].owner === myId) { const newName = prompt("Новое название:", regions[clickedRegionId].name); if (newName) socket.emit('renameRegion', { regionId: clickedRegionId, newName: newName }); } });

document.getElementById('upgradeRegBtn')?.addEventListener('click', () => { if(clickedRegionId) socket.emit('upgradeRegion', clickedRegionId); });
document.getElementById('defendRegBtn')?.addEventListener('click', () => { if(clickedRegionId) socket.emit('buildDefense', clickedRegionId); });

document.getElementById('disbandBtn')?.addEventListener('click', () => { 
    if (selectedArmies.length > 0) { 
        socket.emit('disbandArmies', selectedArmies); 
        selectedArmies = []; updateArmyPanel(); 
    } 
});

document.getElementById('autoAttackBtn')?.addEventListener('click', () => {
    isSelectingAutoAttackTarget = !isSelectingAutoAttackTarget;
    const btn = document.getElementById('autoAttackBtn');
    const tip = document.getElementById('autoAttackTip');
    if (isSelectingAutoAttackTarget) {
        btn.style.background = '#e67e22'; btn.innerText = 'Выберите цель...'; if(tip) tip.style.display = 'block';
    } else {
        btn.style.background = '#f39c12'; btn.innerText = 'Авто-Атака'; if(tip) tip.style.display = 'none';
    }
});

socket.on('initData', (data) => { territory = data.territory; armies = data.armies; regions = data.regions; });
socket.on('updateMap', (data) => { countries = data.countries; territory = data.territory; regions = data.regions; if (myId && countries[myId] && countries[myId].isSpawned) isSpawned = true; updateUI(); updateEditorList(); updateRegionPanel(); });
socket.on('syncTerritory', (data) => { territory = data.territory; regions = data.regions; updateRegionPanel(); });
socket.on('updateResources', (c) => { countries = c; updateUI(); updateRegionPanel(); });
socket.on('batchCellUpdate', (data) => { for (const key in data.cells) { territory[key] = data.cells[key]; } regions = data.regions; if (data.countries) countries = data.countries; updateUI(); updateRegionPanel(); });
socket.on('syncArmies', (a) => { 
    armies = a; 
    for(let id in armies) { 
        if(!visualArmies[id]) { visualArmies[id] = { x: armies[id].x, y: armies[id].y, count: armies[id].count }; }
        visualArmies[id].autoTarget = armies[id].autoTarget; 
    } 
    selectedArmies = selectedArmies.filter(id => armies[id]);
    updateArmyPanel();
});

// === БРОНЕБОЙНОЕ ОБНОВЛЕНИЕ ИНТЕРФЕЙСА (ФИКС КРЕСТИКОВ) ===
function updateUI() {
    if (myId && countries[myId]) {
        const country = countries[myId];
        const nameEl = document.getElementById('myName');
        const flagEl = document.getElementById('myFlagUI');
        
        if (nameEl && nameEl.innerText !== country.name) {
            nameEl.innerText = country.name;
        }
        
        if (flagEl) {
            let safeFlag = country.flag;
            
            // Если флага нет, он пустой, или это не картинка
            if (!safeFlag || typeof safeFlag !== 'string' || !safeFlag.startsWith('data:image')) {
                const tCnv = document.createElement('canvas'); 
                tCnv.width = 64; tCnv.height = 64; 
                const tCtx = tCnv.getContext('2d'); 
                tCtx.fillStyle = country.color || '#555'; 
                tCtx.fillRect(0, 0, 64, 64); 
                safeFlag = tCnv.toDataURL('image/png');
                countries[myId].flag = safeFlag; // Перезаписываем битый флаг в памяти
            }
            
            // Жестко перезаписываем атрибут, только если он реально изменился
            if (flagEl.getAttribute('src') !== safeFlag) {
                flagEl.setAttribute('src', safeFlag);
            }
        }
        
        isSpawned = country.isSpawned;
        
        document.getElementById('myArea').innerText = (country.cells * KM_PER_TILE).toLocaleString();
        document.getElementById('myPop').innerText = Math.floor(country.population).toLocaleString();
        document.getElementById('myDollars').innerText = Math.floor(country.dollars).toLocaleString();
        
        const incEl = document.getElementById('myIncome'); 
        if (incEl) { 
            incEl.innerText = (country.lastIncome >= 0 ? "+" : "") + Math.floor(country.lastIncome); 
            incEl.style.color = country.lastIncome >= 0 ? '#2ecc71' : '#e74c3c'; 
        }
        document.getElementById('myMilitary').innerText = Math.floor(country.military).toLocaleString();
        document.getElementById('myCap').innerText = country.cap.toLocaleString();
    }
}

function updateRegionPanel() {
    const rp = document.getElementById('regionPanel'); if (!rp) return;
    if (!clickedRegionId || !regions[clickedRegionId]) { rp.style.display = 'none'; return; }
    const reg = regions[clickedRegionId]; rp.style.display = 'block';
    
    document.getElementById('regName').innerText = reg.name;
    document.getElementById('regOwner').innerText = countries[reg.owner] ? countries[reg.owner].name : "Неизвестно";
    document.getElementById('regLevel').innerText = reg.level;
    document.getElementById('regDef').innerText = reg.defLevel || 0;
    
    const upBtn = document.getElementById('upgradeRegBtn');
    const defBtn = document.getElementById('defendRegBtn');
    const renBtn = document.getElementById('renameRegBtn');
    
    if (reg.owner === myId) { 
        if(renBtn) renBtn.style.display = 'inline-block'; 
        if(upBtn) { upBtn.style.display = 'block'; upBtn.innerText = reg.level >= 10 ? "Макс. Инфра" : `Развить (${reg.level * 5000}$)`; }
        if(defBtn) { defBtn.style.display = 'block'; defBtn.innerText = (reg.defLevel||0) >= 5 ? "Макс. Укрепления" : `ДОТы (${((reg.defLevel||0)+1) * 8000}$)`; }
    } else { 
        if(renBtn) renBtn.style.display = 'none'; 
        if(upBtn) upBtn.style.display = 'none';
        if(defBtn) defBtn.style.display = 'none';
    }
}

function updateArmyPanel() {
    const ap = document.getElementById('armyPanel'); if (!ap) return;
    const mySelected = selectedArmies.filter(id => armies[id] && armies[id].owner === myId);
    
    if (mySelected.length > 0 && mySelected.length === selectedArmies.length) {
        ap.style.display = 'block';
        let totalCount = 0;
        mySelected.forEach(id => totalCount += armies[id].count);
        document.getElementById('armyCount').innerText = Math.floor(totalCount) + (mySelected.length > 1 ? ` (${mySelected.length} див.)` : ' ед.');
    } else { 
        ap.style.display = 'none'; 
        isSelectingAutoAttackTarget = false;
        if (document.getElementById('autoAttackBtn')) {
            document.getElementById('autoAttackBtn').style.background = '#f39c12';
            document.getElementById('autoAttackBtn').innerText = 'Авто-Атака';
            document.getElementById('autoAttackTip').style.display = 'none';
        }
    }
}

function pointInPolygon(point, vs) { let x = point[0], y = point[1]; let inside = false; for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) { let xi = vs[i][0], yi = vs[i][1]; let xj = vs[j][0], yj = vs[j][1]; let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi); if (intersect) inside = !inside; } return inside; }

function pt(gx, gy) {
    let sin1 = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453;
    let sin2 = Math.sin(gx * 39.346 + gy * 11.135) * 43758.5453;
    let randX = sin1 - Math.floor(sin1); let randY = sin2 - Math.floor(sin2);
    let wobble = TILE_SIZE * 0.7; 
    return { x: (gx * TILE_SIZE) + (randX - 0.5) * wobble, y: (gy * TILE_SIZE) + (randY - 0.5) * wobble };
}

function gameLoop() {
    const camSpeed = 15 / camera.zoom;
    if (keys.w) camera.y += camSpeed; if (keys.s) camera.y -= camSpeed; if (keys.a) camera.x += camSpeed; if (keys.d) camera.x -= camSpeed;
    if (camera.x > 0) camera.x = 0; if (camera.y > 0) camera.y = 0;
    const minX = canvas.width - WORLD_WIDTH * camera.zoom; const minY = canvas.height - WORLD_HEIGHT * camera.zoom;
    if (camera.x < minX) camera.x = minX; if (camera.y < minY) camera.y = minY;

    for(let id in visualArmies) {
        if(armies[id]) { 
            visualArmies[id].x += (armies[id].x - visualArmies[id].x) * 0.4; 
            visualArmies[id].y += (armies[id].y - visualArmies[id].y) * 0.4; 
            visualArmies[id].count = armies[id].count; visualArmies[id].owner = armies[id].owner; 
        } else { delete visualArmies[id]; }
    }
    drawMap(); requestAnimationFrame(gameLoop);
}

function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!bgMap.complete || bgMap.naturalWidth === 0) { ctx.fillStyle = '#222'; ctx.fillRect(0, 0, canvas.width, canvas.height); }

    ctx.save(); ctx.translate(camera.x, camera.y); ctx.scale(camera.zoom, camera.zoom);
    if (bgMap.complete && bgMap.naturalWidth > 0) ctx.drawImage(bgMap, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    ctx.globalAlpha = 0.35; 
    for (const key in territory) {
        const owner = countries[territory[key].owner];
        if (owner) { 
            const [ix, iy] = key.split('_').map(Number); 
            ctx.fillStyle = owner.color; 
            ctx.fillRect(ix * TILE_SIZE - 1, iy * TILE_SIZE - 1, TILE_SIZE + 2, TILE_SIZE + 2); 
        }
    }
    ctx.globalAlpha = 1.0;

    let bordersByOwner = {};
    for (const key in territory) {
        const ownerId = territory[key].owner;
        if (!bordersByOwner[ownerId]) bordersByOwner[ownerId] = [];
        bordersByOwner[ownerId].push(key);
    }

    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    for (let cId in bordersByOwner) {
        const country = countries[cId]; if (!country) continue;
        
        ctx.beginPath();
        bordersByOwner[cId].forEach(key => {
            const [cx, cy] = key.split('_').map(Number);
            const nTop = territory[`${cx}_${cy-1}`]?.owner === cId;
            const nBottom = territory[`${cx}_${cy+1}`]?.owner === cId;
            const nLeft = territory[`${cx-1}_${cy}`]?.owner === cId;
            const nRight = territory[`${cx+1}_${cy}`]?.owner === cId;

            if (!nTop) { let p1 = pt(cx, cy); let p2 = pt(cx+1, cy); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
            if (!nBottom) { let p1 = pt(cx, cy+1); let p2 = pt(cx+1, cy+1); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
            if (!nLeft) { let p1 = pt(cx, cy); let p2 = pt(cx, cy+1); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
            if (!nRight) { let p1 = pt(cx+1, cy); let p2 = pt(cx+1, cy+1); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
        });

        ctx.strokeStyle = country.color; ctx.lineWidth = TILE_SIZE * 2.2; ctx.globalAlpha = 0.3; ctx.stroke();
        ctx.strokeStyle = country.color; ctx.lineWidth = TILE_SIZE * 0.8; ctx.globalAlpha = 1.0; ctx.stroke();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)'; ctx.lineWidth = TILE_SIZE * 0.25; ctx.stroke();
    }

    ctx.beginPath(); ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'; ctx.lineWidth = 1.5 / camera.zoom; ctx.setLineDash([4 / camera.zoom, 4 / camera.zoom]);
    for (let key in territory) {
        const cell = territory[key]; const [cx, cy] = key.split('_').map(Number);
        const nRight = territory[`${cx+1}_${cy}`]; const nBottom = territory[`${cx}_${cy+1}`];
        if (nRight && nRight.owner === cell.owner && nRight.regionId !== cell.regionId) { let p1 = pt(cx+1, cy); let p2 = pt(cx+1, cy+1); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
        if (nBottom && nBottom.owner === cell.owner && nBottom.regionId !== cell.regionId) { let p1 = pt(cx, cy+1); let p2 = pt(cx+1, cy+1); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
    }
    ctx.stroke(); ctx.setLineDash([]); 

    for (const rId in regions) {
        const reg = regions[rId];
        if (reg.cityX !== undefined) {
            const tx = reg.cityX * TILE_SIZE + TILE_SIZE/2; const ty = reg.cityY * TILE_SIZE + TILE_SIZE/2;
            if ((reg.defLevel||0) > 0) {
                ctx.fillStyle = '#7f8c8d'; ctx.beginPath(); ctx.arc(tx, ty, 6, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5/camera.zoom; ctx.stroke();
            } else {
                ctx.fillStyle = 'rgba(10, 10, 10, 0.9)'; ctx.fillRect(tx - 4, ty - 4, 8, 8);
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 / camera.zoom; ctx.strokeRect(tx - 4, ty - 4, 8, 8);
            }
            ctx.fillStyle = 'white'; ctx.font = `bold ${10 / camera.zoom}px Arial`; ctx.textAlign = 'center'; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2 / camera.zoom;
            ctx.strokeText(reg.name, tx, ty - (15 / camera.zoom)); ctx.fillText(reg.name, tx, ty - (15 / camera.zoom));
        }
    }

    if (isDrawingRegion && lassoPoints.length > 0) {
        ctx.beginPath(); ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
        for(let i=1; i<lassoPoints.length; i++) ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
        ctx.lineTo(lassoPoints[0].x, lassoPoints[0].y); ctx.strokeStyle = '#f1c40f'; ctx.lineWidth = 2 / camera.zoom; ctx.stroke();
    }

    const rw = 26 / camera.zoom; const rh = 16 / camera.zoom;
    for(const id in visualArmies) {
        const army = visualArmies[id]; const owner = countries[army.owner]; if (!owner) continue;

        if (selectedArmies.includes(id)) { 
            ctx.fillStyle = 'rgba(241, 196, 15, 0.5)'; ctx.fillRect(army.x - (rw/2) - 4/camera.zoom, army.y - (rh/2) - 4/camera.zoom, rw + 8/camera.zoom, rh + 8/camera.zoom);
        }

// Получаем картинку флага для армии
        const flagImg = getFlagImage(army.owner, owner.flag);

        // Рисуем подложку (цвет страны)
        ctx.fillStyle = owner.color; 
        ctx.fillRect(army.x - rw/2, army.y - rh/2, rw, rh);

        // Рисуем сам флаг поверх подложки
        if (flagImg.complete && flagImg.naturalWidth > 0) {
            ctx.drawImage(flagImg, army.x - rw/2, army.y - rh/2, rw, rh);
        }

        if (army.autoTarget) {
            ctx.fillStyle = '#f1c40f';
            ctx.font = `bold ${12 / camera.zoom}px Arial`;
            ctx.fillText("⚔️", army.x + rw/2 + 8/camera.zoom, army.y - rh/2);
        }
    }

    if (isSelecting && !isDrawingRegion) {
        ctx.fillStyle = 'rgba(46, 204, 113, 0.2)'; ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 1 / camera.zoom;
        const w = selectionBox.endX - selectionBox.startX; const h = selectionBox.endY - selectionBox.startY;
        ctx.fillRect(selectionBox.startX, selectionBox.startY, w, h); ctx.strokeRect(selectionBox.startX, selectionBox.startY, w, h);
    }
    
    if (isSelectingAutoAttackTarget) {
        ctx.strokeStyle = '#f39c12'; ctx.lineWidth = 2/camera.zoom;
        ctx.beginPath();
        const world = getWorldCoords({clientX: lastMouse.x, clientY: lastMouse.y});
        ctx.arc(world.x, world.y, 10/camera.zoom, 0, Math.PI*2);
        ctx.moveTo(world.x - 15/camera.zoom, world.y); ctx.lineTo(world.x + 15/camera.zoom, world.y);
        ctx.moveTo(world.x, world.y - 15/camera.zoom); ctx.lineTo(world.x, world.y + 15/camera.zoom);
        ctx.stroke();
    }
    
    ctx.restore();

    if (myId && !isSpawned) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; ctx.fillRect(0, canvas.height / 2 - 60, canvas.width, 120);
        ctx.fillStyle = '#f1c40f'; ctx.font = 'bold 35px Arial'; ctx.textAlign = 'center'; ctx.fillText("КЛИКНИТЕ В ЛЮБОЕ МЕСТО КАРТЫ, ЧТОБЫ ОСНОВАТЬ СТОЛИЦУ", canvas.width / 2, canvas.height / 2 + 10);
    }
}

canvas.addEventListener('wheel', (e) => { e.preventDefault(); const zoomAmount = 0.1; const oldZoom = camera.zoom; const minZoom = Math.max(canvas.width / WORLD_WIDTH, canvas.height / WORLD_HEIGHT); camera.zoom = e.deltaY > 0 ? Math.max(minZoom, camera.zoom - zoomAmount) : Math.min(6, camera.zoom + zoomAmount); const rect = canvas.getBoundingClientRect(); const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width); const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height); camera.x = mouseX - (mouseX - camera.x) * (camera.zoom / oldZoom); camera.y = mouseY - (mouseY - camera.y) * (camera.zoom / oldZoom); });

function getWorldCoords(e) { const rect = canvas.getBoundingClientRect(); const canvasMouseX = (e.clientX - rect.left) * (canvas.width / rect.width); const canvasMouseY = (e.clientY - rect.top) * (canvas.height / rect.height); let wx = (canvasMouseX - camera.x) / camera.zoom; let wy = (canvasMouseY - camera.y) / camera.zoom; return { x: Math.max(0, Math.min(WORLD_WIDTH, wx)), y: Math.max(0, Math.min(WORLD_HEIGHT, wy)) }; }

canvas.addEventListener('mousedown', (e) => { 
    const world = getWorldCoords(e);
    if (e.button === 1) { isPanning = true; lastMouse = {x: e.clientX, y: e.clientY}; return; }
    
    if (isSelectingAutoAttackTarget && e.button === 0) {
        isSelectingAutoAttackTarget = false;
        document.getElementById('autoAttackBtn').style.background = '#f39c12';
        document.getElementById('autoAttackBtn').innerText = 'Авто-Атака';
        document.getElementById('autoAttackTip').style.display = 'none';

        let targetCountry = null;
        const rw = 26/camera.zoom; const rh = 16/camera.zoom;
        for (let id in visualArmies) {
            let a = visualArmies[id];
            if (Math.abs(a.x - world.x) <= rw/2 && Math.abs(a.y - world.y) <= rh/2) { targetCountry = a.owner; break; }
        }
        if (!targetCountry) {
            const key = `${Math.floor(world.x/TILE_SIZE)}_${Math.floor(world.y/TILE_SIZE)}`;
            if (territory[key]) targetCountry = territory[key].owner;
        }

        if (targetCountry && targetCountry !== myId && selectedArmies.length > 0) {
            socket.emit('autoAttack', { armyIds: selectedArmies, targetCountry: targetCountry });
            showMsg("Приказ 'Авто-наступление' отдан выбранным дивизиям!");
        } else {
            showMsg("Цель отменена или недопустима.");
        }
        return; 
    }

    if (e.button === 0) {
        if (!isSpawned) { socket.emit('spawnCapital', { x: Math.floor(world.x/TILE_SIZE), y: Math.floor(world.y/TILE_SIZE) }); return; }
        if (isDrawingRegion) { lassoPoints = [world]; return; }
        isSelecting = true; selectionBox.startX = world.x; selectionBox.startY = world.y; selectionBox.endX = world.x; selectionBox.endY = world.y;
    }
    if (e.button === 2 && selectedArmies.length > 0 && !isDrawingRegion) { socket.emit('moveArmies', { armyIds: selectedArmies, targetX: world.x, targetY: world.y }); }
});

canvas.addEventListener('mousemove', (e) => { 
    if (isPanning) { camera.x += (e.clientX - lastMouse.x); camera.y += (e.clientY - lastMouse.y); }
    lastMouse = {x: e.clientX, y: e.clientY}; 
    const world = getWorldCoords(e);
    if (isSelecting) { selectionBox.endX = world.x; selectionBox.endY = world.y; } else if (isDrawingRegion && e.buttons === 1) { lassoPoints.push(world); }
});

canvas.addEventListener('mouseup', (e) => { 
    if (e.button === 1) isPanning = false;
    if (isDrawingRegion) {
        if (lassoPoints.length > 2) {
            let minX = WORLD_WIDTH, maxX = 0, minY = WORLD_HEIGHT, maxY = 0;
            let poly = lassoPoints.map(p => { if(p.x < minX) minX = p.x; if(p.x > maxX) maxX = p.x; if(p.y < minY) minY = p.y; if(p.y > maxY) maxY = p.y; return [p.x, p.y]; });
            let tilesInside = [];
            for(let c = Math.max(0, Math.floor(minX/TILE_SIZE)); c <= Math.min(WORLD_WIDTH/TILE_SIZE-1, Math.ceil(maxX/TILE_SIZE)); c++) {
                for(let r = Math.max(0, Math.floor(minY/TILE_SIZE)); r <= Math.min(WORLD_HEIGHT/TILE_SIZE-1, Math.ceil(maxY/TILE_SIZE)); r++) {
                    if (pointInPolygon([c*TILE_SIZE+2, r*TILE_SIZE+2], poly)) tilesInside.push(`${c}_${r}`);
                }
            }
            if (tilesInside.length > 0) { 
                const name = prompt("Назовите регион:", `Регион ${Object.keys(regions).length + 1}`); 
                if (name !== null) { socket.emit('lassoRegion', { tiles: tilesInside, newRegionId: currentDrawingRegionId, name: name || "Без названия" }); showMsg("Оформляем..."); } 
            }
        }
        isDrawingRegion = false; lassoPoints = []; document.getElementById('drawRegionBtn').innerText = "Сформировать регион (Лассо)"; return;
    }

    if (e.button === 0 && isSelecting && !isSelectingAutoAttackTarget) {
        isSelecting = false; const world = getWorldCoords(e);
        const minX = Math.min(selectionBox.startX, world.x); const maxX = Math.max(selectionBox.startX, world.x); const minY = Math.min(selectionBox.startY, world.y); const maxY = Math.max(selectionBox.startY, world.y);
        const isClick = (maxX - minX < 5 && maxY - minY < 5); selectedArmies = []; const rw = 26 / camera.zoom; const rh = 16 / camera.zoom;
        for (const id in visualArmies) {
            const a = visualArmies[id];
            if (a.owner === myId) { if (isClick && Math.abs(a.x - world.x) <= rw/2 && Math.abs(a.y - world.y) <= rh/2) selectedArmies.push(id); else if (!isClick && a.x >= minX && a.x <= maxX && a.y >= minY && a.y <= maxY) selectedArmies.push(id); }
        }
        
        updateArmyPanel();

        if (isClick && selectedArmies.length === 0) {
            const key = `${Math.floor(world.x/TILE_SIZE)}_${Math.floor(world.y/TILE_SIZE)}`;
            if (territory[key] && territory[key].owner === myId) { clickedRegionId = territory[key].regionId; updateRegionPanel(); } else { clickedRegionId = null; updateRegionPanel(); }
        } else if (!isClick || selectedArmies.length > 0) { clickedRegionId = null; updateRegionPanel(); }
    }
});
