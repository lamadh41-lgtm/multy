(function () {
  'use strict';
  if (typeof THREE === 'undefined') {
    document.getElementById('loading-text').textContent = 'خطأ: Three.js';
    return;
  }

  const state = {
    mode: 'menu', levels: {}, currentLevelId: null, buildObjects: [],
    selectedItem: null, currentTool: 'select', currentCategory: 'buildings',
    clock: new THREE.Clock(), keys: {}, player2Joined: false, mouseHidden: false,
    flyMode: false, flyYaw: 0.8, flyPitch: 0.35, flyPos: new THREE.Vector3(15, 18, 15),
    playType: 'split', // split | online
    isHost: true,
    roomCode: null,
    peer: null,
    connection: null, // joiner single connection to host
    connections: [], // host: multiple peer connections
    netRoster: [], // [{ id, name, isHost, peerConnId }]
    myNetId: null,
    remoteMeshes: {}, // netId -> THREE.Group
    maxNetPlayers: 8,
    netPoseTimer: 0,
    lanIp: null,
    lanPort: 27100,
    lanSince: 0,
    lanPollTimer: null,
    useLan: false,
    graphicsLevel: 3,
    scaleMode: 'uniform', // uniform | axis
    netPing: 0,
    netPingBars: 3,
    paused: false,
    pauseSide: 'full', // full | left | right
    volume: 0.8,
    mouseSens: 0.0025,
    invertMouseX: false,
    invertMouseY: false,
    gpSens: 0.04,
    camDist: 5.8,
    camHeight: 2.4,
    camSide: 0,
    // Respawn placement (build mode)
    respawnPlaceMode: null, // null | 'lan' | 'split'
    respawnMarkers: [], // THREE.Group meshes currently in scene
    // Player display name (local)
    playerName: '',
    _levelSceneReady: false,
    playerAvatar: '',
    // Full script control layer (programming mode)
    script: {
      inputLocked: [false, false],
      forcedInput: [null, null],
      cameraOverride: [null, null], // { x,y,z, lookX,lookY,lookZ, fov, lerp }
      cutscene: false,
      cutsceneCam: null, // { x,y,z, lookX,lookY,lookZ, fov }
      timeScale: 1,
      blackBars: false,
      subtitle: '',
      flags: {},
      timers: [],
      waiters: []
    }
  };

  const players = [
    { id: 0, group: null, yaw: 0, pitch: 0.25, velocity: new THREE.Vector3(), direction: new THREE.Vector3(), canJump: true, camera: null,
      settings: { sens: 5, camDist: 5.8, camHeight: 2.4, camSide: 0, aimSide: 0.7, aimLift: 0.85, aimClose: 0.9 }, vehicle: null, vehicleSeat: null },
    { id: 1, group: null, yaw: Math.PI, pitch: 0.25, velocity: new THREE.Vector3(), direction: new THREE.Vector3(), canJump: true, camera: null,
      settings: { sens: 5, camDist: 5.8, camHeight: 2.4, camSide: 0, aimSide: 0.7, aimLift: 0.85, aimClose: 0.9 }, vehicle: null, vehicleSeat: null }
  ];
  // pauseOwner: which player opened the menu (0=keyboard, 1=gamepad) — null when closed
  state.pauseOwner = null;

  const loadingScreen = document.getElementById('loading-screen');
  const loadingText = document.getElementById('loading-text');
  const mainMenu = document.getElementById('main-menu');
  const lobbyScreen = document.getElementById('lobby-screen');
  const buildUI = document.getElementById('build-ui');
  const gameUI = document.getElementById('game-ui');
  const canvas = document.getElementById('game-canvas');
  const btnStart = document.getElementById('btn-start-game');
  const flyIndicator = document.getElementById('fly-indicator');

  function toast(msg, type) {
    type = type || 'info';
    var container = document.getElementById('toast-container');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2000);
  }


  // ===== اختيار داخل الموقع (بدون prompt كروم) =====
  state._choiceCallback = null;
  function showChoiceModal(title, options, callback) {
    // options: [{ id, label }]
    state._choiceCallback = callback;
    var modal = document.getElementById('choice-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'choice-modal';
      modal.innerHTML = '<div class="cfm-box"><div class="cfm-title" id="choice-modal-title">اختر</div>' +
        '<div class="cfm-row" id="choice-modal-options"></div>' +
        '<button type="button" class="btn btn-ghost" id="choice-modal-cancel" style="margin-top:12px;width:100%">إلغاء</button></div>';
      document.body.appendChild(modal);
      var cc = document.getElementById('choice-modal-cancel');
      if (cc) cc.onclick = function () { hideChoiceModal(); state._choiceCallback = null; };
    }
    var titleEl = document.getElementById('choice-modal-title');
    var box = document.getElementById('choice-modal-options');
    if (titleEl) {
      titleEl.textContent = title || 'اختر';
      titleEl.style.whiteSpace = 'pre-line';
      titleEl.style.lineHeight = '1.45';
    }
    if (box) {
      box.innerHTML = '';
      (options || []).forEach(function (opt) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = opt.danger ? 'btn' : 'btn btn-primary';
        b.style.cssText = opt.danger
          ? 'margin:6px;min-width:160px;background:linear-gradient(135deg,#ef4444,#b91c1c);color:#fff;font-weight:700'
          : 'margin:6px;min-width:160px';
        b.textContent = opt.label;
        b.onclick = function () {
          hideChoiceModal();
          var cb = state._choiceCallback;
          state._choiceCallback = null;
          if (cb) cb(opt.id);
        };
        box.appendChild(b);
      });
    }
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    modal.style.zIndex = '1900';
  }
  function hideChoiceModal() {
    var modal = document.getElementById('choice-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  function askName(title, defaultVal, callback) {
    // Simple in-page prompt replacement via toast + temporary input
    var existing = document.getElementById('inline-prompt');
    if (existing) existing.remove();
    var wrap = document.createElement('div');
    wrap.id = 'inline-prompt';
    wrap.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:10000;background:rgba(18,24,38,0.98);border:1px solid rgba(0,212,255,0.4);border-radius:12px;padding:16px 20px;display:flex;gap:10px;align-items:center;box-shadow:0 10px 40px rgba(0,0,0,0.5);';
    var label = document.createElement('span');
    label.textContent = title;
    label.style.cssText = 'color:#e2e8f0;font-weight:600;font-size:0.9rem;white-space:nowrap;';
    var input = document.createElement('input');
    input.type = 'text';
    input.value = defaultVal || '';
    input.style.cssText = 'padding:8px 12px;border-radius:8px;border:1px solid #2a3548;background:#0a0e17;color:#fff;font-family:inherit;font-size:0.95rem;min-width:160px;';
    var ok = document.createElement('button');
    ok.textContent = 'تم';
    ok.style.cssText = 'padding:8px 16px;border:none;border-radius:8px;background:linear-gradient(135deg,#00b4d8,#0077b6);color:#fff;font-weight:700;cursor:pointer;font-family:inherit;';
    var cancel = document.createElement('button');
    cancel.textContent = 'إلغاء';
    cancel.style.cssText = 'padding:8px 12px;border:1px solid #2a3548;border-radius:8px;background:transparent;color:#94a3b8;cursor:pointer;font-family:inherit;';
    function close(val) {
      wrap.remove();
      if (callback) callback(val);
    }
    ok.onclick = function () { close(input.value.trim() || null); };
    cancel.onclick = function () { close(null); };
    input.onkeydown = function (e) {
      if (e.key === 'Enter') close(input.value.trim() || null);
      if (e.key === 'Escape') close(null);
    };
    wrap.appendChild(label); wrap.appendChild(input); wrap.appendChild(ok); wrap.appendChild(cancel);
    document.body.appendChild(wrap);
    input.focus();
    input.select();
  }



  // ===== SCENE =====
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 70, 180);
  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setScissorTest(false);

  // ===== Graphics quality (1=حقير .. 5=أسطوري) =====
  var _sunLightRef = null;
  function applyGraphicsQuality(level) {
    level = parseInt(level, 10); if (isNaN(level)) level = 3; level = Math.max(0, Math.min(5, level));
    state.graphicsLevel = level;
    try { localStorage.setItem('sm_graphics', String(level)); } catch (e) {}
    var dpr = window.devicePixelRatio || 1;
    // 1 حقير: lowest res, no shadows, no AA — max FPS
    // 2 منخفض: low res, basic shadows
    // 3 متوسط: balanced
    // 4 عالي: high
    // 5 أسطوري: max quality
    var table = {
      0: { pr: 0.35, shadows: false, map: 256, sun: 0.9, sunCast: false, type: THREE.BasicShadowMap },
      1: { pr: 0.55, shadows: false, map: 512, sun: 0.95, sunCast: false, type: THREE.BasicShadowMap },
      2: { pr: 0.8, shadows: true, map: 512, sun: 1.0, sunCast: true, type: THREE.BasicShadowMap },
      3: { pr: Math.min(dpr, 1.15), shadows: true, map: 1024, sun: 1.1, sunCast: true, type: THREE.PCFShadowMap },
      4: { pr: Math.min(dpr, 1.5), shadows: true, map: 1536, sun: 1.2, sunCast: true, type: THREE.PCFSoftShadowMap },
      5: { pr: Math.min(dpr, 1.75), shadows: true, map: 2048, sun: 1.3, sunCast: true, type: THREE.PCFSoftShadowMap }
    };
    var cfg = table[level] || table[3];
    renderer.setPixelRatio(cfg.pr);
    renderer.shadowMap.enabled = cfg.shadows;
    renderer.shadowMap.type = cfg.type;
    if (_sunLightRef) {
      _sunLightRef.castShadow = cfg.sunCast && cfg.shadows;
      if (cfg.shadows) {
        _sunLightRef.shadow.mapSize.set(cfg.map, cfg.map);
        if (_sunLightRef.shadow.map) {
          try { _sunLightRef.shadow.map.dispose(); } catch (e) {}
          _sunLightRef.shadow.map = null;
        }
      }
      _sunLightRef.intensity = 1.15 * (cfg.sun != null ? cfg.sun : 1);
    }
    // slightly reduce ground/scene load on low
    try {
      if (typeof ground !== 'undefined' && ground && ground.material) {
        ground.receiveShadow = cfg.shadows;
      }
    } catch (e) {}
    var hints = {
      0: 'الزباله الحقير العباسي الاماوي الشمبساوي — فريمات صاروخية',
      1: 'الجرافيكس الحقير — أعلى فريمات لأضعف الأجهزة',
      2: 'جرافيكس منخفض — أجهزة ضعيفة',
      3: 'جرافيكس متوسط — توازن الشكل والأداء',
      4: 'جرافيكس عالي — أجهزة قوية',
      5: 'الجرافيكس الأسطوري — أقصى جودة'
    };
    var el = document.getElementById('graphics-hint');
    if (el) el.textContent = hints[level] || '';
    var sel = document.getElementById('set-graphics');
    if (sel) sel.value = String(level);
  }

  let buildCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
  buildCamera.position.copy(state.flyPos);

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const sun = new THREE.DirectionalLight(0xfff5e0, 1.2);
  sun.position.set(40, 60, 30); sun.castShadow = true;
  _sunLightRef = sun;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 200;
  sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x87ceeb, 0x3d8c40, 0.3));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x4a7c3f, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const gridHelper = new THREE.GridHelper(150, 150, 0x5a8a4a, 0x3d6b35);
  gridHelper.position.y = 0.02; gridHelper.visible = false; scene.add(gridHelper);

  // ===== MODEL FACTORIES =====
  function mat(color, opts) {
    opts = opts || {};
    return new THREE.MeshStandardMaterial({ color: color, roughness: opts.r != null ? opts.r : 0.7, metalness: opts.m || 0, emissive: opts.e || 0, emissiveIntensity: opts.ei || 0, transparent: !!opts.t, opacity: opts.o != null ? opts.o : 1, flatShading: !!opts.flat });
  }
  function box(w, h, d, material) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.castShadow = true; m.receiveShadow = true; return m;
  }
  function cyl(rt, rb, h, segs, material) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segs || 8), material);
    m.castShadow = true; return m;
  }

  function makeHouse(w, h, d, wallC, roofC) {
    var g = new THREE.Group();
    var walls = box(w, h, d, mat(wallC, { r: 0.85 })); walls.position.y = h / 2; g.add(walls);
    var roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, h * 0.4, 4), mat(roofC, { r: 0.65 }));
    roof.position.y = h + h * 0.2; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
    var door = box(w * 0.2, h * 0.5, 0.08, mat(0x5c3317, { r: 0.6 })); door.position.set(0, h * 0.25, d / 2 + 0.02); g.add(door);
    var winM = mat(0x88ccee, { r: 0.25, m: 0.4, e: 0x112233, ei: 0.12 });
    [[-w*0.28, h*0.55], [w*0.28, h*0.55]].forEach(function (p) {
      var win = box(w * 0.16, h * 0.2, 0.06, winM); win.position.set(p[0], p[1], d / 2 + 0.02); g.add(win);
    });
    return g;
  }
  function makeTower(w, h, d, color) {
    var g = new THREE.Group();
    var body = box(w, h, d, mat(color, { r: 0.75, m: 0.15 })); body.position.y = h / 2; g.add(body);
    for (var i = 1; i < 6; i++) {
      var line = box(w + 0.06, 0.07, d + 0.06, mat(0x333333)); line.position.y = (h / 6) * i; g.add(line);
    }
    var ant = cyl(0.04, 0.04, 1.8, 6, mat(0x888888, { m: 0.8 })); ant.position.y = h + 0.9; g.add(ant);
    return g;
  }
  function makeShop(w, h, d) {
    var g = new THREE.Group();
    var body = box(w, h, d, mat(0xc4a882, { r: 0.8 })); body.position.y = h / 2; g.add(body);
    var awn = box(w + 0.4, 0.1, 1.3, mat(0xcc3333)); awn.position.set(0, h * 0.72, d / 2 + 0.55); g.add(awn);
    var win = box(w * 0.7, h * 0.4, 0.08, mat(0xaaddff, { r: 0.2, m: 0.5, e: 0x223344, ei: 0.15 }));
    win.position.set(0, h * 0.4, d / 2 + 0.03); g.add(win);
    return g;
  }
  function makeCar(bodyColor) {
    var g = new THREE.Group();
    var body = box(1.8, 0.55, 4.2, mat(bodyColor, { r: 0.3, m: 0.55 })); body.position.y = 0.55; g.add(body);
    var cabin = box(1.6, 0.5, 2.0, mat(bodyColor, { r: 0.3, m: 0.5 })); cabin.position.set(0, 1.05, -0.15); g.add(cabin);
    // Transparent glass — front, rear, sides
    var glass = mat(0x88ccee, { r: 0.1, m: 0.7, t: true, o: 0.35 });
    var fw = box(1.5, 0.42, 0.05, glass); fw.position.set(0, 1.08, 0.88); g.add(fw);
    var rw = box(1.45, 0.38, 0.05, glass); rw.position.set(0, 1.08, -1.15); g.add(rw);
    var swL = box(0.05, 0.38, 1.7, glass); swL.position.set(-0.82, 1.08, -0.1); g.add(swL);
    var swR = swL.clone(); swR.position.x = 0.82; g.add(swR);
    // Real interior seats (rideable markers for programming mode)
    var seatMat = mat(0x1a1a1a, { r: 0.85 });
    var seatBackMat = mat(0x222222, { r: 0.8 });
    function addSeat(x, z, name) {
      var seat = box(0.55, 0.12, 0.5, seatMat);
      seat.position.set(x, 0.72, z);
      seat.userData = { isSeat: true, seatName: name };
      g.add(seat);
      var back = box(0.55, 0.45, 0.1, seatBackMat);
      back.position.set(x, 0.95, z - 0.28);
      g.add(back);
    }
    addSeat(-0.4, 0.35, 'driver');
    addSeat(0.4, 0.35, 'passenger');
    addSeat(-0.4, -0.55, 'rear_left');
    addSeat(0.4, -0.55, 'rear_right');
    var wheelMat = mat(0x1a1a1a, { r: 0.9 });
    var wg = new THREE.CylinderGeometry(0.35, 0.35, 0.22, 12);
    [[-0.95, 0.35, 1.3], [0.95, 0.35, 1.3], [-0.95, 0.35, -1.3], [0.95, 0.35, -1.3]].forEach(function (p) {
      var w = new THREE.Mesh(wg, wheelMat); w.rotation.z = Math.PI / 2; w.position.set(p[0], p[1], p[2]); w.castShadow = true; g.add(w);
    });
    var lm = mat(0xffffaa, { e: 0xffff88, ei: 0.6 });
    var hl = box(0.28, 0.14, 0.06, lm); hl.position.set(-0.55, 0.55, 2.12); g.add(hl);
    var hr = hl.clone(); hr.position.x = 0.55; g.add(hr);
    g.userData.isVehicle = true;
    g.userData.vehicleType = 'car';
    return g;
  }
  function makeTruck(color) {
    var g = new THREE.Group(); color = color || 0xf59e0b;
    var cab = box(2.2, 1.5, 2.2, mat(color, { r: 0.4, m: 0.4 })); cab.position.set(0, 1.05, 1.9); g.add(cab);
    var bed = box(2.3, 1.1, 4.2, mat(0x555555, { r: 0.6, m: 0.3 })); bed.position.set(0, 0.9, -1.3); g.add(bed);
    var wg = new THREE.CylinderGeometry(0.42, 0.42, 0.28, 12);
    var wm = mat(0x1a1a1a, { r: 0.9 });
    [[-1.15, 0.42, 2.3], [1.15, 0.42, 2.3], [-1.15, 0.42, -0.4], [1.15, 0.42, -0.4], [-1.15, 0.42, -2.6], [1.15, 0.42, -2.6]].forEach(function (p) {
      var w = new THREE.Mesh(wg, wm); w.rotation.z = Math.PI / 2; w.position.set(p[0], p[1], p[2]); w.castShadow = true; g.add(w);
    });
    return g;
  }
  function makeBus() {
    var g = new THREE.Group();
    // Flexible coach body (slightly segmented look)
    var body = box(2.6, 2.4, 8, mat(0xfbbf24, { r: 0.4, m: 0.3 })); body.position.y = 1.4; g.add(body);
    var roof = box(2.5, 0.15, 7.8, mat(0xe5a800, { r: 0.5 })); roof.position.y = 2.65; g.add(roof);
    // Fully transparent windows all around
    var glass = mat(0x88ccee, { r: 0.1, m: 0.65, t: true, o: 0.3 });
    for (var i = 0; i < 5; i++) {
      var win = box(0.06, 0.95, 1.15, glass); win.position.set(1.32, 1.75, -3.0 + i * 1.5); g.add(win);
      var win2 = win.clone(); win2.position.x = -1.32; g.add(win2);
    }
    var frontGlass = box(2.3, 1.1, 0.06, glass); frontGlass.position.set(0, 1.8, 4.0); g.add(frontGlass);
    var rearGlass = box(2.3, 1.0, 0.06, glass); rearGlass.position.set(0, 1.75, -4.0); g.add(rearGlass);
    // Real seats inside (rows) — rideable
    var seatMat = mat(0x1e3a5f, { r: 0.8 });
    var backMat = mat(0x163050, { r: 0.75 });
    for (var row = 0; row < 6; row++) {
      var z = 2.5 - row * 1.1;
      [-0.7, 0.7].forEach(function (x) {
        var s = box(0.6, 0.12, 0.5, seatMat);
        s.position.set(x, 0.85, z);
        s.userData = { isSeat: true, seatName: 'bus_row' + row };
        g.add(s);
        var b = box(0.6, 0.5, 0.1, backMat);
        b.position.set(x, 1.1, z - 0.25);
        g.add(b);
      });
    }
    // Driver seat
    var ds = box(0.55, 0.12, 0.5, mat(0x111)); ds.position.set(-0.6, 0.9, 3.3); ds.userData = { isSeat: true, seatName: 'driver' }; g.add(ds);
    var wg = new THREE.CylinderGeometry(0.5, 0.5, 0.3, 12); var wm = mat(0x222);
    [[-1.3, 0.5, 2.8], [1.3, 0.5, 2.8], [-1.3, 0.5, -2.8], [1.3, 0.5, -2.8]].forEach(function (p) {
      var w = new THREE.Mesh(wg, wm); w.rotation.z = Math.PI / 2; w.position.set(p[0], p[1], p[2]); w.castShadow = true; g.add(w);
    });
    g.userData.isVehicle = true;
    g.userData.vehicleType = 'bus';
    g.userData.flexible = true;
    return g;
  }
  function makePoliceCar() {
    var g = makeCar(0x1e3a5f);
    var lightBar = box(1.2, 0.15, 0.4, mat(0x111)); lightBar.position.set(0, 1.4, -0.2); g.add(lightBar);
    var red = box(0.35, 0.12, 0.35, mat(0xff0000, { e: 0xff0000, ei: 0.8 })); red.position.set(-0.35, 1.42, -0.2); g.add(red);
    var blu = box(0.35, 0.12, 0.35, mat(0x0066ff, { e: 0x0066ff, ei: 0.8 })); blu.position.set(0.35, 1.42, -0.2); g.add(blu);
    return g;
  }
  function makeAmbulance() {
    var g = new THREE.Group();
    var body = box(2.2, 1.8, 5.5, mat(0xffffff, { r: 0.4, m: 0.3 })); body.position.y = 1.2; g.add(body);
    var stripe = box(2.25, 0.35, 5.55, mat(0xcc0000)); stripe.position.y = 1.2; g.add(stripe);
    var cross = box(0.15, 0.6, 0.15, mat(0xcc0000)); cross.position.set(1.15, 1.8, 0); g.add(cross);
    var cross2 = box(0.6, 0.15, 0.15, mat(0xcc0000)); cross2.position.set(1.15, 1.8, 0); g.add(cross2);
    var glass = mat(0x88ccee, { r: 0.1, m: 0.65, t: true, o: 0.3 });
    var fw = box(2.0, 0.7, 0.05, glass); fw.position.set(0, 1.7, 2.75); g.add(fw);
    var swL = box(0.05, 0.6, 1.4, glass); swL.position.set(-1.12, 1.65, 1.6); g.add(swL);
    var swR = swL.clone(); swR.position.x = 1.12; g.add(swR);
    // Seats + stretcher area
    var sm = mat(0x1a1a1a, { r: 0.85 });
    var ds = box(0.5, 0.1, 0.45, sm); ds.position.set(-0.5, 0.8, 1.9); ds.userData = { isSeat: true, seatName: 'driver' }; g.add(ds);
    var ps = box(0.5, 0.1, 0.45, sm); ps.position.set(0.5, 0.8, 1.9); ps.userData = { isSeat: true, seatName: 'passenger' }; g.add(ps);
    var bed = box(0.9, 0.15, 2.2, mat(0xeeeeee)); bed.position.set(0, 0.85, -0.8); bed.userData = { isSeat: true, seatName: 'stretcher' }; g.add(bed);
    var wg = new THREE.CylinderGeometry(0.4, 0.4, 0.28, 12); var wm = mat(0x222);
    [[-1.1, 0.4, 1.8], [1.1, 0.4, 1.8], [-1.1, 0.4, -1.8], [1.1, 0.4, -1.8]].forEach(function (p) {
      var w = new THREE.Mesh(wg, wm); w.rotation.z = Math.PI / 2; w.position.set(p[0], p[1], p[2]); w.castShadow = true; g.add(w);
    });
    g.userData.isVehicle = true;
    return g;
  }
  function makeTree() {
    var g = new THREE.Group();
    var trunk = cyl(0.18, 0.28, 1.8, 8, mat(0x5c3a1e, { r: 0.9 })); trunk.position.y = 0.9; g.add(trunk);
    var leaves = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 10), mat(0x2d6a1e, { r: 0.85 })); leaves.position.y = 2.7; leaves.castShadow = true; g.add(leaves);
    var l2 = new THREE.Mesh(new THREE.SphereGeometry(1.0, 8, 8), mat(0x3d8a2e, { r: 0.85 })); l2.position.set(0.5, 2.3, 0.3); g.add(l2);
    return g;
  }
  function makePalm() {
    var g = new THREE.Group();
    var trunk = cyl(0.15, 0.25, 4, 8, mat(0x8B6914, { r: 0.85 })); trunk.position.y = 2; g.add(trunk);
    for (var i = 0; i < 6; i++) {
      var leaf = box(0.15, 0.08, 2.2, mat(0x228B22, { r: 0.8 }));
      leaf.position.set(Math.sin(i / 6 * Math.PI * 2) * 0.8, 4.2, Math.cos(i / 6 * Math.PI * 2) * 0.8);
      leaf.rotation.x = 0.5; leaf.rotation.y = i / 6 * Math.PI * 2; g.add(leaf);
    }
    return g;
  }
  function makeRock() {
    var g = new THREE.Group();
    var rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), mat(0x6b6560, { r: 0.95, flat: true }));
    rock.position.y = 0.7; rock.scale.set(1.3, 0.9, 1.1); rock.castShadow = true; rock.receiveShadow = true; g.add(rock);
    return g;
  }
  function makeCrate() {
    var g = new THREE.Group();
    var b = box(1.1, 1.1, 1.1, mat(0x8B5A2B, { r: 0.8 })); b.position.y = 0.55; g.add(b);
    var s = box(1.15, 0.08, 1.15, mat(0x5c3a1e)); s.position.y = 0.55; g.add(s);
    return g;
  }
  function makeBarrel() {
    var g = new THREE.Group();
    var b = cyl(0.45, 0.45, 1.3, 12, mat(0x1e3a5f, { r: 0.5, m: 0.4 })); b.position.y = 0.65; g.add(b);
    var rim = cyl(0.48, 0.48, 0.08, 12, mat(0x333)); rim.position.y = 1.25; g.add(rim);
    return g;
  }
  function makeLamp() {
    var g = new THREE.Group();
    var pole = cyl(0.05, 0.07, 2.4, 8, mat(0x444, { m: 0.6, r: 0.4 })); pole.position.y = 1.2; g.add(pole);
    var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), mat(0xffee88, { e: 0xffcc44, ei: 0.9 })); bulb.position.y = 2.5; g.add(bulb);
    var light = new THREE.PointLight(0xffeeaa, 0.9, 14); light.position.y = 2.5; g.add(light);
    return g;
  }
  function makeStreetLight() {
    var g = new THREE.Group();
    var pole = cyl(0.07, 0.09, 5.5, 8, mat(0x555, { m: 0.7, r: 0.3 })); pole.position.y = 2.75; g.add(pole);
    var arm = box(1.6, 0.07, 0.07, mat(0x555, { m: 0.7 })); arm.position.set(0.7, 5.4, 0); g.add(arm);
    var lamp = box(0.45, 0.18, 0.28, mat(0x333)); lamp.position.set(1.35, 5.3, 0); g.add(lamp);
    var glow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), mat(0xffffcc, { e: 0xffee88, ei: 1 })); glow.position.set(1.35, 5.15, 0); g.add(glow);
    var pl = new THREE.PointLight(0xffeecc, 1.3, 20); pl.position.set(1.35, 5.1, 0); g.add(pl);
    return g;
  }
  function makeBench() {
    var g = new THREE.Group();
    var seat = box(1.8, 0.1, 0.5, mat(0x8B4513, { r: 0.8 })); seat.position.y = 0.45; g.add(seat);
    var back = box(1.8, 0.5, 0.08, mat(0x8B4513, { r: 0.8 })); back.position.set(0, 0.75, -0.22); g.add(back);
    var leg1 = box(0.08, 0.45, 0.08, mat(0x444)); leg1.position.set(-0.7, 0.22, 0.15); g.add(leg1);
    var leg2 = leg1.clone(); leg2.position.x = 0.7; g.add(leg2);
    var leg3 = leg1.clone(); leg3.position.set(-0.7, 0.22, -0.15); g.add(leg3);
    var leg4 = leg1.clone(); leg4.position.set(0.7, 0.22, -0.15); g.add(leg4);
    return g;
  }
  function makeTrash() {
    var g = new THREE.Group();
    var bin = cyl(0.35, 0.4, 1.0, 10, mat(0x2d5a27, { r: 0.6, m: 0.3 })); bin.position.y = 0.5; g.add(bin);
    var lid = cyl(0.38, 0.38, 0.06, 10, mat(0x1a3a18)); lid.position.y = 1.03; g.add(lid);
    return g;
  }
  function makeHydrant() {
    var g = new THREE.Group();
    var base = cyl(0.2, 0.25, 0.3, 8, mat(0xcc2222, { r: 0.5, m: 0.3 })); base.position.y = 0.15; g.add(base);
    var body = cyl(0.15, 0.15, 0.6, 8, mat(0xcc2222, { r: 0.5, m: 0.3 })); body.position.y = 0.55; g.add(body);
    var top = cyl(0.12, 0.12, 0.15, 8, mat(0xcc2222)); top.position.y = 0.9; g.add(top);
    var side = cyl(0.08, 0.08, 0.35, 6, mat(0xaa1111)); side.rotation.z = Math.PI / 2; side.position.set(0.2, 0.55, 0); g.add(side);
    return g;
  }
  function makeSign(textColor) {
    var g = new THREE.Group();
    var pole = cyl(0.04, 0.04, 2.2, 6, mat(0x888)); pole.position.y = 1.1; g.add(pole);
    var board = box(1.2, 0.8, 0.08, mat(textColor || 0x2266cc, { r: 0.5 })); board.position.y = 2.4; g.add(board);
    return g;
  }
  function makeTrafficLight() {
    var g = new THREE.Group();
    var pole = cyl(0.06, 0.06, 3.5, 8, mat(0x444, { m: 0.5 })); pole.position.y = 1.75; g.add(pole);
    var housing = box(0.35, 1.0, 0.3, mat(0x222)); housing.position.y = 3.8; g.add(housing);
    var colors = [0xff0000, 0xffff00, 0x00ff00];
    for (var i = 0; i < 3; i++) {
      var light = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), mat(colors[i], { e: colors[i], ei: 0.6 }));
      light.position.set(0, 4.15 - i * 0.3, 0.16); g.add(light);
    }
    return g;
  }
  function makeFence() {
    var g = new THREE.Group();
    for (var i = 0; i < 5; i++) {
      var post = box(0.08, 1.2, 0.08, mat(0x8B7355)); post.position.set(-1.6 + i * 0.8, 0.6, 0); g.add(post);
    }
    var rail1 = box(3.3, 0.06, 0.06, mat(0x8B7355)); rail1.position.y = 0.4; g.add(rail1);
    var rail2 = box(3.3, 0.06, 0.06, mat(0x8B7355)); rail2.position.y = 0.9; g.add(rail2);
    return g;
  }
  function makeRoadBarrier() {
    var g = new THREE.Group();
    var base = box(1.5, 0.7, 0.4, mat(0xff6600, { r: 0.5 })); base.position.y = 0.35; g.add(base);
    var stripe = box(1.52, 0.15, 0.42, mat(0xffffff)); stripe.position.y = 0.35; g.add(stripe);
    return g;
  }
  function makeMailbox() {
    var g = new THREE.Group();
    var boxM = box(0.4, 0.35, 0.25, mat(0x2244aa, { r: 0.5, m: 0.3 })); boxM.position.y = 1.1; g.add(boxM);
    var pole = cyl(0.04, 0.04, 1.0, 6, mat(0x666)); pole.position.y = 0.5; g.add(pole);
    var flag = box(0.15, 0.08, 0.02, mat(0xcc0000)); flag.position.set(0.28, 1.15, 0); g.add(flag);
    return g;
  }
  function makeSofa() {
    var g = new THREE.Group();
    var seat = box(2.2, 0.4, 0.9, mat(0x4a5568, { r: 0.8 })); seat.position.y = 0.4; g.add(seat);
    var back = box(2.2, 0.7, 0.25, mat(0x4a5568, { r: 0.8 })); back.position.set(0, 0.85, -0.35); g.add(back);
    var armL = box(0.25, 0.5, 0.9, mat(0x3d4555)); armL.position.set(-1.1, 0.55, 0); g.add(armL);
    var armR = armL.clone(); armR.position.x = 1.1; g.add(armR);
    return g;
  }
  function makeTable() {
    var g = new THREE.Group();
    var top = box(1.6, 0.08, 1.0, mat(0x8B5A2B, { r: 0.6 })); top.position.y = 0.75; g.add(top);
    [[-0.65, 0.37, -0.35], [0.65, 0.37, -0.35], [-0.65, 0.37, 0.35], [0.65, 0.37, 0.35]].forEach(function (p) {
      var leg = box(0.08, 0.75, 0.08, mat(0x5c3a1e)); leg.position.set(p[0], p[1], p[2]); g.add(leg);
    });
    return g;
  }
  function makeBed() {
    var g = new THREE.Group();
    var frame = box(2.0, 0.35, 1.5, mat(0x5c3a1e, { r: 0.7 })); frame.position.y = 0.3; g.add(frame);
    var mattress = box(1.9, 0.2, 1.4, mat(0xe8e0d0, { r: 0.9 })); mattress.position.y = 0.55; g.add(mattress);
    var pillow = box(0.6, 0.15, 0.4, mat(0xffffff, { r: 0.9 })); pillow.position.set(0, 0.7, -0.45); g.add(pillow);
    var headboard = box(2.0, 0.8, 0.1, mat(0x5c3a1e)); headboard.position.set(0, 0.7, -0.75); g.add(headboard);
    return g;
  }
  function makeFridge() {
    var g = new THREE.Group();
    var body = box(0.9, 2.0, 0.8, mat(0xe8e8e8, { r: 0.3, m: 0.5 })); body.position.y = 1.0; g.add(body);
    var handle = box(0.05, 0.5, 0.05, mat(0x888, { m: 0.8 })); handle.position.set(0.5, 1.2, 0.42); g.add(handle);
    var line = box(0.92, 0.03, 0.82, mat(0xcccccc)); line.position.y = 1.2; g.add(line);
    return g;
  }
  function makeTV() {
    var g = new THREE.Group();
    var screen = box(1.6, 0.95, 0.08, mat(0x111, { r: 0.2, m: 0.5 })); screen.position.y = 1.0; g.add(screen);
    var stand = box(0.5, 0.15, 0.4, mat(0x333)); stand.position.y = 0.45; g.add(stand);
    var base = box(0.8, 0.05, 0.5, mat(0x222)); base.position.y = 0.35; g.add(base);
    return g;
  }
  function makeSimpleBlock(size, color) {
    var g = new THREE.Group();
    var m = box(size[0], size[1], size[2], mat(color, { r: 0.7 })); m.position.y = size[1] / 2; g.add(m);
    return g;
  }
  function makeCone() {
    var g = new THREE.Group();
    var cone = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 8), mat(0xff6600, { r: 0.5 })); cone.position.y = 0.35; cone.castShadow = true; g.add(cone);
    var base = cyl(0.28, 0.28, 0.06, 8, mat(0x333)); base.position.y = 0.03; g.add(base);
    return g;
  }
  function makeDumpster() {
    var g = new THREE.Group();
    var body = box(2.2, 1.4, 1.2, mat(0x2d5a27, { r: 0.6, m: 0.2 })); body.position.y = 0.7; g.add(body);
    var lid = box(2.25, 0.1, 1.25, mat(0x1a3a18)); lid.position.y = 1.45; g.add(lid);
    return g;
  }
  function makeFountain() {
    var g = new THREE.Group();
    var base = cyl(1.5, 1.8, 0.4, 16, mat(0x888888, { r: 0.5, m: 0.3 })); base.position.y = 0.2; g.add(base);
    var mid = cyl(0.8, 1.0, 0.5, 12, mat(0x999, { r: 0.5 })); mid.position.y = 0.65; g.add(mid);
    var water = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.15, 16), mat(0x4488cc, { r: 0.2, m: 0.5, t: true, o: 0.7, e: 0x2266aa, ei: 0.2 }));
    water.position.y = 0.95; g.add(water);
    var spout = cyl(0.08, 0.08, 0.8, 6, mat(0xaaa, { m: 0.6 })); spout.position.y = 1.3; g.add(spout);
    return g;
  }


  function makeBike() {
    var g = new THREE.Group();
    var frame = box(0.08, 0.08, 1.4, mat(0x333)); frame.position.set(0, 0.55, 0); g.add(frame);
    var wheelGeo = new THREE.TorusGeometry(0.35, 0.05, 8, 16);
    var wm = mat(0x222, { r: 0.8, m: 0.3 });
    var w1 = new THREE.Mesh(wheelGeo, wm); w1.position.set(0, 0.35, 0.55); w1.castShadow = true; g.add(w1);
    var w2 = w1.clone(); w2.position.z = -0.55; g.add(w2);
    var seat = box(0.25, 0.08, 0.35, mat(0x1a1a1a)); seat.position.set(0, 0.75, -0.15); g.add(seat);
    var handle = box(0.6, 0.05, 0.05, mat(0x444)); handle.position.set(0, 0.85, 0.4); g.add(handle);
    return g;
  }
  function makeMotorcycle() {
    var g = new THREE.Group();
    var body = box(0.4, 0.45, 1.6, mat(0xcc0000, { r: 0.3, m: 0.5 })); body.position.y = 0.55; g.add(body);
    var tank = box(0.35, 0.3, 0.5, mat(0xaa0000, { r: 0.3, m: 0.5 })); tank.position.set(0, 0.85, 0.1); g.add(tank);
    var wg = new THREE.CylinderGeometry(0.32, 0.32, 0.15, 12); var wm = mat(0x1a1a1a, { r: 0.9 });
    var w1 = new THREE.Mesh(wg, wm); w1.rotation.z = Math.PI/2; w1.position.set(0, 0.32, 0.7); w1.castShadow = true; g.add(w1);
    var w2 = w1.clone(); w2.position.z = -0.7; g.add(w2);
    var seat = box(0.35, 0.1, 0.5, mat(0x222)); seat.position.set(0, 0.85, -0.35); g.add(seat);
    return g;
  }
  function makeVan() {
    var g = new THREE.Group();
    var body = box(2.2, 2.0, 5.5, mat(0xffffff, { r: 0.4, m: 0.3 })); body.position.y = 1.2; g.add(body);
    var cab = box(2.15, 0.9, 1.5, mat(0xeeeeee, { r: 0.3, m: 0.4 })); cab.position.set(0, 1.7, 1.8); g.add(cab);
    var glass = mat(0x88ccee, { r: 0.1, m: 0.65, t: true, o: 0.3 });
    var fw = box(2.0, 0.7, 0.05, glass); fw.position.set(0, 1.7, 2.55); g.add(fw);
    var swL = box(0.05, 0.65, 1.3, glass); swL.position.set(-1.1, 1.65, 1.8); g.add(swL);
    var swR = swL.clone(); swR.position.x = 1.1; g.add(swR);
    // Seats
    var sm = mat(0x222, { r: 0.85 });
    var ds = box(0.55, 0.12, 0.5, sm); ds.position.set(-0.5, 0.85, 1.9); ds.userData = { isSeat: true, seatName: 'driver' }; g.add(ds);
    var ps = box(0.55, 0.12, 0.5, sm); ps.position.set(0.5, 0.85, 1.9); ps.userData = { isSeat: true, seatName: 'passenger' }; g.add(ps);
    var wg = new THREE.CylinderGeometry(0.4, 0.4, 0.28, 12); var wm = mat(0x222);
    [[-1.1,0.4,1.8],[1.1,0.4,1.8],[-1.1,0.4,-1.8],[1.1,0.4,-1.8]].forEach(function(p){
      var w = new THREE.Mesh(wg, wm); w.rotation.z = Math.PI/2; w.position.set(p[0],p[1],p[2]); w.castShadow = true; g.add(w);
    });
    g.userData.isVehicle = true;
    return g;
  }
  function makeTaxi() {
    var g = makeCar(0xfbbf24);
    var sign = box(0.5, 0.2, 0.3, mat(0x111)); sign.position.set(0, 1.4, -0.2); g.add(sign);
    var t = box(0.4, 0.12, 0.25, mat(0xfbbf24, { e: 0xfbbf24, ei: 0.3 })); t.position.set(0, 1.42, -0.2); g.add(t);
    return g;
  }
  function makeFireTruck() {
    var g = new THREE.Group();
    var body = box(2.4, 1.6, 7, mat(0xcc0000, { r: 0.4, m: 0.3 })); body.position.y = 1.1; g.add(body);
    var cab = box(2.3, 1.2, 2.2, mat(0xaa0000, { r: 0.4, m: 0.3 })); cab.position.set(0, 1.8, 2.2); g.add(cab);
    var glass = mat(0x88ccee, { r: 0.1, m: 0.65, t: true, o: 0.3 });
    var fw = box(2.1, 0.75, 0.05, glass); fw.position.set(0, 1.95, 3.3); g.add(fw);
    var swL = box(0.05, 0.7, 1.5, glass); swL.position.set(-1.17, 1.9, 2.2); g.add(swL);
    var swR = swL.clone(); swR.position.x = 1.17; g.add(swR);
    var ladder = box(0.3, 0.15, 5, mat(0x888, { m: 0.6 })); ladder.position.set(0, 2.1, -0.5); g.add(ladder);
    var sm = mat(0x1a1a1a, { r: 0.85 });
    var ds = box(0.55, 0.12, 0.5, sm); ds.position.set(-0.55, 0.95, 2.4); ds.userData = { isSeat: true, seatName: 'driver' }; g.add(ds);
    var ps = box(0.55, 0.12, 0.5, sm); ps.position.set(0.55, 0.95, 2.4); ps.userData = { isSeat: true, seatName: 'passenger' }; g.add(ps);
    var wg = new THREE.CylinderGeometry(0.45, 0.45, 0.3, 12); var wm = mat(0x222);
    [[-1.2,0.45,2.5],[1.2,0.45,2.5],[-1.2,0.45,0],[1.2,0.45,0],[-1.2,0.45,-2.5],[1.2,0.45,-2.5]].forEach(function(p){
      var w = new THREE.Mesh(wg, wm); w.rotation.z = Math.PI/2; w.position.set(p[0],p[1],p[2]); w.castShadow = true; g.add(w);
    });
    g.userData.isVehicle = true;
    return g;
  }
  function makeSlide() {
    var g = new THREE.Group();
    var slide = box(1.2, 0.1, 3.5, mat(0x3b82f6, { r: 0.4 })); slide.rotation.x = -0.5; slide.position.set(0, 1.2, 0); g.add(slide);
    var pole1 = cyl(0.06, 0.06, 2.5, 6, mat(0x888)); pole1.position.set(-0.5, 1.25, -1.5); g.add(pole1);
    var pole2 = pole1.clone(); pole2.position.x = 0.5; g.add(pole2);
    var top = box(1.4, 0.1, 1.0, mat(0x3b82f6)); top.position.set(0, 2.4, -1.5); g.add(top);
    return g;
  }
  function makeSwing() {
    var g = new THREE.Group();
    var poleL = cyl(0.06, 0.06, 2.8, 6, mat(0x666)); poleL.position.set(-1, 1.4, 0); g.add(poleL);
    var poleR = poleL.clone(); poleR.position.x = 1; g.add(poleR);
    var top = box(2.2, 0.08, 0.08, mat(0x666)); top.position.y = 2.8; g.add(top);
    var seat = box(0.5, 0.06, 0.25, mat(0x8B4513)); seat.position.y = 0.9; g.add(seat);
    var rope1 = cyl(0.02, 0.02, 1.9, 4, mat(0x444)); rope1.position.set(-0.2, 1.85, 0); g.add(rope1);
    var rope2 = rope1.clone(); rope2.position.x = 0.2; g.add(rope2);
    return g;
  }
  function makePlantPot() {
    var g = new THREE.Group();
    var pot = cyl(0.35, 0.25, 0.5, 10, mat(0xb45309, { r: 0.7 })); pot.position.y = 0.25; g.add(pot);
    var plant = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), mat(0x228B22, { r: 0.85 })); plant.position.y = 0.7; g.add(plant);
    return g;
  }
  function makeBookshelf() {
    var g = new THREE.Group();
    var frame = box(1.4, 2.2, 0.4, mat(0x5c3a1e, { r: 0.7 })); frame.position.y = 1.1; g.add(frame);
    for (var i = 0; i < 4; i++) {
      var shelf = box(1.35, 0.05, 0.38, mat(0x8B5A2B)); shelf.position.y = 0.4 + i * 0.5; g.add(shelf);
    }
    return g;
  }
  function makeChair() {
    var g = new THREE.Group();
    var seat = box(0.55, 0.08, 0.55, mat(0x4a5568, { r: 0.7 })); seat.position.y = 0.5; g.add(seat);
    var back = box(0.55, 0.55, 0.08, mat(0x4a5568, { r: 0.7 })); back.position.set(0, 0.85, -0.24); g.add(back);
    [[-0.22,0.25,-0.22],[0.22,0.25,-0.22],[-0.22,0.25,0.22],[0.22,0.25,0.22]].forEach(function(p){
      var leg = box(0.06, 0.5, 0.06, mat(0x333)); leg.position.set(p[0],p[1],p[2]); g.add(leg);
    });
    return g;
  }
  function makeCrosswalk() {
    var g = new THREE.Group();
    for (var i = 0; i < 6; i++) {
      var stripe = box(0.4, 0.02, 2.5, mat(0xffffff, { r: 0.5 })); stripe.position.set(-1.5 + i * 0.6, 0.02, 0); g.add(stripe);
    }
    return g;
  }
  function makeBillboard() {
    var g = new THREE.Group();
    var pole = cyl(0.08, 0.08, 4, 8, mat(0x555, { m: 0.5 })); pole.position.y = 2; g.add(pole);
    var board = box(3, 1.8, 0.15, mat(0x2266aa, { r: 0.5 })); board.position.y = 4.5; g.add(board);
    var frame = box(3.1, 1.9, 0.1, mat(0x333)); frame.position.y = 4.5; g.add(frame);
    return g;
  }


  function makeDesk() {
    var g = new THREE.Group();
    var top = box(1.4, 0.06, 0.7, mat(0xdeb887, { r: 0.6 })); top.position.y = 0.75; g.add(top);
    [[-0.6,0.37,-0.25],[0.6,0.37,-0.25],[-0.6,0.37,0.25],[0.6,0.37,0.25]].forEach(function(p){
      var leg = box(0.06, 0.75, 0.06, mat(0x5c3a1e)); leg.position.set(p[0],p[1],p[2]); g.add(leg);
    });
    return g;
  }
  function makeBlackboard() {
    var g = new THREE.Group();
    var board = box(3, 1.6, 0.08, mat(0x1a3a1a, { r: 0.7 })); board.position.y = 1.5; g.add(board);
    var frame = box(3.15, 1.75, 0.06, mat(0x5c3a1e)); frame.position.y = 1.5; g.add(frame);
    return g;
  }
  function makeLocker() {
    var g = new THREE.Group();
    var body = box(0.8, 2.2, 0.5, mat(0x4a5568, { r: 0.4, m: 0.4 })); body.position.y = 1.1; g.add(body);
    var handle = box(0.05, 0.15, 0.05, mat(0x888, { m: 0.8 })); handle.position.set(0.35, 1.1, 0.28); g.add(handle);
    return g;
  }
  function makeHospitalBed() {
    var g = new THREE.Group();
    var frame = box(2.2, 0.4, 1.0, mat(0xcccccc, { r: 0.3, m: 0.5 })); frame.position.y = 0.6; g.add(frame);
    var mat2 = box(2.0, 0.2, 0.9, mat(0xffffff, { r: 0.9 })); mat2.position.y = 0.9; g.add(mat2);
    var head = box(0.1, 0.8, 1.0, mat(0xaaaaaa, { m: 0.4 })); head.position.set(-1.05, 1.0, 0); g.add(head);
    return g;
  }
  function makeCounter() {
    var g = new THREE.Group();
    var body = box(2.5, 1.0, 0.7, mat(0x8B5A2B, { r: 0.7 })); body.position.y = 0.5; g.add(body);
    var top = box(2.6, 0.08, 0.8, mat(0xdeb887, { r: 0.5 })); top.position.y = 1.04; g.add(top);
    return g;
  }
  function makeShelf() {
    var g = new THREE.Group();
    for (var i = 0; i < 4; i++) {
      var s = box(1.5, 0.05, 0.4, mat(0x8B5A2B)); s.position.y = 0.4 + i * 0.45; g.add(s);
    }
    var side1 = box(0.05, 1.8, 0.4, mat(0x5c3a1e)); side1.position.set(-0.75, 0.9, 0); g.add(side1);
    var side2 = side1.clone(); side2.position.x = 0.75; g.add(side2);
    return g;
  }
  function makeToilet() {
    var g = new THREE.Group();
    var base = box(0.5, 0.4, 0.6, mat(0xffffff, { r: 0.3, m: 0.2 })); base.position.y = 0.2; g.add(base);
    var bowl = cyl(0.22, 0.28, 0.35, 12, mat(0xffffff, { r: 0.3 })); bowl.position.y = 0.5; g.add(bowl);
    var tank = box(0.45, 0.5, 0.2, mat(0xf0f0f0, { r: 0.3 })); tank.position.set(0, 0.85, -0.25); g.add(tank);
    return g;
  }
  function makeSink() {
    var g = new THREE.Group();
    var basin = box(0.6, 0.15, 0.45, mat(0xffffff, { r: 0.3, m: 0.3 })); basin.position.y = 0.85; g.add(basin);
    var pedestal = cyl(0.12, 0.18, 0.8, 8, mat(0xf5f5f5)); pedestal.position.y = 0.4; g.add(pedestal);
    var faucet = cyl(0.03, 0.03, 0.25, 6, mat(0x888, { m: 0.8 })); faucet.position.set(0, 1.1, -0.1); g.add(faucet);
    return g;
  }

  // ===== CATALOG (extensive) =====

  var CATALOG_SECTIONS = {
    static: {
      label: '🏛 الجماد',
      cats: [
        { id: 'buildings', name: 'مباني', icon: '🏠' },
        { id: 'blocks', name: 'بلوكات', icon: '🟦' },
        { id: 'platforms', name: 'منصات', icon: '⬜' },
        { id: 'characters', name: 'شخصيات', icon: '🧍' },
        { id: 'street', name: 'شوارع', icon: '🛣️' },
        { id: 'city', name: 'مدينة', icon: '🏙️' },
        { id: 'home', name: 'بيوت', icon: '🏡' },
        { id: 'props', name: 'عناصر', icon: '📦' },
        { id: 'nature', name: 'طبيعة', icon: '🌳' },
        { id: 'lights', name: 'إضاءة', icon: '💡' },
        { id: 'props_extra', name: 'أثاث', icon: '🪑' },
        { id: 'walls_extra', name: 'حوائط', icon: '🧱' }
      ]
    },
    interactive: {
      label: '⚡ التفاعلي',
      cats: [
        { id: 'ix_vehicles', name: 'العربيات', icon: '🚗' },
        { id: 'ix_lights', name: 'الإضاءة', icon: '💡' },
        { id: 'ix_buildings', name: 'المباني', icon: '🏢' },
        { id: 'ix_weapons', name: 'الأسلحة والميادين', icon: '🔫' },
        { id: 'ix_devices', name: 'الأجهزة الإلكترونية', icon: '📱' }
      ]
    }
  };
  state.catalogSection = 'static';
  state.catalogView = 'categories'; // categories | items

  const buildCatalog = {

    ix_vehicles: [
      { id: 'ix_car_red', name: 'سيارة حمراء', icon: '🚗', factory: function () { return makeInteractiveCar('sedan', 0xdc2626, 0x991b1b); } },
      { id: 'ix_car_blue', name: 'سيارة زرقاء', icon: '🚙', factory: function () { return makeInteractiveCar('sedan', 0x2563eb, 0x1e3a8a); } },
      { id: 'ix_car_black', name: 'سيارة سوداء', icon: '🏎️', factory: function () { return makeInteractiveCar('sedan', 0x1a1a1a, 0x333); } },
      { id: 'ix_car_white', name: 'سيارة بيضاء', icon: '🚘', factory: function () { return makeInteractiveCar('sedan', 0xf5f5f5, 0xcbd5e1); } },
      { id: 'ix_car_green', name: 'سيارة خضراء', icon: '🍃', factory: function () { return makeInteractiveCar('sedan', 0x16a34a, 0x14532d); } },
      { id: 'ix_gclass', name: 'جي كلاس', icon: '🚙', factory: function () { return makeInteractiveCar('gclass', 0x1a1a1a, 0xc0c0c0); } },
      { id: 'ix_bugatti', name: 'بوجاتي', icon: '🏎️', factory: function () { return makeInteractiveCar('bugatti', 0x0a1628, 0xc4a35a); } },
      { id: 'ix_lambo', name: 'لامبورجيني', icon: '🚗', factory: function () { return makeInteractiveCar('lambo', 0xb8860b, 0x111111); } },
      { id: 'ix_truck', name: 'شاحنة', icon: '🚚', factory: function () { return makeInteractiveCar('truck', 0x374151, 0xf59e0b); } },
      { id: 'ix_taxi', name: 'تاكسي', icon: '🚕', factory: function () { return makeInteractiveCar('sedan', 0xfbbf24, 0x111111); } },
      { id: 'ix_police', name: 'شرطة', icon: '🚓', factory: function () { return makeInteractiveCar('sedan', 0x1e3a8a, 0xffffff); } }
    ],
    ix_lights: [
      { id: 'ix_bulb', name: 'لمبة', icon: '💡', factory: function () { return makeInteractiveLight('bulb', 0xffe4a3, 4, 8); } },
      { id: 'ix_lamp_post', name: 'عمود إنارة', icon: '🛣️', factory: function () { return makeInteractiveLight('post', 0xfff2cc, 6, 14); } },
      { id: 'ix_flood', name: 'كشاف قوي', icon: '🔦', factory: function () { return makeInteractiveLight('flood', 0xffffff, 10, 22); } },
      { id: 'ix_wall_lamp', name: 'إضاءة جدار', icon: '🏮', factory: function () { return makeInteractiveLight('wall', 0xffd79a, 3.5, 7); } },
      { id: 'ix_spot', name: 'سبوت لايت', icon: '✨', factory: function () { return makeInteractiveLight('spot', 0xe0f2fe, 8, 16); } },
      { id: 'ix_neon', name: 'نيون', icon: '💠', factory: function () { return makeInteractiveLight('neon', 0x22d3ee, 3, 9); } }
    ],
    ix_buildings: [
      { id: 'ix_garage', name: 'جراج كبير', icon: '🚪', factory: function () { return makeGarage(); } },
      { id: 'ix_gas', name: 'محطة بنزين', icon: '⛽', factory: function () { return makeGasStation(); } }
    ],
    ix_weapons: [
      { id: 'wpn_pistol', name: 'مسدس', icon: '🔫', factory: function () { return makeWeaponPickup('pistol', 0x1e293b, 0xfbbf24); } },
      { id: 'wpn_smg', name: 'رشاش', icon: '💥', factory: function () { return makeWeaponPickup('smg', 0x334155, 0x22d3ee); } },
      { id: 'wpn_crate', name: 'صندوق رماية', icon: '📦', factory: function () { return makeRangeProp('crate'); } },
      { id: 'wpn_board', name: 'لوح رماية', icon: '🎯', factory: function () { return makeRangeProp('board'); } },
      { id: 'wpn_barrel', name: 'برميل ميدان', icon: '🛢️', factory: function () { return makeRangeProp('barrel'); } },
      { id: 'wpn_dummy', name: 'راجدول', icon: '🧍', factory: function () { return makeRangeDummy(); } },
      { id: 'wpn_range', name: 'ميدان رماية', icon: '🏟️', factory: function () { return makeShootingRange(); } }
    ],
    ix_devices: [
      { id: 'ix_phone', name: 'تليفون', icon: '📱', factory: function () { return makePhoneProp(false); } }
    ],
    buildings: [
      { id: 'house_s', name: 'منزل صغير', icon: '🏠', factory: function () { return makeHouse(4, 3, 4, 0xd4a574, 0x8b4513); } },
      { id: 'house_m', name: 'منزل متوسط', icon: '🏡', factory: function () { return makeHouse(5.5, 3.5, 5, 0xe8d5b7, 0x654321); } },
      { id: 'house_l', name: 'منزل كبير', icon: '🏘️', factory: function () { return makeHouse(7, 4.5, 6, 0xf5e6d3, 0x4a3728); } },
      { id: 'shop', name: 'محل', icon: '🏪', factory: function () { return makeShop(5, 3.2, 4); } },
      { id: 'tower', name: 'برج', icon: '🏢', factory: function () { return makeTower(3.5, 12, 3.5, 0x6b7280); } },
      { id: 'tower2', name: 'برج زجاجي', icon: '🏬', factory: function () { return makeTower(4, 14, 4, 0x88aacc); } }
    ],
    blocks: [
      { id: 'cube', name: 'مكعب', icon: '🟦', factory: function () { return makeSimpleBlock([1.2, 1.2, 1.2], 0x3b82f6); } },
      { id: 'wall', name: 'حائط', icon: '🧱', factory: function () { return makeSimpleBlock([5, 2.5, 0.4], 0x78716c); } },
      { id: 'platform', name: 'منصة', icon: '⬜', factory: function () { return makeSimpleBlock([6, 0.3, 6], 0xa8a29e); } },
      { id: 'plat_s', name: 'منصة صغيرة', icon: '⬜', factory: function () { return makeSimpleBlock([3, 0.3, 3], 0xa8a29e); } },
      { id: 'plat_l', name: 'منصة كبيرة', icon: '⬛', factory: function () { return makeSimpleBlock([12, 0.35, 12], 0x78716c); } },
      { id: 'plat_xl', name: 'منصة ضخمة', icon: '⬛', factory: function () { return makeSimpleBlock([24, 0.4, 24], 0x57534e); } },
      { id: 'plat_tall', name: 'منصة مرتفعة', icon: '⬆️', factory: function () { return makeSimpleBlock([5, 2, 5], 0x94a3b8); } },
      { id: 'wall_s', name: 'حائط قصير', icon: '🧱', factory: function () { return makeSimpleBlock([4, 1.5, 0.35], 0x78716c); } },
      { id: 'wall_l', name: 'حائط طويل', icon: '🧱', factory: function () { return makeSimpleBlock([12, 3.5, 0.45], 0x57534e); } },
      { id: 'wall_glass', name: 'حائط زجاج', icon: '🪟', factory: function () { return makeSimpleBlock([5, 3, 0.2], 0x7dd3fc); } },
      { id: 'bridge', name: 'جسر', icon: '🌉', factory: function () { return makeSimpleBlock([14, 0.4, 4], 0x64748b); } },
      { id: 'crate', name: 'صندوق', icon: '📦', factory: function () { return makeSimpleBlock([1.2, 1.2, 1.2], 0xb45309); } },
      { id: 'barrel', name: 'برميل', icon: '🛢️', factory: function () { return makeSimpleBlock([0.9, 1.3, 0.9], 0x365314); } },
      { id: 'ramp', name: 'منحدر', icon: '📐', factory: function () {
        var g = new THREE.Group();
        var m = box(3, 0.3, 4, mat(0x78716c)); m.rotation.x = -0.35; m.position.set(0, 0.8, 0); g.add(m); return g;
      } },
      { id: 'stairs', name: 'سلالم', icon: '🪜', factory: function () {
        var g = new THREE.Group();
        for (var i = 0; i < 6; i++) { var s = box(2, 0.25, 0.5, mat(0x888)); s.position.set(0, 0.12 + i * 0.25, -i * 0.45); g.add(s); }
        return g;
      } }
    ],
    vehicles: [
      { id: 'car_red', name: 'سيارة حمراء', icon: '🚗', factory: function () { return makeCar(0xdc2626); } },
      { id: 'car_blue', name: 'سيارة زرقاء', icon: '🚙', factory: function () { return makeCar(0x2563eb); } },
      { id: 'car_black', name: 'سيارة سوداء', icon: '🏎️', factory: function () { return makeCar(0x1a1a1a); } },
      { id: 'car_white', name: 'سيارة بيضاء', icon: '🚘', factory: function () { return makeCar(0xf5f5f5); } },
      { id: 'car_green', name: 'سيارة خضراء', icon: '🍃', factory: function () { return makeCar(0x16a34a); } },
      { id: 'car_orange', name: 'سيارة برتقالية', icon: '🧡', factory: function () { return makeCar(0xea580c); } },
      { id: 'car_purple', name: 'سيارة بنفسجية', icon: '💜', factory: function () { return makeCar(0x7c3aed); } },
      { id: 'car_gclass', name: 'مرسيدس جي كلاس', icon: '🚙', factory: function () { return makeCatalogCar('gclass', 0x1a1a1a, 0xc0c0c0); } },
      { id: 'car_bugatti', name: 'بوجاتي', icon: '🏎️', factory: function () { return makeCatalogCar('bugatti', 0x0a1628, 0xc4a35a); } },
      { id: 'car_lambo', name: 'لامبورجيني', icon: '🚗', factory: function () { return makeCatalogCar('lambo', 0xb8860b, 0x111111); } },
      { id: 'car_sedan_lux', name: 'سيدان فاخر', icon: '🚘', factory: function () { return makeCatalogCar('sedan', 0x1e40af, 0x60a5fa); } },
      { id: 'car_truck', name: 'شاحنة', icon: '🚚', factory: function () { return makeCatalogCar('truck', 0x374151, 0xf59e0b); } },
      { id: 'car_taxi', name: 'تاكسي', icon: '🚕', factory: function () { return makeCatalogCar('sedan', 0xfbbf24, 0x111); } },
      { id: 'car_police', name: 'شرطة', icon: '🚓', factory: function () { return makeCatalogCar('sedan', 0x1e3a8a, 0xffffff); } },
      { id: 'car_bus', name: 'أتوبيس', icon: '🚌', factory: function () { return makeCatalogCar('bus', 0xdc2626, 0xfbbf24); } },
      { id: 'truck', name: 'شاحنة', icon: '🚚', factory: function () { return makeTruck(0xf59e0b); } },
      { id: 'truck_blue', name: 'شاحنة زرقاء', icon: '🚛', factory: function () { return makeTruck(0x3b82f6); } },
      { id: 'bus', name: 'أتوبيس', icon: '🚌', factory: function () { return makeBus(); } },
      { id: 'police', name: 'شرطة', icon: '🚓', factory: function () { return makePoliceCar(); } },
      { id: 'ambulance', name: 'إسعاف', icon: '🚑', factory: function () { return makeAmbulance(); } },
      { id: 'taxi', name: 'تاكسي', icon: '🚕', factory: function () { return makeTaxi(); } },
      { id: 'van', name: 'فان', icon: '🚐', factory: function () { return makeVan(); } },
      { id: 'firetruck', name: 'إطفاء', icon: '🚒', factory: function () { return makeFireTruck(); } },
      { id: 'bike', name: 'دراجة', icon: '🚲', factory: function () { return makeBike(); } },
      { id: 'motorcycle', name: 'موتوسيكل', icon: '🏍️', factory: function () { return makeMotorcycle(); } }
    ],
    street: [
      { id: 'streetlight', name: 'عمود إنارة', icon: '🏮', factory: function () { return makeStreetLight(); } },
      { id: 'bench', name: 'بنش', icon: '🪑', factory: function () { return makeBench(); } },
      { id: 'trash', name: 'سلة مهملات', icon: '🗑️', factory: function () { return makeTrash(); } },
      { id: 'road_s', name: 'طريق صغير', icon: '🛣️', factory: function () { var m = makeSimpleBlock([8, 0.12, 4], 0x2a2a2e); m.userData.walkable = true; return m; } },
      { id: 'road_l', name: 'طريق كبير', icon: '🛤️', factory: function () { var m = makeSimpleBlock([16, 0.12, 6], 0x2a2a2e); m.userData.walkable = true; return m; } },
      { id: 'sidewalk', name: 'رصيف', icon: '▭', factory: function () { var m = makeSimpleBlock([6, 0.2, 1.5], 0xa8a29e); m.userData.walkable = true; return m; } },
      { id: 'crosswalk', name: 'ممشى مشاة', icon: '🦓', factory: function () { var m = makeSimpleBlock([4, 0.13, 3], 0xf5f5f4); m.userData.walkable = true; return m; } },
      { id: 'barrier', name: 'حاجز', icon: '🚧', factory: function () { return makeSimpleBlock([3, 1, 0.3], 0xf59e0b); } },
      { id: 'sign_stop', name: 'إشارة قف', icon: '🛑', factory: function () { return makeSimpleBlock([0.8, 0.8, 0.15], 0xdc2626); } },
      { id: 'gas_pump', name: 'مضخة بنزين', icon: '⛽', factory: function () { return makeSimpleBlock([1, 2, 1], 0xef4444); } },
      { id: 'fountain', name: 'نافورة', icon: '⛲', factory: function () { return makeSimpleBlock([2.5, 1.2, 2.5], 0x38bdf8); } },
      { id: 'garage', name: 'جراج', icon: '🏗️', factory: function () { return makeSimpleBlock([8, 4, 6], 0x64748b); } },
      { id: 'hydrant', name: 'صنبور حريق', icon: '🚒', factory: function () { return makeHydrant(); } },
      { id: 'sign', name: 'لافتة', icon: '🪧', factory: function () { return makeSign(0x2266cc); } },
      { id: 'sign_stop', name: 'قف', icon: '🛑', factory: function () { return makeSign(0xcc2222); } },
      { id: 'traffic', name: 'إشارة مرور', icon: '🚦', factory: function () { return makeTrafficLight(); } },
      { id: 'fence', name: 'سياج', icon: '🚧', factory: function () { return makeFence(); } },
      { id: 'barrier', name: 'حاجز طريق', icon: ' Hor', factory: function () { return makeRoadBarrier(); } },
      { id: 'cone', name: 'مخروط', icon: '🚧', factory: function () { return makeCone(); } },
      { id: 'dumpster', name: 'حاوية كبيرة', icon: '🗑️', factory: function () { return makeDumpster(); } },
      { id: 'mailbox', name: 'صندوق بريد', icon: '📫', factory: function () { return makeMailbox(); } },
      { id: 'fountain', name: 'نافورة', icon: '⛲', factory: function () { return makeFountain(); } },
      { id: 'crosswalk', name: 'ممر مشاة', icon: '🚶', factory: function () { return makeCrosswalk(); } },
      { id: 'billboard', name: 'لوحة إعلانات', icon: '📰', factory: function () { return makeBillboard(); } },
      { id: 'slide', name: 'زحليقة', icon: '🛝', factory: function () { return makeSlide(); } },
      { id: 'swing', name: 'أرجوحة', icon: '🎢', factory: function () { return makeSwing(); } }
    ],
    home: [
      { id: 'sofa', name: 'كنبة', icon: '🛋️', factory: function () { return makeSofa(); } },
      { id: 'table', name: 'طاولة', icon: '🪵', factory: function () { return makeTable(); } },
      { id: 'bed', name: 'سرير', icon: '🛏️', factory: function () { return makeBed(); } },
      { id: 'fridge', name: 'ثلاجة', icon: '🧊', factory: function () { return makeFridge(); } },
      { id: 'tv', name: 'تلفزيون', icon: '📺', factory: function () { return makeTV(); } },
      { id: 'crate', name: 'صندوق', icon: '📦', factory: function () { return makeCrate(); } },
      { id: 'barrel', name: 'برميل', icon: '🛢️', factory: function () { return makeBarrel(); } },
      { id: 'chair', name: 'كرسي', icon: '🪑', factory: function () { return makeChair(); } },
      { id: 'bookshelf', name: 'مكتبة', icon: '📚', factory: function () { return makeBookshelf(); } },
      { id: 'plantpot', name: 'نبتة', icon: '🪴', factory: function () { return makePlantPot(); } },
      { id: 'desk', name: 'مكتب', icon: '🖥️', factory: function () { return makeDesk(); } },
      { id: 'blackboard', name: 'سبورة', icon: '黒板', factory: function () { return makeBlackboard(); } },
      { id: 'locker', name: 'خزانة', icon: '🗄️', factory: function () { return makeLocker(); } },
      { id: 'hospitalbed', name: 'سرير مستشفى', icon: '🏥', factory: function () { return makeHospitalBed(); } },
      { id: 'counter', name: 'كاونتر', icon: '🏪', factory: function () { return makeCounter(); } },
      { id: 'shelf', name: 'رف', icon: '🪜', factory: function () { return makeShelf(); } },
      { id: 'toilet', name: 'مرحاض', icon: '🚽', factory: function () { return makeToilet(); } },
      { id: 'sink', name: 'حوض', icon: '🚰', factory: function () { return makeSink(); } }
    ],
    props: [
      { id: 'tree', name: 'شجرة', icon: '🌳', factory: function () { return makeTree(); } },
      { id: 'palm', name: 'نخلة', icon: '🌴', factory: function () { return makePalm(); } },
      { id: 'rock', name: 'صخرة', icon: '🪨', factory: function () { return makeRock(); } },
      { id: 'bush', name: 'شجيرة', icon: '🌿', factory: function () { return makeSimpleBlock([1.2, 1.0, 1.2], 0x22c55e); } },
      { id: 'flower', name: 'زهرة', icon: '🌸', factory: function () { return makeSimpleBlock([0.4, 0.6, 0.4], 0xec4899); } },
      { id: 'bench', name: 'بنش', icon: '🪑', factory: function () { return makeSimpleBlock([1.8, 0.55, 0.55], 0x78350f); } },
      { id: 'trash', name: 'سلة مهملات', icon: '🗑️', factory: function () { return makeSimpleBlock([0.55, 0.9, 0.55], 0x374151); } },
      { id: 'sign', name: 'لافتة', icon: '🪧', factory: function () { return makeSimpleBlock([1.2, 1.6, 0.12], 0xf8fafc); } },
      { id: 'mailbox', name: 'صندوق بريد', icon: '📬', factory: function () { return makeSimpleBlock([0.45, 0.7, 0.35], 0x2563eb); } },
      { id: 'hydrant', name: 'حنفيّة حريق', icon: '🚰', factory: function () { return makeSimpleBlock([0.4, 0.85, 0.4], 0xdc2626); } },
      { id: 'lamp_post', name: 'عمود إنارة', icon: '💡', factory: function () {
          var g = new THREE.Group();
          var pole = makeSimpleBlock([0.12, 2.4, 0.12], 0x64748b); pole.position.y = 1.2; g.add(pole);
          var lamp = makeSimpleBlock([0.35, 0.25, 0.35], 0xfde68a); lamp.position.y = 2.5; g.add(lamp);
          return g;
        } },
      { id: 'fountain', name: 'نافورة', icon: '⛲', factory: function () { return makeSimpleBlock([2.2, 0.8, 2.2], 0x38bdf8); } },
      { id: 'statue', name: 'تمثال', icon: '🗿', factory: function () { return makeSimpleBlock([0.8, 2.2, 0.8], 0x94a3b8); } },
      { id: 'barrier', name: 'حاجز', icon: '🚧', factory: function () { return makeSimpleBlock([2.0, 0.7, 0.25], 0xf97316); } },
      { id: 'dumpster', name: 'حاوية كبيرة', icon: '♻️', factory: function () { return makeSimpleBlock([2.0, 1.3, 1.2], 0x166534); } },
      { id: 'atm', name: 'صراف آلي', icon: '🏧', factory: function () { return makeSimpleBlock([0.9, 1.6, 0.5], 0x1e3a8a); } },
      { id: 'vending', name: 'آلة بيع', icon: '🥤', factory: function () { return makeSimpleBlock([0.9, 1.8, 0.7], 0xdc2626); } },
      { id: 'phone_booth', name: 'كابينة هاتف', icon: '☎️', factory: function () { return makeSimpleBlock([0.9, 2.2, 0.9], 0xef4444); } },
      { id: 'tent', name: 'خيمة', icon: '⛺', factory: function () { return makeSimpleBlock([2.5, 1.5, 2.5], 0xd97706); } },
      { id: 'campfire', name: 'نار مخيم', icon: '🔥', factory: function () { return makeSimpleBlock([0.9, 0.4, 0.9], 0xea580c); } }
    ],
    characters: [
      { id: 'npc_civilian', name: 'مدني', icon: '🧑', factory: function () { return makeNPC({ shirt: '#2563eb', pants: '#1e293b', hat: 0, job: 'civilian' }); } },
      { id: 'npc_police', name: 'شرطي', icon: '👮', factory: function () { return makeNPC({ shirt: '#1e3a5f', pants: '#0f172a', hat: 1, colorHat: '#1e3a5f', job: 'police' }); } },
      { id: 'npc_doctor', name: 'دكتور', icon: '👨‍⚕️', factory: function () { return makeNPC({ shirt: '#f8fafc', pants: '#334155', hat: 0, job: 'doctor' }); } },
      { id: 'npc_nurse', name: 'ممرضة', icon: '👩‍⚕️', factory: function () { return makeNPC({ shirt: '#fda4af', pants: '#fce7f3', hat: 0, job: 'nurse', head: 0xf5c6a0 }); } },
      { id: 'npc_chef', name: 'شيف', icon: '👨‍🍳', factory: function () { return makeNPC({ shirt: '#ffffff', pants: '#1a1a1a', hat: 3, colorHat: '#ffffff', job: 'chef' }); } },
      { id: 'npc_worker', name: 'عامل', icon: '👷', factory: function () { return makeNPC({ shirt: '#f59e0b', pants: '#44403c', hat: 1, colorHat: '#fbbf24', job: 'worker' }); } },
      { id: 'npc_firefighter', name: 'إطفائي', icon: '🧑‍🚒', factory: function () { return makeNPC({ shirt: '#b91c1c', pants: '#1c1917', hat: 1, colorHat: '#dc2626', job: 'firefighter' }); } },
      { id: 'npc_soldier', name: 'جندي', icon: '💂', factory: function () { return makeNPC({ shirt: '#3f6212', pants: '#365314', hat: 1, colorHat: '#365314', job: 'soldier' }); } },
      { id: 'npc_pilot', name: 'طيار', icon: '👨‍✈️', factory: function () { return makeNPC({ shirt: '#1e40af', pants: '#0f172a', hat: 1, colorHat: '#1e3a8a', glasses: 1, job: 'pilot' }); } },
      { id: 'npc_teacher', name: 'مدرس', icon: '👨‍🏫', factory: function () { return makeNPC({ shirt: '#7c3aed', pants: '#312e81', glasses: 1, job: 'teacher' }); } },
      { id: 'npc_student', name: 'طالب', icon: '🧑‍🎓', factory: function () { return makeNPC({ shirt: '#0ea5e9', pants: '#1e3a5f', hat: 0, job: 'student' }); } },
      { id: 'npc_thief', name: 'لص', icon: '🥷', factory: function () { return makeNPC({ shirt: '#111827', pants: '#030712', hat: 3, colorHat: '#111827', job: 'thief' }); } },
      { id: 'npc_oldman', name: 'رجل عجوز', icon: '👴', factory: function () { return makeNPC({ shirt: '#78716c', pants: '#44403c', hat: 3, colorHat: '#57534e', head: 0xd4a574, job: 'elder' }); } },
      { id: 'npc_oldwoman', name: 'سيدة عجوز', icon: '👵', factory: function () { return makeNPC({ shirt: '#a78bfa', pants: '#4c1d95', hat: 0, head: 0xe0ac69, job: 'elder_f' }); } },
      { id: 'npc_kid_boy', name: 'ولد', icon: '👦', factory: function () { return makeNPC({ shirt: '#22c55e', pants: '#1e40af', hat: 0, scale: 0.7, job: 'kid' }); } },
      { id: 'npc_kid_girl', name: 'بنت', icon: '👧', factory: function () { return makeNPC({ shirt: '#ec4899', pants: '#be185d', hat: 0, head: 0xf5c6a0, scale: 0.7, job: 'kid_f' }); } },
      { id: 'npc_business', name: 'رجل أعمال', icon: '👔', factory: function () { return makeNPC({ shirt: '#1e293b', pants: '#0f172a', glasses: 1, job: 'business' }); } },
      { id: 'npc_mechanic', name: 'ميكانيكي', icon: '🔧', factory: function () { return makeNPC({ shirt: '#0ea5e9', pants: '#334155', hat: 1, colorHat: '#64748b', job: 'mechanic' }); } },
      { id: 'npc_farmer', name: 'فلاح', icon: '👨‍🌾', factory: function () { return makeNPC({ shirt: '#ca8a04', pants: '#365314', hat: 1, colorHat: '#a16207', job: 'farmer' }); } },
      { id: 'npc_scientist', name: 'عالم', icon: '👨‍🔬', factory: function () { return makeNPC({ shirt: '#e2e8f0', pants: '#334155', glasses: 1, job: 'scientist' }); } },
      { id: 'npc_athlete', name: 'رياضي', icon: '🏃', factory: function () { return makeNPC({ shirt: '#ef4444', pants: '#1e293b', hat: 0, job: 'athlete' }); } },
      { id: 'npc_guard', name: 'حارس', icon: '🛡️', factory: function () { return makeNPC({ shirt: '#374151', pants: '#111827', hat: 1, colorHat: '#1f2937', job: 'guard' }); } },
      { id: 'npc_clown', name: 'مهرج', icon: '🤡', factory: function () { return makeNPC({ shirt: '#f97316', pants: '#7c3aed', hat: 6, colorHat: '#fbbf24', job: 'clown' }); } },
      { id: 'npc_robot', name: 'روبوت', icon: '🤖', factory: function () { return makeNPC({ shirt: '#94a3b8', pants: '#475569', hat: 0, head: 0xcbd5e1, job: 'robot' }); } }
    ],
    lights: [
      { id: 'lamp', name: 'مصباح', icon: '💡', factory: function () { return makeLamp(); } },
      { id: 'streetlight2', name: 'عمود إنارة', icon: '🏮', factory: function () { return makeStreetLight(); } },
      { id: 'neon', name: 'نيون', icon: 'neon', factory: function () { return makeSimpleBlock([2, 0.15, 0.15], 0x22d3ee); } },
      { id: 'flood', name: 'كشاف', icon: '🔦', factory: function () { return makeSimpleBlock([0.4, 0.4, 0.8], 0xfbbf24); } },
      { id: 'lantern', name: 'فانوس', icon: '🪔', factory: function () { return makeSimpleBlock([0.5, 0.8, 0.5], 0xf59e0b); } }
    ],
    vehicles: [
      { id: 'car_gclass', name: 'مرسيدس جي كلاس', icon: '🚙', factory: function () { return makeCatalogCar('gclass', 0x1a1a1a, 0xc0c0c0); } },
      { id: 'car_bugatti', name: 'بوجاتي', icon: '🏎️', factory: function () { return makeCatalogCar('bugatti', 0x0a1628, 0xc4a35a); } },
      { id: 'car_lambo', name: 'لامبورجيني', icon: '🚗', factory: function () { return makeCatalogCar('lambo', 0xb8860b, 0x111111); } },
      { id: 'car_sedan', name: 'سيدان', icon: '🚘', factory: function () { return makeCatalogCar('sedan', 0x1e40af, 0x60a5fa); } },
      { id: 'car_truck', name: 'شاحنة', icon: '🚚', factory: function () { return makeCatalogCar('truck', 0x374151, 0xf59e0b); } },
      { id: 'car_taxi', name: 'تاكسي', icon: '🚕', factory: function () { return makeCatalogCar('sedan', 0xfbbf24, 0x111); } },
      { id: 'car_police', name: 'شرطة', icon: '🚓', factory: function () { return makeCatalogCar('sedan', 0x1e3a8a, 0xffffff); } },
      { id: 'car_bus', name: 'أتوبيس', icon: '🚌', factory: function () { return makeCatalogCar('bus', 0xdc2626, 0xfbbf24); } }
    ],
    nature: [
      { id: 'tree1', name: 'شجرة 1', icon: '🌳', factory: function () { return makeTreeKind(1); } },
      { id: 'tree2', name: 'شجرة 2', icon: '🌲', factory: function () { return makeTreeKind(2); } },
      { id: 'tree3', name: 'شجرة نخيل', icon: '🌴', factory: function () { return makeTreeKind(3); } },
      { id: 'rock1', name: 'صخرة', icon: '🪨', factory: function () { return makeSimpleBlock([1.5, 1, 1.5], 0x78716c); } },
      { id: 'bush', name: 'شجيرة', icon: '🌿', factory: function () { return makeSimpleBlock([1.2, 0.8, 1.2], 0x16a34a); } },
      { id: 'flower', name: 'أحواض ورد', icon: '🌸', factory: function () { return makeSimpleBlock([1.5, 0.4, 1.5], 0xec4899); } }
    ],
    city: [
      { id: 'road_s', name: 'طريق صغير', icon: '🛣️', factory: function () { var m = makeSimpleBlock([8, 0.12, 4], 0x2a2a2e); m.userData.walkable = true; return m; } },
      { id: 'road_l', name: 'طريق كبير', icon: '🛤️', factory: function () { var m = makeSimpleBlock([16, 0.12, 6], 0x2a2a2e); m.userData.walkable = true; return m; } },
      { id: 'sidewalk', name: 'رصيف', icon: '▭', factory: function () { var m = makeSimpleBlock([6, 0.2, 1.5], 0xa8a29e); m.userData.walkable = true; return m; } },
      { id: 'crosswalk', name: 'ممشى', icon: '🦓', factory: function () { var m = makeSimpleBlock([4, 0.13, 3], 0xf5f5f4); m.userData.walkable = true; return m; } },
      { id: 'bench', name: 'مقعد', icon: '🪑', factory: function () { return makeSimpleBlock([1.8, 0.5, 0.6], 0x78350f); } },
      { id: 'bin', name: 'سلة قمامة', icon: '🗑️', factory: function () { return makeSimpleBlock([0.6, 1, 0.6], 0x365314); } },
      { id: 'sign_stop', name: 'إشارة قف', icon: '🛑', factory: function () { return makeSimpleBlock([0.8, 0.8, 0.15], 0xdc2626); } },
      { id: 'barrier', name: 'حاجز', icon: '🚧', factory: function () { return makeSimpleBlock([3, 1, 0.3], 0xf59e0b); } },
      { id: 'fountain', name: 'نافورة', icon: '⛲', factory: function () { return makeSimpleBlock([2.5, 1.2, 2.5], 0x38bdf8); } },
      { id: 'gas_pump', name: 'مضخة بنزين', icon: '⛽', factory: function () { return makeSimpleBlock([1, 2, 1], 0xef4444); } },
      { id: 'garage', name: 'جراج', icon: '🏗️', factory: function () { return makeSimpleBlock([8, 4, 6], 0x64748b); } }
    ],
    platforms: [
      { id: 'plat_s', name: 'منصة صغيرة', icon: '⬜', factory: function () { return makeSimpleBlock([3, 0.3, 3], 0xa8a29e); } },
      { id: 'plat_m', name: 'منصة متوسطة', icon: '⬜', factory: function () { return makeSimpleBlock([6, 0.3, 6], 0xa8a29e); } },
      { id: 'plat_l', name: 'منصة كبيرة', icon: '⬜', factory: function () { return makeSimpleBlock([12, 0.35, 12], 0x78716c); } },
      { id: 'plat_xl', name: 'منصة ضخمة', icon: '⬛', factory: function () { return makeSimpleBlock([24, 0.4, 24], 0x57534e); } },
      { id: 'plat_tall', name: 'منصة مرتفعة', icon: '⬆️', factory: function () { return makeSimpleBlock([5, 2, 5], 0x94a3b8); } },
      { id: 'bridge', name: 'جسر', icon: '🌉', factory: function () { return makeSimpleBlock([14, 0.4, 4], 0x64748b); } },
      { id: 'dock', name: 'رصيف بحري', icon: '⚓', factory: function () { return makeSimpleBlock([10, 0.35, 3], 0x92400e); } }
    ],
    walls_extra: [
      { id: 'wall_s', name: 'حائط قصير', icon: '🧱', factory: function () { return makeSimpleBlock([4, 1.5, 0.35], 0x78716c); } },
      { id: 'wall_m', name: 'حائط متوسط', icon: '🧱', factory: function () { return makeSimpleBlock([6, 3, 0.4], 0x78716c); } },
      { id: 'wall_l', name: 'حائط طويل', icon: '🧱', factory: function () { return makeSimpleBlock([12, 3.5, 0.45], 0x57534e); } },
      { id: 'wall_glass', name: 'حائط زجاج', icon: '🪟', factory: function () { return makeSimpleBlock([5, 3, 0.2], 0x7dd3fc); } },
      { id: 'fence', name: 'سياج', icon: 'fence', factory: function () { return makeSimpleBlock([6, 1.2, 0.15], 0xa3a3a3); } },
      { id: 'gate', name: 'بوابة', icon: '🚪', factory: function () { return makeSimpleBlock([3, 2.5, 0.3], 0x44403c); } }
    ],
    props_extra: [
      { id: 'crate', name: 'صندوق', icon: '📦', factory: function () { return makeSimpleBlock([1.2, 1.2, 1.2], 0xb45309); } },
      { id: 'barrel', name: 'برميل', icon: '🛢️', factory: function () { return makeSimpleBlock([0.9, 1.3, 0.9], 0x365314); } },
      { id: 'cone', name: 'مخروط', icon: '🚧', factory: function () { return makeSimpleBlock([0.5, 0.9, 0.5], 0xf97316); } },
      { id: 'table', name: 'طاولة', icon: '🪑', factory: function () { return makeSimpleBlock([1.6, 0.7, 1.0], 0x78350f); } },
      { id: 'chair', name: 'كرسي', icon: '💺', factory: function () { return makeSimpleBlock([0.6, 0.9, 0.6], 0x44403c); } },
      { id: 'sofa', name: 'كنبة', icon: '🛋️', factory: function () { return makeSimpleBlock([2.2, 0.8, 0.9], 0x1e3a8a); } },
      { id: 'tv', name: 'تلفزيون', icon: '📺', factory: function () { return makeSimpleBlock([1.4, 0.9, 0.2], 0x111); } },
      { id: 'bed', name: 'سرير', icon: '🛏️', factory: function () { return makeSimpleBlock([2, 0.6, 1.4], 0xe2e8f0); } },
      { id: 'fridge', name: 'ثلاجة', icon: '🧊', factory: function () { return makeSimpleBlock([0.9, 2, 0.8], 0xf8fafc); } },
      { id: 'pc', name: 'كمبيوتر', icon: '🖥️', factory: function () { return makeSimpleBlock([0.8, 0.7, 0.5], 0x334155); } }
    ]
  };





  // ===== أسلحة وميادين (سلوت 1 و 2) =====
  // weaponSlots[0] = زر 1 ، weaponSlots[1] = زر 2 — { kind, mesh, lastShot }
  // activeWeaponSlot = -1 إيدين فاضيين ، 0 أو 1 السلاح في الإيد
  state.weaponSlots = [null, null];
  state.activeWeaponSlot = -1;
  state.heldWeapon = null; // نسخة متزامنة للسلاح في الإيد (للتوافق)
  state.weaponBag = null; // توافق: أي سلاح على الضهر
  state.aiming = false;
  state.aimFov = 70;
  state.bullets = [];
  state.physProps = []; // props with velocity

  function makeWeaponGunMesh(kind, bodyCol, accent) {
    var g = new THREE.Group();
    if (kind === 'pistol') {
      var body = makeSimpleBlock([0.18, 0.22, 0.45], bodyCol); body.position.y = 0.12; g.add(body);
      var grip = makeSimpleBlock([0.14, 0.28, 0.14], accent); grip.position.set(0, -0.05, -0.08); g.add(grip);
      var barrel = makeSimpleBlock([0.08, 0.08, 0.28], 0x111); barrel.position.set(0, 0.14, 0.28); g.add(barrel);
    } else {
      var body = makeSimpleBlock([0.22, 0.24, 0.7], bodyCol); body.position.y = 0.14; g.add(body);
      var grip = makeSimpleBlock([0.16, 0.32, 0.16], accent); grip.position.set(0, -0.02, -0.1); g.add(grip);
      var barrel = makeSimpleBlock([0.1, 0.1, 0.4], 0x111); barrel.position.set(0, 0.16, 0.45); g.add(barrel);
      var stock = makeSimpleBlock([0.12, 0.14, 0.25], bodyCol); stock.position.set(0, 0.1, -0.4); g.add(stock);
    }
    return g;
  }
  function makeEmptyTable() {
    var root = new THREE.Group();
    var top = makeSimpleBlock([1.15, 0.08, 0.72], 0x8b5a2b);
    top.position.y = 0.82;
    root.add(top);
    var legMat = 0x5c3a1e;
    var legs = [[-0.48, 0.28], [0.48, 0.28], [-0.48, -0.28], [0.48, -0.28]];
    for (var i = 0; i < legs.length; i++) {
      var leg = makeSimpleBlock([0.08, 0.82, 0.08], legMat);
      leg.position.set(legs[i][0], 0.41, legs[i][1]);
      root.add(leg);
    }
    root.userData.isEmptyTable = true;
    root.userData.isWeapon = false;
    root.userData.interactive = false;
    root.userData.onGround = false;
    return root;
  }
  function makeWeaponOnTable(kind, bodyCol, accent) {
    var root = makeEmptyTable();
    var gun = makeWeaponGunMesh(kind, bodyCol, accent);
    gun.position.set(0, 0.92, 0);
    gun.rotation.y = Math.PI * 0.15;
    gun.userData.isGunMesh = true;
    root.add(gun);
    root.userData.gunMesh = gun;
    root.userData.isWeapon = true;
    root.userData.weaponKind = kind;
    root.userData.interactive = true;
    root.userData.interactiveType = 'weapon';
    root.userData.noCollision = true;
    root.userData.accentColor = accent;
    root.userData.onGround = true;
    root.userData.onTable = true;
    root.userData.isTableSet = true;
    return root;
  }
  function extractWeaponMeshFromWorld(root) {
    if (!root) return null;
    // سلاح على طاولة → خد السلاح بس وسيب الطاولة
    if (root.userData && root.userData.onTable && root.userData.gunMesh) {
      var gun = root.userData.gunMesh;
      try { root.remove(gun); } catch (e) {}
      root.userData.gunMesh = null;
      root.userData.isWeapon = false;
      root.userData.interactive = false;
      root.userData.onGround = false;
      root.userData.isEmptyTable = true;
      gun.userData.isWeapon = true;
      gun.userData.weaponKind = root.userData.weaponKind || gun.userData.weaponKind || 'pistol';
      gun.userData.interactive = true;
      gun.userData.interactiveType = 'weapon';
      gun.userData.onGround = false;
      gun.userData.onTable = false;
      gun.userData.noCollision = true;
      if (root.userData.netWeaponId) gun.userData.netWeaponId = root.userData.netWeaponId;
      return gun;
    }
    // سلاح عادي على الأرض
    return root;
  }
  function makeWeaponPickup(kind, bodyCol, accent, opts) {
    opts = opts || {};
    if (opts.onTable) {
      return makeWeaponOnTable(kind, bodyCol || 0x1e293b, accent || 0xfbbf24);
    }
    var g = makeWeaponGunMesh(kind, bodyCol, accent);
    g.userData.isWeapon = true;
    g.userData.weaponKind = kind;
    g.userData.interactive = true;
    g.userData.interactiveType = 'weapon';
    g.userData.noCollision = true;
    g.userData.accentColor = accent;
    g.userData.onGround = true;
    g.userData.onTable = false;
    return g;
  }

  function makeRangeProp(kind) {
    var g;
    if (kind === 'crate') g = makeSimpleBlock([1.2, 1.2, 1.2], 0xb45309);
    else if (kind === 'board') {
      g = new THREE.Group();
      var board = makeSimpleBlock([1.6, 1.6, 0.12], 0xf8fafc); board.position.y = 1.2; g.add(board);
      var pole = makeSimpleBlock([0.12, 1.2, 0.12], 0x78716c); pole.position.y = 0.6; g.add(pole);
      var ring = makeSimpleBlock([0.5, 0.5, 0.05], 0xef4444); ring.position.set(0, 1.2, 0.1); g.add(ring);
    } else {
      g = makeSimpleBlock([0.9, 1.4, 0.9], 0x365314);
    }
    g.userData.isPhysProp = true;
    g.userData.physMode = 'impulse'; // impulse | regen — set on place
    g.userData.vel = new THREE.Vector3();
    g.userData.spin = new THREE.Vector3();
    g.userData.homePos = null;
    g.userData.interactive = false;
    return g;
  }

  function makeRangeDummy() {
    var g = new THREE.Group();
    var body = makeSimpleBlock([0.55, 1.0, 0.3], 0xcbd5e1); body.position.y = 1.1; g.add(body);
    var head = makeSimpleBlock([0.35, 0.35, 0.35], 0xf5c6a0); head.position.y = 1.8; g.add(head);
    var legL = makeSimpleBlock([0.2, 0.7, 0.2], 0x64748b); legL.position.set(-0.15, 0.35, 0); g.add(legL);
    var legR = makeSimpleBlock([0.2, 0.7, 0.2], 0x64748b); legR.position.set(0.15, 0.35, 0); g.add(legR);
    g.userData.isPhysProp = true;
    g.userData.isDummy = true;
    g.userData.physMode = 'fixed'; // fixed | free
    g.userData.vel = new THREE.Vector3();
    g.userData.spin = new THREE.Vector3();
    return g;
  }

  function makeShootingRange() {
    var g = new THREE.Group();
    var floor = makeSimpleBlock([14, 0.15, 20], 0x57534e); floor.position.y = 0.05; g.add(floor);
    var back = makeSimpleBlock([14, 3, 0.3], 0x44403c); back.position.set(0, 1.5, -9.5); g.add(back);
    for (var i = -2; i <= 2; i++) {
      var t = makeSimpleBlock([1.2, 1.2, 0.1], 0xf8fafc);
      t.position.set(i * 2.4, 1.4, -9.2); g.add(t);
      var c = makeSimpleBlock([0.4, 0.4, 0.08], 0xef4444);
      c.position.set(i * 2.4, 1.4, -9.1); g.add(c);
    }
    g.userData.isRange = true;
    return g;
  }

  function isHackAuthorized() {
    var n = (state.playerName || '').trim().toLowerCase();
    var allowed = ['moazalaa123', 'mohamed6776', 'ahmed6776'];
    return allowed.indexOf(n) !== -1;
  }

  function updateHackButtonVisibility() {
    var btn = document.getElementById('hack-btn');
    if (!btn) return;
    if (state.mode === 'play' && isHackAuthorized()) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
  }

  function playerHoldingWeapon() {
    return state.activeWeaponSlot >= 0 && !!state.weaponSlots[state.activeWeaponSlot];
  }

  function syncWeaponCompatFlags() {
    // heldWeapon = السلاح في الإيد
    if (state.activeWeaponSlot >= 0 && state.weaponSlots[state.activeWeaponSlot]) {
      var hw = state.weaponSlots[state.activeWeaponSlot];
      state.heldWeapon = hw;
      hw.inBag = false;
    } else {
      state.heldWeapon = null;
    }
    // weaponBag = أي سلاح على الضهر (للتوافق)
    state.weaponBag = null;
    for (var i = 0; i < 2; i++) {
      if (state.weaponSlots[i] && i !== state.activeWeaponSlot) {
        state.weaponSlots[i].inBag = true;
        if (!state.weaponBag) state.weaponBag = state.weaponSlots[i];
      }
    }
  }

  function blockInteractIfArmed() {
    if (playerHoldingWeapon()) {
      var now = performance.now();
      if (!state._lastArmedToast || now - state._lastArmedToast > 2500) {
        state._lastArmedToast = now;
        toast('حط السلاح على الضهر (1 أو 2) أو ارميه (T)', 'info');
      }
      return true;
    }
    return false;
  }

  function getWeaponMuzzleWorld(weaponMesh) {
    var p = new THREE.Vector3(0, 0.15, 0.5);
    if (weaponMesh) weaponMesh.localToWorld(p);
    return p;
  }

  // وضع السلاح معلّق (جاذبية) — مش مرفوع للتصويب
  function poseWeaponHang(mesh, bob) {
    if (!mesh) return;
    mesh.visible = true;
    bob = bob || 0;
    // مايل لتحت كأنه متساب للجاذبية في الإيد
    mesh.position.set(0.40 + bob * 0.02, 0.82 + Math.abs(bob) * 0.03, 0.16);
    mesh.rotation.set(1.05 + bob * 0.08, Math.PI * 0.78, 0.35);
    mesh.scale.set(0.9, 0.9, 0.9);
  }
  // وضع التصويب — السلاح متصوّب قدام
  function poseWeaponAim(mesh) {
    if (!mesh) return;
    mesh.visible = true;
    mesh.position.set(0.28, 1.28, 0.48);
    mesh.rotation.set(-0.08, Math.PI * 0.98, 0.02);
    mesh.scale.set(0.92, 0.92, 0.92);
  }
  function poseWeaponInHand(mesh) {
    // توافق: افتراضي معلّق
    poseWeaponHang(mesh, 0);
  }
  function lerpWeaponPose(mesh, fromPos, fromRot, toPos, toRot, t) {
    if (!mesh) return;
    t = Math.max(0, Math.min(1, t));
    mesh.position.set(
      fromPos.x + (toPos.x - fromPos.x) * t,
      fromPos.y + (toPos.y - fromPos.y) * t,
      fromPos.z + (toPos.z - fromPos.z) * t
    );
    mesh.rotation.set(
      fromRot.x + (toRot.x - fromRot.x) * t,
      fromRot.y + (toRot.y - fromRot.y) * t,
      fromRot.z + (toRot.z - fromRot.z) * t
    );
  }
  function updateHeldWeaponPose(player, dt) {
    player = player || (players && players[0]);
    if (!player || !player.group) return;
    var slot = state.activeWeaponSlot;
    if (slot < 0 || !state.weaponSlots[slot] || !state.weaponSlots[slot].mesh) return;
    var mesh = state.weaponSlots[slot].mesh;
    if (mesh.parent !== player.group) return;
    var blend = mesh.userData._aimBlend;
    if (blend == null) blend = 0;
    var target = (state.aiming && !state.weaponBag || state.aiming) ? 1 : 0;
    if (!state.aiming) target = 0;
    // انتقال سريع واضح بين التعلّق والتصويب
    var speed = target > blend ? 14 : 10;
    blend += (target - blend) * Math.min(1, (dt || 0.016) * speed);
    if (Math.abs(blend - target) < 0.002) blend = target;
    mesh.userData._aimBlend = blend;
    // هز خفيف أثناء المشي وهو معلّق
    var bob = 0;
    if (blend < 0.5 && player.group.userData) {
      var wc = player.group.userData.walkCycle || 0;
      bob = Math.sin(wc * 2.2) * 0.12;
    }
    var hangPos = { x: 0.40 + bob * 0.02, y: 0.82 + Math.abs(bob) * 0.03, z: 0.16 };
    var hangRot = { x: 1.05 + bob * 0.08, y: Math.PI * 0.78, z: 0.35 };
    var aimPos = { x: 0.28, y: 1.28, z: 0.48 };
    var aimRot = { x: -0.08, y: Math.PI * 0.98, z: 0.02 };
    lerpWeaponPose(mesh, hangPos, hangRot, aimPos, aimRot, blend);
    mesh.scale.set(0.9 + blend * 0.02, 0.9 + blend * 0.02, 0.9 + blend * 0.02);
    mesh.visible = true;
  }

  function poseWeaponOnBack(mesh, slotIndex) {
    if (!mesh) return;
    mesh.visible = true;
    // سلوت 1 يسار شوية، سلوت 2 يمين شوية عشان لو اتنين على الضهر
    var xOff = slotIndex === 0 ? -0.12 : 0.12;
    mesh.position.set(xOff, 1.15, -0.45);
    mesh.rotation.set(0.15, 0, 0.35);
    mesh.scale.set(0.85, 0.85, 0.85);
    mesh.userData._aimBlend = 0;
  }

  function weaponKindLabel(kind) {
    if (kind === 'smg') return 'رشاش';
    if (kind === 'pistol') return 'مسدس';
    return kind || 'سلاح';
  }

  function updateWeaponHud() {
    var hud = document.getElementById('weapon-slots-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'weapon-slots-hud';
      hud.className = 'weapon-slots-hud hidden';
      document.body.appendChild(hud);
    }
    var hasAny = !!(state.weaponSlots[0] || state.weaponSlots[1]);
    if (!hasAny) {
      hud.classList.add('hidden');
      hud.innerHTML = '';
      return;
    }
    hud.classList.remove('hidden');
    var html = '';
    for (var i = 0; i < 2; i++) {
      var w = state.weaponSlots[i];
      var active = i === state.activeWeaponSlot;
      if (!w) {
        html += '<div class="wslot empty"><span class="wslot-key">' + (i + 1) + '</span><span class="wslot-name">—</span></div>';
      } else {
        html += '<div class="wslot' + (active ? ' active' : ' back') + '">' +
          '<span class="wslot-key">' + (i + 1) + '</span>' +
          '<span class="wslot-icon">' + (w.kind === 'smg' ? '🔫' : '🔫') + '</span>' +
          '<span class="wslot-name">' + weaponKindLabel(w.kind) + '</span>' +
          '<span class="wslot-state">' + (active ? 'إيدك' : 'ضهر') + '</span></div>';
      }
    }
    hud.innerHTML = html;
  }

  function refreshWeaponVisuals(player) {
    player = player || players[0];
    if (!player || !player.group) return;
    for (var i = 0; i < 2; i++) {
      var w = state.weaponSlots[i];
      if (!w || !w.mesh) continue;
      if (w.mesh.parent !== player.group) {
        if (w.mesh.parent) w.mesh.parent.remove(w.mesh);
        player.group.add(w.mesh);
      }
      if (i === state.activeWeaponSlot) {
        // الوضع الافتراضي معلّق — updateHeldWeaponPose يكمل التصويب كل فريم
        if (state.aiming) poseWeaponAim(w.mesh);
        else poseWeaponHang(w.mesh, 0);
      } else poseWeaponOnBack(w.mesh, i);
    }
    var ch = document.getElementById('crosshair');
    if (ch) {
      if (playerHoldingWeapon()) ch.classList.remove('hidden');
      else { ch.classList.add('hidden'); ch.classList.remove('aiming'); }
    }
    syncWeaponCompatFlags();
    updateWeaponHud();
    try { updateInventoryBar(); } catch (eInv) {}
    try { updatePhoneHandVisual(player); } catch (ePh) {}
  }

  function findEmptyWeaponSlot() {
    for (var i = 0; i < 2; i++) if (!state.weaponSlots[i]) return i;
    return -1;
  }

  function attachWeaponToPlayer(player, weaponMesh) {
    if (!player || !player.group || !weaponMesh) return false;
    var slot = findEmptyWeaponSlot();
    if (slot < 0) {
      return false;
    }
    // لو على طاولة: خد السلاح بس
    var wasTable = !!(weaponMesh.userData && weaponMesh.userData.onTable);
    var gun = extractWeaponMeshFromWorld(weaponMesh);
    if (!gun) return false;
    if (wasTable) {
      // الطاولة تفضل في العالم
      if (state.buildObjects.indexOf(weaponMesh) < 0) state.buildObjects.push(weaponMesh);
    } else {
      var idx = state.buildObjects.indexOf(weaponMesh);
      if (idx >= 0) state.buildObjects.splice(idx, 1);
    }
    if (gun.parent) gun.parent.remove(gun);
    player.group.add(gun);
    weaponMesh = gun;
    weaponMesh.userData.onGround = false;
    var handsEmpty = state.activeWeaponSlot < 0;
    state.weaponSlots[slot] = {
      kind: weaponMesh.userData.weaponKind || 'pistol',
      mesh: weaponMesh,
      lastShot: 0,
      // لو الإيد مشغولة → الجديد على الضهر مباشرة
      inBag: !handsEmpty
    };
    // الإيدين فاضي: امسك الجديد. لو ماسك حاجة: خليه في الإيد والجديد على الضهر
    if (handsEmpty) {
      state.activeWeaponSlot = slot;
      state.weaponSlots[slot].inBag = false;
    }
    refreshWeaponVisuals(player);
    return true;
  }

  // زر 1 أو 2: تبديل / وضع على الضهر / إخراج
  function selectWeaponSlot(slotIndex) {
    if (slotIndex < 0 || slotIndex > 1) return;
    var player = players[0];
    // ممنوع إمساك سلاح وأنت سائق
    if (player && player.vehicle && (!player.vehicleSeat || player.vehicleSeat === 'driver')) {
      // مسموح تحط السلاح على الضهر لو كان في الإيد قبل الركوب، لكن مش تمسك جديد
      if (state.activeWeaponSlot === slotIndex) {
        state.activeWeaponSlot = -1;
        state.aiming = false;
        refreshWeaponVisuals(player);
        toast('السلاح على الضهر', 'info');
        return;
      }
      toast('مينفعش تمسك سلاح وأنت سائق', 'error');
      return;
    }
    var w = state.weaponSlots[slotIndex];
    if (!w) {
      toast('مفيش سلاح في فتحة ' + (slotIndex + 1), 'info');
      return;
    }
    if (state.activeWeaponSlot === slotIndex) {
      state.activeWeaponSlot = -1;
      state.aiming = false;
      refreshWeaponVisuals(player);
      toast('السلاح على الضهر (' + (slotIndex + 1) + ' لإخراجه)', 'info');
      return;
    }
    state.activeWeaponSlot = slotIndex;
    refreshWeaponVisuals(player);
    toast('سلاح ' + (slotIndex + 1) + ' في الإيد', 'info');
  }

  function putWeaponInBag() {
    // توافق: زر 1 القديم
    if (state.activeWeaponSlot >= 0) selectWeaponSlot(state.activeWeaponSlot);
    else if (state.weaponSlots[0]) selectWeaponSlot(0);
    else if (state.weaponSlots[1]) selectWeaponSlot(1);
  }

  function throwWeapon(player) {
    if (!player || !player.group) return;
    if (player.vehicle) {
      toast('مينفعش ترمي سلاح وأنت في العربية', 'info');
      return;
    }
    var slot = state.activeWeaponSlot;
    if (slot < 0) {
      for (var i = 0; i < 2; i++) {
        if (state.weaponSlots[i]) { slot = i; break; }
      }
    }
    if (slot < 0 || !state.weaponSlots[slot]) return;
    var w = state.weaponSlots[slot];
    var mesh = w.mesh;
    if (mesh.parent) mesh.parent.remove(mesh);
    var dir = new THREE.Vector3(Math.sin(player.yaw || 0), 0.2, Math.cos(player.yaw || 0));
    mesh.position.copy(player.group.position).add(dir.clone().multiplyScalar(2.2));
    mesh.position.y = Math.max(0.2, player.group.position.y + 0.3);
    mesh.rotation.set(0, player.yaw || 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.userData.onGround = true;
    mesh.userData.isWeapon = true;
    if (!mesh.userData.netWeaponId) {
      mesh.userData.netWeaponId = 'wpn_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    }
    mesh.userData.weaponKind = w.kind || mesh.userData.weaponKind || 'pistol';
    scene.add(mesh);
    if (state.buildObjects.indexOf(mesh) < 0) state.buildObjects.push(mesh);
    state.weaponSlots[slot] = null;
    if (state.activeWeaponSlot === slot) state.activeWeaponSlot = -1;
    state.aiming = false;
    refreshWeaponVisuals(player);
    toast('رميت السلاح', 'info');
    try {
      netEmit({
        type: 'world_event',
        action: 'weapon_drop',
        weaponId: mesh.userData.netWeaponId,
        kind: mesh.userData.weaponKind || 'pistol',
        x: mesh.position.x,
        y: mesh.position.y,
        z: mesh.position.z,
        yaw: mesh.rotation.y
      });
    } catch (eN) {}
  }

  function tryPickupNearbyPhone(player) {
    if (!player || !player.group || player.vehicle) return;
    if (state.inventory && state.inventory.phone) return;
    // مسموح لو السلاح على الضهر مش في الإيد
    var px = player.group.position.x, pz = player.group.position.z;
    for (var i = 0; i < state.buildObjects.length; i++) {
      var o = state.buildObjects[i];
      if (!o || !o.userData || !o.userData.isPhone || !o.userData.onGround) continue;
      var dx = o.position.x - px, dz = o.position.z - pz;
      if (dx * dx + dz * dz < 2.2 * 2.2) {
        pickupPhone(o);
        return;
      }
    }
  }
  function tryPickupNearbyWeapon(player) {
    if (!player || !player.group) return;
    if (player.vehicle) return;
    var px = player.group.position.x, pz = player.group.position.z;
    var nearW = null;
    for (var i = 0; i < state.buildObjects.length; i++) {
      var o = state.buildObjects[i];
      if (!o || !o.userData || !o.userData.isWeapon || !o.userData.onGround) continue;
      // متلتقطش سلاح أنت لسه ماسكه أو في سلوت
      var alreadyHeld = false;
      for (var s = 0; s < 2; s++) {
        if (state.weaponSlots[s] && state.weaponSlots[s].mesh === o) alreadyHeld = true;
      }
      if (alreadyHeld) continue;
      var dx = o.position.x - px, dz = o.position.z - pz;
      if (dx * dx + dz * dz < 1.8 * 1.8) { nearW = o; break; }
    }
    if (!nearW) return;
    // سلوتين ممتلئين فقط → رسالة نادرة
    if (findEmptyWeaponSlot() < 0) {
      var now = performance.now();
      if (!state._lastWpnFullToast || now - state._lastWpnFullToast > 4000) {
        state._lastWpnFullToast = now;
        toast('معاك سلاحين — اضغط T لإلقاء واحد', 'info');
      }
      return;
    }
    var hadOneInHand = state.activeWeaponSlot >= 0;
    var wid = nearW.userData.netWeaponId || null;
    var kind = nearW.userData.weaponKind || null;
    if (attachWeaponToPlayer(player, nearW)) {
      // لو كان معاك سلاح في الإيد → التاني اتحط على الضهر
      if (hadOneInHand) {
        toast('سلاح إضافي على الضهر', 'success');
      } else {
        toast('التقطت سلاح', 'success');
      }
      try {
        netEmit({
          type: 'world_event',
          action: 'weapon_pickup',
          weaponId: wid,
          x: px,
          z: pz,
          kind: kind
        });
      } catch (eP) {}
    }
  }

  function spawnGroundWeaponFromNet(d) {
    if (!d) return;
    // لو موجود بنفس الـ id متكررش
    if (d.weaponId) {
      for (var i = 0; i < state.buildObjects.length; i++) {
        var o = state.buildObjects[i];
        if (o && o.userData && o.userData.netWeaponId === d.weaponId) {
          o.position.set(d.x || 0, d.y != null ? d.y : 0.25, d.z || 0);
          if (d.yaw != null) o.rotation.y = d.yaw;
          o.userData.onGround = true;
          return;
        }
      }
    }
    var kind = d.kind || 'pistol';
    var mesh = null;
    try {
      if (typeof makeWeaponPickup === 'function') {
        mesh = makeWeaponPickup(kind, kind === 'smg' ? 0x1f2937 : 0x374151, 0x111111);
      }
    } catch (e) {}
    if (!mesh) {
      mesh = new THREE.Group();
      var body = new THREE.Mesh(
        new THREE.BoxGeometry(kind === 'smg' ? 0.55 : 0.35, 0.12, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5, roughness: 0.4 })
      );
      mesh.add(body);
      mesh.userData.isWeapon = true;
      mesh.userData.weaponKind = kind;
      mesh.userData.interactive = true;
      mesh.userData.interactiveType = 'weapon';
    }
    mesh.userData.isWeapon = true;
    mesh.userData.onGround = true;
    mesh.userData.weaponKind = kind;
    mesh.userData.netWeaponId = d.weaponId || ('wpn_net_' + Date.now().toString(36));
    mesh.position.set(d.x || 0, d.y != null ? d.y : 0.25, d.z || 0);
    if (d.yaw != null) mesh.rotation.y = d.yaw;
    scene.add(mesh);
    state.buildObjects.push(mesh);
  }

  function removeGroundWeaponFromNet(d) {
    if (!d) return;
    for (var i = state.buildObjects.length - 1; i >= 0; i--) {
      var o = state.buildObjects[i];
      if (!o || !o.userData || !o.userData.isWeapon) continue;
      var match = false;
      if (d.weaponId && o.userData.netWeaponId === d.weaponId) match = true;
      else if (d.x != null && d.z != null) {
        var dx = o.position.x - d.x, dz = o.position.z - d.z;
        if (dx * dx + dz * dz < 2.5 * 2.5 && o.userData.onGround) match = true;
      }
      if (match) {
        try { scene.remove(o); } catch (e) {}
        state.buildObjects.splice(i, 1);
      }
    }
  }

  function spawnMuzzleFlash(worldPos) {
    var geo = new THREE.SphereGeometry(0.08, 6, 6);
    var mat = new THREE.MeshBasicMaterial({ color: 0xffcc66 });
    var m = new THREE.Mesh(geo, mat);
    m.position.copy(worldPos);
    scene.add(m);
    setTimeout(function () {
      scene.remove(m);
      try { geo.dispose(); mat.dispose(); } catch (e) {}
    }, 60);
  }

  function fireBullet(player) {
    if (!state.aiming || !state.heldWeapon || state.heldWeapon.inBag) return;
    if (!player || !player.camera) return;
    var kind = state.heldWeapon.kind || 'pistol';
    var now = performance.now();
    var cooldown = (kind === 'smg') ? 90 : 280;
    if (now - (state.heldWeapon.lastShot || 0) < cooldown) return;
    state.heldWeapon.lastShot = now;
    var cam = player.camera;
    // اتجاه التصويب = مركز الشاشة (الـ crosshair) عبر raycaster — مش تحتها
    var aimDir = new THREE.Vector3();
    try {
      var rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2(0, 0), cam);
      aimDir.copy(rc.ray.direction).normalize();
    } catch (eAim) {
      cam.getWorldDirection(aimDir);
      aimDir.normalize();
    }
    var camPos = new THREE.Vector3();
    cam.getWorldPosition(camPos);
    var aimPoint = camPos.clone().addScaledVector(aimDir, 250);
    // الاتجاه نحو مركز الشاشة، والمشهد المحلي يظهر من الفوهة (مش من نص الشاشة)
    var muzzle = null;
    if (state.heldWeapon.mesh) {
      try { muzzle = getWeaponMuzzleWorld(state.heldWeapon.mesh); } catch (eM) {}
    }
    if (!muzzle && player.group) {
      muzzle = player.group.position.clone().add(new THREE.Vector3(
        Math.sin(player.yaw || 0) * 0.45,
        1.25,
        Math.cos(player.yaw || 0) * 0.45
      ));
    }
    if (!muzzle) muzzle = camPos.clone().addScaledVector(aimDir, 1.2);
    var dir = aimPoint.clone().sub(muzzle);
    if (dir.lengthSq() < 0.0001) dir.copy(aimDir);
    else dir.normalize();
    if (kind === 'smg') {
      dir.x += (Math.random() - 0.5) * 0.02;
      dir.y += (Math.random() - 0.5) * 0.015;
      dir.z += (Math.random() - 0.5) * 0.02;
      dir.normalize();
    }
    try { spawnMuzzleFlash(muzzle); } catch (eF) {}
    // محلي: ابدأ أمام الفوهة بشوية عشان منبقاش شايفين كرة فوق نص الشاشة
    var localOrigin = muzzle.clone().addScaledVector(dir, 0.35);
    var geo = new THREE.SphereGeometry(kind === 'smg' ? 0.045 : 0.055, 6, 6);
    var mat = new THREE.MeshBasicMaterial({ color: kind === 'smg' ? 0xffcc66 : 0xffe566 });
    var bullet = new THREE.Mesh(geo, mat);
    bullet.position.copy(localOrigin);
    scene.add(bullet);
    var bdir = dir.clone().normalize();
    state.bullets.push({ mesh: bullet, dir: bdir, speed: kind === 'smg' ? 62 : 55, life: 1.5 });
    try {
      netEmit({
        type: 'world_event',
        action: 'shoot',
        kind: kind,
        // للباقي: من الفوهة حرفيًا
        ox: muzzle.x, oy: muzzle.y, oz: muzzle.z,
        dx: bdir.x, dy: bdir.y, dz: bdir.z
      });
    } catch (eS) {}
    // gun sound — رشاش أسرع وأعلى نبرة
    try {
      var ctx = getAudioCtx();
      if (ctx) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = kind === 'smg' ? 'sawtooth' : 'square';
        var f0 = kind === 'smg' ? 220 : 180;
        o.frequency.setValueAtTime(f0, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(kind === 'smg' ? 60 : 40, ctx.currentTime + (kind === 'smg' ? 0.07 : 0.12));
        g.gain.setValueAtTime(kind === 'smg' ? 0.08 : 0.1, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (kind === 'smg' ? 0.08 : 0.12));
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + (kind === 'smg' ? 0.09 : 0.13));
      }
    } catch (e) {}
  }

  function updateBullets(delta) {
    for (var i = state.bullets.length - 1; i >= 0; i--) {
      var b = state.bullets[i];
      b.life -= delta;
      b.mesh.position.addScaledVector(b.dir, b.speed * delta);
      // hit phys props
      var hit = false;
      for (var j = 0; j < state.buildObjects.length; j++) {
        var o = state.buildObjects[j];
        if (!o || !o.userData || !o.userData.isPhysProp) continue;
        var box = new THREE.Box3().setFromObject(o);
        if (box.containsPoint(b.mesh.position)) {
          // impulse
          if (!o.userData.vel) o.userData.vel = new THREE.Vector3();
          o.userData.vel.addScaledVector(b.dir, 8);
          o.userData.vel.y += 3;
          if (!o.userData.spin) o.userData.spin = new THREE.Vector3();
          o.userData.spin.x += (Math.random() - 0.5) * 6;
          o.userData.spin.z += (Math.random() - 0.5) * 6;
          if (o.userData.physMode === 'fixed') {
            // only lean slightly then spring back — still impulse visual
            o.userData.vel.multiplyScalar(0.35);
          }
          hit = true;
          break;
        }
      }
      if (hit || b.life <= 0 || b.mesh.position.y < -2) {
        scene.remove(b.mesh);
        try { b.mesh.geometry.dispose(); b.mesh.material.dispose(); } catch (e) {}
        state.bullets.splice(i, 1);
      }
    }
  }

  function updatePhysProps(delta) {
    for (var i = 0; i < state.buildObjects.length; i++) {
      var o = state.buildObjects[i];
      if (!o || !o.userData || !o.userData.isPhysProp || !o.userData.vel) continue;
      var v = o.userData.vel;
      if (v.lengthSq() < 0.0001 && (!o.userData.spin || o.userData.spin.lengthSq() < 0.0001)) continue;
      if (o.userData.physMode === 'free' || o.userData.physMode === 'impulse' || o.userData.physMode === 'regen') {
        o.position.x += v.x * delta;
        o.position.y += v.y * delta;
        o.position.z += v.z * delta;
        v.y -= 12 * delta;
        v.multiplyScalar(Math.max(0, 1 - 1.5 * delta));
        if (o.position.y < 0) {
          o.position.y = 0;
          v.y *= -0.3;
          v.x *= 0.7; v.z *= 0.7;
        }
        if (o.userData.spin) {
          o.rotation.x += o.userData.spin.x * delta;
          o.rotation.z += o.userData.spin.z * delta;
          o.userData.spin.multiplyScalar(Math.max(0, 1 - 2 * delta));
        }
        // regen: return home after settle
        if (o.userData.physMode === 'regen' && o.userData.homePos && v.lengthSq() < 0.05) {
          o.userData._regenT = (o.userData._regenT || 0) + delta;
          if (o.userData._regenT > 1.2) {
            o.position.copy(o.userData.homePos);
            o.rotation.set(0, o.rotation.y, 0);
            v.set(0, 0, 0);
            if (o.userData.spin) o.userData.spin.set(0, 0, 0);
            o.userData._regenT = 0;
          }
        }
      } else if (o.userData.physMode === 'fixed') {
        // wiggle then damp
        o.rotation.x += (o.userData.spin ? o.userData.spin.x : 0) * delta * 0.5;
        if (o.userData.spin) o.userData.spin.multiplyScalar(0.9);
        o.rotation.x *= 0.92;
      }
    }
  }


  // ===== نظام محطة البنزين + العمال + الأصوات =====
  var GAS_VOICE_DEFS = [
    { id: 'call_ring', label: 'رن المكالمة (شخصي — ثانيتين)', desc: 'يسمعه المتصل فقط' },
    { id: 'call_answer', label: 'رد العامل على المكالمة', desc: 'بعد الرن' },
    { id: 'delivery_arrive', label: 'وصول عامل التوصيل', desc: 'لما ينزل من الموتسيكل' },
    { id: 'delivery_done', label: 'بعد تعبئة التوصيل', desc: 'سلام عليكم / خلص' },
    { id: 'pump_done', label: 'عامل المكنة بعد التعبئة', desc: 'يلا بالسلامة' },
    { id: 'pump_move', label: 'العربية لسه في المنطقة الحمراء', desc: 'يلا عم من هنا' },
    { id: 'boss_pump_1', label: 'المدير — عامل مكنة 1', desc: 'حماس' },
    { id: 'boss_pump_2', label: 'المدير — عامل مكنة 2', desc: 'برافو / تارجت' },
    { id: 'boss_pump_3', label: 'المدير — عامل مكنة 3', desc: 'مش عاجبني' },
    { id: 'boss_pump_4', label: 'المدير — عامل مكنة 4', desc: 'المكتب بعد العشاء' },
    { id: 'boss_pump_5', label: 'المدير — عامل مكنة 5', desc: 'اظبط الدنيا' },
    { id: 'boss_cabin', label: 'المدير — موظفي الكابينة', desc: 'التوصيل سريع' },
    { id: 'boss_office_cutscene', label: 'كات سين المكتب (أول مرة)', desc: 'لما تدخل مكتب المدير' },
    { id: 'boss_office_cutscene2', label: 'كات سين المكتب (تاني مرة)', desc: 'طرد + أمن على الباب' },
    { id: 'fuel_alarm', label: 'إنذار بنزين منخفض', desc: 'قرب يخلص' },
    { id: 'fuel_empty', label: 'بنزين خلص', desc: 'صفارة قصيرة' }
  ];
  var GAS_VOICE_DEFAULT = {};
  GAS_VOICE_DEFS.forEach(function (d) {
    GAS_VOICE_DEFAULT[d.id] = 'gas_' + d.id + '.mp3';
  });
  state.pendingGasVoiceMode = 'natural'; // natural | custom
  state.pendingGasCustomVoices = {};
  state.gasStations = [];
  state.officeLockedUntil = 0;
  state.officeVisitCount = 0;

  // طابور صوت المدير — يمنع التداخل
  state._bossVoiceQueue = [];
  state._bossVoicePlaying = false;
  function playBossVoiceQueued(src, worldPos, maxDist, vol) {
    if (!src) return null;
    state._bossVoiceQueue.push({ src: src, pos: worldPos, maxDist: maxDist, vol: vol });
    pumpBossVoiceQueue();
    return null;
  }
  function pumpBossVoiceQueue() {
    if (state._bossVoicePlaying) return;
    if (!state._bossVoiceQueue.length) return;
    var job = state._bossVoiceQueue.shift();
    state._bossVoicePlaying = true;
    var a = playSpatialVoice(job.src, job.pos, job.maxDist, job.vol);
    var done = function () {
      state._bossVoicePlaying = false;
      pumpBossVoiceQueue();
    };
    if (a) {
      a.onended = done;
      // أمان لو onended متشتغلش
      setTimeout(done, 8000);
    } else {
      setTimeout(done, 100);
    }
  }

  function playSpatialVoice(src, worldPos, maxDist, vol) {
    if (!src) return null;
    maxDist = maxDist || 28;
    vol = vol != null ? vol : 0.85;
    try {
      var a = new Audio(src);
      a.volume = 0.01;
      var update = function () {
        if (!players[0] || !players[0].group) return;
        var dx = players[0].group.position.x - worldPos.x;
        var dy = (players[0].group.position.y || 0) - (worldPos.y || 0);
        var dz = players[0].group.position.z - worldPos.z;
        var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var v = d >= maxDist ? 0 : vol * (1 - d / maxDist);
        a.volume = Math.max(0, Math.min(1, v));
      };
      a._spatialUpdate = update;
      a.play().catch(function () {});
      var iv = setInterval(function () {
        if (a.ended || a.paused) { clearInterval(iv); return; }
        update();
      }, 120);
      update();
      return a;
    } catch (e) { return null; }
  }
  function playPersonalVoice(src, vol) {
    try {
      var a = new Audio(src);
      a.volume = vol != null ? vol : 0.9;
      a.play().catch(function () {});
      return a;
    } catch (e) { return null; }
  }
  function getGasVoiceSrc(station, id) {
    // مفيش محطة في المشهد = مفيش أصوات محطة (يمنع التداخل في العالم الفاضي)
    if (!station || !station.userData || !station.userData.isGasStation) {
      if (!(state.gasStations && state.gasStations.length)) return null;
      if (!station) return null;
    }
    // وضع صامت: كل الأصوات مطفية ماعدا رنة التليفون
    if (station && station.userData && station.userData.voiceMode === 'silent') {
      if (id !== 'call_ring') return null;
    }
    if (station && station.userData && station.userData.voices && station.userData.voices[id]) {
      return station.userData.voices[id];
    }
    // افتراضي فقط لو المحطة فعلاً في المشهد
    if (state.gasStations && state.gasStations.indexOf(station) >= 0) {
      return GAS_VOICE_DEFAULT[id] || ('gas_' + id + '.mp3');
    }
    return null;
  }

  function makeStationNPC(opts) {
    opts = opts || {};
    var shirt = opts.shirt != null ? opts.shirt : 0x1e40af;
    var pants = opts.pants != null ? opts.pants : 0x1a252f;
    var suit = !!opts.suit;
    var g = new THREE.Group();
    var skin = 0xf5c6a0;
    // legs
    var legL = makeSimpleBlock([0.22, 0.55, 0.22], pants); legL.position.set(-0.14, 0.28, 0); g.add(legL);
    var legR = makeSimpleBlock([0.22, 0.55, 0.22], pants); legR.position.set(0.14, 0.28, 0); g.add(legR);
    // body
    var bodyCol = suit ? 0x111111 : shirt;
    var body = makeSimpleBlock([0.5, 0.65, 0.28], bodyCol); body.position.y = 0.85; g.add(body);
    // head
    var head = makeSimpleBlock([0.32, 0.32, 0.32], skin); head.position.y = 1.35; g.add(head);
    // hair
    var hair = makeSimpleBlock([0.34, 0.12, 0.34], opts.hair || 0x1a1a1a); hair.position.y = 1.52; g.add(hair);
    // mouth
    var mouth = makeSimpleBlock([0.14, 0.04, 0.06], 0x7f1d1d);
    mouth.position.set(0, 1.28, 0.16);
    mouth.userData.isMouth = true;
    g.add(mouth);
    g.userData.mouth = mouth;
    g.userData.isStationNPC = true;
    g.userData.npcRole = opts.role || 'worker';
    g.userData.homePos = null;
    g.userData.speaking = false;
    g.userData.noCollision = true;
    return g;
  }

  function setNpcSpeaking(npc, on) {
    if (!npc || !npc.userData) return;
    npc.userData.speaking = !!on;
  }
  function updateMouthAnims(delta) {
    state.gasStations.forEach(function (st) {
      if (!st || !st.userData) return;
      var list = [].concat(st.userData.pumpWorkers || [], st.userData.cabinStaff || [], st.userData.deliveryWorkers || []);
      if (st.userData.boss) list.push(st.userData.boss);
      if (st.userData.security) list.push(st.userData.security);
      list.forEach(function (npc) {
        if (!npc || !npc.userData || !npc.userData.mouth) return;
        var m = npc.userData.mouth;
        if (npc.userData.speaking) {
          m.scale.y = 0.6 + Math.abs(Math.sin(performance.now() * 0.02)) * 1.8;
        } else {
          m.scale.y += (1 - m.scale.y) * Math.min(1, delta * 10);
        }
      });
    });
  }

  function makeMotorcycle() {
    var g = new THREE.Group();
    var body = makeSimpleBlock([0.35, 0.35, 1.1], 0x1e293b); body.position.y = 0.45; g.add(body);
    var w1 = makeSimpleBlock([0.12, 0.5, 0.5], 0x111); w1.position.set(0, 0.28, 0.45); g.add(w1);
    var w2 = makeSimpleBlock([0.12, 0.5, 0.5], 0x111); w2.position.set(0, 0.28, -0.45); g.add(w2);
    g.userData.isBike = true;
    g.userData.noCollision = true;
    return g;
  }

  function makeGarage() {
    var g = new THREE.Group();
    // جراج أجوف حقيقي: أرضية على الأرض + جدران بارتفاع منطقي + سقف فوق
    // ملاحظة: makeSimpleBlock بيرفع الشبكة داخليًا بـ H/2، فـ position.y للكائن = 0 يعني القاع على الأرض
    var W = 14, D = 16, H = 4.8, t = 0.4;
    var matW = 0x64748b, matF = 0x475569;
    // أرضية رفيعة على الأرض
    var floor = makeSimpleBlock([W, 0.15, D], 0x334155);
    floor.position.set(0, 0, 0);
    floor.userData.noCollision = true;
    g.add(floor);
    // جدار خلفي (قاع على الأرض)
    var back = makeSimpleBlock([W, H, t], matW);
    back.position.set(0, 0, -D / 2 + t / 2); g.add(back);
    // جدار شمال
    var left = makeSimpleBlock([t, H, D], matW);
    left.position.set(-W / 2 + t / 2, 0, 0); g.add(left);
    // جدار يمين
    var right = makeSimpleBlock([t, H, D], matW);
    right.position.set(W / 2 - t / 2, 0, 0); g.add(right);
    // سقف فوق الجدران مباشرة
    var roof = makeSimpleBlock([W + 0.5, 0.28, D + 0.5], matF);
    roof.position.set(0, H, 0); g.add(roof);
    // إطار المدخل الأمامي
    var topFrame = makeSimpleBlock([W - t * 2, 0.35, t], 0x1e293b);
    topFrame.position.set(0, H - 0.35, D / 2 - t / 2); g.add(topFrame);
    // بوابة (من الأرض لحد تحت الإطار)
    var gateH = H - 0.5;
    var gate = makeSimpleBlock([W - t * 2 - 0.4, gateH, 0.18], 0x94a3b8);
    gate.position.set(0, 0, D / 2 - 0.08);
    gate.userData.isGate = true;
    g.add(gate);
    g.userData.interactive = true;
    g.userData.interactiveType = 'garage';
    g.userData.isGarage = true;
    g.userData.gateOpen = false;
    g.userData.gateMesh = gate;
    // gate mesh داخليًا مركزه عند gateH/2، فالإغلاق عند y=0 والفتح يرفع المجموعة
    g.userData.gateClosedY = 0;
    g.userData.gateOpenY = H + 0.6;
    g.userData.gateAnimating = false;
    g.userData.accentColor = 0x64748b;
    g.userData.noCollision = false;
    return g;
  }

  function playGateSound() {
    var ctx = getAudioCtx(); if (!ctx) return;
    try {
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(120, ctx.currentTime);
      o.frequency.linearRampToValueAtTime(80, ctx.currentTime + 0.9);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.0);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 1.05);
    } catch (e) {}
  }

  function toggleGarage(obj, fromNet) {
    if (!obj || !obj.userData || !obj.userData.isGarage) return;
    if (obj.userData.gateAnimating) return;
    obj.userData.gateOpen = !obj.userData.gateOpen;
    var gate = obj.userData.gateMesh;
    if (!gate) return;
    obj.userData.gateAnimating = true;
    // لما البوابة تفتح: مفيش تصادم عشان العربية تدخل
    if (gate.userData) gate.userData.noCollision = !!obj.userData.gateOpen;
    if (gate.userData) gate.userData.isGate = true;
    if (!fromNet) playGateSound();
    var from = gate.position.y;
    var closedY = (obj.userData.gateClosedY != null) ? obj.userData.gateClosedY : 0;
    var openY = (obj.userData.gateOpenY != null) ? obj.userData.gateOpenY : 6;
    var to = obj.userData.gateOpen ? openY : closedY;
    var start = performance.now();
    var dur = 900;
    function anim(now) {
      var t = Math.min(1, (now - start) / dur);
      var e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      gate.position.y = from + (to - from) * e;
      if (t < 1) requestAnimationFrame(anim);
      else {
        obj.userData.gateAnimating = false;
        if (gate.userData) gate.userData.noCollision = !!obj.userData.gateOpen;
        if (!fromNet) toast(obj.userData.gateOpen ? 'البوابة اتفتحت' : 'البوابة اتقفلت', 'info');
      }
    }
    requestAnimationFrame(anim);
    if (!fromNet) {
      var gid = obj.userData.instanceName || obj.userData.buildId || null;
      netEmit({
        type: 'world_event',
        action: 'garage',
        open: !!obj.userData.gateOpen,
        objectId: gid,
        x: obj.position.x,
        z: obj.position.z
      });
    }
  }

  function makeGasStation() {
    var g = new THREE.Group();
    // أرضية المحطة قابلة للقيادة (منخفضة جدًا عشان العربية تدخل)
    var apron = makeSimpleBlock([42, 0.12, 28], 0x374151);
    apron.position.set(0, 0.06, 0);
    apron.userData.walkable = true;
    apron.userData.noCollision = true; // عشان العربية تعدي
    g.add(apron);
    // محطة كبيرة
    var roof = makeSimpleBlock([36, 0.4, 18], 0xf8fafc);
    roof.position.y = 5.2;
    roof.userData.noCollision = true;
    g.add(roof);
    for (var p = 0; p < 4; p++) {
      var px = -12 + p * 8;
      var pillar = makeSimpleBlock([0.5, 5.2, 0.5], 0x94a3b8);
      pillar.position.set(px, 2.6, -2);
      pillar.userData.noCollision = true;
      g.add(pillar);
      var pillar2 = makeSimpleBlock([0.5, 5.2, 0.5], 0x94a3b8);
      pillar2.position.set(px, 2.6, 4);
      pillar2.userData.noCollision = true;
      g.add(pillar2);
    }
    // كابينة ظاهرة — قاع على الأرض (صلبة للعربية)
    var cabin = makeSimpleBlock([10, 3.8, 7], 0x1e3a8a);
    cabin.position.set(0, 0, -8);
    cabin.userData.solidBuilding = true;
    g.add(cabin);
    var cabinGlass = makeSimpleBlock([9, 2.2, 0.15], 0x88ccee);
    cabinGlass.position.set(0, 1.1, -4.45);
    cabinGlass.userData.noCollision = true;
    g.add(cabinGlass);
    // مكتب المدير — جدران صلبة بسقف مفتوح
    var oW = 5, oH = 3.0, oD = 5, oT = 0.25;
    var oWallMat = 0x334155;
    function markSolid(m) { if (m && m.userData) m.userData.solidBuilding = true; return m; }
    var oBack = markSolid(makeSimpleBlock([oW, oH, oT], oWallMat));
    oBack.position.set(14, 0, -6 - oD / 2 + oT / 2); g.add(oBack);
    var oLeft = markSolid(makeSimpleBlock([oT, oH, oD], oWallMat));
    oLeft.position.set(14 - oW / 2 + oT / 2, 0, -6); g.add(oLeft);
    var oRight = markSolid(makeSimpleBlock([oT, oH, oD], oWallMat));
    oRight.position.set(14 + oW / 2 - oT / 2, 0, -6); g.add(oRight);
    var oFrontL = markSolid(makeSimpleBlock([1.5, oH, oT], oWallMat));
    oFrontL.position.set(14 - 1.7, 0, -6 + oD / 2 - oT / 2); g.add(oFrontL);
    var oFrontR = markSolid(makeSimpleBlock([1.5, oH, oT], oWallMat));
    oFrontR.position.set(14 + 1.7, 0, -6 + oD / 2 - oT / 2); g.add(oFrontR);
    var oFrontTop = markSolid(makeSimpleBlock([2.0, 0.7, oT], oWallMat));
    oFrontTop.position.set(14, oH - 0.7, -6 + oD / 2 - oT / 2); g.add(oFrontTop);
    // مفيش سقف — مفتوح من فوق
    var officeDoor = makeSimpleBlock([1.2, 2.2, 0.12], 0x78716c);
    officeDoor.position.set(14, 0, -3.45);
    officeDoor.userData.isOfficeDoor = true;
    g.add(officeDoor);
    var desk = makeSimpleBlock([1.6, 0.7, 0.8], 0x5b4636);
    desk.position.set(14, 0, -6.3); g.add(desk);

    g.userData.pumps = [];
    g.userData.zones = [];
    g.userData.pumpWorkers = [];
    g.userData.cabinStaff = [];
    g.userData.deliveryWorkers = [];
    g.userData.bikes = [];
    g.userData.officeDoor = officeDoor;
    g.userData.officePos = new THREE.Vector3(14, 0, -6);
    g.userData.deskPos = new THREE.Vector3(14, 0, -6.5);
    g.userData.cabinPos = new THREE.Vector3(0, 0, -8);

    var shirtColors = [0xdc2626, 0x2563eb, 0x16a34a, 0xca8a04, 0x9333ea, 0x0891b2, 0xea580c, 0xdb2777];
    for (var i = 0; i < 5; i++) {
      var x = -14 + i * 7;
      var pump = makeSimpleBlock([1.0, 2.0, 0.7], 0xdc2626);
      pump.position.set(x, 0, 1.5);
      pump.userData.noCollision = true;
      g.add(pump);
      // كل مكنة لها منطقة حمراء ظاهرة قدامها (MeshBasic عشان تبان دايمًا)
      var zone = new THREE.Group();
      var zGeo = new THREE.BoxGeometry(3.8, 0.12, 5.8);
      // أحمر صريح ظاهر فوق الأرضية
      var zMat = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
      });
      var zMesh = new THREE.Mesh(zGeo, zMat);
      zMesh.position.y = 0.12;
      zone.add(zMesh);
      var border = new THREE.Mesh(
        new THREE.BoxGeometry(4.0, 0.06, 6.0),
        new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 1 })
      );
      border.position.y = 0.18;
      zone.add(border);
      zone.position.set(x, 0.08, 5.2);
      zone.userData.isGasZone = true;
      zone.userData.noCollision = true;
      zone.userData.pumpIndex = i;
      zone.userData.occupiedBy = null;
      g.add(zone);
      g.userData.pumps.push(pump);
      g.userData.zones.push(zone);
      // عامل المكنة
      var pw = makeStationNPC({ shirt: shirtColors[i % shirtColors.length], pants: 0x1e293b, role: 'pump', hair: 0x2a1a0a });
      pw.position.set(x + 1.2, 0, 1.5);
      pw.userData.homePos = pw.position.clone();
      pw.userData.pumpIndex = i;
      g.add(pw);
      g.userData.pumpWorkers.push(pw);
    }
    // 6 موظفي كابينة
    for (var c = 0; c < 6; c++) {
      var cs = makeStationNPC({ shirt: shirtColors[(c + 3) % shirtColors.length], pants: 0x334155, role: 'cabin' });
      var cx = -3.5 + (c % 3) * 3.5;
      var cz = -7 + Math.floor(c / 3) * 2.2;
      cs.position.set(cx, 0, cz);
      cs.userData.homePos = cs.position.clone();
      g.add(cs);
      g.userData.cabinStaff.push(cs);
    }
    // 6 موتسيكلات + عمال توصيل
    for (var d = 0; d < 6; d++) {
      var bike = makeMotorcycle();
      bike.position.set(-16 + d * 2.2, 0, -2);
      g.add(bike);
      g.userData.bikes.push(bike);
      var dw = makeStationNPC({ shirt: shirtColors[(d + 5) % shirtColors.length], pants: 0x0f172a, role: 'delivery' });
      dw.position.set(-16 + d * 2.2, 0, -0.5);
      dw.userData.homePos = dw.position.clone();
      dw.userData.busy = false;
      dw.userData.bike = bike;
      g.add(dw);
      g.userData.deliveryWorkers.push(dw);
    }
    // المدير — بدلة سوداء
    var boss = makeStationNPC({ suit: true, pants: 0x111111, shirt: 0x111111, role: 'boss', hair: 0x0a0a0a });
    boss.position.copy(g.userData.deskPos);
    boss.userData.homePos = g.userData.deskPos.clone();
    boss.userData.state = 'desk'; // desk | patrol
    boss.userData.patrolT = 0;
    boss.userData.patrolStep = 0;
    boss.userData.deskUntil = performance.now() + 30000; // أول دورة بعد شوية
    g.add(boss);
    g.userData.boss = boss;

    g.userData.interactive = true;
    g.userData.interactiveType = 'gas';
    g.userData.isGasStation = true;
    g.userData.accentColor = 0xef4444;
    g.userData.voices = Object.assign({}, GAS_VOICE_DEFAULT);
    g.userData.officeOpen = false;
    g.userData.security = null;
    g.userData.deliveryQueue = [];
    return g;
  }

  function makeInteractiveLight(kind, color, intensity, distance) {
    var g = new THREE.Group();
    var bodyCol = 0x64748b;
    if (kind === 'bulb') {
      var base = makeSimpleBlock([0.2, 0.15, 0.2], 0x334155); base.position.y = 0.08; g.add(base);
      var bulb = makeSimpleBlock([0.28, 0.28, 0.28], color); bulb.position.y = 0.32; g.add(bulb);
    } else if (kind === 'post') {
      var pole = makeSimpleBlock([0.12, 2.6, 0.12], 0x475569); pole.position.y = 1.3; g.add(pole);
      var head = makeSimpleBlock([0.45, 0.2, 0.45], 0x1e293b); head.position.y = 2.7; g.add(head);
      var glow = makeSimpleBlock([0.35, 0.12, 0.35], color); glow.position.y = 2.55; g.add(glow);
    } else if (kind === 'flood') {
      var stand = makeSimpleBlock([0.2, 1.2, 0.2], 0x334155); stand.position.y = 0.6; g.add(stand);
      var box = makeSimpleBlock([0.7, 0.4, 0.5], 0x1e293b); box.position.y = 1.35; g.add(box);
      var lens = makeSimpleBlock([0.55, 0.3, 0.08], color); lens.position.set(0, 1.35, 0.28); g.add(lens);
    } else if (kind === 'wall') {
      var plate = makeSimpleBlock([0.35, 0.25, 0.12], 0x334155); plate.position.y = 1.2; g.add(plate);
      var lamp = makeSimpleBlock([0.28, 0.18, 0.2], color); lamp.position.set(0, 1.2, 0.12); g.add(lamp);
    } else if (kind === 'spot') {
      var arm = makeSimpleBlock([0.1, 0.1, 0.8], 0x475569); arm.position.set(0, 1.5, 0); g.add(arm);
      var cone = makeSimpleBlock([0.35, 0.35, 0.35], color); cone.position.set(0, 1.5, 0.4); g.add(cone);
    } else {
      var bar = makeSimpleBlock([1.4, 0.12, 0.12], color); bar.position.y = 1.5; g.add(bar);
    }
    var light = new THREE.PointLight(color, intensity || 4, distance || 10, 2);
    light.position.y = kind === 'post' ? 2.5 : (kind === 'flood' ? 1.35 : 0.5);
    light.castShadow = false;
    g.add(light);
    g.userData.interactive = true;
    g.userData.interactiveType = 'light';
    g.userData.isLight = true;
    g.userData.lightOn = true;
    g.userData.lightRef = light;
    g.userData.lightIntensity = intensity || 4;
    g.userData.noCollision = true;
    g.userData.accentColor = color;
    return g;
  }

  function applyLightState(obj, on) {
    if (!obj || !obj.userData || !obj.userData.isLight) return;
    obj.userData.lightOn = !!on;
    var L = obj.userData.lightRef;
    if (L) L.intensity = obj.userData.lightOn ? (obj.userData.lightIntensity || 4) : 0;
    // غيّر لمعان اللمبة بصريًا
    try {
      obj.traverse(function (ch) {
        if (!ch.isMesh || !ch.material) return;
        var mats = Array.isArray(ch.material) ? ch.material : [ch.material];
        mats.forEach(function (m) {
          if (!m || !m.emissive) return;
          if (obj.userData.lightOn) {
            m.emissiveIntensity = Math.max(0.4, m.emissiveIntensity || 0.5);
          } else {
            m.emissiveIntensity = 0.02;
          }
        });
      });
    } catch (e) {}
  }

  function toggleInteractiveLight(obj, fromNet) {
    if (!obj || !obj.userData || !obj.userData.isLight) return;
    applyLightState(obj, !obj.userData.lightOn);
    if (!fromNet) {
      toast(obj.userData.lightOn ? 'النور شغال' : 'النور مطفي', 'info');
      netEmit({
        type: 'world_event',
        action: 'light',
        objectId: obj.userData.instanceName || obj.userData.buildId || null,
        on: !!obj.userData.lightOn,
        x: obj.position.x,
        z: obj.position.z
      });
    }
  }

  function findInteractiveByIdOrPos(opts) {
    opts = opts || {};
    var list = state.buildObjects || [];
    if (opts.objectId) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (!o || !o.userData) continue;
        if (o.userData.instanceName === opts.objectId || o.userData.buildId === opts.objectId || o.userData.netVehicleId === opts.objectId) return o;
      }
    }
    if (opts.x != null) {
      var best = null, bestD = (opts.maxDist != null ? opts.maxDist : 8);
      bestD = bestD * bestD;
      for (var j = 0; j < list.length; j++) {
        var o2 = list[j];
        if (!o2) continue;
        if (opts.require && !opts.require(o2)) continue;
        var dx = o2.position.x - opts.x, dz = o2.position.z - (opts.z || 0);
        var d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = o2; }
      }
      return best;
    }
    return null;
  }

  function makeInteractiveCar(kind, bodyColor, accent) {
    var g = makeCatalogCar(kind, bodyColor, accent);
    g.userData.isVehicle = true;
    g.userData.interactive = true;
    g.userData.interactiveType = 'vehicle';
    g.userData.engineOn = false;
    g.userData.seats = { driver: null, passenger: null };
    g.userData.radioTrack = null;
    g.userData.radioTime = 0;
    // ضبط الظل والمقاس على قد الـ mesh
    g.traverse(function (ch) {
      if (ch.isMesh) {
        ch.castShadow = true;
        ch.receiveShadow = true;
        if (ch.geometry && !ch.geometry.boundingBox) ch.geometry.computeBoundingBox();
        if (ch.geometry && !ch.geometry.boundingSphere) ch.geometry.computeBoundingSphere();
      }
    });
    return g;
  }

  function makeTreeKind(kind) {
    var g = new THREE.Group();
    var trunk = makeSimpleBlock([0.4, 1.5, 0.4], 0x78350f);
    trunk.position.y = 0.75; g.add(trunk);
    var leafCol = kind === 2 ? 0x166534 : (kind === 3 ? 0x15803d : 0x22c55e);
    var leaf = makeSimpleBlock(kind === 3 ? [1.2, 2.2, 1.2] : [2, 2, 2], leafCol);
    leaf.position.y = kind === 3 ? 2.5 : 2.2; g.add(leaf);
    return g;
  }

  function makeCatalogCar(kind, bodyColor, accent) {
    var g = new THREE.Group();
    var bodyMat = mat(bodyColor, { r: 0.35, m: 0.55 });
    var glassMat = mat(0x88ccee, { r: 0.15, m: 0.9, t: true, o: 0.45 });
    var darkMat = mat(0x111111, { r: 0.6, m: 0.2 });
    var chromeMat = mat(accent || 0xc0c0c0, { r: 0.25, m: 0.85 });
    var wheelMat = mat(0x1a1a1a, { r: 0.8 });
    var tireMat = mat(0x0a0a0a, { r: 0.9 });

    if (!g.userData.wheels) g.userData.wheels = [];
    function addWheel(x, y, z, isFront) {
      var wg = new THREE.Group();
      wg.position.set(x, y, z);
      // إطار أسود
      var tire = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.26, 16), tireMat);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      wg.add(tire);
      // شريط جانبي رمادي يبان مع الدوران
      var stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.385, 0.385, 0.04, 16), mat(0x6b7280, { r: 0.7 }));
      stripe.rotation.z = Math.PI / 2;
      wg.add(stripe);
      // جنط كروم
      var rim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.28, 12), chromeMat);
      rim.rotation.z = Math.PI / 2;
      wg.add(rim);
      // مركز
      var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 8), mat(0xf8fafc, { m: 0.7, r: 0.3 }));
      hub.rotation.z = Math.PI / 2;
      wg.add(hub);
      // أسلاك/spokes ملونة توضح الدوران
      var spokeMat = mat(0xe2e8f0, { m: 0.6, r: 0.35 });
      for (var s = 0; s < 5; s++) {
        var spoke = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.34, 0.05), spokeMat);
        spoke.rotation.z = (s / 5) * Math.PI;
        wg.add(spoke);
      }
      // علامة حمراء على الإطار
      var mark = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.27), mat(0xef4444, { r: 0.5 }));
      mark.position.set(0, 0.32, 0);
      wg.add(mark);
      wg.userData.isWheel = true;
      wg.userData.isFront = !!isFront;
      g.add(wg);
      g.userData.wheels.push(wg);
    }

    function addSeats(driverZ, passZ, y) {
      var seatM = mat(0x1a1a1a, { r: 0.75 });
      var ds = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.48), seatM);
      ds.position.set(-0.45, y, driverZ);
      ds.userData = { isSeat: true, seatName: 'driver' };
      g.add(ds);
      var db = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.1), seatM);
      db.position.set(-0.45, y + 0.25, driverZ - 0.22);
      g.add(db);
      var ps = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.48), seatM);
      ps.position.set(0.45, y, passZ != null ? passZ : driverZ);
      ps.userData = { isSeat: true, seatName: 'passenger' };
      g.add(ps);
      var pb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.1), seatM);
      pb.position.set(0.45, y + 0.25, (passZ != null ? passZ : driverZ) - 0.22);
      g.add(pb);
    }

    var body, cabin, len = 4.4, wid = 1.95, h = 0.55;
    if (kind === 'gclass') {
      body = new THREE.Mesh(new THREE.BoxGeometry(2.15, 1.05, 4.5), bodyMat);
      body.position.y = 0.95; body.castShadow = true; g.add(body);
      cabin = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.75, 2.6), bodyMat);
      cabin.position.set(0, 1.85, -0.15); cabin.castShadow = true; g.add(cabin);
      var win = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.55, 2.4), glassMat);
      win.position.set(0, 1.9, -0.15); g.add(win);
      addWheel(-1.05, 0.38, 1.45, true); addWheel(1.05, 0.38, 1.45, true);
      addWheel(-1.05, 0.38, -1.45, false); addWheel(1.05, 0.38, -1.45, false);
      addSeats(0.55, 0.55, 1.15);
    } else if (kind === 'bugatti' || kind === 'lambo') {
      body = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.48, 4.7), bodyMat);
      body.position.y = 0.52; body.castShadow = true; g.add(body);
      // sloping cabin
      cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.42, 1.9), bodyMat);
      cabin.position.set(0, 0.92, -0.15); cabin.castShadow = true; g.add(cabin);
      var wind = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.32, 1.7), glassMat);
      wind.position.set(0, 0.95, -0.1); g.add(wind);
      // hood scoop accent
      var accentPart = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1.2), chromeMat);
      accentPart.position.set(0, 0.78, 1.2); g.add(accentPart);
      addWheel(-0.95, 0.32, 1.5, true); addWheel(0.95, 0.32, 1.5, true);
      addWheel(-0.95, 0.32, -1.4, false); addWheel(0.95, 0.32, -1.4, false);
      addSeats(0.2, 0.2, 0.7);
    } else if (kind === 'truck') {
      body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 5.2), bodyMat);
      body.position.y = 0.95; body.castShadow = true; g.add(body);
      cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.15, 1.8), mat(accent || 0xf59e0b, { r: 0.4, m: 0.4 }));
      cabin.position.set(0, 1.7, 1.55); cabin.castShadow = true; g.add(cabin);
      var tw = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 1.5), glassMat);
      tw.position.set(0, 1.85, 1.55); g.add(tw);
      addWheel(-1.05, 0.4, 1.8, true); addWheel(1.05, 0.4, 1.8, true);
      addWheel(-1.05, 0.4, -1.6, false); addWheel(1.05, 0.4, -1.6, false);
      addSeats(1.4, 1.4, 1.2);
    } else {
      // sedan default
      body = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.58, 4.3), bodyMat);
      body.position.y = 0.62; body.castShadow = true; g.add(body);
      cabin = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.62, 2.1), bodyMat);
      cabin.position.set(0, 1.2, -0.15); cabin.castShadow = true; g.add(cabin);
      var gw = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.48, 1.95), glassMat);
      gw.position.set(0, 1.25, -0.15); g.add(gw);
      // headlights
      var hl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), mat(0xfff3c4, { m: 0.8 }));
      hl.position.set(-0.55, 0.62, 2.12); g.add(hl);
      var hr = hl.clone(); hr.position.x = 0.55; g.add(hr);
      // taillights
      var tl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.14, 0.08), mat(0xdc2626, { m: 0.5 }));
      tl.position.set(-0.55, 0.62, -2.12); g.add(tl);
      var tr = tl.clone(); tr.position.x = 0.55; g.add(tr);
      addWheel(-0.95, 0.34, 1.35, true); addWheel(0.95, 0.34, 1.35, true);
      addWheel(-0.95, 0.34, -1.35, false); addWheel(0.95, 0.34, -1.35, false);
      addSeats(0.35, 0.35, 0.85);
    }

    // bumpers
    var frontB = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.2, 0.25), darkMat);
    frontB.position.set(0, 0.35, kind === 'truck' ? 2.55 : 2.2); g.add(frontB);

    g.userData.isVehicle = true;
    g.userData.programmable = true;
    g.userData.interactive = true;
    g.userData.interactiveType = 'vehicle';
    g.userData.vehicleKind = kind;
    g.userData.engineOn = false;
    g.userData.seats = { driver: null, passenger: null };
    g.userData.gear = 1;
    g.userData.speed = 0;
    g.userData.steer = 0;
    return g;
  }


  function findCatalogItem(id) {
    var cats = Object.keys(buildCatalog);
    for (var c = 0; c < cats.length; c++) {
      for (var i = 0; i < buildCatalog[cats[c]].length; i++) {
        if (buildCatalog[cats[c]][i].id === id) return buildCatalog[cats[c]][i];
      }
    }
    return null;
  }

  
  // ===== Phone / Inventory =====
  state.inventory = state.inventory || { phone: false };
  state.phoneHeld = false;
  state.phoneCall = null; // { peerId, peerName, role: 'out'|'in', status: 'ringing'|'active' }

  function makePhoneHandMesh() {
    var g = new THREE.Group();
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.22, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.45, roughness: 0.3 })
    );
    g.add(body);
    var screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 0.4 })
    );
    screen.position.z = 0.012;
    g.add(screen);
    g.userData.isPhoneHand = true;
    return g;
  }
  function makePhoneProp(onTable) {
    if (onTable) {
      var root = makeEmptyTable();
      var phone = makePhoneHandMesh();
      phone.scale.set(1.4, 1.4, 1.4);
      phone.position.set(0, 0.95, 0);
      phone.rotation.x = -0.2;
      root.add(phone);
      root.userData.phoneMesh = phone;
      root.userData.isPhone = true;
      root.userData.interactive = true;
      root.userData.interactiveType = 'phone';
      root.userData.buildId = 'ix_phone';
      root.userData.onGround = true;
      root.userData.onTable = true;
      root.userData.isTableSet = true;
      return root;
    }
    var g = makePhoneHandMesh();
    g.scale.set(1.6, 1.6, 1.6);
    g.userData.isPhone = true;
    g.userData.interactive = true;
    g.userData.interactiveType = 'phone';
    g.userData.buildId = 'ix_phone';
    g.userData.onGround = true;
    g.userData.onTable = false;
    return g;
  }
  function extractPhoneFromWorld(root) {
    if (!root) return null;
    if (root.userData && root.userData.onTable && root.userData.phoneMesh) {
      var ph = root.userData.phoneMesh;
      try { root.remove(ph); } catch (e) {}
      root.userData.phoneMesh = null;
      root.userData.isPhone = false;
      root.userData.interactive = false;
      root.userData.onGround = false;
      root.userData.isEmptyTable = true;
      ph.userData.isPhone = true;
      ph.userData.onGround = false;
      ph.userData.onTable = false;
      return ph;
    }
    return root;
  }

  function updateInventoryBar() {
    var bar = document.getElementById('inventory-bar');
    if (!bar) return;
    // اخفِ قائمة الأسلحة القديمة
    try {
      var old = document.getElementById('weapon-slots-hud');
      if (old) old.classList.add('hidden');
    } catch (e) {}
    var hasPhone = !!(state.inventory && state.inventory.phone);
    var hasW0 = !!(state.weaponSlots && state.weaponSlots[0]);
    var hasW1 = !!(state.weaponSlots && state.weaponSlots[1]);
    if (!hasPhone && !hasW0 && !hasW1) {
      bar.classList.add('hidden');
      bar.innerHTML = '';
      return;
    }
    bar.classList.remove('hidden');
    var html = '';
    if (hasW0) {
      var k0 = state.weaponSlots[0].kind === 'smg' ? 'رشاش' : 'مسدس';
      html += '<div class="inventory-slot wpn' + (state.activeWeaponSlot === 0 && !state.phoneHeld ? ' active' : '') + '" data-item="wpn0" title="1 — سلاح">'
        + '🔫<span class="inv-key">1</span></div>';
    }
    if (hasW1) {
      html += '<div class="inventory-slot wpn' + (state.activeWeaponSlot === 1 && !state.phoneHeld ? ' active' : '') + '" data-item="wpn1" title="2 — سلاح">'
        + '💥<span class="inv-key">2</span></div>';
    }
    if (hasPhone) {
      html += '<div class="inventory-slot' + (state.phoneHeld ? ' active' : '') + '" data-item="phone" title="M — تليفون">📱<span class="inv-key">M</span></div>';
    }
    bar.innerHTML = html;
    bar.querySelectorAll('.inventory-slot').forEach(function (slot) {
      slot.onclick = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var it = slot.getAttribute('data-item');
        if (it === 'phone') {
          if (!state.phoneHeld) {
            if (state.activeWeaponSlot >= 0) {
              state.activeWeaponSlot = -1;
              try { refreshWeaponVisuals(players[0]); } catch (e) {}
            }
            state.phoneHeld = true;
            openPhoneUI(state.phoneCall ? 'call' : 'home');
          } else {
            state.phoneHeld = false;
            closePhoneUI();
          }
          updatePhoneHandVisual(players[0]);
          updateInventoryBar();
        } else if (it === 'wpn0') {
          state.phoneHeld = false;
          closePhoneUI();
          selectWeaponSlot(0);
          updatePhoneHandVisual(players[0]);
          updateInventoryBar();
        } else if (it === 'wpn1') {
          state.phoneHeld = false;
          closePhoneUI();
          selectWeaponSlot(1);
          updatePhoneHandVisual(players[0]);
          updateInventoryBar();
        }
      };
    });
  }

  function updatePhoneHandVisual(player) {
    player = player || (players && players[0]);
    if (!player || !player.group) return;
    var mesh = player.group.userData.phoneHandMesh;
    if (!state.inventory || !state.inventory.phone || !state.phoneHeld) {
      if (mesh) mesh.visible = false;
      return;
    }
    if (!mesh) {
      mesh = makePhoneHandMesh();
      player.group.add(mesh);
      player.group.userData.phoneHandMesh = mesh;
    }
    mesh.visible = true;
    // في المكالمة النشطة: عند الودن — غير كده في الإيد
    var onCall = !!(state.phoneCall && (state.phoneCall.status === 'active' || state.phoneCall.status === 'ringing'));
    if (onCall && state.phoneCall && state.phoneCall.status === 'active') {
      mesh.position.set(0.28, 1.55, 0.05);
      mesh.rotation.set(0.2, 0.4, 0.9);
      mesh.scale.set(1, 1, 1);
    } else {
      mesh.position.set(0.38, 0.95, 0.22);
      mesh.rotation.set(0.3, 0.15, 0.2);
      mesh.scale.set(1.1, 1.1, 1.1);
    }
  }

  function pickupPhone(mesh) {
    if (!mesh || !mesh.userData || !mesh.userData.isPhone) return false;
    if (state.inventory.phone) {
      toast('معاك تليفون بالفعل', 'info');
      return false;
    }
    var wasTable = !!mesh.userData.onTable;
    var key = mesh.userData._netBuildKey || null;
    var phonePart = extractPhoneFromWorld(mesh);
    if (!phonePart) return false;
    if (wasTable) {
      if (state.buildObjects.indexOf(mesh) < 0) state.buildObjects.push(mesh);
      try { scene.add(mesh); } catch (e) {}
    } else {
      var i = state.buildObjects.indexOf(mesh);
      if (i >= 0) state.buildObjects.splice(i, 1);
      try { if (mesh.parent) mesh.parent.remove(mesh); scene.remove(mesh); } catch (e2) {}
    }
    try { if (phonePart.parent) phonePart.parent.remove(phonePart); } catch (e3) {}
    state.inventory.phone = true;
    state.phoneHeld = true;
    // لو ماسك سلاح في الإيد — حطه على الضهر عشان التليفون في الإيد
    if (state.activeWeaponSlot >= 0) {
      state.activeWeaponSlot = -1;
      try { refreshWeaponVisuals(players[0]); } catch (eW) {}
    }
    updatePhoneHandVisual(players[0]);
    updateInventoryBar();
    openPhoneUI('home');
    toast('مسكت التليفون — M للجيب · اضغط على الشريط للتبديل', 'success');
    try {
      netEmit({ type: 'world_event', action: 'phone_pickup', key: key, leaveTable: wasTable });
    } catch (e4) {}
    return true;
  }

  function togglePhoneKey() {
    if (state.mode !== 'play') return;
    if (!state.inventory || !state.inventory.phone) {
      toast('مفيش تليفون في الممتلكات', 'info');
      return;
    }
    state.phoneHeld = !state.phoneHeld;
    if (state.phoneHeld && state.activeWeaponSlot >= 0) {
      state.activeWeaponSlot = -1;
      try { refreshWeaponVisuals(players[0]); } catch (e) {}
    }
    updateInventoryBar();
    updatePhoneHandVisual(players[0]);
    if (state.phoneHeld) openPhoneUI(state.phoneCall ? 'call' : 'home');
    else closePhoneUI();
  }

  function dropPhone(player) {
    if (!state.inventory || !state.inventory.phone) return;
    if (state.phoneCall) endPhoneCall(true);
    player = player || players[0];
    var mesh = makePhoneProp(false);
    mesh.userData._netBuildKey = 'ph_' + Date.now().toString(36);
    if (player && player.group) {
      var dir = new THREE.Vector3(Math.sin(player.yaw || 0), 0, Math.cos(player.yaw || 0));
      mesh.position.copy(player.group.position).add(dir.multiplyScalar(1.5));
      mesh.position.y = 0.15;
    }
    scene.add(mesh);
    state.buildObjects.push(mesh);
    state.inventory.phone = false;
    state.phoneHeld = false;
    if (player && player.group && player.group.userData.phoneHandMesh) {
      player.group.userData.phoneHandMesh.visible = false;
    }
    closePhoneUI();
    updateInventoryBar();
    try {
      netEmit({
        type: 'world_event',
        action: 'phone_drop',
        key: mesh.userData._netBuildKey,
        x: mesh.position.x, y: mesh.position.y, z: mesh.position.z
      });
    } catch (e) {}
    toast('رميت التليفون', 'info');
  }

  function openPhoneUI(view) {
    var el = document.getElementById('phone-ui');
    if (!el) return;
    el.classList.remove('hidden');
    requestAnimationFrame(function () { el.classList.add('open'); });
    renderPhoneUI(view || 'home');
  }
  function closePhoneUI() {
    var el = document.getElementById('phone-ui');
    if (!el) return;
    el.classList.remove('open');
    setTimeout(function () {
      if (!state.phoneHeld) el.classList.add('hidden');
    }, 320);
  }

  function getCallRoster() {
    var list = [];
    var seen = {};
    (state.netRoster || []).forEach(function (r) {
      if (!r || !r.id || r.id === state.myNetId) return;
      if (seen[r.id]) return;
      seen[r.id] = true;
      list.push({ id: r.id, name: r.name || 'لاعب' });
    });
    Object.keys(state.remoteMeshes || {}).forEach(function (id) {
      if (id === state.myNetId || seen[id]) return;
      var m = state.remoteMeshes[id];
      seen[id] = true;
      list.push({ id: id, name: (m && m.userData && m.userData.displayName) || 'لاعب' });
    });
    return list;
  }

  function renderPhoneUI(view) {
    var el = document.getElementById('phone-ui');
    if (!el) return;
    var now = new Date();
    var time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    var html = '<div class="phone-notch"></div><div class="phone-status"><span>' + time + '</span><span>5G 🔋</span></div><div class="phone-body">';
    if (view === 'contacts') {
      html += '<button class="phone-back" id="phone-back-home">← الرئيسية</button><h3 style="margin:0 0 12px">المكالمات</h3><div class="phone-contacts">';
      var roster = getCallRoster();
      if (!roster.length) html += '<div style="color:#94a3b8;text-align:center;padding:20px">مفيش لاعبين في السيرفر</div>';
      roster.forEach(function (p) {
        html += '<div class="phone-contact" data-peer="' + p.id + '" data-name="' + (p.name || '').replace(/"/g, '') + '"><span>' + (p.name || 'لاعب') + '</span><button class="phone-call-btn">اتصال</button></div>';
      });
      html += '</div>';
    } else if (view === 'addpeers' && state.phoneCall) {
      html += '<button class="phone-back" id="phone-back-call">← المكالمة</button><h3 style="margin:0 0 10px">إضافة أشخاص</h3><div class="phone-contacts">';
      var roster2 = getCallRoster();
      var inCall = {};
      (state.phoneCall.peers || []).forEach(function (p) { inCall[p.id] = true; });
      roster2.forEach(function (p) {
        if (inCall[p.id]) return;
        html += '<label class="phone-contact" style="cursor:pointer"><span>' + (p.name || 'لاعب') + '</span>'
          + '<input type="checkbox" class="add-peer-cb" value="' + p.id + '" data-name="' + (p.name || '').replace(/"/g, '') + '"/></label>';
      });
      html += '</div><button class="phone-call-btn" id="phone-add-confirm" style="width:100%;margin-top:12px">إضافة المحددين</button>';
    } else if (view === 'call' && state.phoneCall) {
      var c = state.phoneCall;
      var names = (c.peers && c.peers.length) ? c.peers.map(function (p) { return p.name; }).join('، ') : (c.peerName || 'لاعب');
      var statusTxt = c.status === 'ringing' ? (c.role === 'out' ? 'جاري الرنين…' : 'مكالمة واردة') : 'متصل';
      html += '<div class="phone-call-screen"><div style="font-size:2.5rem">📱</div><div class="name">' + names + '</div><div style="color:#94a3b8">' + statusTxt + '</div>';
      if (c.status === 'active') {
        html += '<button class="phone-call-btn" id="phone-add-people" style="margin-top:18px">➕ إضافة أشخاص للمكالمة</button>';
      }
      html += '<div class="phone-call-actions">';
      if (c.status === 'ringing' && c.role === 'in') {
        html += '<button class="phone-answer" id="phone-answer">✓</button><button class="phone-reject" id="phone-reject">✕</button>';
      } else {
        html += '<button class="phone-hang" id="phone-hang">📞</button>';
      }
      html += '</div></div>';
    } else {
      html += '<div style="text-align:center;margin:8px 0 4px;font-weight:700">iPhone</div><div class="phone-app-grid">';
      html += '<div class="phone-app" data-app="contacts"><div class="phone-app-icon" style="background:linear-gradient(145deg,#16a34a,#15803d)">📞</div><span>المكالمات</span></div>';
      html += '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
    var back = document.getElementById('phone-back-home');
    if (back) back.onclick = function (e) { e.stopPropagation(); renderPhoneUI('home'); };
    el.querySelectorAll('[data-app="contacts"]').forEach(function (a) {
      a.onclick = function (e) { e.stopPropagation(); renderPhoneUI('contacts'); };
    });
    el.querySelectorAll('.phone-contact').forEach(function (row) {
      row.onclick = function (e) {
        e.stopPropagation();
        startPhoneCall(row.getAttribute('data-peer'), row.getAttribute('data-name'));
      };
    });
    var hang = document.getElementById('phone-hang');
    if (hang) hang.onclick = function (e) { e.stopPropagation(); endPhoneCall(true); };
    var ans = document.getElementById('phone-answer');
    if (ans) ans.onclick = function (e) { e.stopPropagation(); answerPhoneCall(); };
    var rej = document.getElementById('phone-reject');
    if (rej) rej.onclick = function (e) { e.stopPropagation(); endPhoneCall(true); };
    var addp = document.getElementById('phone-add-people');
    if (addp) addp.onclick = function (e) { e.stopPropagation(); renderPhoneUI('addpeers'); };
    var backCall = document.getElementById('phone-back-call');
    if (backCall) backCall.onclick = function (e) { e.stopPropagation(); renderPhoneUI('call'); };
    var conf = document.getElementById('phone-add-confirm');
    if (conf) conf.onclick = function (e) {
      e.stopPropagation();
      var ids = [];
      el.querySelectorAll('.add-peer-cb:checked').forEach(function (cb) { ids.push(cb.value); });
      addPeopleToCall(ids);
    };
  }


  function playPhoneRing() {
    try { stopPhoneRing(); } catch (e) {}
    try {
      var a = new Audio('gas_call_ring.mp3');
      a.loop = true;
      a.volume = 0.85;
      a.play().catch(function () {});
      state._phoneRingAudio = a;
    } catch (e2) {
      try {
        var a2 = new Audio('gas_call_ring.mp3');
        a2.volume = 0.85;
        a2.play().catch(function () {});
        state._phoneRingAudio = a2;
      } catch (e3) {}
    }
  }
  function stopPhoneRing() {
    try {
      if (state._phoneRingAudio) {
        state._phoneRingAudio.pause();
        state._phoneRingAudio.currentTime = 0;
        state._phoneRingAudio = null;
      }
    } catch (e) {}
  }
  function muteMicAfterCall() {
    try {
      if (state.voice && state.voice.enabled) {
        voiceSetEnabled(false);
        try {
          if (state.voice.stream) {
            (state.voice.stream.getTracks() || []).forEach(function (t) {
              try { t.enabled = false; } catch (e) {}
            });
          }
        } catch (e2) {}
        try { updateMicHud(); } catch (e3) {}
      }
    } catch (e4) {}
  }

  function startPhoneCall(peerId, peerName) {
    if (!peerId) return;
    if (!state.inventory.phone) {
      toast('محتاج تليفون', 'error');
      return;
    }
    state.phoneCall = {
      peerId: peerId,
      peerName: peerName || 'لاعب',
      peers: [{ id: peerId, name: peerName || 'لاعب' }],
      role: 'out',
      status: 'ringing'
    };
    state.phoneHeld = true;
    updateInventoryBar();
    updatePhoneHandVisual(players[0]);
    openPhoneUI('call');
    try { playPhoneRing(); } catch (eR) {}
    try {
      netEmit({
        type: 'phone_event',
        action: 'ring',
        fromId: state.myNetId,
        fromName: state.playerName || 'لاعب',
        toId: peerId
      });
    } catch (e) {}
    toast('جاري الاتصال…', 'info');
  }

  function addPeopleToCall(ids) {
    if (!state.phoneCall || !ids || !ids.length) return;
    state.phoneCall.peers = state.phoneCall.peers || [];
    ids.forEach(function (id) {
      if (!id || id === state.myNetId) return;
      var exists = state.phoneCall.peers.some(function (p) { return p.id === id; });
      if (exists) return;
      var name = 'لاعب';
      getCallRoster().forEach(function (r) { if (r.id === id) name = r.name; });
      state.phoneCall.peers.push({ id: id, name: name });
      try {
        netEmit({
          type: 'phone_event',
          action: 'ring',
          fromId: state.myNetId,
          fromName: state.playerName || 'لاعب',
          toId: id,
          conference: true
        });
      } catch (e) {}
    });
    toast('تمت إضافة أشخاص للمكالمة', 'success');
    renderPhoneUI('call');
  }

  function answerPhoneCall() {
    if (!state.phoneCall) return;
    try { stopPhoneRing(); } catch (eR) {}
    state.phoneCall.status = 'active';
    renderPhoneUI('call');
    try {
      netEmit({
        type: 'phone_event',
        action: 'answer',
        fromId: state.myNetId,
        toId: state.phoneCall.peerId
      });
    } catch (e) {}
    try { if (!state.voice.enabled) voiceToggleFromKey(); } catch (e2) {}
    try { updatePhoneHandVisual(players[0]); } catch (e3) {}
    toast('تم الرد — تقدروا تتكلموا', 'success');
  }

  function endPhoneCall(notify) {
    var c = state.phoneCall;
    try { stopPhoneRing(); } catch (eR) {}
    if (notify && c) {
      try {
        // بلّغ كل المشاركين لو مكالمة جماعية
        var targets = [];
        if (c.peerId) targets.push(c.peerId);
        (c.peers || []).forEach(function (p) {
          if (p && p.id && targets.indexOf(p.id) < 0) targets.push(p.id);
        });
        targets.forEach(function (tid) {
          try {
            netEmit({
              type: 'phone_event',
              action: 'end',
              fromId: state.myNetId,
              toId: tid
            });
          } catch (e1) {}
        });
      } catch (e) {}
    }
    state.phoneCall = null;
    try { muteMicAfterCall(); } catch (eM) {}
    if (state.phoneHeld) {
      renderPhoneUI('home');
      try { updatePhoneHandVisual(players[0]); } catch (e) {}
    } else closePhoneUI();
    toast('انتهت المكالمة — المايك اتقفل', 'info');
  }

  function handlePhoneEvent(d) {
    if (!d || !d.action) return;
    if (d.action === 'ring') {
      if (d.toId && state.myNetId && d.toId !== state.myNetId) return;
      if (!state.inventory || !state.inventory.phone) {
        try {
          netEmit({
            type: 'phone_event',
            action: 'no_phone',
            fromId: state.myNetId,
            toId: d.fromId
          });
        } catch (e) {}
        return;
      }
      state.phoneCall = {
        peerId: d.fromId,
        peerName: d.fromName || 'لاعب',
        peers: [{ id: d.fromId, name: d.fromName || 'لاعب' }],
        role: 'in',
        status: 'ringing'
      };
      state.phoneHeld = true;
      if (state.activeWeaponSlot >= 0) {
        state.activeWeaponSlot = -1;
        try { refreshWeaponVisuals(players[0]); } catch (e) {}
      }
      updateInventoryBar();
      updatePhoneHandVisual(players[0]);
      openPhoneUI('call');
      try { playPhoneRing(); } catch (eR) {}
      toast('مكالمة واردة من ' + (d.fromName || 'لاعب'), 'info');
    } else if (d.action === 'no_phone') {
      if (d.toId && state.myNetId && d.toId !== state.myNetId) return;
      try { stopPhoneRing(); } catch (eR) {}
      toast('فشل الاتصال — الشخص مش معاه تليفون', 'error');
      state.phoneCall = null;
      if (state.phoneHeld) renderPhoneUI('home');
    } else if (d.action === 'answer') {
      if (d.toId && state.myNetId && d.toId !== state.myNetId) return;
      if (state.phoneCall) {
        try { stopPhoneRing(); } catch (eR) {}
        state.phoneCall.status = 'active';
        renderPhoneUI('call');
        try { if (!state.voice.enabled) voiceToggleFromKey(); } catch (e) {}
        try { updatePhoneHandVisual(players[0]); } catch (e2) {}
        toast('الشخص رد على المكالمة', 'success');
      }
    } else if (d.action === 'end') {
      if (d.toId && state.myNetId && d.toId !== state.myNetId) return;
      try { stopPhoneRing(); } catch (eR) {}
      state.phoneCall = null;
      try { muteMicAfterCall(); } catch (eM) {}
      if (state.phoneHeld) {
        renderPhoneUI('home');
        try { updatePhoneHandVisual(players[0]); } catch (e) {}
      } else closePhoneUI();
      toast('الطرف الآخر أقفل المكالمة — المايك اتقفل', 'info');
    }
  }


  // ===== CHARACTER =====
  function hexToNum(hex) {
    if (!hex) return 0x333333;
    return parseInt(String(hex).replace('#', ''), 16);
  }

  function makeNPC(opts) {
    opts = opts || {};
    var custom = {
      hat: opts.hat || 0,
      glasses: opts.glasses || 0,
      shirt: 1,
      pants: 1,
      shoes: 1,
      colorHat: opts.colorHat || '#333333',
      colorGlasses: opts.colorGlasses || '#111111',
      colorShirt: opts.shirt || '#1e40af',
      colorPants: opts.pants || '#1a252f',
      colorShoes: opts.shoes || '#111111'
    };
    var headColor = opts.head != null ? opts.head : 0xe0ac69;
    var mesh = createCharacterMesh(hexToNum(custom.colorShirt), headColor, custom);
    if (opts.scale && opts.scale !== 1) mesh.scale.setScalar(opts.scale);
    mesh.userData.isCharacter = true;
    mesh.userData.job = opts.job || 'civilian';
    mesh.userData.animatable = true;
    mesh.userData.editable = true;
    return mesh;
  }

  function createCharacterMesh(colorBody, colorHead, custom) {
    custom = custom || { hat: 0, glasses: 0, shirt: 0, pants: 0, shoes: 0, colorHat: '#333333', colorGlasses: '#111111', colorShirt: '#1e40af', colorPants: '#1a252f', colorShoes: '#111111' };
    var shirtC = hexToNum(custom.colorShirt) || colorBody;
    var pantsC = hexToNum(custom.colorPants) || 0x1a252f;
    var shoesC = hexToNum(custom.colorShoes) || 0x111111;
    var hatC = hexToNum(custom.colorHat) || 0x333333;
    var glassC = hexToNum(custom.colorGlasses) || 0x111111;

    var group = new THREE.Group();
    // Body / shirt
    var body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 6, 12), mat(shirtC, { r: 0.7 }));
    body.position.y = 1.0; body.castShadow = true; group.add(body);
    group.userData.bodyMesh = body;
    // صورة التيشيرت من قدام
    if (custom.shirtImage) {
      try {
        var loader = new THREE.TextureLoader();
        var tex = loader.load(custom.shirtImage);
        tex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
        var printMat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide
        });
        var print = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), printMat);
        print.position.set(0, 1.12, 0.36);
        print.userData.isShirtPrint = true;
        group.add(print);
        group.userData.shirtPrint = print;
      } catch (ePr) {}
    }
    // Head
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), mat(colorHead, { r: 0.8 }));
    head.position.y = 1.85; head.castShadow = true; head.userData.isHead = true; group.add(head);
    // Eyes
    var eyeMat = new THREE.MeshBasicMaterial({ color: 0x111 });
    var le = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat); le.position.set(-0.1, 1.9, 0.22);
    var re = le.clone(); re.position.x = 0.1; group.add(le, re);
    // Arms
    var armMat = mat(shirtC);
    var leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 6), armMat);
    leftArm.position.set(-0.48, 1.15, 0); leftArm.castShadow = true;
    var rightArm = leftArm.clone(); rightArm.position.x = 0.48; group.add(leftArm, rightArm);
    // Pants / legs
    var legMat = mat(pantsC);
    var leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.55, 4, 6), legMat);
    leftLeg.position.set(-0.2, 0.4, 0); leftLeg.castShadow = true;
    var rightLeg = leftLeg.clone(); rightLeg.position.x = 0.2; group.add(leftLeg, rightLeg);
    // Shoes
    if (custom.shoes > 0) {
      var shoeMat = mat(shoesC, { r: 0.6, m: 0.2 });
      var ls = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.28), shoeMat);
      ls.position.set(-0.2, 0.06, 0.05); ls.castShadow = true; group.add(ls);
      var rs = ls.clone(); rs.position.x = 0.2; group.add(rs);
    }
    // Hat
    if (custom.hat > 0) {
      var hatMat = mat(hatC, { r: 0.6 });
      if (custom.hat === 1 || custom.hat === 2) {
        // baseball / cap
        var cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hatMat);
        cap.position.y = 2.05; group.add(cap);
        var brim = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 0.25), hatMat);
        brim.position.set(0, 2.02, 0.22); group.add(brim);
      } else if (custom.hat === 6) {
        // crown
        var crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.2, 6), mat(0xffd700, { m: 0.6, r: 0.3 }));
        crown.position.y = 2.15; group.add(crown);
      } else {
        // generic hat / beanie
        var beanie = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), hatMat);
        beanie.position.y = 2.08; group.add(beanie);
      }
    }
    // Glasses
    if (custom.glasses > 0) {
      var gMat = mat(glassC, { r: 0.3, m: 0.5 });
      var frame = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.04), gMat);
      frame.position.set(0, 1.92, 0.26); group.add(frame);
      var lensL = new THREE.Mesh(new THREE.CircleGeometry(0.08, 8), mat(0x88ccee, { r: 0.2, m: 0.6, t: true, o: 0.5 }));
      lensL.position.set(-0.12, 1.92, 0.28); group.add(lensL);
      var lensR = lensL.clone(); lensR.position.x = 0.12; group.add(lensR);
    }

    group.userData = { walkCycle: 0, leftArm: leftArm, rightArm: rightArm, leftLeg: leftLeg, rightLeg: rightLeg, head: head, headBaseY: 1.85 };
    return group;
  }

  // ===== NAME TAGS (above heads) =====
  function drawNameTagCanvas(canvas, displayName, opts) {
    opts = opts || {};
    var talking = !!opts.talking;
    var micOn = !!opts.micOn;
    var text = (displayName || 'لاعب').toString().slice(0, 14);
    var micIcon = micOn ? '🎤' : '🔇';
    var label = micIcon + ' ' + text;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 26px Tahoma, Arial, sans-serif';
    var tw = Math.min(ctx.measureText(label).width, 230);
    var padX = 14;
    var boxW = Math.max(tw + padX * 2, 100);
    var boxH = 40;
    var bx = (canvas.width - boxW) / 2;
    var by = (canvas.height - boxH) / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, bx + 2, by + 3, boxW, boxH, 12);
    ctx.fill();
    var grd = ctx.createLinearGradient(bx, by, bx, by + boxH);
    // أخضر لما المايك مفتوح أو بيتكلم
    if (talking) {
      grd.addColorStop(0, 'rgba(6, 95, 45, 0.97)');
      grd.addColorStop(1, 'rgba(4, 60, 30, 0.98)');
    } else if (micOn) {
      grd.addColorStop(0, 'rgba(6, 70, 40, 0.94)');
      grd.addColorStop(1, 'rgba(5, 45, 28, 0.96)');
    } else {
      grd.addColorStop(0, 'rgba(12, 20, 40, 0.92)');
      grd.addColorStop(1, 'rgba(8, 14, 28, 0.95)');
    }
    ctx.fillStyle = grd;
    roundRect(ctx, bx, by, boxW, boxH, 12);
    ctx.fill();
    ctx.strokeStyle = talking ? 'rgba(74, 222, 128, 1)' : (micOn ? 'rgba(52, 211, 153, 0.9)' : 'rgba(0, 212, 255, 0.75)');
    ctx.lineWidth = talking ? 2.5 : 2;
    roundRect(ctx, bx, by, boxW, boxH, 12);
    ctx.stroke();
    // الاسم أخضر لو مايك مفتوح
    ctx.fillStyle = talking ? '#dcfce7' : (micOn ? '#86efac' : '#e8f4ff');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = talking ? 'rgba(74,222,128,0.7)' : (micOn ? 'rgba(52,211,153,0.5)' : 'rgba(0,212,255,0.5)');
    ctx.shadowBlur = talking ? 10 : 6;
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);
    ctx.shadowBlur = 0;
  }
  function createNameTagSprite(displayName, opts) {
    opts = opts || {};
    var canvas = document.createElement('canvas');
    canvas.width = 280;
    canvas.height = 64;
    drawNameTagCanvas(canvas, displayName, opts);
    var tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    var mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    var sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.85, 0.42, 1);
    sprite.position.set(0, 2.55, 0);
    sprite.userData.isNameTag = true;
    sprite.userData._nameCanvas = canvas;
    sprite.userData._nameText = displayName || 'لاعب';
    sprite.userData._talking = !!opts.talking;
    sprite.userData._micOn = !!opts.micOn;
    sprite.renderOrder = 999;
    return sprite;
  }
  function updateNameTagState(group, opts) {
    if (!group || !group.userData || !group.userData.nameTag) return;
    var sprite = group.userData.nameTag;
    opts = opts || {};
    var talking = !!opts.talking;
    var micOn = opts.micOn != null ? !!opts.micOn : !!sprite.userData._micOn;
    var name = opts.name || sprite.userData._nameText || group.userData.displayName || 'لاعب';
    if (sprite.userData._talking === talking && sprite.userData._micOn === micOn && sprite.userData._nameText === name) return;
    sprite.userData._talking = talking;
    sprite.userData._micOn = micOn;
    sprite.userData._nameText = name;
    var canvas = sprite.userData._nameCanvas;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = 280;
      canvas.height = 64;
      sprite.userData._nameCanvas = canvas;
    }
    drawNameTagCanvas(canvas, name, { talking: talking, micOn: micOn });
    if (sprite.material && sprite.material.map) {
      sprite.material.map.image = canvas;
      sprite.material.map.needsUpdate = true;
    } else {
      var tex = new THREE.CanvasTexture(canvas);
      sprite.material.map = tex;
      sprite.material.needsUpdate = true;
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function attachNameTag(group, displayName, visible) {
    if (!group) return null;
    // remove old
    if (group.userData.nameTag) {
      group.remove(group.userData.nameTag);
      if (group.userData.nameTag.material && group.userData.nameTag.material.map) {
        group.userData.nameTag.material.map.dispose();
      }
      if (group.userData.nameTag.material) group.userData.nameTag.material.dispose();
      group.userData.nameTag = null;
    }
    var sprite = createNameTagSprite(displayName);
    sprite.visible = visible !== false;
    group.add(sprite);
    group.userData.nameTag = sprite;
    group.userData.displayName = displayName || '';
    return sprite;
  }

  function setNameTagVisible(group, visible) {
    if (group && group.userData && group.userData.nameTag) {
      group.userData.nameTag.visible = !!visible;
    }
  }

  // أسماء الركاب فوق العربية (مش فوق راس الشخصية المخفية)
  function updateVehicleOccupantNameTags(vehicle, netId, displayName, seat) {
    if (!vehicle || !vehicle.userData) return;
    if (!vehicle.userData._occNameTags) vehicle.userData._occNameTags = {};
    var map = vehicle.userData._occNameTags;
    var key = String(netId);
    // متظهرش اسم اللاعب المحلي فوق عربيته
    if (netId && state.myNetId && netId === state.myNetId) {
      if (map[key]) {
        try { vehicle.remove(map[key]); } catch (e) {}
        delete map[key];
      }
      return;
    }
    var sprite = map[key];
    if (!sprite) {
      sprite = createNameTagSprite(displayName || 'لاعب');
      sprite.position.set(0, 2.6, 0);
      sprite.scale.set(2.2, 0.55, 1);
      vehicle.add(sprite);
      map[key] = sprite;
    } else if (displayName) {
      // حدّث النص لو اتغير
      try {
        vehicle.remove(sprite);
        if (sprite.material && sprite.material.map) sprite.material.map.dispose();
      } catch (e) {}
      sprite = createNameTagSprite(displayName);
      sprite.scale.set(2.2, 0.55, 1);
      vehicle.add(sprite);
      map[key] = sprite;
    }
    // رص الأسماء: سواق أعلى شوية، رفيق جنبه
    var ids = Object.keys(map);
    var idx = ids.indexOf(key);
    var n = ids.length;
    var spread = 0.55;
    var ox = (idx - (n - 1) / 2) * spread;
    sprite.position.set(ox, 2.55 + (seat === 'driver' ? 0.15 : 0), 0);
    sprite.visible = true;
  }
  function clearVehicleOccupantNameTagForPlayer(netId) {
    if (!netId) return;
    var key = String(netId);
    for (var i = 0; i < (state.buildObjects || []).length; i++) {
      var v = state.buildObjects[i];
      if (!v || !v.userData || !v.userData._occNameTags) continue;
      var sp = v.userData._occNameTags[key];
      if (sp) {
        try { v.remove(sp); } catch (e) {}
        delete v.userData._occNameTags[key];
      }
    }
  }

  function getLevelRespawnPoints(kind) {
    // kind: 'lan' | 'split' — spaced so players don't stack on each other
    var defaults = kind === 'lan'
      ? [{ x: -6, y: 0, z: 0 }, { x: -4, y: 0, z: 0 }, { x: -2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
         { x: 2, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }]
      : [{ x: -2.5, y: 0, z: 0 }, { x: 2.5, y: 0, z: 0 }];
    if (!state.currentLevelId || !state.levels[state.currentLevelId]) return defaults;
    var r = ensureLevelRespawns(state.levels[state.currentLevelId]);
    var list = (kind === 'lan' ? r.lan : r.split) || [];
    if (!list.length) return defaults;
    return list;
  }

  function setupPlayers() {
    players.forEach(function (p) { if (p.group) { scene.remove(p.group); p.group = null; } });
    var c0 = (typeof playerCustom !== 'undefined' && playerCustom[0]) ? playerCustom[0] : null;
    var c1 = (typeof playerCustom !== 'undefined' && playerCustom[1]) ? playerCustom[1] : null;
    var spawns = getLevelRespawnPoints('split');
    var s0 = spawns[0] || { x: -2, y: 0, z: 0 };
    var s1 = spawns[1] || { x: 2, y: 0, z: 0 };
    var n0 = state.playerName || 'اللاعب 1';
    var n1 = 'اللاعب 2';
    players[0].group = createCharacterMesh(0x1e40af, 0xe0ac69, c0);
    players[0].group.position.set(s0.x, 0, s0.z); players[0].yaw = 0; players[0].velocity.set(0, 0, 0); scene.add(players[0].group);
    attachNameTag(players[0].group, n0, true);
    players[1].group = createCharacterMesh(0xb91c1c, 0xe0ac69, c1);
    players[1].group.position.set(s1.x, 0, s1.z); players[1].yaw = Math.PI; players[1].velocity.set(0, 0, 0); scene.add(players[1].group);
    attachNameTag(players[1].group, n1, true);
    var aspect = (window.innerWidth / 2) / window.innerHeight;
    players[0].camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 400);
    players[1].camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 400);
  }

  function updatePlayerCamera(player) {
    if (!player.group || !player.camera) return;
    // متظهرش اسمي فوق راسي عندي — يظهر بس عند الناس التانية
    try {
      if (player === players[0] && state.playType === 'online') {
        setNameTagVisible(player.group, false);
      }
    } catch (eNt) {}
    // منظور الشخص الأول (V) — نفس اتجاه المشي للأمام (-sin, -cos)
    if (state.firstPerson && !player.vehicle && !state.script.cutscene) {
      var yawF = player.yaw || 0;
      var pitchF = player.pitch != null ? player.pitch : 0.1;
      pitchF = Math.max(-1.2, Math.min(1.2, pitchF));
      player.pitch = pitchF;
      var eye = player.group.position.clone().add(new THREE.Vector3(0, 1.55, 0));
      player.camera.position.copy(eye);
      var look = new THREE.Vector3(
        eye.x - Math.sin(yawF) * Math.cos(pitchF),
        eye.y + Math.sin(pitchF),
        eye.z - Math.cos(yawF) * Math.cos(pitchF)
      );
      player.camera.lookAt(look);
      // اخفي الشخصية محليًا في FPS
      if (player.group) {
        player.group.traverse(function (ch) {
          if (ch.isMesh && !ch.userData._isWeaponPart) {
            // سيب السلاح ظاهر
            var isWpn = false;
            try {
              if (state.heldWeapon && state.heldWeapon.mesh && (ch === state.heldWeapon.mesh || state.heldWeapon.mesh.getObjectById(ch.id))) isWpn = true;
              if (state.weaponBag && state.weaponBag.mesh && (ch === state.weaponBag.mesh || state.weaponBag.mesh.getObjectById(ch.id))) isWpn = true;
            } catch (e) {}
            if (!isWpn) ch.visible = false;
          }
        });
      }
      return;
    } else if (player.group && !state.firstPerson) {
      // رجّع الظهور
      player.group.traverse(function (ch) {
        if (ch.isMesh) ch.visible = true;
      });
    }
    // في العربية: الكاميرا تدور حول العربية حسب yaw/pitch من الماوس بدون تغيير اتجاه العربية
    if (player.vehicle) {
      var v = player.vehicle;
      var ps = player.settings || {};
      var dist = ps.camDist != null ? ps.camDist : state.camDist;
      var pitch = player.pitch != null ? player.pitch : 0.35;
      pitch = Math.max(-0.9, Math.min(1.2, pitch));
      player.pitch = pitch;
      var yaw = player.yaw || 0;
      var cosP = Math.cos(pitch), sinP = Math.sin(pitch);
      var target = new THREE.Vector3(v.position.x, (v.position.y || 0) + 1.25, v.position.z);
      var offset = new THREE.Vector3(
        Math.sin(yaw) * dist * cosP,
        dist * sinP + 1.35,
        Math.cos(yaw) * dist * cosP
      );
      var desired = target.clone().add(offset);
      // رفيق: كاميرا أثبت (مش هزاز). سواق: سلاسة أخف
      var isPass = player.vehicleSeat && player.vehicleSeat !== 'driver';
      if (isPass) {
        player.camera.position.lerp(desired, 0.55);
      } else {
        player.camera.position.lerp(desired, 0.28);
      }
      player.camera.lookAt(target);
      return;
    }
    var ov = state.script.cameraOverride[player.id];
    if (ov) {
      var lerp = ov.lerp != null ? ov.lerp : 0.12;
      if (ov.x != null) player.camera.position.lerp(new THREE.Vector3(ov.x, ov.y, ov.z), lerp);
      if (ov.lookX != null) player.camera.lookAt(ov.lookX, ov.lookY, ov.lookZ);
      if (ov.fov != null && player.camera.fov !== ov.fov) {
        player.camera.fov = ov.fov;
        player.camera.updateProjectionMatrix();
      }
      return;
    }
    var ps = player.settings || {};
    var dist = ps.camDist != null ? ps.camDist : state.camDist;
    var side = ps.camSide != null ? ps.camSide : state.camSide;
    // عند التصويب: كاميرا فوق + يمين بسلاسة (قيم قابلة للضبط من الإعدادات)
    if (!player._aimSideSmooth) player._aimSideSmooth = 0;
    if (!player._aimLiftSmooth) player._aimLiftSmooth = 0;
    var aimingNow = !!(state.aiming && playerHoldingWeapon && playerHoldingWeapon());
    // aimSide: سالب = شمال، 0 = وسط، موجب = يمين
    var aimSideMax = ps.aimSide != null ? ps.aimSide : 0.7;
    var aimLiftMax = ps.aimLift != null ? ps.aimLift : 0.85;
    var aimCloseMax = ps.aimClose != null ? ps.aimClose : 0.9;
    var aimTargetSide = aimingNow ? aimSideMax : 0;
    var aimTargetLift = aimingNow ? aimLiftMax : 0;
    player._aimSideSmooth += (aimTargetSide - player._aimSideSmooth) * 0.14;
    player._aimLiftSmooth += (aimTargetLift - player._aimLiftSmooth) * 0.14;
    side = side + player._aimSideSmooth;
    // ارتفاع أساسي من الإعدادات
    var baseH = ps.camHeight != null ? ps.camHeight : (state.camHeight || 2.4);
    // pitch حر زي ببجي (فوق/تحت)
    var pitch = player.pitch != null ? player.pitch : 0.25;
    pitch = Math.max(-1.2, Math.min(1.35, pitch));
    player.pitch = pitch;
    var yaw = player.yaw || 0;
    var cosP = Math.cos(pitch);
    var sinP = Math.sin(pitch);
    // عند التصويب: قرّب الكاميرا شوية + ارفعها حسب الإعدادات
    var aimDist = dist - (player._aimLiftSmooth > 0 ? aimCloseMax * (player._aimLiftSmooth / (aimLiftMax || 1)) : 0);
    if (aimDist < 2.2) aimDist = 2.2;
    var offset = new THREE.Vector3(
      Math.sin(yaw) * aimDist * cosP + Math.cos(yaw) * side,
      aimDist * sinP + (baseH * 0.65) + player._aimLiftSmooth * 1.1,
      Math.cos(yaw) * aimDist * cosP - Math.sin(yaw) * side
    );
    // نقطة النظر أعلى عند التصويب عشان الجسم متبقاش في النص
    var lookH = 1.45 + player._aimLiftSmooth * 0.55;
    var target = player.group.position.clone().add(new THREE.Vector3(0, lookH, 0));
    if (player._aimSideSmooth > 0.05) {
      target.x += Math.cos(yaw) * player._aimSideSmooth * 0.4;
      target.z -= Math.sin(yaw) * player._aimSideSmooth * 0.4;
    }
    player.camera.position.lerp(target.clone().add(offset), 0.18);
    player.camera.lookAt(target);
  }

  function ensureVehicleData(v) {
    if (!v || !v.userData) return;
    if (!v.userData.seats) v.userData.seats = { driver: null, passenger: null };
    if (v.userData.engineOn == null) v.userData.engineOn = false;
    if (v.userData.steer == null) v.userData.steer = 0;
    if (v.userData.gear == null) v.userData.gear = 1;
    if (v.userData.speed == null) v.userData.speed = 0;
    v.userData.isVehicle = true;
    // معرف ثابت للمزامنة بين الأجهزة
    if (!v.userData.netVehicleId) {
      v.userData.netVehicleId = v.userData.instanceName || v.userData.buildId ||
        ('veh_' + Math.round(v.position.x * 10) + '_' + Math.round(v.position.z * 10));
    }
  }

  function findNearestVehicle(player, maxDist) {
    maxDist = maxDist || 9;
    var best = null, bestD = maxDist * maxDist;
    var px = player.group.position.x, pz = player.group.position.z;
    for (var i = 0; i < state.buildObjects.length; i++) {
      var o = state.buildObjects[i];
      if (!o || !o.userData || !o.userData.isVehicle) continue;
      var dx = o.position.x - px, dz = o.position.z - pz;
      var d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  function seatOccupied(vehicle, seat) {
    ensureVehicleData(vehicle);
    var id = vehicle.userData.seats[seat];
    if (id == null) return false;
    // local players
    for (var i = 0; i < players.length; i++) {
      if (players[i] && players[i].vehicle === vehicle && players[i].vehicleSeat === seat) return true;
    }
    return !!id;
  }

  function enterVehicle(player, vehicle, seat) {
    if (!player || !vehicle) return false;
    // لازم الأسلحة على الضهر (مش في الإيد)
    if (typeof playerHoldingWeapon === 'function' && playerHoldingWeapon()) {
      toast('حط السلاح على الضهر (1 أو 2) قبل ما تركب', 'error');
      return false;
    }
    ensureVehicleData(vehicle);
    seat = seat || 'driver';
    if (seatOccupied(vehicle, seat) && vehicle.userData.seats[seat] !== player.id && vehicle.userData.seats[seat] !== player.netId) {
      toast(seat === 'driver' ? 'فيه سواق بالفعل' : 'المقعد مش فاضي', 'error');
      return false;
    }
    // لو سواق وراكب سواق تاني — منع
    if (seat === 'driver' && vehicle.userData.drivenBy != null && vehicle.userData.drivenBy !== player.id && vehicle.userData.drivenBy !== player.netId) {
      toast('فيه سواق بالفعل — اركب مرافق (G)', 'info');
      return false;
    }
    player.vehicle = vehicle;
    player.vehicleSeat = seat;
    var pid = player.netId != null ? player.netId : player.id;
    vehicle.userData.seats[seat] = pid;
    if (seat === 'driver') vehicle.userData.drivenBy = pid;
    // السواق: الأسلحة على الضهر تلقائي
    if (seat === 'driver' && state.activeWeaponSlot >= 0) {
      state.activeWeaponSlot = -1;
      state.aiming = false;
      try { refreshWeaponVisuals(player); } catch (eW) {}
    }
    player.yaw = vehicle.rotation.y;
    if (player.group) player.group.visible = false;
    // أخفِ كرسي السواق بصريًا لو السواق راكب
    if (seat === 'driver') {
      vehicle.traverse(function (ch) {
        if (ch.userData && ch.userData.isSeat && ch.userData.seatName === 'driver') {
          ch.visible = false;
          if (ch.parent && ch.parent.userData && ch.parent.userData.isSeat) {}
        }
        // ظهر الكرسي القريب
        if (ch.isMesh && ch.userData && ch.userData.seatName === 'driver') ch.visible = false;
      });
      // أخفِ ظهر الكرسي المجاور بالتقريب
      vehicle.traverse(function (ch) {
        if (!ch.isMesh) return;
        if (ch.userData && ch.userData.isSeat && ch.userData.seatName === 'driver') ch.visible = false;
      });
    }
    // لا نقفّل الإدخال — السواق محتاج W/A/S/D
    try { broadcastVehicleEvent && broadcastVehicleEvent('enter', vehicle, player, seat); } catch (e) {}
    toast(seat === 'driver' ? 'ركبت كسائق — H للمحرك' : 'ركبت مرافق', 'success');
    return true;
  }

  function exitVehicle(player) {
    if (!player || !player.vehicle) return;
    var v = player.vehicle;
    ensureVehicleData(v);
    var seat = player.vehicleSeat || 'driver';
    var pid = player.netId != null ? player.netId : player.id;
    if (v.userData.seats[seat] === pid || v.userData.seats[seat] === player.id) v.userData.seats[seat] = null;
    if (seat === 'driver' && (v.userData.drivenBy === pid || v.userData.drivenBy === player.id)) {
      v.userData.drivenBy = null;
      // إطفاء المحرك لو السواق نزل
      v.userData.engineOn = false;
      stopVehicleEngineSound(v);
    }
    try { broadcastVehicleEvent && broadcastVehicleEvent('exit', v, player, seat); } catch (e) {}
    // أظهر كراسي العربية تاني
    try {
      v.traverse(function (ch) {
        if (ch.userData && ch.userData.isSeat) ch.visible = true;
      });
    } catch (eS) {}
    player.vehicle = null;
    player.vehicleSeat = null;
    closeCarRadio();
    hideVehicleHUD();
    state.interactFocus = null;
    if (player.group) {
      player.group.visible = true;
      // جنب العربية بمسافة كافية — بدون تصادم
      var ang = (player.yaw || 0) + Math.PI * 0.5;
      var side = 3.2;
      player.group.position.x = v.position.x + Math.cos(ang) * side;
      player.group.position.z = v.position.z + Math.sin(ang) * side;
      player.group.position.y = Math.max(0, v.position.y || 0);
      player.velocity.set(0, 0, 0);
    }
    if (state.script) {
      state.script.inputLocked[player.id] = false;
      state.script.forcedInput[player.id] = null;
    }
    toast('نزلت من العربة', 'info');
  }

  function tryToggleVehicle(player, preferSeat) {
    if (!player || !player.group) return;
    if (player.vehicle) {
      exitVehicle(player);
      return;
    }
    var v = findNearestVehicle(player);
    if (!v) { toast('مفيش عربية قريبة', 'info'); return; }
    ensureVehicleData(v);
    var seat = preferSeat || 'driver';
    if (seat === 'driver' && seatOccupied(v, 'driver')) {
      // لو فيه سواق → مرافق
      seat = 'passenger';
    }
    enterVehicle(player, v, seat);
  }

  // ===== تفاعل UI + أصوات + راديو =====
  var _vehicleSounds = {}; // weak-ish map by uuid
  var _radioAudio = null;
  var _radioOpen = false;

  // ===== أصوات عربية أخف + كلاكس حقيقي =====
  var _audioCtx = null;
  function getAudioCtx() {
    if (!_audioCtx) {
      try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    return _audioCtx;
  }

  var _engineNodes = null;
  function startEngineLoop() {
    var ctx = getAudioCtx(); if (!ctx) return;
    stopEngineLoop();
    try {
      var o = ctx.createOscillator();
      var o2 = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = 'sine';
      o2.type = 'triangle';
      o.frequency.value = 48;
      o2.frequency.value = 72;
      g.gain.value = 0.0001;
      o.connect(g); o2.connect(g); g.connect(ctx.destination);
      o.start(); o2.start();
      _engineNodes = { o: o, o2: o2, g: g, ctx: ctx };
    } catch (e) {}
  }
  function stopEngineLoop() {
    if (!_engineNodes) return;
    try {
      _engineNodes.o.stop();
      _engineNodes.o2.stop();
    } catch (e) {}
    _engineNodes = null;
  }
  function updateEngineLoop(vehicle) {
    if (!_engineNodes || !vehicle) return;
    var spd = Math.abs(vehicle.userData.speed || 0);
    var on = !!vehicle.userData.engineOn;
    if (!on) {
      _engineNodes.g.gain.setTargetAtTime(0.0001, _engineNodes.ctx.currentTime, 0.05);
      return;
    }
    // صوت يعتمد على السرعة — خفيف ومقبول
    var rpm = 50 + spd * 9;
    var vol = 0.03 + Math.min(0.12, spd * 0.012);
    try {
      _engineNodes.o.frequency.setTargetAtTime(rpm, _engineNodes.ctx.currentTime, 0.08);
      _engineNodes.o2.frequency.setTargetAtTime(rpm * 1.35, _engineNodes.ctx.currentTime, 0.08);
      _engineNodes.g.gain.setTargetAtTime(vol, _engineNodes.ctx.currentTime, 0.08);
    } catch (e) {}
  }
  function playSoftEngineStart() {
    var ctx = getAudioCtx(); if (!ctx) return;
    try {
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(90, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(55, ctx.currentTime + 0.6);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.72);
    } catch (e) {}
  }
  function playHorn(fromNet) {
    var ctx = getAudioCtx(); if (!ctx) return;
    try {
      function tone(freq, t0, dur, vol) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(ctx.destination);
        o.start(t0); o.stop(t0 + dur + 0.02);
      }
      var t = ctx.currentTime;
      tone(420, t, 0.28, 0.18);
      tone(340, t, 0.28, 0.14);
      tone(420, t + 0.32, 0.35, 0.18);
      tone(340, t + 0.32, 0.35, 0.14);
    } catch (e) {}
    if (!fromNet) {
      var v = players[0] && players[0].vehicle;
      netEmit({
        type: 'world_event',
        action: 'horn',
        vehicleId: v && v.userData ? (v.userData.netVehicleId || v.userData.instanceName) : null,
        x: v ? v.position.x : 0,
        z: v ? v.position.z : 0
      });
    }
  }
  function playFuelAlarm() {
    var ctx = getAudioCtx(); if (!ctx) return;
    try {
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.08, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.26);
    } catch (e) {}
  }
  function playDriftScreech() {
    var ctx = getAudioCtx(); if (!ctx) return;
    try {
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(180, ctx.currentTime);
      o.frequency.linearRampToValueAtTime(90, ctx.currentTime + 0.4);
      g.gain.setValueAtTime(0.06, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.46);
    } catch (e) {}
  }

  var RADIO_TRACKS = [
    { id: '01', name: 'الملوك', src: 'radio_01_el_melouk.mp3' },
    { id: '02', name: 'هنا القاهرة', src: 'radio_02_hina_el_qahira.mp3' },
    { id: '03', name: 'الولا حمو', src: 'radio_03_el_wala_hamo.mp3' },
    { id: '04', name: 'طول ما أنا عالي', src: 'radio_04_toul_ma_ana_ali.mp3' },
    { id: '05', name: 'شارموفرز — سنجل', src: 'radio_01_sharmoofers_single.mp3' },
    { id: '06', name: 'شارموفرز — عروستي', src: 'radio_02_sharmoofers_arosty.mp3' },
    { id: '07', name: 'شارموفرز — خمسة سنتي', src: 'radio_03_sharmoofers_khamsa_santy.mp3' },
    { id: '08', name: 'أورنج — أصحاب البطولة', src: 'radio_04_orange_ashab_elbatola.mp3' },
    { id: '09', name: 'اتصالات — دماغ تانية', src: 'radio_05_etisalat_demagh_tanya.mp3' },
    { id: '10', name: 'واتساب صوت 1', src: 'radio_06_whatsapp_voice_1.mp3' },
    { id: '11', name: 'واتساب صوت 2', src: 'radio_07_whatsapp_audio_2.mp3' }
  ];

  function playOneShot(url, vol) {
    try {
      var a = new Audio(url);
      a.volume = vol != null ? vol : 0.5;
      a.play().catch(function () {});
    } catch (e) {}
  }

  function stopVehicleEngineSound(v) {
    if (!v || !v.uuid) return;
    var s = _vehicleSounds[v.uuid];
    if (s && s.engine) {
      try { s.engine.pause(); } catch (e) {}
      s.engine = null;
    }
  }

  function setVehicleEngine(v, on, player, fromNet) {
    ensureVehicleData(v);
    if (v.userData.engineOn === on) return;
    v.userData.engineOn = on;
    if (on) {
      playSoftEngineStart();
      if (!fromNet) startEngineLoop();
      if (!fromNet) toast('المحرك شغال', 'success');
    } else {
      if (!fromNet) stopEngineLoop();
      stopVehicleEngineSound(v);
      if (!fromNet) toast('المحرك طافي', 'info');
    }
    if (!fromNet) {
      netEmit({
        type: 'world_event',
        action: 'engine',
        vehicleId: v.userData.netVehicleId || v.userData.instanceName,
        on: !!on,
        x: v.position.x,
        z: v.position.z
      });
    }
  }

  function toggleVehicleEngine(player) {
    if (!player || !player.vehicle) return;
    if (player.vehicleSeat && player.vehicleSeat !== 'driver') {
      toast('السواق بس يقدر يشغّل المحرك', 'info');
      return;
    }
    var v = player.vehicle;
    ensureVehicleData(v);
    setVehicleEngine(v, !v.userData.engineOn, player);
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function closeCarRadio() {
    _radioOpen = false;
    var panel = document.getElementById('car-radio');
    if (panel) panel.classList.add('hidden');
    // إيقاف الموسيقى + مزامنة
    var v = players[0] && players[0].vehicle;
    if (v && v.userData && v.userData._radioActive) stopVehicleRadio(v, false);
  }

  function openCarRadio(player) {
    if (!player || !player.vehicle) return;
    if (player.vehicleSeat && player.vehicleSeat !== 'driver') {
      toast('الرفيق ملوش تحكم في الموسيقى', 'info');
      return;
    }
    var panel = document.getElementById('car-radio');
    var list = document.getElementById('radio-tracks');
    if (!panel || !list) return;
    list.innerHTML = '';
    RADIO_TRACKS.forEach(function (t) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'radio-track';
      btn.textContent = t.name;
      btn.onclick = function () { playVehicleRadio(player.vehicle, t); };
      list.appendChild(btn);
    });
    panel.classList.remove('hidden');
    _radioOpen = true;
  }

  function playVehicleRadio(vehicle, track) {
    if (!vehicle || !track) return;
    ensureVehicleData(vehicle);
    if (_radioAudio) {
      try { _radioAudio.pause(); } catch (e) {}
      _radioAudio = null;
    }
    try {
      _radioAudio = new Audio(track.src);
      _radioAudio.loop = false;
      _radioAudio.volume = 0.55;
      vehicle.userData.radioTrack = track.id;
      vehicle.userData._radioActive = true;
      // امسح active من باقي العربيات
      for (var ri = 0; ri < state.buildObjects.length; ri++) {
        if (state.buildObjects[ri] !== vehicle && state.buildObjects[ri].userData) state.buildObjects[ri].userData._radioActive = false;
      }
      _radioAudio.ontimeupdate = function () {
        var seek = document.getElementById('radio-seek');
        var t0 = document.getElementById('radio-t0');
        var t1 = document.getElementById('radio-t1');
        if (_radioAudio && seek && _radioAudio.duration) {
          seek.value = Math.floor((_radioAudio.currentTime / _radioAudio.duration) * 1000);
          if (t0) t0.textContent = fmtTime(_radioAudio.currentTime);
          if (t1) t1.textContent = fmtTime(_radioAudio.duration);
        }
      };
      _radioAudio.play().catch(function () {});
      var title = document.getElementById('radio-title');
      if (title) title.textContent = track.name;
      document.querySelectorAll('.radio-track').forEach(function (b) {
        b.classList.toggle('active', b.textContent === track.name);
      });
      ensureVehicleData(vehicle);
      netEmit({
        type: 'world_event',
        action: 'radio_play',
        vehicleId: vehicle.userData.netVehicleId || vehicle.userData.instanceName,
        trackId: track.id,
        x: vehicle.position.x,
        z: vehicle.position.z
      });
    } catch (e) {
      toast('فشل تشغيل الأغنية', 'error');
    }
  }

  function stopVehicleRadio(vehicle, fromNet) {
    if (_radioAudio) {
      try { _radioAudio.pause(); } catch (e) {}
      _radioAudio = null;
    }
    if (vehicle && vehicle.userData) {
      vehicle.userData.radioTrack = null;
      vehicle.userData._radioActive = false;
    }
    for (var ri = 0; ri < state.buildObjects.length; ri++) {
      if (state.buildObjects[ri] && state.buildObjects[ri].userData) {
        state.buildObjects[ri].userData._radioActive = false;
      }
    }
    if (!fromNet && vehicle) {
      ensureVehicleData(vehicle);
      netEmit({
        type: 'world_event',
        action: 'radio_stop',
        vehicleId: vehicle.userData.netVehicleId || vehicle.userData.instanceName
      });
    }
  }

  function updateRadioSpatial() {
    if (!_radioAudio) return;
    var local = players[0];
    if (!local || !local.group) return;
    var srcCar = null;
    // العربية اللي شغّالة الراديو عليها
    for (var i = 0; i < state.buildObjects.length; i++) {
      var o = state.buildObjects[i];
      if (o && o.userData && o.userData.radioTrack && o.userData._radioActive) { srcCar = o; break; }
    }
    if (!srcCar && local.vehicle && local.vehicle.userData && local.vehicle.userData.radioTrack) {
      srcCar = local.vehicle;
    }
    if (!srcCar) {
      // fallback nearest with radioTrack
      var bestD2 = 1e9;
      for (var j = 0; j < state.buildObjects.length; j++) {
        var o2 = state.buildObjects[j];
        if (!o2 || !o2.userData || !o2.userData.radioTrack) continue;
        var dx2 = o2.position.x - local.group.position.x;
        var dz2 = o2.position.z - local.group.position.z;
        var d2 = Math.sqrt(dx2 * dx2 + dz2 * dz2);
        if (d2 < bestD2) { bestD2 = d2; srcCar = o2; }
      }
    }
    if (!srcCar) { _radioAudio.volume = 0; return; }
    var dx = srcCar.position.x - local.group.position.x;
    var dz = srcCar.position.z - local.group.position.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (local.vehicle === srcCar) dist = 0;
    // صوت لازق في العربية: أعلى جوه، يقل مع البعد
    var vol = 0;
    if (dist < 35) vol = Math.max(0, 0.75 * (1 - dist / 35));
    _radioAudio.volume = vol;
  }


  // ===== تفاعل موحّد (عربيات / إضاءة / …) =====
  state.interactFocus = null; // الكائن المختار عند التعارض
  state.interactPickMode = false;

  function getAccentColorHex(obj) {
    if (!obj || !obj.userData) return null;
    if (obj.userData.accentColor != null) {
      var c = obj.userData.accentColor;
      if (typeof c === 'number') return '#' + ('000000' + c.toString(16)).slice(-6);
      return c;
    }
    // حاول من أول mesh ملون
    var found = null;
    obj.traverse(function (ch) {
      if (found || !ch.isMesh || !ch.material || !ch.material.color) return;
      found = '#' + ch.material.color.getHexString();
    });
    return found;
  }

  function tintInteractPrompt(obj) {
    var el = document.getElementById('interact-prompt');
    if (!el) return;
    var hex = getAccentColorHex(obj) || '#0f172a';
    el.style.background = 'linear-gradient(135deg, ' + hex + 'cc, rgba(8,12,24,0.92))';
    el.style.borderColor = hex;
  }

  function findNearbyInteractive(player, maxDist) {
    maxDist = maxDist || 6.5;
    var list = [];
    if (!player || !player.group) return list;
    var px = player.group.position.x, pz = player.group.position.z;
    var maxD2 = maxDist * maxDist;
    for (var i = 0; i < state.buildObjects.length; i++) {
      var o = state.buildObjects[i];
      if (!o || !o.userData) continue;
      if (!(o.userData.interactive || o.userData.isVehicle || o.userData.isLight)) continue;
      var dx = o.position.x - px, dz = o.position.z - pz;
      var d2 = dx * dx + dz * dz;
      if (d2 <= maxD2) list.push({ obj: o, d2: d2 });
    }
    list.sort(function (a, b) { return a.d2 - b.d2; });
    return list;
  }

  function showMultiInteractTip(show) {
    var m = document.getElementById('multi-interact-tip');
    if (!m) return;
    if (show) m.classList.remove('hidden');
    else m.classList.add('hidden');
  }
  function showMultiInteractModal(show) { showMultiInteractTip(show); }

  function updateInteractPrompt() {
    var el = document.getElementById('interact-prompt');
    var keyEl = document.getElementById('ip-key');
    var textEl = document.getElementById('ip-text');
    if (!el) return;
    if (state.mode !== 'play' || state.paused) {
      el.classList.add('hidden');
      return;
    }
    var p = players[0];
    if (!p || !p.group) { el.classList.add('hidden'); return; }

    // جوه عربية
    if (p.vehicle) {
      el.classList.remove('hidden');
      tintInteractPrompt(p.vehicle);
      if (keyEl) keyEl.textContent = 'F';
      var lines = 'للخروج من العربية';
      if (!p.vehicleSeat || p.vehicleSeat === 'driver') {
        lines += '<br><span style="opacity:0.85;font-size:0.85rem">H محرك · J/M راديو · N قفل · 1-5 غيار</span>';
      }
      if (textEl) textEl.innerHTML = lines;
      return;
    }

    // باب مكتب المدير — رسالة اضغط F
    try {
      var stOffice = findNearestGasStation(p.group.position, 22);
      if (stOffice && stOffice.userData && stOffice.userData.officeDoor) {
        var od = stOffice.userData.officeDoor;
        var odw = od.getWorldPosition(new THREE.Vector3());
        var odx = odw.x - p.group.position.x, odz = odw.z - p.group.position.z;
        if (odx * odx + odz * odz < 20) {
          el.classList.remove('hidden');
          if (keyEl) keyEl.textContent = 'F';
          var locked = performance.now() < (stOffice.userData.officeLockedUntil || 0);
          if (textEl) textEl.innerHTML = locked ? 'المدير مشغول شوية' : 'لفتح باب مكتب المدير';
          return;
        }
      }
    } catch (eOff) {}

    var near = findNearbyInteractive(p, 9);
    // لو في فوكس بس بعيد — امسحه
    if (state.interactFocus) {
      var still = near.some(function (n) { return n.obj === state.interactFocus; });
      if (!still) state.interactFocus = null;
    }

    if (near.length === 0) {
      el.classList.add('hidden');
      showMultiInteractTip(false);
      state.interactPickMode = false;
      return;
    }

    // تعارض: رسالة صغيرة أعلى اليمين (غير حاجبة)
    if (near.length > 1 && !state.interactFocus) {
      showMultiInteractTip(true);
    } else {
      showMultiInteractTip(false);
    }

    var target = state.interactFocus || near[0].obj;
    el.classList.remove('hidden');
    tintInteractPrompt(target);

    if (target.userData.isVehicle) {
      ensureVehicleData(target);
      var driverBusy = seatOccupied(target, 'driver');
      if (!driverBusy) {
        if (keyEl) keyEl.textContent = 'F';
        if (textEl) textEl.innerHTML = 'للقيادة<br><span style="opacity:0.85;font-size:0.85rem">G للركوب كمرافق</span>';
      } else {
        if (keyEl) keyEl.textContent = 'G';
        if (textEl) textEl.innerHTML = 'للركوب كمرافق<br><span style="opacity:0.85;font-size:0.85rem">السواقة مشغولة</span>';
      }
    } else if (target.userData.isLight) {
      if (keyEl) keyEl.textContent = 'F';
      if (textEl) textEl.innerHTML = target.userData.lightOn ? 'لإطفاء النور' : 'لتشغيل النور';
    } else if (target.userData.isGarage) {
      if (keyEl) keyEl.textContent = 'F';
      if (textEl) textEl.innerHTML = target.userData.gateOpen ? 'لإغلاق البوابة' : 'لفتح البوابة';
    } else if (target.userData.isGasStation) {
      el.classList.add('hidden'); // المحطة بتتعامل عبر المنطقة الحمراء
      return;
    } else {
      if (keyEl) keyEl.textContent = 'F';
      if (textEl) textEl.innerHTML = 'للتفاعل';
    }
  }

  function updatePlayHintsUI() {
    var tip = document.getElementById('mouse-interact-tip');
    var bar = document.getElementById('controls-help-bar');
    if (!bar) return;

    // وضع البناء — مرشد أزرار
    if (state.mode === 'build') {
      if (tip) tip.classList.add('hidden');
      var bparts = [];
      bparts.push('<span class="key">WASD</span> حركة كاميرا');
      bparts.push('<span class="key">F</span> طيران');
      bparts.push('<span class="key">Ctrl</span> إظهار الماوس');
      if (state.flyMode) {
        bparts.push('<span class="key">Space</span> ارتفاع');
        bparts.push('<span class="key">Shift</span> نزول');
        bparts.push('<span class="key">طيران</span> مفعّل');
      }
      bparts.push('<span class="key">LMB</span> اختيار/وضع');
      bparts.push('<span class="key">شريط الأدوات</span> تحريك · دوران · تكبير · نسخ · حذف');
      bparts.push('<span class="key">سحب يمين</span> حذف منطقة');
      bparts.push('<span class="key">Esc</span> قائمة');
      if (state.currentTool === 'place' && state.selectedItem) {
        bparts.push('<span class="key">وضع</span> ' + (state.selectedItem.name || ''));
      } else if (selectedBuildObj) {
        var n = (selectedBuildObj.userData && selectedBuildObj.userData.instanceName) || 'عنصر';
        bparts.push('<span class="key">محدد</span> ' + n);
      }
      bar.innerHTML = bparts.join(' · ');
      bar.classList.remove('hidden');
      return;
    }

    if (state.mode !== 'play' || state.paused) {
      if (tip) tip.classList.add('hidden');
      bar.classList.add('hidden');
      return;
    }
    if (tip) tip.classList.remove('hidden');
    var parts = [];
    parts.push('<span class="key">WASD</span> حركة');
    parts.push('<span class="key">Space</span> قفز');
    var p = players[0];
    if (p && p.vehicle) {
      parts.push('<span class="key">F</span> نزول');
      parts.push('<span class="key">H</span> محرك');
      parts.push('<span class="key">M</span> راديو');
      parts.push('<span class="key">J</span> تعبئة (منطقة حمراء)');
      parts.push('<span class="key">K</span> كلاكس');
      var mode = p.vehicle.userData && p.vehicle.userData.driveMode;
      if (mode === 'sport') parts.push('<span class="key">Space</span> دريفت');
      else parts.push('<span class="key">Space</span> فرامل');
      parts.push('<span class="key">1-5</span> غيار');
    } else {
      parts.push('<span class="key">F</span> تفاعل');
      parts.push('<span class="key">G</span> ركوب مرافق');
      parts.push('<span class="key">Shift</span> جري');
      parts.push('<span class="key">V</span> منظور أول/ثالث');
    }
    // أسلحة فقط لو فيه سلاح في العالم أو في اليد
    var hasWeapons = !!(state.weaponSlots && (state.weaponSlots[0] || state.weaponSlots[1]));
    if (!hasWeapons) {
      try {
        for (var i = 0; i < (state.buildObjects || []).length; i++) {
          var o = state.buildObjects[i];
          if (o && o.userData && o.userData.isWeapon) { hasWeapons = true; break; }
        }
      } catch (e) {}
    }
    if (hasWeapons) {
      parts.push('<span class="key">1</span>/<span class="key">2</span> سلاح ضهر/تبديل');
      parts.push('<span class="key">T</span> إلقاء');
      parts.push('<span class="key">RMB</span> تصويب');
      parts.push('<span class="key">LMB</span> إطلاق');
    }
    bar.innerHTML = parts.join(' · ');
    bar.classList.remove('hidden');
  }

  function getFocusedInteractive(player) {
    var near = findNearbyInteractive(player, 9);
    if (!near.length) return null;
    if (near.length > 1 && !state.interactFocus) return null; // تعارض
    return state.interactFocus || near[0].obj;
  }


  function findGasZoneUnderVehicle(vehicle) {
    if (!vehicle) return null;
    // نصف حجم المنطقة الحمراء (كل مكنة ليها منطقة خاصة)
    var halfX = 1.9, halfZ = 2.9;
    for (var i = 0; i < state.buildObjects.length; i++) {
      var st = state.buildObjects[i];
      if (!st || !st.userData || !st.userData.isGasStation || !st.userData.zones) continue;
      for (var z = 0; z < st.userData.zones.length; z++) {
        var zone = st.userData.zones[z];
        var zx = st.position.x + zone.position.x;
        var zz = st.position.z + zone.position.z;
        var dx = Math.abs(vehicle.position.x - zx);
        var dz = Math.abs(vehicle.position.z - zz);
        if (dx < halfX && dz < halfZ) {
          return { station: st, zone: zone, idx: z };
        }
      }
    }
    return null;
  }

  function updateGasZoneHints(player) {
    var hint = document.getElementById('gas-zone-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'gas-zone-hint';
      hint.className = 'gas-zone-hint hidden';
      document.body.appendChild(hint);
    }
    if (!player || !player.vehicle || (player.vehicleSeat && player.vehicleSeat !== 'driver')) {
      hint.classList.add('hidden');
      if (player && player.vehicle) player.vehicle.userData._onGasZone = false;
      return;
    }
    var v = player.vehicle;
    var hit = findGasZoneUnderVehicle(v);
    if (!hit) {
      hint.classList.add('hidden');
      v.userData._onGasZone = false;
      return;
    }
    v.userData._onGasZone = true;
    var pid = player.netId != null ? player.netId : player.id;
    // لو حد تاني بيعبّي من نفس المنطقة الحمراء
    if (hit.zone.userData.occupiedBy != null && hit.zone.userData.occupiedBy !== pid) {
      hint.textContent = 'المنطقة دي مشغولة — في حد بيعبّي';
      hint.classList.remove('hidden');
      return;
    }
    if (v.userData.fuelInfinite) {
      hint.textContent = 'مينفعش تعبي — بنزين مالانهاية';
      hint.classList.remove('hidden');
      return;
    }
    if (v.userData.refueling) {
      hint.classList.add('hidden');
      return;
    }
    var fuelNow = v.userData.fuel != null ? v.userData.fuel : 0;
    if (fuelNow >= 99.5) {
      hint.textContent = 'الخزان ممتلئ';
      hint.classList.remove('hidden');
      return;
    }
    hint.textContent = 'اضغط J لتعبئة البنزين';
    hint.classList.remove('hidden');
  }

  function tryStartRefuel(player) {
    if (!player || !player.vehicle) return;
    var v = player.vehicle;
    if (player.vehicleSeat && player.vehicleSeat !== 'driver') {
      toast('السواق بس اللي يعبّي', 'info');
      return;
    }
    if (v.userData.fuelInfinite) {
      toast('مينفعش تعبي — بنزين مالانهاية', 'info');
      return;
    }
    var hit = findGasZoneUnderVehicle(v);
    if (!hit) { toast('قف على المنطقة الحمراء أمام المكنة', 'info'); return; }
    var pid = player.netId != null ? player.netId : player.id;
    if (hit.zone.userData.occupiedBy != null && hit.zone.userData.occupiedBy !== pid) {
      toast('المنطقة دي مشغولة — في حد بيعبّي', 'error');
      return;
    }
    if (v.userData.refueling) return;
    var fuel = v.userData.fuel != null ? v.userData.fuel : 0;
    if (fuel >= 99.5) {
      toast('الخزان ممتلئ', 'info');
      return;
    }
    // مدة حسب كمية البنزين الناقصة — حد أقصى 10 ث، وأقل لو الخزان شبه مليان
    var need = Math.max(0, 100 - fuel);
    var sec = Math.max(1.2, Math.min(10, 10 * (need / 100)));
    hit.zone.userData.occupiedBy = pid;
    v.userData.refueling = true;
    v.userData.speed = 0;
    try {
      if (typeof Game !== 'undefined' && Game.netSend) {
        Game.netSend({ kind: 'zone_refuel_start', zoneIdx: hit.idx, pid: pid });
      }
    } catch (eN) {}
    var overlay = document.getElementById('refuel-overlay');
    var fill = document.getElementById('rf-fill');
    var secEl = document.getElementById('rf-sec');
    if (overlay) overlay.classList.remove('hidden');
    if (fill) fill.style.width = '0%';
    var start = performance.now();
    var total = sec * 1000;
    function tick(now) {
      if (!v.userData.refueling) return;
      // لو العربية خرجت من المنطقة أثناء التعبئة — وقف
      if (!findGasZoneUnderVehicle(v)) {
        v.userData.refueling = false;
        hit.zone.userData.occupiedBy = null;
        if (overlay) overlay.classList.add('hidden');
        toast('خرجت من المنطقة الحمراء — التعبئة اتوقفت', 'info');
        return;
      }
      var t = Math.min(1, (now - start) / total);
      if (fill) fill.style.width = (t * 100) + '%';
      if (secEl) secEl.textContent = Math.ceil((1 - t) * sec) + ' ث';
      v.userData.fuel = fuel + need * t;
      if (t >= 1) {
        v.userData.fuel = 100;
        v.userData.refueling = false;
        hit.zone.userData.occupiedBy = null;
        if (overlay) overlay.classList.add('hidden');
        toast('تم تعبئة البنزين', 'success');
        try {
          if (typeof Game !== 'undefined' && Game.netSend) {
            Game.netSend({ kind: 'zone_refuel_done', zoneIdx: hit.idx });
          }
        } catch (eN2) {}
        try {
          var stNear = hit.station || findNearestGasStation(v.position, 40);
          if (stNear) {
            var src = getGasVoiceSrc(stNear, 'pump_done');
            playSpatialVoice(src, v.position, 20, 0.9);
            var pw = (stNear.userData.pumpWorkers || [])[hit.idx];
            if (pw) {
              setNpcSpeaking(pw, true);
              setTimeout(function () { setNpcSpeaking(pw, false); }, 3500);
            }
            setTimeout(function () {
              if (v.userData._onGasZone) {
                playSpatialVoice(getGasVoiceSrc(stNear, 'pump_move'), v.position, 18, 0.9);
              }
            }, 3000);
          }
        } catch (e) {}
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function tryInteractPrimary(player) {
    if (!player) return;
    if (blockInteractIfArmed()) return;
    if (player.vehicle) { tryToggleVehicle(player, 'driver'); return; }
    var near = findNearbyInteractive(player, 9);
    if (near.length > 1 && !state.interactFocus) {
      showMultiInteractModal(true);
      return;
    }
    var t = getFocusedInteractive(player);
    if (!t) { toast('مفيش كائن تفاعلي قريب', 'info'); return; }
    if (t.userData.isVehicle) tryToggleVehicle(player, 'driver');
    else if (t.userData.isLight) toggleInteractiveLight(t);
    else if (t.userData.isGarage) toggleGarage(t);
    else toast('تفاعل', 'info');
  }

  function tryInteractSecondary(player) {
    if (!player || player.vehicle) return;
    if (blockInteractIfArmed()) return;
    var near = findNearbyInteractive(player, 9);
    if (near.length > 1 && !state.interactFocus) {
      showMultiInteractModal(true);
      return;
    }
    var t = getFocusedInteractive(player);
    if (t && t.userData.isVehicle) tryToggleVehicle(player, 'passenger');
  }



  function setVehicleGear(vehicle, gear, player) {
    if (!vehicle || !vehicle.userData) return;
    gear = Math.max(1, Math.min(5, gear | 0));
    vehicle.userData.gear = gear;
    toast('الغيار ' + gear, 'info');
    try { updateVehicleHUD(vehicle, player || players[0]); } catch (e) {}
    try { broadcastVehicleEvent && broadcastVehicleEvent('gear', vehicle, player, String(gear)); } catch (e) {}
  }


  function updateVehicleWheels(vehicle, delta) {
    if (!vehicle || !vehicle.userData || !vehicle.userData.wheels) return;
    var spd = vehicle.userData.speed || 0;
    var steer = vehicle.userData.steer || 0;
    // دوران الإطار حول محور العجلة (X بعد ما العجلة متثبتة بـ group)
    var spin = spd * 3.2 * delta;
    var wheels = vehicle.userData.wheels;
    for (var i = 0; i < wheels.length; i++) {
      var w = wheels[i];
      if (!w) continue;
      // spin: حول محور X المحلي (بعد rotation.z للأسطوانة الأصلية داخل المجموعة)
      w.rotation.x += spin;
      // توجيه العجلات الأمامية
      if (w.userData && w.userData.isFront) {
        w.rotation.y = steer * 0.55;
      }
    }
  }

  function updateVehicleHUD(v, player) {
    var hud = document.getElementById('vehicle-hud');
    if (!hud) return;
    if (!player || !player.vehicle || player.vehicle !== v) {
      hud.classList.add('hidden');
      return;
    }
    hud.classList.remove('hidden');
    var gear = (v.userData.gear != null ? v.userData.gear : 1);
    var speedUnits = Math.abs(v.userData.speed || 0);
    var kmh = Math.round(speedUnits / 0.12);
    var eng = v.userData.engineOn ? 'ON' : 'OFF';
    var mode = v.userData.driveMode || 'normal';
    var speedEl = document.getElementById('vh-speed');
    var gearEl = document.getElementById('vh-gear');
    var engEl = document.getElementById('vh-engine');
    if (speedEl) speedEl.textContent = kmh;
    if (gearEl) gearEl.textContent = mode === 'sport' ? 'M' : gear;
    if (engEl) {
      engEl.textContent = eng;
      engEl.classList.toggle('on', !!v.userData.engineOn);
    }
    var gearsBox = document.getElementById('vh-gears');
    var manual = document.getElementById('vh-manual');
    if (mode === 'sport') {
      if (gearsBox) gearsBox.classList.add('hidden');
      if (manual) {
        manual.classList.remove('hidden');
        var needle = document.getElementById('vh-manual-needle');
        if (needle) needle.style.setProperty('--w', Math.min(100, (kmh / 120) * 100) + '%');
        // width via child
        if (needle) {
          needle.innerHTML = '';
          var fill = document.createElement('div');
          fill.style.cssText = 'height:100%;width:' + Math.min(100, (kmh / 120) * 100) + '%;background:linear-gradient(90deg,#22d3ee,#a78bfa);border-radius:4px;';
          needle.appendChild(fill);
        }
      }
    } else {
      if (gearsBox) gearsBox.classList.remove('hidden');
      if (manual) manual.classList.add('hidden');
      for (var g = 1; g <= 5; g++) {
        var b = document.getElementById('vh-gear-' + g);
        if (b) b.classList.toggle('active', g === gear);
      }
    }
    var mn = document.getElementById('vh-mode-normal');
    var ms = document.getElementById('vh-mode-sport');
    if (mn) mn.classList.toggle('active', mode === 'normal');
    if (ms) ms.classList.toggle('active', mode === 'sport');
    // fuel
    var fuelWrap = document.getElementById('vh-fuel-wrap');
    var fuelPct = document.getElementById('vh-fuel-pct');
    var fuelFill = document.getElementById('vh-fuel-fill');
    if (v.userData.fuelInfinite) {
      if (fuelPct) fuelPct.textContent = '∞';
      if (fuelFill) { fuelFill.style.width = '100%'; fuelFill.classList.remove('low'); }
    } else {
      var f = Math.max(0, Math.min(100, v.userData.fuel || 0));
      if (fuelPct) fuelPct.textContent = Math.round(f);
      if (fuelFill) {
        fuelFill.style.width = f + '%';
        fuelFill.classList.toggle('low', f < 15);
      }
    }
  }

  function hideVehicleHUD() {
    var hud = document.getElementById('vehicle-hud');
    if (hud) hud.classList.add('hidden');
  }

  function netEmit(msg) {
    if (!msg || state.playType !== 'online') return;
    try {
      if (!msg.id) msg.id = state.myNetId;
      if (state.useFirebase) fbSend(msg);
      else if (state.useLan) lanSend(msg);
      else if (state.isHost) broadcastToAll(msg);
      else if (state.connection) state.connection.send(msg);
    } catch (e) {}
  }

  function findVehicleByNetId(vid) {
    if (!vid) return null;
    var list = state.buildObjects || [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || !o.userData) continue;
      if (o.userData.netVehicleId === vid || o.userData.instanceName === vid || o.userData.buildId === vid) return o;
    }
    return null;
  }

  function broadcastVehicleEvent(type, vehicle, player, extra) {
    try {
      ensureVehicleData(vehicle);
      var id = (vehicle && vehicle.userData && (vehicle.userData.netVehicleId || vehicle.userData.instanceName || vehicle.userData.buildId)) || null;
      netEmit({
        type: 'vehicle_event',
        action: type,
        vehicleId: id,
        seat: player ? player.vehicleSeat : null,
        pid: state.myNetId,
        extra: extra || null,
        x: vehicle ? vehicle.position.x : 0,
        y: vehicle ? vehicle.position.y : 0,
        z: vehicle ? vehicle.position.z : 0,
        ry: vehicle ? vehicle.rotation.y : 0,
        eng: vehicle && vehicle.userData ? !!vehicle.userData.engineOn : false
      });
    } catch (e) {}
  }

  // ===== تصادم صلب على مستوى كل mesh (أرضية + جدران بدون لزق) =====
  var _pBox = new THREE.Box3();
  var _oBox = new THREE.Box3();
  var PLAYER_RADIUS = 0.28;
  var PLAYER_HEIGHT = 1.85;
  var STEP_HEIGHT = 1.1; // تسلق أعلى

  function getObjectBox(o) {
    _oBox.setFromObject(o);
    return _oBox;
  }

  // اجمع صناديق التصادم من كل mesh فرعي (مش الجروب كله)
  function forEachSolidBox(fn) {
    var list = state.buildObjects || [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || !o.visible) continue;
      if (o.userData && (o.userData.noCollision || o.userData.isVehicle || o.userData.luxuryCar)) continue;
      var meshes = [];
      if (o.isMesh) meshes.push(o);
      else if (o.traverse) {
        o.traverse(function (ch) {
          if (ch.isMesh && ch.visible) meshes.push(ch);
        });
      }
      if (!meshes.length) {
        // fallback: الصندوق الكامل
        var b0 = new THREE.Box3().setFromObject(o);
        if (!b0.isEmpty()) fn(b0, o);
        continue;
      }
      for (var m = 0; m < meshes.length; m++) {
        var msh = meshes[m];
        if (msh.userData && msh.userData.noCollision) continue;
        // تجاهل آباء marked noCollision (مضخات / مناطق)
        var skipAnc = false;
        var anc = msh.parent;
        while (anc && anc !== o) {
          if (anc.userData && (anc.userData.noCollision || anc.userData.isGasZone)) { skipAnc = true; break; }
          anc = anc.parent;
        }
        if (skipAnc) continue;
        var b = new THREE.Box3().setFromObject(msh);
        if (b.isEmpty()) continue;
        var sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
        if (sx < 0.05 && sy < 0.05 && sz < 0.05) continue;
        fn(b, o, msh);
      }
    }
  }

  function getGroundY(player) {
    var x = player.group.position.x;
    var z = player.group.position.z;
    var feetY = player.group.position.y;
    var best = 0;
    var r = PLAYER_RADIUS * 0.85;
    forEachSolidBox(function (b) {
      var top = b.max.y;
      if (top < -0.02) return;
      // سطح تحت الرجلين أو قريب (نقدر نطلع عليه)
      if (top > feetY + STEP_HEIGHT + 0.35) return;
      if (x + r < b.min.x || x - r > b.max.x || z + r < b.min.z || z - r > b.max.z) return;
      var sy = b.max.y - b.min.y;
      var sx = b.max.x - b.min.x;
      var sz = b.max.z - b.min.z;
      // جدار رفيع مرتفع ≠ أرضية
      if (sy > 1.4 && (sx < 0.55 || sz < 0.55)) return;
      // سطح معقول للوقوف (مش إبرة)
      if (sx < 0.25 && sz < 0.25) return;
      if (top > best) best = top;
    });
    return best;
  }

  function isStandingOnBox(b, x, y, z) {
    var r = PLAYER_RADIUS * 0.9;
    var top = b.max.y;
    if (x + r < b.min.x || x - r > b.max.x || z + r < b.min.z || z - r > b.max.z) return false;
    // الرجلين فوق السطح أو جواه بقليل
    if (y + 0.12 < top - 0.35) return false;
    if (y > top + STEP_HEIGHT + 0.25) return false;
    // لازم يكون سطح مش حافة جدار رفيع
    var sy = b.max.y - b.min.y;
    var sx = b.max.x - b.min.x;
    var sz = b.max.z - b.min.z;
    if (sy > 1.4 && (sx < 0.55 || sz < 0.55)) return false;
    return Math.abs(y - top) <= STEP_HEIGHT + 0.15 || (y <= top && y >= top - 0.5);
  }

  function hitsWall(player, x, y, z) {
    var r = PLAYER_RADIUS;
    var h = PLAYER_HEIGHT;
    // الجسم فوق مستوى الخطوة شوية
    _pBox.min.set(x - r, y + 0.35, z - r);
    _pBox.max.set(x + r, y + h, z + r);
    var hit = false;
    forEachSolidBox(function (b) {
      if (hit) return;
      if (!_pBox.intersectsBox(b)) return;
      // واقف على السطح → مش جدار
      if (isStandingOnBox(b, x, y, z)) return;
      // تداخل من فوق بس (نزلنا في السطح) → ارفعه لاحقًا كأرضية
      var top = b.max.y;
      if (top <= y + 0.5 && top >= y - 0.15) return;
      hit = true;
    });
    if (hit) return true;
    if (state.playType === 'split') {
      for (var j = 0; j < players.length; j++) {
        if (!players[j] || players[j] === player || !players[j].group) continue;
        var dx = x - players[j].group.position.x;
        var dz = z - players[j].group.position.z;
        if (dx * dx + dz * dz < (r * 1.5) * (r * 1.5)) return true;
      }
    }
    return false;
  }

  function playerCollides(player) {
    if (!player || !player.group) return false;
    return hitsWall(player, player.group.position.x, player.group.position.y, player.group.position.z);
  }


  function vehicleHitsOtherVehicle(vehicle, x, z) {
    if (!vehicle) return false;
    var halfW = 1.05, halfD = 2.15;
    try {
      var box = new THREE.Box3().setFromObject(vehicle);
      if (!box.isEmpty()) {
        halfW = Math.max(0.9, (box.max.x - box.min.x) * 0.48);
        halfD = Math.max(1.6, (box.max.z - box.min.z) * 0.48);
      }
    } catch (e) {}
    var list = state.buildObjects || [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || o === vehicle || !o.userData || !o.userData.isVehicle) continue;
      var ox = o.position.x, oz = o.position.z;
      var ohw = 1.05, ohd = 2.15;
      try {
        var ob = new THREE.Box3().setFromObject(o);
        if (!ob.isEmpty()) {
          ohw = Math.max(0.9, (ob.max.x - ob.min.x) * 0.48);
          ohd = Math.max(1.6, (ob.max.z - ob.min.z) * 0.48);
        }
      } catch (e2) {}
      // AABB تقريبي في XZ — العربيات تلمس بعض
      if (Math.abs(x - ox) < (halfW + ohw) && Math.abs(z - oz) < (halfD + ohd)) {
        return true;
      }
    }
    return false;
  }

  function vehicleHitsSolid(vehicle, x, z) {
    if (!vehicle) return false;
    // اصطدام عربيات ببعض (mesh)
    if (vehicleHitsOtherVehicle(vehicle, x, z)) return true;
    var box = new THREE.Box3().setFromObject(vehicle);
    var halfW = Math.max(0.8, (box.max.x - box.min.x) * 0.45);
    var halfD = Math.max(1.2, (box.max.z - box.min.z) * 0.45);
    var y = vehicle.position.y || 0;
    var hit = false;
    forEachSolidBox(function (b, o, mesh) {
      if (hit) return;
      if (o === vehicle || (o.userData && (o.userData.isVehicle || o.userData.noCollision || o.userData.isGasZone))) return;
      // بوابة الجراج: تتصادم وهي مقفولة، وتتعدى لما مفتوحة
      if (o.userData && o.userData.isGate) {
        if (o.userData.noCollision) return;
        // لو البوابة جزء من جراج مفتوح
        var parentG = o.parent;
        if (parentG && parentG.userData && parentG.userData.isGarage && parentG.userData.gateOpen) return;
      }
      // محطة بنزين: العربية تعدي حرّة على المناطق الحمراء/المضخات/الأعمدة — تصطدم بس بالكابينة والمكتب
      if (o.userData && o.userData.isGasStation) {
        var solid = mesh && mesh.userData && mesh.userData.solidBuilding;
        // لو الـ mesh نفسه أو أبوه marked solid
        if (!solid && mesh) {
          var p = mesh.parent;
          while (p && p !== o) {
            if (p.userData && p.userData.solidBuilding) { solid = true; break; }
            if (p.userData && p.userData.noCollision) break;
            p = p.parent;
          }
        }
        if (!solid) return;
      }
      // أي mesh عليه noCollision
      if (mesh && mesh.userData && mesh.userData.noCollision) return;
      // تجاهل الأرضيات المنخفضة جدًا
      if (b.max.y < y + 0.15) return;
      // overlap XZ
      if (x + halfW > b.min.x && x - halfW < b.max.x && z + halfD > b.min.z && z - halfD < b.max.z) {
        // لو السطح قابل للتسلق
        var top = b.max.y;
        if (top <= y + 1.2 && top >= y - 0.1) {
          vehicle.position.y = top;
          return;
        }
        hit = true;
      }
    });
    return hit;
  }
  function updatePlayerMovement(player, delta, input) {
    if (!player.group) return;
    if (state.hackFly && player === players[0] && !player.vehicle) return; // حركة الطيران في animate
    // Script can lock player input or force movement (لا يطبّق لو سايق عربية)
    if (!player.vehicle && state.script.inputLocked[player.id]) {
      if (state.script.forcedInput[player.id]) {
        input = state.script.forcedInput[player.id];
      } else {
        input = { up: false, down: false, left: false, right: false, jump: false, run: false };
      }
    } else if (!player.vehicle && state.script.forcedInput[player.id]) {
      // merge forced over real
      var fi = state.script.forcedInput[player.id];
      input = {
        up: fi.up != null ? fi.up : input.up,
        down: fi.down != null ? fi.down : input.down,
        left: fi.left != null ? fi.left : input.left,
        right: fi.right != null ? fi.right : input.right,
        jump: fi.jump != null ? fi.jump : input.jump,
        run: fi.run != null ? fi.run : input.run,
        lookX: fi.lookX != null ? fi.lookX : input.lookX
      };
    }
    // Driving a vehicle
    if (player.vehicle) {
      var v = player.vehicle;
      var isDriver = !player.vehicleSeat || player.vehicleSeat === 'driver';
      if (!isDriver) {
        player.group.position.x = v.position.x;
        player.group.position.y = (v.position.y || 0) + 0.95;
        player.group.position.z = v.position.z;
        player.group.rotation.y = v.rotation.y + Math.PI;
        player.velocity.set(0, 0, 0);
        return;
      }
      ensureVehicleData(v);
      if (v.userData.gear == null) v.userData.gear = 1;
      if (v.userData.speed == null) v.userData.speed = 0;
      if (v.userData.driveMode == null) v.userData.driveMode = 'normal';
      if (v.userData.fuel == null) v.userData.fuel = 100;
      if (v.userData.fuelInfinite == null) v.userData.fuelInfinite = true;

      // تعبئة بنزين: تثبيت
      if (v.userData.refueling) {
        player.group.position.x = v.position.x;
        player.group.position.y = (v.position.y || 0) + 0.95;
        player.group.position.z = v.position.z;
        v.userData.speed = 0;
        player.velocity.set(0, 0, 0);
        try { updateVehicleHUD(v, player); } catch (eH) {}
        return;
      }

      var mode = v.userData.driveMode || 'normal';
      var GEAR_MAX = { 1: 20, 2: 40, 3: 80, 4: 120, 5: 150 };
      var gear = Math.max(1, Math.min(5, v.userData.gear | 0));
      var maxKmh = mode === 'sport' ? 120 : (GEAR_MAX[gear] || 20);
      var maxSpeed = maxKmh * 0.12;

      if (v.userData.steer == null) v.userData.steer = 0;
      if (input.left) v.userData.steer = Math.min(0.85, v.userData.steer + 2.4 * delta);
      else if (input.right) v.userData.steer = Math.max(-0.85, v.userData.steer - 2.4 * delta);
      else v.userData.steer *= Math.max(0, 1 - 4.5 * delta);

      // SPACE: عادي=فرامل | سبورت=دريفت فقط (مش فرامل)
      var spaceHeld = !!(input.jump);
      var drifting = false;
      if (mode === 'sport') {
        drifting = spaceHeld && Math.abs(v.userData.speed) > 1.2 && v.userData.engineOn;
      }
      var braking = (mode !== 'sport') && spaceHeld;

      if (braking) {
        v.userData.speed *= Math.max(0, 1 - 4.5 * delta);
      }

      // حالة دريفت: انزلاق + دوران ممتع بدون إيقاف السرعة
      if (v.userData.driftSlip == null) v.userData.driftSlip = 0;
      if (drifting) {
        // انزلاق ناعم وخفيف (مش انحراف قوي)
        v.userData.driftSlip = Math.min(0.75, v.userData.driftSlip + 1.6 * delta);
        // دوران معتدل حسب الكوتش
        var driftYaw = v.userData.steer * (2.1 + v.userData.driftSlip * 1.3) * delta * Math.sign(v.userData.speed || 1);
        v.rotation.y += driftYaw;
        // السرعة تنزل ببطء خفيف
        v.userData.speed *= Math.max(0.88, 1 - 0.22 * delta);
        // لو بتضغط غاز أثناء الدريفت — حافظ على السرعة
        if (input.up) v.userData.speed = Math.min(maxSpeed * 1.03, v.userData.speed + 5 * delta);
        v.userData._driftT = (v.userData._driftT || 0) + delta;
        if (v.userData._driftT > 0.28) {
          v.userData._driftT = 0;
          try { playDriftScreech(); } catch (eD) {}
        }
        // ميلان جسم خفيف
        var _tz = -v.userData.steer * 0.12 * v.userData.driftSlip; var _kz = Math.min(1, delta * 5); v.rotation.z = (v.rotation.z || 0) + (_tz - (v.rotation.z || 0)) * _kz;
      } else {
        v.userData.driftSlip = Math.max(0, v.userData.driftSlip - 2.8 * delta);
        var _k2 = Math.min(1, delta * 5); v.rotation.z = (v.rotation.z || 0) * (1 - _k2);
      }

      if (!v.userData.engineOn) {
        v.userData.speed *= Math.max(0, 1 - 2.5 * delta);
        player.group.position.x = v.position.x;
        player.group.position.y = (v.position.y || 0) + 0.95;
        player.group.position.z = v.position.z;
        player.velocity.set(0, 0, 0);
        try { updateVehicleHUD(v, player); updateVehicleWheels(v, delta); } catch (eH) {}
        return;
      }

      // بنزين ينفد
      if (!v.userData.fuelInfinite && (v.userData.fuel || 0) <= 0) {
        v.userData.engineOn = false;
        toast('البنزين خلص!', 'error');
        try { updateVehicleHUD(v, player); } catch (eH) {}
        return;
      }

      if (!braking && !drifting) {
        if (input.up) {
          var accel = mode === 'sport' ? 12 : 8;
          v.userData.speed = Math.min(maxSpeed, v.userData.speed + accel * delta);
        } else if (input.down) {
          v.userData.speed = Math.max(-maxSpeed * 0.35, v.userData.speed - 10 * delta);
        } else {
          v.userData.speed *= Math.max(0, 1 - 1.1 * delta);
          if (Math.abs(v.userData.speed) < 0.05) v.userData.speed = 0;
        }
      } else if (drifting && input.down) {
        // S أثناء الدريفت = فرملة خفيفة للتحكم
        v.userData.speed *= Math.max(0, 1 - 1.8 * delta);
      }
      if (v.userData.speed > maxSpeed * (drifting ? 1.08 : 1)) v.userData.speed = maxSpeed * (drifting ? 1.08 : 1);
      if (v.userData.speed < -maxSpeed * 0.35) v.userData.speed = -maxSpeed * 0.35;

      var spd = v.userData.speed;
      if (Math.abs(spd) > 0.02) {
        var turnFactor = Math.min(1, Math.abs(spd) / 2.5);
        var turnMul = mode === 'sport' ? 2.1 : 1.5;
        // دوران عادي للكوتش (لو مش في ذروة دريفت الـ yaw فوق)
        if (!drifting) {
          v.rotation.y += v.userData.steer * Math.sign(spd || 1) * turnMul * turnFactor * delta;
        }
        var vfX = Math.sin(v.rotation.y);
        var vfZ = Math.cos(v.rotation.y);
        // دريفت: انزلاق جانبي خفيف وناعم
        if (drifting) {
          var slip = v.userData.driftSlip || 0;
          var sideAmt = v.userData.steer * (0.45 + slip * 0.7);
          vfX += Math.cos(v.rotation.y) * sideAmt;
          vfZ -= Math.sin(v.rotation.y) * sideAmt;
          var fl = Math.sqrt(vfX * vfX + vfZ * vfZ) || 1;
          vfX /= fl; vfZ /= fl;
        }
        var nx = v.position.x + vfX * spd * delta;
        var nz = v.position.z + vfZ * spd * delta;
        if (!vehicleHitsSolid(v, nx, nz)) {
          v.position.x = nx;
          v.position.z = nz;
        } else {
          // جرب محور واحد (انزلاق على الحائط)
          if (!vehicleHitsSolid(v, nx, v.position.z)) v.position.x = nx;
          else if (!vehicleHitsSolid(v, v.position.x, nz)) v.position.z = nz;
          else v.userData.speed *= 0.3;
        }
        // استهلاك بنزين
        if (!v.userData.fuelInfinite) {
          var rate = v.userData.fuelConsume === 'low' ? 0.35 : (v.userData.fuelConsume === 'high' ? 1.1 : 0.65);
          v.userData.fuel = Math.max(0, (v.userData.fuel || 0) - rate * Math.abs(spd) * delta * 0.8);
          if (v.userData.fuel < 15) {
            v.userData._alarmT = (v.userData._alarmT || 0) + delta;
            if (v.userData._alarmT > 1.2) {
              v.userData._alarmT = 0;
              try { playFuelAlarm(); } catch (eA) {}
            }
          }
        }
      }

      player.group.position.x = v.position.x;
      player.group.position.y = (v.position.y || 0) + 0.95;
      player.group.position.z = v.position.z;
      player.group.rotation.y = player.yaw + Math.PI;
      player.velocity.set(0, 0, 0);
      try { updateVehicleHUD(v, player); updateEngineLoop(v); updateVehicleWheels(v, delta); } catch (eH) {}
      return;
    }

    var speed = input.run ? 7.5 : 4.2;
    if (input.lookX !== undefined) player.yaw -= input.lookX * 0.04;

    // Character faces camera direction
    player.group.rotation.y = THREE.MathUtils.lerp(player.group.rotation.y, player.yaw + Math.PI, 0.3);

    // Camera forward = where the player should walk on W
    // Camera sits at (sin(yaw)*d, cos(yaw)*d) behind player, so forward is (-sin, -cos)
    var fwdX = -Math.sin(player.yaw);
    var fwdZ = -Math.cos(player.yaw);
    var rightX = Math.cos(player.yaw);
    var rightZ = -Math.sin(player.yaw);

    var mx = 0, mz = 0;
    if (input.up) { mx += fwdX; mz += fwdZ; }      // W = toward camera look
    if (input.down) { mx -= fwdX; mz -= fwdZ; }    // S = opposite
    if (input.right) { mx += rightX; mz += rightZ; }
    if (input.left) { mx -= rightX; mz -= rightZ; }

    var ud = player.group.userData;
    var len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0.001) {
      mx /= len; mz /= len;
      var step = speed * delta;
      var oldX = player.group.position.x;
      var oldY = player.group.position.y;
      var oldZ = player.group.position.z;
      // حرّك X ثم Z — لو اتصدم جرب صعود درجة (منغير لزق)
      player.group.position.x = oldX + mx * step;
      if (hitsWall(player, player.group.position.x, player.group.position.y, player.group.position.z)) {
        // جرب تتسلق
        player.group.position.y = oldY + STEP_HEIGHT;
        if (hitsWall(player, player.group.position.x, player.group.position.y, player.group.position.z)) {
          player.group.position.x = oldX;
          player.group.position.y = oldY;
        } else {
          player.velocity.y = 0;
          player.canJump = true;
        }
      }
      player.group.position.z = oldZ + mz * step;
      if (hitsWall(player, player.group.position.x, player.group.position.y, player.group.position.z)) {
        player.group.position.y = oldY + STEP_HEIGHT;
        if (hitsWall(player, player.group.position.x, player.group.position.y, player.group.position.z)) {
          player.group.position.z = oldZ;
          player.group.position.y = oldY;
        } else {
          player.velocity.y = 0;
          player.canJump = true;
        }
      }
      ud.walkCycle += delta * speed * 3.2;
      var swing = Math.sin(ud.walkCycle) * 0.55;
      ud.leftArm.rotation.x = swing; ud.rightArm.rotation.x = -swing;
      ud.leftLeg.rotation.x = -swing; ud.rightLeg.rotation.x = swing;
    } else {
      ud.leftArm.rotation.x *= 0.85; ud.rightArm.rotation.x *= 0.85;
      ud.leftLeg.rotation.x *= 0.85; ud.rightLeg.rotation.x *= 0.85;
    }
    if (input.jump && player.canJump) { player.velocity.y = 6.8; player.canJump = false; }
    player.velocity.y -= 18 * delta;
    player.group.position.y += player.velocity.y * delta;
    // أرضية صلبة (أرض اللعبة أو أسطح الكائنات) — منغير لزق
    var groundY = 0;
    try { groundY = getGroundY(player); } catch (eG) { groundY = 0; }
    if (player.group.position.y <= groundY) {
      player.group.position.y = groundY;
      player.velocity.y = 0;
      player.canJump = true;
    }
    // لو لازق جوا جدار بعد الحركة: ادفعه لأقرب مخرج بسيط
    if (hitsWall(player, player.group.position.x, player.group.position.y, player.group.position.z)) {
      var rx = player.group.position.x, rz = player.group.position.z, ry = player.group.position.y;
      var pushed = false;
      var tries = [[0.25,0],[-0.25,0],[0,0.25],[0,-0.25],[0.4,0],[-0.4,0],[0,0.4],[0,-0.4]];
      for (var ti = 0; ti < tries.length; ti++) {
        var nx = rx + tries[ti][0], nz = rz + tries[ti][1];
        if (!hitsWall(player, nx, ry, nz)) {
          player.group.position.x = nx;
          player.group.position.z = nz;
          pushed = true;
          break;
        }
      }
      // لو مفيش مخرج: ارفع شوية (درجة/رصيف)
      if (!pushed) {
        var upY = ry + STEP_HEIGHT;
        if (!hitsWall(player, rx, upY, rz)) {
          player.group.position.y = upY;
          player.velocity.y = 0;
          player.canJump = true;
        }
      }
    }
  }

  // ===== FLY CAMERA =====
  function updateFlyCamera(delta) {
    var speed = (state.keys['ShiftLeft'] || state.keys['ShiftRight']) ? 8 : 14;
    // When shift held for down, don't use it as speed boost - separate
    var moveSpeed = 14;
    if (state.keys['KeyW'] || state.keys['KeyS'] || state.keys['KeyA'] || state.keys['KeyD']) {
      // normal
    }
    var forward = new THREE.Vector3(-Math.sin(state.flyYaw) * Math.cos(state.flyPitch), 0, -Math.cos(state.flyYaw) * Math.cos(state.flyPitch));
    forward.y = 0; forward.normalize();
    var right = new THREE.Vector3(Math.cos(state.flyYaw), 0, -Math.sin(state.flyYaw));
    if (state.keys['KeyW']) state.flyPos.addScaledVector(forward, moveSpeed * delta);
    if (state.keys['KeyS']) state.flyPos.addScaledVector(forward, -moveSpeed * delta);
    if (state.keys['KeyA']) state.flyPos.addScaledVector(right, -moveSpeed * delta);
    if (state.keys['KeyD']) state.flyPos.addScaledVector(right, moveSpeed * delta);
    // Space = up, Shift = down
    if (state.keys['Space']) state.flyPos.y += moveSpeed * delta;
    if (state.keys['ShiftLeft'] || state.keys['ShiftRight']) state.flyPos.y -= moveSpeed * delta;
    if (state.flyPos.y < 1) state.flyPos.y = 1;

    buildCamera.position.copy(state.flyPos);
    var lookDir = new THREE.Vector3(
      -Math.sin(state.flyYaw) * Math.cos(state.flyPitch),
      Math.sin(state.flyPitch),
      -Math.cos(state.flyYaw) * Math.cos(state.flyPitch)
    );
    buildCamera.lookAt(state.flyPos.clone().add(lookDir));
    // pose يتنقل برّه كمان من animate عشان حتى لو مش طيران
  }

  function toggleFlyMode() {
    if (state.mode !== 'build') return;
    state.flyMode = !state.flyMode;
    if (state.flyMode) {
      if (flyIndicator) flyIndicator.style.display = 'block';
      state.mouseHidden = true;
      document.body.style.cursor = 'none';
      try { if (canvas.requestPointerLock) canvas.requestPointerLock(); } catch (e) {}
      try { state.flyPos.copy(buildCamera.position); } catch (e2) {}
    } else {
      if (flyIndicator) flyIndicator.style.display = 'none';
      // متقفلش الماوس إجباري — سيبه زي ما هو
    }
  }

  function openBuildPauseMenu() {
    // احفظ صامت
    try {
      if (state.currentLevelId && state.levels[state.currentLevelId] && state._levelSceneReady) {
        state.levels[state.currentLevelId].objects = serializeObjects();
        saveRespawnsFromMarkers();
        persistLevelsToStorage();
      }
    } catch (e) {}
    // حرر الماوس
    state.mouseHidden = false;
    document.body.style.cursor = 'default';
    try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
    var m = document.getElementById('build-pause-menu');
    if (m) m.classList.remove('hidden');
    state._buildPaused = true;
  }
  function closeBuildPauseMenu() {
    var m = document.getElementById('build-pause-menu');
    if (m) m.classList.add('hidden');
    state._buildPaused = false;
    // رجّع الـ UI
    try {
      var buildUi = document.getElementById('build-ui');
      if (buildUi) buildUi.classList.remove('hidden');
    } catch (e) {}
  }
  function toggleBuildPauseMenu() {
    var m = document.getElementById('build-pause-menu');
    if (m && !m.classList.contains('hidden')) closeBuildPauseMenu();
    else openBuildPauseMenu();
  }
  function openBuildSettings() {
    // أخفِ إعدادات الكاميرا في البناء
    try {
      var camBtn = document.getElementById('btn-cam-settings');
      var camBox = document.getElementById('cam-settings');
      if (camBtn) camBtn.classList.add('hidden');
      if (camBox) camBox.classList.add('hidden');
      state._settingsFromBuild = true;
    } catch (e) {}
    var sp = document.getElementById('settings-panel');
    if (sp) sp.classList.remove('hidden');
  }
  // ربط أزرار قائمة البناء
  (function wireBuildPause() {
    var r = document.getElementById('btn-build-pause-resume');
    var s = document.getElementById('btn-build-pause-settings');
    var x = document.getElementById('btn-build-pause-exit');
    if (r) r.onclick = function () { closeBuildPauseMenu(); };
    if (s) s.onclick = function () { openBuildSettings(); };
    if (x) x.onclick = function () {
      closeBuildPauseMenu();
      state.respawnPlaceMode = null;
      state.flyMode = false;
      var wasOnline = !!state.buildCollabOnline;
      state.buildCollabOnline = false;
      state.buildCollab = false;
      state._rtcPurpose = null;
      try { clearRemoteBuilders(); } catch (e2) {}
      try {
        var rh = document.getElementById('build-roster-hud');
        if (rh) rh.classList.add('hidden');
      } catch (e3) {}
      if (wasOnline) {
        try { restoreOfflineLevelsAfterOnlineBuild(); } catch (e4) {}
      }
      showScreen('menu');
    };
    var back = document.getElementById('btn-settings-back');
    if (back) {
      var prev = back.onclick;
      back.onclick = function () {
        var sp = document.getElementById('settings-panel');
        if (sp) sp.classList.add('hidden');
        // رجّع زر الكاميرا لو كنا من اللعب
        try {
          var camBtn = document.getElementById('btn-cam-settings');
          if (camBtn && !state._settingsFromBuild) camBtn.classList.remove('hidden');
          state._settingsFromBuild = false;
        } catch (e) {}
        if (typeof prev === 'function') try { prev(); } catch (e) {}
      };
    }
  })();

  // ===== GAMEPAD =====
  var prevXPressed = false;
  var prevOptionsPressed = false;
  var prevGpMenuNav = { up: false, down: false, left: false, right: false, confirm: false, back: false };

  function pollGamepad() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var pad = null;
    for (var i = 0; i < pads.length; i++) { if (pads[i]) { pad = pads[i]; break; } }
    if (!pad) return null;
    var xPressed = pad.buttons[0] && pad.buttons[0].pressed;
    if (state.mode === 'lobby' && xPressed && !prevXPressed && !state.player2Joined) joinPlayer2();
    prevXPressed = xPressed;
    var lx = pad.axes[0] || 0, ly = pad.axes[1] || 0, rx = pad.axes[2] || 0, dead = 0.2;
    // Buttons: 0=A/X, 1=B/Circle, 8=Share, 9=Options/Start (varies by pad)
    var optionsPressed = (pad.buttons[9] && pad.buttons[9].pressed) || (pad.buttons[8] && pad.buttons[8].pressed);
    var circlePressed = pad.buttons[1] && pad.buttons[1].pressed;
    // D-pad
    var dUp = pad.buttons[12] && pad.buttons[12].pressed;
    var dDown = pad.buttons[13] && pad.buttons[13].pressed;
    var dLeft = pad.buttons[14] && pad.buttons[14].pressed;
    var dRight = pad.buttons[15] && pad.buttons[15].pressed;

    // Options opens/closes pause for player 2 in split (or full in online if host uses pad - only P2)
    if (state.mode === 'play' && optionsPressed && !prevOptionsPressed) {
      if (state.paused && state.pauseOwner === 1) {
        closePause();
      } else if (!state.paused) {
        if (state.playType === 'split') openPause('right');
        else openPause('full');
        state.pauseOwner = state.playType === 'split' ? 1 : 0;
      }
    }
    prevOptionsPressed = optionsPressed;

    return {
      up: ly < -dead || dUp, down: ly > dead || dDown, left: lx < -dead || dLeft, right: lx > dead || dRight,
      jump: xPressed, run: circlePressed,
      lookX: Math.abs(rx) > dead ? rx : 0,
      options: optionsPressed, confirm: xPressed, back: circlePressed,
      dUp: dUp, dDown: dDown, dLeft: dLeft, dRight: dRight,
      stickY: ly, stickX: lx
    };
  }
  function joinPlayer2() {
    state.player2Joined = true;
    document.getElementById('player2-card').classList.add('ready');
    document.getElementById('player2-status').textContent = 'READY ✓';
    document.getElementById('player2-status').classList.add('online');
    document.getElementById('p2-avatar').textContent = '✅';
    btnStart.disabled = false; btnStart.textContent = 'START GAME';
    document.getElementById('gamepad-hint').textContent = 'اللاعب 2 انضم!';
  }

  // ===== LEVELS =====
  function generateLevelId() { return 'level_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function safeName(n) { return (n || 'level').replace(/[^\w\u0600-\u06FF\- ]+/g, '_').trim() || 'level'; }

  function clearBuildObjects() {
    state.buildObjects.forEach(function (o) { scene.remove(o); });
    state.buildObjects = [];
    // امسح محطات البنزين القديمة عشان أصواتها متتداخلش في عالم فاضي
    try {
      state.gasStations = [];
      state._bossVoiceQueue = [];
      state._bossVoicePlaying = false;
    } catch (eG) {}
    clearRespawnMarkers();
    var el = document.getElementById('object-count');
    if (el) el.textContent = '0 عنصر';
    if (typeof refreshHierarchy === 'function') refreshHierarchy();
  }

  // ===== RESPAWN MARKERS =====
  function clearRespawnMarkers() {
    (state.respawnMarkers || []).forEach(function (m) { scene.remove(m); });
    state.respawnMarkers = [];
  }

  function makeRespawnMarker(kind, index, pos) {
    var color = kind === 'lan' ? 0x30d158 : 0xff2d55;
    var g = new THREE.Group();
    var pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8),
      new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.35 })
    );
    pole.position.y = 0.8;
    g.add(pole);
    var flag = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.35, 0.04),
      new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.5 })
    );
    flag.position.set(0.3, 1.4, 0);
    g.add(flag);
    var base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.4, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: 0x222222 })
    );
    base.position.y = 0.06;
    g.add(base);
    // number disc
    var disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.22, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    disc.position.set(0, 1.85, 0.02);
    disc.rotation.x = -0.3;
    g.add(disc);
    g.position.set(pos.x, (pos.y != null && isFinite(pos.y)) ? pos.y : 0, pos.z);
    g.userData.isRespawn = true;
    g.userData.respawnKind = kind;
    g.userData.respawnIndex = index;
    return g;
  }

  function ensureLevelRespawns(level) {
    if (!level.respawns) level.respawns = { lan: [], split: [] };
    if (!level.respawns.lan) level.respawns.lan = [];
    if (!level.respawns.split) level.respawns.split = [];
    return level.respawns;
  }

  function loadRespawnMarkers(levelId) {
    clearRespawnMarkers();
    var level = state.levels[levelId];
    if (!level) return;
    var r = ensureLevelRespawns(level);
    (r.lan || []).forEach(function (p, i) {
      var m = makeRespawnMarker('lan', i, p);
      scene.add(m);
      state.respawnMarkers.push(m);
    });
    (r.split || []).forEach(function (p, i) {
      var m = makeRespawnMarker('split', i, p);
      scene.add(m);
      state.respawnMarkers.push(m);
    });
    updateRespawnHint();
  }

  function serializeRespawns() {
    if (!state.currentLevelId || !state.levels[state.currentLevelId]) return { lan: [], split: [] };
    return ensureLevelRespawns(state.levels[state.currentLevelId]);
  }

  function saveRespawnsFromMarkers() {
    if (!state.currentLevelId || !state.levels[state.currentLevelId]) return;
    var lan = [];
    var split = [];
    (state.respawnMarkers || []).forEach(function (m) {
      var p = { x: m.position.x, y: m.position.y || 0, z: m.position.z };
      if (m.userData.respawnKind === 'lan') lan.push(p);
      else if (m.userData.respawnKind === 'split') split.push(p);
    });
    state.levels[state.currentLevelId].respawns = { lan: lan, split: split };
  }

  function updateRespawnHint() {
    var el = document.getElementById('respawn-mode-hint');
    if (!el) return;
    var mode = state.respawnPlaceMode;
    if (!mode) {
      el.textContent = 'اختر الوضع ثم اضغط على الأرض لوضع النقاط';
      return;
    }
    var r = state.currentLevelId && state.levels[state.currentLevelId]
      ? ensureLevelRespawns(state.levels[state.currentLevelId])
      : { lan: [], split: [] };
    // count from markers for live accuracy
    var lanCount = 0, splitCount = 0;
    (state.respawnMarkers || []).forEach(function (m) {
      if (m.userData.respawnKind === 'lan') lanCount++;
      else if (m.userData.respawnKind === 'split') splitCount++;
    });
    if (mode === 'lan') {
      el.textContent = 'وضع LAN (أخضر) — ' + lanCount + ' / 8 — اضغط على الأرض للوضع، أو على نقطة لحذفها';
    } else {
      el.textContent = 'وضع Split (أحمر) — ' + splitCount + ' / 2 — اضغط على الأرض للوضع، أو على نقطة لحذفها';
    }
  }

  function placeRespawnAt(point) {
    if (!state.respawnPlaceMode || !state.currentLevelId) {
      toast('أنشئ لفل أولاً', 'error');
      return;
    }
    var kind = state.respawnPlaceMode;
    var max = kind === 'lan' ? 8 : 2;
    var count = 0;
    (state.respawnMarkers || []).forEach(function (m) {
      if (m.userData.respawnKind === kind) count++;
    });
    if (count >= max) {
      toast(kind === 'lan' ? 'وصلت لحد 8 أماكن LAN' : 'وصلت لحد مكانين Split', 'error');
      return;
    }
    var m = makeRespawnMarker(kind, count, point);
    scene.add(m);
    state.respawnMarkers.push(m);
    saveRespawnsFromMarkers();
    updateRespawnHint();
    toast('تم وضع ريسبون ' + (kind === 'lan' ? 'LAN' : 'Split') + ' (' + (count + 1) + '/' + max + ')', 'success');
  }

  function removeRespawnMarker(mesh) {
    scene.remove(mesh);
    state.respawnMarkers = state.respawnMarkers.filter(function (m) { return m !== mesh; });
    // re-index
    var lanI = 0, splitI = 0;
    state.respawnMarkers.forEach(function (m) {
      if (m.userData.respawnKind === 'lan') m.userData.respawnIndex = lanI++;
      else m.userData.respawnIndex = splitI++;
    });
    saveRespawnsFromMarkers();
    updateRespawnHint();
    toast('تم حذف نقطة الريسبون', 'info');
  }

  function loadLevelIntoScene(levelId) {
    clearBuildObjects();
    var level = state.levels[levelId];
    if (!level) { state._levelSceneReady = false; return; }
    ensureLevelRespawns(level);
    if (!Array.isArray(level.objects)) level.objects = [];
    (level.objects || []).forEach(function (o) {
      var item = findCatalogItem(o.id);
      var mesh;
      if (o.onTable && (o.id === 'wpn_pistol' || o.id === 'wpn_smg' || o.isWeapon)) {
        var kind = (o.id === 'wpn_smg' || o.weaponKind === 'smg') ? 'smg' : 'pistol';
        mesh = makeWeaponPickup(kind, kind === 'smg' ? 0x334155 : 0x1e293b, kind === 'smg' ? 0x22d3ee : 0xfbbf24, { onTable: true });
      } else {
        mesh = (item && item.factory) ? item.factory() : makeSimpleBlock([1, 1, 1], 0x888);
      }
      var py = (o.position && o.position.y != null) ? o.position.y : 0;
      mesh.position.set(
        (o.position && o.position.x != null) ? o.position.x : 0,
        py,
        (o.position && o.position.z != null) ? o.position.z : 0
      );
      if (o.rotation) {
        if (o.rotation.x != null) mesh.rotation.x = o.rotation.x;
        if (o.rotation.y != null) mesh.rotation.y = o.rotation.y;
        if (o.rotation.z != null) mesh.rotation.z = o.rotation.z;
      }
      if (o.scale) {
        mesh.scale.set(
          o.scale.x != null ? o.scale.x : 1,
          o.scale.y != null ? o.scale.y : 1,
          o.scale.z != null ? o.scale.z : 1
        );
      }
      mesh.visible = true;
      mesh.userData.buildId = o.id;
      mesh.userData.catalogItem = item || { id: o.id };
      mesh.userData.instanceName = o.name || (item ? item.name : o.id);
      if (o.injected) mesh.userData.injected = o.injected;
      if (o.isVehicle) mesh.userData.isVehicle = true;
      if (o.fuelInfinite != null) mesh.userData.fuelInfinite = !!o.fuelInfinite;
      if (o.fuel != null) mesh.userData.fuel = o.fuel;
      if (o.fuelConsume) mesh.userData.fuelConsume = o.fuelConsume;
      if (o.driveMode) mesh.userData.driveMode = o.driveMode;
      if (o.interactive) mesh.userData.interactive = true;
      if (o.interactiveType) mesh.userData.interactiveType = o.interactiveType;
      if (o.isVehicle) {
        mesh.userData.engineOn = false;
        mesh.userData.seats = { driver: null, passenger: null };
      }
      if (o.carInject) mesh.userData.carInject = o.carInject;
      if (o.isPhysProp) mesh.userData.isPhysProp = true;
      if (o.physMode) mesh.userData.physMode = o.physMode;
      if (o.isDummy) mesh.userData.isDummy = true;
      if (o.isWeapon) { mesh.userData.isWeapon = true; mesh.userData.onGround = true; mesh.userData.onTable = !!o.onTable; }
      if (o.weaponKind) mesh.userData.weaponKind = o.weaponKind;
      if (o.isGasStation) {
        mesh.userData.isGasStation = true;
        state.gasStations = state.gasStations || [];
        state.gasStations.push(mesh);
      }
      if (o.isGarage) mesh.userData.isGarage = true;
      if (mesh.userData.isPhysProp) mesh.userData.homePos = mesh.position.clone();
      // مفتاح شبكة ثابت من الشامل — عشان التعديل يتزامن
      if (o._netBuildKey) mesh.userData._netBuildKey = o._netBuildKey;
      else {
        var stable = 'pack_' + (levelId || 'lv') + '_' + (o.name || o.id || 'o') + '_' +
          Math.round((o.position && o.position.x || 0) * 10) + '_' +
          Math.round((o.position && o.position.y || 0) * 10) + '_' +
          Math.round((o.position && o.position.z || 0) * 10);
        mesh.userData._netBuildKey = stable;
      }
      scene.add(mesh);
      state.buildObjects.push(mesh);
    });
    loadRespawnMarkers(levelId);
    var el = document.getElementById('object-count');
    if (el) el.textContent = state.buildObjects.length + ' عنصر';
    if (typeof refreshHierarchy === 'function') refreshHierarchy();
    state._levelSceneReady = true;
    state.currentLevelId = levelId;
  }

  function serializeObjects() {
    return state.buildObjects.map(function (obj) {
      return {
        id: obj.userData.buildId,
        name: obj.userData.instanceName || obj.userData.buildId,
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
        scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
        injected: obj.userData.injected || null,
        isVehicle: !!obj.userData.isVehicle,
        fuelInfinite: obj.userData.fuelInfinite,
        fuel: obj.userData.fuel,
        fuelConsume: obj.userData.fuelConsume,
        driveMode: obj.userData.driveMode,
        interactive: !!obj.userData.interactive,
        interactiveType: obj.userData.interactiveType || null,
        carInject: obj.userData.carInject || null,
        isPhysProp: !!obj.userData.isPhysProp,
        physMode: obj.userData.physMode || null,
        isDummy: !!obj.userData.isDummy,
        isWeapon: !!obj.userData.isWeapon,
        onTable: !!obj.userData.onTable,
        weaponKind: obj.userData.weaponKind || null,
        weaponKind: obj.userData.weaponKind || null,
        isGasStation: !!obj.userData.isGasStation,
        isGarage: !!obj.userData.isGarage,
        _netBuildKey: obj.userData._netBuildKey || null
      };
    });
  }

  var _autoSaveTimer = null;
  var _autoSaveBusy = false;

  function persistLevelsToStorage() {
    if (state.buildCollabOnline) return true; // لا تربط أونلاين بأوفلاين
    try {
      // نسخة خفيفة للحفظ: تأكد objects مصفوفة
      var levelsCopy = {};
      Object.keys(state.levels || {}).forEach(function (id) {
        var lv = state.levels[id] || {};
        levelsCopy[id] = {
          name: lv.name || id,
          objects: Array.isArray(lv.objects) ? lv.objects : [],
          scripts: lv.scripts || [],
          sounds: lv.sounds || [],
          music: lv.music || [],
          images: lv.images || [],
          respawns: lv.respawns || { lan: [], split: [] },
          createdAt: lv.createdAt,
          updatedAt: lv.updatedAt || Date.now()
        };
      });
      var data = {
        levels: levelsCopy,
        currentLevelId: state.currentLevelId,
        savedAt: Date.now()
      };
      localStorage.setItem('sm_levels_v1', JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('persistLevels', e);
      try {
        // محاولة ثانية بدون music/sounds الثقيلة
        var light = {};
        Object.keys(state.levels || {}).forEach(function (id) {
          var lv = state.levels[id] || {};
          light[id] = {
            name: lv.name,
            objects: lv.objects || [],
            scripts: (lv.scripts || []).map(function (s) { return { name: s.name, content: s.content }; }),
            sounds: [],
            music: [],
            images: [],
            respawns: lv.respawns || { lan: [], split: [] }
          };
        });
        localStorage.setItem('sm_levels_v1', JSON.stringify({ levels: light, currentLevelId: state.currentLevelId, savedAt: Date.now() }));
        toast('تم الحفظ بدون ملفات صوت/صور كبيرة (مساحة المتصفح ممتلئة)', 'info');
        return true;
      } catch (e2) {
        toast('فشل حفظ اللفل محليًا — مساحة المتصفح قد تكون ممتلئة', 'error');
        return false;
      }
    }
  }

  function loadLevelsFromStorage() {
    try {
      var raw = localStorage.getItem('sm_levels_v1');
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || !data.levels) return false;
      // طبّع كل لفل
      Object.keys(data.levels).forEach(function (id) {
        var lv = data.levels[id];
        if (!lv) return;
        if (!Array.isArray(lv.objects)) lv.objects = [];
        if (!lv.respawns) lv.respawns = { lan: [], split: [] };
        if (!lv.scripts) lv.scripts = [];
      });
      state.levels = data.levels;
      if (data.currentLevelId && state.levels[data.currentLevelId]) {
        state.currentLevelId = data.currentLevelId;
      } else {
        var ids = Object.keys(state.levels);
        if (ids.length) state.currentLevelId = ids[0];
      }
      state._levelSceneReady = false;
      return true;
    } catch (e) {
      console.warn('loadLevels', e);
      return false;
    }
  }

  // حفظ فوري صامت (من غير توست كل ثانية)
  function saveCurrentLevelSilent() {
    // البناء الأونلاين منفصل تمامًا عن حفظ الأوفلاين
    if (state.buildCollabOnline) return;
    if (!state.currentLevelId || !state.levels[state.currentLevelId]) return;
    if (!state._levelSceneReady && state.mode === 'build') {
      return;
    }
    try {
      var objs = serializeObjects();
      var prev = state.levels[state.currentLevelId].objects || [];
      // حماية: لو فجأة صفر كائنات والمخزون فيه كائنات — متكتبش إلا لو المستخدم مسح عن قصد
      if (objs.length === 0 && prev.length > 0 && !state._allowEmptySave) {
        if (!(state._levelSceneReady && state.mode === 'build' && state.buildObjects.length === 0)) {
          return;
        }
      }
      state.levels[state.currentLevelId].objects = objs;
      saveRespawnsFromMarkers();
      state.levels[state.currentLevelId].updatedAt = Date.now();
      persistLevelsToStorage();
      // أي شغل جديد (حتى بعد «ابدأ من جديد») يبقى هو اللي هيتكمّل عليه بعد قفل الموقع
      if (objs.length > 0) state._allowEmptySave = false;
    } catch (e) {
      console.warn('auto-save', e);
    }
  }

  // بعد أي تعديل في البناء — يحفظ خلال لحظات
  function scheduleAutoSave() {
    if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(function () {
      _autoSaveTimer = null;
      saveCurrentLevelSilent();
    }, 280);
  }

  function saveCurrentLevel() {
    if (!state.currentLevelId) { toast('أنشئ لفل أولاً', 'error'); return; }
    state.levels[state.currentLevelId].objects = serializeObjects();
    saveRespawnsFromMarkers();
    state.levels[state.currentLevelId].updatedAt = Date.now();
    persistLevelsToStorage();
    renderLevelsList(); updateLobbyLevelSelect();
    toast('تم حفظ: ' + state.levels[state.currentLevelId].name, 'success');
  }

  function createNewLevel() {
    askName('اسم اللفل:', 'لفل ' + (Object.keys(state.levels).length + 1), function (name) {
      if (!name) return;
      // SAVE current level objects before switching away
      if (state.currentLevelId && state.levels[state.currentLevelId]) {
        state.levels[state.currentLevelId].objects = serializeObjects();
        saveRespawnsFromMarkers();
      }
      var id = generateLevelId();
      state.levels[id] = { name: name, objects: [], scripts: [], sounds: [], respawns: { lan: [], split: [] }, createdAt: Date.now() };
      state.currentLevelId = id;
      clearBuildObjects();
      document.getElementById('current-level-label').textContent = name;
      updateAssetsInfo(); renderLevelsList(); updateLobbyLevelSelect();
      toast('تم إنشاء: ' + name, 'success');
    });
  }

  function switchToLevel(id) {
    // احفظ الحالي فقط لو المشهد متحمّل (منع مسح اللفل عند الفتح)
    if (state._levelSceneReady && state.currentLevelId && state.levels[state.currentLevelId]) {
      state.levels[state.currentLevelId].objects = serializeObjects();
      saveRespawnsFromMarkers();
      persistLevelsToStorage();
    }
    state.currentLevelId = id;
    state._levelSceneReady = false;
    loadLevelIntoScene(id);
    document.getElementById('current-level-label').textContent = state.levels[id] ? state.levels[id].name : id;
    updateAssetsInfo(); renderLevelsList();
  }

  function deleteLevel(id, e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (e && e.preventDefault) e.preventDefault();
    var lv = state.levels[id];
    var lvName = (lv && lv.name) ? lv.name : id;
    showChoiceModal(
      '⚠️ تأكيد الحذف\nهل أنت متأكد إنك عايز تحذف اللفل «' + lvName + '»؟\nالعملية دي مينفعش تترجع.',
      [
        { id: 'yes', label: 'نعم، احذف اللفل', danger: true },
        { id: 'no', label: 'إلغاء' }
      ],
      function (choice) {
        if (choice !== 'yes') return;
        delete state.levels[id];
        if (state.currentLevelId === id) {
          state.currentLevelId = null;
          try { clearBuildObjects(); } catch (e2) {}
          var lbl = document.getElementById('current-level-label');
          if (lbl) lbl.textContent = '—';
          try { updateAssetsInfo(); } catch (e3) {}
        }
        try { persistLevelsToStorage(); } catch (e4) {}
        renderLevelsList();
        try { updateLobbyLevelSelect(); } catch (e5) {}
        toast('تم حذف اللفل: ' + lvName, 'info');
      }
    );
  }

  function renderLevelsList() {
    var list = document.getElementById('levels-list');
    if (!list) return;
    list.innerHTML = '';
    var ids = Object.keys(state.levels);
    if (!ids.length) { list.innerHTML = '<div style="color:#8e9aaf;font-size:0.82rem;padding:8px">لا توجد لفلز</div>'; return; }
    ids.forEach(function (id) {
      var lv = state.levels[id];
      var el = document.createElement('div');
      el.className = 'level-item' + (id === state.currentLevelId ? ' active' : '');
      var sc = '';
      if (lv.scripts && lv.scripts.length) sc += ' 📜' + lv.scripts.length;
      if (lv.sounds && lv.sounds.length) sc += ' 🔊' + lv.sounds.length;
      el.innerHTML = '<span>' + lv.name + ' (' + (lv.objects ? lv.objects.length : 0) + ')' + sc + '</span>';
      var del = document.createElement('button'); del.className = 'del-btn'; del.textContent = '✕';
      del.onclick = function (e) { deleteLevel(id, e); };
      el.appendChild(del);
      el.onclick = function () { switchToLevel(id); };
      list.appendChild(el);
    });
  }

  function updateLobbyLevelSelect() {
    var sel = document.getElementById('lobby-level-select');
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">عالم فارغ</option>';
    Object.keys(state.levels).forEach(function (id) {
      var opt = document.createElement('option'); opt.value = id; opt.textContent = state.levels[id].name; sel.appendChild(opt);
    });
    if (cur && state.levels[cur]) sel.value = cur;
  }

  function updateAssetsInfo() {
    var el = document.getElementById('scripts-info');
    if (!el) return;
    if (!state.currentLevelId || !state.levels[state.currentLevelId]) { el.textContent = ''; return; }
    var lv = state.levels[state.currentLevelId];
    var parts = [];
    if (lv.scripts && lv.scripts.length) parts.push('برمجات: ' + lv.scripts.length);
    if (lv.sounds && lv.sounds.length) parts.push('أصوات: ' + lv.sounds.length);
    el.textContent = parts.join(' | ');
  }

  // ===== ZIP DOWNLOAD =====
  function downloadAllAsZip() {
    if (typeof JSZip === 'undefined') { toast('JSZip غير متوفر', 'error'); return; }
    // Auto-save current
    if (state.currentLevelId) {
      state.levels[state.currentLevelId].objects = serializeObjects();
      saveRespawnsFromMarkers();
    }

    var levelIds = Object.keys(state.levels);
    if (!levelIds.length) { toast('لا توجد لفلز للحفظ', 'error'); return; }

    showSyncLoading('جاري تجهيز ملف الشامل (ضغط عالي)...');

    try {
      var zip = new JSZip();
      var levelsFolder = zip.folder('levels');
      // مجلد فهرس فقط — بدون تكرار الملفات (كان بيضاعف الحجم)
      var globalFolder = zip.folder('الشامل');
      var indexLines = ['# ملف الشامل — فهرس المستويات', '# البيانات الفعلية في مجلد levels/ فقط', ''];
      var totalBytesEst = 0;

      levelIds.forEach(function (id) {
        var lv = state.levels[id];
        var folderName = safeName(lv.name) + '_' + id.slice(-4);
        var lf = levelsFolder.folder(folderName);
        var buildF = lf.folder('البناء');
        var soundsF = lf.folder('الاصوات');
        var scriptsF = lf.folder('البرمجيات');
        var musicF = lf.folder('الاغاني');
        var imagesF = lf.folder('الصور');

        // Build data — JSON مضغوط (من غير مسافات) لتقليل الحجم
        var resp = ensureLevelRespawns(lv);
        var buildObj = {
          levelId: id,
          name: lv.name,
          objects: lv.objects || [],
          respawns: { lan: resp.lan || [], split: resp.split || [] }
        };
        var buildData = JSON.stringify(buildObj);
        buildF.file('build.json', buildData);
        totalBytesEst += buildData.length;

        // Scripts
        (lv.scripts || []).forEach(function (s) {
          var content = s.content || '';
          scriptsF.file(s.name, content);
          totalBytesEst += content.length;
        });

        // Sounds (data URLs) — مرة واحدة فقط
        (lv.sounds || []).forEach(function (s) {
          if (s && s.dataUrl) {
            var base64 = s.dataUrl.split(',')[1] || '';
            if (base64) {
              soundsF.file(s.name, base64, { base64: true });
              totalBytesEst += base64.length * 0.75;
            }
          }
        });

        // Music — مرة واحدة فقط
        (lv.music || []).forEach(function (s) {
          if (s && s.dataUrl) {
            var base64 = s.dataUrl.split(',')[1] || '';
            if (base64) {
              musicF.file(s.name, base64, { base64: true });
              totalBytesEst += base64.length * 0.75;
            }
          }
        });

        // Images — مرة واحدة فقط
        (lv.images || []).forEach(function (s) {
          if (s && s.dataUrl) {
            var base64 = s.dataUrl.split(',')[1] || '';
            if (base64) {
              imagesF.file(s.name, base64, { base64: true });
              totalBytesEst += base64.length * 0.75;
            }
          }
        });

        indexLines.push(
          '- ' + folderName +
          ' | عناصر:' + ((lv.objects || []).length) +
          ' | سكربت:' + ((lv.scripts || []).length) +
          ' | صوت:' + ((lv.sounds || []).length) +
          ' | أغاني:' + ((lv.music || []).length) +
          ' | صور:' + ((lv.images || []).length)
        );
      });

      globalFolder.file('فهرس.txt', indexLines.join('\n'));

      // Manifest مضغوط
      zip.file('manifest.json', JSON.stringify({
        version: 6,
        exportedAt: new Date().toISOString(),
        compressed: true,
        levels: levelIds.map(function (id) {
          var lv = state.levels[id];
          return {
            id: id,
            name: lv.name,
            objects: (lv.objects || []).length,
            scripts: (lv.scripts || []).length,
            sounds: (lv.sounds || []).length,
            music: (lv.music || []).length,
            images: (lv.images || []).length,
            respawns: {
              lan: ((lv.respawns && lv.respawns.lan) || []).length,
              split: ((lv.respawns && lv.respawns.split) || []).length
            }
          };
        })
      }));

      // أقصى ضغط DEFLATE
      zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
      })
        .then(function (blob) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'story_mode_data_' + Date.now() + '.zip';
          a.click();
          URL.revokeObjectURL(a.href);
          hideSyncLoading();
          var mb = (blob.size / (1024 * 1024)).toFixed(2);
          toast('تم تحميل ملف الشامل — ' + mb + ' ميجا (بدون تكرار + ضغط 9)', 'success');
        })
        .catch(function (err) {
          console.error(err);
          hideSyncLoading();
          toast('فشل إنشاء ملف ZIP: ' + (err && err.message ? err.message : 'خطأ'), 'error');
        });
    } catch (err) {
      console.error(err);
      hideSyncLoading();
      toast('خطأ في تحضير التحميل: ' + (err && err.message ? err.message : 'خطأ'), 'error');
    }
  }

  // ===== ZIP UPLOAD (comprehensive) =====
  function processZipArrayBuffer(arrayBuffer, onDone) {
    if (typeof JSZip === 'undefined') { toast('JSZip غير متوفر', 'error'); if (onDone) onDone(false, 0); return; }
    JSZip.loadAsync(arrayBuffer).then(function (zip) {
        var promises = [];
        var levelMap = {}; // folderName -> { id, name, objects, scripts, sounds }

        zip.forEach(function (relativePath, zipEntry) {
          if (zipEntry.dir) return;
          var parts = relativePath.replace(/\\/g, '/').split('/');

          // levels/LevelName/البناء/build.json
          // levels/LevelName/البرمجيات/file.js
          // levels/LevelName/الاصوات/file.mp3
          if (parts[0] === 'levels' && parts.length >= 3) {
            var levelFolder = parts[1];
            if (!levelMap[levelFolder]) {
              levelMap[levelFolder] = { name: levelFolder.replace(/_level_.*$/, '').replace(/_[a-z0-9]+$/, '') || levelFolder, objects: [], scripts: [], sounds: [], music: [], images: [], respawns: { lan: [], split: [] } };
            }
            var sub = parts[2];
            var fileName = parts.slice(3).join('/') || parts[parts.length - 1];

            if (sub === 'البناء' || sub === 'build') {
              if (fileName.endsWith('.json')) {
                promises.push(zipEntry.async('string').then(function (text) {
                  try {
                    var data = JSON.parse(text);
                    if (data.objects) levelMap[levelFolder].objects = data.objects;
                    if (data.name) levelMap[levelFolder].name = data.name;
                    if (data.levelId) levelMap[levelFolder].id = data.levelId;
                    if (data.respawns) levelMap[levelFolder].respawns = data.respawns;
                  } catch (err) { console.warn(err); }
                }));
              }
            } else if (sub === 'البرمجيات' || sub === 'scripts') {
              promises.push(zipEntry.async('string').then(function (text) {
                levelMap[levelFolder].scripts.push({ name: fileName, content: text });
              }));
            } else if (sub === 'الاصوات' || sub === 'sounds') {
              promises.push(zipEntry.async('base64').then(function (b64) {
                var ext = fileName.split('.').pop().toLowerCase();
                var mime = ext === 'wav' ? 'audio/wav' : ext === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
                levelMap[levelFolder].sounds.push({ name: fileName, dataUrl: 'data:' + mime + ';base64,' + b64, type: mime });
              }));
            } else if (sub === 'الاغاني' || sub === 'music') {
              promises.push(zipEntry.async('base64').then(function (b64) {
                var ext = fileName.split('.').pop().toLowerCase();
                var mime = ext === 'wav' ? 'audio/wav' : ext === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
                levelMap[levelFolder].music.push({ name: fileName, dataUrl: 'data:' + mime + ';base64,' + b64, type: mime });
              }));
            } else if (sub === 'الصور' || sub === 'images') {
              promises.push(zipEntry.async('base64').then(function (b64) {
                var ext = fileName.split('.').pop().toLowerCase();
                var mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
                levelMap[levelFolder].images.push({ name: fileName, dataUrl: 'data:' + mime + ';base64,' + b64, type: mime });
              }));
            }
          }
        });

        Promise.all(promises).then(function () {
          var count = 0;
          Object.keys(levelMap).forEach(function (folder) {
            var data = levelMap[folder];
            var id = data.id || generateLevelId();
            // Merge if exists by name
            var existingId = null;
            Object.keys(state.levels).forEach(function (lid) {
              if (state.levels[lid].name === data.name) existingId = lid;
            });
            if (existingId) id = existingId;

            state.levels[id] = {
              name: data.name,
              objects: data.objects || (state.levels[id] && state.levels[id].objects) || [],
              scripts: data.scripts.length ? data.scripts : (state.levels[id] && state.levels[id].scripts) || [],
              sounds: data.sounds.length ? data.sounds : (state.levels[id] && state.levels[id].sounds) || [],
              music: (data.music && data.music.length) ? data.music : (state.levels[id] && state.levels[id].music) || [],
              images: (data.images && data.images.length) ? data.images : (state.levels[id] && state.levels[id].images) || [],
              respawns: data.respawns || (state.levels[id] && state.levels[id].respawns) || { lan: [], split: [] },
              createdAt: Date.now()
            };
            count++;
          });
          renderLevelsList();
          updateLobbyLevelSelect();
          if (count > 0) {
            // Prefer a level that actually has objects
            var bestId = null;
            Object.keys(state.levels).forEach(function (lid) {
              var lv = state.levels[lid];
              if (lv.objects && lv.objects.length && !bestId) bestId = lid;
            });
            if (!bestId) bestId = Object.keys(state.levels)[0];
            state.currentLevelId = bestId;
            loadLevelIntoScene(bestId);
            var lbl = document.getElementById('current-level-label');
            if (lbl) lbl.textContent = state.levels[bestId].name;
            updateAssetsInfo();
            if (typeof refreshHierarchy === 'function') refreshHierarchy();
          }
          toast('تم رفع ' + count + ' لفل', 'success');
          if (onDone) onDone(true, count);
        }).catch(function (err) {
          console.error(err);
          toast('خطأ في معالجة البيانات', 'error');
          if (onDone) onDone(false, 0);
        });
    }).catch(function (err) {
      console.error(err);
      toast('خطأ في قراءة ملف ZIP', 'error');
      if (onDone) onDone(false, 0);
    });
  }

  function uploadComprehensiveZip(file, onDone) {
    if (!file) { if (onDone) onDone(false, 0); return; }
    showSyncLoading('جاري رفع الملف الشامل... انتظر حتى يكتمل');
    var reader = new FileReader();
    reader.onload = function (e) {
      processZipArrayBuffer(e.target.result, function (ok, count) {
        hideSyncLoading();
        if (onDone) onDone(ok, count);
      });
    };
    reader.onerror = function () {
      hideSyncLoading();
      toast('فشل قراءة الملف', 'error');
      if (onDone) onDone(false, 0);
    };
    reader.readAsArrayBuffer(file);
  }

  // Load pack ZIP from same folder as index.html (works local server + GitHub Pages)
  // User types name without .zip — we try name.zip then name
  function normalizePackName(name) {
    name = (name || '').trim();
    if (!name) return '';
    name = name.replace(/\\/g, '/');
    // strip path, keep basename
    if (name.indexOf('/') !== -1) name = name.split('/').pop();
    if (/\.zip$/i.test(name)) name = name.replace(/\.zip$/i, '');
    return name;
  }

  function loadPackByName(packName, onDone) {
    var base = normalizePackName(packName);
    if (!base) {
      toast('اكتب اسم النسخة', 'error');
      if (onDone) onDone(false, 0);
      return;
    }
    // Relative to the page URL (GitHub Pages friendly)
    var candidates = [
      base + '.zip',
      base,
      encodeURIComponent(base) + '.zip',
      encodeURIComponent(base)
    ];
    // unique
    candidates = candidates.filter(function (v, i, a) { return a.indexOf(v) === i; });

    function tryNext(i) {
      if (i >= candidates.length) {
        toast('لم يُعثر على الملف: ' + base + '.zip بجانب index', 'error');
        if (onDone) onDone(false, 0);
        return;
      }
      var url = candidates[i];
      fetch(url, { cache: 'no-cache' }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      }).then(function (buf) {
        processZipArrayBuffer(buf, onDone);
      }).catch(function () {
        tryNext(i + 1);
      });
    }
    tryNext(0);
  }

  // ===== BUILD =====
  var raycaster = new THREE.Raycaster();
  var mouse = new THREE.Vector2();
  var ghostMesh = null;

  function getSectionCats(sec) {
    var s = CATALOG_SECTIONS[sec || state.catalogSection] || CATALOG_SECTIONS.static;
    return s.cats || [];
  }

  function updateCatalogHeader() {
    var sec = CATALOG_SECTIONS[state.catalogSection] || CATALOG_SECTIONS.static;
    var secLabel = document.getElementById('catalog-section-label');
    var subLabel = document.getElementById('catalog-sub-label');
    var back = document.getElementById('catalog-back');
    if (secLabel) secLabel.textContent = sec.label;
    if (state.catalogView === 'items') {
      var cat = getSectionCats().find(function (c) { return c.id === state.currentCategory; });
      if (subLabel) {
        subLabel.textContent = cat ? (cat.icon + ' ' + cat.name) : state.currentCategory;
        subLabel.classList.remove('hidden');
      }
      if (back) back.classList.remove('hidden');
    } else {
      if (subLabel) { subLabel.textContent = ''; subLabel.classList.add('hidden'); }
      if (back) back.classList.add('hidden');
    }
  }

  function renderCatalogCategories() {
    var box = document.getElementById('catalog-categories');
    var sidebar = document.getElementById('build-sidebar');
    if (!box) return;
    box.classList.remove('hidden');
    if (sidebar) { sidebar.classList.add('hidden'); sidebar.innerHTML = ''; }
    box.innerHTML = '';
    state.catalogView = 'categories';
    updateCatalogHeader();
    getSectionCats().forEach(function (cat) {
      var count = (buildCatalog[cat.id] || []).length;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'catalog-cat-btn';
      btn.innerHTML =
        '<span class="cat-ico">' + cat.icon + '</span>' +
        '<span class="cat-meta"><span class="cat-name">' + cat.name + '</span>' +
        '<span class="cat-count">' + count + ' عنصر</span></span>' +
        '<span class="cat-arrow">‹</span>';
      btn.onclick = function () {
        state.currentCategory = cat.id;
        state.catalogView = 'items';
        var search = document.getElementById('build-search');
        populateSidebar(search ? search.value : '');
      };
      box.appendChild(btn);
    });
  }

  function populateSidebar(filter) {
    var sidebar = document.getElementById('build-sidebar');
    var catsBox = document.getElementById('catalog-categories');
    if (!sidebar) return;
    filter = (filter || '').trim().toLowerCase();

    // بحث عام: اعرض نتائج مباشرة
    if (filter) {
      state.catalogView = 'items';
      if (catsBox) catsBox.classList.add('hidden');
      sidebar.classList.remove('hidden');
      updateCatalogHeader();
      sidebar.innerHTML = '';
      var items = [];
      var secCats = getSectionCats().map(function (c) { return c.id; });
      secCats.forEach(function (cid) {
        (buildCatalog[cid] || []).forEach(function (item) {
          if (item.name.toLowerCase().indexOf(filter) !== -1 || item.id.toLowerCase().indexOf(filter) !== -1) {
            items.push(item);
          }
        });
      });
      items.forEach(function (item) {
        var el = document.createElement('div');
        el.className = 'build-item' + (state.selectedItem && state.selectedItem.id === item.id ? ' selected' : '');
        el.innerHTML = '<div class="icon">' + item.icon + '</div><div>' + item.name + '</div>';
        el.onclick = function () {
          selectCatalogItem(item);
          populateSidebar(filter);
        };
        sidebar.appendChild(el);
      });
      if (!items.length) {
        sidebar.innerHTML = '<div style="grid-column:1/-1;color:#8e9aaf;font-size:0.85rem;padding:12px;text-align:center">لا نتائج</div>';
      }
      return;
    }

    // بدون بحث: لو لسه في مستوى الأقسام
    if (state.catalogView !== 'items') {
      renderCatalogCategories();
      return;
    }

    if (catsBox) catsBox.classList.add('hidden');
    sidebar.classList.remove('hidden');
    updateCatalogHeader();
    sidebar.innerHTML = '';
    var list = buildCatalog[state.currentCategory] || [];
    list.forEach(function (item) {
      var el = document.createElement('div');
      el.className = 'build-item' + (state.selectedItem && state.selectedItem.id === item.id ? ' selected' : '');
      el.innerHTML = '<div class="icon">' + item.icon + '</div><div>' + item.name + '</div>';
      el.onclick = function () {
        selectCatalogItem(item);
        populateSidebar('');
      };
      sidebar.appendChild(el);
    });
    if (!list.length) {
      sidebar.innerHTML = '<div style="grid-column:1/-1;color:#8e9aaf;font-size:0.85rem;padding:12px;text-align:center">لا عناصر</div>';
    }
  }


  function selectCatalogItem(item) {
    if (!item) return;
    // عربيات: اختيارات بنزين أولاً
    var isCar = false;
    try {
      if (item.id && (String(item.id).indexOf('car') >= 0 || String(item.id).indexOf('ix_car') === 0)) isCar = true;
      if (item.id === 'ix_phone') {
        showChoiceModal('وضع التليفون', [
          { id: 'table', label: 'على طاولة' },
          { id: 'plain', label: 'من غير طاولة' }
        ], function (choice) {
          item._phoneOnTable = choice === 'table';
          armPlaceTool(item, 'اضغط في المشهد لوضع التليفون');
        });
        return;
      }
      if (state.currentCategory === 'ix_vehicles' || state.currentCategory === 'vehicles') isCar = true;
    } catch (e) {}
    if (isCar) {
      openCarFuelModal(item);
      return;
    }
    var isGas = false;
    try {
      if (item.id === 'ix_gas' || item.id === 'gas' || (item.name && String(item.name).indexOf('بنزين') >= 0)) isGas = true;
      if (state.currentCategory === 'ix_buildings' && item.id && String(item.id).indexOf('gas') >= 0) isGas = true;
    } catch (eG) {}
    if (isGas) {
      if (typeof openGasPlaceModal === 'function') openGasPlaceModal(item);
      else {
        state.selectedItem = item;
        state.currentTool = 'place';
        selectBuildObject(null);
        updateGhost();
        toast('حط المحطة في المشهد', 'info');
      }
      return;
    }
    // الأسلحة: سلاح فقط على الأرض أو على طاولة
    try {
      if (item.id === 'wpn_pistol' || item.id === 'wpn_smg') {
        showChoiceModal('طريقة وضع السلاح', [
          { id: 'floor', label: '🔫 السلاح فقط على الأرض' },
          { id: 'table', label: '🪑 السلاح على طاولة' }
        ], function (id) {
          item._pendingWeaponPlace = id || 'floor';
          // لفّ الـ factory حسب الاختيار
          var kind = item.id === 'wpn_smg' ? 'smg' : 'pistol';
          var bodyCol = kind === 'smg' ? 0x334155 : 0x1e293b;
          var accent = kind === 'smg' ? 0x22d3ee : 0xfbbf24;
          var onTable = (id === 'table');
          item.factory = function () {
            return makeWeaponPickup(kind, bodyCol, accent, { onTable: onTable });
          };
          armPlaceTool(item, onTable ? 'اضغط في المشهد لوضع السلاح على طاولة' : 'اضغط في المشهد لوضع السلاح على الأرض');
        });
        return;
      }
    } catch (eW) {}
    // عناصر الرماية (مش الأسلحة): اختيارات قبل الوضع
    var isRangeProp = false;
    var isDummyItem = false;
    try {
      if (item.id === 'wpn_crate' || item.id === 'wpn_board' || item.id === 'wpn_barrel') isRangeProp = true;
      if (item.id === 'wpn_dummy') { isRangeProp = true; isDummyItem = true; }
    } catch (eR) {}
    if (isRangeProp) {
      if (isDummyItem) {
        showChoiceModal('الراجدول — نوع الحركة', [
          { id: 'fixed', label: 'ثابت ومتأثر فيزيائيًا' },
          { id: 'free', label: 'قابل للحركة ومتأثر' }
        ], function (id) {
          item._pendingPhysMode = id || 'fixed';
          armPlaceTool(item, 'اضغط في المشهد لوضع الراجدول');
        });
      } else {
        showChoiceModal('عنصر الميدان — بعد الضرب', [
          { id: 'impulse', label: 'اندفاع فقط' },
          { id: 'regen', label: 'اندفاع + إعادة توليده' }
        ], function (id) {
          item._pendingPhysMode = id || 'impulse';
          armPlaceTool(item, 'اضغط في المشهد للوضع');
        });
      }
      return;
    }
    armPlaceTool(item, 'اضغط في المشهد لوضع: ' + (item.name || ''));
  }
  function updateGhost() {
    if (ghostMesh) {
      scene.remove(ghostMesh);
      ghostMesh = null;
    }
    state._ghostBottom = 0;
    state._ghostSmoothY = null;
    if (state.mode !== 'build' || !state.selectedItem || state.currentTool !== 'place') return;
    if (state.selectedItem.factory) {
      try {
        if (state.selectedItem.id === 'ix_gas') {
          ghostMesh = makeSimpleBlock([36, 0.4, 18], 0xf8fafc);
        } else {
          ghostMesh = state.selectedItem.factory();
        }
        ghostMesh.userData = ghostMesh.userData || {};
        ghostMesh.userData.isGhost = true;
        // عطّل raycast على الشبح عشان ميعملش قفز
        ghostMesh.traverse(function (c) {
          c.userData = c.userData || {};
          c.userData.isGhost = true;
          c.raycast = function () {};
          if (c.isMesh && c.material) {
            c.material = c.material.clone();
            c.material.transparent = true;
            c.material.opacity = 0.42;
            c.material.depthWrite = false;
          }
        });
        ghostMesh.raycast = function () {};
        // احسب قاع الشبح مرة واحدة
        try {
          var gbb = new THREE.Box3().setFromObject(ghostMesh);
          state._ghostBottom = gbb.isEmpty() ? 0 : gbb.min.y;
        } catch (eB) { state._ghostBottom = 0; }
        scene.add(ghostMesh);
      } catch (eG) {
        console.warn('ghost', eG);
        ghostMesh = null;
      }
    }
  }


  /** نقطة الوضع: أعلى سطح مستقر تحت المؤشر (بدون قفز بسبب الشبح) */
  function getPlacementPoint() {
    var targets = state.buildObjects.slice();
    if (ground) targets.push(ground);
    var hits = raycaster.intersectObjects(targets, true);
    if (!hits.length) return null;
    var best = null;
    var bestY = -Infinity;
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      if (!o) continue;
      // تجاهل الشبح تمامًا
      if (o.userData && o.userData.isGhost) continue;
      var root = o;
      while (root.parent && state.buildObjects.indexOf(root) === -1 && root !== ground) {
        if (root.userData && root.userData.isGhost) { root = null; break; }
        root = root.parent;
      }
      if (!root) continue;
      if (ghostMesh && (o === ghostMesh || root === ghostMesh)) continue;
      var pt = hits[i].point.clone();
      var y = pt.y;
      if (root && root !== ground && state.buildObjects.indexOf(root) !== -1) {
        try {
          var box = new THREE.Box3().setFromObject(root);
          if (!box.isEmpty()) y = box.max.y;
        } catch (e) {}
      }
      // اختَر أعلى سطح (أكثر استقرارًا من أول ضربة)
      if (y >= bestY) {
        bestY = y;
        best = new THREE.Vector3(pt.x, y, pt.z);
      }
    }
    return best;
  }


  // ===== خيارات البنزين قبل وضع العربية =====
  state._pendingCarItem = null;
  state._pendingCarOpts = null;

  function armPlaceTool(item, msg) {
    state.selectedItem = item;
    state.currentTool = 'place';
    state._blockPlaceUntil = performance.now() + 450;
    try { selectBuildObject(null); } catch (e) {}
    var btns = document.querySelectorAll('.tool-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
    var pb = document.querySelector('[data-tool="place"]'); if (pb) pb.classList.add('active');
    var ct = document.getElementById('current-tool');
    if (ct) ct.textContent = 'أداة: وضع';
    try { updateGhost(); } catch (e2) {}
    if (msg) toast(msg, 'success');
  }
  function openCarFuelModal(item) {
    state._pendingCarItem = item;
    state._pendingCarOpts = null;
    var m = document.getElementById('car-fuel-modal');
    var cons = document.getElementById('cfm-consume');
    if (cons) cons.classList.add('hidden');
    if (m) m.classList.remove('hidden');
  }
  function closeCarFuelModal() {
    var m = document.getElementById('car-fuel-modal');
    if (m) m.classList.add('hidden');
    state._pendingCarItem = null;
  }
  function applyCarFuelOpts(mesh, opts) {
    if (!mesh || !mesh.userData) return;
    opts = opts || { infinite: true };
    var inf = opts.infinite === true || opts.infinite === 'true' || opts.infinite === 1;
    mesh.userData.fuelInfinite = inf;
    mesh.userData.fuel = 100;
    mesh.userData.fuelConsume = opts.consume || 'mid';
    mesh.userData.driveMode = 'normal';
    // علامة واضحة للتشخيص
    mesh.userData._fuelTag = inf ? 'infinite' : ('limited:' + (opts.consume || 'mid'));
  }

  function placeObject(pos) {
    if (state._blockPlaceUntil && performance.now() < state._blockPlaceUntil) return;
    if (!state.selectedItem || !state.currentLevelId) { if (!state.currentLevelId) toast('أنشئ لفل أولاً', 'error'); return; }
    var mesh = state.selectedItem.factory();
    var py = (pos.y != null && isFinite(pos.y)) ? pos.y : 0;
    // ارفع الكائن بحيث قاعه يلامس السطح
    try {
      var bb = new THREE.Box3().setFromObject(mesh);
      if (!bb.isEmpty()) {
        var bottom = bb.min.y; // غالبًا 0 للمجموعات
        py = py - bottom;
      }
    } catch (e) {}
    // تليفون: حسب اختيار طاولة / من غير
    if (state.selectedItem.id === 'ix_phone') {
      mesh = makePhoneProp(!!state.selectedItem._phoneOnTable);
    }
    mesh.position.set(pos.x, py, pos.z);
    mesh.userData.buildId = state.selectedItem.id;
    if (mesh.userData.isVehicle || (state.selectedItem.id && state.selectedItem.id.indexOf('car') >= 0) || (state.selectedItem.id && state.selectedItem.id.indexOf('ix_') === 0 && state.currentCategory === 'ix_vehicles')) {
      mesh.userData.isVehicle = true;
      mesh.userData.interactive = true;
      mesh.userData.interactiveType = 'vehicle';
      mesh.userData.engineOn = false;
      mesh.userData.gear = 1;
      mesh.userData.speed = 0;
      mesh.userData.seats = mesh.userData.seats || { driver: null, passenger: null };
      var fopts = null;
      if (state.selectedItem && state.selectedItem._fuelOpts) fopts = state.selectedItem._fuelOpts;
      else if (state._pendingCarOpts) fopts = state._pendingCarOpts;
      applyCarFuelOpts(mesh, fopts || { infinite: true });
    }
    mesh.userData.catalogItem = state.selectedItem;
    // Auto name: first = base name, next = name 2, name 3...
    var baseName = state.selectedItem.name;
    var sameCount = 0;
    state.buildObjects.forEach(function (o) {
      if (o.userData.buildId === state.selectedItem.id) sameCount++;
    });
    mesh.userData.instanceName = sameCount === 0 ? baseName : (baseName + ' ' + (sameCount + 1));
    scene.add(mesh);
    state.buildObjects.push(mesh);
    if (mesh.userData && mesh.userData.isGasStation) {
      if (state._pendingGasVoices) {
        mesh.userData.voices = state._pendingGasVoices;
        state._pendingGasVoices = null;
      }
      mesh.userData.voiceMode = state._pendingGasMode || 'natural';
      mesh.userData.maxOfficeVisits = state._pendingGasMaxVisits != null ? state._pendingGasMaxVisits : 2;
      mesh.userData.officeCooldownMin = state._pendingGasCooldownMin != null ? state._pendingGasCooldownMin : 30;
      state.gasStations = state.gasStations || [];
      state.gasStations.push(mesh);
      // absolute world positions for home
      try {
        mesh.updateMatrixWorld(true);
        (mesh.userData.pumpWorkers || []).forEach(function (n) {
          if (n) n.userData.homeWorld = n.getWorldPosition(new THREE.Vector3());
        });
        (mesh.userData.deliveryWorkers || []).forEach(function (n) {
          if (n) n.userData.homeWorld = n.getWorldPosition(new THREE.Vector3());
        });
        if (mesh.userData.boss) mesh.userData.boss.userData.homeWorld = mesh.userData.boss.getWorldPosition(new THREE.Vector3());
      } catch (e) {}
    }
    // فيزياء الميدان — من الاختيار اللي قبل الوضع
    if (mesh.userData && mesh.userData.isPhysProp) {
      mesh.userData.homePos = mesh.position.clone();
      var pm = null;
      if (state.selectedItem && state.selectedItem._pendingPhysMode) pm = state.selectedItem._pendingPhysMode;
      if (mesh.userData.isDummy) {
        mesh.userData.physMode = pm || 'fixed';
      } else {
        mesh.userData.physMode = pm || 'impulse';
      }
    }
        // مفتاح شبكة للعنصر
    mesh.userData._netBuildKey = 'nb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    scheduleAutoSave();
    document.getElementById('object-count').textContent = state.buildObjects.length + ' عنصر';
    refreshHierarchy();
    if (state.buildCollabOnline) {
      try {
        var objData = {
          id: mesh.userData.buildId || (state.selectedItem && state.selectedItem.id) || 'block',
          position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
          rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
          scale: { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z },
          instanceName: mesh.userData.instanceName || '',
          _netBuildKey: mesh.userData._netBuildKey
        };
        // لو فيه serialize أدق استخدمه
        try {
          var all = serializeObjects();
          for (var si = 0; si < all.length; si++) {
            if (state.buildObjects[si] === mesh) {
              objData = all[si];
              objData._netBuildKey = mesh.userData._netBuildKey;
              break;
            }
          }
        } catch (eS) {}
        netBuildOp('place', { key: mesh.userData._netBuildKey, object: objData });
      } catch (eN) { console.warn('net place', eN); }
    }
  }

  function onBuildClick(e) {
    // الطيران مش بيمنع الوضع — في الأونلاين الطيران إجباري
    if (state.mode !== 'build' || state._buildPaused) return;
    // تجاهل أي كليك على واجهة / نوافذ
    if (e.target && e.target.closest) {
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || e.target.closest('label') || e.target.closest('a')) return;
      if (e.target.closest('#obj-toolbar') || e.target.closest('.hierarchy-panel') || e.target.closest('.build-toolbar') || e.target.closest('.build-sidebar-wrap') || e.target.closest('.level-panel') || e.target.closest('#respawn-choice-panel')) return;
      if (e.target.closest('#car-fuel-modal') || e.target.closest('#gas-place-modal') || e.target.closest('#choice-modal') || e.target.closest('#settings-panel') || e.target.closest('#inline-prompt')) return;
      if (e.target.closest('.catalog-item') || e.target.closest('.build-cat') || e.target.closest('.sidebar') || e.target.closest('.menu-container') || e.target.closest('.glass-panel')) return;
    }
    // قفل وضع قصير بعد اختيار عنصر (يمنع الوضع من نفس الكليك)
    if (state._blockPlaceUntil && performance.now() < state._blockPlaceUntil) return;
    // مفيش وضع لو مفيش عنصر مختار جاهز
    if (state.currentTool === 'place' && !state.selectedItem) return;

    if (document.pointerLockElement === canvas) {
      mouse.x = 0;
      mouse.y = 0;
    } else {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    }
    raycaster.setFromCamera(mouse, buildCamera);

    // ===== RESPAWN PLACEMENT MODE =====
    if (state.respawnPlaceMode) {
      // click existing respawn marker to remove
      var hitsR = raycaster.intersectObjects(state.respawnMarkers, true);
      if (hitsR.length) {
        var rm = hitsR[0].object;
        while (rm.parent && !rm.userData.isRespawn) rm = rm.parent;
        if (rm.userData && rm.userData.isRespawn) {
          removeRespawnMarker(rm);
          return;
        }
      }
      // ضع على أي سطح (أرض مبنية أو أرض العالم) — مش مربوط بأرض العالم فقط
      var rPt = getPlacementPoint();
      if (rPt) placeRespawnAt(rPt);
      return;
    }

    // Move mode from hierarchy context
    if (typeof moveModeObj !== 'undefined' && moveModeObj) {
      var mPt = getPlacementPoint();
      if (mPt) {
        moveModeObj.position.set(mPt.x, mPt.y, mPt.z);
        moveModeObj = null;
        refreshHierarchy();
        toast('تم النقل', 'success');
        return;
      }
    }

    // Gizmo handled on mousedown

    // وضع كائن: لا تحدّد اللي تحت الماوس — حط على السطح (أرضية مبنية أو الأرض)
    if (state.currentTool === 'place' && state.selectedItem) {
      var pPt = getPlacementPoint();
      if (pPt) placeObject(pPt);
      return;
    }

    // Click on existing object to select (Y = تحديد متعدد) — فقط في أداة الاختيار
    var hitsObj = raycaster.intersectObjects(state.buildObjects, true);
    if (hitsObj.length && state.currentTool === 'select') {
      var obj = hitsObj[0].object;
      while (obj.parent && state.buildObjects.indexOf(obj) === -1) obj = obj.parent;
      if (state.buildObjects.indexOf(obj) !== -1) {
        var multi = !!(state.keys && (state.keys['KeyY'] || state.keys['KeyY'] === true));
        if (e && (e.code === 'KeyY')) multi = true;
        multi = multi || !!(window._buildMultiY);
        selectBuildObject(obj, multi);
        objToolMode = 'move';
        rebuildGizmo();
        return;
      }
    }

    if (state.currentTool === 'delete') {
      // الحذف المحيطي: يتم عبر السحب (areaDelete) — الكليك هنا يلغي فقط
      // يمكن حذف نقطة ريسبون بكليك مباشر
      var hitsR2 = raycaster.intersectObjects(state.respawnMarkers, true);
      if (hitsR2.length) {
        var rm2 = hitsR2[0].object;
        while (rm2.parent && !rm2.userData.isRespawn) rm2 = rm2.parent;
        if (rm2.userData && rm2.userData.isRespawn) {
          removeRespawnMarker(rm2);
          return;
        }
      }
    } else {
      // click empty - deselect
      if (!hitsObj.length) selectBuildObject(null);
    }
  }

  function onBuildMove(e) {
    if (state.mode !== 'build') return;
    if (document.pointerLockElement === canvas) return;
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, buildCamera);

    // Hover highlight on axes when not dragging
    if (!gizmoDrag && selectedBuildObj && transformGizmo && (objToolMode === 'move' || objToolMode === 'scale')) {
      var hAxis = pickGizmo(raycaster);
      setGizmoHover(hAxis);
    } else if (!gizmoDrag) {
      setGizmoHover(null);
    }

    // Axis gizmo drag — إسقاط الماوس على محور 3D بالضبط (مش تقريب شاشة)
    if (gizmoDrag && gizmoDrag.grabbed && selectedBuildObj) {
      var axis = gizmoDrag.axis;
      var origin = gizmoDrag.origin || gizmoDrag.startPos;
      var axisDir = gizmoDrag.axisDir || new THREE.Vector3(
        axis === 'x' ? 1 : 0,
        axis === 'y' ? 1 : 0,
        axis === 'z' ? 1 : 0
      );
      // مستوى يمر بالمحور ويواجه الكاميرا
      var camPos = buildCamera.position;
      var toCam = new THREE.Vector3().subVectors(camPos, origin);
      var planeN = new THREE.Vector3().crossVectors(axisDir, toCam);
      if (planeN.lengthSq() < 1e-8) {
        // المحور شبه باتجاه الكاميرا — مستوى بديل
        planeN = new THREE.Vector3().crossVectors(axisDir, new THREE.Vector3(0, 1, 0));
        if (planeN.lengthSq() < 1e-8) planeN = new THREE.Vector3().crossVectors(axisDir, new THREE.Vector3(1, 0, 0));
      }
      planeN.crossVectors(planeN, axisDir).normalize();
      var plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeN, origin);
      var hit = new THREE.Vector3();
      var ok = raycaster.ray.intersectPlane(plane, hit);
      if (!ok) {
        // fallback شاشة
        var mx = (e.clientX - gizmoDrag.startX);
        var my = -(e.clientY - gizmoDrag.startY);
        var sa = gizmoDrag.screenAxis || { x: 1, y: 0 };
        var along = mx * sa.x + my * sa.y;
        var dist = buildCamera.position.distanceTo(gizmoDrag.startPos);
        var moveAmt = along * dist * 0.0025;
        hit.copy(origin).addScaledVector(axisDir, (gizmoDrag.startPointerDist || 0) + moveAmt);
      }
      // مسافة على المحور من نقطة الأصل
      var curDist = hit.clone().sub(origin).dot(axisDir);
      var deltaDist = curDist - (gizmoDrag.startPointerDist || 0);

      // مزامنة حية أثناء السحب (كل ~100ms)
      if (state.buildCollabOnline) {
        state._xfAcc = (state._xfAcc || 0) + 1;
        if (state._xfAcc >= 3) {
          state._xfAcc = 0;
          try { netSyncSelectedTransforms(); } catch (eLive) {}
        }
      }
      if (gizmoDrag.mode === 'move') {
        var pos = gizmoDrag.startPos.clone().addScaledVector(axisDir, deltaDist);
        var dx = pos.x - selectedBuildObj.position.x;
        var dy = pos.y - selectedBuildObj.position.y;
        var dz = pos.z - selectedBuildObj.position.z;
        selectedBuildObj.position.copy(pos);
        getSelectedObjects().forEach(function (o) {
          if (o === selectedBuildObj) return;
          o.position.x += dx;
          o.position.y += dy;
          o.position.z += dz;
        });
      } else if (gizmoDrag.mode === 'scale') {
        var sc = gizmoDrag.startScale.clone();
        // التمديد على نفس اتجاه المحور فقط
        var factor = 1 + deltaDist * 0.35;
        factor = Math.max(0.05, Math.min(8, factor));
        if (state.scaleMode === 'uniform') {
          var nx = Math.max(0.15, Math.min(8, sc.x * factor));
          var ratio = nx / (gizmoDrag.startScale.x || 1);
          selectedBuildObj.scale.set(nx, nx, nx);
          // طبّق نفس نسبة التكبير على باقي المحدد
          getSelectedObjects().forEach(function (o) {
            if (o === selectedBuildObj) return;
            if (!o.userData) o.userData = {};
            if (!o.userData._multiStartScale) o.userData._multiStartScale = o.scale.clone();
            var ss = o.userData._multiStartScale;
            var s2 = Math.max(0.15, Math.min(8, ss.x * ratio));
            o.scale.set(s2, s2, s2);
          });
        } else {
          if (axis === 'x') sc.x = Math.max(0.15, Math.min(8, sc.x * factor));
          else if (axis === 'y') sc.y = Math.max(0.15, Math.min(8, sc.y * factor));
          else if (axis === 'z') sc.z = Math.max(0.15, Math.min(8, sc.z * factor));
          selectedBuildObj.scale.copy(sc);
        }
      }
      syncGizmoTransform();
      updateObjToolbarPos();
      return;
    }

    // Legacy free drag on ground (optional when isDraggingObj)
    if (selectedBuildObj && isDraggingObj && objToolMode === 'move') {
      var hits = raycaster.intersectObject(ground);
      if (hits.length) {
        selectedBuildObj.position.set(hits[0].point.x, selectedBuildObj.position.y, hits[0].point.z);
        syncGizmoTransform();
        updateObjToolbarPos();
      }
      return;
    }
    if (selectedBuildObj && objToolMode === 'rotate' && (e.buttons === 1) && !gizmoDrag) {
      var dYaw = e.movementX * 0.012;
      getSelectedObjects().forEach(function (o) { o.rotation.y += dYaw; });
      state._rotateDirty = true;
      try {
        var cr = document.querySelector('#obj-toolbar [data-action="confirm-rotate"]');
        if (cr) cr.classList.remove('hidden');
      } catch (eCr) {}
      scheduleAutoSave();
      updateObjToolbarPos();
      return;
    }
    // Fallback scale drag without axis (uniform) if no gizmo handle grabbed
    if (selectedBuildObj && objToolMode === 'scale' && (e.buttons === 1) && !gizmoDrag && state.scaleMode === 'uniform') {
      var s = selectedBuildObj.scale.x + e.movementY * -0.01;
      s = Math.max(0.15, Math.min(8, s));
      var ratioFb = s / (selectedBuildObj.scale.x || 1);
      getSelectedObjects().forEach(function (o) {
        var ns = Math.max(0.15, Math.min(8, o.scale.x * ratioFb));
        o.scale.set(ns, ns, ns);
      });
      scheduleAutoSave();
      syncGizmoTransform();
      updateObjToolbarPos();
      return;
    }

    if (!ghostMesh) return;
    var gp = getPlacementPoint();
    if (gp) {
      var bottom = (state._ghostBottom != null) ? state._ghostBottom : 0;
      var targetY = gp.y - bottom;
      // تنعيم خفيف لـ Y فقط عشان ميقفش يقفز
      if (state._ghostSmoothY == null || !isFinite(state._ghostSmoothY)) state._ghostSmoothY = targetY;
      // لو الفرق كبير (سطح مختلف) انقل بسرعة، لو صغير نعّم
      var dy = targetY - state._ghostSmoothY;
      if (Math.abs(dy) > 1.2) state._ghostSmoothY = targetY;
      else state._ghostSmoothY += dy * 0.45;
      ghostMesh.position.set(gp.x, state._ghostSmoothY, gp.z);
    }
  }

  // ===== SCREENS =====

  // ===== SCRIPT RUNTIME (PLAY MODE ONLY) =====
  // IMPORTANT: Scripts never affect build mode.
  // Objects in build mode are pure static data.
  // Scripts only execute when state.mode === 'play'.
  var activeScriptCleanups = [];

  function stopAllScripts() {
    activeScriptCleanups.forEach(function (fn) {
      try { fn(); } catch (e) { console.warn('script cleanup', e); }
    });
    activeScriptCleanups = [];
    // reset script control layer
    state.script.inputLocked = [false, false];
    state.script.forcedInput = [null, null];
    state.script.cameraOverride = [null, null];
    state.script.cutscene = false;
    state.script.cutsceneCam = null;
    state.script.timeScale = 1;
    state.script.blackBars = false;
    state.script.subtitle = '';
    state.script.waiters = [];
    var bars = document.getElementById('cutscene-bars');
    var sub = document.getElementById('cutscene-subtitle');
    if (bars) bars.style.display = 'none';
    if (sub) { sub.style.display = 'none'; sub.textContent = ''; }
  }

  function runLevelScripts(levelId) {
    // HARD GUARD: never run in build mode
    if (state.mode === 'build' || state.mode === 'menu' || state.mode === 'lobby') {
      return;
    }
    stopAllScripts();
    state.script.flags = {};
    state.script.waiters = [];
    var level = state.levels[levelId];
    if (!level || !level.scripts || !level.scripts.length) return;

    // ===== FULL GameAPI — programming controls everything =====
    function wrapObj(o) {
      if (!o) return null;
      return {
        name: o.userData.instanceName,
        id: o.userData.buildId,
        position: o.position,
        rotation: o.rotation,
        scale: o.scale,
        mesh: o,
        isCharacter: !!o.userData.isCharacter,
        isVehicle: !!o.userData.isVehicle,
        job: o.userData.job || null,
        limbs: o.userData.leftArm ? {
          leftArm: o.userData.leftArm,
          rightArm: o.userData.rightArm,
          leftLeg: o.userData.leftLeg,
          rightLeg: o.userData.rightLeg
        } : null
      };
    }

    var GameAPI = {
      // --- meta ---
      mode: function () { return state.mode; },
      isPlay: function () { return state.mode === 'play'; },
      THREE: THREE,
      scene: scene,
      time: function () { return state.clock.elapsedTime; },
      delta: function () { return Math.min(state.clock.getDelta(), 0.05) * (state.script.timeScale || 1); },

      // --- objects ---
      getObjects: function () {
        if (state.mode !== 'play') return [];
        return state.buildObjects.map(wrapObj);
      },
      getCharacters: function () {
        return this.getObjects().filter(function (o) { return o.isCharacter; });
      },
      getVehicles: function () {
        return this.getObjects().filter(function (o) { return o.isVehicle; });
      },
      getSeats: function (vehicleMesh) {
        if (!vehicleMesh) return [];
        var seats = [];
        vehicleMesh.traverse(function (c) {
          if (c.userData && c.userData.isSeat) seats.push({ mesh: c, name: c.userData.seatName || 'seat', position: c.position });
        });
        return seats;
      },
      findByName: function (name) {
        if (state.mode !== 'play') return null;
        for (var i = 0; i < state.buildObjects.length; i++) {
          if (state.buildObjects[i].userData.instanceName === name) return wrapObj(state.buildObjects[i]);
        }
        return null;
      },
      findAllById: function (buildId) {
        if (state.mode !== 'play') return [];
        return state.buildObjects.filter(function (o) { return o.userData.buildId === buildId; }).map(wrapObj);
      },
      setPosition: function (nameOrMesh, x, y, z) {
        var m = typeof nameOrMesh === 'string' ? (this.findByName(nameOrMesh) || {}).mesh : nameOrMesh;
        if (m && m.position) m.position.set(x, y != null ? y : m.position.y, z);
      },
      setRotation: function (nameOrMesh, yRad) {
        var m = typeof nameOrMesh === 'string' ? (this.findByName(nameOrMesh) || {}).mesh : nameOrMesh;
        if (m) m.rotation.y = yRad;
      },
      setScale: function (nameOrMesh, s) {
        var m = typeof nameOrMesh === 'string' ? (this.findByName(nameOrMesh) || {}).mesh : nameOrMesh;
        if (m) m.scale.setScalar(s);
      },
      setVisible: function (nameOrMesh, vis) {
        var m = typeof nameOrMesh === 'string' ? (this.findByName(nameOrMesh) || {}).mesh : nameOrMesh;
        if (m) m.visible = !!vis;
      },
      moveTowards: function (nameOrMesh, tx, tz, speed, delta) {
        var m = typeof nameOrMesh === 'string' ? (this.findByName(nameOrMesh) || {}).mesh : nameOrMesh;
        if (!m) return false;
        var dx = tx - m.position.x, dz = tz - m.position.z;
        var len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.15) return true;
        var sp = (speed || 3) * (delta || 0.016);
        m.position.x += (dx / len) * sp;
        m.position.z += (dz / len) * sp;
        m.rotation.y = Math.atan2(dx, dz);
        return false;
      },
      animateCharacter: function (mesh, delta, speed) {
        if (!mesh || !mesh.userData || !mesh.userData.leftArm) return;
        var ud = mesh.userData;
        ud.walkCycle = (ud.walkCycle || 0) + (delta || 0.016) * (speed || 8);
        var s = Math.sin(ud.walkCycle);
        if (ud.leftArm) ud.leftArm.rotation.x = s * 0.6;
        if (ud.rightArm) ud.rightArm.rotation.x = -s * 0.6;
        if (ud.leftLeg) ud.leftLeg.rotation.x = -s * 0.5;
        if (ud.rightLeg) ud.rightLeg.rotation.x = s * 0.5;
      },

      // --- players (the actual human-controlled characters) ---
      getPlayer: function (idx) {
        idx = idx || 0;
        var p = players[idx];
        if (!p || !p.group) return null;
        return {
          index: idx,
          mesh: p.group,
          position: p.group.position,
          rotation: p.group.rotation,
          yaw: p.yaw,
          velocity: p.velocity,
          camera: p.camera,
          canJump: p.canJump,
          inVehicle: !!p.vehicle,
          vehicle: p.vehicle || null,
          vehicleSeat: p.vehicleSeat || null,
          limbs: p.group.userData ? {
            leftArm: p.group.userData.leftArm,
            rightArm: p.group.userData.rightArm,
            leftLeg: p.group.userData.leftLeg,
            rightLeg: p.group.userData.rightLeg
          } : null
        };
      },
      setPlayerPosition: function (idx, x, y, z) {
        var p = players[idx || 0];
        if (p && p.group) p.group.position.set(x, y != null ? y : 0, z);
      },
      setPlayerYaw: function (idx, yaw) {
        var p = players[idx || 0];
        if (p) p.yaw = yaw;
      },
      lockPlayer: function (idx, locked) {
        state.script.inputLocked[idx || 0] = !!locked;
      },
      lockAllPlayers: function (locked) {
        state.script.inputLocked[0] = !!locked;
        state.script.inputLocked[1] = !!locked;
      },
      forcePlayerInput: function (idx, inputObj) {
        // { up, down, left, right, jump, run, lookX } or null to clear
        state.script.forcedInput[idx || 0] = inputObj;
      },
      teleportPlayer: function (idx, x, y, z, yaw) {
        var p = players[idx || 0];
        if (!p || !p.group) return;
        p.group.position.set(x, y != null ? y : 0, z);
        if (yaw != null) p.yaw = yaw;
        p.velocity.set(0, 0, 0);
      },

      // --- multiplayer / script-spawned objects ---
      /** Add a mesh to the play scene AND buildObjects so vehicles/sync work for everyone */
      addObject: function (mesh, opts) {
        opts = opts || {};
        if (!mesh) return null;
        if (opts.name) mesh.userData.instanceName = opts.name;
        if (opts.id) mesh.userData.buildId = opts.id;
        if (opts.isVehicle) mesh.userData.isVehicle = true;
        if (!mesh.userData.instanceName) {
          mesh.userData.instanceName = 'script_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e4);
        }
        // ensure unique name
        var base = mesh.userData.instanceName;
        var n = 1;
        var names = {};
        for (var i = 0; i < state.buildObjects.length; i++) {
          var nm = state.buildObjects[i].userData && state.buildObjects[i].userData.instanceName;
          if (nm) names[nm] = true;
        }
        while (names[mesh.userData.instanceName]) {
          mesh.userData.instanceName = base + '_' + (n++);
        }
        if (mesh.parent !== scene) scene.add(mesh);
        if (state.buildObjects.indexOf(mesh) === -1) state.buildObjects.push(mesh);
        return mesh.userData.instanceName;
      },
      removeObject: function (nameOrMesh) {
        var m = typeof nameOrMesh === 'string' ? null : nameOrMesh;
        if (typeof nameOrMesh === 'string') {
          for (var i = 0; i < state.buildObjects.length; i++) {
            if (state.buildObjects[i].userData && state.buildObjects[i].userData.instanceName === nameOrMesh) {
              m = state.buildObjects[i];
              break;
            }
          }
        }
        if (!m) return;
        state.buildObjects = state.buildObjects.filter(function (o) { return o !== m; });
        if (m.parent) m.parent.remove(m);
        else scene.remove(m);
      },
      /** Put local player into a vehicle (uses engine driving + network pose sync) */
      enterVehicle: function (idx, vehicleMesh, seatName) {
        idx = idx || 0;
        var p = players[idx];
        if (!p || !vehicleMesh) return false;
        // register if needed
        if (state.buildObjects.indexOf(vehicleMesh) === -1) {
          this.addObject(vehicleMesh, { isVehicle: true, name: vehicleMesh.userData.instanceName });
        }
        vehicleMesh.userData.isVehicle = true;
        if (!vehicleMesh.userData.instanceName) {
          vehicleMesh.userData.instanceName = 'veh_' + Date.now().toString(36);
        }
        p.vehicle = vehicleMesh;
        p.vehicleSeat = seatName || 'driver';
        vehicleMesh.userData.drivenBy = p.id;
        p.yaw = vehicleMesh.rotation.y;
        if (p.group) p.group.visible = true;
        // مهم: فك أي قفل إدخال عشان السائق يقدر يحرك بـ WASD
        state.script.inputLocked[idx] = false;
        state.script.forcedInput[idx] = null;
        p.velocity.set(0, 0, 0);
        // ثبت اللاعب فوق العربية فوراً
        p.group.position.x = vehicleMesh.position.x;
        p.group.position.y = (vehicleMesh.position.y || 0) + 0.9;
        p.group.position.z = vehicleMesh.position.z;
        return true;
      },
      exitVehicle: function (idx) {
        idx = idx || 0;
        var p = players[idx];
        if (!p || !p.vehicle) return false;
        var v = p.vehicle;
        v.userData.drivenBy = null;
        p.vehicle = null;
        p.vehicleSeat = null;
        if (p.group) {
          // جنب العربية بمسافة كافية عشان متتزنقش
          var side = 3.8;
          p.group.position.x = v.position.x + Math.cos(p.yaw) * side;
          p.group.position.z = v.position.z - Math.sin(p.yaw) * side;
          p.group.position.y = 0;
          p.velocity.set(0, 0, 0);
        }
        return true;
      },
      /** Remote / all visible player positions for cutscenes & logic */
      getNetPlayers: function () {
        var list = [];
        Object.keys(state.remoteMeshes || {}).forEach(function (id) {
          var m = state.remoteMeshes[id];
          if (!m) return;
          list.push({
            id: id,
            name: (m.userData && m.userData.displayName) || id,
            mesh: m,
            position: m.position,
            x: m.position.x, y: m.position.y, z: m.position.z
          });
        });
        return list;
      },
      getMyName: function () { return state.playerName || 'لاعب'; },
      getMyNetId: function () { return state.myNetId || null; },
      getRoster: function () {
        return (state.netRoster || []).map(function (r) {
          return { id: r.id, name: r.name || r.id, isHost: !!r.isHost };
        });
      },
      getAllPlayers: function () {
        var list = [];
        for (var i = 0; i < players.length; i++) {
          var gp = this.getPlayer(i);
          if (gp) list.push({ local: true, index: i, mesh: gp.mesh, position: gp.position, x: gp.position.x, y: gp.position.y, z: gp.position.z });
        }
        this.getNetPlayers().forEach(function (r) {
          list.push({ local: false, id: r.id, name: r.name, mesh: r.mesh, position: r.position, x: r.x, y: r.y, z: r.z });
        });
        return list;
      },
      listMusic: function () {
        var lv = state.levels[state.currentLevelId];
        return ((lv && lv.music) || []).map(function (m) { return { name: m.name, type: m.type }; });
      },
      playMusic: function (name, opts) {
        opts = opts || {};
        var lv = state.levels[state.currentLevelId];
        var list = (lv && lv.music) || [];
        var found = null;
        for (var i = 0; i < list.length; i++) if (list[i].name === name || list[i].name.replace(/\.[^.]+$/, '') === name) { found = list[i]; break; }
        if (!found) return null;
        try {
          var a = new Audio(found.dataUrl);
          a.volume = opts.volume != null ? opts.volume : 0.6;
          a.loop = !!opts.loop;
          a.play().catch(function () {});
          return a;
        } catch (e) { return null; }
      },
      getMusicDataUrl: function (name) {
        var lv = state.levels[state.currentLevelId];
        var list = (lv && lv.music) || [];
        for (var i = 0; i < list.length; i++) if (list[i].name === name || list[i].name.replace(/\.[^.]+$/, '') === name) return list[i].dataUrl;
        return null;
      },
      listSounds: function () {
        var lv = state.levels[state.currentLevelId];
        return ((lv && lv.sounds) || []).map(function (m) { return { name: m.name, type: m.type }; });
      },
      playLevelSound: function (name, opts) {
        opts = opts || {};
        var lv = state.levels[state.currentLevelId];
        var list = (lv && lv.sounds) || [];
        var found = null;
        for (var i = 0; i < list.length; i++) if (list[i].name === name || list[i].name.replace(/\.[^.]+$/, '') === name) { found = list[i]; break; }
        if (!found) return null;
        try {
          var a = new Audio(found.dataUrl);
          a.volume = opts.volume != null ? opts.volume : 0.5;
          a.loop = !!opts.loop;
          a.play().catch(function () {});
          return a;
        } catch (e) { return null; }
      },
      listImages: function () {
        var lv = state.levels[state.currentLevelId];
        return ((lv && lv.images) || []).map(function (m) { return { name: m.name, type: m.type }; });
      },
      getImageDataUrl: function (name) {
        var lv = state.levels[state.currentLevelId];
        var list = (lv && lv.images) || [];
        for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i].dataUrl;
        return null;
      },
      /** Send custom data to other clients (scripts). payload must be JSON-serializable. */
      netSend: function (payload) {
        if (!payload || typeof payload !== 'object') return;
        var msg = { type: 'script_net', id: state.myNetId || 'local', data: payload };
        if (state.useFirebase) {
          try { fbSend(msg); } catch (e) {}
        } else if (state.useLan) {
          try { lanSend(msg); } catch (e) {}
        } else if (state.isHost) {
          try { broadcastToAll(msg); } catch (e) {}
        } else if (state.connection) {
          try { state.connection.send(msg); } catch (e) {}
        }
      },
      /** Listen for Game.netSend from other clients. Returns unsubscribe fn. */
      onNet: function (fn) {
        if (typeof fn !== 'function') return function () {};
        if (!state.script.netHandlers) state.script.netHandlers = [];
        state.script.netHandlers.push(fn);
        var handlers = state.script.netHandlers;
        return function () {
          var i = handlers.indexOf(fn);
          if (i >= 0) handlers.splice(i, 1);
        };
      },

      // --- camera ---
      setCamera: function (idx, opts) {
        // opts: { x,y,z, lookX,lookY,lookZ, fov, lerp }
        state.script.cameraOverride[idx || 0] = opts || null;
      },
      clearCamera: function (idx) {
        state.script.cameraOverride[idx || 0] = null;
      },
      clearAllCameras: function () {
        state.script.cameraOverride[0] = null;
        state.script.cameraOverride[1] = null;
      },
      setCamDist: function (d) { state.camDist = d; },
      setCamHeight: function (h) { state.camHeight = h; },
      setCamSide: function (s) { state.camSide = s; },

      // --- cutscene system ---
      startCutscene: function (opts) {
        // opts: { x,y,z, lookX,lookY,lookZ, fov, blackBars, lockPlayers }
        state.script.cutscene = true;
        state.script.cutsceneCam = opts || { x: 10, y: 8, z: 10, lookX: 0, lookY: 1, lookZ: 0, fov: 50 };
        if (opts && opts.blackBars !== false) state.script.blackBars = true;
        if (!opts || opts.lockPlayers !== false) {
          state.script.inputLocked[0] = true;
          state.script.inputLocked[1] = true;
        }
        updateScriptUI();
      },
      setCutsceneCamera: function (opts) {
        if (!state.script.cutscene) state.script.cutscene = true;
        state.script.cutsceneCam = opts;
        updateScriptUI();
      },
      endCutscene: function () {
        state.script.cutscene = false;
        state.script.cutsceneCam = null;
        state.script.blackBars = false;
        state.script.inputLocked[0] = false;
        state.script.inputLocked[1] = false;
        state.script.subtitle = '';
        updateScriptUI();
      },
      isCutscene: function () { return !!state.script.cutscene; },

      // --- UI / subtitle / bars ---
      subtitle: function (text) {
        state.script.subtitle = text || '';
        updateScriptUI();
      },
      blackBars: function (on) {
        state.script.blackBars = !!on;
        updateScriptUI();
      },
      toast: function (msg, type) { if (state.mode === 'play') toast(msg, type || 'info'); },

      // --- time ---
      setTimeScale: function (s) { state.script.timeScale = Math.max(0, s); },
      getTimeScale: function () { return state.script.timeScale; },
      wait: function (seconds, callback) {
        var t = { left: seconds, cb: callback, done: false };
        state.script.waiters.push(t);
        activeScriptCleanups.push(function () { t.done = true; });
      },
      after: function (seconds, callback) { this.wait(seconds, callback); },

      // --- flags / state machine for story ---
      setFlag: function (key, val) { state.script.flags[key] = val; },
      getFlag: function (key, def) { return state.script.flags.hasOwnProperty(key) ? state.script.flags[key] : def; },
      toggleFlag: function (key) { state.script.flags[key] = !state.script.flags[key]; return state.script.flags[key]; },

      // --- sounds (if level has them) ---
      playSound: function (name) {
        var lid = state.currentLevelId || state.selectedPlayLevel;
        var lv = lid && state.levels[lid];
        if (!lv || !lv.sounds) return;
        for (var i = 0; i < lv.sounds.length; i++) {
          if (lv.sounds[i].name === name || lv.sounds[i].name.indexOf(name) !== -1) {
            try {
              var a = new Audio(lv.sounds[i].dataUrl);
              a.volume = state.volume;
              a.play();
            } catch (e) {}
            return;
          }
        }
      },

      // --- input query ---
      isKeyDown: function (code) { return !!state.keys[code]; },
      getPlayerInput: function (idx) {
        if (idx === 1) return null; // gamepad polled elsewhere
        return {
          up: !!state.keys['KeyW'], down: !!state.keys['KeyS'],
          left: !!state.keys['KeyA'], right: !!state.keys['KeyD'],
          jump: !!state.keys['Space'], run: !!(state.keys['ShiftLeft'] || state.keys['ShiftRight'])
        };
      },

      // --- distance helpers ---
      distance: function (a, b) {
        var ax = a.x != null ? a.x : (a.position ? a.position.x : 0);
        var az = a.z != null ? a.z : (a.position ? a.position.z : 0);
        var bx = b.x != null ? b.x : (b.position ? b.position.x : 0);
        var bz = b.z != null ? b.z : (b.position ? b.position.z : 0);
        var dx = ax - bx, dz = az - bz;
        return Math.sqrt(dx * dx + dz * dz);
      },
      near: function (a, b, radius) {
        return this.distance(a, b) <= (radius || 2);
      },

      // --- main loop hook ---
      onUpdate: function (fn) {
        if (state.mode !== 'play') return;
        var running = true;
        function loop() {
          if (!running || state.mode !== 'play') return;
          var d = 0.016 * (state.script.timeScale || 1);
          // process waiters
          for (var i = state.script.waiters.length - 1; i >= 0; i--) {
            var w = state.script.waiters[i];
            if (w.done) { state.script.waiters.splice(i, 1); continue; }
            w.left -= d;
            if (w.left <= 0) {
              w.done = true;
              state.script.waiters.splice(i, 1);
              try { w.cb && w.cb(); } catch (e) { console.warn(e); }
            }
          }
          try { fn(d); } catch (e) { console.warn(e); }
          requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop);
        activeScriptCleanups.push(function () { running = false; });
      },

      // --- sequence helper for cutscenes ---
      sequence: function (steps) {
        // steps: [ { wait: 1 }, { fn: function(){} }, { subtitle: '...' }, { camera: {...} }, ... ]
        var self = this;
        var i = 0;
        function next() {
          if (i >= steps.length || state.mode !== 'play') return;
          var step = steps[i++];
          if (step.wait) {
            self.wait(step.wait, next);
            return;
          }
          if (step.subtitle != null) self.subtitle(step.subtitle);
          if (step.camera) self.setCutsceneCamera(step.camera);
          if (step.startCutscene) self.startCutscene(step.startCutscene === true ? step.camera : step.startCutscene);
          if (step.endCutscene) self.endCutscene();
          if (step.lock) self.lockAllPlayers(true);
          if (step.unlock) self.lockAllPlayers(false);
          if (step.toast) self.toast(step.toast);
          if (step.flag) self.setFlag(step.flag[0], step.flag[1]);
          if (step.fn) try { step.fn(self); } catch (e) { console.warn(e); }
          if (step.waitAfter) {
            self.wait(step.waitAfter, next);
          } else {
            next();
          }
        }
        next();
      }
    };

    function updateScriptUI() {
      var bars = document.getElementById('cutscene-bars');
      var sub = document.getElementById('cutscene-subtitle');
      if (!bars) {
        bars = document.createElement('div');
        bars.id = 'cutscene-bars';
        bars.innerHTML = '<div class="bar top"></div><div class="bar bottom"></div>';
        bars.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5000;display:none';
        var style = document.createElement('style');
        style.textContent = '#cutscene-bars .bar{position:absolute;left:0;right:0;height:12%;background:#000;transition:height .4s}' +
          '#cutscene-bars .top{top:0}#cutscene-bars .bottom{bottom:0}' +
          '#cutscene-subtitle{position:fixed;left:10%;right:10%;bottom:14%;text-align:center;color:#fff;font-size:1.25rem;' +
          'text-shadow:0 2px 8px #000;z-index:5001;pointer-events:none;font-family:Tahoma,Arial,sans-serif;display:none;line-height:1.5}';
        document.head.appendChild(style);
        document.body.appendChild(bars);
      }
      if (!sub) {
        sub = document.createElement('div');
        sub.id = 'cutscene-subtitle';
        document.body.appendChild(sub);
      }
      bars.style.display = state.script.blackBars ? 'block' : 'none';
      if (state.script.subtitle) {
        sub.style.display = 'block';
        sub.textContent = state.script.subtitle;
      } else {
        sub.style.display = 'none';
        sub.textContent = '';
      }
    }

    level.scripts.forEach(function (s) {
      if (!s.content) return;
      try {
        // Scripts receive GameAPI; they should no-op if not in play
        var fn = new Function('Game', '"use strict";\n' + s.content);
        fn(GameAPI);
      } catch (err) {
        console.warn('Script error (' + s.name + '):', err);
        toast('خطأ في برمجة: ' + s.name, 'error');
      }
    });
  }



  function showScreen(name) {
    // حفظ تلقائي قبل مغادرة البناء
    if (state.mode === 'build' && name !== 'build') {
      try { saveCurrentLevelSilent(); } catch (e) {}
    }
    // Stop any running scripts when leaving play mode
    if (state.mode === 'play' && name !== 'play') {
      if (typeof stopAllScripts === 'function') stopAllScripts();
    }
    // Hide ALL menu overlays
    mainMenu.classList.add('hidden');
    lobbyScreen.classList.add('hidden');
    buildUI.classList.add('hidden');
    gameUI.classList.add('hidden');
    ['story-choice','online-confirm','online-hub','create-room','join-room','build-mode-choice','build-online-hub'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    var pm = document.getElementById('pause-menu');
    if (pm) pm.classList.add('hidden');
    var sp = document.getElementById('settings-panel');
    if (sp) sp.classList.add('hidden');
    state.paused = false;

    gridHelper.visible = false;
    renderer.setScissorTest(false);
    state.mode = name;
    try { document.body.classList.toggle('build-mode', name === 'build'); document.body.classList.toggle('play-mode', name === 'play'); } catch (eBm) {}
    state.flyMode = false;
    flyIndicator.style.display = 'none';
    document.body.style.cursor = 'default';
    document.exitPointerLock && document.exitPointerLock();

    if (name === 'menu') {
      mainMenu.classList.remove('hidden');
      try { clearLobbyPreviews && clearLobbyPreviews(); } catch (e) {}
    } else if (name === 'lobby') {
      // Do NOT reset player2Joined here — callers set it intentionally
      lobbyScreen.classList.remove('hidden');
      if (lobbyScreen) lobbyScreen.classList.remove('online-lobby');
      if (state.playType === 'online') {
        lobbyScreen.classList.add('online-lobby');
      }
      updateLobbyLevelSelect();
      try { renderNetLobbyList(); } catch (e) {}
      try { refreshLobbyPreviews(); } catch (e) {}
    } else if (name === 'build') {
      if (typeof stopAllScripts === 'function') stopAllScripts();
      players.forEach(function (p) {
        if (p.group) { scene.remove(p.group); p.group = null; }
      });
      clearRemoteMeshes && clearRemoteMeshes();
      buildUI.classList.remove('hidden');
      gridHelper.visible = true;
      populateSidebar(); renderLevelsList(); updateAssetsInfo(); refreshHierarchy();
      state.flyPos.set(15, 18, 15); state.flyYaw = 0.8; state.flyPitch = 0.35;
      buildCamera.position.copy(state.flyPos);
      buildCamera.lookAt(0, 0, 0);
      state.respawnPlaceMode = null;
      var rp = document.getElementById('respawn-choice-panel');
      if (rp) rp.classList.add('hidden');
      if (state.currentLevelId) loadRespawnMarkers(state.currentLevelId);
    } else if (name === 'play') {
      gameUI.classList.remove('hidden');
      if (state.playType === 'split') {
        renderer.setScissorTest(true);
        var labels = document.getElementById('split-labels');
        if (labels) labels.style.display = 'flex';
      } else {
        renderer.setScissorTest(false);
        var labels2 = document.getElementById('split-labels');
        if (labels2) labels2.style.display = 'none';
      }
    }
  }

  function startGame() {
    if (state.playType === 'online' && !state.isHost) {
      toast('انتظر القائد لبدء اللعبة', 'info');
      return;
    }
    if (state.playType === 'split' && !state.player2Joined) {
      toast('اضغط على كارت اللاعب 2 أو زر X على الدراعة', 'info');
      return;
    }
    if (state.playType === 'online' && state.isHost) {
      var n = (state.netRoster || []).length;
      if (n < 2) {
        toast('لازم لاعب واحد على الأقل ينضم', 'info');
        return;
      }
    }
    // Apply customization from UI
    try {
      if (typeof readCustomFromUI === 'function') {
        if (state.playType === 'online') {
          readCustomFromUI(0);
        } else if (document.getElementById('custom-player-select')) {
          var prev = document.getElementById('custom-player-select').value;
          document.getElementById('custom-player-select').value = '0';
          readCustomFromUI(0);
          document.getElementById('custom-player-select').value = '1';
          readCustomFromUI(1);
          document.getElementById('custom-player-select').value = prev;
          readCustomFromUI(parseInt(prev) || 0);
        }
      }
    } catch (e) { console.warn(e); }

    var levelId = '';
    var sel = document.getElementById('lobby-level-select');
    if (sel) levelId = sel.value || '';
    // Save respawns from markers before loading into play (if still in build)
    if (state.currentLevelId && state.levels[state.currentLevelId]) {
      saveRespawnsFromMarkers();
    }
    if (levelId) {
      state.currentLevelId = levelId;
      loadLevelIntoScene(levelId);
    } else clearBuildObjects();
    // Hide respawn markers during play (build-only visuals)
    clearRespawnMarkers();

    if (lobbyScreen) lobbyScreen.classList.remove('online-lobby');

    if (state.playType === 'online') {
      setupPlayersForNet();
      // force next pose to include clothes so remotes get appearance
      state._lastSentCustomKey = null;
    } else {
      setupPlayers();
    }
    showScreen('play');
    try { if (state.playType === 'online') voiceOnEnterGame(); } catch (eV0) {}

    if (state.playType === 'online' && state.isHost) {
      var levelName = (levelId && state.levels[levelId]) ? state.levels[levelId].name : '';
      var levelPayload = null;
      try {
        if (levelId && state.levels[levelId]) {
          // أرسل اللفل كامل للمنضمين (عشان يدخلوا من غير ملف شامل)
          levelPayload = JSON.parse(JSON.stringify(state.levels[levelId]));
        }
      } catch (eLp) {
        try { levelPayload = state.levels[levelId] || null; } catch (e2) {}
      }
      var startMsg = {
        type: 'start',
        levelId: levelId,
        levelName: levelName,
        roster: state.netRoster,
        level: levelPayload
      };
      if (state.useFirebase) {
        fbSend(startMsg);
      } else if (state.useLan) {
        lanSend(startMsg);
        try {
          fetch(lanBaseUrl() + '/roommeta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room: state.roomCode, host: state.playerName || 'القائد', players: (state.netRoster || []).length, playing: true })
          });
        } catch (e) {}
      }
      else broadcastToAll(startMsg);
    }
    // send first poses quickly after start
    if (state.playType === 'online') {
      setTimeout(function () { try { sendMyPose(); } catch (e) {} }, 100);
      setTimeout(function () { try { sendMyPose(); } catch (e) {} }, 400);
    }
    if (levelId) {
      setTimeout(function () { if (typeof runLevelScripts === 'function') runLevelScripts(levelId); }, 100);
    }
    toast('بدء اللعب!' + (state.playType === 'online' ? ' (' + (state.netRoster || []).length + ' لاعبين)' : ''), 'success');
  }


  // ===== AREA DELETE (الحذف المحيطي) =====
  var areaDelete = { active: false, x0: 0, y0: 0, x1: 0, y1: 0 };
  function getAreaDeleteRectEl() {
    return document.getElementById('area-delete-rect');
  }
  function showAreaDeleteRect(show) {
    var el = getAreaDeleteRectEl();
    if (!el) return;
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }
  function updateAreaDeleteRectVisual() {
    var el = getAreaDeleteRectEl();
    if (!el || !areaDelete.active) return;
    var l = Math.min(areaDelete.x0, areaDelete.x1);
    var t = Math.min(areaDelete.y0, areaDelete.y1);
    var w = Math.abs(areaDelete.x1 - areaDelete.x0);
    var h = Math.abs(areaDelete.y1 - areaDelete.y0);
    el.style.left = l + 'px';
    el.style.top = t + 'px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
  }
  function projectToScreen(obj) {
    var pos = obj.position.clone();
    pos.project(buildCamera);
    return {
      x: (pos.x * 0.5 + 0.5) * window.innerWidth,
      y: (-pos.y * 0.5 + 0.5) * window.innerHeight,
      behind: pos.z > 1
    };
  }
  function finishAreaDelete() {
    if (!areaDelete.active) return;
    areaDelete.active = false;
    showAreaDeleteRect(false);
    var l = Math.min(areaDelete.x0, areaDelete.x1);
    var r = Math.max(areaDelete.x0, areaDelete.x1);
    var t = Math.min(areaDelete.y0, areaDelete.y1);
    var b = Math.max(areaDelete.y0, areaDelete.y1);
    // ignore tiny clicks
    if ((r - l) < 8 && (b - t) < 8) return;
    var toRemove = [];
    for (var i = 0; i < state.buildObjects.length; i++) {
      var o = state.buildObjects[i];
      if (!o) continue;
      var p = projectToScreen(o);
      if (p.behind) continue;
      if (p.x >= l && p.x <= r && p.y >= t && p.y <= b) toRemove.push(o);
    }
    if (!toRemove.length) {
      toast('لا عناصر داخل المنطقة', 'info');
      return;
    }
    // مزامنة الحذف المحيطي
    if (state.buildCollabOnline) {
      try {
        var keys = toRemove.map(function (o) {
          if (!o.userData) o.userData = {};
          if (!o.userData._netBuildKey) {
            o.userData._netBuildKey = 'nb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
          }
          return o.userData._netBuildKey;
        }).filter(Boolean);
        if (keys.length) netBuildOp('delete', { keys: keys });
      } catch (eN) {}
    }
    disposeGizmo();
    toRemove.forEach(function (o) {
      try { clearObjectHighlight(o); } catch (e) {}
      try { scene.remove(o); } catch (e) {}
    });
    state.buildObjects = state.buildObjects.filter(function (o) { return toRemove.indexOf(o) === -1; });
    if (selectedBuildObj && toRemove.indexOf(selectedBuildObj) >= 0) selectBuildObject(null);
    else if (typeof selectedBuildObjs !== 'undefined') {
      selectedBuildObjs = selectedBuildObjs.filter(function (o) { return toRemove.indexOf(o) === -1; });
    }
    document.getElementById('object-count').textContent = state.buildObjects.length + ' عنصر';
    refreshHierarchy();
    scheduleAutoSave();
    toast('حُذف ' + toRemove.length + ' عنصر من المنطقة', 'success');
  }

  function onAreaDeleteDown(e) {
    if (state.mode !== 'build' || state.currentTool !== 'delete') return;
    if (document.pointerLockElement === canvas) return;
    if (e.button !== 0) return;
    if (e.target.closest && (e.target.closest('#obj-toolbar') || e.target.closest('.hierarchy-panel') || e.target.closest('.build-toolbar') || e.target.closest('.build-sidebar-wrap') || e.target.closest('.level-panel') || e.target.closest('#respawn-choice-panel') || e.target.closest('.build-sidebar') || e.target.closest('.levels-list'))) return;
    areaDelete.active = true;
    areaDelete.x0 = areaDelete.x1 = e.clientX;
    areaDelete.y0 = areaDelete.y1 = e.clientY;
    showAreaDeleteRect(true);
    updateAreaDeleteRectVisual();
    e.preventDefault();
  }
  function onAreaDeleteMove(e) {
    if (!areaDelete.active) return;
    areaDelete.x1 = e.clientX;
    areaDelete.y1 = e.clientY;
    updateAreaDeleteRectVisual();
  }
  function onAreaDeleteUp(e) {
    if (!areaDelete.active) return;
    areaDelete.x1 = e.clientX;
    areaDelete.y1 = e.clientY;
    finishAreaDelete();
  }
  window.addEventListener('mousedown', onAreaDeleteDown, true);
  window.addEventListener('mousemove', onAreaDeleteMove, true);
  window.addEventListener('mouseup', onAreaDeleteUp, true);

  // ===== INPUT =====
  window.addEventListener('keydown', function (e) {
    state.keys[e.code] = true;
    if (e.code === 'KeyY') window._buildMultiY = true;
    // وضع البناء: عمليات على كل العناصر المحددة (Y multi-select)
    if (state.mode === 'build') {
      var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        // متكتبش في الحقول
      } else {
        if (e.code === 'Delete' || e.code === 'Backspace') {
          e.preventDefault();
          deleteSelectedBuildObjects();
          return;
        }
        // R = واجه الكاميرا (دوران قدام الشخص)
        if (e.code === 'KeyR' && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          faceSelectedTowardCamera();
          toast('اتجه ناحية الكاميرا', 'info');
          return;
        }
        // + أو = أو D = نسخ كل المحدد
        if (e.code === 'Equal' || e.code === 'NumpadAdd' || (e.code === 'KeyD' && (e.ctrlKey || e.metaKey || !e.shiftKey))) {
          if (e.code === 'KeyD' && !e.ctrlKey && !e.metaKey) {
            // D بدون Ctrl للنسخ السريع في البناء
            e.preventDefault();
            duplicateSelectedBuildObjects();
            return;
          }
          if (e.code === 'Equal' || e.code === 'NumpadAdd') {
            e.preventDefault();
            duplicateSelectedBuildObjects();
            return;
          }
          if ((e.code === 'KeyD') && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            duplicateSelectedBuildObjects();
            return;
          }
        }
      }
    }
    // مايك في البناء واللعب
    if (e.code === 'KeyB' && (state.mode === 'build' || state.mode === 'play')) {
      e.preventDefault();
      try { voiceToggleFromKey(); } catch (eB0) { console.warn(eB0); }
    }
    if (state.mode === 'play') {
      if (e.code === 'KeyF') {
        e.preventDefault();
        tryInteractPrimary(players[0]);
      }
      if (e.code === 'KeyG') {
        e.preventDefault();
        tryInteractSecondary(players[0]);
      }
      if (e.code === 'KeyH') {
        e.preventDefault();
        if (players[0].vehicleSeat && players[0].vehicleSeat !== 'driver') {
          toast('الرفيق ملوش تحكم في المحرك', 'info');
        } else toggleVehicleEngine(players[0]);
      }
      if (e.code === 'KeyJ') {
        e.preventDefault();
        // J = تعبئة بنزين لو على المنطقة الحمراء
        if (players[0].vehicle && players[0].vehicle.userData._onGasZone) {
          tryStartRefuel(players[0]);
        } else if (players[0].vehicle) {
          toast('قف على المنطقة الحمراء قدام المكنة واضغط J', 'info');
        }
      }
      if (e.code === 'KeyM') {
        e.preventDefault();
        if (players[0].vehicle) openCarRadio(players[0]);
      }
      if (e.code === 'KeyN') {
        e.preventDefault();
        closeCarRadio();
        if (_radioAudio) { try { _radioAudio.pause(); } catch (err) {} }
      }
      if (e.code === 'KeyK') {
        e.preventDefault();
        // كلاكس
        if (players[0].vehicle) playHorn();
      }
      if (e.code === 'Digit1' || e.code === 'Numpad1') {
        if (players[0].vehicle && (!players[0].vehicleSeat || players[0].vehicleSeat === 'driver')) {
          // غيار 1 — تحت
        } else {
          e.preventDefault();
          selectWeaponSlot(0);
        }
      }
      if (e.code === 'Digit2' || e.code === 'Numpad2') {
        if (players[0].vehicle && (!players[0].vehicleSeat || players[0].vehicleSeat === 'driver')) {
          // غيار 2 — تحت
        } else {
          e.preventDefault();
          selectWeaponSlot(1);
        }
      }
      if (e.code === 'KeyT') {
        e.preventDefault();
        if (state.phoneHeld && state.inventory.phone) {
          dropPhone(players[0]);
        } else {
          throwWeapon(players[0]);
        }
      }
      if (e.code === 'KeyM') {
        if (!(players[0] && players[0].vehicle)) {
          e.preventDefault();
          togglePhoneKey();
        }
      }
      if (e.code === 'KeyV') {
        e.preventDefault();
        state.firstPerson = !state.firstPerson;
        toast(state.firstPerson ? 'منظور الشخص الأول' : 'منظور الشخص الثالث', 'info');
      }
      if (e.code === 'KeyE') {
        // اتصال عامل توصيل بنزين
        tryRequestFuelDelivery(players[0]);
      }
      if (e.code === 'KeyF') {
        tryOpenBossOffice(players[0]);
      }
      // تغيير الغيارات 1-5
      if (players[0].vehicle && (!players[0].vehicleSeat || players[0].vehicleSeat === 'driver')) {
        var gmap = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4, Numpad5: 5 };
        if (gmap[e.code]) {
          e.preventDefault();
          setVehicleGear(players[0].vehicle, gmap[e.code], players[0]);
        }
      }
    }
    if (e.code === 'Escape') {
      if (state.mode === 'build') {
        e.preventDefault();
        toggleBuildPauseMenu();
      } else if (state.mode === 'lobby') {
        showScreen('menu');
      }
      // play mode Escape handled by pause listener (capture)
    }
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
      // Ctrl في البناء = تبديل نظر / أدوات
      if (state.mode === 'build') {
        e.preventDefault();
        if (document.pointerLockElement === canvas) {
          state.mouseHidden = false;
          document.body.style.cursor = 'default';
          try { document.exitPointerLock(); } catch (ePl2) {}
          toast('الماوس ظاهر — وضع / تحديد / تحريك', 'info');
        } else {
          state.mouseHidden = true;
          document.body.style.cursor = 'none';
          try { state.flyPos.copy(buildCamera.position); } catch (e2) {}
          try { if (canvas.requestPointerLock) canvas.requestPointerLock(); } catch (e3) {}
          if (flyIndicator) flyIndicator.style.display = 'block';
          toast('وضع النظر — حرك الماوس | Ctrl للرجوع', 'info');
        }
        return;
      }
      if (state.mode === 'play') {
        e.preventDefault();
        state.mouseHidden = !state.mouseHidden;
        if (state.mouseHidden) { document.body.style.cursor = 'none'; canvas.requestPointerLock && canvas.requestPointerLock(); }
        else { document.body.style.cursor = 'default'; document.exitPointerLock && document.exitPointerLock(); }
      }
    }
    // F في البناء = وضع النظر (قفل الماوس) / رجوع للأدوات
    if (e.code === 'KeyF' && state.mode === 'build' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (document.pointerLockElement === canvas) {
        state.mouseHidden = false;
        document.body.style.cursor = 'default';
        try { document.exitPointerLock(); } catch (e1) {}
        toast('وضع البناء — الماوس حر', 'info');
      } else {
        state.mouseHidden = true;
        document.body.style.cursor = 'none';
        try { state.flyPos.copy(buildCamera.position); } catch (e2) {}
        try { canvas.requestPointerLock(); } catch (e3) {}
        if (flyIndicator) flyIndicator.style.display = 'block';
        toast('وضع النظر — حرك الماوس | Ctrl أو F للرجوع', 'info');
      }
    }
  });
  window.addEventListener('keyup', function (e) { state.keys[e.code] = false; if (e.code === 'KeyY') window._buildMultiY = false; });

  window.addEventListener('mousemove', function (e) {
    if (state.mode === 'build') {
      if (document.pointerLockElement === canvas) {
        state.flyYaw -= e.movementX * state.mouseSens;
        state.flyPitch -= e.movementY * (state.mouseSens * 0.8);
        state.flyPitch = Math.max(-1.2, Math.min(1.2, state.flyPitch));
      } else {
        onBuildMove(e);
      }
    }
    if (state.mode === 'play' && players[0].group && (state.mouseHidden || document.pointerLockElement === canvas)) {
      // Only pause P0 movement when P0 has menu; still block look if P0 paused
      if (state.paused && state.pauseOwner === 0) return;
      var sens0 = 0.0005 * (players[0].settings.sens || 5);
      var invX = state.invertMouseX ? -1 : 1;
      var invY = state.invertMouseY ? -1 : 1;
      players[0].yaw -= e.movementX * sens0 * invX;
      // كاميرا حرة رأسيًا (زي ببجي)
      if (players[0].pitch == null) players[0].pitch = 0.25;
      players[0].pitch -= e.movementY * sens0 * invY;
      players[0].pitch = Math.max(-1.2, Math.min(1.35, players[0].pitch));
    }
  });
  
  // اختيار سائق/مرافق بالماوس + لمبة بالماوس
  var seatChoiceEl = null;
  function hideSeatChoice() {
    if (seatChoiceEl) { seatChoiceEl.remove(); seatChoiceEl = null; }
  }
  function showSeatChoice(vehicle, sx, sy) {
    hideSeatChoice();
    var d = document.createElement('div');
    d.id = 'seat-choice';
    d.style.cssText = 'position:fixed;left:' + sx + 'px;top:' + sy + 'px;z-index:160;transform:translate(-50%,-110%);background:rgba(8,12,24,0.94);border:1px solid rgba(34,211,238,0.4);border-radius:14px;padding:10px;display:flex;gap:8px;direction:rtl;box-shadow:0 12px 40px rgba(0,0,0,0.45);';
    var b1 = document.createElement('button');
    b1.className = 'btn btn-sm btn-primary';
    b1.textContent = 'سائق';
    b1.onclick = function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      hideSeatChoice();
      enterVehicle(players[0], vehicle, 'driver');
    };
    var b2 = document.createElement('button');
    b2.className = 'btn btn-sm btn-accent';
    b2.textContent = 'مرافق';
    b2.onclick = function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      hideSeatChoice();
      enterVehicle(players[0], vehicle, 'passenger');
    };
    d.appendChild(b1); d.appendChild(b2);
    document.body.appendChild(d);
    seatChoiceEl = d;
  }


  window.addEventListener('mousedown', function (e) {
    if (state.mode !== 'build') return;
    if (document.pointerLockElement === canvas) return;
    if (e.button !== 0) return;
    if (e.target && e.target.closest) {
      if (e.target.closest('button, input, select, label, a, #car-fuel-modal, #gas-place-modal, #choice-modal, #obj-toolbar, .hierarchy-panel, .build-toolbar, .build-sidebar-wrap, .level-panel, #respawn-choice-panel, .catalog-item')) return;
    }
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, buildCamera);
    if (selectedBuildObj && transformGizmo && (objToolMode === 'move' || objToolMode === 'scale')) {
      var axisHit = pickGizmo(raycaster);
      if (axisHit) {
        e.preventDefault();
        e.stopPropagation();
        try { if (e.target && e.target.setPointerCapture) e.target.setPointerCapture(e.pointerId); } catch (err) {}
        var origin = selectedBuildObj.position.clone();
        var axisDir = new THREE.Vector3(
          axisHit === 'x' ? 1 : 0,
          axisHit === 'y' ? 1 : 0,
          axisHit === 'z' ? 1 : 0
        );
        var hitPoint = null;
        var hitsG = raycaster.intersectObject(transformGizmo, true);
        if (hitsG.length) hitPoint = hitsG[0].point.clone();
        gizmoDrag = {
          axis: axisHit,
          mode: objToolMode,
          startX: e.clientX,
          startY: e.clientY,
          startPos: selectedBuildObj.position.clone(),
          startScale: selectedBuildObj.scale.clone(),
          origin: origin,
          axisDir: axisDir.clone(),
          startPointerDist: 0,
          grabbed: true
        };
        // خزّن مواضع/مقاسات البداية لكل المحدد (مجموعة واحدة)
        getSelectedObjects().forEach(function (o) {
          if (!o.userData) o.userData = {};
          o.userData._multiStartPos = o.position.clone();
          o.userData._multiStartScale = o.scale.clone();
          o.userData._multiStartRotY = o.rotation.y;
        });
        // احسب المسافة على المحور من تقاطع الماوس مع مستوى المحور
        (function () {
          var toCam = new THREE.Vector3().subVectors(buildCamera.position, origin);
          var planeN = new THREE.Vector3().crossVectors(axisDir, toCam);
          if (planeN.lengthSq() < 1e-8) {
            planeN = new THREE.Vector3().crossVectors(axisDir, new THREE.Vector3(0, 1, 0));
            if (planeN.lengthSq() < 1e-8) planeN = new THREE.Vector3().crossVectors(axisDir, new THREE.Vector3(1, 0, 0));
          }
          planeN.crossVectors(planeN, axisDir).normalize();
          var plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeN, origin);
          var hp = new THREE.Vector3();
          if (raycaster.ray.intersectPlane(plane, hp)) {
            gizmoDrag.startPointerDist = hp.clone().sub(origin).dot(axisDir);
          } else if (hitPoint) {
            gizmoDrag.startPointerDist = hitPoint.clone().sub(origin).dot(axisDir);
          }
        })();
        var cam = buildCamera;
        var axisEnd = origin.clone().add(axisDir);
        var a0 = origin.clone().project(cam);
        var a1 = axisEnd.clone().project(cam);
        gizmoDrag.screenAxis = new THREE.Vector2(a1.x - a0.x, a1.y - a0.y);
        if (gizmoDrag.screenAxis.length() > 1e-6) gizmoDrag.screenAxis.normalize();
        else gizmoDrag.screenAxis.set(1, 0);
        setGizmoHover(axisHit);
        document.body.style.cursor = 'grabbing';
        return;
      }
    }
  }, true);
  window.addEventListener('click', function (e) {
    if (state.mode === 'build') {
      // لو الماوس مقفول (نظر) متتعملش وضع بالغلط
      if (document.pointerLockElement === canvas) return;
      if (state._gizmoJustDragged) {
        state._gizmoJustDragged = false;
        return;
      }
      onBuildClick(e);
    }
  });
  window.addEventListener('mouseup', function () {
    var wasDrag = !!(gizmoDrag && gizmoDrag.grabbed);
    if (wasDrag) {
      state._gizmoJustDragged = true;
      document.body.style.cursor = '';
    }
    gizmoDrag = null;
    try {
      getSelectedObjects().forEach(function (o) {
        if (!o || !o.userData) return;
        delete o.userData._multiStartPos;
        delete o.userData._multiStartScale;
        delete o.userData._multiStartRotY;
      });
    } catch (e) {}
    scheduleAutoSave();
    if (wasDrag) {
      try { netSyncSelectedTransforms(); } catch (eN) {}
    }
    if (typeof setGizmoHover === 'function') setGizmoHover(null);
  });
  window.addEventListener('gamepadconnected', function (e) {
    document.getElementById('gamepad-hint').textContent = 'دراعة: ' + e.gamepad.id + ' — اضغط ✕';
  });


  // ===== HIERARCHY =====
  var selectedHierarchyObj = null;
  var moveModeObj = null;
  var selectedBuildObj = null;
  var selectedBuildObjs = []; // تحديد متعدد (Y)
  var isDraggingObj = false;
  var objToolMode = null; // move | rotate | scale
  var dragOffset = new THREE.Vector3();
  var originalMaterials = [];



  function clearObjectHighlight(obj) {
    if (!obj) return;
    if (obj.userData && obj.userData._hlMats) {
      obj.userData._hlMats.forEach(function (o) {
        if (!o || !o.mat) return;
        try {
          if (o.color && o.mat.color) o.mat.color.copy(o.color);
          if (o.mat.emissive) {
            if (o.emissive) o.mat.emissive.copy(o.emissive);
            else o.mat.emissive.setHex(0x000000);
            o.mat.emissiveIntensity = o.ei != null ? o.ei : 0;
          }
        } catch (e) {}
      });
      delete obj.userData._hlMats;
    }
    // احتياطي: لو التمييز عالق من غير _hlMats
    try {
      obj.traverse(function (child) {
        if (!child.isMesh || !child.material) return;
        var mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(function (m) {
          if (!m || !m.emissive) return;
          // لو إيميشن أخضر تمييز — اطفيه
          var e = m.emissive;
          if (e.g > 0.3 && e.g > e.r && e.g > e.b && (m.emissiveIntensity || 0) > 0.1) {
            m.emissive.setHex(0x000000);
            m.emissiveIntensity = 0;
          }
        });
      });
    } catch (e2) {}
  }

  function setObjectHighlight(obj, lightGreen) {
    if (!obj) return;
    clearObjectHighlight(obj);
    var saved = [];
    obj.traverse(function (child) {
      if (!child.isMesh || !child.material) return;
      var list = Array.isArray(child.material) ? child.material.slice() : [child.material];
      var newList = [];
      for (var mi = 0; mi < list.length; mi++) {
        var m = list[mi];
        if (!m) { newList.push(m); continue; }
        var cloned = m.clone();
        saved.push({
          mat: cloned,
          color: cloned.color ? cloned.color.clone() : null,
          emissive: cloned.emissive ? cloned.emissive.clone() : null,
          ei: cloned.emissiveIntensity || 0
        });
        if (cloned.color) cloned.color.lerp(new THREE.Color(0x66ff88), 0.35);
        if (cloned.emissive) {
          cloned.emissive.set(0x22aa44);
          cloned.emissiveIntensity = 0.25;
        }
        newList.push(cloned);
      }
      child.material = Array.isArray(child.material) ? newList : newList[0];
    });
    if (!obj.userData) obj.userData = {};
    obj.userData._hlMats = saved;
  }


  // ===== Transform Gizmo (move / scale axes) =====
  var transformGizmo = null;
  var gizmoDrag = null; // { axis, mode, startMouse, startPos, startScale }
  var gizmoHoverAxis = null;

  function makeAxisArrow(color, axis) {
    var g = new THREE.Group();
    g.userData.gizmoAxis = axis;
    g.userData.isGizmo = true;
    var mat = new THREE.MeshBasicMaterial({ color: color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.98 });
    mat.toneMapped = false;
    var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.35, 10), mat);
    var head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.35, 12), mat.clone());
    shaft.renderOrder = 1000;
    head.renderOrder = 1000;
    if (axis === 'x') {
      shaft.rotation.z = -Math.PI / 2;
      shaft.position.x = 0.7;
      head.rotation.z = -Math.PI / 2;
      head.position.x = 1.45;
    } else if (axis === 'y') {
      shaft.position.y = 0.7;
      head.position.y = 1.45;
    } else {
      shaft.rotation.x = Math.PI / 2;
      shaft.position.z = 0.7;
      head.rotation.x = Math.PI / 2;
      head.position.z = 1.45;
    }
    shaft.userData.gizmoAxis = axis;
    shaft.userData.isGizmo = true;
    head.userData.gizmoAxis = axis;
    head.userData.isGizmo = true;
    g.add(shaft);
    g.add(head);
    // fat invisible collider so mouse easy to grab
    var pickMat = new THREE.MeshBasicMaterial({ visible: false });
    var pick = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 2.2, 8), pickMat);
    pick.rotation.copy(shaft.rotation);
    pick.position.copy(shaft.position);
    pick.userData.gizmoAxis = axis;
    pick.userData.isGizmo = true;
    g.add(pick);
    return g;
  }

  function makeScaleHandle(color, axis) {
    var g = new THREE.Group();
    g.userData.gizmoAxis = axis;
    g.userData.isGizmo = true;
    var mat = new THREE.MeshBasicMaterial({ color: color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.98 });
    mat.toneMapped = false;
    var box = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), mat);
    box.renderOrder = 1000;
    if (axis === 'x') box.position.x = 1.25;
    else if (axis === 'y') box.position.y = 1.25;
    else box.position.z = 1.25;
    box.userData.gizmoAxis = axis;
    box.userData.isGizmo = true;
    g.add(box);
    var line = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 8), mat.clone());
    line.renderOrder = 1000;
    if (axis === 'x') { line.rotation.z = -Math.PI / 2; line.position.x = 0.55; }
    else if (axis === 'y') { line.position.y = 0.55; }
    else { line.rotation.x = Math.PI / 2; line.position.z = 0.55; }
    line.userData.gizmoAxis = axis;
    line.userData.isGizmo = true;
    g.add(line);
    var pickMat = new THREE.MeshBasicMaterial({ visible: false });
    var pick = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), pickMat);
    pick.position.copy(box.position);
    pick.userData.gizmoAxis = axis;
    pick.userData.isGizmo = true;
    g.add(pick);
    return g;
  }

  function disposeGizmo() {
    if (!transformGizmo) return;
    scene.remove(transformGizmo);
    transformGizmo.traverse(function (c) {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    transformGizmo = null;
    gizmoDrag = null;
    scheduleAutoSave();
    gizmoHoverAxis = null;
    try { document.body.style.cursor = ''; } catch (e) {}
  }

  function rebuildGizmo() {
    disposeGizmo();
    if (!selectedBuildObj || state.mode !== 'build') return;
    var mode = objToolMode || 'move';
    if (mode !== 'move' && mode !== 'scale') return;
    var root = new THREE.Group();
    root.userData.isGizmo = true;
    root.renderOrder = 999;
    if (mode === 'move') {
      root.add(makeAxisArrow(0xff3333, 'x'));
      root.add(makeAxisArrow(0x33ff66, 'y'));
      root.add(makeAxisArrow(0x3388ff, 'z'));
    } else {
      // scale
      root.add(makeScaleHandle(0xff3333, 'x'));
      root.add(makeScaleHandle(0x33ff66, 'y'));
      root.add(makeScaleHandle(0x3388ff, 'z'));
    }
    transformGizmo = root;
    scene.add(transformGizmo);
    syncGizmoTransform();
  }

  function syncGizmoTransform() {
    if (!transformGizmo || !selectedBuildObj) return;
    transformGizmo.position.copy(selectedBuildObj.position);
    // keep gizmo readable size relative to camera distance
    var dist = buildCamera.position.distanceTo(selectedBuildObj.position);
    var s = Math.max(0.85, Math.min(3.2, dist * 0.1));
    transformGizmo.scale.set(s, s, s);
  }

  function pickGizmo(raycaster) {
    if (!transformGizmo) return null;
    var hits = raycaster.intersectObject(transformGizmo, true);
    if (!hits.length) return null;
    // nearest hit with axis
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      var guard = 0;
      while (o && !o.userData.gizmoAxis && guard++ < 8) o = o.parent;
      if (o && o.userData.gizmoAxis) return o.userData.gizmoAxis;
    }
    return null;
  }

  function setGizmoHover(axis) {
    if (!transformGizmo) { gizmoHoverAxis = null; return; }
    if (gizmoHoverAxis === axis) return;
    gizmoHoverAxis = axis;
    transformGizmo.children.forEach(function (child) {
      var ax = child.userData && child.userData.gizmoAxis;
      var active = ax && axis && ax === axis;
      child.traverse(function (c) {
        if (!c.isMesh || !c.material || c.material.visible === false) return;
        if (c.userData && c.userData.isGizmo && c.material.color) {
          // restore base color from axis
          var base = ax === 'x' ? 0xff3333 : (ax === 'y' ? 0x33ff66 : 0x3388ff);
          if (active) {
            c.material.color.setHex(0xffffff);
            c.material.opacity = 1;
            if (c.geometry && c.geometry.type === 'CylinderGeometry') {
              // thicken shaft slightly via scale
              c.scale.set(1.55, 1, 1.55);
            } else if (c.geometry && (c.geometry.type === 'ConeGeometry' || c.geometry.type === 'BoxGeometry')) {
              c.scale.set(1.35, 1.35, 1.35);
            }
          } else {
            c.material.color.setHex(base);
            c.material.opacity = 0.98;
            c.scale.set(1, 1, 1);
          }
        }
      });
    });
    document.body.style.cursor = axis ? 'grab' : '';
  }


  function faceSelectedTowardCamera() {
    if (!selectedBuildObj || typeof buildCamera === 'undefined' || !buildCamera) return;
    var cam = buildCamera.position;
    getSelectedObjects().forEach(function (o) {
      if (!o) return;
      var dx = cam.x - o.position.x;
      var dz = cam.z - o.position.z;
      if (dx * dx + dz * dz < 0.0001) return;
      // يواجه الكاميرا
      o.rotation.y = Math.atan2(dx, dz);
    });
    try { netSyncSelectedTransforms(); } catch (e) {}
    try { scheduleAutoSave(); } catch (e2) {}
  }

  function selectBuildObject(obj, addToMulti) {
    if (!addToMulti) {
      // مسح التحديد السابق
      selectedBuildObjs.forEach(function (o) { try { clearObjectHighlight(o); } catch (e) {} });
      selectedBuildObjs = [];
      if (selectedBuildObj && selectedBuildObj !== obj) {
        try { clearObjectHighlight(selectedBuildObj); } catch (e) {}
      }
    }
    if (!obj) {
      selectedBuildObj = null;
      selectedBuildObjs = [];
      selectedHierarchyObj = null;
      isDraggingObj = false;
      objToolMode = null;
      hideObjToolbar();
      disposeGizmo();
      refreshHierarchy();
      return;
    }
    if (addToMulti) {
      var ix = selectedBuildObjs.indexOf(obj);
      if (ix >= 0) {
        selectedBuildObjs.splice(ix, 1);
        try { clearObjectHighlight(obj); } catch (e) {}
      } else {
        selectedBuildObjs.push(obj);
        try { setObjectHighlight(obj, true); } catch (e) {}
      }
      if (selectedBuildObjs.indexOf(selectedBuildObj) < 0) {
        selectedBuildObj = selectedBuildObjs[0] || null;
      }
    } else {
      selectedBuildObjs = [obj];
      selectedBuildObj = obj;
      try { setObjectHighlight(obj, true); } catch (e) {}
    }
    selectedHierarchyObj = selectedBuildObj;
    isDraggingObj = false;
    objToolMode = selectedBuildObj ? 'move' : null;
    if (selectedBuildObj) {
      showObjToolbar(selectedBuildObj);
      rebuildGizmo();
      if (selectedBuildObjs.length > 1) {
        toast('محدد: ' + selectedBuildObjs.length + ' عناصر', 'info');
      }
    } else {
      hideObjToolbar();
      disposeGizmo();
    }
    refreshHierarchy();
    updateScaleModeButtons();
  }

  function getSelectedObjects() {
    if (selectedBuildObjs && selectedBuildObjs.length) return selectedBuildObjs.slice();
    if (selectedBuildObj) return [selectedBuildObj];
    return [];
  }

  function uniqueInstanceName(base) {
    base = (base || 'نسخة').replace(/\s+\d+$/, '');
    var names = {};
    state.buildObjects.forEach(function (o) {
      if (o && o.userData && o.userData.instanceName) names[o.userData.instanceName] = true;
    });
    var n = 2;
    var newName = base + ' ' + n;
    while (names[newName]) { n++; newName = base + ' ' + n; }
    return newName;
  }

  function deleteSelectedBuildObjects() {
    var toDel = getSelectedObjects();
    if (!toDel.length) return;
    // مزامنة الحذف أونلاين
    if (state.buildCollabOnline) {
      try {
        var keys = toDel.map(function (o) {
          if (!o.userData) o.userData = {};
          if (!o.userData._netBuildKey) {
            o.userData._netBuildKey = 'nb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
          }
          return o.userData._netBuildKey;
        }).filter(Boolean);
        if (keys.length) netBuildOp('delete', { keys: keys });
      } catch (eN) {}
    }
    disposeGizmo();
    toDel.forEach(function (o) {
      try { clearObjectHighlight(o); } catch (e) {}
      try { scene.remove(o); } catch (e) {}
    });
    state.buildObjects = state.buildObjects.filter(function (o) { return toDel.indexOf(o) === -1; });
    scheduleAutoSave();
    selectBuildObject(null);
    var oc = document.getElementById('object-count');
    if (oc) oc.textContent = state.buildObjects.length + ' عنصر';
    refreshHierarchy();
    toast(toDel.length > 1 ? ('تم حذف ' + toDel.length + ' عناصر') : 'تم الحذف', 'success');
  }

  function duplicateSelectedBuildObjects() {
    var srcs = getSelectedObjects();
    if (!srcs.length) return;
    try {
      // شيل التمييز الأخضر قبل النسخ عشان النسخة متاخدش اللون الأخضر
      srcs.forEach(function (s) { try { clearObjectHighlight(s); } catch (eH) {} });
      var copies = [];
      srcs.forEach(function (src) {
        if (!src) return;
        var copy = src.clone(true);
        try {
          copy.userData = JSON.parse(JSON.stringify(src.userData || {}));
        } catch (eU) {
          copy.userData = Object.assign({}, src.userData);
        }
        if (copy.userData) {
          delete copy.userData.netVehicleId;
          delete copy.userData._hlMats;
          // احتفظ بـ buildId (معرف الكتالوج) عشان النسخة تظهر صح عند الصديق مش بلوك أزرق
          if (!copy.userData.buildId && src.userData && src.userData.buildId) {
            copy.userData.buildId = src.userData.buildId;
          }
          if (copy.userData.isVehicle) {
            copy.userData.netVehicleId = 'veh_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
            copy.userData.seats = { driver: null, passenger: null };
            copy.userData.engineOn = false;
            copy.userData.drivenByNet = null;
          }
        }
        copy.position.x += 2;
        copy.position.z += 2;
        var base = (src.userData && (src.userData.instanceName || src.userData.buildId)) || 'نسخة';
        copy.userData.instanceName = uniqueInstanceName(base);
        copy.userData._netBuildKey = 'nb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        if (!copy.userData.buildId && src.userData) copy.userData.buildId = src.userData.buildId;
        // مواد مستقلة من غير تمييز أخضر
        copy.traverse(function (ch) {
          if (ch.isMesh && ch.material) {
            if (Array.isArray(ch.material)) {
              ch.material = ch.material.map(function (m) {
                var nm = m.clone();
                if (nm.emissive) { nm.emissive.setHex(0x000000); nm.emissiveIntensity = 0; }
                return nm;
              });
            } else {
              ch.material = ch.material.clone();
              if (ch.material.emissive) {
                ch.material.emissive.setHex(0x000000);
                ch.material.emissiveIntensity = 0;
              }
            }
          }
        });
        scene.add(copy);
        state.buildObjects.push(copy);
        copies.push(copy);
      });
      if (!copies.length) return;
      // مزامنة النسخ أونلاين
      if (state.buildCollabOnline) {
        copies.forEach(function (c) {
          try {
            c.userData._netBuildKey = 'nb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
            var od = {
              id: c.userData.buildId || (src && src.userData && src.userData.buildId) || 'ix_car_red',
              position: { x: c.position.x, y: c.position.y, z: c.position.z },
              rotation: { x: c.rotation.x, y: c.rotation.y, z: c.rotation.z },
              scale: { x: c.scale.x, y: c.scale.y, z: c.scale.z },
              instanceName: c.userData.instanceName || '',
              _netBuildKey: c.userData._netBuildKey,
              isVehicle: !!c.userData.isVehicle,
              interactive: !!c.userData.interactive,
              interactiveType: c.userData.interactiveType || null,
              fuelInfinite: c.userData.fuelInfinite,
              fuel: c.userData.fuel,
              fuelConsume: c.userData.fuelConsume,
              driveMode: c.userData.driveMode || null,
              isGasStation: !!c.userData.isGasStation,
              isGarage: !!c.userData.isGarage
            };
            netBuildOp('place', { key: c.userData._netBuildKey, object: od });
          } catch (eC) {}
        });
      }
      selectedBuildObjs.forEach(function (o) { try { clearObjectHighlight(o); } catch (e) {} });
      selectedBuildObjs = copies.slice();
      selectedBuildObj = copies[0];
      copies.forEach(function (c) { try { setObjectHighlight(c, true); } catch (e) {} });
      selectedHierarchyObj = selectedBuildObj;
      scheduleAutoSave();
      objToolMode = 'move';
      rebuildGizmo();
      showObjToolbar(selectedBuildObj);
      var oc = document.getElementById('object-count');
      if (oc) oc.textContent = state.buildObjects.length + ' عنصر';
      refreshHierarchy();
      toast(copies.length > 1 ? ('تم نسخ ' + copies.length + ' عناصر') : 'تم النسخ — حرّك بالمحاور', 'success');
    } catch (err) {
      toast('فشل النسخ', 'error');
      console.warn(err);
    }
  }

  function showObjToolbar(obj) {
    var tb = document.getElementById('obj-toolbar');
    if (!tb || !obj) return;
    tb.classList.remove('hidden');
    // position above object in screen space
    updateObjToolbarPos();
    tb.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-action') === objToolMode);
    });
  }

  function hideObjToolbar() {
    var tb = document.getElementById('obj-toolbar');
    if (tb) tb.classList.add('hidden');
  }

  function updateObjToolbarPos() {
    var tb = document.getElementById('obj-toolbar');
    if (!tb || !selectedBuildObj || tb.classList.contains('hidden')) return;
    var pos = selectedBuildObj.position.clone();
    pos.y += 2.5;
    pos.project(buildCamera);
    var x = (pos.x * 0.5 + 0.5) * window.innerWidth;
    var y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
    tb.style.left = (x - 90) + 'px';
    tb.style.top = (y - 50) + 'px';
  }

  function updateScaleModeButtons() {
    var tb = document.getElementById('obj-toolbar');
    if (!tb) return;
    var show = objToolMode === 'scale';
    tb.querySelectorAll('.scale-mode-btn').forEach(function (b) {
      if (show) b.classList.remove('hidden');
      else b.classList.add('hidden');
      var act = b.getAttribute('data-action');
      if (act === 'scale-uniform') b.classList.toggle('active', state.scaleMode === 'uniform');
      if (act === 'scale-axis') b.classList.toggle('active', state.scaleMode === 'axis');
    });
  }

  function bindObjToolbar() {
    var tb = document.getElementById('obj-toolbar');
    if (!tb) return;
    tb.querySelectorAll('button').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var action = btn.getAttribute('data-action');
        if (!selectedBuildObj) return;
        if (action === 'delete') {
          deleteSelectedBuildObjects();
          return;
        }
        if (action === 'duplicate') {
          duplicateSelectedBuildObjects();
          return;
        }
        if (action === 'confirm-rotate') {
          try { netSyncSelectedTransforms(); } catch (e) {}
          state._rotateDirty = false;
          try {
            var cr2 = document.querySelector('#obj-toolbar [data-action="confirm-rotate"]');
            if (cr2) cr2.classList.add('hidden');
          } catch (e2) {}
          scheduleAutoSave();
          toast('تم تأكيد الدوران — اتزامن عند الكل', 'success');
          return;
        }
        if (action === 'scale-uniform') {
          state.scaleMode = 'uniform';
          updateScaleModeButtons();
          toast('تكبير كلي (كل المحاور معاً)', 'info');
          return;
        }
        if (action === 'scale-axis') {
          state.scaleMode = 'axis';
          updateScaleModeButtons();
          toast('تكبير محاور (X / Y / Z منفصل)', 'info');
          return;
        }
        objToolMode = action;
        isDraggingObj = false;
        gizmoDrag = null;
        tb.querySelectorAll('button').forEach(function (b) {
          var a = b.getAttribute('data-action');
          if (a === 'scale-uniform' || a === 'scale-axis' || a === 'confirm-rotate') return;
          b.classList.toggle('active', a === action);
        });
        try {
          var crb = tb.querySelector('[data-action="confirm-rotate"]');
          if (crb) {
            if (action === 'rotate') crb.classList.remove('hidden');
            else crb.classList.add('hidden');
          }
        } catch (eC) {}
        updateScaleModeButtons();
        rebuildGizmo();
        var labels = { move: 'وضع التحريك — اسحب الأسهم', rotate: 'دوران — بعد ما تخلّص اضغط ✓ تأكيد', scale: 'وضع التكبير — اسحب المقابض' };
        toast(labels[action] || action, 'info');
      };
    });
  }


  function refreshHierarchy() {
    var list = document.getElementById('hierarchy-list');
    if (!list) return;
    list.innerHTML = '';
    // Group by buildId
    var groups = {};
    state.buildObjects.forEach(function (obj, idx) {
      var id = obj.userData.buildId || 'unknown';
      if (!groups[id]) groups[id] = { name: (obj.userData.catalogItem && obj.userData.catalogItem.name) || id, items: [] };
      groups[id].items.push({ obj: obj, idx: idx });
    });
    Object.keys(groups).forEach(function (gid) {
      var g = groups[gid];
      var groupEl = document.createElement('div');
      groupEl.className = 'hierarchy-group';
      var title = document.createElement('div');
      title.className = 'hierarchy-group-title';
      title.innerHTML = '<span>' + g.name + ' (' + g.items.length + ')</span><span>▸</span>';
      var children = document.createElement('div');
      children.className = 'hierarchy-children';
      title.onclick = function () {
        var open = children.classList.toggle('open');
        title.classList.toggle('open', open);
        title.querySelector('span:last-child').textContent = open ? '▾' : '▸';
      };
      g.items.forEach(function (entry) {
        var item = document.createElement('div');
        item.className = 'hierarchy-item';
        item.textContent = entry.obj.userData.instanceName || g.name;
        item.ondblclick = function () {
          focusOnObject(entry.obj);
          selectBuildObject(entry.obj);
          isDraggingObj = true;
          objToolMode = 'move';
        };
        item.oncontextmenu = function (e) {
          e.preventDefault();
          e.stopPropagation();
          selectedHierarchyObj = entry.obj;
          showContextMenu(e.clientX, e.clientY, item);
          // Don't full refresh - keep menu open; just mark selected visually
          document.querySelectorAll('.hierarchy-item.selected').forEach(function (el) { el.classList.remove('selected'); });
          item.classList.add('selected');
        };
        item.onclick = function () {
          selectBuildObject(entry.obj);
        };
        if (selectedBuildObj === entry.obj || selectedHierarchyObj === entry.obj) item.classList.add('selected');
        children.appendChild(item);
      });
      groupEl.appendChild(title);
      groupEl.appendChild(children);
      list.appendChild(groupEl);
    });
    if (!Object.keys(groups).length) {
      list.innerHTML = '<div style="color:#8e9aaf;font-size:0.8rem;padding:8px">لا توجد كائنات</div>';
    }
  }

  function showContextMenu(x, y, anchorEl) {
    var menu = document.getElementById('context-menu');
    if (!menu) return;
    var title = document.getElementById('ctx-title');
    if (title && selectedHierarchyObj) {
      title.textContent = selectedHierarchyObj.userData.instanceName || selectedHierarchyObj.userData.buildId || 'كائن';
    }
    // Mark active item
    document.querySelectorAll('.hierarchy-item.ctx-active').forEach(function (el) { el.classList.remove('ctx-active'); });
    if (anchorEl) anchorEl.classList.add('ctx-active');

    menu.classList.remove('hidden');
    // Position next to the item
    if (anchorEl) {
      var rect = anchorEl.getBoundingClientRect();
      var menuW = 160;
      var left = rect.right + 8;
      if (left + menuW > window.innerWidth) left = rect.left - menuW - 8;
      var top = rect.top;
      if (top + 220 > window.innerHeight) top = window.innerHeight - 230;
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
    } else {
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';
    }
  }
  function hideContextMenu() {
    var menu = document.getElementById('context-menu');
    if (menu) menu.classList.add('hidden');
    document.querySelectorAll('.hierarchy-item.ctx-active').forEach(function (el) { el.classList.remove('ctx-active'); });
  }

  // Close only when clicking outside menu and hierarchy
  document.addEventListener('click', function (e) {
    var menu = document.getElementById('context-menu');
    if (!menu || menu.classList.contains('hidden')) return;
    if (menu.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.hierarchy-item')) return;
    hideContextMenu();
  });

  // Context menu actions - bind after DOM ready in init
  function highlightObject(obj, durationMs) {
    if (!obj) return;
    var originals = [];
    obj.traverse(function (child) {
      if (child.isMesh && child.material) {
        var mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(function (m) {
          originals.push({ mat: m, color: m.color ? m.color.clone() : null, emissive: m.emissive ? m.emissive.clone() : null, ei: m.emissiveIntensity });
          if (m.color) m.color.set(0x00ff44);
          if (m.emissive) { m.emissive.set(0x00ff44); m.emissiveIntensity = 0.6; }
        });
      }
    });
    setTimeout(function () {
      originals.forEach(function (o) {
        if (o.color && o.mat.color) o.mat.color.copy(o.color);
        if (o.emissive && o.mat.emissive) {
          o.mat.emissive.copy(o.emissive);
          o.mat.emissiveIntensity = o.ei || 0;
        }
      });
    }, durationMs || 2000);
  }

  function focusOnObject(obj) {
    if (!obj) return;
    var p = obj.position;
    state.flyPos.set(p.x + 8, Math.max(p.y + 6, 6), p.z + 8);
    buildCamera.position.copy(state.flyPos);
    buildCamera.lookAt(p.x, p.y + 1, p.z);
  }

  function bindContextMenu() {
    var rn = document.getElementById('ctx-rename');
    var mv = document.getElementById('ctx-move');
    var dl = document.getElementById('ctx-delete');
    var gt = document.getElementById('ctx-goto');
    var hl = document.getElementById('ctx-highlight');

    if (gt) gt.onclick = function (e) {
      e.stopPropagation();
      if (!selectedHierarchyObj) return;
      // انتقال للكاميرا فقط — بدون تفعيل تحريك العنصر
      focusOnObject(selectedHierarchyObj);
      hideContextMenu();
      toast('انتقلت بالكاميرا للعنصر', 'info');
    };
    if (hl) hl.onclick = function (e) {
      e.stopPropagation();
      if (!selectedHierarchyObj) return;
      highlightObject(selectedHierarchyObj, 2000);
      hideContextMenu();
    };
    if (rn) rn.onclick = function (e) {
      e.stopPropagation();
      if (!selectedHierarchyObj) return;
      var obj = selectedHierarchyObj;
      hideContextMenu();
      askName('الاسم الجديد:', obj.userData.instanceName || '', function (newName) {
        if (newName) {
          obj.userData.instanceName = newName;
          refreshHierarchy();
          toast('تم التغيير إلى: ' + newName, 'success');
        }
      });
    };
    if (mv) mv.onclick = function (e) {
      e.stopPropagation();
      if (!selectedHierarchyObj) return;
      moveModeObj = selectedHierarchyObj;
      toast('اضغط على الأرض لنقل الكائن', 'info');
      hideContextMenu();
    };
    if (dl) dl.onclick = function (e) {
      e.stopPropagation();
      if (!selectedHierarchyObj) return;
      scene.remove(selectedHierarchyObj);
      state.buildObjects = state.buildObjects.filter(function (o) { return o !== selectedHierarchyObj; });
      selectedHierarchyObj = null;
      document.getElementById('object-count').textContent = state.buildObjects.length + ' عنصر';
      refreshHierarchy();
      hideContextMenu();
    };
    var ref = document.getElementById('btn-refresh-hierarchy');
    if (ref) ref.onclick = refreshHierarchy;

    // Prevent menu from closing when clicking inside it
    var menu = document.getElementById('context-menu');
    if (menu) {
      menu.addEventListener('click', function (e) { e.stopPropagation(); });
      menu.addEventListener('contextmenu', function (e) { e.preventDefault(); e.stopPropagation(); });
    }
  }

  // Patch onBuildClick for move mode
  var _origOnBuildClick = null;

  // ===== CUSTOMIZATION =====
  var customOptions = {
    hat: ['بدون','قبعة بيسبول','كاب','طاقية','برنيطة','خوذة','تاج','عمامة','قبعة شتوية','قبعة سفر'],
    glasses: ['بدون','نظارة شمس','نظارة طبية','نظارة رياضية','نظارة طيار','مونوكل','نظارة سباحة','نظارة VR','نظارة أنيقة','نظارة مستطيلة'],
    shirt: ['عادي','بولو','هودي','جاكيت','قميص رسمي','تيشيرت رياضي','درع','سترة','قميص كاروهات','تيشيرت طويل'],
    pants: ['عادي','جينز','شورت','رياضي','رسمي','بضاعة','عسكري','واسع','ضيق','بجامة'],
    shoes: ['عادي','رياضي','بوت','صندل','رسمي','كعب','عسكري','جزم مطر','شبشب','حذاء تسلق']
  };
  var playerCustom = [
    { hat: 0, glasses: 0, shirt: 0, pants: 0, shoes: 0, colorHat: '#333333', colorGlasses: '#111111', colorShirt: '#1e40af', colorPants: '#1a252f', colorShoes: '#111111', shirtImage: null },
    { hat: 0, glasses: 0, shirt: 0, pants: 0, shoes: 0, colorHat: '#333333', colorGlasses: '#111111', colorShirt: '#b91c1c', colorPants: '#1a252f', colorShoes: '#111111', shirtImage: null }
  ];

  function fillCustomSelects() {
    ['hat','glasses','shirt','pants','shoes'].forEach(function (key) {
      var sel = document.getElementById('custom-' + key);
      if (!sel) return;
      sel.innerHTML = '';
      customOptions[key].forEach(function (name, i) {
        var opt = document.createElement('option');
        opt.value = i; opt.textContent = name;
        sel.appendChild(opt);
      });
    });
  }

  function applyCustomToUI(playerIdx) {
    var c = playerCustom[playerIdx];
    var map = { hat: 'custom-hat', glasses: 'custom-glasses', shirt: 'custom-shirt', pants: 'custom-pants', shoes: 'custom-shoes' };
    var cmap = { hat: 'color-hat', glasses: 'color-glasses', shirt: 'color-shirt', pants: 'color-pants', shoes: 'color-shoes' };
    Object.keys(map).forEach(function (k) {
      var s = document.getElementById(map[k]); if (s) s.value = c[k];
      var col = document.getElementById(cmap[k]); if (col) col.value = c['color' + k.charAt(0).toUpperCase() + k.slice(1)] || c['color' + k[0].toUpperCase() + k.slice(1)];
    });
    // fix color keys
    if (document.getElementById('color-hat')) document.getElementById('color-hat').value = c.colorHat;
    if (document.getElementById('color-glasses')) document.getElementById('color-glasses').value = c.colorGlasses;
    if (document.getElementById('color-shirt')) document.getElementById('color-shirt').value = c.colorShirt;
    if (document.getElementById('color-pants')) document.getElementById('color-pants').value = c.colorPants;
    if (document.getElementById('color-shoes')) document.getElementById('color-shoes').value = c.colorShoes;
    var st = document.getElementById('shirt-image-status');
    if (st) st.textContent = c.shirtImage ? '✓ في صورة على التيشيرت' : 'الصورة هتظهر قدام على التيشيرت عندك وعند الباقي';
  }

  function compressShirtImageFile(file, cb) {
    if (!file) return cb(null);
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        try {
          var max = 128;
          var w = img.width, h = img.height;
          var scale = Math.min(1, max / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          // jpeg مضغوط عشان الشبكة
          var data = canvas.toDataURL('image/jpeg', 0.7);
          // لو لسه كبير جدًا صغّر أكتر
          if (data.length > 18000) {
            canvas.width = 96; canvas.height = 96;
            ctx.drawImage(img, 0, 0, 96, 96);
            data = canvas.toDataURL('image/jpeg', 0.55);
          }
          cb(data);
        } catch (e) { cb(null); }
      };
      img.onerror = function () { cb(null); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  function readCustomFromUI(playerIdx) {
    var c = playerCustom[playerIdx];
    c.hat = parseInt(document.getElementById('custom-hat').value) || 0;
    c.glasses = parseInt(document.getElementById('custom-glasses').value) || 0;
    c.shirt = parseInt(document.getElementById('custom-shirt').value) || 0;
    c.pants = parseInt(document.getElementById('custom-pants').value) || 0;
    c.shoes = parseInt(document.getElementById('custom-shoes').value) || 0;
    c.colorHat = document.getElementById('color-hat').value;
    c.colorGlasses = document.getElementById('color-glasses').value;
    c.colorShirt = document.getElementById('color-shirt').value;
    c.colorPants = document.getElementById('color-pants').value;
    c.colorShoes = document.getElementById('color-shoes').value;
    // shirtImage محفوظة على الكائن من زر الرفع
  }

  function bindCustomUI() {
    fillCustomSelects();
    (function wireShirtImage() {
      var btn = document.getElementById('btn-shirt-image');
      var inp = document.getElementById('custom-shirt-image');
      var clr = document.getElementById('btn-shirt-image-clear');
      if (btn && inp) {
        btn.onclick = function () { inp.click(); };
        inp.onchange = function () {
          var f = inp.files && inp.files[0];
          if (!f) return;
          var idx = 0;
          try {
            var sel = document.getElementById('custom-player-select');
            if (sel) idx = parseInt(sel.value, 10) || 0;
          } catch (e) {}
          if (state.playType === 'online') idx = 0;
          compressShirtImageFile(f, function (data) {
            if (!data) { toast('فشل تحميل الصورة', 'error'); return; }
            playerCustom[idx].shirtImage = data;
            var st = document.getElementById('shirt-image-status');
            if (st) st.textContent = '✓ تم وضع الصورة على التيشيرت';
            toast('تم رفع صورة التيشيرت', 'success');
            try {
              readCustomFromUI(idx);
              state._lastSentCustomKey = null; // أجبر إرسال المخصص
              if (state.playType === 'online' && state.myNetId) {
                var msg = { type: 'custom', id: state.myNetId, custom: JSON.parse(JSON.stringify(playerCustom[0])), name: state.playerName };
                if (state.isHost) broadcastToAll(msg);
                else if (state.connection) state.connection.send(msg);
              }
            } catch (e2) {}
          });
          inp.value = '';
        };
      }
      if (clr) {
        clr.onclick = function () {
          var idx = 0;
          try {
            var sel = document.getElementById('custom-player-select');
            if (sel) idx = parseInt(sel.value, 10) || 0;
          } catch (e) {}
          if (state.playType === 'online') idx = 0;
          playerCustom[idx].shirtImage = null;
          var st = document.getElementById('shirt-image-status');
          if (st) st.textContent = 'اتمسحت صورة التيشيرت';
          state._lastSentCustomKey = null;
          toast('اتشالت صورة التيشيرت', 'info');
        };
      }
    })();
    var sel = document.getElementById('custom-player-select');
    if (sel) {
      sel.onchange = function () {
        applyCustomToUI(parseInt(sel.value) || 0);
      };
    }
    ['custom-hat','custom-glasses','custom-shirt','custom-pants','custom-shoes','color-hat','color-glasses','color-shirt','color-pants','color-shoes'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.onchange = function () {
        var idx = 0;
        if (state.playType === 'split') {
          idx = parseInt(document.getElementById('custom-player-select').value) || 0;
        }
        // Online: always only own clothes (slot 0)
        readCustomFromUI(idx);
        if (state.playType === 'online' && state.myNetId && typeof playerCustom !== 'undefined') {
          var msg = { type: 'custom', id: state.myNetId, custom: JSON.parse(JSON.stringify(playerCustom[0])), name: state.playerName };
          if (state.netRoster) {
            state.netRoster.forEach(function (r) {
              if (r.id === state.myNetId) r.custom = JSON.parse(JSON.stringify(playerCustom[0]));
            });
          }
          if (state.useLan) lanSend(msg);
          else if (state.isHost) broadcastToAll(msg);
          else if (state.connection) try { state.connection.send(msg); } catch (e) {}
          // حدّث صورتي فوراً عندي كمان
          try { refreshLobbyPreviews(); } catch (e) {}
        } else {
          try { refreshLobbyPreviews(); } catch (e) {}
        }
      };
    });
    applyCustomToUI(0);
  }

  function configureCustomUIForMode() {
    var row = document.getElementById('custom-player-row');
    var sel = document.getElementById('custom-player-select');
    var hint = document.getElementById('custom-owner-hint');
    if (state.playType === 'online') {
      if (row) row.style.display = 'none';
      if (sel) {
        sel.innerHTML = '<option value="0">ملابسي</option>';
        sel.value = '0';
        sel.disabled = true;
      }
      if (hint) hint.textContent = 'تعدل ملابسك أنت فقط — مش تقدر تغيّر لبس حد تاني';
      applyCustomToUI(0);
    } else {
      if (row) row.style.display = '';
      if (sel) {
        sel.disabled = false;
        sel.innerHTML = '<option value="0">' + (state.playerName || 'اللاعب 1') + '</option><option value="1">اللاعب 2</option>';
        sel.value = '0';
      }
      if (hint) hint.textContent = 'Split: اختر اللاعب عشان تعدّل ملابسه (نفس الجهاز)';
      applyCustomToUI(0);
    }
  }


  // ===== UI =====
  var _bgl = document.getElementById('btn-go-lobby'); if (_bgl) _bgl.onclick = function () { showUI('story-choice'); };
  document.getElementById('btn-build-mode').onclick = function () {
    // اختيار أوفلاين / أونلاين — منفصلين تمامًا
    showScreen('menu');
    var ch = document.getElementById('build-mode-choice');
    if (ch) {
      mainMenu.classList.add('hidden');
      ch.classList.remove('hidden');
      state.mode = 'menu';
    } else {
      startOfflineBuildFlow();
    }
  };

  function startOfflineBuildFlow() {
    state.buildCollab = false;
    state.buildCollabOnline = false;
    state._rtcPurpose = null;
    updateBuildCollabUi();
    // أوفلاين: نفس السلوك القديم — كمّل / ابدأ من جديد
    if (hasLocalBuildSave() && !state._buildResumeResolved) {
      showBuildResumeModal(function (choice) {
        if (choice === 'continue') {
          loadLevelsFromStorage();
          enterBuildModeWithCurrentLevel();
        } else {
          clearLocalBuildSaveAndReset();
          enterBuildModeWithCurrentLevel();
        }
      });
      return;
    }
    // لو مفيش حفظ أو اتحلّت قبل كده
    if (hasLocalBuildSave()) {
      showBuildResumeModal(function (choice) {
        if (choice === 'continue') {
          loadLevelsFromStorage();
          enterBuildModeWithCurrentLevel();
        } else {
          clearLocalBuildSaveAndReset();
          enterBuildModeWithCurrentLevel();
        }
      });
      return;
    }
    enterBuildModeWithCurrentLevel();
  }

  function enterBuildModeWithCurrentLevel() {
    showScreen('build');
    updateBuildCollabUi();
    try {
      if (state.currentLevelId && state.levels[state.currentLevelId]) {
        loadLevelIntoScene(state.currentLevelId);
        var lbl = document.getElementById('current-level-label');
        if (lbl) lbl.textContent = state.levels[state.currentLevelId].name || state.currentLevelId;
        var n = (state.levels[state.currentLevelId].objects || []).length;
        if (n > 0) toast('تم تحميل اللفل: ' + n + ' عنصر', 'info');
      } else {
        ensureDefaultEmptyLevel();
        loadLevelIntoScene(state.currentLevelId);
      }
    } catch (eL) { console.warn(eL); }
    try { if (state.buildCollabOnline) ensureBuildCollabRunning(); } catch (eC) {}
  }

  function updateBuildCollabUi() {
    var dl = document.getElementById('btn-download-data');
    var up = document.getElementById('btn-upload-all');
    var testBtn = document.getElementById('btn-test-level');
    var saveBtn = document.getElementById('btn-save-level');
    // المنضم في البناء الأونلاين: اخفِ كل أزرار الرفع/الاختبار/التحميل
    if (state.buildCollabOnline && !state.isHost) {
      [up, dl, testBtn, saveBtn].forEach(function (el) {
        if (!el) return;
        el.classList.add('hidden');
        el.style.display = 'none';
      });
    } else if (state.buildCollabOnline && state.isHost) {
      // القائد: اختبار/رفع اختياري — اخفِ رفع الشامل لو مش محتاج
      if (testBtn) { testBtn.classList.add('hidden'); testBtn.style.display = 'none'; }
      if (up) { up.classList.add('hidden'); up.style.display = 'none'; }
      if (dl) { dl.classList.add('hidden'); dl.style.display = 'none'; }
      if (saveBtn) { saveBtn.classList.add('hidden'); saveBtn.style.display = 'none'; }
    } else {
      [up, dl, testBtn, saveBtn].forEach(function (el) {
        if (!el) return;
        el.classList.remove('hidden');
        el.style.display = '';
      });
    }
    try { updateBuildRosterHud(); } catch (e) {}
  }

  function updateBuildRosterHud() {
    var hud = document.getElementById('build-roster-hud');
    var list = document.getElementById('build-roster-list');
    if (!hud || !list) return;
    if (!state.buildCollabOnline || state.mode !== 'build') {
      hud.classList.add('hidden');
      return;
    }
    hud.classList.remove('hidden');
    var rows = [];
    var roster = state.netRoster || [];
    var myMic = !!(state.voice && state.voice.enabled && state.voice.stream);
    var myTalk = !!(state.voice && state.voice.talking);
    if (!roster.length) {
      var mic1 = myMic ? '🎤' : '🔇';
      var col1 = myMic ? 'color:#86efac;font-weight:800' : 'opacity:0.9';
      rows.push('<div style="' + col1 + '">' + mic1 + ' ' + (state.playerName || 'أنا') + (state.isHost ? ' <span style="color:#fbbf24">👑</span>' : '') + '</div>');
    } else {
      roster.forEach(function (r) {
        if (!r) return;
        var isMe = r.id === state.myNetId;
        var me = isMe ? ' (أنت)' : '';
        var host = r.isHost ? ' <span style="color:#fbbf24">👑</span>' : '';
        var mic = isMe ? (myMic ? '🎤' : '🔇') : (r.micOn ? '🎤' : '🔇');
        var col = (isMe && myMic) || r.micOn ? 'color:#86efac;font-weight:800' : '';
        if (isMe && myTalk) col = 'color:#dcfce7;font-weight:900';
        rows.push('<div style="margin:3px 0;' + col + '">' + mic + ' ' + (r.name || 'لاعب') + me + host + '</div>');
      });
    }
    list.innerHTML = rows.join('');
  }

  // ===== بناء مشترك أونلاين =====
  state.buildCollabOnline = false;
  state.buildCollab = false;
  state._rtcPurpose = null; // 'play' | 'build'
  state.remoteBuilders = {}; // id -> sprite group

  function startBuildOnlineHub() {
    state.buildCollab = true;
    state.buildCollabOnline = true;
    state._rtcPurpose = 'build';
    state.playType = 'online';
    var hub = document.getElementById('build-online-hub');
    ['main-menu','story-choice','online-hub','create-room','join-room','build-mode-choice','lobby-screen','build-ui'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    if (hub) hub.classList.remove('hidden');
    state.mode = 'menu';
  }

  function startBuildCollabAsHost() {
    state._rtcPurpose = 'build';
    state.buildCollabOnline = true;
    state.buildCollab = true;
    state._buildPackReady = false;
    var pc = parseInt(state._buildPlayerCount, 10) || 3;
    if (pc < 2) pc = 2;
    if (pc > 8) pc = 8;
    state.maxNetPlayers = pc;
    state._roomPlayerCount = pc;
    state._pendingBuildHostCode = 'bld_' + Math.random().toString(36).slice(2, 8);
    // أولاً: رفع الشامل قبل تبادل الأكواد
    try { wireBuildPackUpload(); } catch (e) {}
    // عدّل سلوك الرفع: بعد النجاح يبدأ تبادل الأكواد
    var btn = document.getElementById('btn-build-pack-pick');
    var input = document.getElementById('build-pack-input');
    if (input) {
      input.onchange = function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        var st = document.getElementById('build-pack-status');
        var spin = document.getElementById('build-pack-spinner');
        if (st) st.textContent = 'جاري قراءة «' + f.name + '»...';
        if (spin) spin.classList.remove('hidden');
        uploadComprehensiveZip(f, function (ok, count) {
          if (!ok) {
            if (st) st.textContent = 'فشل — جرّب تاني';
            if (spin) spin.classList.add('hidden');
            toast('فشل قراءة الملف الشامل', 'error');
            return;
          }
          state._buildPackReady = true;
          try {
            var ids = Object.keys(state.levels || {});
            if (ids.length) state.currentLevelId = ids[0];
          } catch (e2) {}
          if (st) st.textContent = '✓ تم (' + (count || 0) + ' لفل) — ابدأ تبادل الأكواد';
          if (spin) spin.classList.add('hidden');
          hideBuildPackOverlay();
          // ابدأ تبادل الأكواد الآن
          var code = state._pendingBuildHostCode;
          startManualRtcAsHost(code);
          var title = document.getElementById('rtc-ex-title');
          var desc = document.getElementById('rtc-ex-desc');
          if (title) title.innerHTML = '👑 <span style="color:#fbbf24">بناء مشترك</span> — أنت القائد';
          if (desc) desc.innerHTML = 'تم رفع الشامل ✓<br>عدد اللاعبين: <strong>' + pc + '</strong><br>ابعت كود العرض لصاحبك، واستقبل كود الرد.';
          toast('ابدأ تبادل الأكواد مع أصحابك', 'success');
        });
      };
    }
    showBuildPackOverlay('host');
    var title2 = document.getElementById('build-pack-title');
    var desc2 = document.getElementById('build-pack-desc');
    if (title2) title2.textContent = '📁 ارفع الملف الشامل قبل إنشاء الروم';
    if (desc2) desc2.innerHTML = 'قبل تبادل الأكواد: ارفع <strong>الملف الشامل</strong> اللي هيتعدل عليه في البناء.<br>بعد الرفع هيتفتح تبادل الأكواد.';
    toast('ارفع الملف الشامل أولاً ثم تبادل الأكواد', 'info');
  }

  function startBuildCollabAsJoiner() {
    state._rtcPurpose = 'build';
    state.buildCollabOnline = true;
    state.buildCollab = true;
    startManualRtcAsJoiner();
    var title = document.getElementById('rtc-ex-title');
    var desc = document.getElementById('rtc-ex-desc');
    if (title) title.innerHTML = '🎮 <span style="color:#67e8f9">بناء مشترك</span> — أنت منضم';
    if (desc) desc.innerHTML = 'الصق كود العرض من القائد، وابعته كود الرد.<br>بعد الاتصال هتدخلوا وضع البناء مع بعض.';
  }


  function showBuildPackOverlay(role) {
    var ov = document.getElementById('build-pack-overlay');
    if (!ov) return;
    ov.classList.remove('hidden');
    ov.style.display = 'flex';
    var title = document.getElementById('build-pack-title');
    var desc = document.getElementById('build-pack-desc');
    var btn = document.getElementById('btn-build-pack-pick');
    var spin = document.getElementById('build-pack-spinner');
    var st = document.getElementById('build-pack-status');
    if (spin) spin.classList.add('hidden');
    if (role === 'host') {
      if (title) title.textContent = '📁 ارفع الملف الشامل';
      if (desc) desc.innerHTML = 'أنت <strong style="color:#fbbf24">القائد</strong>. ارفع <strong>الملف الشامل</strong> اللي هيتعدل في البناء الأونلاين.<br>بعد الرفع هيتبعت للمنضمين ويظهر نفس العالم للطرفين.';
      if (btn) { btn.classList.remove('hidden'); btn.style.display = ''; }
      if (st) st.textContent = 'بانتظار اختيار الملف...';
    } else {
      if (title) title.textContent = '⏳ بانتظار القائد';
      if (desc) desc.innerHTML = 'أنت <strong style="color:#67e8f9">منضم</strong>. انتظر القائد يرفع <strong>الملف الشامل</strong>.<br>لما يرفعه هيفتح عندك نفس العالم تلقائي.';
      if (btn) { btn.classList.add('hidden'); btn.style.display = 'none'; }
      if (st) st.textContent = 'بانتظار رفع القائد...';
      if (spin) spin.classList.remove('hidden');
    }
  }
  function hideBuildPackOverlay() {
    var ov = document.getElementById('build-pack-overlay');
    if (!ov) return;
    ov.classList.add('hidden');
    ov.style.display = 'none';
  }
  function wireBuildPackUpload() {
    var btn = document.getElementById('btn-build-pack-pick');
    var input = document.getElementById('build-pack-input');
    if (!btn || !input || btn._wired) return;
    btn._wired = true;
    btn.onclick = function () { input.click(); };
    input.onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var st = document.getElementById('build-pack-status');
      var spin = document.getElementById('build-pack-spinner');
      if (st) st.textContent = 'جاري قراءة «' + f.name + '»...';
      if (spin) spin.classList.remove('hidden');
      uploadComprehensiveZip(f, function (ok, count) {
        if (!ok) {
          if (st) st.textContent = 'فشل قراءة الملف — جرّب تاني';
          if (spin) spin.classList.add('hidden');
          toast('فشل قراءة الملف الشامل', 'error');
          return;
        }
        if (st) st.textContent = '✓ تم — ' + (count || 0) + ' لفل — جاري الإرسال للمنضمين...';
        state._buildPackReady = true;
        // استخدم أول لفل أو الحالي
        try {
          var ids = Object.keys(state.levels || {});
          if (ids.length) {
            state.currentLevelId = ids[0];
          }
        } catch (e) {}
        // ابعت snapshot كامل للمنضمين
        try { sendBuildSnapshotFull(); } catch (eS) { console.warn(eS); }
        if (st) st.textContent = '✓ تم الإرسال — جاري فتح البناء...';
        setTimeout(function () {
          hideBuildPackOverlay();
          finishEnterBuildCollabWithPack();
        }, 400);
      });
    };
  }
  function sendBuildSnapshotFull() {
    if (!state.isHost) return;
    // احفظ objects الحالية لو موجودة
    try {
      if (state.currentLevelId && state.levels[state.currentLevelId]) {
        // من الملف الشامل — objects جاهزة
      }
    } catch (e) {}
    var levelId = state.currentLevelId;
    var level = levelId ? state.levels[levelId] : null;
    if (!level) {
      // أرسل كل اللفلات
      var all = {};
      Object.keys(state.levels || {}).forEach(function (id) {
        try { all[id] = JSON.parse(JSON.stringify(state.levels[id])); } catch (e) { all[id] = state.levels[id]; }
      });
      var msg = { type: 'build_pack', levels: all, currentLevelId: levelId, name: state.playerName };
      if (state.isHost) broadcastToAll(msg);
      return;
    }
    var payload = null;
    try { payload = JSON.parse(JSON.stringify(level)); } catch (e) { payload = level; }
    var msg2 = {
      type: 'build_pack',
      levelId: levelId,
      level: payload,
      levels: (function () {
        var o = {};
        try {
          Object.keys(state.levels || {}).forEach(function (id) {
            o[id] = JSON.parse(JSON.stringify(state.levels[id]));
          });
        } catch (e2) {}
        return o;
      })(),
      currentLevelId: levelId,
      name: state.playerName
    };
    broadcastToAll(msg2);
  }
  function applyBuildPack(d) {
    if (!d) return;
    if (state.isHost) return;
    try {
      if (d.levels && typeof d.levels === 'object') {
        state.levels = d.levels;
        state.currentLevelId = d.currentLevelId || Object.keys(d.levels)[0];
      } else if (d.level) {
        var id = d.levelId || ('online_build_' + Date.now().toString(36));
        state.levels = state.levels || {};
        state.levels[id] = d.level;
        state.currentLevelId = id;
      }
      state._buildPackReady = true;
      hideBuildPackOverlay();
      finishEnterBuildCollabWithPack();
      toast('تم استلام الملف الشامل من القائد', 'success');
    } catch (e) {
      console.warn(e);
      toast('فشل تطبيق ملف القائد', 'error');
    }
  }


  function enterBuildCollabSession() {
    state.buildCollabOnline = true;
    state.buildCollab = true;
    state._rtcPurpose = 'build';
    state.playType = 'online';
    state._buildPaused = false;
    state._buildPackReady = !!state._buildPackReady;
    // اقفل الشاشات
    try {
      ['lobby-screen', 'main-menu', 'story-choice', 'online-hub', 'create-room', 'join-room',
       'build-mode-choice', 'build-online-hub', 'rtc-exchange-overlay', 'name-entry-screen'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) { el.classList.add('hidden'); el.style.display = 'none'; }
      });
      var cp = document.getElementById('custom-panel');
      if (cp) cp.style.display = 'none';
    } catch (eH) {}

    // نسخة أوفلاين محفوظة — منفصلة
    if (!state._offlineLevelsBackup) {
      try { state._offlineLevelsBackup = JSON.parse(JSON.stringify(state.levels || {})); } catch (e) { state._offlineLevelsBackup = state.levels || {}; }
      state._offlineCurrentLevelId = state.currentLevelId;
    }
    if (!state.myNetId) {
      state.myNetId = state.isHost ? ('host_' + (state.roomCode || 'bld')) : ('builder_' + Math.random().toString(36).slice(2, 9));
    }
    state.netRoster = state.netRoster || [];
    var hasMe = state.netRoster.some(function (r) { return r && r.id === state.myNetId; });
    if (!hasMe) {
      state.netRoster.unshift({
        id: state.myNetId,
        name: state.playerName || (state.isHost ? 'القائد' : 'منضم'),
        isHost: !!state.isHost,
        avatar: (typeof getNetAvatar === 'function' ? getNetAvatar() : '')
      });
    }
    try { wireBuildPackUpload(); } catch (eW) {}
    // لو لسه مفيش شامل: القائد يرفع / المنضم يستنى
    if (!state._buildPackReady) {
      if (state.isHost) {
        // امسح مستويات الجلسة لحد الرفع
        state.levels = {};
        showBuildPackOverlay('host');
        toast('ارفع الملف الشامل اللي هيتعدل', 'info');
      } else {
        state.levels = {};
        showBuildPackOverlay('joiner');
        toast('بانتظار القائد يرفع الملف الشامل', 'info');
      }
      try { voiceOnEnterGame(); } catch (eV) {}
      return;
    }
    finishEnterBuildCollabWithPack();
  }

  function finishEnterBuildCollabWithPack() {
    state.buildCollabOnline = true;
    state.buildCollab = true;
    state._buildPackReady = true;
    hideBuildPackOverlay();
    // لو مفيش لفل بعد الرفع — فاضي
    if (!state.currentLevelId || !state.levels[state.currentLevelId]) {
      var emptyId = 'online_build_' + (state.roomCode || Date.now().toString(36));
      state.levels[emptyId] = {
        name: 'بناء أونلاين',
        objects: [],
        scripts: [],
        sounds: [],
        music: [],
        images: [],
        respawns: { lan: [], split: [] },
        createdAt: Date.now()
      };
      state.currentLevelId = emptyId;
    }

    showScreen('build');
    clearBuildObjects();
    try { clearRemoteBuilders(); } catch (e) {}
    loadLevelIntoScene(state.currentLevelId);
    state._levelSceneReady = true;
    var lv = state.levels[state.currentLevelId];
    var lbl = document.getElementById('current-level-label');
    if (lbl) lbl.textContent = (lv && lv.name) ? lv.name : 'بناء أونلاين';
    var oc = document.getElementById('object-count');
    if (oc) oc.textContent = ((lv && lv.objects && lv.objects.length) || 0) + ' عنصر';

    // كاميرا حرة + ماوس ظاهر للأدوات (وضع/تحديد/تحريك)
    state.flyMode = true;
    state.mouseHidden = false;
    state.flyPos.set(12, 14, 12);
    state.flyYaw = 0.8;
    state.flyPitch = 0.35;
    try {
      if (flyIndicator) flyIndicator.style.display = 'block';
      buildCamera.position.copy(state.flyPos);
      document.body.style.cursor = 'default';
      if (document.exitPointerLock) document.exitPointerLock();
    } catch (eF) {}

    updateBuildCollabUi();
    try { updateBuildRosterHud(); } catch (eR) {}
    try { startPeerPingLoop(); } catch (e) {}
    try {
      var hud = document.getElementById('net-ping-hud');
      if (hud) hud.classList.remove('hidden');
      updatePingHud(state.netPing || 1);
    } catch (eP) {}

    toast(state.isHost ? 'البناء جاهز | WASD حركة | F نظر | كليك وضع/تحديد' : 'عالم القائد | WASD | F نظر | كليك للبناء', 'success');

    if (state.isHost) {
      setTimeout(function () { try { sendBuildSnapshot(); } catch (e) {} }, 400);
    }
    try {
      setTimeout(function () {
        try { voiceOnEnterGame(); } catch (eV) {}
        try { updateMicHud(); } catch (eH) {}
        try { voiceForceSendTrack(); voiceUnlockRemotePlayback(); } catch (eV2) {}
      }, 400);
    } catch (e) {}
    setTimeout(function () { try { sendBuildPose(); } catch (e) {} }, 300);
  }

  function restoreOfflineLevelsAfterOnlineBuild() {
    if (!state._offlineLevelsBackup) return;
    try {
      state.levels = state._offlineLevelsBackup;
      state.currentLevelId = state._offlineCurrentLevelId || null;
    } catch (e) {}
    state._offlineLevelsBackup = null;
    state._offlineCurrentLevelId = null;
  }

  function makeBuilderAvatarSprite(name, avatarUrl) {
    var g = new THREE.Group();
    var canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.arc(64, 64, 60, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(64, 64, 58, 0, Math.PI * 2); ctx.stroke();
    function finish(texImg) {
      if (texImg) {
        try {
          ctx.save();
          ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2); ctx.clip();
          ctx.drawImage(texImg, 12, 12, 104, 104);
          ctx.restore();
        } catch (e) {}
      } else {
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 42px Tahoma, Arial';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText((name || '?').toString().charAt(0), 64, 64);
      }
      var tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
      var spr = new THREE.Sprite(mat);
      spr.scale.set(2.2, 2.2, 1);
      g.add(spr);
      g.userData.sprite = spr;
      g.userData.canvas = canvas;
    }
    if (avatarUrl) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { finish(img); };
      img.onerror = function () { finish(null); };
      img.src = avatarUrl;
    } else {
      finish(null);
    }
    // name tag
    try {
      var nt = createNameTagSprite(name || 'بنّاء', { talking: false, micOn: false });
      nt.position.set(0, 1.5, 0);
      g.add(nt);
      g.userData.nameTag = nt;
    } catch (e) {}
    g.userData.isBuilderAvatar = true;
    return g;
  }

  function ensureRemoteBuilder(id, name, avatar) {
    if (!id || id === state.myNetId) return null;
    if (!state.remoteBuilders) state.remoteBuilders = {};
    if (state.remoteBuilders[id]) return state.remoteBuilders[id];
    var g = makeBuilderAvatarSprite(name || 'بنّاء', avatar || '');
    scene.add(g);
    state.remoteBuilders[id] = g;
    return g;
  }

  function clearRemoteBuilders() {
    Object.keys(state.remoteBuilders || {}).forEach(function (id) {
      var g = state.remoteBuilders[id];
      if (g) try { scene.remove(g); } catch (e) {}
    });
    state.remoteBuilders = {};
  }

  function sendBuildPose() {
    if (!state.buildCollabOnline || state.mode !== 'build') return;
    if (!state.myNetId) return;
    // استخدم موقع الكاميرا الحالي (طيران أو عادي)
    var px = state.flyPos.x, py = state.flyPos.y, pz = state.flyPos.z, yaw = state.flyYaw;
    try {
      if (typeof buildCamera !== 'undefined' && buildCamera && buildCamera.position) {
        px = buildCamera.position.x;
        py = buildCamera.position.y;
        pz = buildCamera.position.z;
      }
    } catch (e) {}
    var msg = {
      type: 'build_pose',
      id: state.myNetId,
      name: state.playerName || 'بنّاء',
      avatar: (typeof getNetAvatar === 'function' ? getNetAvatar() : (state.playerAvatar || '')),
      x: Math.round(px * 100) / 100,
      y: Math.round(py * 100) / 100,
      z: Math.round(pz * 100) / 100,
      yaw: Math.round((yaw || 0) * 1000) / 1000,
      micOn: !!(state.voice && state.voice.enabled && state.voice.stream),
      talking: !!(state.voice && state.voice.enabled && state.voice.talking)
    };
    if (state.isHost) broadcastToAll(msg);
    else if (state.connection) try { state.connection.send(msg); } catch (e) {}
  }

  function applyBuildPose(d) {
    if (!d || !d.id || d.id === state.myNetId) return;
    if (!state.buildCollabOnline) return;
    var g = ensureRemoteBuilder(d.id, d.name, d.avatar);
    if (!g) return;
    g.position.set(d.x || 0, (d.y != null ? d.y : 10), d.z || 0);
    g.visible = true;
    // علامة المايك + الأخضر وهو بيتكلم (حتى لو طاير)
    try {
      updateNameTagState(g, {
        name: d.name || 'بنّاء',
        micOn: !!d.micOn,
        talking: !!d.talking
      });
    } catch (eNt) {}
    try {
      state.netRoster = state.netRoster || [];
      var found = false;
      state.netRoster.forEach(function (r) {
        if (r && r.id === d.id) {
          r.name = d.name || r.name;
          r.micOn = !!d.micOn;
          r.talking = !!d.talking;
          found = true;
        }
      });
      if (!found) {
        state.netRoster.push({ id: d.id, name: d.name || 'بنّاء', micOn: !!d.micOn, talking: !!d.talking });
      }
      try { updateBuildRosterHud(); } catch (eR) {}
    } catch (e) {}
  }

  function sendBuildSnapshot() {
    if (!state.isHost || !state.buildCollabOnline) return;
    try {
      if (state.currentLevelId && state.levels[state.currentLevelId]) {
        state.levels[state.currentLevelId].objects = serializeObjects();
      }
      var payload = {
        type: 'build_snapshot',
        levelId: state.currentLevelId,
        level: state.levels[state.currentLevelId] ? JSON.parse(JSON.stringify(state.levels[state.currentLevelId])) : null
      };
      broadcastToAll(payload);
    } catch (e) { console.warn(e); }
  }

  function applyBuildSnapshot(d) {
    if (!d || !d.level) return;
    if (!state.buildCollabOnline) return;
    try {
      var id = d.levelId || state.currentLevelId || ('online_build_' + Date.now().toString(36));
      state.levels[id] = d.level;
      state.currentLevelId = id;
      loadLevelIntoScene(id);
      state._levelSceneReady = true;
      var lbl = document.getElementById('current-level-label');
      if (lbl) lbl.textContent = 'بناء أونلاين';
      toast('تم مزامنة المشهد من القائد', 'success');
    } catch (e) { console.warn(e); }
  }

  function netBuildOp(op, data) {
    if (!state.buildCollabOnline) return;
    if (!state.myNetId) state.myNetId = 'builder_' + Math.random().toString(36).slice(2, 8);
    var msg = Object.assign({ type: 'build_op', op: op, id: state.myNetId }, data || {});
    try {
      if (state.isHost) {
        broadcastToAll(msg);
      } else if (state.connection) {
        state.connection.send(msg);
      } else if (state._rtcDc && state._rtcDc.readyState === 'open') {
        state._rtcDc.send(JSON.stringify(msg));
      }
    } catch (e) { console.warn('netBuildOp', op, e); }
  }

  function netSyncObjectTransform(mesh) {
    if (!state.buildCollabOnline || !mesh) return;
    var key = mesh.userData && mesh.userData._netBuildKey;
    if (!key) {
      // عيّن مفتاح لو ناقص
      mesh.userData._netBuildKey = 'nb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
      key = mesh.userData._netBuildKey;
    }
    netBuildOp('transform', {
      key: key,
      instanceName: mesh.userData.instanceName || null,
      position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
      rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
      scale: { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z }
    });
  }
  function netSyncSelectedTransforms() {
    if (!state.buildCollabOnline) return;
    try {
      getSelectedObjects().forEach(function (o) { netSyncObjectTransform(o); });
    } catch (e) {}
  }

  function applyBuildOp(d, fromHost) {
    if (!d || !state.buildCollabOnline) return;
    if (d.id === state.myNetId) return;
    if (state.isHost && d.id && d.id !== state.myNetId) {
      try { broadcastToAll(d); } catch (eRb) {}
    }
    try {
      if (d.op === 'place' && d.object) {
        var o = d.object;
        var item = findCatalogItem(o.id);
        var mesh = null;
        if (o.onTable && (o.id === 'wpn_pistol' || o.id === 'wpn_smg' || o.isWeapon)) {
          var kind = (o.id === 'wpn_smg' || o.weaponKind === 'smg') ? 'smg' : 'pistol';
          mesh = makeWeaponPickup(kind, kind === 'smg' ? 0x334155 : 0x1e293b, kind === 'smg' ? 0x22d3ee : 0xfbbf24, { onTable: true });
        } else if (item && item.factory) {
          mesh = item.factory();
        } else if (o.isVehicle || (o.id && String(o.id).indexOf('car') >= 0) || (o.id && String(o.id).indexOf('ix_') === 0)) {
          // fallback عربيات لو الـ id مش متلاقي
          mesh = makeInteractiveCar('sedan', 0xdc2626, 0x991b1b);
        } else {
          mesh = makeSimpleBlock([1.2, 1.2, 1.2], 0x78716c);
        }
        mesh.position.set(o.position.x || 0, o.position.y || 0, o.position.z || 0);
        if (o.rotation) {
          if (o.rotation.x != null) mesh.rotation.x = o.rotation.x;
          if (o.rotation.y != null) mesh.rotation.y = o.rotation.y;
          if (o.rotation.z != null) mesh.rotation.z = o.rotation.z;
        }
        if (o.scale) {
          mesh.scale.set(o.scale.x != null ? o.scale.x : 1, o.scale.y != null ? o.scale.y : 1, o.scale.z != null ? o.scale.z : 1);
        }
        mesh.userData.buildId = o.id || mesh.userData.buildId;
        mesh.userData.instanceName = o.instanceName || o.id || 'نسخة';
        mesh.userData._netBuildKey = d.key || o._netBuildKey || ('nb_r_' + Date.now().toString(36));
        if (o.isVehicle || mesh.userData.isVehicle) {
          mesh.userData.isVehicle = true;
          mesh.userData.interactive = true;
          if (o.fuelInfinite != null) mesh.userData.fuelInfinite = !!o.fuelInfinite;
          if (o.fuel != null) mesh.userData.fuel = o.fuel;
          if (o.fuelConsume) mesh.userData.fuelConsume = o.fuelConsume;
          if (o.driveMode) mesh.userData.driveMode = o.driveMode;
          mesh.userData.seats = { driver: null, passenger: null };
          mesh.userData.engineOn = false;
          if (!mesh.userData.netVehicleId) {
            mesh.userData.netVehicleId = 'veh_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
          }
        }
        scene.add(mesh);
        state.buildObjects.push(mesh);
        if (mesh.userData.isGasStation) {
          state.gasStations = state.gasStations || [];
          state.gasStations.push(mesh);
        }
        document.getElementById('object-count').textContent = state.buildObjects.length + ' عنصر';
        try { refreshHierarchy(); } catch (e) {}
      } else if (d.op === 'delete') {
        var keys = d.keys || (d.key ? [d.key] : []);
        for (var i = state.buildObjects.length - 1; i >= 0; i--) {
          var m = state.buildObjects[i];
          if (m && m.userData && keys.indexOf(m.userData._netBuildKey) >= 0) {
            try { scene.remove(m); } catch (eR) {}
            state.buildObjects.splice(i, 1);
          }
        }
        try {
          var oc = document.getElementById('object-count');
          if (oc) oc.textContent = state.buildObjects.length + ' عنصر';
          refreshHierarchy();
        } catch (e) {}
      } else if (d.op === 'transform' && (d.key || d.instanceName)) {
        var tm = null;
        for (var ti = 0; ti < state.buildObjects.length; ti++) {
          var cand = state.buildObjects[ti];
          if (!cand || !cand.userData) continue;
          if (d.key && cand.userData._netBuildKey === d.key) { tm = cand; break; }
        }
        if (!tm && d.instanceName) {
          for (var tj = 0; tj < state.buildObjects.length; tj++) {
            var c2 = state.buildObjects[tj];
            if (c2 && c2.userData && c2.userData.instanceName === d.instanceName) { tm = c2; break; }
          }
        }
        if (tm) {
          if (d.position) tm.position.set(d.position.x || 0, d.position.y || 0, d.position.z || 0);
          if (d.rotation) {
            if (d.rotation.x != null) tm.rotation.x = d.rotation.x;
            if (d.rotation.y != null) tm.rotation.y = d.rotation.y;
            if (d.rotation.z != null) tm.rotation.z = d.rotation.z;
          }
          if (d.scale) tm.scale.set(d.scale.x != null ? d.scale.x : 1, d.scale.y != null ? d.scale.y : 1, d.scale.z != null ? d.scale.z : 1);
        }
      } else if (d.op === 'clear') {
        clearBuildObjects();
      }
    } catch (e) { console.warn('build_op', e); }
  }

  function ensureBuildCollabRunning() {
    updateBuildCollabUi();
  }

  // wire choice buttons once
  (function wireBuildModeChoice() {
    var bOff = document.getElementById('btn-build-offline');
    var bOn = document.getElementById('btn-build-online');
    var bBack = document.getElementById('btn-build-choice-back');
    if (bOff) bOff.onclick = function () {
      var ch = document.getElementById('build-mode-choice');
      if (ch) ch.classList.add('hidden');
      startOfflineBuildFlow();
    };
    if (bOn) bOn.onclick = function () {
      startBuildOnlineHub();
    };
    if (bBack) bBack.onclick = function () {
      showScreen('menu');
    };
    state._buildPlayerCount = state._buildPlayerCount || 3;
    function updateBuildPHint(n) {
      var hint = document.getElementById('build-players-hint');
      if (!hint) return;
      var joiners = Math.max(0, n - 1);
      if (n === 2) hint.textContent = '2 لاعبين = أنت (القائد) + صاحب واحد';
      else hint.textContent = n + ' لاعبين = أنت (القائد) + ' + joiners + ' أصحاب';
    }
    document.querySelectorAll('.build-pcount-btn').forEach(function (btn) {
      btn.onclick = function () {
        var n = parseInt(btn.getAttribute('data-count'), 10) || 3;
        state._buildPlayerCount = n;
        document.querySelectorAll('.build-pcount-btn').forEach(function (b) {
          var on = parseInt(b.getAttribute('data-count'), 10) === n;
          b.className = on ? 'btn btn-sm btn-primary build-pcount-btn' : 'btn btn-sm btn-ghost build-pcount-btn';
          b.style.flex = '1';
          b.style.minWidth = '70px';
        });
        updateBuildPHint(n);
      };
    });
    updateBuildPHint(state._buildPlayerCount || 3);
    var c1 = document.getElementById('btn-build-create-room');
    var c2 = document.getElementById('btn-build-join-room');
    var c3 = document.getElementById('btn-build-online-back');
    if (c1) c1.onclick = function () { startBuildCollabAsHost(); };
    if (c2) c2.onclick = function () { startBuildCollabAsJoiner(); };
    if (c3) c3.onclick = function () {
      var hub = document.getElementById('build-online-hub');
      if (hub) hub.classList.add('hidden');
      var ch = document.getElementById('build-mode-choice');
      if (ch) ch.classList.remove('hidden');
    };
  })();

  function ensureDefaultEmptyLevel() {
    if (state.currentLevelId && state.levels[state.currentLevelId]) return;
    var ids = Object.keys(state.levels || {});
    if (ids.length) {
      state.currentLevelId = ids[0];
      return;
    }
    var id = 'level_' + Date.now().toString(36);
    state.levels[id] = {
      name: 'لفل 1',
      objects: [],
      scripts: [],
      sounds: [],
      music: [],
      images: [],
      respawns: { lan: [], split: [] },
      createdAt: Date.now()
    };
    state.currentLevelId = id;
  }

  function hasLocalBuildSave() {
    try {
      var raw = localStorage.getItem('sm_levels_v1');
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || !data.levels) return false;
      var ids = Object.keys(data.levels);
      for (var i = 0; i < ids.length; i++) {
        var lv = data.levels[ids[i]];
        // بس شغل فعلي — ده اللي هيتكمّل عليه بعد قفل الموقع
        if (lv && Array.isArray(lv.objects) && lv.objects.length > 0) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function clearLocalBuildSaveAndReset() {
    try { localStorage.removeItem('sm_levels_v1'); } catch (e) {}
    state.levels = {};
    state.currentLevelId = null;
    state._levelSceneReady = false;
    state._allowEmptySave = true;
    try { clearBuildObjects(); } catch (e2) {}
    ensureDefaultEmptyLevel();
    state._levelSceneReady = true;
    state._buildResumeResolved = true;
    try { persistLevelsToStorage(); } catch (e3) {}
    state._allowEmptySave = false;
    toast('بداية من الصفر — ارفع الملف الشامل لو محتاجه', 'info');
  }

  function showBuildResumeModal(cb) {
    var ov = document.getElementById('build-resume-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'build-resume-overlay';
      ov.innerHTML =
        '<div class="build-resume-panel">' +
        '<h2>وضع المطوّر</h2>' +
        '<p class="br-desc">في شغل محفوظ محليًا من آخر مرة.</p>' +
        '<div class="br-actions">' +
        '<button type="button" class="btn btn-primary" id="br-continue">كمّل الشغل بتاعك</button>' +
        '<button type="button" class="btn btn-ghost" id="br-fresh">ابدأ من جديد</button>' +
        '</div>' +
        '<p class="br-note">ملحوظة: لو ضغطت «ابدأ من جديد» هيتمسح الشغل المحلي وهتبدأ من الصفر — وهتحتاج تفتح الملف الشامل لو عايز اللفلات الجاهزة.</p>' +
        '</div>';
      document.body.appendChild(ov);
    }
    ov.classList.remove('hidden');
    var done = false;
    function finish(choice) {
      if (done) return;
      done = true;
      state._buildResumeResolved = true;
      ov.classList.add('hidden');
      if (cb) cb(choice);
    }
    var b1 = document.getElementById('br-continue');
    var b2 = document.getElementById('br-fresh');
    if (b1) b1.onclick = function () { finish('continue'); };
    if (b2) b2.onclick = function () { finish('fresh'); };
  }
  document.getElementById('btn-start-game').onclick = startGame;
  (function wireMicHud() {
    var btn = document.getElementById('mic-hud-btn');
    if (!btn) return;
    btn.onclick = function (e) {
      try { e.preventDefault(); e.stopPropagation(); } catch (e0) {}
      try { voiceToggleFromKey(); } catch (err) { console.warn(err); }
    };
  })();

  document.getElementById('btn-leave-lobby').onclick = function () {
    leaveOnlineSession(false);
  };

  // حفظ اللفل قبل قفل الصفحة — آخر شغل (سواء كمّلت قديم أو بدأت من جديد وبنيت)
  window.addEventListener('beforeunload', function () {
    try {
      if (state.currentLevelId && state.levels[state.currentLevelId]) {
        if (state.mode === 'build' || state._levelSceneReady) {
          state.levels[state.currentLevelId].objects = serializeObjects();
          saveRespawnsFromMarkers();
        }
        persistLevelsToStorage();
      }
    } catch (e) {}
    if (state.playType === 'online' && state.myNetId && state.useLan) {
      try {
        var payload = JSON.stringify({
          room: state.roomCode,
          data: { type: 'leave', id: state.myNetId, name: state.playerName || 'لاعب', isHost: !!state.isHost }
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(lanBaseUrl() + '/send', new Blob([payload], { type: 'application/json' }));
          if (state.isHost) {
            navigator.sendBeacon(lanBaseUrl() + '/roommeta', new Blob([JSON.stringify({ room: state.roomCode, close: true })], { type: 'application/json' }));
          }
        }
      } catch (e) {}
    }
  });
  document.getElementById('btn-exit-build').onclick = function () {
    if (state.currentLevelId && state.levels[state.currentLevelId]) {
      state.levels[state.currentLevelId].objects = serializeObjects();
      saveRespawnsFromMarkers();
      if (!state.buildCollabOnline) persistLevelsToStorage();
    }
    state.respawnPlaceMode = null;
    var rp = document.getElementById('respawn-choice-panel');
    if (rp) rp.classList.add('hidden');
    state._buildResumeResolved = true;
    try { clearRemoteBuilders(); } catch (e) {}
    if (state.buildCollabOnline) {
      state.buildCollabOnline = false;
      state.buildCollab = false;
      state._rtcPurpose = null;
      try { cleanupManualRtc && cleanupManualRtc(); } catch (e2) {}
    }
    showScreen('menu');
  };
  document.getElementById('btn-download-data').onclick = downloadAllAsZip;
  document.getElementById('btn-save-level').onclick = saveCurrentLevel;

  // احذف وابدأ من جديد — مع رسالة تأكيد
  (function () {
    var btnReset = document.getElementById('btn-reset-build');
    if (!btnReset) return;
    btnReset.onclick = function () {
      showChoiceModal(
        '⚠️ تأكيد: احذف وابدأ من جديد؟\nهيتمسح كل اللفلز والشغل المحلي، وهتبدأ من الصفر.',
        [
          { id: 'yes', label: 'نعم، احذف وابدأ من جديد', danger: true },
          { id: 'no', label: 'إلغاء' }
        ],
        function (choice) {
          if (choice !== 'yes') return;
          try { clearLocalBuildSaveAndReset(); } catch (e) { console.warn(e); }
          try {
            ensureDefaultEmptyLevel();
            if (state.currentLevelId) loadLevelIntoScene(state.currentLevelId);
          } catch (e2) { console.warn(e2); }
          try { renderLevelsList(); } catch (e3) {}
          try { updateAssetsInfo(); } catch (e4) {}
          try { refreshHierarchy(); } catch (e5) {}
          var lbl = document.getElementById('current-level-label');
          if (lbl) lbl.textContent = (state.levels[state.currentLevelId] && state.levels[state.currentLevelId].name) || state.currentLevelId || '—';
          toast('تم المسح — بداية من الصفر', 'success');
        }
      );
    };
  })();

  // حفظ محلي مفعّل — عند فتح الموقع لو في شغل محفوظ تظهر نافذة كمّل / ابدأ من جديد
  state._buildResumeResolved = false;
  try {
    if (hasLocalBuildSave()) {
      showBuildResumeModal(function (choice) {
        if (choice === 'continue') {
          loadLevelsFromStorage();
          toast('تم استكمال آخر شغل محفوظ', 'success');
        } else {
          clearLocalBuildSaveAndReset();
        }
      });
    } else {
      state._buildResumeResolved = true;
      ensureDefaultEmptyLevel();
    }
  } catch (eBoot) {
    state._buildResumeResolved = true;
    ensureDefaultEmptyLevel();
  }


  // ===== اختبار اللفل من البناء =====
  function ensureTestPauseExtras() {
    var box = document.querySelector('#pause-menu .pause-box');
    if (!box) return;
    var old = document.getElementById('btn-pause-dev');
    if (old) old.remove();
    var btn = document.createElement('button');
    btn.id = 'btn-pause-dev';
    btn.className = 'btn btn-success';
    btn.textContent = 'عودة لوضع المطوّر';
    btn.style.cssText = 'background:linear-gradient(135deg,#22c55e,#16a34a);font-weight:700;margin-top:6px;';
    btn.onclick = function () {
      closePause();
      exitTestMode();
    };
    box.appendChild(btn);
    var title = document.getElementById('pause-title');
    if (title) title.textContent = 'إيقاف — وضع الاختبار';
  }

  function exitTestMode(opts) {
    opts = opts || {};
    var fromNet = !!opts.fromNet;
    // في البناء المشترك: القائد يبلّغ المنضم بالخروج
    if (state.buildCollabOnline && state.isHost && !fromNet) {
      try {
        var msg = { type: 'build_test_end', id: state.myNetId };
        if (state.isHost) broadcastToAll(msg);
        else if (state.connection) state.connection.send(msg);
      } catch (eN) {}
    }
    try { if (typeof stopAllScripts === 'function') stopAllScripts(); } catch (e) {}
    state.paused = false;
    state._testMode = false;
    var pm = document.getElementById('pause-menu');
    if (pm) pm.classList.add('hidden');
    var exitBar = document.getElementById('test-exit-bar');
    if (exitBar && exitBar.parentNode) exitBar.parentNode.removeChild(exitBar);
    players.forEach(function (p) {
      if (p && p.group) { try { scene.remove(p.group); } catch (e) {} p.group = null; }
      if (p && p.velocity) p.velocity.set(0, 0, 0);
    });
    try { clearRemoteMeshes(); } catch (e) {}
    var levelId = state.currentLevelId;
    if (state.buildCollabOnline) {
      // رجوع للبناء المشترك — متقفلش الشبكة
      showScreen('build');
      if (levelId) {
        try { loadLevelIntoScene(levelId); } catch (e) {}
        try { loadRespawnMarkers(levelId); } catch (e) {}
      }
      var buildUi = document.getElementById('build-ui');
      if (buildUi) buildUi.classList.remove('hidden');
      updateBuildCollabUi();
      toast('رجعت لوضع البناء المشترك', 'success');
      if (state.isHost) {
        setTimeout(function () { try { sendBuildSnapshot(); } catch (e) {} }, 300);
      }
    } else {
      state.playType = 'split';
      state.useLan = false;
      state.useFirebase = false;
      showScreen('build');
      if (levelId) {
        try { loadLevelIntoScene(levelId); } catch (e) {}
        try { loadRespawnMarkers(levelId); } catch (e) {}
      }
      var buildUi2 = document.getElementById('build-ui');
      if (buildUi2) buildUi2.classList.remove('hidden');
      toast('رجعت لوضع المطوّر', 'success');
    }
  }

  function ensureTestExitBar() {
    var bar = document.getElementById('test-exit-bar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'test-exit-bar';
    bar.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100050;display:flex;gap:10px;align-items:center;background:rgba(0,0,0,0.75);border:1px solid #22c55e;border-radius:12px;padding:8px 14px;color:#fff;font-family:sans-serif;direction:rtl;';
    bar.innerHTML = '<span style="font-size:0.85rem;color:#86efac">وضع اختبار</span>' +
      '<button id="btn-exit-test" style="padding:6px 14px;border:0;border-radius:8px;background:#22c55e;color:#041;font-weight:700;cursor:pointer">خروج (ESC)</button>';
    document.body.appendChild(bar);
    document.getElementById('btn-exit-test').onclick = function () { exitTestMode(); };
    return bar;
  }

  function beginLevelTest(levelId, opts) {
    opts = opts || {};
    var fromNet = !!opts.fromNet;
    if (!levelId || !state.levels[levelId]) {
      toast('اللفل غير موجود', 'error');
      return;
    }
    // احفظ اللفل الحالي في البناء قبل التبديل
    try {
      if (state.currentLevelId && state.levels[state.currentLevelId] && state.mode === 'build') {
        state.levels[state.currentLevelId].objects = serializeObjects();
        saveRespawnsFromMarkers();
      }
    } catch (e) {}
    try { if (typeof saveCurrentLevel === 'function' && state.mode === 'build') saveCurrentLevel(); } catch (e) {}

    // بناء مشترك: القائد يبلّغ المنضم يدخل الاختبار معاه
    if (state.buildCollabOnline && state.isHost && !fromNet) {
      try {
        // لقطة أحدث قبل الاختبار
        state.levels[levelId].objects = serializeObjects();
        var msg = {
          type: 'build_test_start',
          levelId: levelId,
          level: JSON.parse(JSON.stringify(state.levels[levelId])),
          id: state.myNetId
        };
        broadcastToAll(msg);
      } catch (eN) { console.warn(eN); }
    }

    state.currentLevelId = levelId;
    state._testMode = true;

    var buildUi = document.getElementById('build-ui');
    if (buildUi) buildUi.classList.add('hidden');

    loadLevelIntoScene(levelId);
    clearRespawnMarkers();
    try { clearRemoteBuilders(); } catch (e) {}

    players.forEach(function (p) {
      if (p && p.group) { try { scene.remove(p.group); } catch (e) {} p.group = null; }
    });
    try { clearRemoteMeshes(); } catch (e) {}

    var c0 = null;
    try { c0 = (typeof playerCustom !== 'undefined') ? playerCustom[0] : null; } catch (e) {}
    var spawns = getLevelRespawnPoints('lan');
    if (!spawns || !spawns.length) spawns = getLevelRespawnPoints('split');
    var s0 = (spawns && spawns[0]) ? spawns[0] : { x: 0, y: 0, z: 0 };
    // لو منضم في اختبار مشترك: ريسبون تاني
    if (state.buildCollabOnline && !state.isHost && spawns && spawns[1]) {
      s0 = spawns[1];
    }
    players[0].group = createCharacterMesh(0x1e40af, 0xe0ac69, c0);
    players[0].group.position.set(s0.x, 0, s0.z);
    players[0].yaw = 0;
    if (players[0].velocity) players[0].velocity.set(0, 0, 0);
    players[0].vehicle = null;
    players[0].vehicleSeat = null;
    scene.add(players[0].group);
    try { attachNameTag(players[0].group, state.playerName || 'اختبار', true); } catch (e) {}
    if (players[1]) { players[1].group = null; players[1].camera = null; }

    var aspect = window.innerWidth / Math.max(1, window.innerHeight);
    players[0].camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 400);
    try { updatePlayerCamera(players[0]); } catch (e) {}
    try { updateInteractPrompt(); updateRadioSpatial(); } catch (eIP) {}

    try {
      if (!state.script) state.script = {};
      state.script.inputLocked = {};
      state.script.forcedInput = {};
      state.script.cameraOverride = {};
    } catch (e) {}
    state.paused = false;
    state.mouseHidden = true;
    try {
      document.body.style.cursor = 'none';
      if (canvas && canvas.requestPointerLock) canvas.requestPointerLock();
    } catch (e) {}

    try {
      renderer.setScissorTest(false);
      var labels = document.getElementById('split-labels');
      if (labels) labels.style.display = 'none';
    } catch (e) {}

    if (state.buildCollabOnline) {
      // اختبار مشترك أونلاين — متغيرش isHost
      state.playType = 'online';
      state.useLan = false;
      state.useFirebase = false;
      state.useManualRtc = true;
      // force pose broadcast
      state._lastSentCustomKey = null;
    } else {
      state.playType = 'test';
      state.isHost = true;
      state.useLan = false;
      state.useFirebase = false;
      state.player2Joined = false;
    }

    showScreen('play');
    // showScreen play might clear things — restore character if needed
    if (!players[0].group) {
      players[0].group = createCharacterMesh(0x1e40af, 0xe0ac69, c0);
      players[0].group.position.set(s0.x, 0, s0.z);
      scene.add(players[0].group);
      players[0].camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 400);
    }
    ensureTestExitBar();
    // في الاختبار المشترك المنضم: شريط الخروج للقائد بس؟ خلّيه للاتنين يقدروا يشوفوا بس القائد يخرج الكل
    var exitBarBtn = document.getElementById('btn-exit-test');
    if (exitBarBtn && state.buildCollabOnline && !state.isHost) {
      exitBarBtn.textContent = 'انتظار القائد...';
      // المنضم يقدر يخرج لنفسه كمان
      exitBarBtn.onclick = function () { exitTestMode({ fromNet: false }); };
    }

    setTimeout(function () {
      try {
        if (typeof runLevelScripts === 'function') runLevelScripts(levelId);
      } catch (eScr) { console.warn(eScr); }
      setTimeout(function () {
        try {
          state.script.inputLocked[0] = false;
          state.script.inputLocked[1] = false;
          state.script.forcedInput[0] = null;
          state.script.cameraOverride[0] = null;
        } catch (e2) {}
        state.mouseHidden = true;
        try { if (canvas && canvas.requestPointerLock) canvas.requestPointerLock(); } catch (e3) {}
        // ابعت أول بوز
        if (state.buildCollabOnline) {
          try { sendMyPose(); } catch (eP) {}
        }
      }, 800);
    }, 120);
    var nm = (state.levels[levelId] && state.levels[levelId].name) || levelId;
    toast((state.buildCollabOnline ? 'اختبار مشترك: ' : 'اختبار: ') + nm + ' — ESC للخروج', 'success');
  }

  function openTestLevelPicker() {
    var ids = Object.keys(state.levels || {});
    if (!ids.length) {
      toast('مفيش لفِلات — أنشئ لفل أولاً', 'error');
      return;
    }
    var existing = document.getElementById('test-level-picker');
    if (existing) existing.remove();

    var wrap = document.createElement('div');
    wrap.id = 'test-level-picker';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:100080;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;direction:rtl;';
    var box = document.createElement('div');
    box.style.cssText = 'background:linear-gradient(145deg,#121826,#0b1220);border:1px solid rgba(34,197,94,0.5);border-radius:16px;padding:22px 24px;min-width:300px;max-width:92vw;box-shadow:0 20px 50px rgba(0,0,0,0.55);color:#fff;font-family:sans-serif;';
    box.innerHTML = '<div style="font-weight:700;font-size:1.15rem;margin-bottom:6px;color:#86efac">▶ اختبار لفل</div>' +
      '<div style="font-size:0.85rem;color:#94a3b8;margin-bottom:14px">اختَر اللفل اللي عايز تجربه</div>';

    var sel = document.createElement('select');
    sel.style.cssText = 'width:100%;padding:10px 12px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#fff;font-size:0.95rem;margin-bottom:16px;';
    ids.forEach(function (id) {
      var opt = document.createElement('option');
      opt.value = id;
      var lv = state.levels[id];
      opt.textContent = (lv && lv.name) ? lv.name : id;
      if (id === state.currentLevelId) opt.selected = true;
      sel.appendChild(opt);
    });
    box.appendChild(sel);

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
    var btnCancel = document.createElement('button');
    btnCancel.textContent = 'إلغاء';
    btnCancel.style.cssText = 'padding:8px 16px;border:0;border-radius:10px;background:#334155;color:#fff;cursor:pointer;font-weight:600;';
    var btnGo = document.createElement('button');
    btnGo.textContent = 'ابدأ الاختبار';
    btnGo.style.cssText = 'padding:8px 16px;border:0;border-radius:10px;background:#22c55e;color:#041;cursor:pointer;font-weight:700;';
    btnCancel.onclick = function () { wrap.remove(); };
    btnGo.onclick = function () {
      var id = sel.value;
      wrap.remove();
      beginLevelTest(id);
    };
    wrap.addEventListener('click', function (e) { if (e.target === wrap) wrap.remove(); });
    row.appendChild(btnCancel);
    row.appendChild(btnGo);
    box.appendChild(row);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
  }

  var btnTestLevel = document.getElementById('btn-test-level');
  if (btnTestLevel) {
    btnTestLevel.onclick = function () {
      if (state.buildCollabOnline && !state.isHost) {
        toast('الاختبار للقائد فقط — هتدخل معاه لما يبدأ', 'info');
        return;
      }
      openTestLevelPicker();
    };
  }

  // ===== RESPAWN UI =====
  var btnRespawnPlaces = document.getElementById('btn-respawn-places');
  if (btnRespawnPlaces) {
    btnRespawnPlaces.onclick = function () {
      if (!state.currentLevelId) {
        toast('أنشئ لفل أولاً', 'error');
        return;
      }
      var panel = document.getElementById('respawn-choice-panel');
      if (!panel) return;
      panel.classList.toggle('hidden');
      if (panel.classList.contains('hidden')) {
        state.respawnPlaceMode = null;
        updateRespawnHint();
      }
    };
  }
  var btnRespawnLan = document.getElementById('btn-respawn-lan');
  if (btnRespawnLan) {
    btnRespawnLan.onclick = function () {
      state.respawnPlaceMode = 'lan';
      state.selectedItem = null;
      state.currentTool = 'select';
      selectBuildObject(null);
      if (ghostMesh) { scene.remove(ghostMesh); ghostMesh = null; }
      updateRespawnHint();
      toast('وضع LAN: اضغط على الأرض لوضع نقاط خضراء (حد أقصى 8)', 'info');
    };
  }
  var btnRespawnSplit = document.getElementById('btn-respawn-split');
  if (btnRespawnSplit) {
    btnRespawnSplit.onclick = function () {
      state.respawnPlaceMode = 'split';
      state.selectedItem = null;
      state.currentTool = 'select';
      selectBuildObject(null);
      if (ghostMesh) { scene.remove(ghostMesh); ghostMesh = null; }
      updateRespawnHint();
      toast('وضع Split: اضغط على الأرض لوضع نقاط حمراء (حد أقصى 2)', 'info');
    };
  }
  var btnRespawnDone = document.getElementById('btn-respawn-done');
  if (btnRespawnDone) {
    btnRespawnDone.onclick = function () {
      state.respawnPlaceMode = null;
      saveRespawnsFromMarkers();
      var panel = document.getElementById('respawn-choice-panel');
      if (panel) panel.classList.add('hidden');
      updateRespawnHint();
      toast('تم حفظ أماكن الريسبون', 'success');
    };
  }
  document.getElementById('btn-new-level').onclick = createNewLevel;
  document.getElementById('btn-upload-all').onclick = function () { document.getElementById('upload-all-input').click(); };
  document.getElementById('upload-all-input').onchange = function (e) {
    if (e.target.files && e.target.files[0]) uploadComprehensiveZip(e.target.files[0]);
    e.target.value = '';
  };

  var toolBtns = document.querySelectorAll('.tool-btn');
  for (var t = 0; t < toolBtns.length; t++) {
    toolBtns[t].onclick = (function (btn) {
      return function () {
        for (var i = 0; i < toolBtns.length; i++) toolBtns[i].classList.remove('active');
        btn.classList.add('active');
        state.currentTool = btn.getAttribute('data-tool');
        var toolNames = { select: 'اختيار', place: 'وضع', delete: 'الحذف المحيطي' };
        var ct = document.getElementById('current-tool');
        if (ct) ct.textContent = 'أداة: ' + (toolNames[state.currentTool] || state.currentTool);
        updateGhost();
        if (state.currentTool === 'delete') {
          toast('الحذف المحيطي: اسحب بالماوس حول العناصر لمسحها', 'info');
        }
      };
    })(toolBtns[t]);
  }
  var catBtns = document.querySelectorAll('.cat-btn');
  function bindCatButtons() {
    catBtns = document.querySelectorAll('.cat-btn');
    for (var c = 0; c < catBtns.length; c++) {
      catBtns[c].onclick = (function (btn) {
        return function () {
          var sec = btn.getAttribute('data-section') || 'static';
          var scope = sec === 'interactive' ? document.getElementById('cats-interactive') : document.getElementById('cats-static');
          var list = scope ? scope.querySelectorAll('.cat-btn') : catBtns;
          for (var i = 0; i < list.length; i++) list[i].classList.remove('active');
          btn.classList.add('active');
          state.currentCategory = btn.getAttribute('data-cat');
          populateSidebar();
        };
      })(catBtns[c]);
    }
  }
  bindCatButtons();

  // قسم الجماد / التفاعلي → يفتح أقسام في اللوحة يمين
  var sectionBtns = document.querySelectorAll('.section-btn');
  for (var sb = 0; sb < sectionBtns.length; sb++) {
    sectionBtns[sb].onclick = (function (btn) {
      return function () {
        for (var i = 0; i < sectionBtns.length; i++) sectionBtns[i].classList.remove('active');
        btn.classList.add('active');
        state.catalogSection = btn.getAttribute('data-section') || 'static';
        state.catalogView = 'categories';
        state.selectedItem = null;
        var search = document.getElementById('build-search');
        if (search) search.value = '';
        renderCatalogCategories();
        updateGhost();
      };
    })(sectionBtns[sb]);
  }
  var catalogBack = document.getElementById('catalog-back');
  if (catalogBack) {
    catalogBack.onclick = function () {
      state.catalogView = 'categories';
      state.selectedItem = null;
      var search = document.getElementById('build-search');
      if (search) search.value = '';
      renderCatalogCategories();
      updateGhost();
    };
  }
  // أول فتح: اعرض أقسام الجماد
  try { renderCatalogCategories(); } catch (e0) {}

  // راديو seek
  var radioSeek = document.getElementById('radio-seek');
  if (radioSeek) {
    radioSeek.oninput = function () {
      if (_radioAudio && _radioAudio.duration) {
        _radioAudio.currentTime = (radioSeek.value / 1000) * _radioAudio.duration;
      }
    };
  }
  var radioClose = document.getElementById('radio-close');
  if (radioClose) radioClose.onclick = function () { closeCarRadio(); };

  // أزرار الغيارات على الشاشة
  for (var gi = 1; gi <= 5; gi++) {
    (function (g) {
      var btn = document.getElementById('vh-gear-' + g);
      if (!btn) return;
      btn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (players[0] && players[0].vehicle && (!players[0].vehicleSeat || players[0].vehicleSeat === 'driver')) {
          setVehicleGear(players[0].vehicle, g, players[0]);
        }
      };
    })(gi);
  }


  window.addEventListener('resize', function () {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    buildCamera.aspect = w / h; buildCamera.updateProjectionMatrix();
    if (players[0].camera) {
      players[0].camera.aspect = (w / 2) / h; players[0].camera.updateProjectionMatrix();
      if (players[1].camera) { players[1].camera.aspect = (w / 2) / h; players[1].camera.updateProjectionMatrix(); }
    }
  });

  // Shared cutscene camera (created once)
  var cutsceneCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);

  function animate() {
    requestAnimationFrame(animate);
    var rawDelta = Math.min(state.clock.getDelta(), 0.05);
    var delta = rawDelta * (state.script.timeScale || 1);
    var gpInput = pollGamepad();

    // FPS counter
    state._fpsFrames = (state._fpsFrames || 0) + 1;
    state._fpsAcc = (state._fpsAcc || 0) + rawDelta;
    if (state._fpsAcc >= 0.4) {
      var fps = Math.round(state._fpsFrames / state._fpsAcc);
      state._fpsFrames = 0;
      state._fpsAcc = 0;
      var fpsNet = document.getElementById('fps-counter');
      var fpsSolo = document.getElementById('fps-counter-solo');
      var fpsHud = document.getElementById('fps-hud');
      var netHud = document.getElementById('net-ping-hud');
      var online = isOnlineConnected() || !!state.buildCollabOnline;
      if (state.mode !== 'play' && state.mode !== 'lobby' && !(state.mode === 'build' && state.buildCollabOnline)) {
        if (fpsHud) fpsHud.classList.add('hidden');
        if (netHud) netHud.classList.add('hidden');
      } else if (online) {
        if (fpsNet) fpsNet.textContent = fps + ' FPS';
        if (state.mode === 'play' && fpsHud) fpsHud.classList.add('hidden');
        if (netHud) {
          netHud.classList.remove('hidden');
          if (state.netPing > 0) updatePingHud(state.netPing);
        }
      } else {
        if (fpsHud) {
          if (state.showFpsHud !== false && state.mode === 'play') {
            fpsHud.classList.remove('hidden');
            if (fpsSolo) fpsSolo.textContent = fps + ' FPS';
          } else {
            fpsHud.classList.add('hidden');
          }
        }
        if (netHud) netHud.classList.add('hidden');
      }
    }

    if (state.mode === 'play') {
      // Per-player pause: only freeze the player who opened the menu
      var p0Paused = state.paused && (state.pauseOwner === 0 || state.pauseOwner === null && state.playType !== 'split');
      var p1Paused = state.paused && (state.pauseOwner === 1 || state.pauseOwner === null && state.playType !== 'split');
      // Full pause (online / both) freezes everyone
      if (state.paused && state.playType !== 'split') { p0Paused = true; p1Paused = true; }

      if (!p0Paused) {
        updatePlayerMovement(players[0], delta, {
          up: state.keys['KeyW'], down: state.keys['KeyS'], left: state.keys['KeyA'], right: state.keys['KeyD'],
          jump: state.keys['Space'], run: state.keys['ShiftLeft'] || state.keys['ShiftRight']
        });
      }
      try { updateHeldWeaponPose(players[0], delta); } catch (eWp) {}
      try { updateInteractPrompt(); updateRadioSpatial(); updateGasZoneHints(players[0]); updatePlayHintsUI(); } catch (eIP2) {}

      try { updateBullets(delta); updatePhysProps(delta); tryPickupNearbyWeapon(players[0]); tryPickupNearbyPhone(players[0]); } catch (eW) {}
      try {
        // رشاش: إطلاق مستمر طالما الزر مضغوط + تصويب (مش أثناء ضبط الكاميرا)
        if (!state.aimEditMode && state.mouseLeftDown && state.aiming && state.heldWeapon && state.heldWeapon.kind === 'smg' && !state.heldWeapon.inBag) {
          fireBullet(players[0]);
        }
      } catch (eAF) {}
      try { updateDeliveryWorkers(delta); updateBossPatrol(delta); updateMouthAnims(delta); updateFuelEmptyUI(players[0]); } catch (eGas) {}
      try { updateHackButtonVisibility(); } catch (eH) {}
      // aim FOV
      if (players[0] && players[0].camera) {
        var targetFov = (state.aiming && playerHoldingWeapon()) ? 48 : 70;
        var cam = players[0].camera;
        cam.fov += (targetFov - cam.fov) * Math.min(1, delta * 8);
        cam.updateProjectionMatrix();
        var ch = document.getElementById('crosshair');
        if (ch) {
          if (playerHoldingWeapon()) {
            ch.classList.remove('hidden');
            ch.classList.toggle('aiming', !!state.aiming);
          } else ch.classList.add('hidden');
        }
      }
      // hack fly
      if (state.hackFly && players[0] && players[0].group && !players[0].vehicle) {
        var pf = players[0];
        var spd = 12;
        if (state.keys['Space']) pf.group.position.y += spd * delta;
        if (state.keys['ShiftLeft'] || state.keys['ShiftRight']) pf.group.position.y = Math.max(0, pf.group.position.y - spd * delta);
        var fy = pf.yaw || 0;
        var fx = 0, fz = 0;
        if (state.keys['KeyW']) { fx += Math.sin(fy); fz += Math.cos(fy); }
        if (state.keys['KeyS']) { fx -= Math.sin(fy); fz -= Math.cos(fy); }
        if (state.keys['KeyA']) { fx += Math.sin(fy - Math.PI/2); fz += Math.cos(fy - Math.PI/2); }
        if (state.keys['KeyD']) { fx += Math.sin(fy + Math.PI/2); fz += Math.cos(fy + Math.PI/2); }
        var fl = Math.sqrt(fx*fx+fz*fz);
        if (fl > 0.001) { fx/=fl; fz/=fl; pf.group.position.x += fx*spd*delta; pf.group.position.z += fz*spd*delta; }
        if (pf.velocity) pf.velocity.set(0,0,0);
      }

      if (players[0].vehicle) {
        try { updateVehicleHUD(players[0].vehicle, players[0]); } catch (eH2) {}
      } else {
        try { hideVehicleHUD(); } catch (eH3) {}
      }
      // Split only: local player 2 via gamepad. Online: everyone is players[0] on their device
      if (state.playType === 'split' && !p1Paused && gpInput) {
        var gpScale = 0.008 * (players[1].settings.sens || 5);
        gpInput.lookX = (gpInput.lookX || 0) * (gpScale / 0.04);
        updatePlayerMovement(players[1], delta, gpInput);
      }
      if (state.paused && state.pauseOwner === 1) {
        handleGamepadMenuNav(gpInput, rawDelta);
      }
      // Network pose sync — PeerJS ~30Hz, LAN WebSocket fixed ~33Hz (no adaptive lag feedback)
      if (state.playType === 'online') {
        updateRemoteMeshes(delta);
        // حركة راس التحدث (محلي + ريموت)
        try {
          if (state.voice && state.voice.enabled) voiceUpdateLevel();
          if (players[0] && players[0].group) {
            var locTalk = !!(state.voice && state.voice.enabled && state.voice.talking);
            var locMic = !!(state.voice && state.voice.enabled && state.voice.stream);
            applyHeadTalkBob(players[0].group, locTalk, state.voice ? (state.voice.level || 0) : 0, delta);
            // اسم أخضر + أيقونة مايك (حتى داخل العربية)
            try {
              updateNameTagState(players[0].group, {
                talking: locTalk,
                micOn: locMic,
                name: state.playerName || 'لاعب'
              });
            } catch (eNt) {}
          }
          var rids = Object.keys(state.remoteMeshes || {});
          for (var ri = 0; ri < rids.length; ri++) {
            var rm = state.remoteMeshes[rids[ri]];
            if (!rm || !rm.visible) continue;
            applyHeadTalkBob(rm, !!rm.userData.talking, rm.userData.talkLv || 0.2, delta);
            // سلاح الريموت: انتقال سلس بين التعلّق والتصويب
            try {
              var rw = rm.userData._remoteWeapon;
              if (rw && rm.userData._remoteWeaponKey && String(rm.userData._remoteWeaponKey).indexOf('hand:') === 0) {
                var wantAim = !!rm.userData.aiming || (state.remoteTargets && state.remoteTargets[rids[ri]] && state.remoteTargets[rids[ri]].aiming);
                var b = rw.userData._aimBlend;
                if (b == null) b = wantAim ? 1 : 0;
                var tgt = wantAim ? 1 : 0;
                b += (tgt - b) * Math.min(1, delta * 12);
                rw.userData._aimBlend = b;
                var hangPos = { x: 0.40, y: 0.82, z: 0.16 };
                var hangRot = { x: 1.05, y: Math.PI * 0.78, z: 0.35 };
                var aimPos = { x: 0.28, y: 1.28, z: 0.48 };
                var aimRot = { x: -0.08, y: Math.PI * 0.98, z: 0.02 };
                lerpWeaponPose(rw, hangPos, hangRot, aimPos, aimRot, b);
              }
            } catch (eRw) {}
          }
        } catch (eHb) {}
        try { updateMicHud(); } catch (eMh) {}
        try { updatePeerVoiceSpatial(); } catch (eSp) {}
        state.netPoseTimer = (state.netPoseTimer || 0) + rawDelta;
        var rosterN = (state.netRoster && state.netRoster.length) || 1;
        // تكيف مع البنج (Radmin / VPN): بنج عالي → بث أقل = شبكة أهدى
        var pingMs = state.netPing || 0;
        var poseInterval;
        if (pingMs > 180) poseInterval = 0.08;
        else if (pingMs > 120) poseInterval = 0.055;
        else if (pingMs > 70) poseInterval = 0.04;
        else poseInterval = state.useLan ? 0.033 : 0.04;
        if (rosterN >= 4) poseInterval = Math.max(poseInterval, 0.05);
        if (state.netPoseTimer >= poseInterval) {
          state.netPoseTimer = 0;
          sendMyPose();
        }
        // الهوست يبعت snapshot خفيف كل 3 ثواني لو في 3+ عشان التالت ميفقدش
        if (state.isHost && rosterN >= 3) {
          state._hostSnapAcc = (state._hostSnapAcc || 0) + (typeof rawDelta === 'number' ? rawDelta : 0.016);
          if (state._hostSnapAcc >= 3) {
            state._hostSnapAcc = 0;
            try { sendPoseSnapshotTo(null); } catch (eSnap) {}
          }
        }
      }

      // Cutscene: full-screen cinematic camera
      if (state.script.cutscene && state.script.cutsceneCam) {
        var cc = state.script.cutsceneCam;
        var lerp = cc.lerp != null ? cc.lerp : 0.08;
        cutsceneCamera.aspect = window.innerWidth / window.innerHeight;
        cutsceneCamera.updateProjectionMatrix();
        if (cc.fov) { cutsceneCamera.fov = cc.fov; cutsceneCamera.updateProjectionMatrix(); }
        cutsceneCamera.position.lerp(new THREE.Vector3(cc.x, cc.y, cc.z), lerp);
        if (cc.lookX != null) {
          var lookTarget = new THREE.Vector3(cc.lookX, cc.lookY, cc.lookZ);
          // smooth look
          if (!cutsceneCamera.userData._look) cutsceneCamera.userData._look = lookTarget.clone();
          cutsceneCamera.userData._look.lerp(lookTarget, lerp);
          cutsceneCamera.lookAt(cutsceneCamera.userData._look);
        }
        renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
        renderer.setScissor(0, 0, window.innerWidth, window.innerHeight);
        renderer.render(scene, cutsceneCamera);
      } else if (state.playType === 'online' || state.playType === 'test') {
        updatePlayerCamera(players[0]);
        var w = window.innerWidth, h = window.innerHeight;
        if (players[0].camera) {
          players[0].camera.aspect = w / h;
          players[0].camera.updateProjectionMatrix();
        }
        renderer.setViewport(0, 0, w, h);
        renderer.setScissor(0, 0, w, h);
        renderer.render(scene, players[0].camera || cutsceneCamera);
      } else {
        updatePlayerCamera(players[0]);
        updatePlayerCamera(players[1]);
        var w = window.innerWidth, h = window.innerHeight, half = Math.floor(w / 2);
        // P1 camera: hide own name, show P2
        setNameTagVisible(players[0].group, false);
        setNameTagVisible(players[1].group, true);
        renderer.setViewport(0, 0, half, h); renderer.setScissor(0, 0, half, h);
        renderer.render(scene, players[0].camera);
        // P2 camera: hide own name, show P1
        setNameTagVisible(players[0].group, true);
        setNameTagVisible(players[1].group, false);
        renderer.setViewport(half, 0, w - half, h); renderer.setScissor(half, 0, w - half, h);
        renderer.render(scene, players[1].camera);
      }
    } else if (state.mode === 'build') {
      // كاميرا البناء دايمًا تتحرك بـ WASD (من غير ما تقفل أدوات البناء)
      if (!state._buildPaused) {
        state.flyMode = true; // للحركة فقط
        updateFlyCamera(rawDelta);
      }
      if (state.buildCollabOnline) {
        state._buildPoseAcc = (state._buildPoseAcc || 0) + (rawDelta || 0.016);
        if (state._buildPoseAcc >= 0.12) {
          state._buildPoseAcc = 0;
          try { sendBuildPose(); } catch (eBP) {}
        }
        state._rosterHudAcc = (state._rosterHudAcc || 0) + (rawDelta || 0.016);
        if (state._rosterHudAcc >= 1) {
          state._rosterHudAcc = 0;
          try { updateBuildRosterHud(); } catch (eR) {}
        }
      }
      if (selectedBuildObj) {
        updateObjToolbarPos();
        if (typeof syncGizmoTransform === 'function') syncGizmoTransform();
      }
      try { updatePlayHintsUI(); } catch (eH) {}
      renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
      renderer.render(scene, buildCamera);
    } else {
      renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
      renderer.render(scene, buildCamera);
    }
  }


  
  // ===== LEVEL SYNC OVER LAN =====
  function serializeAllLevels() {
    // Save current level first
    if (state.currentLevelId && state.levels[state.currentLevelId]) {
      state.levels[state.currentLevelId].objects = serializeObjects();
    }
    var out = {};
    Object.keys(state.levels).forEach(function (id) {
      var lv = state.levels[id];
      out[id] = {
        name: lv.name,
        objects: lv.objects || [],
        scripts: (lv.scripts || []).map(function (s) { return { name: s.name, content: s.content }; }),
        // sounds can be large — still send (dataUrls)
        sounds: (lv.sounds || []).map(function (s) { return { name: s.name, dataUrl: s.dataUrl, type: s.type }; }),
        createdAt: lv.createdAt
      };
    });
    return out;
  }

  function applySyncedLevels(levelsData) {
    state.levels = {};
    Object.keys(levelsData || {}).forEach(function (id) {
      var lv = levelsData[id];
      state.levels[id] = {
        name: lv.name,
        objects: lv.objects || [],
        scripts: lv.scripts || [],
        sounds: lv.sounds || [],
        createdAt: lv.createdAt || Date.now()
      };
    });
    renderLevelsList();
    updateLobbyLevelSelect();
  }

  function showSyncLoading(textMsg) {
    var ls = document.getElementById('loading-screen');
    var lt = document.getElementById('loading-text');
    if (ls) { ls.classList.remove('hidden'); }
    if (lt) lt.textContent = textMsg || 'جاري مزامنة اللفلز...';
  }
  function hideSyncLoading() {
    var ls = document.getElementById('loading-screen');
    if (ls) ls.classList.add('hidden');
  }

  
  // ===== Pure LAN bus (no internet) via lan_host.py on host machine =====
  function sameOriginLanHost() {
    // When game is opened from lan_host.py (http://IP:27100), use that origin — works on mobile
    try {
      if (typeof location !== 'undefined' && location.protocol && location.protocol.indexOf('http') === 0) {
        var port = location.port || '';
        if (port === String(state.lanPort || 27100) || port === '27100') {
          return location.origin.replace(/\/$/, '');
        }
      }
    } catch (e) {}
    return null;
  }

  function normalizeLanHost(raw) {
    var s = (raw || '').trim();
    if (!s) {
      var so0 = sameOriginLanHost();
      if (so0) return so0;
      return 'http://127.0.0.1:27100';
    }
    // Full URL already
    if (/^https?:\/\//i.test(s)) {
      return s.replace(/\/$/, '');
    }
    // host:port
    if (s.indexOf(':') !== -1 && s.indexOf('/') === -1) {
      return 'http://' + s;
    }
    // bare domain/tunnel hostname (no port) — use as https if looks public, else http + default port
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s) && !/^\d+\.\d+\.\d+\.\d+$/.test(s)) {
      // try cloudflare / ngrok style hostnames
      return 'https://' + s.replace(/\/$/, '');
    }
    // plain IP
    return 'http://' + s + ':' + (state.lanPort || 27100);
  }

  function lanBaseUrl() {
    if (state.lanIp) return normalizeLanHost(state.lanIp);
    var so = sameOriginLanHost();
    if (so) return so;
    return normalizeLanHost('127.0.0.1');
  }

  function lanWsUrl() {
    var base = lanBaseUrl(); // http://ip:port
    if (base.indexOf('https://') === 0) return 'wss://' + base.slice(8) + '/ws';
    if (base.indexOf('http://') === 0) return 'ws://' + base.slice(7) + '/ws';
    return 'ws://' + base.replace(/^\/\//, '') + '/ws';
  }

  function stopLanPoll() {
    state._lanPollActive = false;
    state._lanPollInflight = false;
    state._pendingPose = null;
    state._lanWsReady = false;
    if (state.lanPollTimer) {
      clearTimeout(state.lanPollTimer);
      state.lanPollTimer = null;
    }
    if (state._lanPingTimer) {
      clearInterval(state._lanPingTimer);
      state._lanPingTimer = null;
    }
    if (state._lanBeatTimer) {
      clearInterval(state._lanBeatTimer);
      state._lanBeatTimer = null;
    }
    if (state._lanAbort) {
      try { state._lanAbort.abort(); } catch (e) {}
      state._lanAbort = null;
    }
    if (state._lanWs) {
      try {
        state._lanWs.onopen = null;
        state._lanWs.onmessage = null;
        state._lanWs.onclose = null;
        state._lanWs.onerror = null;
        if (state._lanWs.readyState === 0 || state._lanWs.readyState === 1) state._lanWs.close();
      } catch (e) {}
      state._lanWs = null;
    }
    if (typeof hidePingHud === 'function') hidePingHud();
  }

  
  // ===== Firebase Realtime bus (بديل Firebase) =====
  var _fbApp = null, _fbDb = null, _fbUnsub = null, _fbMsgIds = {};
  function ensureFirebase() {
    if (_fbDb) return true;
    try {
      if (typeof firebase === 'undefined') {
        console.warn('Firebase SDK missing — تأكد من تحميل السكربتات');
        toast('مكتبة Firebase مش محمّلة — حدّث الصفحة', 'error');
        return false;
      }
      var cfg = window.__FIREBASE_CONFIG__;
      if (!cfg || !cfg.databaseURL) {
        console.warn('No Firebase config');
        toast('إعدادات Firebase ناقصة', 'error');
        return false;
      }
      if (!firebase.apps || !firebase.apps.length) {
        _fbApp = firebase.initializeApp(cfg);
      } else {
        _fbApp = firebase.app();
      }
      _fbDb = firebase.database();
      return true;
    } catch (e) {
      console.warn('Firebase init failed', e);
      toast('فشل تشغيل Firebase: ' + (e && e.message ? e.message : e), 'error');
      return false;
    }
  }
  function fbRoomRef(room) {
    return _fbDb.ref('rooms/' + String(room || 'default').replace(/[.#$\\[\\]]/g, '_'));
  }
  function fbSend(data) {
    if (!state.useFirebase || !state.roomCode || !ensureFirebase()) return;
    try {
      var payload = {
        data: data,
        from: state.myNetId || 'unknown',
        ts: firebase.database.ServerValue.TIMESTAMP
      };
      fbRoomRef(state.roomCode).child('messages').push(payload);
    } catch (e) {
      console.warn('fbSend', e);
    }
  }
  function fbStartListening(room) {
    if (!ensureFirebase()) return;
    fbStopListening();
    _fbMsgIds = {};
    var ref = fbRoomRef(room).child('messages');
    // اسمع الرسائل الجديدة فقط
    var startAt = Date.now() - 5000;
    ref.orderByChild('ts').startAt(startAt).on('child_added', function (snap) {
      var key = snap.key;
      if (_fbMsgIds[key]) return;
      _fbMsgIds[key] = true;
      var val = snap.val();
      if (!val || !val.data) return;
      if (val.from && val.from === state.myNetId) return;
      try {
        handlePeerData(val.data, !!state.isHost, null);
      } catch (e) {
        console.warn(e);
      }
    });
    _fbUnsub = function () { try { ref.off(); } catch (e) {} };
    // meta
    try {
      fbRoomRef(room).child('meta').update({
        host: state.playerName || 'host',
        updated: firebase.database.ServerValue.TIMESTAMP
      });
    } catch (e) {}
  }
  function fbStopListening() {
    if (_fbUnsub) { try { _fbUnsub(); } catch (e) {} _fbUnsub = null; }
  }


  function lanSend(data) {
    if (!state.useLan || !state.roomCode) return;
    // WebSocket path: single persistent connection — instant send
    if (state._lanWs && state._lanWs.readyState === 1) {
      try {
        // coalesce poses: latest wins — never queue multiple poses
        if (data && data.type === 'pose') {
          state._pendingPose = null;
        }
        state._lanWs.send(JSON.stringify({ room: state.roomCode, data: data }));
        return;
      } catch (e) {
        // fall through to HTTP
      }
    }
    // HTTP fallback (reconnect window / no WS yet)
    if (data && data.type === 'pose') {
      state._pendingPose = data;
    }
    state._lanSendInflight = state._lanSendInflight || 0;
    if (state._lanSendInflight >= 2) {
      if (data && data.type === 'pose') state._pendingPose = data;
      return;
    }
    state._lanSendInflight++;
    fetch(lanBaseUrl() + '/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: state.roomCode, data: data }),
      cache: 'no-store',
      keepalive: true
    }).then(function () {
      state._lanSendInflight = Math.max(0, state._lanSendInflight - 1);
      if (state._pendingPose && state._lanSendInflight < 2) {
        var p = state._pendingPose;
        state._pendingPose = null;
        lanSend(p);
      }
    }).catch(function () {
      state._lanSendInflight = Math.max(0, state._lanSendInflight - 1);
    });
  }

  function isOnlineConnected() {
    if (state.playType !== 'online') return false;
    if (state.useLan && state._lanPollActive) return true;
    if (state.usePeerCodes && state.peer) return true;
    if (state.useManualRtc) {
      if (state.connection && state.connection.open) return true;
      if (state.connections && state.connections.some(function (c) { return c && c.open; })) return true;
      return false;
    }
    if (state.useFirebase && state.roomCode) return true;
    if (state.connections && state.connections.some(function (c) { return c && c.open; })) return true;
    if (state.connection && state.connection.open) return true;
    return false;
  }

  function updatePingHud(ms) {
    state.netPing = ms;
    var hud = document.getElementById('net-ping-hud');
    var bars = document.getElementById('wifi-bars');
    var label = document.getElementById('ping-ms');
    if (!hud || !bars || !label) return;
    if (!isOnlineConnected() || (state.mode !== 'play' && state.mode !== 'lobby')) {
      hud.classList.add('hidden');
      return;
    }
    hud.classList.remove('hidden');
    // عتبات أهدى لـ Radmin/VPN (البنج الطبيعي هناك 50–150)
    var level = 1;
    if (ms <= 50) level = 5;
    else if (ms <= 100) level = 4;
    else if (ms <= 180) level = 3;
    else if (ms <= 300) level = 2;
    else level = 1;
    state.netPingBars = level;
    bars.className = 'wifi-bars level-' + level;
    if (level >= 4) bars.classList.add('color-green');
    else if (level >= 2) bars.classList.add('color-orange');
    else bars.classList.add('color-red');
    label.textContent = (ms > 0 ? Math.round(ms) : '--') + ' ms';
    label.style.color = level >= 4 ? '#30d158' : (level >= 2 ? '#f59e0b' : '#ff2d55');
    label.style.fontSize = '0.85rem';
  }

  function startPeerPingLoop() {
    if (state._peerPingTimer) clearInterval(state._peerPingTimer);
    // أول قياس فوري
    try {
      if (isOnlineConnected() && !state.useLan) {
        var tQuick = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        var qmsg = { type: 'ping', t: tQuick, id: state.myNetId };
        if (state.connection && state.connection.open) state.connection.send(qmsg);
        (state.connections || []).forEach(function (c) {
          try { if (c && c.open) c.send(qmsg); } catch (e) {}
        });
        updatePingHud(state.netPing || 0);
      }
    } catch (e0) {}
    state._peerPingTimer = setInterval(function () {
      if (!isOnlineConnected()) {
        try { hidePingHud(); } catch (e) {}
        return;
      }
      if (state.useLan) return; // LAN عنده ping خاص
      var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      var msg = { type: 'ping', t: t0, id: state.myNetId };
      try {
        if (state.connection && state.connection.open) state.connection.send(msg);
        (state.connections || []).forEach(function (c) {
          try { if (c && c.open) c.send(msg); } catch (e) {}
        });
      } catch (e) {}
      // خلي الهود ظاهر حتى قبل أول pong
      try {
        var hud = document.getElementById('net-ping-hud');
        if (hud && (state.mode === 'play' || state.mode === 'lobby')) {
          hud.classList.remove('hidden');
          if (state.netPing > 0) updatePingHud(state.netPing);
          else {
            var label = document.getElementById('ping-ms');
            if (label) label.textContent = '... ms';
          }
        }
      } catch (e2) {}
    }, state.useManualRtc ? 1000 : 1500);
  }

  function hidePingHud() {
    var hud = document.getElementById('net-ping-hud');
    if (hud) hud.classList.add('hidden');
  }

  function lanHandleWsMessage(j) {
    if (!j || !j.ok) return;
    var kind = j.kind;

    if (kind === 'pong') {
      if (j.c != null) {
        var sample = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - j.c;
        // تجاهل قراءات شاذة (تجميد تاب / GC)
        if (sample > 0 && sample < 1500) {
          var prev = state.netPing || sample;
          // لو القفزة كبيرة جدًا خفّف تأثيرها
          if (sample > prev + 120) sample = prev + 80;
          var alpha = sample > prev * 1.5 ? 0.12 : 0.28;
          state.netPing = prev * (1 - alpha) + sample * alpha;
          updatePingHud(state.netPing);
        }
      }
      return;
    }

    if (kind === 'hello') {
      state._lanWsReady = true;
      state._lanDeadStreak = 0;
      state._lanMissingStreak = 0;
      // apply snapshot
      if (j.poses && j.poses.length) {
        j.poses.forEach(function (m) {
          if (!m || !m.data) return;
          if (m.id > (state.lanSince || 0)) state.lanSince = m.id;
          var d = m.data;
          if (d.id && d.id === state.myNetId) return;
          handlePeerData(d, !!state.isHost, null);
        });
      }
      if (j.messages && j.messages.length) {
        j.messages.forEach(function (m) {
          if (!m || !m.data) return;
          if (m.id > (state.lanSince || 0)) state.lanSince = m.id;
          var d = m.data;
          if (d.type === 'pose') return;
          if (d.id && d.id === state.myNetId) return;
          if (d.type === 'start' && state.mode === 'play') return;
          handlePeerData(d, !!state.isHost, null);
        });
      }
      // flush pending pose
      if (state._pendingPose) {
        var pp = state._pendingPose;
        state._pendingPose = null;
        lanSend(pp);
      }
      return;
    }

    if (kind === 'dead') {
      if (!state.isHost) {
        var joinedAt = state._lanJoinedAt || 0;
        var age = Date.now() - joinedAt;
        state._lanDeadStreak = (state._lanDeadStreak || 0) + 1;
        if (age < 8000 && state._lanDeadStreak < 4) return;
        toast('القائد خرج — الروم اتقفل', 'error');
        stopLanPoll();
        clearRemoteMeshes && clearRemoteMeshes();
        state.useLan = false;
        state.netRoster = [];
        state.myNetId = null;
        showScreen('menu');
        showUI('main-menu');
      }
      return;
    }

    if (kind === 'pose' || kind === 'msg' || kind === 'event') {
      if (j.id && j.id > (state.lanSince || 0)) state.lanSince = j.id;
      var d = j.data;
      if (!d) return;
      if (d.type === 'pose' && d.id && d.id === state.myNetId) return;
      if (d.id && d.id === state.myNetId && (d.type === 'custom' || d.type === 'leave')) return;
      if (d.type === 'start' && state.mode === 'play') return;
      handlePeerData(d, !!state.isHost, null);
    }
  }

  function lanConnectWs() {
    if (!state.useLan || !state.roomCode || !state._lanPollActive) return;
    if (state._lanWs && (state._lanWs.readyState === 0 || state._lanWs.readyState === 1)) return;

    var url = lanWsUrl();
    var ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      // WS unavailable — fall back to HTTP poll loop
      state.lanPollTimer = setTimeout(lanPollOnceHttp, 80);
      return;
    }
    state._lanWs = ws;
    state._lanWsReady = false;

    ws.onopen = function () {
      state._lanWsReady = true; // allow sends immediately; hello still refreshes roster
      try { ws.binaryType = 'arraybuffer'; } catch (e) {}
      try {
        ws.send(JSON.stringify({
          type: 'hello',
          room: state.roomCode,
          id: state.myNetId,
          clientId: state.myNetId,
          name: state.playerName || 'لاعب',
          isHost: !!state.isHost,
          avatar: getNetAvatar()
        }));
      } catch (e) {}
      // latency probe
      if (state._lanPingTimer) clearInterval(state._lanPingTimer);
      state._lanPingTimer = setInterval(function () {
        if (!state._lanWs || state._lanWs.readyState !== 1) return;
        try {
          var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          state._lanWs.send(JSON.stringify({ type: 'ping', t: t0 }));
        } catch (e) {}
      }, 2000);
      // host heartbeat
      if (state._lanBeatTimer) clearInterval(state._lanBeatTimer);
      state._lanBeatTimer = setInterval(function () {
        if (!state.isHost || !state._lanPollActive) return;
        lanSend({
          type: 'hostbeat',
          isHost: true,
          id: state.myNetId,
          name: state.playerName || 'القائد',
          players: (state.netRoster || []).length || 1
        });
      }, state.mode === 'play' ? 2500 : 1500);
    };

    ws.onmessage = function (ev) {
      try {
        var j = JSON.parse(ev.data);
        lanHandleWsMessage(j);
      } catch (e) {}
    };

    ws.onclose = function () {
      state._lanWsReady = false;
      state._lanWs = null;
      if (state._lanPingTimer) { clearInterval(state._lanPingTimer); state._lanPingTimer = null; }
      if (!state._lanPollActive || !state.useLan) return;
      // auto-reconnect
      state.lanPollTimer = setTimeout(function () {
        if (state._lanPollActive && state.useLan) lanConnectWs();
      }, 400);
    };

    ws.onerror = function () {
      // onclose will handle reconnect
    };
  }

  // HTTP poll kept only as emergency fallback when WS fails entirely
  function lanPollOnceHttp() {
    if (!state.useLan || !state.roomCode || !state._lanPollActive) return;
    if (state._lanWs && state._lanWs.readyState === 1) return; // WS is up
    if (state._lanPollInflight) return;
    state._lanPollInflight = true;
    var url = lanBaseUrl() + '/poll?room=' + encodeURIComponent(state.roomCode) + '&since=' + (state.lanSince || 0);
    fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      state._lanPollInflight = false;
      if (j && j.dead && !state.isHost) {
        toast('القائد خرج — الروم اتقفل', 'error');
        stopLanPoll();
        state.useLan = false;
        showScreen('menu');
        showUI('main-menu');
        return;
      }
      if (j && j.poses) {
        j.poses.forEach(function (m) {
          if (!m || !m.data || (m.data.id === state.myNetId)) return;
          if (m.id > (state.lanSince || 0)) state.lanSince = m.id;
          handlePeerData(m.data, !!state.isHost, null);
        });
      }
      if (j && j.messages) {
        j.messages.forEach(function (m) {
          if (!m || !m.data || m.data.type === 'pose') return;
          if (m.id > (state.lanSince || 0)) state.lanSince = m.id;
          handlePeerData(m.data, !!state.isHost, null);
        });
      }
      if (state._lanPollActive && !(state._lanWs && state._lanWs.readyState === 1)) {
        state.lanPollTimer = setTimeout(lanPollOnceHttp, 60);
      }
    }).catch(function () {
      state._lanPollInflight = false;
      if (state._lanPollActive) state.lanPollTimer = setTimeout(lanPollOnceHttp, 120);
    });
  }

  function startLanPoll() {
    stopLanPoll();
    state.lanSince = 0;
    state._lanSendInflight = 0;
    state._lanPollInflight = false;
    state._pendingPose = null;
    state._lanPollActive = true;
    state._lanWsReady = false;
    // Prefer WebSocket — zero polling lag on LAN
    lanConnectWs();
  }

  // Tab visible again → ensure WS is alive
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.useLan && state._lanPollActive) {
      if (!state._lanWs || state._lanWs.readyState > 1) {
        lanConnectWs();
      }
      if (state.mode === 'play') {
        try { sendMyPose(); } catch (e) {}
      }
    }
  });

  function lanCheckHost(ip, cb) {
    var url = 'http://' + ip + ':' + (state.lanPort || 27100) + '/status';
    fetch(url, { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (j) {
      cb(!!(j && j.ok), j);
    }).catch(function () { cb(false, null); });
  }

  function broadcastToAll(msg, exceptConn) {
    if (state.isHost) {
      (state.connections || []).forEach(function (c) {
        if (c && c !== exceptConn && c.open) {
          try { c.send(msg); } catch (e) {}
        }
      });
    } else if (state.connection && state.connection.open) {
      try { state.connection.send(msg); } catch (e) {}
    }
  }


  // ===== Online session leave (host closes room for everyone) =====
  function leaveOnlineSession(fromPlay) {
    var wasHost = !!state.isHost;
    var myId = state.myNetId;
    var myName = state.playerName || 'لاعب';
    if (state.playType === 'online' && myId) {
      var leaveMsg = { type: 'leave', id: myId, name: myName, isHost: wasHost };
      try {
        if (state.useLan) lanSend(leaveMsg);
        else if (wasHost) broadcastToAll(leaveMsg);
        else if (state.connection) state.connection.send(leaveMsg);
      } catch (e) {}
      // Host closes the room on the LAN server so it disappears from the network list
      if (wasHost && state.useLan && state.roomCode) {
        try {
          fetch(lanBaseUrl() + '/roommeta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room: state.roomCode, close: true })
          });
        } catch (e) {}
      }
      // Host also tells everyone explicitly to go menu
      if (wasHost) {
        var closeMsg = { type: 'room_closed', by: myName };
        try {
          if (state.useLan) lanSend(closeMsg);
          else broadcastToAll(closeMsg);
        } catch (e) {}
      }
    }
    try { stopLanPoll && stopLanPoll(); } catch (e) {}
    try { stopAllScripts && stopAllScripts(); } catch (e) {}
    try { clearRemoteMeshes && clearRemoteMeshes(); } catch (e) {}
    try { clearLobbyPreviews && clearLobbyPreviews(); } catch (e) {}
    try { cleanupManualRtc && cleanupManualRtc(); } catch (e) {}
    if (state.peer) try { state.peer.destroy(); } catch (e) {}
    state.peer = null; state.connection = null; state.connections = [];
    state.player2Joined = false; state.netRoster = []; state.myNetId = null;
    state.useLan = false; state.useManualRtc = false; state.remoteTargets = {}; state.roomCode = state.roomCode;
    if (fromPlay) {
      showScreen('menu');
      showUI('main-menu');
    } else {
      showScreen('menu');
    }
  }


  // ===== Lobby portrait cards (left / right of center panel) =====
  state.lobbyPreviewMeshes = state.lobbyPreviewMeshes || {};
  state._lobbyPortraitRenderer = null;
  state._lobbyPortraitScene = null;
  state._lobbyPortraitCam = null;

  function clearLobbyPreviews() {
    Object.keys(state.lobbyPreviewMeshes || {}).forEach(function (id) {
      var m = state.lobbyPreviewMeshes[id];
      if (m && m.parent) try { scene.remove(m); } catch (e) {}
    });
    state.lobbyPreviewMeshes = {};
    var L = document.getElementById('lobby-side-left');
    var R = document.getElementById('lobby-side-right');
    if (L) L.innerHTML = '';
    if (R) R.innerHTML = '';
  }

  function getLobbyPortraitRenderer() {
    if (state._lobbyPortraitRenderer) return state._lobbyPortraitRenderer;
    try {
      var r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setSize(160, 200);
      r.setPixelRatio(1);
      r.setClearColor(0x000000, 0);
      state._lobbyPortraitRenderer = r;
      var sc = new THREE.Scene();
      sc.add(new THREE.AmbientLight(0xffffff, 0.65));
      var dl = new THREE.DirectionalLight(0xffffff, 0.85);
      dl.position.set(2, 4, 3);
      sc.add(dl);
      var fill = new THREE.DirectionalLight(0x88aaff, 0.25);
      fill.position.set(-2, 1, -1);
      sc.add(fill);
      state._lobbyPortraitScene = sc;
      var cam = new THREE.PerspectiveCamera(30, 200 / 280, 0.1, 50);
      cam.position.set(0.35, 1.55, 4.2);
      cam.lookAt(0, 1.25, 0);
      state._lobbyPortraitCam = cam;
      return r;
    } catch (e) {
      console.warn('lobby portrait renderer failed', e);
      return null;
    }
  }

  function renderPortraitToCanvas(custom, canvas) {
    var r = getLobbyPortraitRenderer();
    if (!r || !state._lobbyPortraitScene) return;
    var sc = state._lobbyPortraitScene;
    // clear old character
    var toRemove = [];
    sc.children.forEach(function (ch) {
      if (ch.isLight) return;
      toRemove.push(ch);
    });
    toRemove.forEach(function (ch) { sc.remove(ch); });
    var shirt = 0x1e40af;
    try {
      if (custom && custom.colorShirt) {
        shirt = parseInt(String(custom.colorShirt).replace('#', ''), 16) || 0x1e40af;
      }
    } catch (e) {}
    var mesh = createCharacterMesh(shirt, 0xe0ac69, custom || null);
    mesh.position.set(0, 0, 0);
    mesh.rotation.y = 0; // face camera
    sc.add(mesh);
    r.setSize(canvas.width, canvas.height);
    state._lobbyPortraitCam.aspect = canvas.width / canvas.height;
    state._lobbyPortraitCam.updateProjectionMatrix();
    r.render(sc, state._lobbyPortraitCam);
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(r.domElement, 0, 0);
    sc.remove(mesh);
  }

  function buildPortraitCard(p, isMe) {
    var card = document.createElement('div');
    card.className = 'lobby-portrait' + (p.isHost ? ' host' : '') + (isMe ? ' me' : '');
    card.dataset.netId = p.id || '';
    var canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 280;
    card.appendChild(canvas);
    // صورة الملف الشخصي فوق البورتريه
    var avUrl = isMe ? (state.playerAvatar || p.avatar || '') : (p.avatar || '');
    if (avUrl) {
      var avImg = document.createElement('img');
      avImg.className = 'lobby-avatar-badge';
      avImg.src = avUrl;
      avImg.alt = 'avatar';
      avImg.style.cssText = 'position:absolute;top:8px;right:8px;width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid #22d3ee;background:#0f172a;z-index:2';
      card.style.position = 'relative';
      card.appendChild(avImg);
    }
    var name = document.createElement('div');
    name.className = 'pname';
    name.textContent = (p.name || 'لاعب') + (isMe ? ' (أنت)' : '');
    card.appendChild(name);
    var role = document.createElement('div');
    role.className = 'prole';
    role.textContent = p.isHost ? '👑 القائد' : '🎮 لاعب';
    card.appendChild(role);
    try {
      renderPortraitToCanvas(p.custom || null, canvas);
    } catch (e) {
      console.warn(e);
    }
    return card;
  }

  function refreshLobbyPreviews() {
    var L = document.getElementById('lobby-side-left');
    var R = document.getElementById('lobby-side-right');
    if (!L || !R) return;
    if (state.mode !== 'lobby' || state.playType !== 'online') {
      L.innerHTML = '';
      R.innerHTML = '';
      return;
    }
    var roster = state.netRoster || [];
    if (!roster.length) {
      roster = [{
        id: state.myNetId || 'host',
        name: state.playerName || 'القائد',
        isHost: true,
        custom: (typeof playerCustom !== 'undefined' ? playerCustom[0] : null)
      }];
    }
    // sync local custom + avatar onto roster
    roster.forEach(function (r) {
      if (r.id === state.myNetId) {
        if (typeof playerCustom !== 'undefined') r.custom = playerCustom[0];
        if (state.playerName) r.name = state.playerName;
        if (state.playerAvatar) r.avatar = getNetAvatar();
      }
    });
    L.innerHTML = '';
    R.innerHTML = '';
    roster.forEach(function (p, i) {
      var isMe = p.id === state.myNetId;
      var card = buildPortraitCard(p, isMe);
      // زوجي يسار / فردي يمين — توزيع متوازن
      if (i % 2 === 0) L.appendChild(card);
      else R.appendChild(card);
    });
  }

  function renderNetLobbyList() {
    var list = document.getElementById('players-list');
    if (!list) return;
    var hint = document.getElementById('net-players-hint');
    if (state.playType !== 'online') {
      if (hint) hint.style.display = 'none';
      return;
    }
    if (hint) hint.style.display = 'block';
    list.innerHTML = '';
    var roster = state.netRoster || [];
    if (!roster.length) {
      roster = [{ id: 'host', name: state.playerName || 'القائد', isHost: true, avatar: state.playerAvatar || '' }];
    }
    roster.forEach(function (p, i) {
      var card = document.createElement('div');
      card.className = 'player-card ready' + (p.isHost ? ' host' : '');
      if (p.id === state.myNetId) card.style.borderColor = '#00d4ff';
      var nameStr = (p.name || ('لاعب ' + (i + 1))) + (p.id === state.myNetId ? ' (أنت)' : '');
      var avContent;
      if (p.id === state.myNetId && state.playerAvatar) {
        avContent = avatarHtml(state.playerAvatar, p.isHost ? '👑' : '🎮');
      } else if (p.avatar) {
        avContent = avatarHtml(p.avatar, p.isHost ? '👑' : '🎮');
      } else {
        avContent = p.isHost ? '👑' : '🎮';
      }
      card.innerHTML =
        '<div class="avatar">' + avContent + '</div>' +
        '<div class="player-info">' +
        '<span class="name">' + nameStr + '</span>' +
        '<span class="status online">READY ✓</span></div>';
      // Host can kick others
      if (state.isHost && !p.isHost && p.id !== state.myNetId) {
        var kickBtn = document.createElement('button');
        kickBtn.className = 'btn-kick';
        kickBtn.textContent = 'طرد';
        kickBtn.type = 'button';
        kickBtn.onclick = (function (targetId, targetName) {
          return function (e) {
            e.stopPropagation();
            kickPlayer(targetId, targetName);
          };
        })(p.id, p.name);
        card.appendChild(kickBtn);
      }
      list.appendChild(card);
    });
    var canStart = state.isHost && roster.length >= 2;
    var btn = document.getElementById('btn-start-game');
    if (btn && state.isHost) {
      btn.disabled = !canStart;
      btn.textContent = canStart ? ('START GAME (' + roster.length + ')') : 'انتظر لاعبين...';
    }
    try { refreshLobbyPreviews(); } catch (e) {}
  }

  function kickPlayer(targetId, targetName) {
    if (!state.isHost || !targetId) return;
    // Notify everyone
    var msg = { type: 'kick', id: targetId };
    if (state.useLan) lanSend(msg);
    else broadcastToAll(msg);
    // Close peer connection if any
    if (state.connections) {
      state.connections.forEach(function (c) {
        if (c._netId === targetId) {
          try { c.send({ type: 'kick', id: targetId }); } catch (e) {}
          try { c.close(); } catch (e) {}
        }
      });
      state.connections = state.connections.filter(function (c) { return c._netId !== targetId; });
    }
    // Remove from roster locally
    state.netRoster = (state.netRoster || []).filter(function (r) { return r.id !== targetId; });
    if (state.remoteMeshes[targetId]) {
      scene.remove(state.remoteMeshes[targetId]);
      delete state.remoteMeshes[targetId];
    }
    renderNetLobbyList();
    toast('تم طرد ' + (targetName || 'اللاعب'), 'info');
  }

  function clearRemoteMeshes() {
    Object.keys(state.remoteMeshes || {}).forEach(function (id) {
      var m = state.remoteMeshes[id];
      if (m) scene.remove(m);
    });
    state.remoteMeshes = {};
    state.remoteTargets = {};
  }

  function ensureRemoteMesh(netId, custom, displayName) {
    if (netId === state.myNetId) return null;
    if (state.remoteMeshes[netId]) {
      if (displayName && state.remoteMeshes[netId].userData.displayName !== displayName) {
        attachNameTag(state.remoteMeshes[netId], displayName, true);
      }
      return state.remoteMeshes[netId];
    }
    var colors = [0xb91c1c, 0x16a34a, 0xca8a04, 0x7c3aed, 0x0891b2, 0xdb2777, 0x65a30d];
    var idx = Object.keys(state.remoteMeshes).length % colors.length;
    var mesh = createCharacterMesh(colors[idx], 0xe0ac69, custom || null);
    mesh.position.set(idx * 2, 0, 2);
    var nm = displayName;
    if (!nm && state.netRoster) {
      for (var i = 0; i < state.netRoster.length; i++) {
        if (state.netRoster[i].id === netId) { nm = state.netRoster[i].name; break; }
      }
    }
    attachNameTag(mesh, nm || 'لاعب', true);
    scene.add(mesh);
    state.remoteMeshes[netId] = mesh;
    return mesh;
  }

  function handleWorldEvent(d) {
    if (!d || !d.action) return;
    if (d.action === 'horn') {
      playHorn(true);
      return;
    }
    if (d.action === 'light') {
      var lightObj = findInteractiveByIdOrPos({
        objectId: d.objectId,
        x: d.x, z: d.z, maxDist: 6,
        require: function (o) { return o.userData && o.userData.isLight; }
      });
      if (lightObj && !!lightObj.userData.lightOn !== !!d.on) {
        applyLightState(lightObj, !!d.on);
      }
      return;
    }
    if (d.action === 'engine') {
      var engV = findVehicleByNetId(d.vehicleId) || findInteractiveByIdOrPos({
        objectId: d.vehicleId, x: d.x, z: d.z, maxDist: 10,
        require: function (o) { return o.userData && o.userData.isVehicle; }
      });
      if (engV) setVehicleEngine(engV, !!d.on, null, true);
      return;
    }
    if (d.action === 'garage') {
      var gObj = findInteractiveByIdOrPos({
        objectId: d.objectId,
        x: d.x, z: d.z, maxDist: 10,
        require: function (o) { return o.userData && o.userData.isGarage; }
      });
      if (gObj && !!gObj.userData.gateOpen !== !!d.open) toggleGarage(gObj, true);
      return;
    }
    if (d.action === 'weapon_drop') {
      try { spawnGroundWeaponFromNet(d); } catch (eWd) { console.warn(eWd); }
      return;
    }
    if (d.action === 'weapon_pickup') {
      try { removeGroundWeaponFromNet(d); } catch (eWp) { console.warn(eWp); }
      return;
    }
    if (d.action === 'radio_play') {
      var vRadio = findVehicleByNetId(d.vehicleId);
      var track = null;
      if (d.trackId && typeof RADIO_TRACKS !== 'undefined') {
        for (var ti = 0; ti < RADIO_TRACKS.length; ti++) {
          if (RADIO_TRACKS[ti].id === d.trackId) { track = RADIO_TRACKS[ti]; break; }
        }
      }
      if (vRadio && track) {
        if (_radioAudio) { try { _radioAudio.pause(); } catch (e) {} _radioAudio = null; }
        try {
          _radioAudio = new Audio(track.src);
          _radioAudio.loop = false;
          _radioAudio.volume = 0.45;
          vRadio.userData.radioTrack = track.id;
          vRadio.userData._radioActive = true;
          _radioAudio.play().catch(function () {});
        } catch (eR) {}
      }
      return;
    }
    if (d.action === 'radio_stop') {
      var vStop = findVehicleByNetId(d.vehicleId);
      stopVehicleRadio(vStop || null, true);
      return;
    }
    if (d.action === 'shoot') {
      try {
        var origin = new THREE.Vector3(d.ox || 0, d.oy || 1, d.oz || 0);
        var dir = new THREE.Vector3(d.dx || 0, d.dy || 0, d.dz || 1).normalize();
        var geo = new THREE.SphereGeometry(0.06, 6, 6);
        var mat = new THREE.MeshBasicMaterial({ color: 0xffe566 });
        var bullet = new THREE.Mesh(geo, mat);
        bullet.position.copy(origin);
        scene.add(bullet);
        state.bullets.push({ mesh: bullet, dir: dir, speed: 58, life: 1.4 });
        spawnMuzzleFlash(origin);
      } catch (eSh) {}
      return;
    }
    // حالة عامة لأي كائن تفاعلي
    if (d.action === 'object_state') {
      var anyObj = findInteractiveByIdOrPos({ objectId: d.objectId, x: d.x, z: d.z, maxDist: 8 });
      if (!anyObj || !anyObj.userData) return;
      if (d.state) {
        Object.keys(d.state).forEach(function (k) {
          anyObj.userData[k] = d.state[k];
        });
      }
      if (anyObj.userData.isLight && d.state && d.state.lightOn != null) applyLightState(anyObj, d.state.lightOn);
      if (anyObj.userData.isGarage && d.state && d.state.gateOpen != null && !!anyObj.userData.gateOpen !== !!d.state.gateOpen) {
        toggleGarage(anyObj, true);
      }
      return;
    }
  }

  function syncRemoteWeaponVisual(d) {
    if (!d || !d.id) return;
    var mesh = state.remoteMeshes[d.id];
    if (!mesh) return;
    var handKind = d.weaponKind || (d.weapon && d.weapon !== 'bag' ? d.weapon : null) || null;
    var bagKinds = Array.isArray(d.bagKinds) ? d.bagKinds.slice() : [];
    if (!bagKinds.length && d.bagKind) bagKinds.push(d.bagKind);
    // لو مفيش إيد وفي ضهر فقط
    if (!handKind && d.weaponMode === 'bag' && d.weaponKind) bagKinds = [d.weaponKind];
    var aiming = !!d.aiming;
    var key = (handKind || '-') + '|' + bagKinds.join(',') + '|' + (aiming ? '1' : '0');
    if (mesh.userData._remoteWeaponKey === key) return;
    // امسح كل أسلحة الريموت القديمة
    try {
      if (mesh.userData._remoteWeapons) {
        mesh.userData._remoteWeapons.forEach(function (w) {
          try { mesh.remove(w); } catch (e) {}
        });
      }
      if (mesh.userData._remoteWeapon) {
        try { mesh.remove(mesh.userData._remoteWeapon); } catch (e) {}
      }
    } catch (eC) {}
    mesh.userData._remoteWeapons = [];
    mesh.userData._remoteWeapon = null;
    mesh.userData._remoteWeaponKey = key;

    function addGun(kind, mode, slotIdx) {
      if (!kind) return;
      var bodyCol = kind === 'smg' ? 0x334155 : 0x1e293b;
      var accent = kind === 'smg' ? 0x22d3ee : 0xfbbf24;
      var w = makeWeaponGunMesh(kind, bodyCol, accent);
      w.visible = true;
      if (mode === 'bag') poseWeaponOnBack(w, slotIdx || 0);
      else if (aiming) poseWeaponAim(w);
      else poseWeaponHang(w, 0);
      try {
        w.traverse(function (ch) {
          if (ch.isMesh) { ch.visible = true; ch.castShadow = true; }
        });
      } catch (eT) {}
      mesh.add(w);
      mesh.userData._remoteWeapons.push(w);
      if (!mesh.userData._remoteWeapon) mesh.userData._remoteWeapon = w;
    }
    if (handKind) addGun(handKind, 'hand', 0);
    for (var bi = 0; bi < bagKinds.length; bi++) addGun(bagKinds[bi], 'bag', bi);
  }

  function applyNetPose(d) {
    if (!d || d.id === state.myNetId) return;
    var mesh = ensureRemoteMesh(d.id, d.custom, d.name);
    if (!mesh) return;
    if (d.custom && mesh.userData._customKey !== JSON.stringify(d.custom)) {
      var pos = mesh.position.clone();
      var rot = mesh.rotation.y;
      var oldName = mesh.userData.displayName;
      scene.remove(mesh);
      var neu = createCharacterMesh(0xb91c1c, 0xe0ac69, d.custom);
      neu.position.copy(pos);
      neu.rotation.y = rot;
      neu.userData._customKey = JSON.stringify(d.custom);
      attachNameTag(neu, d.name || oldName || 'لاعب', true);
      scene.add(neu);
      state.remoteMeshes[d.id] = neu;
      mesh = neu;
    } else if (d.name && mesh.userData.displayName !== d.name) {
      attachNameTag(mesh, d.name, true);
    }
    if (!state.remoteTargets) state.remoteTargets = {};
    var prev = state.remoteTargets[d.id];
    var nowT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    // velocity from message or estimate from previous target
    var vx = (d.vx != null) ? d.vx : 0;
    var vz = (d.vz != null) ? d.vz : 0;
    if (prev && prev._t) {
      var dt = Math.max(0.016, (nowT - prev._t) / 1000);
      if (d.vx == null) vx = (d.x - prev.x) / dt;
      if (d.vz == null) vz = (d.z - prev.z) / dt;
      // clamp crazy spikes from lag spikes
      var spd = Math.sqrt(vx * vx + vz * vz);
      if (spd > 25) { vx *= 25 / spd; vz *= 25 / spd; }
    }
    state.remoteTargets[d.id] = {
      x: d.x, y: d.y || 0, z: d.z,
      yaw: (d.yaw || 0) + Math.PI,
      moving: !!d.moving,
      vx: vx, vz: vz, vy: d.vy || 0,
      _t: nowT,
      inVehicle: !!d.inVehicle,
      vehicleName: d.vehicleName || null,
      vehicleX: d.vehicleX, vehicleY: d.vehicleY, vehicleZ: d.vehicleZ,
      vehicleYaw: d.vehicleYaw,
      isDriver: !!d.isDriver,
      vehicleSeat: d.vehicleSeat || null,
      weapon: d.weapon || null,
      aiming: !!d.aiming,
      talking: !!d.talking,
      talkLv: d.talkLv || 0
    };
    try {
      mesh.userData.talking = !!d.talking;
      mesh.userData.talkLv = d.talkLv || 0;
      mesh.userData.micOn = !!d.micOn;
      mesh.userData.aiming = !!d.aiming;
      updateNameTagState(mesh, {
        talking: !!d.talking,
        micOn: !!d.micOn,
        name: d.name || mesh.userData.displayName || 'لاعب'
      });
    } catch (eTk) {}
    // أول بوز أو بعد انقطاع طويل: ثبّت الشكل فورًا
    if (!prev || !prev._t || (nowT - prev._t) > 1500) {
      mesh.position.set(d.x, d.y || 0, d.z);
      mesh.rotation.y = (d.yaw || 0) + Math.PI;
    }
    // Sync remote vehicle — السواق فقط يحرّك العربية عند الباقي
    if (d.inVehicle) {
      var vMesh = findVehicleByNetId(d.vehicleName);
      if (!vMesh && d.vehicleX != null) {
        var bestD = 12, best = null;
        for (var j = 0; j < state.buildObjects.length; j++) {
          var vo = state.buildObjects[j];
          if (!vo || !vo.userData || !vo.userData.isVehicle) continue;
          var dx = (vo.position.x - d.vehicleX), dz = (vo.position.z - d.vehicleZ);
          var dd = dx * dx + dz * dz;
          if (dd < bestD * bestD) { bestD = Math.sqrt(dd); best = vo; }
        }
        vMesh = best;
      }
      if (vMesh) {
        ensureVehicleData(vMesh);
        // حدّث موقع العربية من السواق فقط
        if (d.isDriver || d.vehicleSeat === 'driver' || !d.vehicleSeat) {
          if (d.vehicleX != null) {
            vMesh.position.x = d.vehicleX;
            vMesh.position.y = d.vehicleY || 0;
            vMesh.position.z = d.vehicleZ;
          }
          if (d.vehicleYaw != null) vMesh.rotation.y = d.vehicleYaw;
          vMesh.userData.drivenByNet = d.id;
        }
        // اللاعب البعيد داخل العربية — اخفيه بالكامل
        mesh.visible = false;
        try { mesh.traverse(function (ch) { ch.visible = false; }); } catch (eH) {}
        mesh.position.x = vMesh.position.x;
        mesh.position.y = (vMesh.position.y || 0) + 0.5;
        mesh.position.z = vMesh.position.z;
        state.remoteTargets[d.id].x = mesh.position.x;
        state.remoteTargets[d.id].y = mesh.position.y;
        state.remoteTargets[d.id].z = mesh.position.z;
        if (d.vehicleSeat === 'passenger') {
          vMesh.userData.seats = vMesh.userData.seats || {};
          vMesh.userData.seats.passenger = d.id;
        } else {
          vMesh.userData.seats = vMesh.userData.seats || {};
          vMesh.userData.seats.driver = d.id;
        }
        try {
          updateVehicleOccupantNameTags(vMesh, d.id, d.name || (mesh.userData && mesh.userData.displayName) || 'لاعب', d.vehicleSeat || 'driver');
        } catch (eNt) {}
      } else {
        mesh.visible = false;
      }
    } else {
      mesh.visible = true;
      try {
        mesh.traverse(function (ch) {
          if (ch.isMesh || ch.isSprite || ch.isGroup) ch.visible = true;
        });
      } catch (eVis) {}
      try { clearVehicleOccupantNameTagForPlayer(d.id); } catch (eCl) {}
      for (var k = 0; k < state.buildObjects.length; k++) {
        var vk = state.buildObjects[k];
        if (vk && vk.userData && vk.userData.drivenByNet === d.id) vk.userData.drivenByNet = null;
        if (vk && vk.userData && vk.userData.seats) {
          if (vk.userData.seats.passenger === d.id) vk.userData.seats.passenger = null;
          if (vk.userData.seats.driver === d.id) vk.userData.seats.driver = null;
        }
      }
    }
  }

  function updateRemoteMeshes(delta) {
    if (!state.remoteTargets) return;
    // تمهيد أقوى مع بنج عالي (Radmin)
    var lagBlend = 10;
    if ((state.netPing || 0) > 150) lagBlend = 6;
    else if ((state.netPing || 0) > 90) lagBlend = 8;
    var ids = Object.keys(state.remoteTargets);
    var ping = state.netPing || 100;
    // Radmin/VPN: تمهيد أقوى + توقع أطول = حركة أنعم رغم البنج
    var lagSec = Math.min(1.0, (ping / 1000) * 0.55);
    var followRate = ping > 250 ? 7 : (ping > 150 ? 10 : (ping > 80 ? 14 : 20));
    var snapDist2 = ping > 250 ? 49 : (ping > 120 ? 25 : 16);
    var nowT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var mesh = state.remoteMeshes[id];
      var t = state.remoteTargets[id];
      if (!mesh || !t) continue;
      // Extrapolate target forward using velocity (dead reckoning)
      var age = t._t ? Math.min(1.4, (nowT - t._t) / 1000) : 0;
      // damp velocity over time so we don't fly forever on stale data
      var damp = age > 0.5 ? Math.max(0.15, 1 - (age - 0.5) * 1.2) : 1;
      var ex = t.x + (t.vx || 0) * (age * damp + lagSec * 0.55);
      var ey = t.y;
      var ez = t.z + (t.vz || 0) * (age * damp + lagSec * 0.55);
      var dx = ex - mesh.position.x;
      var dy = ey - mesh.position.y;
      var dz = ez - mesh.position.z;
      var dist2 = dx * dx + dy * dy + dz * dz;
      if (dist2 > snapDist2) {
        // soft catch-up instead of hard teleport when laggy
        var catchUp = Math.min(1, 0.35);
        mesh.position.x += dx * catchUp;
        mesh.position.y += dy * catchUp;
        mesh.position.z += dz * catchUp;
      } else {
        var lerp = Math.min(1, followRate * delta);
        mesh.position.x += dx * lerp;
        mesh.position.y += dy * Math.min(1, (followRate + 10) * delta);
        mesh.position.z += dz * lerp;
      }
      // داخل العربية: اخفِ اللاعب بالكامل (منع البلوك الأزرق من وسط العربية)
      if (t.inVehicle) {
        mesh.visible = false;
        try {
          mesh.traverse(function (ch) { ch.visible = false; });
        } catch (eV) {}
        if (t.vehicleName || t.vehicleX != null) {
          for (var vi = 0; vi < state.buildObjects.length; vi++) {
            var vv = state.buildObjects[vi];
            if (!vv || !vv.userData || !vv.userData.isVehicle) continue;
            var match = false;
            if (t.vehicleName && (vv.userData.netVehicleId === t.vehicleName || vv.userData.instanceName === t.vehicleName)) match = true;
            if (!match && t.vehicleX != null) {
              var dxv = vv.position.x - t.vehicleX, dzv = vv.position.z - t.vehicleZ;
              if (dxv * dxv + dzv * dzv < 25) match = true;
            }
            if (match) {
              if (t.isDriver && t.vehicleX != null) {
                vv.position.x = t.vehicleX;
                vv.position.y = t.vehicleY || 0;
                vv.position.z = t.vehicleZ;
                if (t.vehicleYaw != null) vv.rotation.y = t.vehicleYaw;
              }
              mesh.position.x = vv.position.x;
              mesh.position.y = (vv.position.y || 0) + 0.5;
              mesh.position.z = vv.position.z;
              break;
            }
          }
        }
      } else {
        if (!mesh.visible) {
          mesh.visible = true;
          try { mesh.traverse(function (ch) { if (!ch.userData || !ch.userData._forceHidden) ch.visible = true; }); } catch (eS) {}
        }
      }
      var cy = mesh.rotation.y;
      var ty = t.yaw;
      var dYaw = ty - cy;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      mesh.rotation.y = cy + dYaw * Math.min(1, 12 * delta);
      if (t.moving && mesh.userData && mesh.userData.leftArm) {
        mesh.userData.walkCycle = (mesh.userData.walkCycle || 0) + delta * 10;
        var s = Math.sin(mesh.userData.walkCycle) * 0.5;
        mesh.userData.leftArm.rotation.x = s;
        mesh.userData.rightArm.rotation.x = -s;
        if (mesh.userData.leftLeg) mesh.userData.leftLeg.rotation.x = -s;
        if (mesh.userData.rightLeg) mesh.userData.rightLeg.rotation.x = s;
      }
    }
  }

  function sendMyPose() {
    var p = players[0];
    if (!p || !p.group || !state.myNetId) return;
    var moving = false;
    var airborne = p.group.position.y > 0.05;
    if (p.group.userData && p.group.userData._lastPos) {
      var lp = p.group.userData._lastPos;
      var dx = p.group.position.x - lp.x, dy = p.group.position.y - lp.y, dz = p.group.position.z - lp.z;
      moving = (dx * dx + dz * dz) > 0.00005 || Math.abs(dy) > 0.01;
    }
    p.group.userData._lastPos = p.group.position.clone();
    var custom = null;
    try {
      custom = (typeof playerCustom !== 'undefined') ? playerCustom[0] : null;
    } catch (e) {}
    // Only attach full custom when it changes (cuts LAN bandwidth a lot)
    var customKey = custom ? JSON.stringify(custom) : '';
    var sendCustom = null;
    if (customKey !== state._lastSentCustomKey) {
      state._lastSentCustomKey = customKey;
      sendCustom = custom;
    }
    // compact pose + velocity for high-ping extrapolation
    var px = p.group.position.x, py = p.group.position.y, pz = p.group.position.z;
    var prev = state._lastPosePos || { x: px, y: py, z: pz, t: 0 };
    var nowP = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var dtP = Math.max(0.016, (nowP - (prev.t || nowP)) / 1000);
    var vx = (px - prev.x) / dtP;
    var vz = (pz - prev.z) / dtP;
    state._lastPosePos = { x: px, y: py, z: pz, t: nowP };
    var msg = {
      type: 'pose',
      id: state.myNetId,
      x: Math.round(px * 100) / 100,
      y: Math.round(py * 100) / 100,
      z: Math.round(pz * 100) / 100,
      yaw: Math.round(p.yaw * 1000) / 1000,
      moving: moving,
      vx: Math.round(vx * 100) / 100,
      vz: Math.round(vz * 100) / 100
    };
    if (state.isHost) msg.isHost = true;
    // name only occasionally (every ~1s) to save bandwidth
    state._nameTick = (state._nameTick || 0) + 1;
    if (state._nameTick === 1 || state._nameTick % 40 === 0) {
      msg.name = state.playerName || 'لاعب';
    }
    if (p.vehicle) {
      ensureVehicleData(p.vehicle);
      msg.inVehicle = true;
      msg.vehicleName = p.vehicle.userData.netVehicleId || p.vehicle.userData.instanceName || null;
      msg.vehicleSeat = p.vehicleSeat || 'driver';
      // السواق بس يبعت موقع العربية — الرفيق لو بعت هيعمل تضارب ويوقف العربية
      if (!p.vehicleSeat || p.vehicleSeat === 'driver') {
        msg.vehicleX = Math.round(p.vehicle.position.x * 100) / 100;
        msg.vehicleY = Math.round(p.vehicle.position.y * 100) / 100;
        msg.vehicleZ = Math.round(p.vehicle.position.z * 100) / 100;
        msg.vehicleYaw = Math.round(p.vehicle.rotation.y * 1000) / 1000;
        msg.isDriver = true;
      } else {
        msg.isDriver = false;
      }
    }
    // سلاحين: إيد + ضهر
    var handKind = null, bagKinds = [];
    if (state.activeWeaponSlot >= 0 && state.weaponSlots[state.activeWeaponSlot]) {
      handKind = state.weaponSlots[state.activeWeaponSlot].kind || 'pistol';
    }
    for (var wi = 0; wi < 2; wi++) {
      if (state.weaponSlots[wi] && wi !== state.activeWeaponSlot) {
        bagKinds.push(state.weaponSlots[wi].kind || 'pistol');
      }
    }
    msg.weapon = handKind;
    msg.weaponKind = handKind;
    msg.weaponMode = handKind ? 'hand' : (bagKinds.length ? 'bag' : 'none');
    msg.bagKind = bagKinds[0] || null;
    msg.bagKinds = bagKinds;
    msg.aiming = !!(handKind && state.aiming);
    msg.activeWeaponSlot = state.activeWeaponSlot;
    if (sendCustom) msg.custom = sendCustom;
    // حالة التحدث بالمايك لمزامنة حركة الراس
    try {
      msg.micOn = !!(state.voice && state.voice.enabled && state.voice.stream);
      if (msg.micOn) {
        voiceUpdateLevel();
        msg.talking = !!state.voice.talking;
        msg.talkLv = Math.round((state.voice.level || 0) * 100) / 100;
      } else {
        msg.talking = false;
        msg.talkLv = 0;
      }
    } catch (eV) { msg.talking = false; msg.micOn = false; }
    // High-ping only: skip tiny movements; good LAN sends everything for max fidelity
    if (state.useLan && (state.netPing || 0) > 450) {
      var lp = state._lastSentPose;
      if (lp) {
        var ddx = msg.x - lp.x, ddz = msg.z - lp.z;
        var dyaw = Math.abs((msg.yaw || 0) - (lp.yaw || 0));
        var minMove = (state.netPing > 800) ? 0.30 : 0.15;
        if (ddx * ddx + ddz * ddz < minMove * minMove && dyaw < 0.07 && !msg.inVehicle) {
          state._poseSkip = (state._poseSkip || 0) + 1;
          if (state._poseSkip < 3) return;
        }
      }
      state._poseSkip = 0;
      state._lastSentPose = { x: msg.x, z: msg.z, yaw: msg.yaw };
    }
    if (state.useFirebase) {
      fbSend(msg);
    } else if (state.useLan) {
      lanSend(msg);
    } else if (state.isHost) {
      broadcastToAll(msg);
    } else if (state.connection) {
      try { state.connection.send(msg); } catch (e) {}
    }
  }

  
  function collectPoseSnapshot() {
    var poses = [];
    try {
      var p = players[0];
      if (p && p.group && state.myNetId) {
        var custom = null;
        try { custom = (typeof playerCustom !== 'undefined') ? playerCustom[0] : null; } catch (e) {}
        poses.push({
          type: 'pose',
          id: state.myNetId,
          name: state.playerName || 'لاعب',
          x: p.group.position.x,
          y: p.group.position.y,
          z: p.group.position.z,
          yaw: (p.yaw != null ? p.yaw : 0),
          custom: custom
        });
      }
    } catch (e) {}
    Object.keys(state.remoteMeshes || {}).forEach(function (id) {
      var m = state.remoteMeshes[id];
      if (!m) return;
      poses.push({
        type: 'pose',
        id: id,
        name: (m.userData && m.userData.displayName) || id,
        x: m.position.x,
        y: m.position.y,
        z: m.position.z,
        // mesh.rotation.y = logicalYaw + PI — رجّع الـ yaw المنطقي
        yaw: (m.rotation.y || 0) - Math.PI,
        custom: null
      });
    });
    return poses;
  }
  function collectWorldState() {
    var states = [];
    var list = state.buildObjects || [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || !o.userData) continue;
      var ud = o.userData;
      var entry = null;
      if (ud.isLight) {
        entry = {
          action: 'light',
          objectId: ud.instanceName || ud.buildId,
          on: !!ud.lightOn,
          x: o.position.x, z: o.position.z
        };
      } else if (ud.isGarage) {
        entry = {
          action: 'garage',
          objectId: ud.instanceName || ud.buildId,
          open: !!ud.gateOpen,
          x: o.position.x, z: o.position.z
        };
      } else if (ud.isVehicle && (ud.engineOn || ud.radioTrack)) {
        entry = {
          action: 'engine',
          vehicleId: ud.netVehicleId || ud.instanceName,
          on: !!ud.engineOn,
          x: o.position.x, z: o.position.z
        };
        if (ud.radioTrack && ud._radioActive) {
          states.push({
            action: 'radio_play',
            vehicleId: ud.netVehicleId || ud.instanceName,
            trackId: ud.radioTrack,
            x: o.position.x, z: o.position.z
          });
        }
      }
      if (entry) states.push(entry);
    }
    return states;
  }

  function applyWorldStateList(list) {
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      try { handleWorldEvent(list[i]); } catch (e) {}
    }
  }

  function sendPoseSnapshotTo(connOrAll) {
    var poses = collectPoseSnapshot();
    var msg = {
      type: 'pose_snapshot',
      poses: poses,
      roster: state.netRoster || [],
      worldStates: collectWorldState()
    };
    if (connOrAll && connOrAll.send) {
      try { connOrAll.send(msg); } catch (e) {}
    } else if (state.useFirebase) {
      try { fbSend(msg); } catch (e) {}
    } else if (state.useLan) {
      try { lanSend(msg); } catch (e) {}
    } else {
      try { broadcastToAll(msg); } catch (e) {}
    }
  }
  function sendLateJoinStart(toConn, newId) {
    if (state.mode !== 'play') return;
    var levelId = state.currentLevelId || '';
    var levelName = '';
    try {
      if (levelId && state.levels[levelId]) levelName = state.levels[levelId].name || '';
    } catch (e) {}
    var startMsg = {
      type: 'start',
      levelId: levelId,
      levelName: levelName,
      roster: state.netRoster || [],
      lateJoin: true
    };
    if (state.useFirebase) {
      try { fbSend(startMsg); } catch (e) {}
      try { fbSend({ type: 'pose_snapshot', poses: collectPoseSnapshot(), roster: state.netRoster || [] }); } catch (e) {}
    } else if (state.useLan) {
      try { lanSend(startMsg); } catch (e) {}
      try { lanSend({ type: 'pose_snapshot', poses: collectPoseSnapshot(), roster: state.netRoster || [] }); } catch (e) {}
    } else if (toConn) {
      try { toConn.send(startMsg); } catch (e) {}
      try { toConn.send({ type: 'pose_snapshot', poses: collectPoseSnapshot(), roster: state.netRoster || [] }); } catch (e) {}
    }
    // اطلب من الجميع يبعتوا وضعهم تاني
    setTimeout(function () {
      try { sendMyPose(); } catch (e) {}
      if (state.useLan) {
        try { lanSend({ type: 'resync_request' }); } catch (e) {}
      } else {
        try { broadcastToAll({ type: 'resync_request' }); } catch (e) {}
      }
    }, 400);
    setTimeout(function () { try { sendMyPose(); } catch (e) {} }, 900);
    toast('لاعب انضم أثناء اللعب — جاري مزامنته', 'info');
  }


  function handlePeerData(d, isHostSide, fromConn) {
    if (!d || !d.type) return;
    // بناء مشترك
    if (d.type === 'build_pose') {
      try { applyBuildPose(d); } catch (e) {}
      if (isHostSide && !state.useLan) try { broadcastToAll(d, fromConn); } catch (e2) {}
      return;
    }
    if (d.type === 'build_pack') {
      try { applyBuildPack(d); } catch (eBp) { console.warn(eBp); }
      if (isHostSide && !state.useLan) try { broadcastToAll(d, fromConn); } catch (e) {}
      return;
    }
    if (d.type === 'build_snapshot') {
      try { applyBuildSnapshot(d); } catch (e) {}
      return;
    }
    if (d.type === 'phone_event') { try { handlePhoneEvent(d); } catch (ePh) {} }
    if (d.type === 'world_event' && d.action === 'phone_pickup' && d.key) {
      try {
        for (var pi = state.buildObjects.length - 1; pi >= 0; pi--) {
          var pm = state.buildObjects[pi];
          if (pm && pm.userData && pm.userData._netBuildKey === d.key) {
            scene.remove(pm); state.buildObjects.splice(pi, 1);
          }
        }
      } catch (ePP) {}
    }
    if (d.type === 'build_op') {
      try { applyBuildOp(d, isHostSide); } catch (e) {}
      if (isHostSide && !state.useLan) try { broadcastToAll(d, fromConn); } catch (e2) {}
      return;
    }
    if (d.type === 'build_test_start') {
      // المنضم يدخل الاختبار مع القائد
      if (state.isHost) return;
      try {
        if (d.level && d.levelId) {
          state.levels[d.levelId] = d.level;
          state.currentLevelId = d.levelId;
        }
        beginLevelTest(d.levelId || state.currentLevelId, { fromNet: true });
      } catch (eT) { console.warn(eT); }
      return;
    }
    if (d.type === 'build_test_end') {
      if (state._testMode) {
        try { exitTestMode({ fromNet: true }); } catch (e) {}
      }
      return;
    }
    if (d.type === 'join' && d.purpose === 'build') {
      // منضم بناء
      if (isHostSide) {
        var bid = d.id || ('builder_' + Date.now().toString(36));
        d.id = bid;
        try { ensureRemoteBuilder(bid, d.name, d.avatar); } catch (e) {}
        setTimeout(function () { try { sendBuildSnapshot(); } catch (e) {} }, 300);
      }
      return;
    }
    // قياس البنج بين الأقران
    if (d.type === 'ping') {
      try {
        var pong = { type: 'pong', t: d.t, id: state.myNetId };
        if (fromConn && fromConn.open) fromConn.send(pong);
        else if (state.connection && state.connection.open) state.connection.send(pong);
        else if (state.useLan) lanSend(pong);
        else if (state.useFirebase) fbSend(pong);
      } catch (e) {}
      return;
    }
    if (d.type === 'pong') {
      if (d.t != null) {
        var nowT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        var sample = nowT - d.t;
        if (sample > 0 && sample < 5000) {
          var prev = state.netPing || sample;
          var alpha = sample > prev * 1.8 ? 0.2 : 0.5;
          state.netPing = prev * (1 - alpha) + sample * alpha;
          updatePingHud(state.netPing);
        }
      }
      return;
    }
    // NO levels / story data transfer — each device uses its own local comprehensive ZIP
    if (d.type === 'join') {
      if (state.isHost) {
        var newId = d.clientId || ('p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
        if (fromConn) {
          fromConn._netId = newId;
          fromConn._custom = d.custom || null;
        }
        if (!state.netRoster) state.netRoster = [];
        if (!state.netRoster.some(function (r) { return r.isHost; })) {
          state.netRoster.unshift({
            id: state.myNetId || 'host',
            name: state.playerName || 'القائد',
            isHost: true,
            custom: (typeof playerCustom !== 'undefined' ? playerCustom[0] : null),
            avatar: getNetAvatar()
          });
        }
        // تحديث صورة الهوست لو اتغيرت
        state.netRoster.forEach(function (r) {
          if (r && r.id === state.myNetId) {
            r.avatar = getNetAvatar();
            if (state.playerName) r.name = state.playerName;
          }
        });
        // avoid duplicate join — حدّث الاسم/الصورة لو موجود
        var existing = null;
        for (var di = 0; di < state.netRoster.length; di++) {
          if (state.netRoster[di].id === newId) { existing = state.netRoster[di]; break; }
        }
        if (existing) {
          if (d.name) existing.name = d.name;
          if (d.avatar) existing.avatar = d.avatar;
          if (d.custom) existing.custom = d.custom;
          if (state.useLan) lanSend({ type: 'welcome', yourId: newId, roster: state.netRoster });
          else if (state.useFirebase) { try { fbSend({ type: 'welcome', yourId: newId, roster: state.netRoster }); } catch (e) {} }
          renderNetLobbyList();
          try { refreshLobbyPreviews(); } catch (e) {}
          return;
        }
        if (state.netRoster.length >= state.maxNetPlayers) {
          if (fromConn) {
            try { fromConn.send({ type: 'full' }); } catch (e) {}
            try { fromConn.close(); } catch (e) {}
          }
          if (state.useLan) lanSend({ type: 'full' });
          toast('اللوبية ممتلئة (حد أقصى ' + state.maxNetPlayers + ')', 'error');
          return;
        }
        state.netRoster.push({
          id: newId,
          name: d.name || ('لاعب ' + state.netRoster.length),
          isHost: false,
          custom: d.custom,
          avatar: d.avatar || ''
        });
        state.player2Joined = true;
        var welcome = { type: 'welcome', yourId: newId, roster: state.netRoster };
        var rosterMsg = { type: 'roster', roster: state.netRoster };
        if (state.useFirebase) {
          fbSend(welcome);
          fbSend(rosterMsg);
        } else if (state.useLan) {
          lanSend(welcome);
          lanSend(rosterMsg);
        } else {
          if (fromConn) try { fromConn.send(welcome); } catch (e) {}
          broadcastToAll(rosterMsg, fromConn);
        }
        renderNetLobbyList();
        try { refreshLobbyPreviews(); } catch (e) {}
        toast('لاعب انضم! (' + state.netRoster.length + '/' + state.maxNetPlayers + ')', 'success');
        document.getElementById('gamepad-hint').textContent =
          state.netRoster.length + ' لاعبين في اللوبي — يمكنك بدء اللعب أو انتظار المزيد';
        // لو اللعبة شغالة بالفعل — زمّن اللاعب الجديد فورًا
        if (state.mode === 'play') {
          try { sendLateJoinStart(fromConn, newId); } catch (eLJ) { console.warn(eLJ); }
        }
      }
    }
    if (d.type === 'welcome') {
      // CRITICAL: host must IGNORE welcome echoes on the LAN bus
      // otherwise state.myNetId becomes the joiner's id and all pose sync breaks
      if (state.isHost) {
        return;
      }
      if (d.yourId) state.myNetId = d.yourId;
      state.netRoster = d.roster || [];
      // تأكد إن صورتي ظاهرة عندي في الروستر
      state.netRoster.forEach(function (r) {
        if (r && r.id === state.myNetId) {
          if (!r.avatar && state.playerAvatar) r.avatar = getNetAvatar();
          if (state.playerName) r.name = state.playerName;
        }
      });
      renderNetLobbyList();
      try { refreshLobbyPreviews(); } catch (e) {}
      document.getElementById('gamepad-hint').textContent = 'متصل — أنت في اللوبي (' + state.netRoster.length + ' لاعبين)';
      document.getElementById('btn-start-game').disabled = true;
      document.getElementById('btn-start-game').textContent = 'في انتظار القائد...';
    }
    if (d.type === 'roster') {
      // Host already has authoritative roster; still allow refresh from self-broadcast is ok
      if (d.roster && d.roster.length) {
        state.netRoster = d.roster;
        state.netRoster.forEach(function (r) {
          if (r && r.id === state.myNetId) {
            if (!r.avatar && state.playerAvatar) r.avatar = getNetAvatar();
            if (state.playerName) r.name = state.playerName;
          }
        });
        renderNetLobbyList();
        try { refreshLobbyPreviews(); } catch (e) {}
        // أثناء اللعب: جهّز mesh لأي لاعب جديد في الـ roster
        if (state.mode === 'play') {
          state.netRoster.forEach(function (r) {
            if (!r || !r.id || r.id === state.myNetId) return;
            try { ensureRemoteMesh(r.id, r.custom || null, r.name || 'لاعب'); } catch (eM) {}
          });
        }
      }
    }
    if (d.type === 'full') {
      toast('اللوبية ممتلئة', 'error');
    }
    if (d.type === 'custom') {
      if (d.id && d.custom) {
        // update roster custom/name (copy so local edits don't leak)
        if (state.netRoster) {
          state.netRoster.forEach(function (r) {
            if (r.id === d.id) {
              try { r.custom = JSON.parse(JSON.stringify(d.custom)); } catch (e) { r.custom = d.custom; }
              if (d.name) r.name = d.name;
            }
          });
        }
        var mesh = state.remoteMeshes[d.id];
        if (mesh && d.custom) {
          var pos = mesh.position.clone();
          var rotY = mesh.rotation.y;
          var oldName = mesh.userData.displayName || d.name;
          scene.remove(mesh);
          var neu = createCharacterMesh(0xb91c1c, 0xe0ac69, d.custom);
          neu.position.copy(pos);
          neu.rotation.y = rotY;
          neu.userData._customKey = JSON.stringify(d.custom);
          attachNameTag(neu, d.name || oldName || 'لاعب', true);
          scene.add(neu);
          state.remoteMeshes[d.id] = neu;
        }
        renderNetLobbyList();
      }
      if (isHostSide && !state.useLan) broadcastToAll(d, fromConn);
    }
    if (d.type === 'script_net') {
      if (d.id === state.myNetId) return;
      var handlers = (state.script && state.script.netHandlers) || [];
      for (var hi = 0; hi < handlers.length; hi++) {
        try { handlers[hi](d.data, d.id); } catch (e) { console.warn(e); }
      }
      // host rebroadcast to others (non-LAN peer mesh)
      if (isHostSide && !state.useLan && fromConn) {
        try { broadcastToAll(d, fromConn); } catch (e) {}
      }
      return;
    }
    if (d.type === 'pose') {
      applyNetPose(d);
      // سلاح ظاهر على اللاعب البعيد
      try { syncRemoteWeaponVisual(d); } catch (eW) {}
      if (isHostSide && !state.useLan) broadcastToAll(d, fromConn);
    }
    if (d.type === 'world_event') {
      if (d.id === state.myNetId) return;
      try { handleWorldEvent(d); } catch (eWe) { console.warn(eWe); }
      if (isHostSide && !state.useLan && fromConn) {
        try { broadcastToAll(d, fromConn); } catch (e) {}
      }
    }
    if (d.type === 'vehicle_event') {
      if (d.id === state.myNetId) return;
      try {
        var vv = findVehicleByNetId(d.vehicleId);
        if (vv && d.action === 'enter' && d.isDriver !== false && d.seat === 'driver') {
          if (d.x != null) { vv.position.x = d.x; vv.position.y = d.y || 0; vv.position.z = d.z; }
          if (d.ry != null) vv.rotation.y = d.ry;
        }
      } catch (eVe) {}
      if (isHostSide && !state.useLan && fromConn) {
        try { broadcastToAll(d, fromConn); } catch (e) {}
      }
    }
    if (d.type === 'pose_snapshot' && d.poses) {
      if (d.roster && d.roster.length) state.netRoster = d.roster;
      for (var si = 0; si < d.poses.length; si++) {
        try {
          var pd = d.poses[si];
          applyNetPose(pd);
          if (pd && pd.id && pd.id !== state.myNetId && state.remoteMeshes[pd.id]) {
            var rm = state.remoteMeshes[pd.id];
            if (!pd.inVehicle) {
              rm.position.set(pd.x, pd.y || 0, pd.z);
              if (pd.yaw != null) rm.rotation.y = pd.yaw + Math.PI;
            }
          }
          try { syncRemoteWeaponVisual(pd); } catch (eW2) {}
        } catch (eS) {}
      }
      // طبّق حالة العالم (لمبات، جراج، محركات...)
      if (d.worldStates) try { applyWorldStateList(d.worldStates); } catch (eWs) {}
      try { sendMyPose(); } catch (eSP) {}
    }
    if (d.type === 'resync_request') {
      // كل عميل يرد بوضعه الحالي
      try { sendMyPose(); } catch (eR) {}
      if (isHostSide && !state.useLan && fromConn) {
        try { sendPoseSnapshotTo(fromConn); } catch (eR2) {}
      }
    }
    if (d.type === 'kick') {
      if (d.id === state.myNetId) {
        // I was kicked
        toast('تم طردك من اللوبي', 'error');
        stopLanPoll && stopLanPoll();
        if (state.peer) try { state.peer.destroy(); } catch (e) {}
        state.peer = null; state.connection = null; state.connections = [];
        state.netRoster = []; state.myNetId = null; state.player2Joined = false;
        clearRemoteMeshes();
        closePause && closePause();
        showScreen('menu');
        showUI('main-menu');
        return;
      }
      // Someone else was kicked
      if (d.id && state.remoteMeshes[d.id]) {
        scene.remove(state.remoteMeshes[d.id]);
        delete state.remoteMeshes[d.id];
      }
      if (state.netRoster) {
        state.netRoster = state.netRoster.filter(function (r) { return r.id !== d.id; });
        renderNetLobbyList();
      }
      if (isHostSide && !state.useLan) broadcastToAll(d, fromConn);
    }
    if (d.type === 'start') {
      if (state.mode === 'play') return; // already started (host)
      var levelId = d.levelId || '';
      // لو القائد بعت اللفل كامل — احفظه محليًا (منضم بدون ملف شامل)
      try {
        if (d.level && typeof d.level === 'object') {
          var lid = levelId || ('level_sync_' + Date.now().toString(36));
          state.levels = state.levels || {};
          state.levels[lid] = d.level;
          if (!state.levels[lid].name && d.levelName) state.levels[lid].name = d.levelName;
          if (!Array.isArray(state.levels[lid].objects)) state.levels[lid].objects = [];
          levelId = lid;
        }
      } catch (eSync) { console.warn(eSync); }
      if (levelId && !state.levels[levelId] && d.levelName) {
        Object.keys(state.levels).forEach(function (lid2) {
          if (state.levels[lid2] && state.levels[lid2].name === d.levelName) levelId = lid2;
        });
      }
      if (d.roster) state.netRoster = d.roster;
      if (levelId && state.levels[levelId]) {
        state.currentLevelId = levelId;
        loadLevelIntoScene(levelId);
      } else if (levelId) {
        state.currentLevelId = levelId;
        loadLevelIntoScene(levelId);
      } else clearBuildObjects();
      clearRespawnMarkers();
      setupPlayersForNet();
      state._lastSentCustomKey = null;
      showScreen('play');
      try { voiceOnEnterGame(); } catch (eV1) {}
      var labels = document.getElementById('split-labels');
      if (labels) labels.style.display = 'none';
      if (levelId) setTimeout(function () { runLevelScripts(levelId); }, 100);
      setTimeout(function () { try { sendMyPose(); } catch (e) {} }, 100);
      setTimeout(function () { try { sendMyPose(); } catch (e) {} }, 400);
      toast(d.level ? 'تم استلام اللفل من القائد' : 'بدء اللعب', 'success');
    }
    if (d.type === 'room_closed') {
      closePause && closePause();
      try { stopAllScripts && stopAllScripts(); } catch (e) {}
      try { clearRemoteMeshes && clearRemoteMeshes(); } catch (e) {}
      try { clearLobbyPreviews && clearLobbyPreviews(); } catch (e) {}
      try { stopLanPoll && stopLanPoll(); } catch (e) {}
      if (state.peer) try { state.peer.destroy(); } catch (e) {}
      state.connection = null; state.peer = null; state.connections = [];
      state.useLan = false;
      state.netRoster = [];
      state.myNetId = null;
      showScreen('menu');
      showUI('main-menu');
      toast('القائد خرج — الروم اتقفل', 'error');
      return;
    }
    if (d.type === 'exit' || d.type === 'leave') {
      var leftId = d.id;
      if (!leftId || leftId === state.myNetId) return;
      if (state.remoteMeshes[leftId]) {
        scene.remove(state.remoteMeshes[leftId]);
        delete state.remoteMeshes[leftId];
      }
      if (state.remoteTargets) delete state.remoteTargets[leftId];
      var leftName = d.name || 'لاعب';
      var leftWasHost = !!d.isHost;
      if (state.netRoster) {
        state.netRoster.forEach(function (r) {
          if (r.id === leftId) {
            leftName = r.name || leftName;
            if (r.isHost) leftWasHost = true;
          }
        });
        state.netRoster = state.netRoster.filter(function (r) { return r.id !== leftId; });
        renderNetLobbyList();
      }
      toast('خرج اللاعب ' + leftName, 'info');
      // Host left → everyone out, room gone
      if (leftWasHost) {
        closePause && closePause();
        try { stopAllScripts && stopAllScripts(); } catch (e) {}
        clearRemoteMeshes();
        try { clearLobbyPreviews && clearLobbyPreviews(); } catch (e) {}
        stopLanPoll && stopLanPoll();
        if (state.peer) try { state.peer.destroy(); } catch (e) {}
        state.connection = null; state.peer = null; state.connections = [];
        state.useLan = false;
        state.netRoster = [];
        state.myNetId = null;
        state.isHost = false;
        showScreen('menu');
        showUI('main-menu');
        toast('القائد خرج — الروم اتقفل وخرج الجميع', 'error');
      }
    }
  }

  function setupPlayersForNet() {
    // Always control local as players[0]; remotes are separate meshes
    clearRemoteMeshes();
    players.forEach(function (p) { if (p.group) { scene.remove(p.group); p.group = null; } });
    var myCustom = null;
    try {
      if (typeof playerCustom !== 'undefined') {
        // Everyone uses slot 0 for their own clothes
        myCustom = playerCustom[0];
      }
    } catch (e) {}
    var lanSpawns = getLevelRespawnPoints('lan');
    // Assign spawn index by roster order
    var myIndex = 0;
    (state.netRoster || []).forEach(function (r, i) {
      if (r.id === state.myNetId) myIndex = i;
    });
    var mySpawn = lanSpawns[myIndex % lanSpawns.length] || { x: 0, y: 0, z: 0 };
    players[0].group = createCharacterMesh(0x1e40af, 0xe0ac69, myCustom);
    players[0].group.position.set(mySpawn.x, 0, mySpawn.z);
    players[0].yaw = 0;
    players[0].velocity.set(0, 0, 0);
    scene.add(players[0].group);
    // Local name tag exists but hidden for own camera
    attachNameTag(players[0].group, state.playerName || 'أنا', false);
    // hide unused local p2 in online
    if (players[1].group) { scene.remove(players[1].group); players[1].group = null; }
    var aspect = window.innerWidth / window.innerHeight;
    players[0].camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 400);
    players[1].camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 400);
    // spawn remote placeholders from roster at their LAN respawn points
    (state.netRoster || []).forEach(function (r, i) {
      if (r.id === state.myNetId) return;
      ensureRemoteMesh(r.id, r.custom, r.name);
      if (state.remoteMeshes[r.id]) {
        var sp = lanSpawns[i % lanSpawns.length] || { x: (i + 1) * 2.2, y: 0, z: 0 };
        state.remoteMeshes[r.id].position.set(sp.x, 0, sp.z);
      }
    });
  }


  // ===== STORY / ONLINE / PAUSE UI =====
  function hideAllScreens() {
    ['main-menu','story-choice','online-confirm','online-hub','create-room','join-room','lobby-screen','name-entry-screen'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
  }

  function showUI(id) {
    hideAllScreens();
    var el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }

  // Override main menu buttons
  var btnStory = document.getElementById('btn-story-mode');
  if (btnStory) btnStory.onclick = function () { showUI('story-choice'); state.mode = 'menu'; };

  var btnSplit = document.getElementById('btn-split-mode');
  if (btnSplit) btnSplit.onclick = function () {
    state.playType = 'split';
    state.isHost = true;
    state.player2Joined = false;
    state.netRoster = [];
    clearRemoteMeshes();
    // restore classic 2-player cards for split
    var list = document.getElementById('players-list');
    var hint = document.getElementById('net-players-hint');
    if (hint) hint.style.display = 'none';
    var p1Name = state.playerName || 'اللاعب 1';
    if (list) {
      var p1Av = state.playerAvatar ? avatarHtml(state.playerAvatar, '💻') : '💻';
      list.innerHTML =
        '<div class="player-card host ready" id="player1-card"><div class="avatar" id="p1-avatar">' + p1Av + '</div><div class="player-info">' +
        '<span class="name" id="p1-label">' + p1Name + '</span><span class="status online" id="p1-status">READY</span></div></div>' +
        '<div class="player-card" id="player2-card"><div class="avatar" id="p2-avatar">🎮</div><div class="player-info">' +
        '<span class="name" id="p2-label">اللاعب 2</span><span class="status" id="player2-status">اضغط هنا أو X على الدراعة</span></div></div>';
      var p2card = document.getElementById('player2-card');
      if (p2card) {
        p2card.style.cursor = 'pointer';
        p2card.addEventListener('click', function () {
          if (state.playType === 'split' && !state.player2Joined) {
            state.player2Joined = true;
            p2card.classList.add('ready');
            document.getElementById('player2-status').textContent = 'READY ✓';
            document.getElementById('player2-status').classList.add('online');
            document.getElementById('p2-avatar').textContent = '✅';
            document.getElementById('btn-start-game').disabled = false;
            document.getElementById('btn-start-game').textContent = 'START GAME';
            toast('اللاعب 2 جاهز', 'success');
          }
        });
      }
    }
    document.getElementById('lobby-title').textContent = '⚔️ SPLIT LOBBY';
    document.getElementById('lobby-code-display').style.display = 'none';
    document.getElementById('btn-start-game').disabled = true;
    document.getElementById('btn-start-game').textContent = 'START GAME';
    document.getElementById('gamepad-hint').textContent = 'اضغط كارت اللاعب 2 للجاهزية';
    configureCustomUIForMode();
    var levelBox = document.querySelector('.level-select-box');
    if (levelBox) levelBox.style.display = '';
    showScreen('lobby');
  };

  function checkLanServer(ip, cb) {
    var base = normalizeLanHost(ip || '127.0.0.1');
    var url = base + '/status';
    var done = false;
    var t = setTimeout(function () {
      if (done) return;
      done = true;
      cb(false, null);
    }, 3500);
    fetch(url, { cache: 'no-store', mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error('bad status');
      return r.json();
    }).then(function (j) {
      if (done) return;
      done = true;
      clearTimeout(t);
      cb(!!(j && j.ok), j);
    }).catch(function () {
      if (done) return;
      done = true;
      clearTimeout(t);
      cb(false, null);
    });
  }

  // Live IP/host detection with clear Arabic messages
  function setIpStatusEl(el, kind, text) {
    if (!el) return;
    el.textContent = text || '';
    if (kind === 'ok') el.style.color = '#30d158';
    else if (kind === 'err') el.style.color = '#ff6b8a';
    else if (kind === 'wait') el.style.color = '#94a3b8';
    else el.style.color = '#94a3b8';
  }

  function probeServerAndShow(ip, statusElId, onResult) {
    var el = document.getElementById(statusElId);
    var addr = (ip || '').trim();
    if (!addr) {
      setIpStatusEl(el, 'err', 'اكتب العنوان أولاً');
      if (onResult) onResult(false, null);
      return;
    }
    setIpStatusEl(el, 'wait', 'جاري التعرف على الخادم...');
    checkLanServer(addr, function (ok, info) {
      if (ok) {
        setIpStatusEl(el, 'ok', '✓ تم التعرف على وجود الخادم');
        if (info && info.ips && info.ips.length) state._detectedLanIps = info.ips;
        state._lastCheckedLanIp = addr;
      } else {
        setIpStatusEl(el, 'err', '✗ مش واصل — تأكد إن python lan_host.py شغال والعنوان صح (Radmin / LAN)');
      }
      if (onResult) onResult(ok, info);
    });
  }

  // بحث على الشبكة المحلية عن lan_host + الروم (بدون نت)
  function discoverLanHostForRoom(roomCode, cb) {
    roomCode = (roomCode || '').toLowerCase();
    var candidates = [];
    function add(ip) {
      if (!ip) return;
      ip = String(ip).trim();
      if (candidates.indexOf(ip) >= 0) return;
      candidates.push(ip);
    }
    add('127.0.0.1');
    add('localhost');
    try {
      var saved = localStorage.getItem('sm_last_lan_hosts');
      if (saved) JSON.parse(saved).forEach(add);
    } catch (e) {}
    if (state._lastCheckedLanIp) add(state._lastCheckedLanIp);
    if (state._detectedLanIps) state._detectedLanIps.forEach(add);
    // نطاقات شائعة على LAN / Radmin (مسح خفيف)
    ['192.168.1.', '192.168.0.', '192.168.8.', '10.0.0.', '26.0.0.'].forEach(function (prefix) {
      for (var i = 1; i <= 12; i++) add(prefix + i);
    });
    for (var r = 1; r <= 8; r++) add('26.' + r + '.0.1');

    var found = null;
    var idx = 0;
    var parallel = 6;

    function remember(ip) {
      try {
        var list = [];
        try { list = JSON.parse(localStorage.getItem('sm_last_lan_hosts') || '[]'); } catch (e) {}
        list = [ip].concat(list.filter(function (x) { return x !== ip; })).slice(0, 8);
        localStorage.setItem('sm_last_lan_hosts', JSON.stringify(list));
      } catch (e) {}
    }

    function probeOne(ip, done) {
      var base = normalizeLanHost(ip);
      var ctrl = null;
      var to = setTimeout(function () { done(false); }, 900);
      fetch(base + '/rooms', { cache: 'no-store', mode: 'cors' }).then(function (r) {
        if (!r.ok) throw new Error('bad');
        return r.json();
      }).then(function (j) {
        clearTimeout(to);
        if (!j || !j.ok || !j.rooms) { done(false); return; }
        var hit = false;
        for (var i = 0; i < j.rooms.length; i++) {
          var rm = j.rooms[i];
          var name = (typeof rm === 'string' ? rm : (rm && (rm.name || rm.room || rm.code))) || '';
          if (String(name).toLowerCase() === roomCode) { hit = true; break; }
        }
        // حتى لو الروم لسه متسجلش، وجود سيرفر صالح يكفي لو مفيش غيره
        done(hit ? ip : (j.rooms ? ip : false), !!hit);
      }).catch(function () {
        clearTimeout(to);
        done(false);
      });
    }

    var pending = 0;
    var finished = false;
    function next() {
      if (finished) return;
      while (pending < parallel && idx < candidates.length) {
        (function (ip) {
          pending++;
          probeOne(ip, function (okIp, exact) {
            pending--;
            if (finished) return;
            if (okIp) {
              if (exact || !found) {
                found = okIp;
                if (exact) {
                  finished = true;
                  remember(okIp);
                  cb(okIp);
                  return;
                }
              }
            }
            if (idx >= candidates.length && pending === 0) {
              finished = true;
              if (found) remember(found);
              cb(found || null);
            } else {
              next();
            }
          });
        })(candidates[idx++]);
      }
      if (idx >= candidates.length && pending === 0 && !finished) {
        finished = true;
        cb(found || null);
      }
    }
    next();
  }

  function wireIpLiveCheck(inputId, statusId) {
    var inp = document.getElementById(inputId);
    if (!inp) return;
    var timer = null;
    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        var v = (inp.value || '').trim();
        if (v.length >= 3) probeServerAndShow(v, statusId);
        else setIpStatusEl(document.getElementById(statusId), 'wait', '');
      }, 550);
    }
    inp.addEventListener('input', schedule);
    inp.addEventListener('blur', function () {
      var v = (inp.value || '').trim();
      if (v) probeServerAndShow(v, statusId);
    });
  }

  function runServerCheck(ip) {
    var st = document.getElementById('server-check-status');
    var okBtn = document.getElementById('btn-online-ok');
    ip = (ip || '127.0.0.1').trim();
    if (st) { st.textContent = 'جاري فحص السيرفر على ' + ip + ' ...'; st.style.color = '#94a3b8'; }
    if (okBtn) { okBtn.disabled = true; okBtn.textContent = 'جاري الفحص...'; }
    checkLanServer(ip, function (ok, info) {
      if (ok) {
        if (st) { st.textContent = 'السيرفر شغال ✓ على ' + ip; st.style.color = '#30d158'; }
        if (okBtn) { okBtn.disabled = false; okBtn.textContent = 'موافق — متابعة'; }
        state._lastCheckedLanIp = ip;
        if (info && info.ips && info.ips.length) state._detectedLanIps = info.ips;
        // prefill create/join IP fields
        var ci = document.getElementById('create-ip-input');
        var ji = document.getElementById('join-ip-input');
        if (ci) ci.value = ip;
        if (ji) ji.value = ip;
      } else {
        if (st) {
          st.innerHTML = 'السيرفر مش شغال على ' + ip + ' ❌<br><span style="font-weight:500;font-size:0.85rem">القائد: شغّل python lan_host.py ثم استخدم وضع Firebase رومات (كود الروم فقط)<br>المنضم: LAN: IP القائد — أو Firebase: كود الروم</span>';
          st.style.color = '#ff6b8a';
        }
        if (okBtn) { okBtn.disabled = true; okBtn.textContent = 'السيرفر مش شغال بعد'; }
      }
    });
  }

  var btnOnline = document.getElementById('btn-online-mode');
  if (btnOnline) btnOnline.onclick = function () {
    // مباشرة للـ hub — اختيار LAN / Firebase داخل إنشاء أو انضمام
    showUI('online-hub');
    var hub = document.getElementById('hub-server-status');
    if (hub) hub.textContent = 'القائد يشغّل: python lan_host.py — LAN محلي أو Firebase للرومات والتزامن فقط';
  };

  var btnCheckServer = document.getElementById('btn-check-server');
  if (btnCheckServer) btnCheckServer.onclick = function () {
    var ipEl = document.getElementById('confirm-server-ip');
    var ip = (ipEl && ipEl.value) ? ipEl.value.trim() : '';
    if (!ip) { toast('اكتب IP السيرفر', 'error'); return; }
    runServerCheck(ip);
  };

  var btnOnlineOk = document.getElementById('btn-online-ok');
  if (btnOnlineOk) btnOnlineOk.onclick = function () {
    if (btnOnlineOk.disabled) {
      toast('افحص السيرفر أولًا بـ IP الصحيح', 'error');
      return;
    }
    showUI('online-hub');
    var hub = document.getElementById('hub-server-status');
    var ip = state._lastCheckedLanIp || '127.0.0.1';
    if (hub) hub.textContent = 'السيرفر متصل ✓ (' + ip + ')';
  };

  var btnOnlineCancel = document.getElementById('btn-online-cancel');
  if (btnOnlineCancel) btnOnlineCancel.onclick = function () { showUI('story-choice'); };

  var btnStoryBack = document.getElementById('btn-story-back');
  if (btnStoryBack) btnStoryBack.onclick = function () { showUI('main-menu'); showScreen('menu'); };

  var btnOnlineHubBack = document.getElementById('btn-online-hub-back');
  if (btnOnlineHubBack) btnOnlineHubBack.onclick = function () { showUI('story-choice'); };

  // ---- Create room: LAN vs Cloud mode ----
  state._createNetMode = null; // 'lan' | 'cloud'
  state._joinNetMode = null;

  function setCreateNetMode(mode) {
    state._createNetMode = mode;
    var lanP = document.getElementById('create-lan-panel');
    var cloudP = document.getElementById('create-cloud-panel');
    var codesP = document.getElementById('create-codes-panel');
    var btnLan = document.getElementById('btn-create-mode-lan');
    var btnCloud = document.getElementById('btn-create-mode-cloud');
    var btnCodes = document.getElementById('btn-create-mode-codes');
    var doBtn = document.getElementById('btn-do-create');
    if (lanP) {
      if (mode === 'lan') lanP.classList.remove('hidden');
      else lanP.classList.add('hidden');
    }
    if (cloudP) {
      if (mode === 'cloud') cloudP.classList.remove('hidden');
      else cloudP.classList.add('hidden');
    }
    if (codesP) {
      if (mode === 'codes') codesP.classList.remove('hidden');
      else codesP.classList.add('hidden');
    }
    if (btnLan) {
      btnLan.className = mode === 'lan' ? 'btn btn-success' : 'btn btn-ghost';
      btnLan.style.flex = '1';
      btnLan.style.minWidth = '120px';
    }
    if (btnCloud) {
      btnCloud.className = mode === 'cloud' ? 'btn btn-accent' : 'btn btn-ghost';
      btnCloud.style.flex = '1';
      btnCloud.style.minWidth = '120px';
    }
    if (btnCodes) {
      btnCodes.className = mode === 'codes' ? 'btn btn-primary' : 'btn btn-ghost';
      btnCodes.style.flex = '1';
      btnCodes.style.minWidth = '120px';
    }
    if (doBtn) {
      if (!mode) {
        doBtn.disabled = true;
        doBtn.textContent = 'اختر نوع الاتصال أولاً';
      } else {
        doBtn.disabled = false;
        doBtn.textContent = mode === 'lan' ? 'تأكيد وإنشاء (LAN / Radmin)'
          : (mode === 'cloud' ? 'تأكيد وإنشاء (cloudflared)' : 'تأكيد وإنشاء (تبادل الأكواد)');
      }
    }
    if (mode === 'lan') {
      var ipEl = document.getElementById('create-ip-input');
      if (ipEl && (!ipEl.value || ipEl.value === '')) ipEl.value = '127.0.0.1';
      var hint = document.getElementById('create-lan-hint');
      if (hint && state._detectedLanIps && state._detectedLanIps.length) {
        hint.textContent = 'IP جهازك المحتمل: ' + state._detectedLanIps.join(' · ') + ' — أعطِه لصحابك (LAN أو Radmin)';
      }
      if (ipEl && ipEl.value) probeServerAndShow(ipEl.value, 'create-ip-status');
    } else if (mode === 'cloud') {
      var cEl = document.getElementById('create-cloud-input');
      if (cEl && cEl.value) probeServerAndShow(cEl.value, 'create-cloud-status');
    }
  }

  function setJoinNetMode(mode) {
    state._joinNetMode = mode;
    var lanP = document.getElementById('join-lan-panel');
    var cloudP = document.getElementById('join-cloud-panel');
    var codesP = document.getElementById('join-codes-panel');
    var btnLan = document.getElementById('btn-join-mode-lan');
    var btnCloud = document.getElementById('btn-join-mode-cloud');
    var btnCodes = document.getElementById('btn-join-mode-codes');
    if (lanP) {
      if (mode === 'lan') lanP.classList.remove('hidden');
      else lanP.classList.add('hidden');
    }
    if (cloudP) {
      if (mode === 'cloud') cloudP.classList.remove('hidden');
      else cloudP.classList.add('hidden');
    }
    if (codesP) {
      if (mode === 'codes') codesP.classList.remove('hidden');
      else codesP.classList.add('hidden');
    }
    if (btnLan) {
      btnLan.className = mode === 'lan' ? 'btn btn-success' : 'btn btn-ghost';
      btnLan.style.flex = '1';
      btnLan.style.minWidth = '120px';
    }
    if (btnCloud) {
      btnCloud.className = mode === 'cloud' ? 'btn btn-accent' : 'btn btn-ghost';
      btnCloud.style.flex = '1';
      btnCloud.style.minWidth = '120px';
    }
    if (btnCodes) {
      btnCodes.className = mode === 'codes' ? 'btn btn-primary' : 'btn btn-ghost';
      btnCodes.style.flex = '1';
      btnCodes.style.minWidth = '120px';
    }
    if (mode === 'lan') {
      var ji = document.getElementById('join-ip-input');
      if (ji && ji.value) probeServerAndShow(ji.value, 'join-ip-status');
    } else if (mode === 'cloud') {
      var jc = document.getElementById('join-cloud-input');
      if (jc && jc.value) probeServerAndShow(jc.value, 'join-cloud-status');
    }
  }

  // زر الجرافيكس في القائمة الرئيسية
  
  // خيارات بنزين العربية
  var cfmInf = document.getElementById('cfm-infinite');
  var cfmLim = document.getElementById('cfm-limited');
  var cfmCons = document.getElementById('cfm-consume');
  var cfmCancel = document.getElementById('cfm-cancel');
  if (cfmInf) cfmInf.onclick = function (e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    var opts = { infinite: true };
    state._pendingCarOpts = opts;
    if (state._pendingCarItem) {
      state._pendingCarItem._fuelOpts = opts;
      armPlaceTool(state._pendingCarItem, 'عربية ببنزين مالانهاية — اضغط في المشهد للوضع');
    }
    closeCarFuelModal();
  };
  if (cfmLim) cfmLim.onclick = function () {
    if (cfmCons) cfmCons.classList.remove('hidden');
  };
  if (cfmCons) {
    var cbs = cfmCons.querySelectorAll('[data-consume]');
    for (var ci = 0; ci < cbs.length; ci++) {
      (function (btn) {
        btn.onclick = function (e) {
          if (e) { e.preventDefault(); e.stopPropagation(); }
          var c = btn.getAttribute('data-consume');
          var opts = { infinite: false, consume: c };
          state._pendingCarOpts = opts;
          if (state._pendingCarItem) {
            state._pendingCarItem._fuelOpts = opts;
            armPlaceTool(state._pendingCarItem, 'عربية ببنزين محدد (' + c + ') — اضغط في المشهد للوضع');
          }
          closeCarFuelModal();
        };
      })(cbs[ci]);
    }
  }
  if (cfmCancel) cfmCancel.onclick = function () { closeCarFuelModal(); };

  // أوضاع القيادة
  var btnN = document.getElementById('vh-mode-normal');
  var btnS = document.getElementById('vh-mode-sport');
  if (btnN) btnN.onclick = function (e) {
    e.preventDefault(); e.stopPropagation();
    if (players[0] && players[0].vehicle) {
      players[0].vehicle.userData.driveMode = 'normal';
      toast('وضع عادي', 'info');
      updateVehicleHUD(players[0].vehicle, players[0]);
    }
  };
  if (btnS) btnS.onclick = function (e) {
    e.preventDefault(); e.stopPropagation();
    if (players[0] && players[0].vehicle) {
      players[0].vehicle.userData.driveMode = 'sport';
      toast('وضع سبورت — SPACE دريفت (مش فرامل)', 'info');
      updateVehicleHUD(players[0].vehicle, players[0]);
    }
  };

  // اختيار كائن تفاعلي بالماوس (عند تعارض) — تلقائي بدون نافذة

  // اختيار كائن تفاعلي بالماوس عند التعارض
  window.addEventListener('mousedown', function (e) {
    var multiNear = false;
    try {
      if (state.mode === 'play' && players[0]) {
        var nn = findNearbyInteractive(players[0], 9);
        multiNear = nn.length > 1 && !state.interactFocus;
      }
    } catch (eM) {}
    if ((!state.interactPickMode && !multiNear) || state.mode !== 'play' || e.button !== 0) return;
    if (e.target.closest && (e.target.closest('#multi-interact-modal') || e.target.closest('#vehicle-hud') || e.target.closest('#car-radio') || e.target.closest('#interact-prompt'))) return;
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    var cam = players[0] && players[0].camera ? players[0].camera : buildCamera;
    raycaster.setFromCamera(mouse, cam);
    var hits = raycaster.intersectObjects(state.buildObjects, true);
    if (!hits.length) return;
    var obj = hits[0].object;
    while (obj.parent && state.buildObjects.indexOf(obj) === -1) obj = obj.parent;
    if (state.buildObjects.indexOf(obj) === -1) return;
    if (!(obj.userData && (obj.userData.interactive || obj.userData.isVehicle || obj.userData.isLight))) {
      toast('هذا الكائن مش تفاعلي', 'info');
      return;
    }
    state.interactFocus = obj;
    state.interactPickMode = false;
    toast('تم التحديد', 'success');
    updateInteractPrompt();
  }, true);

  // قائمة تفاعل عند موضع الكليك (تشغيل/إطفاء — مش فوري)
  function hideWorldContextMenu() {
    var m = document.getElementById('world-ctx-menu');
    if (m) m.classList.add('hidden');
    state._ctxTarget = null;
  }
  function showWorldContextMenu(obj, clientX, clientY, mode) {
    // mode: 'light' | 'garage'
    var m = document.getElementById('world-ctx-menu');
    if (!m) {
      m = document.createElement('div');
      m.id = 'world-ctx-menu';
      m.className = 'world-ctx-menu hidden';
      document.body.appendChild(m);
    }
    state._ctxTarget = obj;
    var isOn = false;
    var labelOn = 'تشغيل';
    var labelOff = 'إطفاء';
    if (mode === 'light') {
      isOn = !!obj.userData.lightOn;
      labelOn = '💡 تشغيل النور';
      labelOff = '🌙 إطفاء النور';
    } else if (mode === 'garage') {
      isOn = !!obj.userData.gateOpen;
      labelOn = '🚪 فتح الباب';
      labelOff = '🔒 قفل الباب';
    }
    m.innerHTML =
      '<button type="button" class="wctx-btn" data-act="on">' + labelOn + '</button>' +
      '<button type="button" class="wctx-btn" data-act="off">' + labelOff + '</button>' +
      '<button type="button" class="wctx-btn wctx-cancel" data-act="cancel">إلغاء</button>';
    m.classList.remove('hidden');
    var pad = 8;
    var x = clientX + pad;
    var y = clientY + pad;
    m.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    m.style.top = Math.min(y, window.innerHeight - 140) + 'px';
    m.onclick = function (ev) {
      var btn = ev.target.closest && ev.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      var target = state._ctxTarget;
      hideWorldContextMenu();
      if (!target || act === 'cancel') return;
      if (mode === 'light') {
        if (act === 'on') applyLightState(target, true);
        else applyLightState(target, false);
        try {
          netEmit({ type: 'world_event', action: 'light', on: !!target.userData.lightOn, objectId: target.userData.instanceName || target.userData.buildId || null, x: target.position.x, z: target.position.z });
        } catch (eN) {}
        toast(target.userData.lightOn ? 'النور شغال' : 'النور مطفي', 'info');
      } else if (mode === 'garage') {
        var wantOpen = act === 'on';
        if (!!target.userData.gateOpen !== wantOpen) toggleGarage(target);
      }
    };
  }

  // تفاعل بالماوس: عربية / لمبة / جراج (قريب فقط) — قائمة مش تبديل فوري
  window.addEventListener('pointerdown', function (e) {
    if (state.mode !== 'play' || state.paused || e.button !== 0) return;
    if (e.target.closest && (e.target.closest('#seat-choice') || e.target.closest('#vehicle-hud') || e.target.closest('#car-radio') || e.target.closest('#world-ctx-menu') || e.target.closest('button') || e.target.closest('.btn'))) return;
    // لو ضغط برا القائمة اقفلها
    if (!e.target.closest || !e.target.closest('#world-ctx-menu')) {
      var existing = document.getElementById('world-ctx-menu');
      if (existing && !existing.classList.contains('hidden')) {
        // متقفلش فوراً لو ده نفس الضغط اللي هيفتح قائمة جديدة
      }
    }
    if (players[0] && players[0].vehicle) return;
    if (playerHoldingWeapon()) return; // لازم السلاح على الضهر
    var cam = players[0] && players[0].camera ? players[0].camera : null;
    if (!cam) return;
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, cam);
    var hits = raycaster.intersectObjects(state.buildObjects, true);
    if (!hits.length) { hideSeatChoice(); hideWorldContextMenu(); return; }
    var obj = hits[0].object;
    while (obj.parent && state.buildObjects.indexOf(obj) === -1) obj = obj.parent;
    if (state.buildObjects.indexOf(obj) === -1) return;
    if (!players[0] || !players[0].group) return;
    var dx = obj.position.x - players[0].group.position.x;
    var dz = obj.position.z - players[0].group.position.z;
    if (dx * dx + dz * dz > 12 * 12) return;
    if (obj.userData && obj.userData.isVehicle) {
      if (blockInteractIfArmed()) return;
      e.preventDefault();
      hideWorldContextMenu();
      showSeatChoice(obj, e.clientX, e.clientY);
      return;
    }
    if (obj.userData && obj.userData.isLight) {
      if (blockInteractIfArmed()) return;
      e.preventDefault();
      showWorldContextMenu(obj, e.clientX, e.clientY, 'light');
      return;
    }
    if (obj.userData && obj.userData.isGarage) {
      if (blockInteractIfArmed()) return;
      e.preventDefault();
      showWorldContextMenu(obj, e.clientX, e.clientY, 'garage');
      return;
    }
  }, true);


  // body class for CSS
  var _origShowScreen = null;

  
  state.mouseLeftDown = false;
  function isAimEditUI(target) {
    if (!target) return false;
    try {
      return !!(target.closest && target.closest('#aim-edit-overlay'));
    } catch (e) { return false; }
  }
  window.addEventListener('mousedown', function (e) {
    // لو ضغط على سلايدر تعديل التصويب — متضربش نار ومتقفلش
    if (isAimEditUI(e.target)) {
      e.stopPropagation();
      // اخرج من pointer lock عشان السلايدر يشتغل
      try { if (document.exitPointerLock) document.exitPointerLock(); } catch (ePL) {}
      state.mouseHidden = false;
      document.body.style.cursor = 'default';
      return;
    }
    if (state.mode !== 'play' || state.paused) return;
    if (e.button === 2) {
      if (playerHoldingWeapon() || state.aimEditMode) {
        state.aiming = true;
        e.preventDefault();
      }
    }
    if (e.button === 0) {
      state.mouseLeftDown = true;
      // ممنوع الإطلاق أثناء وضع ضبط كاميرا التصويب
      if (state.aimEditMode) {
        e.preventDefault();
        return;
      }
      if (state.aiming && playerHoldingWeapon()) {
        fireBullet(players[0]);
        e.preventDefault();
      }
    }
  }, true);
  window.addEventListener('mouseup', function (e) {
    // في وضع تعديل التصويب: خلي التصويب شغال عشان يشوف التعديل
    if (e.button === 2 && !state.aimEditMode) state.aiming = false;
    if (e.button === 0) state.mouseLeftDown = false;
  }, true);
  window.addEventListener('contextmenu', function (e) {
    if (isAimEditUI(e.target)) return;
    if (state.mode === 'play' && playerHoldingWeapon()) e.preventDefault();
  }, true);

  
  state.hackFly = false;
  var hackBtn = document.getElementById('hack-btn');
  var hackPanel = document.getElementById('hack-panel');
  var hackFlyBtn = document.getElementById('hack-fly-toggle');
  var hackClose = document.getElementById('hack-close');
  if (hackBtn) {
    hackBtn.onclick = function () {
      if (!isHackAuthorized()) return;
      if (hackPanel) {
        hackPanel.classList.remove('hidden');
        // list players
        var box = document.getElementById('hack-players');
        if (box) {
          box.innerHTML = '';
          var roster = state.netRoster || [];
          if (!roster.length && state.playType === 'split' && players[1]) {
            roster = [{ id: 'p1', name: state.playerName || 'أنا' }, { id: 'p2', name: 'اللاعب 2' }];
          }
          if (!roster.length) {
            box.innerHTML = '<div style="color:#94a3b8;font-size:0.85rem">لا يوجد لاعبين للانتقال</div>';
          }
          roster.forEach(function (p) {
            if (p.id === state.myNetId) return;
            var b = document.createElement('button');
            b.className = 'btn btn-sm btn-accent';
            b.textContent = 'انتقال → ' + (p.name || p.id);
            b.onclick = function () {
              // teleport to remote mesh or player
              if (state.playType === 'split' && p.id === 'p2' && players[1] && players[1].group && players[0].group) {
                players[0].group.position.copy(players[1].group.position);
                players[0].group.position.y += 0.5;
                toast('تم الانتقال', 'success');
                return;
              }
              if (typeof remoteMeshes !== 'undefined' && remoteMeshes && remoteMeshes[p.id]) {
                var m = remoteMeshes[p.id];
                if (m && players[0].group) {
                  players[0].group.position.set(m.position.x, m.position.y + 0.5, m.position.z);
                  toast('تم الانتقال إلى ' + (p.name || ''), 'success');
                }
              } else {
                toast('اللاعب غير متاح حاليًا', 'info');
              }
            };
            box.appendChild(b);
          });
        }
      }
    };
  }
  if (hackFlyBtn) {
    hackFlyBtn.onclick = function () {
      state.hackFly = !state.hackFly;
      hackFlyBtn.textContent = state.hackFly ? 'إلغاء' : 'تفعيل';
      toast(state.hackFly ? 'الطيران شغال' : 'الطيران طافي', 'info');
    };
  }
  if (hackClose) hackClose.onclick = function () {
    if (hackPanel) hackPanel.classList.add('hidden');
  };

  var choiceCancel = document.getElementById('choice-modal-cancel');
  if (choiceCancel) choiceCancel.onclick = function () {
    hideChoiceModal();
    state._choiceCallback = null;
  };

  
  function openGasPlaceModal(item) {
    state._pendingGasItem = item;
    state.pendingGasVoiceMode = 'natural';
    state.pendingGasCustomVoices = {};
    state.pendingGasMaxVisits = 2;
    state.pendingGasCooldownMin = 30;
    var modal = document.getElementById('gas-place-modal');
    var list = document.getElementById('gas-custom-list');
    if (list) { list.classList.add('hidden'); list.innerHTML = ''; }
    if (modal) {
      // حدّث المحتوى لو النافذة موجودة
      var box = modal.querySelector('.cfm-box') || modal;
      box.innerHTML = '<div class="cfm-title">محطة بنزين — اختر الوضع</div>' +
        '<div class="cfm-row" style="flex-direction:column;gap:8px">' +
        '<button type="button" class="btn btn-primary" id="gas-voice-natural">الطبيعي — صوتين ثم المكتب يتقفل</button>' +
        '<button type="button" class="btn btn-accent" id="gas-voice-custom">من عندك — عدد مرات + مدة قابلة للتعديل</button>' +
        '<button type="button" class="btn" id="gas-voice-silent" style="background:#475569;color:#fff">بدون صوت (ماعدا رنة التليفون)</button></div>' +
        '<div id="gas-custom-opts" class="hidden" style="margin-top:10px;padding:10px;background:rgba(0,0,0,0.25);border-radius:10px">' +
        '<label style="display:block;margin:6px 0;font-size:0.85rem">عدد مرات الدخول المسموحة <input type="number" id="gas-max-visits" min="1" max="20" value="5" style="width:70px;margin-right:8px"></label>' +
        '<label style="display:block;margin:6px 0;font-size:0.85rem">المدة بين الدخول (دقيقة) <input type="number" id="gas-cooldown-min" min="1" max="180" value="30" style="width:70px;margin-right:8px"></label>' +
        '<div style="font-size:0.75rem;color:#94a3b8;margin-top:4px">عدد الفويسات = عدد المرات. بعد كل دخول المدير يعمل دورته ويرجع.</div></div>' +
        '<div id="gas-custom-list" class="hidden"></div>' +
        '<button type="button" class="btn btn-success" id="gas-place-confirm" style="width:100%;margin-top:14px">تأكيد ووضع المحطة</button>' +
        '<button type="button" class="btn btn-ghost" id="gas-place-cancel" style="width:100%;margin-top:8px">إلغاء</button>';
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      bindGasPlaceUI();
    } else {
      modal = document.createElement('div');
      modal.id = 'gas-place-modal';
      modal.innerHTML = '<div class="cfm-box" style="max-width:520px"><div class="cfm-title">محطة بنزين — اختر الوضع</div>' +
        '<div class="cfm-row" style="flex-direction:column;gap:8px">' +
        '<button type="button" class="btn btn-primary" id="gas-voice-natural">الطبيعي — صوتين ثم المكتب يتقفل</button>' +
        '<button type="button" class="btn btn-accent" id="gas-voice-custom">من عندك — عدد مرات + مدة قابلة للتعديل</button>' +
        '<button type="button" class="btn" id="gas-voice-silent" style="background:#475569;color:#fff">بدون صوت (ماعدا رنة التليفون)</button></div>' +
        '<div id="gas-custom-opts" class="hidden" style="margin-top:10px;padding:10px;background:rgba(0,0,0,0.25);border-radius:10px">' +
        '<label style="display:block;margin:6px 0;font-size:0.85rem">عدد مرات الدخول المسموحة <input type="number" id="gas-max-visits" min="1" max="20" value="5" style="width:70px;margin-right:8px"></label>' +
        '<label style="display:block;margin:6px 0;font-size:0.85rem">المدة بين الدخول (دقيقة) <input type="number" id="gas-cooldown-min" min="1" max="180" value="30" style="width:70px;margin-right:8px"></label>' +
        '<div style="font-size:0.75rem;color:#94a3b8;margin-top:4px">عدد الفويسات = عدد المرات. بعد كل دخول المدير يعمل دورته ويرجع.</div></div>' +
        '<div id="gas-custom-list" class="hidden"></div>' +
        '<button type="button" class="btn btn-success" id="gas-place-confirm" style="width:100%;margin-top:14px">تأكيد ووضع المحطة</button>' +
        '<button type="button" class="btn btn-ghost" id="gas-place-cancel" style="width:100%;margin-top:8px">إلغاء</button></div>';
      document.body.appendChild(modal);
      modal.style.cssText = 'position:fixed;inset:0;z-index:1800;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55)';
      bindGasPlaceUI();
    }
    toast('اختر الوضع ثم تأكيد', 'info');
  }
  function hideGasPlaceModal() {
    var modal = document.getElementById('gas-place-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }
  function buildGasCustomList() {
    var list = document.getElementById('gas-custom-list');
    if (!list) return;
    list.innerHTML = '';
    list.classList.remove('hidden');
    GAS_VOICE_DEFS.forEach(function (d) {
      var row = document.createElement('div');
      row.className = 'gas-voice-row';
      row.innerHTML = '<label title="' + d.desc + '">' + d.label + '<br><span style="color:#94a3b8;font-weight:600;font-size:0.72rem">' + d.desc + '</span></label>';
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'audio/*,video/*,.mp3,.wav,.ogg,.m4a,.mp4,.webm';
      inp.dataset.vid = d.id;
      inp.onchange = function () {
        var f = inp.files && inp.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          state.pendingGasCustomVoices[d.id] = reader.result;
          toast('تم رفع: ' + d.label, 'success');
        };
        reader.readAsDataURL(f);
      };
      row.appendChild(inp);
      list.appendChild(row);
    });
  }
  function confirmGasPlace() {
    var item = state._pendingGasItem;
    if (!item) {
      toast('مفيش عنصر محدد', 'error');
      return;
    }
    var voices = {};
    try {
      Object.keys(GAS_VOICE_DEFAULT || {}).forEach(function (k) { voices[k] = GAS_VOICE_DEFAULT[k]; });
    } catch (e) {}
    if (state.pendingGasVoiceMode === 'custom') {
      Object.keys(state.pendingGasCustomVoices || {}).forEach(function (k) {
        voices[k] = state.pendingGasCustomVoices[k];
      });
      var mv = document.getElementById('gas-max-visits');
      var cd = document.getElementById('gas-cooldown-min');
      state.pendingGasMaxVisits = mv ? Math.max(1, parseInt(mv.value, 10) || 5) : 5;
      state.pendingGasCooldownMin = cd ? Math.max(1, parseInt(cd.value, 10) || 30) : 30;
    } else if (state.pendingGasVoiceMode === 'natural') {
      state.pendingGasMaxVisits = 2;
      state.pendingGasCooldownMin = 99999; // بعد الصوتين يتقفل نهائيًا تقريبًا
    } else if (state.pendingGasVoiceMode === 'silent') {
      state.pendingGasMaxVisits = 99;
      state.pendingGasCooldownMin = 30;
    }
    state._pendingGasVoices = voices;
    state._pendingGasMode = state.pendingGasVoiceMode || 'natural';
    state._pendingGasMaxVisits = state.pendingGasMaxVisits;
    state._pendingGasCooldownMin = state.pendingGasCooldownMin;
    hideGasPlaceModal();
    var msg = 'محطة — اضغط في المشهد للوضع';
    if (state.pendingGasVoiceMode === 'custom') msg = 'محطة مخصصة (' + state.pendingGasMaxVisits + ' مرات) — اضغط للوضع';
    else if (state.pendingGasVoiceMode === 'silent') msg = 'محطة صامتة — اضغط للوضع';
    else msg = 'محطة طبيعية (صوتين ثم قفل) — اضغط للوضع';
    armPlaceTool(item, msg);
  }

  function findNearestGasStation(pos, maxD) {
    maxD = maxD || 200;
    var best = null, bestD = maxD * maxD;
    (state.gasStations || []).forEach(function (st) {
      if (!st) return;
      var dx = st.position.x - pos.x, dz = st.position.z - pos.z;
      var d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = st; }
    });
    // fallback search buildObjects
    if (!best) {
      for (var i = 0; i < state.buildObjects.length; i++) {
        var o = state.buildObjects[i];
        if (o && o.userData && o.userData.isGasStation) {
          var dx2 = o.position.x - pos.x, dz2 = o.position.z - pos.z;
          var d2 = dx2 * dx2 + dz2 * dz2;
          if (d2 < bestD) { bestD = d2; best = o; }
        }
      }
    }
    return best;
  }


  function tryOpenBossOffice(player) {
    if (!player || !player.group) return false;
    var st = findNearestGasStation(player.group.position, 28);
    if (!st || !st.userData) return false;
    var door = st.userData.officeDoor;
    if (!door) return false;
    var dw = door.getWorldPosition(new THREE.Vector3());
    var dx = dw.x - player.group.position.x, dz = dw.z - player.group.position.z;
    if (dx * dx + dz * dz > 16) return false;
    var now = performance.now();
    var mode = st.userData.voiceMode || 'natural';
    var maxVisits = st.userData.maxOfficeVisits != null ? st.userData.maxOfficeVisits : 2;
    var cooldownMin = st.userData.officeCooldownMin != null ? st.userData.officeCooldownMin : 30;
    var visits = st.userData.officeVisitCount || 0;

    // مقفول بسبب المدير مشغول / أمن / تجاوز الحد
    if (st.userData.security && now < (st.userData.officeLockedUntil || 0)) {
      toast('المدير مشغول شوية — تعالى بعدين', 'info');
      return true;
    }
    if (now < (st.userData.officeLockedUntil || 0)) {
      toast('المدير مشغول شوية — تعالى بعدين', 'info');
      return true;
    }
    if (mode === 'natural' && visits >= 2) {
      toast('المكتب مقفول — المدير خلص كلامه', 'info');
      return true;
    }
    if (visits >= maxVisits) {
      toast('وصلت الحد الأقصى لدخول المكتب', 'info');
      return true;
    }

    st.userData.officeVisitCount = visits + 1;
    var visit = st.userData.officeVisitCount;
    var vid = visit <= 1 ? 'boss_office_cutscene' : 'boss_office_cutscene2';
    var src = getGasVoiceSrc(st, vid);
    var boss = st.userData.boss;
    // أوقف أي أصوات دورية
    state._bossVoiceQueue = [];
    state._bossVoicePlaying = false;
    if (boss) {
      if (st.userData.deskPos) boss.position.copy(st.userData.deskPos);
      boss.userData.state = 'desk';
      boss.userData.deskUntil = now + 999999;
      setNpcSpeaking(boss, true);
    }
    // دخول المكتب + كات سين سينمائي
    var ox = st.position.x + 14;
    var oz = st.position.z - 6;
    player.group.position.set(ox, 0.1, st.position.z - 4.2);
    var lockMs = mode === 'silent' ? 2800 : (visit <= 1 ? 9500 : 7500);
    st.userData.officeLockedUntil = now + lockMs + 1500;
    state.officeLockedUntil = st.userData.officeLockedUntil;
    toast(visit <= 1 ? 'كات سين المكتب...' : 'المدير بيتكلم...', 'info');

    // تشغيل الكات سين (كاميرا سينمائية)
    try {
      if (typeof Game !== 'undefined' && Game.startCutscene) {
        Game.startCutscene({
          x: ox + 3.5, y: 4.2, z: oz + 5.5,
          lookX: ox, lookY: 1.2, lookZ: oz,
          fov: 48, duration: lockMs
        });
      } else {
        state.script.cutscene = true;
        state.script.cutsceneCam = {
          x: ox + 3.5, y: 4.2, z: oz + 5.5,
          lookX: ox, lookY: 1.2, lookZ: oz,
          fov: 48
        };
        var bars = document.getElementById('cutscene-bars');
        if (bars) bars.classList.remove('hidden');
      }
    } catch (eC) {
      state.script.cutscene = true;
      state.script.cutsceneCam = {
        x: ox + 3.5, y: 4.2, z: oz + 5.5,
        lookX: ox, lookY: 1.2, lookZ: oz, fov: 48
      };
    }

    if (mode !== 'silent' && src) {
      playBossVoiceQueued(src, new THREE.Vector3(ox, 1.5, oz), 30, 1);
    }
    try {
      if (typeof Game !== 'undefined' && Game.netSend) {
        Game.netSend({ kind: 'office_enter', visit: visit, station: true });
      }
    } catch (eN) {}

    setTimeout(function () {
      if (boss) setNpcSpeaking(boss, false);
      // إنهاء الكات سين
      try {
        if (typeof Game !== 'undefined' && Game.endCutscene) Game.endCutscene();
        else {
          state.script.cutscene = false;
          state.script.cutsceneCam = null;
          var bars2 = document.getElementById('cutscene-bars');
          if (bars2) bars2.classList.add('hidden');
        }
      } catch (eE) {
        state.script.cutscene = false;
        state.script.cutsceneCam = null;
      }
      if (players[0] && players[0].group) {
        players[0].group.position.set(ox, 0.1, st.position.z - 2);
      }
      toast('خروج إجباري من المكتب', 'info');
      if (boss) {
        boss.userData.state = 'patrol';
        boss.userData.patrolStep = 0;
        boss.userData.stepT = 0;
        boss.userData.talked = false;
      }
      var coolMs = cooldownMin * 60 * 1000;
      if (mode === 'natural' && visit >= 2) {
        coolMs = 999 * 60 * 1000;
        if (!st.userData.security) {
          var sec = makeStationNPC({ shirt: 0x1e3a8a, pants: 0x0f172a, role: 'security', hair: 0x111 });
          sec.position.set(14, 0, -3.2);
          st.add(sec);
          st.userData.security = sec;
        }
      }
      st.userData.officeLockedUntil = performance.now() + coolMs;
      state.officeLockedUntil = st.userData.officeLockedUntil;
      try {
        if (typeof Game !== 'undefined' && Game.netSend) {
          Game.netSend({ kind: 'office_busy', until: st.userData.officeLockedUntil });
        }
      } catch (eN2) {}
    }, lockMs);
    return true;
  }

  function tryRequestFuelDelivery(player) {
    if (!player) return;
    var v = player.vehicle;
    // لازم قريب من عربية بنزينها خلص أو منخفض جدًا
    if (!v) {
      // near empty vehicle?
      var near = findNearestVehicle(player, 6);
      if (near && !near.userData.fuelInfinite && (near.userData.fuel || 0) <= 0) v = near;
    }
    if (!v || v.userData.fuelInfinite) return;
    if ((v.userData.fuel || 0) > 0) return;
    if (v.userData.deliveryPending) {
      toast('في عامل في الطريق', 'info');
      return;
    }
    var st = findNearestGasStation(v.position, 500);
    if (!st) {
      toast('فشل الاتصال — مفيش محطة بنزين قريبة', 'error');
      return;
    }
    // رن شخصي
    var ring = getGasVoiceSrc(st, 'call_ring');
    playPersonalVoice(ring, 0.85);
    setTimeout(function () {
      var ans = getGasVoiceSrc(st, 'call_answer');
      var a = playPersonalVoice(ans, 0.9);
      setTimeout(function () {
        startDeliveryWorker(st, v, player);
      }, 5200);
    }, 2000);
    v.userData.deliveryPending = true;
    var dw = document.getElementById('delivery-wait');
    var dwt = document.getElementById('delivery-wait-text');
    if (dwt) dwt.textContent = 'بانتظار العامل...';
    if (dw) dw.classList.remove('hidden');
    toast('جاري الاتصال...', 'info');
  }

  function startDeliveryWorker(station, vehicle, player) {
    // أولوية: موظف من الكابينة يمشي للعربية (مش موتسيكل)
    var free = null;
    var fromCabin = false;
    var cabin = station.userData.cabinStaff || [];
    for (var i = 0; i < cabin.length; i++) {
      if (cabin[i] && !cabin[i].userData.busy) { free = cabin[i]; fromCabin = true; break; }
    }
    if (!free) {
      var workers = station.userData.deliveryWorkers || [];
      for (var j = 0; j < workers.length; j++) {
        if (workers[j] && !workers[j].userData.busy) { free = workers[j]; break; }
      }
    }
    if (!free) {
      toast('كل الموظفين مشغولين', 'error');
      vehicle.userData.deliveryPending = false;
      var dw = document.getElementById('delivery-wait');
      if (dw) dw.classList.add('hidden');
      return;
    }
    free.userData.busy = true;
    free.userData.targetVehicle = vehicle;
    free.userData.station = station;
    free.userData.fromCabin = fromCabin;
    // موظف الكابينة يمشي مباشرة للعربية
    free.userData.phase = fromCabin ? 'walk_to_car' : 'to_bike';
    if (station.userData.boss && station.userData.boss.userData.state === 'cabin_talk') {
      free.userData.phase = 'wait_boss';
      var dwt = document.getElementById('delivery-wait-text');
      if (dwt) dwt.textContent = 'اصبر ثواني — المدير بيتكلم مع الموظفين';
    } else {
      var dwt2 = document.getElementById('delivery-wait-text');
      if (dwt2) dwt2.textContent = fromCabin ? 'موظف الكابينة في الطريق...' : 'بانتظار العامل...';
    }
    toast(fromCabin ? 'موظف من الكابينة جاي يعبي' : 'عامل التوصيل في الطريق', 'success');
  }

  function updateDeliveryWorkers(delta) {
    (state.gasStations || []).forEach(function (st) {
      if (!st || !st.userData) return;
      var allWorkers = [].concat(st.userData.deliveryWorkers || [], st.userData.cabinStaff || []);
      allWorkers.forEach(function (w) {
        if (!w || !w.userData.busy) return;
        var phase = w.userData.phase;
        var veh = w.userData.targetVehicle;
        if (!veh) { w.userData.busy = false; return; }
        if (phase === 'wait_boss') {
          if (!st.userData.boss || st.userData.boss.userData.state !== 'cabin_talk') {
            w.userData.phase = w.userData.fromCabin ? 'walk_to_car' : 'to_bike';
            var dwt = document.getElementById('delivery-wait-text');
            if (dwt) dwt.textContent = w.userData.fromCabin ? 'موظف الكابينة في الطريق...' : 'بانتظار العامل...';
          }
          return;
        }
        var bike = w.userData.bike;
        var speed = 6;
        // موظف الكابينة يمشي مباشرة للعربية (إحداثيات محلية للمحطة)
        if (phase === 'walk_to_car') {
          // اخرج من الكابينة أولًا لو لسه جوا
          if (!w.userData._leftCabin) {
            w.position.set(w.position.x, 0, -3.5); // بره باب الكابينة
            w.userData._leftCabin = true;
          }
          var targetLocal = new THREE.Vector3(
            veh.position.x - st.position.x + 2.2,
            0,
            veh.position.z - st.position.z + 1.2
          );
          var dltC = targetLocal.clone().sub(w.position);
          dltC.y = 0;
          if (dltC.length() < 2.0) {
            w.userData.phase = 'fill';
            w.userData.fillT = 0;
            w.userData._leftCabin = false;
            var dwC = document.getElementById('delivery-wait');
            if (dwC) dwC.classList.add('hidden');
            toast('وصل موظف الكابينة', 'success');
            var srcC = getGasVoiceSrc(st, 'delivery_arrive');
            playSpatialVoice(srcC, w.getWorldPosition(new THREE.Vector3()), 22, 0.9);
            setNpcSpeaking(w, true);
            setTimeout(function () { setNpcSpeaking(w, false); }, 4000);
          } else {
            dltC.normalize();
            var walkSpd = 7.5;
            w.position.x += dltC.x * walkSpd * delta;
            w.position.z += dltC.z * walkSpd * delta;
            w.position.y = Math.abs(Math.sin((w.userData.walkPhase = (w.userData.walkPhase || 0) + delta * 10))) * 0.06;
            if (w.rotation) w.rotation.y = Math.atan2(dltC.x, dltC.z);
          }
          return;
        }
        if (phase === 'to_bike' && bike) {
          var tp = bike.position.clone();
          // local to station space - use world
          var worldBike = bike.getWorldPosition(new THREE.Vector3());
          var worldW = w.getWorldPosition(new THREE.Vector3());
          var dir = worldBike.clone().sub(worldW);
          if (dir.length() < 0.8) {
            w.userData.phase = 'ride';
          } else {
            dir.normalize();
            w.position.x += dir.x * speed * delta;
            w.position.z += dir.z * speed * delta;
          }
        } else if (phase === 'ride') {
          var target = veh.position.clone();
          // approach offset
          target.x += 3; target.z += 2;
          var wp = w.parent === st ? new THREE.Vector3(w.position.x + st.position.x, 0, w.position.z + st.position.z) : w.getWorldPosition(new THREE.Vector3());
          // simplify: move in parent space toward vehicle relative
          var rel = new THREE.Vector3(target.x - st.position.x, 0, target.z - st.position.z);
          var cur = w.position.clone();
          var dlt = rel.clone().sub(cur);
          if (dlt.length() < 1.5) {
            w.userData.phase = 'fill';
            w.userData.fillT = 0;
            var dw = document.getElementById('delivery-wait');
            if (dw) dw.classList.add('hidden');
            toast('وصل العامل', 'success');
            var src = getGasVoiceSrc(st, 'delivery_arrive');
            var pos = w.getWorldPosition(new THREE.Vector3());
            var au = playSpatialVoice(src, pos, 22, 0.9);
            setNpcSpeaking(w, true);
            setTimeout(function () { setNpcSpeaking(w, false); }, 5000);
          } else {
            dlt.normalize();
            w.position.x += dlt.x * speed * 1.4 * delta;
            w.position.z += dlt.z * speed * 1.4 * delta;
            if (bike) {
              bike.position.x = w.position.x;
              bike.position.z = w.position.z - 1.2;
            }
          }
        } else if (phase === 'fill') {
          w.userData.fillT = (w.userData.fillT || 0) + delta;
          if (w.userData.fillT > 4) {
            veh.userData.fuel = 100;
            veh.userData.deliveryPending = false;
            var src2 = getGasVoiceSrc(st, 'delivery_done');
            playSpatialVoice(src2, w.getWorldPosition(new THREE.Vector3()), 22, 0.9);
            setNpcSpeaking(w, true);
            setTimeout(function () { setNpcSpeaking(w, false); }, 4000);
            w.userData.phase = 'return';
            toast('تم تعبئة البنزين', 'success');
          }
        } else if (phase === 'return') {
          var home = w.userData.homePos || new THREE.Vector3();
          var dd = home.clone().sub(w.position);
          if (dd.length() < 0.6) {
            w.position.copy(home);
            w.userData.busy = false;
            w.userData.phase = '';
            if (bike && w.userData.bike) {
              // leave bike near home
            }
          } else {
            dd.normalize();
            w.position.x += dd.x * speed * delta;
            w.position.z += dd.z * speed * delta;
            if (bike) {
              bike.position.x = w.position.x;
              bike.position.z = w.position.z - 1.2;
            }
          }
        }
      });
    });
  }

  function updateBossPatrol(delta) {
    (state.gasStations || []).forEach(function (st) {
      if (!st || !st.userData || !st.userData.boss) return;
      var boss = st.userData.boss;
      var now = performance.now();
      if (boss.userData.state === 'desk') {
        // وهو في المكتب: مفيش أصوات دورية
        state._bossVoiceQueue = [];
        if (now < (boss.userData.deskUntil || 0)) return;
        boss.userData.state = 'patrol';
        boss.userData.patrolStep = 0;
        boss.userData.stepT = 0;
        boss.userData.talked = false;
      } else if (boss.userData.state === 'patrol') {
        var step = boss.userData.patrolStep | 0;
        var targets = [];
        (st.userData.pumpWorkers || []).forEach(function (pw) {
          targets.push({ pos: pw.position.clone(), type: 'pump', idx: pw.userData.pumpIndex, npc: pw });
        });
        targets.push({ pos: (st.userData.cabinPos || new THREE.Vector3(0,0,-8)).clone(), type: 'cabin', npc: null });
        targets.push({ pos: (st.userData.deskPos || new THREE.Vector3()).clone(), type: 'desk', npc: null });
        if (step >= targets.length) {
          boss.userData.state = 'desk';
          boss.userData.deskUntil = now + 30 * 60 * 1000; // نصف ساعة
          return;
        }
        var tgt = targets[step];
        var to = tgt.pos.clone().sub(boss.position);
        if (to.length() > 0.5) {
          to.normalize();
          boss.position.x += to.x * 2.2 * delta;
          boss.position.z += to.z * 2.2 * delta;
          // أنيميشن بسيط: تمرجح خفيف أثناء المشي
          boss.userData.walkPhase = (boss.userData.walkPhase || 0) + delta * 8;
          boss.position.y = Math.abs(Math.sin(boss.userData.walkPhase)) * 0.06;
          if (boss.rotation) boss.rotation.y = Math.atan2(to.x, to.z);
          boss.userData.stepT = 0;
          boss.userData.talked = false;
        } else {
          boss.position.y = 0;
          boss.userData.stepT = (boss.userData.stepT || 0) + delta;
          if (tgt.type === 'pump') {
            // 10 ث عند العامل، فويس بعد 5
            if (boss.userData.stepT >= 5 && !boss.userData.talked) {
              boss.userData.talked = true;
              var vid = 'boss_pump_' + ((tgt.idx | 0) + 1);
              var src = getGasVoiceSrc(st, vid);
              playBossVoiceQueued(src, boss.getWorldPosition(new THREE.Vector3()), 24, 0.95);
              setNpcSpeaking(boss, true);
              var dur = 4500;
              setTimeout(function () { setNpcSpeaking(boss, false); }, dur);
              boss.userData.voiceUntil = now + dur;
            }
            if (boss.userData.stepT >= 10 && now >= (boss.userData.voiceUntil || 0)) {
              boss.userData.patrolStep = step + 1;
              boss.userData.stepT = 0;
              boss.userData.talked = false;
            }
          } else if (tgt.type === 'cabin') {
            boss.userData.state = 'cabin_talk';
            if (!boss.userData.talked) {
              boss.userData.talked = true;
              var srcC = getGasVoiceSrc(st, 'boss_cabin');
              playBossVoiceQueued(srcC, boss.getWorldPosition(new THREE.Vector3()), 26, 0.95);
              setNpcSpeaking(boss, true);
              boss.userData.voiceUntil = now + 6000;
              setTimeout(function () { setNpcSpeaking(boss, false); }, 6000);
            }
            if (now >= (boss.userData.voiceUntil || 0) && boss.userData.talked) {
              boss.userData.state = 'patrol';
              boss.userData.patrolStep = step + 1;
              boss.userData.talked = false;
              boss.userData.stepT = 0;
            }
          } else {
            boss.userData.state = 'desk';
            boss.userData.deskUntil = now + 30 * 60 * 1000;
          }
        }
      } else if (boss.userData.state === 'cabin_talk') {
        if (now >= (boss.userData.voiceUntil || 0)) {
          boss.userData.state = 'patrol';
          boss.userData.patrolStep = (boss.userData.patrolStep | 0) + 1;
          boss.userData.talked = false;
        }
      }
    });
  }

  function updateFuelEmptyUI(player) {
    var el = document.getElementById('fuel-empty-msg');
    if (!el) return;
    var show = false;
    if (player && player.vehicle && (!player.vehicleSeat || player.vehicleSeat === 'driver')) {
      var v = player.vehicle;
      if (!v.userData.fuelInfinite && (v.userData.fuel || 0) <= 0) show = true;
    } else if (player && player.group) {
      var nv = findNearestVehicle(player, 5);
      if (nv && !nv.userData.fuelInfinite && (nv.userData.fuel || 0) <= 0) show = true;
    }
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }

  // ربط UI محطة البنزين
  function bindGasPlaceUI() {
    var nat = document.getElementById('gas-voice-natural');
    var cust = document.getElementById('gas-voice-custom');
    var sil = document.getElementById('gas-voice-silent');
    var conf = document.getElementById('gas-place-confirm');
    var can = document.getElementById('gas-place-cancel');
    function hideCustomParts() {
      var list = document.getElementById('gas-custom-list');
      var opts = document.getElementById('gas-custom-opts');
      if (list) list.classList.add('hidden');
      if (opts) opts.classList.add('hidden');
    }
    if (nat) nat.onclick = function () {
      state.pendingGasVoiceMode = 'natural';
      hideCustomParts();
      toast('الوضع الطبيعي: صوتين ثم إغلاق المكتب', 'info');
    };
    if (cust) cust.onclick = function () {
      state.pendingGasVoiceMode = 'custom';
      var opts = document.getElementById('gas-custom-opts');
      if (opts) opts.classList.remove('hidden');
      buildGasCustomList();
      toast('حدد عدد المرات والمدة', 'info');
    };
    if (sil) sil.onclick = function () {
      state.pendingGasVoiceMode = 'silent';
      hideCustomParts();
      toast('بدون صوت (ماعدا رنة التليفون)', 'info');
    };
    if (conf) conf.onclick = function () { confirmGasPlace(); };
    if (can) can.onclick = function () { hideGasPlaceModal(); };
  }
  bindGasPlaceUI();


  var btnMenuGfx = document.getElementById('btn-menu-graphics');
  if (btnMenuGfx) btnMenuGfx.onclick = function () {
    var sel = document.getElementById('set-graphics');
    var gl = state.graphicsLevel;
    if (gl == null || isNaN(gl)) gl = 3;
    if (sel) sel.value = String(gl);
    var hint = document.getElementById('graphics-hint');
    if (hint && sel) {
      var hints = {
        0: 'الزباله الحقير العباسي الاماوي الشمبساوي — فريمات صاروخية',
        1: 'الجرافيكس الحقير — أعلى فريمات لأضعف الأجهزة',
        2: 'جرافيكس منخفض — أجهزة ضعيفة',
        3: 'جرافيكس متوسط — توازن الشكل والأداء',
        4: 'جرافيكس عالي — أجهزة قوية',
        5: 'الجرافيكس الأسطوري — أقصى جودة'
      };
      hint.textContent = hints[parseInt(sel.value, 10)] || '';
    }
    var sp = document.getElementById('settings-panel');
    if (sp) sp.classList.remove('hidden');
  };

  var btnCreateModeLan = document.getElementById('btn-create-mode-lan');
  if (btnCreateModeLan) btnCreateModeLan.onclick = function () { setCreateNetMode('lan'); };
  var btnCreateModeCloud = document.getElementById('btn-create-mode-cloud');
  if (btnCreateModeCloud) btnCreateModeCloud.onclick = function () { setCreateNetMode('cloud'); };
  var btnCreateModeCodes = document.getElementById('btn-create-mode-codes');
  if (btnCreateModeCodes) btnCreateModeCodes.onclick = function () { setCreateNetMode('codes'); };
  var btnJoinModeLan = document.getElementById('btn-join-mode-lan');
  if (btnJoinModeLan) btnJoinModeLan.onclick = function () { setJoinNetMode('lan'); };
  var btnJoinModeCloud = document.getElementById('btn-join-mode-cloud');
  if (btnJoinModeCloud) btnJoinModeCloud.onclick = function () { setJoinNetMode('cloud'); };
  var btnJoinModeCodes = document.getElementById('btn-join-mode-codes');
  if (btnJoinModeCodes) btnJoinModeCodes.onclick = function () { setJoinNetMode('codes'); };

  // Live server detection under IP fields
  wireIpLiveCheck('create-ip-input', 'create-ip-status');
  wireIpLiveCheck('create-cloud-input', 'create-cloud-status');
  wireIpLiveCheck('join-ip-input', 'join-ip-status');
  wireIpLiveCheck('join-cloud-input', 'join-cloud-status');

  var btnOnlineCreate = document.getElementById('btn-online-create');
  if (btnOnlineCreate) btnOnlineCreate.onclick = function () {
    showUI('create-room');
    // الافتراضي: تبادل أكواد — من غير بايثون
    try { setCreateNetMode('codes'); } catch (e) {}
  };

  var btnOnlineJoin = document.getElementById('btn-online-join');
  if (btnOnlineJoin) btnOnlineJoin.onclick = function () {
    showUI('join-room');
    try { setJoinNetMode('codes'); } catch (e) {}
  };

  var btnCreateBack = document.getElementById('btn-create-back');
  if (btnCreateBack) btnCreateBack.onclick = function () { showUI('online-hub'); };

  var btnJoinBack = document.getElementById('btn-join-back');
  if (btnJoinBack) btnJoinBack.onclick = function () { showUI('online-hub'); };



  // ===== WebRTC manual SDP exchange (pure P2P, multi-joiner via host star) =====
  // القائد يعمل اتصال منفصل مع كل منضم (حتى maxNetPlayers)، ويبث الرسائل بينهم
  state.useManualRtc = false;
  state._rtcPc = null;          // pending PC (أحدث دعوة)
  state._rtcDc = null;
  state._rtcPendingConn = null;
  state._rtcHostsPcs = [];      // كل اتصالات القائد النشطة {pc,dc,conn}

  function rtcSanitizeCode(code) {
    var s = String(code || '');
    // شيل زخارف واتساب/يونيكود الخفية والمسافات
    s = s.replace(/[\u200B-\u200D\uFEFF\u00A0\u202A-\u202E\u2066-\u2069]/g, '');
    s = s.replace(/[\r\n\t\f\v ]+/g, '');
    // أحيانًا بيتحط prefix من النسخ
    s = s.replace(/^SM1\./i, '');
    // base64url → standard
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    // شيل أي حرف مش base64
    s = s.replace(/[^A-Za-z0-9+/=]/g, '');
    // أصلّح الحشو
    var pad = s.length % 4;
    if (pad === 1) {
      // طول غلط غالبًا = مقطوع
      throw new Error('الكود ناقص أو اتقطع أثناء النسخ (طول غير صالح)');
    }
    if (pad === 2) s += '==';
    else if (pad === 3) s += '=';
    return s;
  }
  function rtcUtf8ToB64(str) {
    var bytes;
    if (typeof TextEncoder !== 'undefined') {
      bytes = new TextEncoder().encode(str);
    } else {
      var un = unescape(encodeURIComponent(str));
      bytes = new Uint8Array(un.length);
      for (var i = 0; i < un.length; i++) bytes[i] = un.charCodeAt(i);
    }
    var bin = '';
    for (var j = 0; j < bytes.length; j++) bin += String.fromCharCode(bytes[j]);
    return btoa(bin);
  }
  function rtcB64ToUtf8(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(bytes);
    }
    var s = '';
    for (var k = 0; k < bytes.length; k++) s += String.fromCharCode(bytes[k]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }
  function rtcNormalizeSdp(sdp, role) {
    // role: 'offer' | 'answer' | null
    // توحيد نهايات السطور + إصلاح setup للإجابات + حذف سطور مشكلة
    var s = String(sdp || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var out = [];
    var lines = s.split('\n');
    var inMedia = false;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) continue;
      if (/^m=/i.test(t)) inMedia = true;
      // Chrome — بعض المتصفحات ترفضه
      if (/^a=max-message-size:/i.test(t)) continue;
      if (/^a=x-/i.test(t)) continue;
      // في الـ answer: setup لازم active أو passive — مش actpass
      if (role === 'answer' && /^a=setup:/i.test(t)) {
        if (/actpass/i.test(t)) t = 'a=setup:active';
        else if (!/active|passive|holdconn/i.test(t)) t = 'a=setup:active';
      }
      // في الـ offer: actpass مسموح؛ لو ناقص سيبه للمتصفح
      out.push(t);
    }
    // تأكد إن كل m-section في الـ answer فيه setup صالح
    if (role === 'answer') {
      out = rtcEnsureAnswerSetup(out);
    }
    return out.join('\r\n') + '\r\n';
  }
  function rtcEnsureAnswerSetup(lines) {
    var result = [];
    var i = 0;
    while (i < lines.length) {
      var t = lines[i];
      result.push(t);
      if (/^m=/i.test(t)) {
        // اجمع سطور الـ section لحد m= التالي أو النهاية
        var j = i + 1;
        var section = [];
        var hasSetup = false;
        while (j < lines.length && !/^m=/i.test(lines[j])) {
          if (/^a=setup:/i.test(lines[j])) {
            hasSetup = true;
            if (/actpass/i.test(lines[j])) {
              section.push('a=setup:active');
            } else {
              section.push(lines[j]);
            }
          } else {
            section.push(lines[j]);
          }
          j++;
        }
        // data channel / DTLS غالبًا يحتاج setup
        if (!hasSetup && (/^m=application/i.test(t) || /^m=audio/i.test(t))) {
          section.unshift('a=setup:active');
        }
        for (var k = 0; k < section.length; k++) result.push(section[k]);
        i = j;
        continue;
      }
      i++;
    }
    return result;
  }
  function rtcEncodeSdp(sdp, role) {
    var s = rtcNormalizeSdp(sdp, role || null);
    if (!s || s.indexOf('v=0') < 0) {
      throw new Error('SDP فاضي أو غير جاهز');
    }
    if (s.indexOf('m=') < 0) {
      throw new Error('SDP ناقص (مفيش media)');
    }
    var b64 = rtcUtf8ToB64(s);
    var lines = [];
    for (var i = 0; i < b64.length; i += 64) lines.push(b64.substr(i, 64));
    return 'SM1.\n' + lines.join('\n');
  }
  function rtcDecodeSdp(code, role) {
    var raw = rtcSanitizeCode(code);
    if (!raw || raw.length < 20) {
      throw new Error('الكود قصير جدًا — غالبًا اتقطع. ابعتوه كملف نصي');
    }
    var sdp;
    try {
      sdp = rtcB64ToUtf8(raw);
    } catch (e) {
      throw new Error('فشل فك الكود — تأكد إنه منسوخ كامل من غير مسافات زيادة');
    }
    sdp = rtcNormalizeSdp(sdp, role || null);
    if (sdp.indexOf('v=0') < 0) {
      throw new Error('بعد الفك مفيش SDP صالح (اتشوّه الكود في النقل)');
    }
    if (sdp.indexOf('m=') < 0) {
      throw new Error('SDP ناقص (مفيش media) — الكود مش مكتمل');
    }
    return sdp;
  }
  function rtcDownloadCode(text, filename) {
    try {
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || 'sm-code.txt';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { URL.revokeObjectURL(a.href); } catch (e) {}
        try { a.remove(); } catch (e2) {}
      }, 500);
      toast('تم تحميل الملف — ابعت الملف لصاحبك أفضل من النسخ', 'success');
    } catch (e) {
      toast('فشل تحميل الملف', 'error');
    }
  }
  function rtcLoadCodeFromFile(inputEl, targetTextareaId) {
    var f = inputEl && inputEl.files && inputEl.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var ta = document.getElementById(targetTextareaId);
      if (ta) ta.value = String(reader.result || '');
      toast('تم تحميل الكود من الملف', 'success');
    };
    reader.onerror = function () { toast('فشل قراءة الملف', 'error'); };
    reader.readAsText(f);
  }
  function rtcWaitIce(pc, ms) {
    // استنى جمع ICE كامل قدر الإمكان (مهم لـ Radmin و NAT)
    return new Promise(function (resolve) {
      if (!pc) return resolve();
      if (pc.iceGatheringState === 'complete') return resolve();
      var done = false;
      var candCount = 0;
      function finish() {
        if (done) return;
        done = true;
        try { pc.removeEventListener('icegatheringstatechange', onCh); } catch (e) {}
        try { pc.removeEventListener('icecandidate', onCand); } catch (e2) {}
        resolve();
      }
      function onCh() {
        if (pc.iceGatheringState === 'complete') finish();
      }
      function onCand(ev) {
        if (!ev || !ev.candidate) {
          finish();
          return;
        }
        candCount++;
      }
      pc.addEventListener('icegatheringstatechange', onCh);
      pc.addEventListener('icecandidate', onCand);
      // حد أقصى أطول عشان كل واجهات الشبكة (Radmin + WiFi)
      setTimeout(finish, ms != null ? ms : 12000);
    });
  }


  function rtcIceServers(preferRelay) {
    // STUN + TURN — ضروري على GitHub Pages / شبكات مختلفة
    var list = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp',
          'turn:openrelay.metered.ca:80?transport=tcp'
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turns:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ];
    return list;
  }

  async function rtcTryConnectWithAnswer(pc, answerSdp) {
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    return rtcWatchUntilConnected(pc, state._rtcDc, 20000);
  }

  function rtcWatchUntilConnected(pc, dc, timeoutMs) {
    return new Promise(function (resolve) {
      if (!pc) return resolve(false);
      var done = false;
      var t0 = Date.now();
      function ok() {
        if (done) return;
        done = true;
        resolve(true);
      }
      function fail() {
        if (done) return;
        done = true;
        resolve(false);
      }
      function tick() {
        if (done) return;
        try {
          var st = document.getElementById('rtc-ex-status');
          var ice = pc.iceConnectionState || '';
          var cs = pc.connectionState || '';
          var dcs = dc ? dc.readyState : '-';
          if (st) {
            st.textContent = 'الاتصال: ' + cs + ' | ICE: ' + ice + ' | القناة: ' + dcs +
              ' (' + Math.round((Date.now() - t0) / 1000) + 'ث)';
          }
          if (dc && dc.readyState === 'open') return ok();
          if (cs === 'connected' && dc && dc.readyState === 'open') return ok();
          if (ice === 'failed' || cs === 'failed') return fail();
          if (Date.now() - t0 > (timeoutMs || 25000)) return fail();
        } catch (e) {}
        setTimeout(tick, 400);
      }
      try {
        pc.addEventListener('connectionstatechange', function () {
          if (pc.connectionState === 'connected' && dc && dc.readyState === 'open') ok();
          if (pc.connectionState === 'failed') fail();
        });
        pc.addEventListener('iceconnectionstatechange', function () {
          if (pc.iceConnectionState === 'failed') fail();
          if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            if (dc && dc.readyState === 'open') ok();
          }
        });
      } catch (e) {}
      if (dc) {
        dc.addEventListener('open', function () { ok(); });
      }
      tick();
    });
  }

  function voiceEnsureMicFast(ms) {
    // متعلّقش توليد الكود لو إذن المايك اتأخر
    return Promise.race([
      voiceEnsureMic(false).catch(function () { return false; }),
      new Promise(function (resolve) { setTimeout(function () { resolve(false); }, ms || 1500); })
    ]);
  }
  // ===== Voice chat (mic) — إذن مرة واحدة + B للتبديل =====
  state.voice = {
    stream: null,
    enabled: false,
    permission: 'unknown', // unknown | granted | denied
    askedOnce: false,
    level: 0,
    talking: false,
    analyser: null,
    audioCtx: null,
    remoteAudios: {}
  };

  function updateMicHud() {
    var btn = document.getElementById('mic-hud-btn');
    if (!btn) return;
    var onlineOk = state.playType === 'online' || !!state.buildCollabOnline;
    if (!((state.mode === 'play' || state.mode === 'build') && onlineOk)) {
      btn.classList.add('hidden');
      return;
    }
    btn.classList.remove('hidden');
    var on = !!(state.voice && state.voice.enabled && state.voice.stream);
    btn.classList.toggle('mic-on', on);
    btn.classList.toggle('mic-off', !on);
    btn.title = on ? 'المايك شغال (B للإغلاق)' : 'المايك مطفي (B للتشغيل)';
    var lab = document.getElementById('mic-hud-label');
    if (lab) lab.textContent = on ? 'ON' : 'OFF';
  }

  function voiceGetAudioTrack() {
    if (!state.voice.stream) return null;
    var tracks = state.voice.stream.getAudioTracks();
    return tracks && tracks[0] ? tracks[0] : null;
  }

  function voiceSetupAnalyser() {
    try {
      if (!state.voice.stream) return;
      if (!state.voice.audioCtx) {
        state.voice.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      var ctx = state.voice.audioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      var src = ctx.createMediaStreamSource(state.voice.stream);
      var an = ctx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.7;
      src.connect(an);
      // متوصلش للسماعة عشان مفيش صدى من نفسك
      state.voice.analyser = an;
      state.voice._anData = new Uint8Array(an.frequencyBinCount);
    } catch (e) {
      console.warn('voice analyser', e);
    }
  }

  function voiceUpdateLevel() {
    var v = state.voice;
    if (!v || !v.enabled || !v.analyser || !v._anData) {
      if (v) { v.level = 0; v.talking = false; }
      return 0;
    }
    v.analyser.getByteFrequencyData(v._anData);
    var sum = 0, n = v._anData.length;
    for (var i = 0; i < n; i++) sum += v._anData[i];
    var avg = sum / Math.max(1, n);
    v.level = avg / 255;
    // عتبة: الراس تتحرك لما في صوت فعلي مش بس مايك مفتوح
    v.talking = v.level > 0.035;
    return v.level;
  }

  function applyHeadTalkBob(group, talking, intensity, dt) {
    if (!group || !group.userData) return;
    var head = group.userData.head;
    if (!head) {
      group.traverse(function (ch) {
        if (ch.userData && ch.userData.isHead) head = ch;
      });
      if (head) group.userData.head = head;
    }
    if (!head) return;
    var base = group.userData.headBaseY != null ? group.userData.headBaseY : 1.85;
    if (!group.userData._talkPhase) group.userData._talkPhase = 0;
    if (talking) {
      // حركة كبيرة وواضحة وملفتة
      group.userData._talkPhase += (dt || 0.016) * (14 + intensity * 22);
      var amp = 0.09 + intensity * 0.12; // أوضح بكتير
      if (amp > 0.22) amp = 0.22;
      head.position.y = base + Math.sin(group.userData._talkPhase) * amp;
      // هز خفيف يمين/شمال عشان يبان أكتر
      head.position.x = Math.sin(group.userData._talkPhase * 0.7) * amp * 0.25;
    } else {
      head.position.y += (base - head.position.y) * Math.min(1, (dt || 0.016) * 12);
      head.position.x += (0 - (head.position.x || 0)) * Math.min(1, (dt || 0.016) * 12);
    }
  }

  async function voiceEnsureMic(forcePrompt) {
    if (state.voice.stream) {
      var t = voiceGetAudioTrack();
      if (t && t.readyState === 'live') {
        state.voice.permission = 'granted';
        return true;
      }
    }
    if (state.voice.permission === 'denied' && !forcePrompt) {
      return false;
    }
    if (state.voice.askedOnce && state.voice.permission === 'denied' && !forcePrompt) {
      return false;
    }
    // تشخيص بيئة المايك
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('المتصفح لا يدعم المايك هنا — استخدم http://127.0.0.1:27100 عبر lan_host.py', 'error');
      state.voice.permission = 'denied';
      return false;
    }
    try {
      state.voice.askedOnce = true;
      // قيود بسيطة أولاً (أنجح على localhost)
      var stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (e1) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        });
      }
      state.voice.stream = stream;
      state.voice.permission = 'granted';
      try {
        stream.getAudioTracks().forEach(function (tr) { tr.enabled = true; });
      } catch (eEn) {}
      voiceSetupAnalyser();
      try { voiceAttachToAllPeers(); } catch (eA) {}
      try { voiceForceSendTrack(); } catch (eF) {}
      return true;
    } catch (err) {
      console.warn('mic permission', err);
      state.voice.permission = 'denied';
      state.voice.stream = null;
      state.voice.enabled = false;
      var msg = 'فشل إذن المايك';
      var name = (err && err.name) ? String(err.name) : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        msg = 'المتصفح رفض المايك — من القفل 🔒 بجانب الرابط اسمح بالميكروفون ثم اضغط B';
      } else if (name === 'NotFoundError') {
        msg = 'مفيش ميكروفون متصل بالجهاز';
      } else if (name === 'NotReadableError') {
        msg = 'الميكروفون مستخدم من برنامج تاني';
      } else if (err && err.message) {
        msg = 'فشل المايك: ' + err.message;
      }
      toast(msg, 'error');
      updateMicHud();
      return false;
    }
  }

  function voiceUnlockRemotePlayback() {
    try {
      if (state.voice.audioCtx && state.voice.audioCtx.state === 'suspended') {
        state.voice.audioCtx.resume();
      }
    } catch (e) {}
    var map = state.voice.remoteAudios || {};
    Object.keys(map).forEach(function (id) {
      var a = map[id];
      if (!a) return;
      try {
        a.muted = false;
        if (a.volume == null || a.volume === 0) a.volume = 1;
        var p = a.play();
        if (p && p.catch) p.catch(function () {});
      } catch (e2) {}
    });
  }
  function voiceForceSendTrack() {
    try {
      if (state._rtcPc) rtcBindLocalMicToPc(state._rtcPc);
      (state._rtcHostsPcs || []).forEach(function (slot) {
        if (slot && slot.pc) rtcBindLocalMicToPc(slot.pc);
      });
    } catch (e0) {}
    var track = voiceGetAudioTrack();
    if (!track) return;
    // التراك دايمًا مربوط؛ mute عبر enabled فقط
    track.enabled = !!state.voice.enabled;
    function applyPc(pc) {
      if (!pc) return;
      try {
        // فرض sendrecv
        try {
          (pc.getTransceivers() || []).forEach(function (tr) {
            try {
              if (tr.receiver && tr.receiver.track && tr.receiver.track.kind === 'audio') tr.direction = 'sendrecv';
              else if (tr.sender && (!tr.sender.track || tr.sender.track.kind === 'audio')) tr.direction = 'sendrecv';
            } catch (eD) {}
          });
        } catch (eT) {}
        var senders = pc.getSenders() || [];
        var replaced = false;
        for (var i = 0; i < senders.length; i++) {
          var s = senders[i];
          if (!s) continue;
          var kind = s.track ? s.track.kind : null;
          if (kind === 'audio' || kind == null) {
            try {
              s.replaceTrack(track);
              replaced = true;
            } catch (eR) {}
          }
        }
        if (!replaced && state.voice.stream) {
          try { pc.addTrack(track, state.voice.stream); } catch (eA) {}
        }
        // استقبال
        try {
          (pc.getReceivers() || []).forEach(function (recv) {
            if (recv && recv.track && recv.track.kind === 'audio') {
              try { recv.track.enabled = true; } catch (e) {}
              voiceBindRemoteTrack(recv.track, recv.track.id);
            }
          });
        } catch (eR) {}
      } catch (e) {}
    }
    applyPc(state._rtcPc);
    (state._rtcHostsPcs || []).forEach(function (slot) { if (slot) applyPc(slot.pc); });
    if (state.connection) applyPc(state.connection._pc);
    (state.connections || []).forEach(function (c) { if (c) applyPc(c._pc); });
  }
  function voiceSetEnabled(on) {
    state.voice.enabled = !!on;
    var track = voiceGetAudioTrack();
    if (track) track.enabled = !!on;
    try { voiceForceSendTrack(); } catch (eF) {}
    try { voiceAttachToAllPeers(); } catch (eA) {}
    try { voiceUnlockRemotePlayback(); } catch (eU) {}
    // فك تشغيل كل الريموت صراحة
    try {
      Object.keys(state.voice.remoteAudios || {}).forEach(function (id) {
        var a = state.voice.remoteAudios[id];
        if (!a) return;
        a.muted = false;
        if (a.volume < 0.3) a.volume = 0.85;
        a.play().catch(function () {});
      });
    } catch (eR) {}
    updateMicHud();
  }
  function updatePeerVoiceSpatial() {
    if (!state.voice || !state.voice.remoteAudios) return;
    var audioIds = Object.keys(state.voice.remoteAudios);
    if (!audioIds.length) return;
    // صوت مرتبط بجسم اللاعب/البنّاء — مش لكل السيرفر بنفس القوة
    var maxD = state.mode === 'build' ? 55 : 42;
    var myPos = null;
    try {
      if (state.mode === 'build' && typeof buildCamera !== 'undefined' && buildCamera) myPos = buildCamera.position.clone();
      else if (players[0] && players[0].group) myPos = players[0].group.position.clone();
    } catch (e) {}
    if (!myPos) myPos = new THREE.Vector3(0, 5, 0);

    for (var i = 0; i < audioIds.length; i++) {
      var aid = audioIds[i];
      var a = state.voice.remoteAudios[aid];
      if (!a) continue;
      // peer id مخزّن على العنصر
      var peerId = a._peerId || aid;
      var peerPos = null;
      try {
        if (state.remoteMeshes && state.remoteMeshes[peerId]) peerPos = state.remoteMeshes[peerId].position;
        else if (state.remoteBuilders && state.remoteBuilders[peerId]) peerPos = state.remoteBuilders[peerId].position;
        // لو المفتاح track-based: دور على أي ريموت
        if (!peerPos) {
          var rids = Object.keys(state.remoteMeshes || {});
          if (rids.length === 1) peerPos = state.remoteMeshes[rids[0]].position;
          else {
            var bids = Object.keys(state.remoteBuilders || {});
            if (bids.length === 1) peerPos = state.remoteBuilders[bids[0]].position;
          }
        }
      } catch (e2) {}
      var vol = 0.2;
      if (peerPos) {
        var dist = myPos.distanceTo(peerPos);
        if (dist >= maxD) vol = 0.05;
        else {
          var t = 1 - dist / maxD;
          vol = Math.max(0.05, Math.pow(t, 1.25));
        }
      } else {
        vol = 0.55; // لسه مفيش جسم — متوسط لحد ما البوز يوصل
      }
      try {
        a.muted = false;
        a.volume = Math.max(0, Math.min(1, vol));
        if (a.paused) a.play().catch(function () {});
      } catch (e) {}
    }
  }

  async function voiceToggleFromKey() {
    var onlineOk = state.playType === 'online' || !!state.buildCollabOnline;
    if (!(state.mode === 'play' || state.mode === 'build') || !onlineOk) return;

    // قفل المايك
    if (state.voice.enabled && state.voice.stream) {
      voiceSetEnabled(false);
      try {
        (state.voice.stream.getTracks() || []).forEach(function (t) {
          try { t.stop(); } catch (e) {}
        });
      } catch (eS) {}
      state.voice.stream = null;
      state.voice.permission = 'unknown';
      state.voice.askedOnce = false;
      try { voiceForceSendTrack(); } catch (e) {}
      updateMicHud();
      toast('المايك مطفي', 'info');
      return;
    }

    // فتح المايك = إذن جديد كل مرة (حسب طلبك)
    try {
      if (state.voice.stream) {
        (state.voice.stream.getTracks() || []).forEach(function (t) {
          try { t.stop(); } catch (e) {}
        });
      }
    } catch (e0) {}
    state.voice.stream = null;
    state.voice.askedOnce = false;
    state.voice.permission = 'unknown';

    toast('مطلوب إذن المايك...', 'info');
    var ok = await voiceEnsureMic(true);
    if (!ok) {
      updateMicHud();
      toast('تم رفض المايك أو فشل الإذن', 'error');
      return;
    }
    voiceSetEnabled(true);
    try { voiceForceSendTrack(); voiceUnlockRemotePlayback(); } catch (e) {}
    setTimeout(function () {
      try { voiceForceSendTrack(); voiceUnlockRemotePlayback(); } catch (e3) {}
    }, 400);
    updateMicHud();
    toast('المايك شغال', 'success');
  }

  function voiceAttachToPc(pc) {
    if (!pc) return;
    try {
      var audioSender = null;
      try {
        pc.getTransceivers().forEach(function (tr) {
          if (!tr) return;
          if (tr.receiver && tr.receiver.track && tr.receiver.track.kind === 'audio') {
            // already has audio recv
          }
          if (tr.sender && (tr.sender.track == null || (tr.sender.track && tr.sender.track.kind === 'audio'))) {
            if (tr.mid != null || tr.sender) audioSender = tr.sender;
          }
        });
      } catch (e2) {}
      if (!audioSender) {
        try {
          var senders = pc.getSenders();
          for (var i = 0; i < senders.length; i++) {
            if (senders[i].track && senders[i].track.kind === 'audio') { audioSender = senders[i]; break; }
          }
        } catch (eS) {}
      }
      // لو الاتصال لسه قبل offer ومفيش transceiver
      if (!audioSender) {
        var hasAudioTr = false;
        try {
          pc.getTransceivers().forEach(function (tr) {
            if (tr.receiver && tr.receiver.track && tr.receiver.track.kind === 'audio') hasAudioTr = true;
            if (tr.sender && tr.sender.track && tr.sender.track.kind === 'audio') hasAudioTr = true;
            // transceiver audio بدون track
            try {
              if (tr.sender && !tr.sender.track && String(tr.direction || '').indexOf('send') >= 0) {
                hasAudioTr = true;
                audioSender = tr.sender;
              }
            } catch (e0) {}
          });
        } catch (e3) {}
        if (!hasAudioTr && (pc.signalingState === 'have-local-offer' || pc.signalingState === 'stable' || pc.signalingState === 'have-remote-offer' || pc.connectionState === 'new' || pc.connectionState === 'connecting')) {
          // بعد تبادل SDP إضافة transceiver جديدة صعبة؛ نحاول فقط لو new
          if (pc.connectionState === 'new' || pc.signalingState === 'stable' && pc.getSenders().length === 0) {
            try {
              var trn = pc.addTransceiver('audio', { direction: 'sendrecv' });
              audioSender = trn.sender;
            } catch (e4) {}
          }
        }
      }
      var track = voiceGetAudioTrack();
      if (track) {
        track.enabled = !!state.voice.enabled;
        if (audioSender) {
          try {
            audioSender.replaceTrack(track);
          } catch (eR) {
            try { pc.addTrack(track, state.voice.stream); } catch (eA) {}
          }
        } else {
          try { pc.addTrack(track, state.voice.stream); } catch (eA2) {}
        }
      }
      // اربط أي receiver tracks موجودة بالفعل
      try {
        pc.getReceivers().forEach(function (recv) {
          if (!recv || !recv.track || recv.track.kind !== 'audio') return;
          voiceBindRemoteTrack(recv.track, recv.track.id);
        });
      } catch (eRcv) {}
      if (!pc._voiceOnTrackBound) {
        pc._voiceOnTrackBound = true;
        function onTrk(ev) {
          try {
            if (!ev.track || ev.track.kind !== 'audio') return;
            // حاول نعرف peer من الـ connection المرتبط بالـ pc
            var peerId = pc._smPeerId || null;
            if (!peerId) {
              try {
                (state.connections || []).forEach(function (c) {
                  if (c && c._pc === pc && c._netId) peerId = c._netId;
                });
                if (!peerId && state.connection && state.connection._pc === pc) {
                  peerId = state.connection._netId || 'host';
                }
              } catch (eP) {}
            }
            voiceBindRemoteTrack(ev.track, ev.track.id, peerId);
          } catch (eT) { console.warn(eT); }
        }
        pc.addEventListener('track', onTrk);
        pc.ontrack = onTrk;
      }
    } catch (e) {
      console.warn('voiceAttachToPc', e);
    }
  }
  function voiceBindRemoteTrack(track, idHint, peerId) {
    if (!track || track.kind !== 'audio') return;
    var id = peerId ? ('peer_' + peerId) : ('ra_' + (track.id || idHint || Math.random().toString(36).slice(2)));
    var existing = state.voice.remoteAudios[id];
    var stream = new MediaStream([track]);
    var audio = existing;
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.controls = false;
      audio.playsInline = true;
      audio.setAttribute('playsinline', 'true');
      audio.muted = false;
      audio.volume = 0.8;
      audio.style.display = 'none';
      try { document.body.appendChild(audio); } catch (e) {}
      state.voice.remoteAudios[id] = audio;
    }
    audio._peerId = peerId || audio._peerId || null;
    try { audio.srcObject = stream; } catch (e1) {}
    audio.muted = false;
    audio.volume = audio.volume || 0.8;
    try { track.enabled = true; } catch (e) {}
    try { track.contentHint = 'speech'; } catch (eH) {}
    function tryPlay() {
      try {
        audio.muted = false;
        var p = audio.play();
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    }
    tryPlay();
    setTimeout(tryPlay, 200);
    setTimeout(tryPlay, 1000);
    setTimeout(tryPlay, 2500);
    track.onunmute = tryPlay;
    track.onended = function () { try { audio.pause(); } catch (e) {} };
    // لو التراك mute من المصدر — نفضل نستنى unmute
    if (track.muted) {
      track.addEventListener('unmute', tryPlay);
    }
  }

  function voiceAttachToAllPeers() {
    try {
      if (state._rtcPc) voiceAttachToPc(state._rtcPc);
      (state._rtcHostsPcs || []).forEach(function (slot) {
        if (slot && slot.pc) voiceAttachToPc(slot.pc);
      });
      if (state.connection && state.connection._pc) voiceAttachToPc(state.connection._pc);
      (state.connections || []).forEach(function (c) {
        if (c && c._pc) voiceAttachToPc(c._pc);
      });
    } catch (e) {}
  }

  async function voiceOnEnterGame() {
    // طلب إذن مرة واحدة عند دخول الجيم/البناء أونلاين
    if (state.playType !== 'online' && !state.buildCollabOnline) {
      updateMicHud();
      return;
    }
    updateMicHud();
    if (state.voice.permission === 'granted' && state.voice.stream) {
      voiceSetEnabled(false); // يبدأ مطفي، اللاعب يفتح بـ B
      updateMicHud();
      return;
    }
    if (state.voice.permission === 'denied' && state.voice.askedOnce) {
      updateMicHud();
      return;
    }
    // أول مرة فقط
    var ok = await voiceEnsureMic(false);
    if (ok) {
      voiceSetEnabled(false); // موجود بس مطفي لحد B
      toast('المايك جاهز — اضغط B للتشغيل', 'info');
    }
    updateMicHud();
  }

  function rtcForceAudioSendRecv(pc) {
    if (!pc) return;
    try {
      (pc.getTransceivers() || []).forEach(function (tr) {
        if (!tr) return;
        var isAudio = false;
        try {
          if (tr.receiver && tr.receiver.track && tr.receiver.track.kind === 'audio') isAudio = true;
          if (tr.sender && tr.sender.track && tr.sender.track.kind === 'audio') isAudio = true;
          // transceiver فاضي غالبًا audio لو mid/kind
          if (!isAudio && tr.sender && !tr.sender.track) {
            // اعتبره صوتي لو الاتجاه فيه send/recv
            isAudio = true;
          }
        } catch (e) {}
        if (isAudio) {
          try { tr.direction = 'sendrecv'; } catch (e2) {}
        }
      });
    } catch (e3) {}
  }

  async function rtcBindLocalMicToPc(pc) {
    if (!pc) return false;
    try { await voiceEnsureMicFast(1500); } catch (e) {}
    var track = voiceGetAudioTrack();
    if (!track || !state.voice.stream) return false;
    try { track.enabled = true; } catch (e) {}
    rtcForceAudioSendRecv(pc);
    var bound = false;
    try {
      var senders = pc.getSenders() || [];
      for (var i = 0; i < senders.length; i++) {
        var s = senders[i];
        if (!s) continue;
        if (!s.track || s.track.kind === 'audio') {
          try {
            await s.replaceTrack(track);
            bound = true;
          } catch (eR) {}
        }
      }
    } catch (eS) {}
    if (!bound) {
      try {
        pc.addTrack(track, state.voice.stream);
        bound = true;
      } catch (eA) {
        try {
          var trn = pc.addTransceiver(track, { direction: 'sendrecv', streams: [state.voice.stream] });
          bound = !!trn;
        } catch (eT) {}
      }
    }
    rtcForceAudioSendRecv(pc);
    return bound;
  }

  function rtcMakePc(opts) {
    opts = opts || {};
    var policy = opts.iceTransportPolicy || 'all';
    var pc = new RTCPeerConnection({
      iceServers: rtcIceServers(policy === 'relay'),
      iceTransportPolicy: policy,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    });
    // القائد (offer): transceiver من الأول. المنضم: بعد setRemoteDescription فقط
    if (opts.offerSide) {
      try { pc.addTransceiver('audio', { direction: 'sendrecv' }); } catch (e) {}
      try { voiceAttachToPc(pc); } catch (e2) {}
    }
    pc.addEventListener('track', function (ev) {
      try {
        var tr = ev.track;
        if (!tr || tr.kind !== 'audio') return;
        var pid = null;
        try {
          if (state._rtcPendingConn && state._rtcPendingConn.peer) pid = state._rtcPendingConn.peer;
          else if (state.connection && state.connection.peer) pid = state.connection.peer;
        } catch (e) {}
        voiceBindRemoteTrack(tr, 'rtc', pid);
      } catch (eT) {}
    });
    pc.addEventListener('connectionstatechange', function () {
      if (pc.connectionState === 'connected' || pc.connectionState === 'completed') {
        try { voiceForceSendTrack(); } catch (e) {}
        try { voiceUnlockRemotePlayback(); } catch (e2) {}
        try { rtcBindLocalMicToPc(pc); } catch (e3) {}
        [300, 800, 1500, 3000, 6000, 10000].forEach(function (ms) {
          setTimeout(function () {
            try {
              rtcBindLocalMicToPc(pc);
              voiceForceSendTrack();
              voiceUnlockRemotePlayback();
            } catch (e4) {}
          }, ms);
        });
      }
    });
    return pc;
  }
  function rtcMaxJoiners() {
    var m = state.maxNetPlayers || 8;
    return Math.max(1, m - 1); // بدون القائد
  }
  function rtcWrapDc(dc, pc, role) {
    var conn = {
      open: dc.readyState === 'open',
      _dc: dc,
      _pc: pc,
      _netId: null,
      _custom: null,
      _rtcRole: role || 'unknown',
      _connectedFired: false,
      send: function (data) {
        if (dc.readyState !== 'open') return;
        try {
          dc.send(typeof data === 'string' ? data : JSON.stringify(data));
        } catch (e) {}
      }
    };
    function fireConnected() {
      if (conn._connectedFired) return;
      if (dc.readyState !== 'open') return;
      conn._connectedFired = true;
      conn.open = true;
      var st = document.getElementById('rtc-ex-status');
      if (st) st.textContent = '✓ القناة اتفتحت — جاري الدخول...';
      try { onManualRtcConnected(conn, pc, dc); } catch (e2) { console.warn(e2); }
    }
    dc.binaryType = 'arraybuffer';
    dc.onopen = function () { fireConnected(); };
    // لو القناة اتفتحت قبل ما نربط onopen
    if (dc.readyState === 'open') {
      setTimeout(fireConnected, 0);
    }
    // راقب حالة الـ PC كمان
    if (pc && !pc._smConnWatch) {
      pc._smConnWatch = true;
      pc.addEventListener('connectionstatechange', function () {
        var st = document.getElementById('rtc-ex-status');
        if (pc.connectionState === 'connected') {
          if (st) st.textContent = '✓ الاتصال جاهز — بانتظار القناة...';
          // جرّب فتح القناة
          setTimeout(fireConnected, 100);
          setTimeout(fireConnected, 800);
        } else if (pc.connectionState === 'failed') {
          if (st) st.textContent = 'فشل الاتصال — أعد توليد الأكواد وابعتها كملف';
          toast('فشل WebRTC — أعد تبادل الأكواد', 'error');
        } else if (pc.connectionState === 'connecting') {
          if (st) st.textContent = 'جاري الاتصال...';
        }
      });
      pc.addEventListener('iceconnectionstatechange', function () {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          setTimeout(fireConnected, 50);
        }
      });
    }
    // polling احتياطي (أحيانًا onopen بيتفوت)
    var polls = 0;
    var pollIv = setInterval(function () {
      polls++;
      if (conn._connectedFired || polls > 40) {
        clearInterval(pollIv);
        if (!conn._connectedFired && polls > 40) {
          var st = document.getElementById('rtc-ex-status');
          if (st) st.textContent = 'القناة ما اتفتحتش — أعد الأكواد كملف txt (مش نسخ)';
        }
        return;
      }
      if (dc.readyState === 'open') fireConnected();
    }, 500);
    dc.onclose = function () {
      conn.open = false;
      if (state.isHost && state.connections) {
        state.connections = state.connections.filter(function (c) { return c !== conn; });
        state.player2Joined = state.connections.length > 0;
        try { renderNetLobbyList(); } catch (e) {}
      }
      toast('انقطع اتصال لاعب WebRTC', 'error');
    };
    dc.onerror = function () {
      toast('خطأ في قناة WebRTC', 'error');
    };
    dc.onmessage = function (ev) {
      var raw = ev.data;
      if (typeof raw !== 'string') {
        try { raw = new TextDecoder().decode(raw); } catch (e) { return; }
      }
      var d;
      try { d = JSON.parse(raw); } catch (e) { return; }
      try { handlePeerData(d, !!state.isHost, conn); } catch (e2) { console.warn(e2); }
    };
    return conn;
  }
  function showRtcExchangeOverlay() {
    var ov = document.getElementById('rtc-exchange-overlay');
    if (!ov) return;
    ov.classList.remove('hidden');
    ov.style.display = 'flex';
  }
  function hideRtcExchangeOverlay() {
    var ov = document.getElementById('rtc-exchange-overlay');
    if (!ov) return;
    ov.classList.add('hidden');
    ov.style.display = 'none';
  }
  function resetRtcExchangeUi() {
    ['rtc-ex-host-offer-block','rtc-ex-host-answer-block','rtc-ex-join-offer-block','rtc-ex-join-answer-block'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    ['rtc-ex-host-offer','rtc-ex-host-answer','rtc-ex-join-offer','rtc-ex-join-answer'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var st = document.getElementById('rtc-ex-status');
    if (st) st.textContent = '';
    var addBtn = document.getElementById('rtc-ex-add-player');
    if (addBtn) addBtn.classList.add('hidden');
  }
  function cleanupManualRtcPending() {
    try {
      if (state._rtcPendingConn && !state._rtcPendingConn.open) {
        try { if (state._rtcDc) state._rtcDc.close(); } catch (e) {}
        try { if (state._rtcPc) state._rtcPc.close(); } catch (e) {}
      }
    } catch (e) {}
    state._rtcPc = null;
    state._rtcDc = null;
    state._rtcPendingConn = null;
  }
  function cleanupManualRtc() {
    cleanupManualRtcPending();
    try {
      (state._rtcHostsPcs || []).forEach(function (slot) {
        try { if (slot.dc) slot.dc.close(); } catch (e) {}
        try { if (slot.pc) slot.pc.close(); } catch (e) {}
      });
    } catch (e) {}
    state._rtcHostsPcs = [];
    try {
      if (!state.isHost && state.connection && state.connection._pc) {
        try { state.connection._dc && state.connection._dc.close(); } catch (e) {}
        try { state.connection._pc.close(); } catch (e) {}
      }
    } catch (e) {}
  }

  function onManualRtcConnected(conn, pc, dc) {
    try { if (pc) voiceAttachToPc(pc); } catch (eVc) {}
    state.useManualRtc = true;
    state.usePeerCodes = false;
    state.useLan = false;
    state.useFirebase = false;
    state.playType = 'online';
    if (state.isHost) {
      if (!state.connections) state.connections = [];
      if (state.connections.indexOf(conn) < 0) state.connections.push(conn);
      state.connection = conn;
      state.player2Joined = state.connections.length > 0;
      if (pc && dc) {
        state._rtcHostsPcs = state._rtcHostsPcs || [];
        state._rtcHostsPcs.push({ pc: pc, dc: dc, conn: conn });
      }
      state._rtcPc = null;
      state._rtcDc = null;
      state._rtcPendingConn = null;
      var n = state.connections.length;
      var maxJ = rtcMaxJoiners();
      toast('✓ اتصل لاعب (' + n + '/' + maxJ + ')', 'success');
      try { startPeerPingLoop(); } catch (e) {}
      hideRtcExchangeOverlay();
      // بناء مشترك: متخشش اللوبي ولا ملابس — على طول وضع البناء
      if (state._rtcPurpose === 'build' || state.buildCollabOnline) {
        state.buildCollabOnline = true;
        state.buildCollab = true;
        // ابعت الشامل للمنضم فور الاتصال
        try {
          if (state._buildPackReady) sendBuildSnapshotFull();
        } catch (eP) {}
        try { enterBuildCollabSession(); } catch (eB) { console.warn(eB); }
        return;
      }
      try { renderNetLobbyList(); } catch (e) {}
      revealRtcLobbyAfterConnect();
      if (n >= maxJ) {
        toast('وصلتم للحد الأقصى من اللاعبين', 'info');
      } else {
        ensureRtcAddPlayerLobbyButton();
      }
      var bs = document.getElementById('btn-start-game');
      if (bs) {
        bs.disabled = false;
        bs.textContent = '▶ بدء اللعب';
      }
    } else {
      state.connection = conn;
      state.connections = [];
      hideRtcExchangeOverlay();
      try { startPeerPingLoop(); } catch (e) {}
      if (state._rtcPurpose === 'build' || state.buildCollabOnline) {
        state.buildCollabOnline = true;
        state.buildCollab = true;
        try {
          conn.send({
            type: 'join',
            purpose: 'build',
            name: state.playerName || 'لاعب',
            avatar: getNetAvatar()
          });
        } catch (e) {}
        try { enterBuildCollabSession(); } catch (eB) { console.warn(eB); }
        return;
      }
      revealRtcLobbyAfterConnect();
      try { readCustomFromUI && readCustomFromUI(0); } catch (e) {}
      try {
        conn.send({
          type: 'join',
          custom: (typeof playerCustom !== 'undefined' ? playerCustom[0] : null),
          name: state.playerName || 'لاعب',
          avatar: getNetAvatar()
        });
      } catch (e) {}
      toast('✓ اتصلت بالقائد — انت في اللوبي كمنضم', 'success');
      var bs2 = document.getElementById('btn-start-game');
      if (bs2) {
        bs2.disabled = true;
        bs2.textContent = '⏳ في انتظار القائد يبدأ';
      }
    }
  }

  function ensureRtcAddPlayerLobbyButton() {
    if (!state.isHost || !state.useManualRtc) return;
    var box = document.querySelector('#lobby-screen .menu-buttons') || document.querySelector('#lobby-screen .lobby-box') || document.getElementById('lobby-screen');
    if (!box) return;
    var old = document.getElementById('btn-rtc-add-player');
    if (old) old.remove();
    var n = (state.connections || []).length;
    var maxJ = rtcMaxJoiners();
    if (n >= maxJ) return;
    var btn = document.createElement('button');
    btn.id = 'btn-rtc-add-player';
    btn.type = 'button';
    btn.className = 'btn btn-accent';
    btn.style.cssText = 'width:100%;margin-top:8px;background:linear-gradient(135deg,#a855f7,#7c3aed)';
    btn.textContent = '🔗 إضافة لاعب (' + n + '/' + maxJ + ') — توليد كود جديد';
    btn.onclick = function () {
      hostInviteNextPlayer();
    };
    // حط قبل زرار البدء لو موجود
    var startBtn = document.getElementById('btn-start-game');
    if (startBtn && startBtn.parentNode) {
      startBtn.parentNode.insertBefore(btn, startBtn);
    } else {
      box.appendChild(btn);
    }
  }

  function prepareManualRtcLobbyShell(isHost, code, opts) {
    opts = opts || {};
    var showLobbyNow = !!opts.showLobby;
    state.playType = 'online';
    state.isHost = isHost;
    state.roomCode = code;
    state.useLan = false;
    state.useFirebase = false;
    state.usePeerCodes = false;
    state.useManualRtc = true;
    state.player2Joined = !!(state.connections && state.connections.length);
    if (isHost) {
      if (!state.connections) state.connections = [];
    } else {
      state.connections = [];
      state.connection = null;
    }
    state.netRoster = state.netRoster || [];
    if (isHost) {
      state.myNetId = 'host_' + code;
      var hasHost = state.netRoster.some(function (r) { return r && r.isHost; });
      if (!hasHost) {
        state.netRoster = [{
          id: state.myNetId,
          name: state.playerName || 'القائد',
          isHost: true,
          custom: (typeof playerCustom !== 'undefined' ? playerCustom[0] : null),
          avatar: getNetAvatar()
        }];
      }
    } else {
      state.myNetId = null;
      state.netRoster = [];
    }
    try { clearRemoteMeshes(); } catch (e) {}

    // جهّز نصوص اللوبي (هيتعرض بعد الاتصال فقط)
    var roleBadge = isHost ? '👑 القائد' : '🎮 المنضم';
    document.getElementById('lobby-title').textContent = isHost
      ? '👑 لوبي القائد — ' + (state.maxNetPlayers || 8) + ' لاعبين'
      : '🎮 لوبي المنضم — في انتظار القائد';
    var lcd = document.getElementById('lobby-code-display');
    if (lcd) {
      lcd.style.display = 'block';
      lcd.textContent = roleBadge + '  |  الرمز: ' + code + '  |  WebRTC';
    }
    var gh = document.getElementById('gamepad-hint');
    if (gh) {
      gh.textContent = isHost
        ? 'أنت القائد: اختار اللفل وابدأ لما الكل يتصل. تقدر تضيف لاعبين لحد ' + (state.maxNetPlayers || 8)
        : 'أنت منضم: عدّل ملابسك فقط — بدء اللعب من القائد';
    }
    var bs = document.getElementById('btn-start-game');
    if (isHost) {
      if (bs) {
        bs.disabled = !(state.connections && state.connections.length);
        bs.textContent = (state.connections && state.connections.length) ? '▶ بدء اللعب' : 'انتظر لاعبين...';
        bs.style.display = '';
      }
    } else {
      if (bs) {
        bs.disabled = true;
        bs.textContent = '⏳ في انتظار القائد يبدأ';
        bs.style.display = '';
      }
    }
    try { configureCustomUIForMode(); } catch (e) {}
    var levelBox = document.querySelector('.level-select-box');
    if (!isHost) {
      if (levelBox) levelBox.style.display = 'none';
    } else if (levelBox) levelBox.style.display = '';

    // مهم: متظهرش اللوبي ورا شاشة الأكواد
    if (showLobbyNow) {
      try { renderNetLobbyList(); } catch (e) {}
      showScreen('lobby');
    } else {
      // خلفية نظيفة أثناء التبادل — من غير لوبي
      try {
        document.querySelectorAll('.screen').forEach(function (s) {
          if (s.id !== 'rtc-exchange-overlay') s.classList.add('hidden');
        });
      } catch (e) {}
      // سيّب قائمة الإنشاء/الانضمام مخفية
      try {
        var menu = document.getElementById('main-menu') || document.getElementById('menu-screen');
        // hide lobby explicitly
        var lob = document.getElementById('lobby-screen');
        if (lob) lob.classList.add('hidden');
        var cr = document.getElementById('create-room');
        if (cr) cr.classList.add('hidden');
        var jr = document.getElementById('join-room');
        if (jr) jr.classList.add('hidden');
        var hub = document.getElementById('online-hub');
        if (hub) hub.classList.add('hidden');
      } catch (e2) {}
    }
  }

  function revealRtcLobbyAfterConnect() {
    // بناء مشترك: متفتحش لوبي اللعب/الملابس
    if (state._rtcPurpose === 'build' || state.buildCollabOnline) {
      try { enterBuildCollabSession(); } catch (e) {}
      return;
    }
    try { renderNetLobbyList(); } catch (e) {}
    showScreen('lobby');
    try { startPeerPingLoop(); } catch (e) {}
    try { updatePingHud(state.netPing || 1); } catch (e) {}
    try { ensureRtcAddPlayerLobbyButton(); } catch (e) {}
    // شارة دور واضحة فوق
    try {
      var lcd = document.getElementById('lobby-code-display');
      if (lcd) {
        lcd.style.display = 'block';
        lcd.innerHTML = state.isHost
          ? '<span style="color:#fbbf24">👑 أنت القائد</span> — الرمز: <strong>' + (state.roomCode || '') + '</strong> — لاعبين: ' + ((state.netRoster && state.netRoster.length) || 1) + '/' + (state.maxNetPlayers || 8)
          : '<span style="color:#67e8f9">🎮 أنت منضم</span> — الرمز: <strong>' + (state.roomCode || '') + '</strong> — بانتظار بدء القائد';
      }
      var title = document.getElementById('lobby-title');
      if (title) {
        title.textContent = state.isHost
          ? '👑 لوبي القائد'
          : '🎮 لوبي المنضم';
        title.style.color = state.isHost ? '#fbbf24' : '#67e8f9';
      }
    } catch (e3) {}
  }

  async function hostCreateOfferInvite() {
    cleanupManualRtcPending();
    var st = document.getElementById('rtc-ex-status');
    var n = (state.connections || []).length;
    var maxJ = rtcMaxJoiners();
    if (n >= maxJ) {
      toast('وصلت للحد الأقصى من اللاعبين', 'error');
      return;
    }
    if (st) st.textContent = 'جاري توليد كود العرض بسرعة...';
    try {
      // المايك قبل الـ offer عشان يدخل في الـ SDP اتجاهين
      try { await voiceEnsureMicFast(2000); } catch (eM) {}
      var pc = rtcMakePc({ offerSide: true, iceTransportPolicy: state._rtcPreferRelay ? 'relay' : 'all' });
      state._rtcPc = pc;
      try { await rtcBindLocalMicToPc(pc); } catch (eT) {}
      var dc = pc.createDataChannel('sm_game', { ordered: true });
      state._rtcDc = dc;
      var conn = rtcWrapDc(dc, pc, 'host');
      state._rtcPendingConn = conn;
      rtcForceAudioSendRecv(pc);
      var offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);
      rtcForceAudioSendRecv(pc);
      await rtcWaitIce(pc, 7000);
      var sdp = pc.localDescription && pc.localDescription.sdp;
      var encoded = rtcEncodeSdp(sdp, 'offer');
      var ta = document.getElementById('rtc-ex-host-offer');
      if (ta) ta.value = encoded;
      var ans = document.getElementById('rtc-ex-host-answer');
      if (ans) ans.value = '';
      if (st) st.textContent = '✓ كود العرض جاهز للاعب ' + (n + 2) + ' — الطول: ' + encoded.length + ' حرف (متصل حالياً: ' + n + '/' + maxJ + ')';
      toast('كود العرض جاهز — ابعتُه للمنضم الجديد', 'success');
    } catch (err) {
      console.warn(err);
      if (st) st.textContent = 'فشل توليد الكود';
      toast('فشل إنشاء عرض WebRTC', 'error');
    }
  }

  async function startManualRtcAsHost(code) {
    // على https (GitHub Pages) فضّل TURN من الأول
    try {
      if (typeof location !== 'undefined' && location.protocol === 'https:' && !state._rtcPreferRelay) {
        state._rtcPreferRelay = true;
      }
    } catch (ePref) {}
    // أول مرة: امسح كل حاجة وابدأ من صفر
    cleanupManualRtc();
    state.connections = [];
    state._rtcHostsPcs = [];
    resetRtcExchangeUi();
    prepareManualRtcLobbyShell(true, code);
    showRtcExchangeOverlay();
    var title = document.getElementById('rtc-ex-title');
    var desc = document.getElementById('rtc-ex-desc');
    if (title) title.innerHTML = '👑 أنت <span style="color:#fbbf24">القائد</span> — دعوة لاعب';
    if (desc) desc.innerHTML = '<strong style="color:#fbbf24">دورك: القائد</strong><br>ابعت كود العرض للمنضم، واستقبل منه كود الرد.<br>اللوبي هيفتح <strong>بعد</strong> ما الاتصال ينجح — مش دلوقتي.<br>نفس الشبكة أو Radmin.';
    var chip = document.getElementById('rtc-ex-role-chip');
    if (chip) {
      chip.textContent = '👑 دورك: القائد';
      chip.style.background = 'rgba(251,191,36,0.18)';
      chip.style.color = '#fbbf24';
      chip.style.borderColor = 'rgba(251,191,36,0.5)';
    }
    document.getElementById('rtc-ex-host-offer-block').classList.remove('hidden');
    document.getElementById('rtc-ex-host-answer-block').classList.remove('hidden');
    await hostCreateOfferInvite();
  }

  async function hostInviteNextPlayer() {
    var n = (state.connections || []).length;
    var maxJ = rtcMaxJoiners();
    if (n >= maxJ) {
      toast('وصلت للحد الأقصى', 'error');
      return;
    }
    resetRtcExchangeUi();
    showRtcExchangeOverlay();
    var title = document.getElementById('rtc-ex-title');
    var desc = document.getElementById('rtc-ex-desc');
    if (title) title.innerHTML = '👑 القائد — إضافة لاعب ' + (n + 2);
    if (desc) desc.innerHTML = '<strong style="color:#fbbf24">دعوة إضافية</strong><br>كود عرض <strong>جديد</strong> للمنضم الجديد فقط. اللي اتصلوا قبل كده لسه في اللوبي.';
    document.getElementById('rtc-ex-host-offer-block').classList.remove('hidden');
    document.getElementById('rtc-ex-host-answer-block').classList.remove('hidden');
    await hostCreateOfferInvite();
  }

  async function hostApplyAnswerCode() {
    var ta = document.getElementById('rtc-ex-host-answer');
    var code = ta ? ta.value.trim() : '';
    var st = document.getElementById('rtc-ex-status');
    if (!code) { toast('الصق كود الرد أولًا', 'error'); return; }
    if (!state._rtcPc) { toast('مفيش دعوة مفتوحة — اضغط إضافة لاعب', 'error'); return; }
    try {
      if (st) st.textContent = 'جاري تطبيق كود الرد...';
      var sdp = rtcDecodeSdp(code, 'answer');
      await state._rtcPc.setRemoteDescription({ type: 'answer', sdp: sdp });
      try { await rtcBindLocalMicToPc(state._rtcPc); } catch (eBind) {}
      try { voiceForceSendTrack(); voiceUnlockRemotePlayback(); } catch (eHV) {}
      if (st) st.textContent = 'تم تطبيق الرد — جاري الاتصال (حتى 25 ثانية)...';
      toast('تم لصق كود الرد — انتظر الاتصال', 'info');
      var pc = state._rtcPc;
      var dc = state._rtcDc;
      var ok = await rtcWatchUntilConnected(pc, dc, 25000);
      if (ok) {
        if (state._rtcPendingConn && !state._rtcPendingConn._connectedFired) {
          state._rtcPendingConn.open = true;
          try { onManualRtcConnected(state._rtcPendingConn, pc, dc); } catch (eC) {}
        }
      } else {
        var ice = pc ? pc.iceConnectionState : '?';
        var cs = pc ? pc.connectionState : '?';
        if (st) {
          st.textContent = 'فشل الاتصال (ICE=' + ice + ' / ' + cs + '). أعد توليد الأكواد كملف txt والاتنين على نفس Radmin.';
        }
        state._rtcPreferRelay = true;
        if (st) {
          st.innerHTML = 'فشل ICE. جرّب:<br>1) اضغط «إعادة توليد عبر TURN» بالتحت<br>2) ابعت الأكواد كملف txt (مش نسخ شات)<br>3) أو الاتنين على Radmin ثم أعد التوليد';
        }
        toast('فشل ICE — افتح من OPEN_GAME.bat وأعد الأكواد بوضع TURN', 'error');
        try { ensureRtcRelayRetryButton(); } catch (eBtn) {}
      }
    } catch (err) {
      console.warn(err);
      var msg = (err && err.message) ? err.message : String(err);
      if (st) st.textContent = 'فشل: ' + msg;
      toast(msg || 'كود الرد مش صالح أو مش مكتمل', 'error');
    }
  }

  function ensureRtcRelayRetryButton() {
    var ov = document.getElementById('rtc-exchange-overlay');
    if (!ov) return;
    var old = document.getElementById('rtc-ex-retry-relay');
    if (old) old.remove();
    var btn = document.createElement('button');
    btn.id = 'rtc-ex-retry-relay';
    btn.type = 'button';
    btn.className = 'btn btn-accent';
    btn.style.cssText = 'width:100%;margin-top:8px;background:linear-gradient(135deg,#f59e0b,#d97706)';
    btn.textContent = '🔁 إعادة توليد الأكواد عبر TURN (Relay)';
    btn.onclick = async function () {
      state._rtcPreferRelay = true;
      toast('وضع TURN مفعّل — هيتولد كود جديد', 'info');
      if (state.isHost) {
        await hostCreateOfferInvite();
      } else {
        toast('القائد لازم يولد كود عرض جديد أولاً، وبعدين تلصقُه هنا', 'info');
      }
    };
    var cancel = document.getElementById('rtc-ex-cancel');
    if (cancel && cancel.parentNode) cancel.parentNode.insertBefore(btn, cancel);
    else ov.appendChild(btn);
  }

  async function startManualRtcAsJoiner(code) {
    try {
      if (typeof location !== 'undefined' && location.protocol === 'https:' && !state._rtcPreferRelay) {
        state._rtcPreferRelay = true;
      }
    } catch (ePref) {}
    cleanupManualRtc();
    resetRtcExchangeUi();
    prepareManualRtcLobbyShell(false, code);
    showRtcExchangeOverlay();
    var title = document.getElementById('rtc-ex-title');
    var desc = document.getElementById('rtc-ex-desc');
    if (title) title.innerHTML = '🎮 أنت <span style="color:#67e8f9">منضم</span> — تبادل الأكواد';
    if (desc) desc.innerHTML = '<strong style="color:#67e8f9">دورك: منضم</strong><br>الصق كود العرض من القائد، وابعته كود الرد.<br>اللوبي هيفتح <strong>بعد</strong> الاتصال — مش هتشوف شاشة القائد دلوقتي.';
    var chip2 = document.getElementById('rtc-ex-role-chip');
    if (chip2) {
      chip2.textContent = '🎮 دورك: منضم';
      chip2.style.background = 'rgba(103,232,249,0.15)';
      chip2.style.color = '#67e8f9';
      chip2.style.borderColor = 'rgba(103,232,249,0.45)';
    }
    document.getElementById('rtc-ex-join-offer-block').classList.remove('hidden');
    var st = document.getElementById('rtc-ex-status');
    if (st) st.textContent = 'الصق كود العرض من القائد';
  }

  async function joinerMakeAnswerFromOffer() {
    var ta = document.getElementById('rtc-ex-join-offer');
    var offerCode = ta ? ta.value.trim() : '';
    var st = document.getElementById('rtc-ex-status');
    if (!offerCode) { toast('الصق كود العرض أولًا', 'error'); return; }
    try {
      if (st) st.textContent = 'جاري توليد كود الرد (ثواني)...';
      cleanupManualRtc();
      var pc = rtcMakePc({ offerSide: false, iceTransportPolicy: state._rtcPreferRelay ? 'relay' : 'all' });
      state._rtcPc = pc;
      pc.ondatachannel = function (ev) {
        var dc = ev.channel;
        state._rtcDc = dc;
        var conn = rtcWrapDc(dc, pc, 'joiner');
        state.connection = conn;
      };
      var sdp = rtcDecodeSdp(offerCode, 'offer');
      await pc.setRemoteDescription({ type: 'offer', sdp: sdp });
      // مهم: المايك + sendrecv قبل createAnswer عشان يدخل في SDP (اتجاهين)
      try { await voiceEnsureMicFast(2500); } catch (eM) {}
      try { await rtcBindLocalMicToPc(pc); } catch (ePre) {}
      rtcForceAudioSendRecv(pc);
      var answer = await pc.createAnswer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(answer);
      await rtcWaitIce(pc, 7000);
      try { await rtcBindLocalMicToPc(pc); } catch (eB2) {}
      try { voiceForceSendTrack(); voiceUnlockRemotePlayback(); } catch (eV) {}
      // التراك مربوط في الـ SDP — يبدأ مطفي لحد ما يدوس B
      try {
        var t2 = voiceGetAudioTrack();
        if (t2) t2.enabled = false;
        state.voice.enabled = false;
        try { updateMicHud(); } catch (eH) {}
      } catch (e3) {}
      var ansSdp = pc.localDescription && pc.localDescription.sdp;
      var encoded = rtcEncodeSdp(ansSdp, 'answer');
      document.getElementById('rtc-ex-join-answer-block').classList.remove('hidden');
      var out = document.getElementById('rtc-ex-join-answer');
      if (out) out.value = encoded;
      if (st) st.textContent = '✓ كود الرد جاهز — ابعتُه للقائد كملف txt (الطول: ' + encoded.length + ') — وبانتظر الاتصال...';
      toast('كود الرد جاهز — ابعت الملف للقائد ولا تقفل الصفحة', 'success');
      // راقب الاتصال عند المنضم كمان
      try {
        rtcWatchUntilConnected(pc, state._rtcDc, 30000).then(function (ok) {
          if (ok) {
            if (state.connection && !state.connection._connectedFired) {
              state.connection.open = true;
              try { onManualRtcConnected(state.connection, pc, state._rtcDc); } catch (e) {}
            }
          } else if (st) {
            st.textContent = 'لسه مفيش اتصال — تأكد إن القائد لصق كود الرد وإن Radmin شغال';
          }
        });
      } catch (eW) {}
    } catch (err) {
      console.warn(err);
      var msg = (err && err.message) ? err.message : String(err);
      if (st) st.textContent = 'فشل: ' + msg;
      toast(msg || 'كود العرض مش صالح أو مش مكتمل', 'error');
    }
  }

  // Wire overlay buttons once
  (function wireRtcUi() {
    var c1 = document.getElementById('rtc-ex-copy-offer');
    if (c1) c1.onclick = function () {
      var ta = document.getElementById('rtc-ex-host-offer');
      if (!ta || !ta.value) return;
      try {
        navigator.clipboard.writeText(ta.value).then(function () { toast('تم نسخ كود العرض', 'success'); });
      } catch (e) {
        ta.select();
        try { document.execCommand('copy'); toast('تم النسخ', 'success'); } catch (e2) {}
      }
    };
    var d1 = document.getElementById('rtc-ex-dl-offer');
    if (d1) d1.onclick = function () {
      var ta = document.getElementById('rtc-ex-host-offer');
      if (!ta || !ta.value) return;
      rtcDownloadCode(ta.value, 'sm-offer-code.txt');
    };
    var c2 = document.getElementById('rtc-ex-copy-answer');
    if (c2) c2.onclick = function () {
      var ta = document.getElementById('rtc-ex-join-answer');
      if (!ta || !ta.value) return;
      try {
        navigator.clipboard.writeText(ta.value).then(function () { toast('تم نسخ كود الرد', 'success'); });
      } catch (e) {
        ta.select();
        try { document.execCommand('copy'); toast('تم النسخ', 'success'); } catch (e2) {}
      }
    };
    var d2 = document.getElementById('rtc-ex-dl-answer');
    if (d2) d2.onclick = function () {
      var ta = document.getElementById('rtc-ex-join-answer');
      if (!ta || !ta.value) return;
      rtcDownloadCode(ta.value, 'sm-answer-code.txt');
    };
    var upOffer = document.getElementById('rtc-ex-upload-offer');
    var upOfferInp = document.getElementById('rtc-ex-upload-offer-input');
    if (upOffer && upOfferInp) {
      upOffer.onclick = function () { upOfferInp.click(); };
      upOfferInp.onchange = function () { rtcLoadCodeFromFile(upOfferInp, 'rtc-ex-join-offer'); };
    }
    var upAns = document.getElementById('rtc-ex-upload-answer');
    var upAnsInp = document.getElementById('rtc-ex-upload-answer-input');
    if (upAns && upAnsInp) {
      upAns.onclick = function () { upAnsInp.click(); };
      upAnsInp.onchange = function () { rtcLoadCodeFromFile(upAnsInp, 'rtc-ex-host-answer'); };
    };
    var a1 = document.getElementById('rtc-ex-apply-answer');
    if (a1) a1.onclick = function () { hostApplyAnswerCode(); };
    var a2 = document.getElementById('rtc-ex-make-answer');
    if (a2) a2.onclick = function () { joinerMakeAnswerFromOffer(); };
    var cancel = document.getElementById('rtc-ex-cancel');
    if (cancel) cancel.onclick = function () {
      // إلغاء الدعوة الحالية فقط لو في ناس متصلين؛ لو مفيش اخرج من الوضع
      var hasPeers = state.isHost && state.connections && state.connections.length > 0;
      cleanupManualRtcPending();
      hideRtcExchangeOverlay();
      if (hasPeers) {
        ensureRtcAddPlayerLobbyButton();
        toast('تم إلغاء الدعوة الحالية — اللاعبين المتصلين لسه موجودين', 'info');
      } else {
        cleanupManualRtc();
        state.useManualRtc = false;
        showScreen('menu');
        showUI('online-hub');
        toast('تم إلغاء تبادل الأكواد', 'info');
      }
    };
  })();

  function setupOnlineLobby(isHost, code) {

    state.playType = 'online';
    state.isHost = isHost;
    state.roomCode = code;
    state.useLan = false;
    state.useFirebase = false;
    state.usePeerCodes = true;
    state.player2Joined = !isHost;
    state.connections = [];
    state.connection = null;
    state.netRoster = [];
    state.myNetId = isHost ? ('host_' + code) : null;
    clearRemoteMeshes();

    document.getElementById('lobby-title').textContent = isHost ? '⚔️ لوبي القائد (تبادل الأكواد)' : '⚔️ لوبي المنضم (تبادل الأكواد)';
    document.getElementById('lobby-code-display').style.display = 'block';
    document.getElementById('lobby-code-display').textContent = 'الرمز: ' + code + '  |  تبادل الأكواد';
    document.getElementById('gamepad-hint').textContent = isHost
      ? 'بانتظار اللاعبين... يمكن انضمام حتى ' + state.maxNetPlayers
      : 'جاري الاتصال...';

    if (isHost) {
      state.netRoster = [{
        id: state.myNetId,
        name: state.playerName || 'القائد',
        isHost: true,
        custom: (typeof playerCustom !== 'undefined' ? playerCustom[0] : null),
        avatar: getNetAvatar()
      }];
      document.getElementById('btn-start-game').disabled = true;
      document.getElementById('btn-start-game').textContent = 'انتظر لاعبين...';
    } else {
      document.getElementById('btn-start-game').disabled = true;
      document.getElementById('btn-start-game').textContent = 'في انتظار القائد...';
    }
    renderNetLobbyList();
    configureCustomUIForMode();
    // Joiner: clothes only — no level control
    var levelBox = document.querySelector('.level-select-box');
    if (!isHost) {
      if (levelBox) levelBox.style.display = 'none';
      toast('تعدّل ملابسك فقط — اختيار اللفل للقائد', 'info');
    } else {
      if (levelBox) levelBox.style.display = '';
    }

    try {
      if (state.peer) { try { state.peer.destroy(); } catch (e) {} }
      var peerId = isHost ? ('sm_' + code) : undefined;
      showSyncLoading(isHost ? 'جاري فتح اللوبي...' : 'جاري الاتصال بالمضيف...');
      // PeerJS: signaling عبر الخدمة العامة، والبيانات P2P مباشرة (LAN/Radmin أفضل)
      // من غير إنترنت للإشارة الاتصال قد يفشل — بعد الاتصال الحركة تفضل P2P
      state.peer = new Peer(peerId, {
        debug: 0,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });
      state.peer.on('open', function (id) {
        startPeerPingLoop();
        updatePingHud(state.netPing || 1);
        if (isHost) {
          hideSyncLoading();
          toast('اللوبي جاهز: ' + code + ' — ابعت الرمز لصحابك', 'success');
        } else {
          var conn = state.peer.connect('sm_' + code, { reliable: true });
          state.connection = conn;
          conn.on('open', function () {
            hideSyncLoading();
            try { readCustomFromUI && readCustomFromUI(0); } catch (e) {}
            try {
              conn.send({
                type: 'join',
                custom: (typeof playerCustom !== 'undefined' ? playerCustom[0] : null),
                name: state.playerName || 'لاعب',
                avatar: getNetAvatar()
              });
            } catch (e) {}
            toast('انضممت للوبي', 'success');
            startPeerPingLoop();
          });
          conn.on('data', function (d) { handlePeerData(d, false, conn); });
          conn.on('close', function () {
            toast('انقطع الاتصال بالمضيف', 'error');
            hideSyncLoading();
          });
        }
      });
      if (isHost) {
        state.peer.on('connection', function (conn) {
          state.connections.push(conn);
          // keep last connection ref for compatibility
          state.connection = conn;
          conn.on('open', function () {
            startPeerPingLoop();
          });
          conn.on('data', function (d) { handlePeerData(d, true, conn); });
          conn.on('close', function () {
            var leftId = conn._netId;
            state.connections = state.connections.filter(function (c) { return c !== conn; });
            if (leftId) {
              state.netRoster = (state.netRoster || []).filter(function (r) { return r.id !== leftId; });
              if (state.remoteMeshes[leftId]) {
                scene.remove(state.remoteMeshes[leftId]);
                delete state.remoteMeshes[leftId];
              }
              broadcastToAll({ type: 'leave', id: leftId });
              renderNetLobbyList();
              toast('لاعب خرج', 'info');
            }
            state.player2Joined = state.connections.length > 0;
            if (state.connections.length === 0) {
              document.getElementById('btn-start-game').disabled = true;
              document.getElementById('btn-start-game').textContent = 'انتظر لاعبين...';
            }
          });
        });
      }
      state.peer.on('error', function (err) {
        console.warn(err);
        hideSyncLoading();
        toast('فشل الاتصال — تأكد من الرمز وأن الاتنين فاتحين اللعبة ومتصلين', 'error');
      });
    } catch (e) {
      hideSyncLoading();
      toast('PeerJS غير متاح', 'error');
    }
    showScreen('lobby');
  }

  // ===== Create / Join: رفع ZIP + LAN بدون إنترنت =====
  var createZipReady = false;
  var joinZipReady = false;
  var createUploadInput = document.getElementById('create-upload-input');
  var joinUploadInput = document.getElementById('join-upload-input');
  var createPackStatus = document.getElementById('create-pack-status');
  var joinUploadStatus = document.getElementById('join-upload-status');

  var btnCreatePick = document.getElementById('btn-create-pick-zip');
  if (btnCreatePick && createUploadInput) {
    btnCreatePick.onclick = function () { createUploadInput.click(); };
  }
  if (createUploadInput) {
    createUploadInput.onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) { createZipReady = false; if (createPackStatus) createPackStatus.textContent = ''; return; }
      if (createPackStatus) createPackStatus.textContent = 'جاري قراءة «' + f.name + '» ...';
      uploadComprehensiveZip(f, function (ok, count) {
        createZipReady = !!ok;
        if (ok) {
          if (createPackStatus) createPackStatus.textContent = '✓ تم التعرف على الملف — ' + (count || 0) + ' لفل';
          toast('تم التعرف على الملف', 'success');
        } else {
          if (createPackStatus) createPackStatus.textContent = 'فشل قراءة الملف';
          toast('لم يتم التعرف على الملف', 'error');
        }
      });
    };
  }

  var btnJoinPick = document.getElementById('btn-join-pick-zip');
  if (btnJoinPick && joinUploadInput) {
    btnJoinPick.onclick = function () { joinUploadInput.click(); };
  }
  if (joinUploadInput) {
    joinUploadInput.onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) { joinZipReady = false; if (joinUploadStatus) joinUploadStatus.textContent = ''; return; }
      if (joinUploadStatus) joinUploadStatus.textContent = 'جاري قراءة «' + f.name + '» ...';
      uploadComprehensiveZip(f, function (ok, count) {
        joinZipReady = !!ok;
        if (ok) {
          if (joinUploadStatus) joinUploadStatus.textContent = '✓ تم التعرف على الملف — ' + (count || 0) + ' لفل';
          toast('تم التعرف على الملف', 'success');
        } else {
          if (joinUploadStatus) joinUploadStatus.textContent = 'فشل قراءة الملف';
          toast('لم يتم التعرف على الملف', 'error');
        }
      });
    };
  }

  
  function setupFirebaseLobby(isHost, code) {
    state.playType = 'online';
    state.useLan = false;
    state.useFirebase = true;
    state.isHost = isHost;
    state.roomCode = code;
    state.lanIp = null;
    state.player2Joined = !isHost;
    state.connections = [];
    state.connection = null;
    state.myNetId = isHost ? ('host_' + code) : ('p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
    state.netRoster = isHost ? [{
      id: state.myNetId,
      name: state.playerName || 'القائد',
      isHost: true,
      custom: (typeof playerCustom !== 'undefined' ? playerCustom[0] : null),
      avatar: getNetAvatar()
    }] : [];
    clearRemoteMeshes();
    try { stopLanPoll(); } catch (e) {}
    try { fbStopListening(); } catch (e) {}
    fbStartListening(code);

    if (isHost) {
      try {
        fbRoomRef(code).child('meta').set({
          host: state.playerName || 'القائد',
          hostId: state.myNetId,
          created: Date.now(),
          playing: false
        });
      } catch (e) {}
      // أعلن وجود الهوست
      try {
        fbSend({ type: 'hostbeat', isHost: true, id: state.myNetId, name: state.playerName || 'القائد', players: 1 });
      } catch (e) {}
    }

    var title = document.getElementById('lobby-title');
    if (title) title.textContent = isHost ? '⚔️ لوبي القائد (Firebase)' : '⚔️ لوبي المنضم (Firebase)';
    var codeDisp = document.getElementById('lobby-code-display');
    if (codeDisp) {
      codeDisp.style.display = 'block';
      codeDisp.textContent = 'كود الروم: ' + code + '  |  Firebase رومات';
    }
    var hint = document.getElementById('gamepad-hint');
    if (hint) {
      hint.textContent = isHost
        ? 'روم Firebase جاهز — شارك الكود: ' + code
        : 'جاري الانضمام لروم Firebase...';
    }

    var levelBox = document.querySelector('.level-select-box');
    var startBtn = document.getElementById('btn-start-game');
    if (!isHost) {
      if (levelBox) levelBox.style.display = 'none';
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.textContent = 'في انتظار القائد...';
      }
    } else {
      if (levelBox) levelBox.style.display = '';
      if (startBtn) {
        // الهوست يقدر يبدأ حتى لو لوحده (تست) أو بعد انضمام لاعبين
        startBtn.disabled = false;
        startBtn.textContent = '▶ START GAME';
      }
    }

    try { if (lobbyScreen) lobbyScreen.classList.add('online-lobby'); } catch (e) {}
    try { configureCustomUIForMode(); } catch (e) {}
    try { renderNetLobbyList(); } catch (e) {}
    showScreen('lobby');

    if (!isHost) {
      var sendJoin = function () {
        try { if (typeof readCustomFromUI === 'function') readCustomFromUI(0); } catch (e) {}
        fbSend({
          type: 'join',
          clientId: state.myNetId,
          name: state.playerName || 'لاعب',
          custom: (typeof playerCustom !== 'undefined' ? playerCustom[0] : null),
          avatar: getNetAvatar()
        });
      };
      setTimeout(sendJoin, 200);
      setTimeout(sendJoin, 800);
      setTimeout(sendJoin, 1800);
    }

    toast(isHost ? ('روم Firebase: ' + code + ' — جاهز') : ('انضممت للروم: ' + code), 'success');
  }

  function setupLanLobby(isHost, code, ip) {
    state.playType = 'online';
    state.useLan = true;
    state.isHost = isHost;
    state.roomCode = code;
    state.lanIp = ip;
    state.player2Joined = !isHost;
    state.connections = [];
    state.connection = null;
    state.myNetId = isHost ? ('host_' + code) : ('p_' + Date.now().toString(36));
    state.netRoster = isHost ? [{
      id: state.myNetId,
      name: state.playerName || 'القائد',
      isHost: true,
      custom: (typeof playerCustom !== 'undefined' ? playerCustom[0] : null),
      avatar: getNetAvatar()
    }] : [];
    state._lanJoinedAt = Date.now();
    state._lanDeadStreak = 0;
    state._lanMissingStreak = 0;
    state._hostBeatTimer = 0;
    clearRemoteMeshes();
    stopLanPoll();

    document.getElementById('lobby-title').textContent = isHost ? '⚔️ لوبي القائد (LAN)' : '⚔️ لوبي المنضم (LAN)';
    document.getElementById('lobby-code-display').style.display = 'block';
    document.getElementById('lobby-code-display').textContent = 'الرمز: ' + code + ' | IP: ' + ip;
    document.getElementById('gamepad-hint').textContent = isHost
      ? 'LAN جاهز — انتظر اللاعبين (شغّل lan_host.py)'
      : 'جاري الانضمام عبر LAN...';

    var levelBox = document.querySelector('.level-select-box');
    if (!isHost) {
      if (levelBox) levelBox.style.display = 'none';
    } else {
      if (levelBox) levelBox.style.display = '';
      document.getElementById('btn-start-game').disabled = true;
      document.getElementById('btn-start-game').textContent = 'انتظر لاعبين...';
    }
    configureCustomUIForMode();
    renderNetLobbyList();
    showScreen('lobby');

    if (isHost) {
      // Register room FIRST, then start polling (prevents joiner race → false "room closed")
      var registerHost = function () {
        try {
          fetch(lanBaseUrl() + '/roommeta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              room: code,
              host: state.playerName || 'القائد',
              host_id: state.myNetId,
              players: 1,
              playing: false,
              visible: true
            }),
            cache: 'no-store'
          }).catch(function () {});
        } catch (e) {}
        lanSend({ type: 'hostbeat', isHost: true, id: state.myNetId, name: state.playerName || 'القائد', players: 1 });
      };
      registerHost();
      // Retry registration a few times so room is solid before friends join
      setTimeout(registerHost, 250);
      setTimeout(registerHost, 800);
      setTimeout(registerHost, 1800);
      startLanPoll();
      toast('لوبي LAN/Radmin جاهز — أعطِ أصحابك الـ IP والرمز', 'success');
    } else {
      startLanPoll();
      var sendJoin = function () {
        try { readCustomFromUI && readCustomFromUI(0); } catch (e) {}
        lanSend({
          type: 'join',
          clientId: state.myNetId,
          name: state.playerName || 'لاعب',
          custom: (typeof playerCustom !== 'undefined' ? playerCustom[0] : null),
          avatar: getNetAvatar()
        });
      };
      setTimeout(sendJoin, 150);
      setTimeout(sendJoin, 700);
      setTimeout(sendJoin, 1600);
      toast('جاري الانضمام عبر السيرفر...', 'info');
      document.getElementById('gamepad-hint').textContent = 'متصل عبر LAN — بانتظار القائد';
      document.getElementById('btn-start-game').disabled = true;
      document.getElementById('btn-start-game').textContent = 'في انتظار القائد...';
    }
  }


  // عدد اللاعبين عند إنشاء الروم
  state._createPlayerCount = 3;
  (function wireCreatePlayerCount() {
    function updateHint(n) {
      var hint = document.getElementById('create-players-hint');
      if (!hint) return;
      var joiners = Math.max(0, n - 1);
      if (n === 2) hint.textContent = '2 لاعبين = أنت (القائد) + صاحب واحد';
      else hint.textContent = n + ' لاعبين = أنت (القائد) + ' + joiners + ' أصحاب';
    }
    document.querySelectorAll('.create-pcount-btn').forEach(function (btn) {
      btn.onclick = function () {
        var n = parseInt(btn.getAttribute('data-count'), 10) || 3;
        state._createPlayerCount = n;
        document.querySelectorAll('.create-pcount-btn').forEach(function (b) {
          var on = parseInt(b.getAttribute('data-count'), 10) === n;
          b.className = on ? 'btn btn-sm btn-primary create-pcount-btn' : 'btn btn-sm btn-ghost create-pcount-btn';
          b.style.flex = '1';
          b.style.minWidth = '70px';
        });
        updateHint(n);
      };
    });
    updateHint(state._createPlayerCount || 3);
  })();

  var btnDoCreate = document.getElementById('btn-do-create');

  if (btnDoCreate) btnDoCreate.onclick = function () {
    var code = (document.getElementById('create-code-input').value || '').trim().toLowerCase().replace(/\s+/g, '');
    var mode = state._createNetMode;
    if (!mode) { toast('اختر LAN / Radmin أو cloudflared أو تبادل الأكواد أولاً', 'error'); return; }
    if (!code || code.length < 2) { toast('اكتب رمز صالح', 'error'); return; }
    // ثبت عدد اللاعبين المختار (شامل القائد)
    var pc = parseInt(state._createPlayerCount, 10) || 3;
    if (pc < 2) pc = 2;
    if (pc > 8) pc = 8;
    state.maxNetPlayers = pc;
    state._roomPlayerCount = pc;

    // تبادل الأكواد: الشامل اختياري عند الإنشاء (يقدر يرفعه بعدين)
    if (mode === 'codes') {
      if (!createZipReady) {
        toast('تقدر تكمل من غير الشامل الآن — ارفعه لاحقًا من اللوبي لو حبيت', 'info');
      }
      state.usePeerCodes = false;
      state.useFirebase = false;
      state.useLan = false;
      state.useManualRtc = true;
      var st = document.getElementById('create-codes-status');
      if (st) st.textContent = 'جاري توليد كود العرض...';
      toast('تبادل أكواد — من غير بايثون. ابعت الكود كملف txt لصاحبك', 'info');
      startManualRtcAsHost(code);
      return;
    }

    if (!createZipReady) {
      toast('ارفع الملف الشامل أولاً', 'error');
      if (createUploadInput) createUploadInput.click();
      return;
    }

    var ip = '';
    var statusId = mode === 'lan' ? 'create-ip-status' : 'create-cloud-status';
    if (mode === 'lan') {
      ip = (document.getElementById('create-ip-input') && document.getElementById('create-ip-input').value || '127.0.0.1').trim();
    } else {
      ip = (document.getElementById('create-cloud-input') && document.getElementById('create-cloud-input').value || '').trim();
    }
    if (!ip) { toast(mode === 'lan' ? 'اكتب IP المحلي أو Radmin' : 'الصق رابط cloudflared', 'error'); return; }
    toast(mode === 'lan' ? 'جاري التعرف على الخادم (LAN/Radmin)...' : 'جاري التعرف على cloudflared...', 'info');
    probeServerAndShow(ip, statusId, function (ok, info) {
      if (!ok) {
        toast(mode === 'lan'
          ? '✗ مش واصل — شغّل python lan_host.py وتأكد من IP (Radmin أو LAN)'
          : '✗ مش واصل — تأكد من رابط cloudflared أو lan_host.py', 'error');
        return;
      }
      toast('✓ تم التعرف على وجود الخادم', 'success');
      if (info && info.ips) state._detectedLanIps = info.ips;
      state.usePeerCodes = false;
      setupLanLobby(true, code, ip);
      toast(mode === 'lan' ? 'لوبي LAN/Radmin جاهز — أعطِ أصحابك الـ IP والرمز' : 'لوبي cloudflared جاهز — أعطِ الرابط والرمز', 'success');
    });
  };


  // ===== Available rooms list (join) =====
  var selectedListedRoom = null;
  function setJoinTab(mode) {
    var byCode = document.getElementById('join-by-code');
    var byList = document.getElementById('join-by-list');
    var tabCode = document.getElementById('btn-join-tab-code');
    var tabList = document.getElementById('btn-join-tab-list');
    if (!byCode || !byList) return;
    if (mode === 'list') {
      byCode.classList.add('hidden');
      byList.classList.remove('hidden');
      if (tabCode) { tabCode.classList.remove('btn-primary'); tabCode.classList.add('btn-ghost'); }
      if (tabList) { tabList.classList.add('btn-primary'); tabList.classList.remove('btn-ghost'); }
      refreshRoomsList();
    } else {
      byList.classList.add('hidden');
      byCode.classList.remove('hidden');
      if (tabList) { tabList.classList.remove('btn-primary'); tabList.classList.add('btn-ghost'); }
      if (tabCode) { tabCode.classList.add('btn-primary'); tabCode.classList.remove('btn-ghost'); }
    }
  }
  function getJoinServerAddress() {
    if (state._joinNetMode === 'cloud') {
      return (document.getElementById('join-cloud-input') && document.getElementById('join-cloud-input').value || '').trim();
    }
    return (document.getElementById('join-ip-input') && document.getElementById('join-ip-input').value || '').trim();
  }

  function refreshRoomsList() {
    var list = document.getElementById('rooms-list');
    var empty = document.getElementById('rooms-list-empty');
    var ip = getJoinServerAddress() || '127.0.0.1';
    if (!list) return;
    list.innerHTML = '';
    if (empty) empty.textContent = 'جاري التحميل...';
    var base = normalizeLanHost(ip);
    fetch(base + '/rooms', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      list.innerHTML = '';
      var rooms = (j && j.rooms) || [];
      if (!rooms.length) {
        if (empty) empty.textContent = 'مفيش رومات ظاهرة — تأكد إن القائد أنشأ لوبي والسيرفر شغال';
        return;
      }
      if (empty) empty.textContent = '';
      rooms.forEach(function (rm) {
        var card = document.createElement('div');
        card.className = 'room-card';
        if (selectedListedRoom === rm.code) card.classList.add('selected');
        var status = rm.playing ? '● في اللعب' : '○ في اللوبي';
        card.innerHTML = '<div class="rc-code">' + rm.code + '</div>' +
          '<div class="rc-meta">' + (rm.host ? ('القائد: ' + rm.host + ' · ') : '') +
          'لاعبين: ' + (rm.players || '?') + ' · ' + status + '</div>';
        card.onclick = function () {
          selectedListedRoom = rm.code;
          var inp = document.getElementById('join-code-input');
          if (inp) inp.value = rm.code;
          list.querySelectorAll('.room-card').forEach(function (c) { c.classList.remove('selected'); });
          card.classList.add('selected');
          toast('تم اختيار الروم: ' + rm.code, 'info');
        };
        list.appendChild(card);
      });
    }).catch(function () {
      if (empty) empty.textContent = 'فشل جلب الرومات — تأكد من عنوان السيرفر';
    });
  }
  var btnJoinTabCode = document.getElementById('btn-join-tab-code');
  if (btnJoinTabCode) btnJoinTabCode.onclick = function () { setJoinTab('code'); };
  var btnJoinTabList = document.getElementById('btn-join-tab-list');
  if (btnJoinTabList) btnJoinTabList.onclick = function () { setJoinTab('list'); };
  var btnRefreshRooms = document.getElementById('btn-refresh-rooms');
  if (btnRefreshRooms) btnRefreshRooms.onclick = function () { refreshRoomsList(); };

  var btnDoJoin = document.getElementById('btn-do-join');
  if (btnDoJoin) btnDoJoin.onclick = function () {
    var code = (document.getElementById('join-code-input').value || '').trim().toLowerCase().replace(/\s+/g, '');
    var mode = state._joinNetMode;
    if (!mode) { toast('اختر LAN / Radmin أو cloudflared أو تبادل الأكواد أولاً', 'error'); return; }
    if (!code || code.length < 2) { toast('اكتب رمز الروم أو اختر من القائمة', 'error'); return; }
    // الملف الشامل اختياري للمنضم — لو مش موجود نعتمد على مزامنة القائد
    if (!joinZipReady) {
      toast('هتنضم بدون ملف شامل — اللفل هيتبعت من القائد', 'info');
    }

    if (mode === 'codes') {
      state.usePeerCodes = false;
      state.useFirebase = false;
      state.useLan = false;
      state.useManualRtc = true;
      var statusEl = document.getElementById('join-codes-status');
      if (statusEl) statusEl.textContent = 'افتح شاشة لصق كود القائد...';
      toast('الصق كود العرض من القائد بعد شوية', 'info');
      startManualRtcAsJoiner(code);
      return;
    }

    var ip = getJoinServerAddress();
    var statusId = mode === 'lan' ? 'join-ip-status' : 'join-cloud-status';
    if (!ip) { toast(mode === 'lan' ? 'اكتب IP جهاز القائد (LAN أو Radmin)' : 'الصق رابط cloudflared', 'error'); return; }
    toast(mode === 'lan' ? 'جاري التعرف على الخادم (LAN/Radmin)...' : 'جاري التعرف على الخادم...', 'info');
    probeServerAndShow(ip, statusId, function (ok) {
      if (!ok) {
        toast(mode === 'lan'
          ? '✗ مش واصل — تأكد إن القائد فاتح python lan_host.py وإنكم على نفس الشبكة / Radmin'
          : '✗ مش واصل — تأكد من الرابط وإن القائد فاتح Python + tunnel', 'error');
        return;
      }
      toast('✓ تم التعرف على وجود الخادم', 'success');
      state.usePeerCodes = false;
      setupLanLobby(false, code, ip);
    });
  };

  // Pause system — per-player in split screen
  var gpMenuFocus = 0; // index into focusable elements
  var gpMenuMode = 'pause'; // 'pause' | 'settings' | 'cam'

  function getPauseFocusables() {
    if (gpMenuMode === 'settings' || gpMenuMode === 'cam') {
      var list = [];
      var vol = document.getElementById('set-volume');
      var sens = document.getElementById('set-sens');
      var gps = document.getElementById('set-gp-sens');
      var camBtn = document.getElementById('btn-cam-settings');
      var back = document.getElementById('btn-settings-back');
      if (vol) list.push({ el: vol, type: 'range' });
      // Show only relevant sens for current pause owner
      if (state.pauseOwner === 0 && sens) list.push({ el: sens, type: 'range' });
      if (state.pauseOwner === 1 && gps) list.push({ el: gps, type: 'range' });
      if (gpMenuMode === 'cam' || (document.getElementById('cam-settings') && !document.getElementById('cam-settings').classList.contains('hidden'))) {
        var cd = document.getElementById('set-cam-dist');
        var ch = document.getElementById('set-cam-h');
        var cs = document.getElementById('set-cam-side');
        if (cd) list.push({ el: cd, type: 'range' });
        if (ch) list.push({ el: ch, type: 'range' });
        if (cs) list.push({ el: cs, type: 'range' });
      }
      if (camBtn) list.push({ el: camBtn, type: 'button' });
      if (back) list.push({ el: back, type: 'button' });
      return list;
    }
    return [
      { el: document.getElementById('btn-pause-resume'), type: 'button' },
      { el: document.getElementById('btn-pause-settings'), type: 'button' },
      { el: document.getElementById('btn-pause-exit'), type: 'button' }
    ].filter(function (x) { return x.el; });
  }

  // invert mouse settings
  try {
    var invX = document.getElementById('set-invert-x');
    var invY = document.getElementById('set-invert-y');
    try {
      state.invertMouseX = localStorage.getItem('sm_invx') === '1';
      state.invertMouseY = localStorage.getItem('sm_invy') === '1';
    } catch (e) {}
    if (invX) {
      invX.checked = !!state.invertMouseX;
      invX.onchange = function () { state.invertMouseX = !!invX.checked; try { localStorage.setItem('sm_invx', state.invertMouseX ? '1' : '0'); } catch (e) {} try { persistUserSettings(); } catch (e2) {} };
    }
    if (invY) {
      invY.checked = !!state.invertMouseY;
      invY.onchange = function () { state.invertMouseY = !!invY.checked; try { localStorage.setItem('sm_invy', state.invertMouseY ? '1' : '0'); } catch (e) {} try { persistUserSettings(); } catch (e2) {} };
    }
  } catch (eInv) {}


  function updateGpMenuFocus() {
    var items = getPauseFocusables();
    items.forEach(function (it, i) {
      if (!it.el) return;
      if (i === gpMenuFocus) {
        it.el.style.outline = '3px solid #00d4ff';
        it.el.style.outlineOffset = '3px';
        try { it.el.focus && it.el.focus(); } catch (e) {}
      } else {
        it.el.style.outline = '';
        it.el.style.outlineOffset = '';
      }
    });
  }

  function handleGamepadMenuNav(gp, delta) {
    if (!gp) return;
    var items = getPauseFocusables();
    if (!items.length) return;

    var navUp = (gp.dUp || gp.stickY < -0.55) && !prevGpMenuNav.up;
    var navDown = (gp.dDown || gp.stickY > 0.55) && !prevGpMenuNav.down;
    var navLeft = (gp.dLeft || gp.stickX < -0.55) && !prevGpMenuNav.left;
    var navRight = (gp.dRight || gp.stickX > 0.55) && !prevGpMenuNav.right;
    var conf = gp.confirm && !prevGpMenuNav.confirm;
    var back = gp.back && !prevGpMenuNav.back;

    prevGpMenuNav.up = gp.dUp || gp.stickY < -0.55;
    prevGpMenuNav.down = gp.dDown || gp.stickY > 0.55;
    prevGpMenuNav.left = gp.dLeft || gp.stickX < -0.55;
    prevGpMenuNav.right = gp.dRight || gp.stickX > 0.55;
    prevGpMenuNav.confirm = gp.confirm;
    prevGpMenuNav.back = gp.back;

    if (navUp) {
      gpMenuFocus = (gpMenuFocus - 1 + items.length) % items.length;
      updateGpMenuFocus();
    }
    if (navDown) {
      gpMenuFocus = (gpMenuFocus + 1) % items.length;
      updateGpMenuFocus();
    }

    var cur = items[gpMenuFocus];
    if (cur && cur.type === 'range') {
      if (navLeft || navRight) {
        var step = parseFloat(cur.el.step) || 1;
        var val = parseFloat(cur.el.value) || 0;
        val += (navRight ? step : -step);
        var min = parseFloat(cur.el.min), max = parseFloat(cur.el.max);
        if (!isNaN(min)) val = Math.max(min, val);
        if (!isNaN(max)) val = Math.min(max, val);
        cur.el.value = val;
        // trigger input handler
        cur.el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    if (conf && cur) {
      if (cur.type === 'button') cur.el.click();
    }
    if (back) {
      if (gpMenuMode === 'cam') {
        document.getElementById('cam-settings').classList.add('hidden');
        gpMenuMode = 'settings';
        gpMenuFocus = 0;
        updateGpMenuFocus();
      } else if (gpMenuMode === 'settings') {
        document.getElementById('settings-panel').classList.add('hidden');
        gpMenuMode = 'pause';
        gpMenuFocus = 0;
        updateGpMenuFocus();
      } else {
        closePause();
      }
    }
  }

  function loadSettingsToUI(playerIdx) {
    var p = players[playerIdx] || players[0];
    var s = p.settings;
    var vol = document.getElementById('set-volume');
    var sens = document.getElementById('set-sens');
    var gps = document.getElementById('set-gp-sens');
    var cd = document.getElementById('set-cam-dist');
    var ch = document.getElementById('set-cam-h');
    var cs = document.getElementById('set-cam-side');
    if (vol) vol.value = Math.round(state.volume * 100);
    if (sens) sens.value = s.sens;
    if (gps) gps.value = s.sens;
    if (cd) cd.value = s.camDist;
    if (ch) ch.value = s.camHeight;
    if (cs) cs.value = s.camSide;
    var as = document.getElementById('set-aim-side');
    var al = document.getElementById('set-aim-lift');
    var ac = document.getElementById('set-aim-close');
    if (as) as.value = s.aimSide != null ? s.aimSide : 0.7;
    if (al) al.value = s.aimLift != null ? s.aimLift : 0.85;
    if (ac) ac.value = s.aimClose != null ? s.aimClose : 0.9;
    // Labels: hide irrelevant sensitivity for this player
    var sensRow = sens ? sens.closest('.setting-row') : null;
    var gpRow = gps ? gps.closest('.setting-row') : null;
    if (sensRow) sensRow.style.display = playerIdx === 0 ? '' : 'none';
    if (gpRow) gpRow.style.display = playerIdx === 1 ? '' : 'none';
  }

  function openPause(side) {
    if (state.mode !== 'play') return;
    state.paused = true;
    state.pauseSide = side || 'full';
    if (side === 'left') state.pauseOwner = 0;
    else if (side === 'right') state.pauseOwner = 1;
    else state.pauseOwner = 0;

    var pm = document.getElementById('pause-menu');
    var sp = document.getElementById('settings-panel');
    pm.classList.remove('hidden', 'half-left', 'half-right', 'full');
    if (sp) sp.classList.remove('half-left', 'half-right', 'full');

    if (state.playType === 'split' && side === 'left') {
      pm.classList.add('half-left');
      if (sp) sp.classList.add('half-left');
    } else if (state.playType === 'split' && side === 'right') {
      pm.classList.add('half-right');
      if (sp) sp.classList.add('half-right');
    } else {
      pm.classList.add('full');
      if (sp) sp.classList.add('full');
    }

    var title = document.getElementById('pause-title');
    if (title) {
      if (state.playType === 'split') {
        title.textContent = state.pauseOwner === 0 ? 'إيقاف — اللاعب 1' : 'إيقاف — اللاعب 2 (دراع)';
      } else {
        title.textContent = 'إيقاف مؤقت';
      }
    }

    loadSettingsToUI(state.pauseOwner);
    gpMenuMode = 'pause';
    gpMenuFocus = 0;
    updateGpMenuFocus();
  }
  function closePause() {
    state.paused = false;
    state.pauseOwner = null;
    document.getElementById('pause-menu').classList.add('hidden');
    document.getElementById('settings-panel').classList.add('hidden');
    var devBtn = document.getElementById('btn-pause-dev');
    if (devBtn) devBtn.remove();
    var devBtn = document.getElementById('btn-pause-dev');
    if (devBtn) devBtn.remove();
    var cam = document.getElementById('cam-settings');
    if (cam) cam.classList.add('hidden');
    // clear outlines
    getPauseFocusables().forEach(function (it) {
      if (it.el) { it.el.style.outline = ''; it.el.style.outlineOffset = ''; }
    });
    gpMenuMode = 'pause';
  }

  document.getElementById('btn-pause-resume').onclick = closePause;
  document.getElementById('btn-pause-exit').onclick = function () {
    closePause();
    leaveOnlineSession(true);
  };
  document.getElementById('btn-pause-settings').onclick = function () {
    loadSettingsToUI(state.pauseOwner != null ? state.pauseOwner : 0);
    document.getElementById('settings-panel').classList.remove('hidden');
    gpMenuMode = 'settings';
    gpMenuFocus = 0;
    updateGpMenuFocus();
  };
  document.getElementById('btn-settings-back').onclick = function () {
    document.getElementById('settings-panel').classList.add('hidden');
    gpMenuMode = 'pause';
    gpMenuFocus = 0;
    updateGpMenuFocus();
  };
  document.getElementById('btn-cam-settings').onclick = function () {
    document.getElementById('cam-settings').classList.toggle('hidden');
    gpMenuMode = document.getElementById('cam-settings').classList.contains('hidden') ? 'settings' : 'cam';
    gpMenuFocus = 0;
    updateGpMenuFocus();
  };

  // ===== تعديل كاميرا التصويب مباشرة =====
  state.aimEditMode = false;
  function enterAimEditMode() {
    var p = players[state.pauseOwner != null ? state.pauseOwner : 0];
    if (!p) p = players[0];
    // اقفل الإعدادات والـ pause وخلّي اللعب يشتغل
    var sp = document.getElementById('settings-panel');
    if (sp) sp.classList.add('hidden');
    closePause();
    state.aimEditMode = true;
    state.aiming = true;
    state.mouseLeftDown = false;
    // لو معاه سلاح يظهر التصويب (من غير إطلاق)
    if (playerHoldingWeapon && playerHoldingWeapon()) {
      var ch = document.getElementById('crosshair');
      if (ch) { ch.classList.remove('hidden'); ch.classList.add('aiming'); }
    }
    // عبّي السلايدرز من الإعدادات الحالية
    var s = p.settings || {};
    var ls = document.getElementById('aim-live-side');
    var ll = document.getElementById('aim-live-lift');
    var lc = document.getElementById('aim-live-close');
    if (ls) ls.value = s.aimSide != null ? s.aimSide : 0.7;
    if (ll) ll.value = s.aimLift != null ? s.aimLift : 0.85;
    if (lc) lc.value = s.aimClose != null ? s.aimClose : 0.9;
    var ov = document.getElementById('aim-edit-overlay');
    if (ov) {
      ov.classList.remove('hidden');
      ov.style.pointerEvents = 'auto';
      ov.style.zIndex = '2500';
    }
    // بدون pointer lock في البداية عشان السلايدرز تشتغل
    try {
      if (document.exitPointerLock) document.exitPointerLock();
      state.mouseHidden = false;
      document.body.style.cursor = 'default';
    } catch (e) {}
    toast('حرّك السلايدرز — مفيش إطلاق نار في الوضع ده', 'info');
  }
  function confirmAimEditMode() {
    var p = players[0];
    var ls = document.getElementById('aim-live-side');
    var ll = document.getElementById('aim-live-lift');
    var lc = document.getElementById('aim-live-close');
    if (p && p.settings) {
      if (ls) p.settings.aimSide = parseFloat(ls.value);
      if (ll) p.settings.aimLift = parseFloat(ll.value);
      if (lc) p.settings.aimClose = parseFloat(lc.value);
    }
    // انسخ للسلايدرز في الإعدادات
    var as = document.getElementById('set-aim-side');
    var al = document.getElementById('set-aim-lift');
    var ac = document.getElementById('set-aim-close');
    if (as && ls) as.value = ls.value;
    if (al && ll) al.value = ll.value;
    if (ac && lc) ac.value = lc.value;
    state.aimEditMode = false;
    state.aiming = false;
    var ov = document.getElementById('aim-edit-overlay');
    if (ov) ov.classList.add('hidden');
    try {
      document.exitPointerLock && document.exitPointerLock();
      state.mouseHidden = false;
      document.body.style.cursor = 'default';
    } catch (e) {}
    // رجّع للإعدادات
    openPause('full');
    loadSettingsToUI(0);
    var sp = document.getElementById('settings-panel');
    if (sp) sp.classList.remove('hidden');
    var camBox = document.getElementById('cam-settings');
    if (camBox) camBox.classList.remove('hidden');
    toast('تم حفظ إعدادات التصويب', 'success');
  }
  var btnAimLive = document.getElementById('btn-aim-live-edit');
  if (btnAimLive) btnAimLive.onclick = function (e) {
    e.preventDefault();
    e.stopPropagation();
    enterAimEditMode();
  };
  var btnAimConf = document.getElementById('btn-aim-confirm');
  if (btnAimConf) btnAimConf.onclick = function (e) {
    e.preventDefault();
    e.stopPropagation();
    confirmAimEditMode();
  };
  // سلايدرز مباشرة أثناء التجربة
  ['aim-live-side', 'aim-live-lift', 'aim-live-close'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.oninput = function () {
      var p = players[0];
      if (!p || !p.settings) return;
      if (id === 'aim-live-side') p.settings.aimSide = parseFloat(el.value);
      if (id === 'aim-live-lift') p.settings.aimLift = parseFloat(el.value);
      if (id === 'aim-live-close') p.settings.aimClose = parseFloat(el.value);
      state.aiming = true;
    };
    // منع ماوس اللعبة من سرقة الفوكس
    el.onmousedown = function (e) { e.stopPropagation(); };
    el.ontouchstart = function (e) { e.stopPropagation(); };
  });


  // ===== حفظ محلي صامت لإعدادات اللاعب (جرافيكس / كاميرا / تصويب / صوت...) =====
  // مفيش أي نافذة اختيار — بيتحمّل أوتوماتيك لما تفتح الموقع
  function collectUserSettings() {
    var p0 = (players[0] && players[0].settings) ? players[0].settings : {};
    var p1 = (players[1] && players[1].settings) ? players[1].settings : {};
    return {
      v: 1,
      volume: state.volume != null ? state.volume : 0.8,
      sens0: p0.sens != null ? p0.sens : 5,
      sens1: p1.sens != null ? p1.sens : 5,
      invertX: !!state.invertMouseX,
      invertY: !!state.invertMouseY,
      camDist: p0.camDist != null ? p0.camDist : 5.8,
      camHeight: p0.camHeight != null ? p0.camHeight : 2.4,
      camSide: p0.camSide != null ? p0.camSide : 0,
      aimSide: p0.aimSide != null ? p0.aimSide : 0.7,
      aimLift: p0.aimLift != null ? p0.aimLift : 0.85,
      aimClose: p0.aimClose != null ? p0.aimClose : 0.9,
      // player2 cam (split)
      camDist1: p1.camDist != null ? p1.camDist : 5.8,
      camHeight1: p1.camHeight != null ? p1.camHeight : 2.4,
      camSide1: p1.camSide != null ? p1.camSide : 0,
      aimSide1: p1.aimSide != null ? p1.aimSide : 0.7,
      aimLift1: p1.aimLift != null ? p1.aimLift : 0.85,
      aimClose1: p1.aimClose != null ? p1.aimClose : 0.9,
      graphics: state.graphicsLevel != null ? state.graphicsLevel : 3,
      resolution: (function () {
        try { return localStorage.getItem('sm_resolution') || 'native'; } catch (e) { return 'native'; }
      })(),
      windowMode: (function () {
        try { return localStorage.getItem('sm_window_mode') || 'windowed'; } catch (e) { return 'windowed'; }
      })(),
      showFps: state.showFpsHud !== false
    };
  }
  function persistUserSettings() {
    try {
      var data = collectUserSettings();
      // خُد القيم الحالية من الـ UI لو موجودة
      var vol = document.getElementById('set-volume');
      var sens = document.getElementById('set-sens');
      var gps = document.getElementById('set-gp-sens');
      var cd = document.getElementById('set-cam-dist');
      var ch = document.getElementById('set-cam-h');
      var cs = document.getElementById('set-cam-side');
      var as = document.getElementById('set-aim-side');
      var al = document.getElementById('set-aim-lift');
      var ac = document.getElementById('set-aim-close');
      var gfx = document.getElementById('set-graphics');
      var res = document.getElementById('set-resolution');
      var wm = document.getElementById('set-window-mode');
      var fpsCb = document.getElementById('set-show-fps');
      var invX = document.getElementById('set-invert-x');
      var invY = document.getElementById('set-invert-y');
      if (vol) data.volume = parseFloat(vol.value) / 100;
      if (sens) data.sens0 = parseFloat(sens.value);
      if (gps) data.sens1 = parseFloat(gps.value);
      if (cd) data.camDist = parseFloat(cd.value);
      if (ch) data.camHeight = parseFloat(ch.value);
      if (cs) data.camSide = parseFloat(cs.value);
      if (as) data.aimSide = parseFloat(as.value);
      if (al) data.aimLift = parseFloat(al.value);
      if (ac) data.aimClose = parseFloat(ac.value);
      if (gfx) data.graphics = parseInt(gfx.value, 10);
      if (res) data.resolution = res.value;
      if (wm) data.windowMode = wm.value;
      if (fpsCb) data.showFps = !!fpsCb.checked;
      if (invX) data.invertX = !!invX.checked;
      if (invY) data.invertY = !!invY.checked;
      localStorage.setItem('sm_user_settings_v1', JSON.stringify(data));
      // مفاتيح قديمة متوافقة
      try { localStorage.setItem('sm_graphics', String(data.graphics)); } catch (e) {}
      try { localStorage.setItem('sm_show_fps', data.showFps ? '1' : '0'); } catch (e) {}
      try { localStorage.setItem('sm_resolution', data.resolution || 'native'); } catch (e) {}
      try { localStorage.setItem('sm_window_mode', data.windowMode || 'windowed'); } catch (e) {}
      try { localStorage.setItem('sm_invx', data.invertX ? '1' : '0'); } catch (e) {}
      try { localStorage.setItem('sm_invy', data.invertY ? '1' : '0'); } catch (e) {}
    } catch (e) {
      console.warn('persistUserSettings', e);
    }
  }
  function applyUserSettingsObject(data) {
    if (!data || typeof data !== 'object') return;
    if (data.volume != null) state.volume = data.volume;
    state.invertMouseX = !!data.invertX;
    state.invertMouseY = !!data.invertY;
    state.showFpsHud = data.showFps !== false;
    if (players[0] && players[0].settings) {
      if (data.sens0 != null) players[0].settings.sens = data.sens0;
      if (data.camDist != null) players[0].settings.camDist = data.camDist;
      if (data.camHeight != null) players[0].settings.camHeight = data.camHeight;
      if (data.camSide != null) players[0].settings.camSide = data.camSide;
      if (data.aimSide != null) players[0].settings.aimSide = data.aimSide;
      if (data.aimLift != null) players[0].settings.aimLift = data.aimLift;
      if (data.aimClose != null) players[0].settings.aimClose = data.aimClose;
    }
    if (players[1] && players[1].settings) {
      if (data.sens1 != null) players[1].settings.sens = data.sens1;
      if (data.camDist1 != null) players[1].settings.camDist = data.camDist1;
      if (data.camHeight1 != null) players[1].settings.camHeight = data.camHeight1;
      if (data.camSide1 != null) players[1].settings.camSide = data.camSide1;
      if (data.aimSide1 != null) players[1].settings.aimSide = data.aimSide1;
      if (data.aimLift1 != null) players[1].settings.aimLift = data.aimLift1;
      if (data.aimClose1 != null) players[1].settings.aimClose = data.aimClose1;
    }
    // state defaults
    if (data.camDist != null) state.camDist = data.camDist;
    if (data.camHeight != null) state.camHeight = data.camHeight;
    try {
      var g = data.graphics != null ? data.graphics : parseInt(localStorage.getItem('sm_graphics') || '3', 10);
      applyGraphicsQuality(g);
    } catch (e) {}
    try {
      if (data.resolution) applyResolution(data.resolution);
    } catch (e) {}
    try {
      if (data.windowMode && typeof applyWindowMode === 'function') applyWindowMode(data.windowMode);
    } catch (e) {}
    // UI
    try {
      var vol = document.getElementById('set-volume');
      var sens = document.getElementById('set-sens');
      var gps = document.getElementById('set-gp-sens');
      var cd = document.getElementById('set-cam-dist');
      var ch = document.getElementById('set-cam-h');
      var cs = document.getElementById('set-cam-side');
      var as = document.getElementById('set-aim-side');
      var al = document.getElementById('set-aim-lift');
      var ac = document.getElementById('set-aim-close');
      var gfx = document.getElementById('set-graphics');
      var res = document.getElementById('set-resolution');
      var wm = document.getElementById('set-window-mode');
      var fpsCb = document.getElementById('set-show-fps');
      var invX = document.getElementById('set-invert-x');
      var invY = document.getElementById('set-invert-y');
      if (vol && data.volume != null) vol.value = Math.round(data.volume * 100);
      if (sens && data.sens0 != null) sens.value = data.sens0;
      if (gps && data.sens1 != null) gps.value = data.sens1;
      if (cd && data.camDist != null) cd.value = data.camDist;
      if (ch && data.camHeight != null) ch.value = data.camHeight;
      if (cs && data.camSide != null) cs.value = data.camSide;
      if (as && data.aimSide != null) as.value = data.aimSide;
      if (al && data.aimLift != null) al.value = data.aimLift;
      if (ac && data.aimClose != null) ac.value = data.aimClose;
      if (gfx && data.graphics != null) gfx.value = String(data.graphics);
      if (res && data.resolution) res.value = data.resolution;
      if (wm && data.windowMode) wm.value = data.windowMode;
      if (fpsCb) fpsCb.checked = data.showFps !== false;
      if (invX) invX.checked = !!data.invertX;
      if (invY) invY.checked = !!data.invertY;
    } catch (e) {}
  }
  function loadUserSettingsSilent() {
    try {
      var raw = localStorage.getItem('sm_user_settings_v1');
      if (raw) {
        var data = JSON.parse(raw);
        applyUserSettingsObject(data);
        return true;
      }
    } catch (e) {}
    // توافق مع المفاتيح القديمة المتفرقة
    try {
      var legacy = {
        graphics: parseInt(localStorage.getItem('sm_graphics') || '3', 10),
        showFps: (function () {
          var s = localStorage.getItem('sm_show_fps');
          return s == null ? true : s === '1';
        })(),
        resolution: localStorage.getItem('sm_resolution') || 'native',
        windowMode: localStorage.getItem('sm_window_mode') || 'windowed',
        invertX: localStorage.getItem('sm_invx') === '1',
        invertY: localStorage.getItem('sm_invy') === '1',
        volume: 0.8
      };
      applyUserSettingsObject(legacy);
    } catch (e2) {}
    return false;
  }

  // Live settings — apply to the player who opened the menu only
  function bindSettings() {

    var vol = document.getElementById('set-volume');
    var sens = document.getElementById('set-sens');
    var gps = document.getElementById('set-gp-sens');
    var cd = document.getElementById('set-cam-dist');
    var ch = document.getElementById('set-cam-h');
    var cs = document.getElementById('set-cam-side');
    var gfx = document.getElementById('set-graphics');

    function targetPlayer() {
      return players[state.pauseOwner != null ? state.pauseOwner : 0];
    }

    function saveSoon() {
      try { persistUserSettings(); } catch (e) {}
    }
    if (vol) vol.oninput = function () { state.volume = vol.value / 100; saveSoon(); };
    if (sens) sens.oninput = function () {
      var p = targetPlayer();
      p.settings.sens = parseFloat(sens.value);
      saveSoon();
    };
    if (gps) gps.oninput = function () {
      var p = targetPlayer();
      p.settings.sens = parseFloat(gps.value);
      saveSoon();
    };
    if (cd) cd.oninput = function () { targetPlayer().settings.camDist = parseFloat(cd.value); saveSoon(); };
    if (ch) ch.oninput = function () { targetPlayer().settings.camHeight = parseFloat(ch.value); saveSoon(); };
    if (cs) cs.oninput = function () { targetPlayer().settings.camSide = parseFloat(cs.value); saveSoon(); };
    var as = document.getElementById('set-aim-side');
    var al = document.getElementById('set-aim-lift');
    var ac = document.getElementById('set-aim-close');
    if (as) as.oninput = function () { targetPlayer().settings.aimSide = parseFloat(as.value); saveSoon(); };
    if (al) al.oninput = function () { targetPlayer().settings.aimLift = parseFloat(al.value); saveSoon(); };
    if (ac) ac.oninput = function () { targetPlayer().settings.aimClose = parseFloat(ac.value); saveSoon(); };
    if (gfx) gfx.onchange = function () {
      var lv = parseInt(gfx.value, 10);
      if (isNaN(lv)) lv = 3;
      applyGraphicsQuality(lv);
      saveSoon();
      toast('تم تطبيق مستوى الجرافيكس ' + lv, 'success');
    };

    // الدقة
    var res = document.getElementById('set-resolution');
    if (res) {
      try { res.value = localStorage.getItem('sm_resolution') || 'native'; } catch (e) {}
      res.onchange = function () {
        applyResolution(res.value);
        try { localStorage.setItem('sm_resolution', res.value); } catch (e) {}
        try { persistUserSettings(); } catch (e) {}
        toast('تم تطبيق الدقة', 'success');
      };
    }
    // وضع النافذة
    var wm = document.getElementById('set-window-mode');
    if (wm) {
      try { wm.value = localStorage.getItem('sm_window_mode') || 'windowed'; } catch (e) {}
      wm.onchange = function () {
        applyWindowMode(wm.value);
        try { localStorage.setItem('sm_window_mode', wm.value); } catch (e) {}
        try { persistUserSettings(); } catch (e) {}
      };
    }
    // عداد الفريمات
    var fpsCb = document.getElementById('set-show-fps');
    if (fpsCb) {
      try {
        var show = localStorage.getItem('sm_show_fps');
        fpsCb.checked = show == null ? true : show === '1';
        state.showFpsHud = fpsCb.checked;
      } catch (e) { state.showFpsHud = true; fpsCb.checked = true; }
      fpsCb.onchange = function () {
        state.showFpsHud = !!fpsCb.checked;
        try { localStorage.setItem('sm_show_fps', state.showFpsHud ? '1' : '0'); } catch (e) {}
        try { persistUserSettings(); } catch (e) {}
        var fpsHud = document.getElementById('fps-hud');
        if (fpsHud) {
          if (state.showFpsHud && state.mode === 'play') fpsHud.classList.remove('hidden');
          else fpsHud.classList.add('hidden');
        }
        toast(state.showFpsHud ? 'عداد الفريمات ظاهر' : 'عداد الفريمات مخفي', 'info');
      };
    }

    var kb = document.getElementById('kb-controls');
    if (kb) kb.innerHTML = 'W/A/S/D حركة<br>Space قفز<br>F تفاعل<br>V منظور<br>Ctrl إخفاء الماوس<br>Esc قائمة';
    var gp = document.getElementById('gp-controls');
    if (gp) gp.innerHTML = 'Left Stick حركة<br>X قفز / تأكيد<br>Circle رجوع<br>Right Stick كاميرا<br>Options قائمة<br>D-Pad تنقل القائمة';
  }

  function applyResolution(val) {
    var canvas = document.getElementById('game-canvas');
    if (!canvas || !renderer) return;
    if (!val || val === 'native') {
      state.forcedResolution = null;
      var w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      if (buildCamera) { buildCamera.aspect = w / h; buildCamera.updateProjectionMatrix(); }
      if (players[0] && players[0].camera) {
        players[0].camera.aspect = w / h;
        players[0].camera.updateProjectionMatrix();
      }
      return;
    }
    var parts = String(val).split('x');
    var rw = parseInt(parts[0], 10) || 1920;
    var rh = parseInt(parts[1], 10) || 1080;
    state.forcedResolution = { w: rw, h: rh };
    renderer.setSize(rw, rh, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    if (buildCamera) { buildCamera.aspect = rw / rh; buildCamera.updateProjectionMatrix(); }
    if (players[0] && players[0].camera) {
      players[0].camera.aspect = rw / rh;
      players[0].camera.updateProjectionMatrix();
    }
  }

  function applyWindowMode(mode) {
    var doc = document;
    try {
      if (mode === 'fullscreen') {
        var el = document.documentElement;
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        toast('ملء الشاشة', 'info');
      } else {
        if (doc.exitFullscreen) doc.exitFullscreen();
        else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
        toast('وضع النافذة', 'info');
      }
    } catch (e) {
      toast('المتصفح منع تغيير وضع النافذة', 'error');
    }
  }

  // ESC = player 1 (keyboard) pause
  window.addEventListener('keydown', function (e) {
    if (e.code === 'Escape' && state.mode === 'play') {
      e.preventDefault();
      e.stopPropagation();
      // لو في وضع تعديل التصويب — تأكيد والرجوع
      if (state.aimEditMode) {
        confirmAimEditMode();
        return;
      }
      if (state.paused) {
        if (state.pauseOwner === 0 || state.playType !== 'split') closePause();
        return;
      }
      if (state.playType === 'split') openPause('left');
      else openPause('full');
      // في وضع الاختبار أظهر زر العودة للمطوّر
      if (state._testMode || state.playType === 'test') {
        try { ensureTestPauseExtras(); } catch (eT) {}
      }
    }
  }, true);



  // Click player2 card in split lobby to ready without gamepad
  var p2card = document.getElementById('player2-card');
  if (p2card) {
    p2card.style.cursor = 'pointer';
    p2card.addEventListener('click', function () {
      if (state.playType === 'split' && !state.player2Joined) {
        state.player2Joined = true;
        p2card.classList.add('ready');
        document.getElementById('player2-status').textContent = 'READY ✓';
        document.getElementById('player2-status').classList.add('online');
        document.getElementById('p2-avatar').textContent = '✅';
        document.getElementById('btn-start-game').disabled = false;
        document.getElementById('btn-start-game').textContent = 'START GAME';
        toast('اللاعب 2 جاهز', 'success');
      }
    });
  }


  // ===== صورة الملف الشخصي (محلي) =====
  function loadStoredAvatar() {
    try {
      return localStorage.getItem('storyModePlayerAvatar') || '';
    } catch (e) { return ''; }
  }
  function saveStoredAvatar(dataUrl) {
    try {
      if (dataUrl) localStorage.setItem('storyModePlayerAvatar', dataUrl);
      else localStorage.removeItem('storyModePlayerAvatar');
    } catch (e) {
      toast('مساحة التخزين ممتلئة — جرب صورة أصغر', 'error');
    }
  }
  function compressImageFile(file, maxSize, quality, cb) {
    maxSize = maxSize || 160;
    quality = quality != null ? quality : 0.72;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        var scale = Math.min(1, maxSize / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, cw, ch);
        var out = canvas.toDataURL('image/jpeg', quality);
        // لو لسه كبير، صغّر أكتر
        if (out.length > 120000 && quality > 0.45) {
          compressImageFile(file, maxSize, quality - 0.15, cb);
          return;
        }
        cb(out);
      };
      img.onerror = function () { cb(null); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }
  function avatarHtml(dataUrl, fallbackEmoji) {
    if (dataUrl) {
      return '<img src="' + dataUrl + '" alt="avatar" />';
    }
    return fallbackEmoji || '🎮';
  }
  // صورة مصغّرة للشبكة (عشان متتبعتش ميجات على الروم)
  function getNetAvatar() {
    var src = state.playerAvatar || '';
    if (!src) return '';
    if (state._netAvatarCache && state._netAvatarCache.src === src) return state._netAvatarCache.out;
    try {
      // لو أصلاً صغيرة، ابعتها زي ما هي
      if (src.length < 12000) {
        state._netAvatarCache = { src: src, out: src };
        return src;
      }
      // تصغير متزامن عبر canvas لو الصورة متحمّلة قبل كده — وإلا ابعت الأصلية
      var out = src;
      state._netAvatarCache = { src: src, out: out };
      // حضّر نسخة مضغوطة في الخلفية للمرات الجاية
      try {
        var img = new Image();
        img.onload = function () {
          try {
            var c = document.createElement('canvas');
            c.width = 64; c.height = 64;
            var ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0, 64, 64);
            var small = c.toDataURL('image/jpeg', 0.55);
            state._netAvatarCache = { src: src, out: small };
          } catch (e2) {}
        };
        img.src = src;
      } catch (e3) {}
      return out;
    } catch (e) {
      return src;
    }
  }
  function setAvatarElement(el, dataUrl, fallbackEmoji) {
    if (!el) return;
    if (dataUrl) {
      el.innerHTML = '<img src="' + dataUrl + '" alt="avatar" />';
    } else {
      el.textContent = fallbackEmoji || '🎮';
      // clear any leftover img
      el.innerHTML = fallbackEmoji || '🎮';
    }
  }
  function updateProfilePreviewUI(dataUrl) {
    var img = document.getElementById('profile-preview');
    var ph = document.getElementById('profile-placeholder');
    var clr = document.getElementById('btn-clear-profile');
    if (dataUrl) {
      if (img) { img.src = dataUrl; img.classList.remove('hidden'); }
      if (ph) ph.classList.add('hidden');
      if (clr) clr.style.display = '';
    } else {
      if (img) { img.removeAttribute('src'); img.classList.add('hidden'); }
      if (ph) ph.classList.remove('hidden');
      if (clr) clr.style.display = 'none';
    }
  }

  function updateMenuNameDisplay() {
    var el = document.getElementById('menu-player-name');
    if (el) el.textContent = state.playerName ? ('مرحباً، ' + state.playerName) : '';
    var av = document.getElementById('menu-player-avatar');
    if (av) {
      if (state.playerAvatar) {
        av.style.display = '';
        setAvatarElement(av, state.playerAvatar, '👤');
      } else {
        av.style.display = 'none';
        av.innerHTML = '';
      }
    }
  }

  function showNameEntry(force) {
    var saved = '';
    try { saved = localStorage.getItem('storyModePlayerName') || ''; } catch (e) {}
    var savedAv = loadStoredAvatar();
    if (!force && saved.trim()) {
      state.playerName = saved.trim().slice(0, 16);
      state.playerAvatar = savedAv || '';
      updateMenuNameDisplay();
      showScreen('menu');
      showUI('main-menu');
      return;
    }
    hideAllScreens();
    var ne = document.getElementById('name-entry-screen');
    if (ne) ne.classList.remove('hidden');
    var inp = document.getElementById('player-name-input');
    if (inp) {
      inp.value = saved || state.playerName || '';
      setTimeout(function () { inp.focus(); }, 50);
    }
    state.playerAvatar = savedAv || state.playerAvatar || '';
    updateProfilePreviewUI(state.playerAvatar);
  }

  function savePlayerNameFromUI() {
    var inp = document.getElementById('player-name-input');
    var name = (inp && inp.value ? inp.value : '').trim().slice(0, 16);
    if (!name) {
      toast('اكتب اسمك أولاً', 'error');
      return;
    }
    state.playerName = name;
    try { localStorage.setItem('storyModePlayerName', name); } catch (e) {}
    saveStoredAvatar(state.playerAvatar || '');
    updateMenuNameDisplay();
    var ne = document.getElementById('name-entry-screen');
    if (ne) ne.classList.add('hidden');
    showScreen('menu');
    showUI('main-menu');
    toast(state.playerAvatar ? ('تم حفظ الاسم والصورة: ' + name) : ('تم حفظ الاسم: ' + name), 'success');
  }

  function finishLoading() {
    loadingScreen.classList.add('hidden');
    bindContextMenu();
    bindCustomUI();
    bindObjToolbar();
    bindSettings();
    var search = document.getElementById('build-search');
    if (search) {
      search.oninput = function () { populateSidebar(search.value); };
    }
    // Name entry
    var btnSaveName = document.getElementById('btn-save-player-name');
    if (btnSaveName) btnSaveName.onclick = savePlayerNameFromUI;
    var profileInput = document.getElementById('profile-file-input');
    if (profileInput) {
      profileInput.onchange = function () {
        var f = profileInput.files && profileInput.files[0];
        if (!f) return;
        if (!/^image\//.test(f.type)) {
          toast('اختار صورة فقط', 'error');
          return;
        }
        compressImageFile(f, 160, 0.72, function (dataUrl) {
          if (!dataUrl) { toast('فشل قراءة الصورة', 'error'); return; }
          state.playerAvatar = dataUrl;
          updateProfilePreviewUI(dataUrl);
          toast('تم اختيار الصورة', 'success');
        });
      };
    }
    var btnClearProfile = document.getElementById('btn-clear-profile');
    if (btnClearProfile) {
      btnClearProfile.onclick = function () {
        state.playerAvatar = '';
        updateProfilePreviewUI('');
        if (profileInput) profileInput.value = '';
      };
    }
    var nameInp = document.getElementById('player-name-input');
    if (nameInp) {
      nameInp.onkeydown = function (e) {
        if (e.key === 'Enter') savePlayerNameFromUI();
      };
    }
    var btnChangeName = document.getElementById('btn-change-name');
    if (btnChangeName) btnChangeName.onclick = function () { showNameEntry(true); };

    // Update hideAllScreens list if needed - name entry is separate
    showNameEntry(false);
    // استعادة كل الإعدادات بصمت (من غير أي سؤال)
    try {
      loadUserSettingsSilent();
    } catch (e) {
      try { applyGraphicsQuality(3); } catch (e2) {}
    }
    animate();
  }
  function init() { loadingText.textContent = 'جاهز'; setTimeout(finishLoading, 100); }
  setTimeout(function () { if (!loadingScreen.classList.contains('hidden')) finishLoading(); }, 2500);
  init();
})();
