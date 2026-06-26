// Lógica de juego 3D con Three.js para Paint and Panic
class Game {
    constructor() {
        this.role = null; // 'seeker' o 'invisible'
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        
        // Controles y movimiento
        this.controls = null;
        this.keys = { w: false, a: false, s: false, d: false };
        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        this.moveSpeed = 15.0;
        this.clock = new THREE.Clock();
        this.cameraYaw = 0; // Guardar rotación horizontal pura de forma continua
        this.cameraPitch = 0; // Guardar rotación vertical pura de forma continua

        // Estado del juego
        this.gameActive = false;
        this.otherPlayers = {}; // Sincronizados por red
        this.myPlayerId = null;

        // Mecánicas: Buscador
        this.flashlightActive = false;
        this.flashlightLocked = false; // Bloqueo temporal al agotarse la batería
        this.battery = 100.0;
        this.batteryDepletionRate = 20.0; // por segundo encendida
        this.batteryRecoveryRate = 12.0;  // por segundo apagada
        this.flashlightSpot = null;
        this.flashlightConeVisual = null;
        this.ammoReady = true;
        this.reloadTime = 2500; // ms

        // Mecánicas: Invisibles
        this.footsteps = []; // Huellas en el suelo
        this.lastFootstepTime = 0;
        this.footstepInterval = 400; // ms al caminar
        this.canWhistle = true;

        // Elementos UI
        this.hudContainer = document.getElementById('hud-container');
        this.seekerPanel = document.getElementById('seeker-panel');
        this.invisiblePanel = document.getElementById('invisible-panel');
        this.batteryBar = document.getElementById('battery-bar');
        this.ammoIndicator = document.getElementById('ammo-indicator');
        this.ammoStatus = document.getElementById('ammo-status');
        this.roleValue = document.getElementById('role-value');
        this.gameoverScreen = document.getElementById('gameover-screen');
        this.gameoverTitle = document.getElementById('gameover-title');
        this.gameoverDesc = document.getElementById('gameover-desc');
        this.btnRestart = document.getElementById('btn-restart');

        this.setupAudio();
    }

    setupAudio() {
        // Sintetizador Web Audio API para efectos de sonido retro sin assets de audio pesados
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    playSynthSound(type) {
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        const now = this.audioCtx.currentTime;

        if (type === 'whistle') {
            // Silbido: Tono agudo deslizante (slide)
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.exponentialRampToValueAtTime(1400, now + 0.15);
            osc.frequency.exponentialRampToValueAtTime(1000, now + 0.3);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.35);
        } else if (type === 'shot') {
            // Disparo de paintball: Sonido sordo explosivo corto
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(180, now);
            osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.2);
            osc.start(now);
            osc.stop(now + 0.2);
        } else if (type === 'reload') {
            // Recarga metálica
            osc.frequency.setValueAtTime(300, now);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.15);
            
            setTimeout(() => {
                const osc2 = this.audioCtx.createOscillator();
                const gain2 = this.audioCtx.createGain();
                osc2.connect(gain2);
                gain2.connect(this.audioCtx.destination);
                osc2.frequency.setValueAtTime(450, this.audioCtx.currentTime);
                gain2.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
                gain2.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + 0.1);
                osc2.start();
                osc2.stop(this.audioCtx.currentTime + 0.15);
            }, 200);
        } else if (type === 'click') {
            // Click de linterna
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(900, now);
            gain.gain.setValueAtTime(0.05, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.05);
            osc.start(now);
            osc.stop(now + 0.05);
        }
    }

    start(role) {
        this.role = role;
        this.gameActive = true;
        
        // Ajustar HUD según rol
        this.hudContainer.classList.remove('hidden');
        this.roleValue.textContent = this.role === 'seeker' ? 'BUSCADOR' : 'INVISIBLE';
        this.roleValue.className = this.role === 'seeker' ? 'hud-value role-seeker' : 'hud-value role-invisible';

        if (this.role === 'seeker') {
            this.seekerPanel.classList.remove('hidden');
            this.invisiblePanel.classList.add('hidden');
        } else {
            this.seekerPanel.classList.add('hidden');
            this.invisiblePanel.classList.remove('hidden');
        }

        this.init3D();
        this.setupControls();
        this.buildMap();
        this.spawnPlayers();

        // Enlazar eventos de red
        window.networkManager.onDataCallback = (data) => this.handleNetworkData(data);

        // Enviar nuestra posición inicial al rival inmediatamente
        this.sendPositionUpdate();

        // Heartbeat de red para sincronizar posición de forma segura y constante (10 veces por segundo es óptimo)
        this.netHeartbeat = setInterval(() => {
            if (this.gameActive) {
                this.sendPositionUpdate();
            }
        }, 100);

        // Bucle de renderizado
        this.animate();
    }

    init3D() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0f1015);
        this.scene.fog = new THREE.FogExp2(0x0f1015, 0.015);

        // Cámara
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        
        // Renderizador
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        // Iluminación General (Almacén bien iluminado como acordamos)
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.6);
        dirLight1.position.set(20, 40, 20);
        dirLight1.castShadow = true;
        dirLight1.shadow.mapSize.width = 1024;
        dirLight1.shadow.mapSize.height = 1024;
        this.scene.add(dirLight1);

        // Agregar luces fluorescentes industriales en el techo
        for (let x = -30; x <= 30; x += 20) {
            for (let z = -30; z <= 30; z += 20) {
                const ceilingLight = new THREE.PointLight(0xfff0dd, 0.5, 30);
                ceilingLight.position.set(x, 15, z);
                this.scene.add(ceilingLight);
            }
        }

        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupControls() {
        // PointerLockControls para mover la vista con el mouse
        this.controls = {
            enabled: false,
            getObject: () => this.camera
        };

        const handlePointerLock = () => {
            if (!this.gameActive) return;
            document.body.requestPointerLock();
        };

        document.body.addEventListener('click', handlePointerLock);

        document.addEventListener('pointerlockchange', () => {
            this.controls.enabled = document.pointerLockElement === document.body;
        });

        // Controles de cámara con el movimiento del ratón
        this.cameraPitch = 0;
        document.addEventListener('mousemove', (event) => {
            if (!this.controls.enabled) return;

            const movementX = event.movementX || 0;
            const movementY = event.movementY || 0;

            this.cameraYaw -= movementX * 0.002;
            this.cameraPitch -= movementY * 0.002;
            this.cameraPitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.cameraPitch));

            const euler = new THREE.Euler(this.cameraPitch, this.cameraYaw, 0, 'YXZ');
            this.camera.quaternion.setFromEuler(euler);

            // Transmitir rotación a través de la red
            this.sendPositionUpdate();
        });

        // Teclado
        window.addEventListener('keydown', (e) => {
            if (!this.controls.enabled) return;
            if (e.repeat) return; // Evita repeticiones automáticas del teclado
            switch (e.code) {
                case 'KeyW': this.keys.w = true; break;
                case 'KeyA': this.keys.a = true; break;
                case 'KeyS': this.keys.s = true; break;
                case 'KeyD': this.keys.d = true; break;
                case 'KeyF':
                    // Encender al pulsar (solo si eres buscador y no está encendida ya)
                    if (this.role === 'seeker' && !this.flashlightActive) {
                        this.toggleFlashlight();
                    }
                    break;
                case 'KeyE':
                    if (this.role === 'invisible') this.whistle();
                    break;
            }
        });

        window.addEventListener('keyup', (e) => {
            switch (e.code) {
                case 'KeyW': this.keys.w = false; break;
                case 'KeyA': this.keys.a = false; break;
                case 'KeyS': this.keys.s = false; break;
                case 'KeyD': this.keys.d = false; break;
                case 'KeyF':
                    // Apagar al soltar la tecla
                    if (this.role === 'seeker' && this.flashlightActive) {
                        this.toggleFlashlight();
                    }
                    break;
            }
        });

        // Clic para disparar la pistola de paintball (solo buscador)
        document.addEventListener('mousedown', (e) => {
            if (this.controls.enabled && this.role === 'seeker' && e.button === 0) {
                this.shootPaintball();
            }
        });

        this.btnRestart.addEventListener('click', () => {
            window.location.reload();
        });
    }

    buildMap() {
        // Límites del almacén (Suelo de hormigón)
        const floorGeo = new THREE.PlaneGeometry(100, 100);
        const floorMat = new THREE.MeshStandardMaterial({ 
            color: 0x3a3d45, 
            roughness: 0.8,
            metalness: 0.1
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Estructuras de las paredes externas
        const wallMat = new THREE.MeshStandardMaterial({ color: 0x1c1e24 });
        const createWall = (w, h, d, px, py, pz) => {
            const wallGeo = new THREE.BoxGeometry(w, h, d);
            const mesh = new THREE.Mesh(wallGeo, wallMat);
            mesh.position.set(px, py, pz);
            mesh.receiveShadow = true;
            mesh.castShadow = true;
            this.scene.add(mesh);
        };
        createWall(100, 16, 2, 0, 8, -50);
        createWall(100, 16, 2, 0, 8, 50);
        createWall(2, 16, 100, -50, 8, 0);
        createWall(2, 16, 100, 50, 8, 0);

        // Columnas industriales y estanterías en el almacén (obstáculos)
        this.obstacles = [];
        this.obstacleBoxes = []; // Cajas de colisión precomputadas
        const boxMat = new THREE.MeshStandardMaterial({ color: 0xc89f65, roughness: 0.9 }); // Cajas de madera
        const shelfMetalMat = new THREE.MeshStandardMaterial({ color: 0x2b2e36, metalness: 0.7 });

        const placeObstacleMesh = (mesh) => {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            this.obstacles.push(mesh);

            // Calcular límites en espacio mundial usando la boundingBox local y la posición del mesh (muy robusto y sin dependencias de matrixWorld o parameters)
            const geom = mesh.geometry;
            if (geom) {
                if (!geom.boundingBox) {
                    geom.computeBoundingBox();
                }
                const localBox = geom.boundingBox;
                if (localBox) {
                    const minX = localBox.min.x + mesh.position.x;
                    const maxX = localBox.max.x + mesh.position.x;
                    const minZ = localBox.min.z + mesh.position.z;
                    const maxZ = localBox.max.z + mesh.position.z;
                    
                    this.obstacleBoxes.push({ minX, maxX, minZ, maxZ });
                }
            }
        };

        // Generar estanterías llenas de cajas estilizadas sencillas
        for (let i = -30; i <= 30; i += 15) {
            if (i === 0) continue; // Dejar pasillo central libre
            for (let j = -30; j <= 30; j += 20) {
                // Estante metálico principal
                const shelfGeo = new THREE.BoxGeometry(2, 10, 8);
                const shelf = new THREE.Mesh(shelfGeo, shelfMetalMat);
                shelf.position.set(i, 5, j);
                placeObstacleMesh(shelf);

                // Cajas colocadas encima de los estantes
                const c1 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), boxMat);
                c1.position.set(i, 1.5, j - 2);
                placeObstacleMesh(c1);

                const c2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), boxMat);
                c2.position.set(i, 1.5, j + 2);
                placeObstacleMesh(c2);

                const c3 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), boxMat);
                c3.position.set(i, 5.5, j);
                placeObstacleMesh(c3);
            }
        }

        // Cajas sueltas y esquinas para esconderse
        const spawnBoxes = [
            [5, 1, 5], [-8, 1, -12], [22, 1, -25], [-18, 1, 24], [0, 1.5, -35]
        ];
        spawnBoxes.forEach(pos => {
            const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), boxMat);
            box.position.set(...pos);
            placeObstacleMesh(box);
        });
    }

    spawnPlayers() {
        if (this.role === 'seeker') {
            // Buscador empieza en el centro
            this.camera.position.set(0, 2, 0);
        } else {
            // Invisibles empiezan al fondo del almacén
            this.camera.position.set(0, 2, 40);
        }

        // Crear la representación visual del contrincante en la escena
        const playerGeo = new THREE.CylinderGeometry(0.8, 0.8, 3.2, 16);
        let playerMat;

        if (this.role === 'seeker') {
            // Yo soy el buscador. El otro es el invisible.
            // Para mí, el otro es invisible por defecto, pero brillará en rojo neón al recibir luz UV
            playerMat = new THREE.MeshBasicMaterial({ 
                color: 0xff3333, 
                transparent: true, 
                opacity: 0.0,
                depthWrite: false
            });
            this.otherPlayerMesh = new THREE.Mesh(playerGeo, playerMat);
            this.scene.add(this.otherPlayerMesh);
        } else {
            // Yo soy el invisible. El otro es el buscador.
            // El buscador es visible todo el tiempo en color rojo brillante para poder esquivarlo
            playerMat = new THREE.MeshStandardMaterial({ 
                color: 0xff3333, 
                roughness: 0.2, 
                metalness: 0.8,
                emissive: 0xaa0000
            });
            this.otherPlayerMesh = new THREE.Group();

            const bodyMesh = new THREE.Mesh(playerGeo, playerMat);
            this.otherPlayerMesh.add(bodyMesh);

            // Pequeño visor/indicador en la frente del buscador que apunta hacia el frente (Eje Z negativo)
            const visorGeo = new THREE.BoxGeometry(0.6, 0.4, 0.8);
            const visorMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 }); // Amarillo/Naranja brillante
            const visorMesh = new THREE.Mesh(visorGeo, visorMat);
            visorMesh.position.set(0, 1.0, -0.6); // Situado en la frente apuntando hacia adelante
            this.otherPlayerMesh.add(visorMesh);

            this.scene.add(this.otherPlayerMesh);
        }
    }

    toggleFlashlight() {
        if (!this.flashlightActive && (this.battery <= 0 || this.flashlightLocked)) return;
        this.flashlightActive = !this.flashlightActive;
        this.playSynthSound('click');

        if (this.flashlightActive) {
            // Añadir Spotlight de luz violeta UV
            this.flashlightSpot = new THREE.SpotLight(0x9d4edd, 8, 40, Math.PI / 5, 0.5, 1);
            this.flashlightSpot.castShadow = true;
            this.flashlightSpot.shadow.mapSize.width = 512;
            this.flashlightSpot.shadow.mapSize.height = 512;
            this.scene.add(this.flashlightSpot);

            // Cono visual violeta semi-transparente
            const coneGeo = new THREE.ConeGeometry(5, 25, 16, 1, true);
            const coneMat = new THREE.MeshBasicMaterial({
                color: 0x9d4edd,
                transparent: true,
                opacity: 0.1,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            this.flashlightConeVisual = new THREE.Mesh(coneGeo, coneMat);
            this.flashlightConeVisual.rotation.x = -Math.PI / 2;
            // Desplazar el pivote del cono al extremo para que apunte bien
            this.flashlightConeVisual.position.z = -12.5;
            this.camera.add(this.flashlightConeVisual);
            this.scene.add(this.camera); // Asegura que la jerarquía esté acoplada
        } else {
            this.removeFlashlight();
        }

        // Avisar a la red de que encendimos/apagamos la linterna
        window.networkManager.send({
            type: 'flashlight',
            active: this.flashlightActive
        });
    }

    removeFlashlight() {
        if (this.flashlightSpot) {
            this.scene.remove(this.flashlightSpot);
            this.flashlightSpot = null;
        }
        if (this.flashlightConeVisual) {
            this.camera.remove(this.flashlightConeVisual);
            this.flashlightConeVisual = null;
        }
        this.flashlightActive = false;
    }

    shootPaintball() {
        if (!this.ammoReady) return;

        this.ammoReady = false;
        this.playSynthSound('shot');
        
        // Estilo UI recargando
        this.ammoIndicator.className = "ammo-box reloading";
        this.ammoStatus.textContent = "RECARGANDO...";

        // Lanzamos un rayo desde el centro de la pantalla
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);

        // Detectar si golpeamos al invisible
        const intersects = raycaster.intersectObject(this.otherPlayerMesh);
        if (intersects.length > 0 && intersects[0].distance < 35) {
            // El buscador acierta y gana la partida
            this.endGame('seeker-wins');
        } else {
            // Falló el disparo, dejamos una mancha de pintura paintball en las paredes u obstáculos
            const mapIntersects = raycaster.intersectObjects(this.obstacles.concat(this.scene.children.filter(c => c.type === 'Mesh')));
            if (mapIntersects.length > 0) {
                this.spawnPaintSplatter(mapIntersects[0]);
            }
        }

        // Avisar a la red del disparo
        window.networkManager.send({
            type: 'shot',
            direction: this.camera.getWorldDirection(new THREE.Vector3())
        });

        // Esperar tiempo de recarga
        setTimeout(() => {
            this.ammoReady = true;
            this.playSynthSound('reload');
            this.ammoIndicator.className = "ammo-box ready";
            this.ammoStatus.textContent = "LISTO";
        }, this.reloadTime);
    }

    spawnPaintSplatter(intersection) {
        // Crear una pequeña mancha de pintura circular de color fucsia en la superficie impactada
        const splatterGeo = new THREE.RingGeometry(0.1, 0.4, 16);
        const splatterMat = new THREE.MeshBasicMaterial({
            color: 0xff007f, // Fucsia paintball
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const splatter = new THREE.Mesh(splatterGeo, splatterMat);
        
        // Colocar en el punto de impacto y alinear con la normal de la superficie
        splatter.position.copy(intersection.point).add(intersection.face.normal.clone().multiplyScalar(0.02));
        
        const lookAtTarget = intersection.point.clone().add(intersection.face.normal);
        splatter.lookAt(lookAtTarget);

        this.scene.add(splatter);

        // Desaparece en 10 segundos
        setTimeout(() => {
            this.scene.remove(splatter);
        }, 10000);
    }

    whistle() {
        if (!this.canWhistle) return;
        this.canWhistle = false;
        this.playSynthSound('whistle');

        // Generar una onda visual circular desde la posición del invisible
        const waveGeo = new THREE.RingGeometry(0.1, 0.8, 32);
        const waveMat = new THREE.MeshBasicMaterial({
            color: 0x39ff14,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });
        const wave = new THREE.Mesh(waveGeo, waveMat);
        wave.position.copy(this.camera.position);
        wave.position.y = 0.1; // pegado al suelo
        wave.rotation.x = -Math.PI / 2;
        this.scene.add(wave);

        // Animación de propagación del silbido
        let size = 0.8;
        const animateWave = () => {
            size += 0.4;
            wave.scale.set(size, size, 1);
            waveMat.opacity -= 0.025;
            if (waveMat.opacity > 0) {
                requestAnimationFrame(animateWave);
            } else {
                this.scene.remove(wave);
            }
        };
        animateWave();

        // Enviar evento de silbido
        window.networkManager.send({
            type: 'whistle',
            position: this.camera.position.toArray()
        });

        // Cooldown del silbato (5 segundos)
        setTimeout(() => {
            this.canWhistle = true;
        }, 5000);
    }

    spawnFootstep() {
        if (this.role !== 'invisible') return;
        const now = performance.now();
        if (now - this.lastFootstepTime < this.footstepInterval) return;

        this.lastFootstepTime = now;

        // Crear una pequeña huella neón en el suelo
        const stepGeo = new THREE.CircleGeometry(0.2, 8);
        const stepMat = new THREE.MeshBasicMaterial({
            color: 0x39ff14,
            transparent: true,
            opacity: 0.9,
            depthWrite: false
        });
        const step = new THREE.Mesh(stepGeo, stepMat);
        step.position.copy(this.camera.position);
        step.position.y = 0.02; // Apenas por encima del suelo para evitar Z-fighting
        step.rotation.x = -Math.PI / 2;
        
        // Guardamos
        this.footsteps.push({
            mesh: step,
            created: now
        });

        this.scene.add(step);

        // Avisar a la red sobre la creación de la huella
        window.networkManager.send({
            type: 'footstep',
            position: step.position.toArray()
        });
    }

    sendPositionUpdate() {
        window.networkManager.send({
            type: 'move',
            position: this.camera.position.toArray(),
            yRotation: this.cameraYaw
        });
    }

    handleNetworkData(data) {
        if (!this.gameActive) return;

        if (data.type === 'move') {
            console.log("Recibido movimiento contrincante:", data.position);
            // Sincronizar posición y rotación del contrincante
            this.otherPlayerMesh.position.fromArray(data.position);
            // Sincronizamos la rotación Y (el giro hacia los lados) para el modelo
            if (data.yRotation !== undefined) {
                this.otherPlayerMesh.rotation.y = data.yRotation; 
            }
        } else if (data.type === 'flashlight') {
            // Si el buscador enciende/apaga su linterna, el cliente invisible lo sincroniza en su pantalla
            this.otherPlayerFlashlightActive = data.active;
        } else if (data.type === 'footstep') {
            // El buscador recibe las huellas del invisible
            const stepGeo = new THREE.CircleGeometry(0.2, 8);
            // Empiezan 100% invisibles para el buscador
            const stepMat = new THREE.MeshBasicMaterial({
                color: 0x39ff14,
                transparent: true,
                opacity: 0.0, 
                depthWrite: false
            });
            const step = new THREE.Mesh(stepGeo, stepMat);
            step.position.fromArray(data.position);
            step.position.y = 0.02;
            step.rotation.x = -Math.PI / 2;

            this.footsteps.push({
                mesh: step,
                created: performance.now()
            });
            this.scene.add(step);
        } else if (data.type === 'whistle') {
            this.playSynthSound('whistle');
            
            // Si soy el buscador, dibujo el anillo del silbido delatando su posición aproximada
            if (this.role === 'seeker') {
                const waveGeo = new THREE.RingGeometry(0.1, 0.8, 32);
                const waveMat = new THREE.MeshBasicMaterial({
                    color: 0x39ff14,
                    transparent: true,
                    opacity: 0.8,
                    side: THREE.DoubleSide
                });
                const wave = new THREE.Mesh(waveGeo, waveMat);
                wave.position.fromArray(data.position);
                wave.position.y = 0.1;
                wave.rotation.x = -Math.PI / 2;
                this.scene.add(wave);

                let size = 0.8;
                const animateWave = () => {
                    size += 0.4;
                    wave.scale.set(size, size, 1);
                    waveMat.opacity -= 0.025;
                    if (waveMat.opacity > 0) {
                        requestAnimationFrame(animateWave);
                    } else {
                        this.scene.remove(wave);
                    }
                };
                animateWave();
            }
        } else if (data.type === 'shot') {
            this.playSynthSound('shot');
        } else if (data.type === 'gameover') {
            this.endGame(data.reason);
        }
    }

    endGame(reason) {
        this.gameActive = false;
        if (this.netHeartbeat) clearInterval(this.netHeartbeat);
        this.removeFlashlight();
        document.exitPointerLock();

        this.gameoverScreen.classList.remove('hidden');
        this.hudContainer.classList.add('hidden');

        if (reason === 'seeker-wins') {
            if (this.role === 'seeker') {
                this.gameoverTitle.textContent = "¡VICTORIA!";
                this.gameoverTitle.className = "victory-text";
                this.gameoverDesc.textContent = "Encontraste al Invisible a tiempo.";
            } else {
                this.gameoverTitle.textContent = "¡DERROTA!";
                this.gameoverTitle.className = "defeat-text";
                this.gameoverDesc.textContent = "El Buscador te ha marcado con paintball.";
            }
        }

        // Avisar a la red si fuimos nosotros quienes desencadenamos el fin
        window.networkManager.send({
            type: 'gameover',
            reason: reason
        });
    }

    checkUVVisibility() {
        if (this.role !== 'seeker') return;

        // Comprobamos si el invisible está dentro de la linterna del buscador
        if (!this.flashlightActive || this.battery <= 0) {
            this.otherPlayerMesh.material.opacity = 0;
            return;
        }

        // Dirección de la linterna y posición del enemigo
        const seekerPos = this.camera.position;
        const enemyPos = this.otherPlayerMesh.position;
        const dist = seekerPos.distanceTo(enemyPos);

        if (dist > 35) { // Rango máximo de la linterna UV
            this.otherPlayerMesh.material.opacity = 0;
            return;
        }

        const seekerDir = this.camera.getWorldDirection(new THREE.Vector3());
        const toEnemy = new THREE.Vector3().subVectors(enemyPos, seekerPos).normalize();
        
        // Ángulo entre la linterna y el enemigo
        const angle = seekerDir.angleTo(toEnemy);

        if (angle < Math.PI / 6) { // Dentro del cono
            // El camaleón brilla
            this.otherPlayerMesh.material.opacity = 0.9;
        } else {
            this.otherPlayerMesh.material.opacity = 0.0;
        }
    }

    updateFlashlightPosition() {
        if (this.flashlightSpot) {
            // Mover la luz física de la linterna con la cámara del buscador
            this.flashlightSpot.position.copy(this.camera.position);
            const targetPos = new THREE.Vector3();
            this.camera.getWorldDirection(targetPos);
            targetPos.multiplyScalar(20).add(this.camera.position);
            this.flashlightSpot.target.position.copy(targetPos);
            this.flashlightSpot.target.updateMatrixWorld();
        }
    }

    updateBattery(delta) {
        if (this.role !== 'seeker') return;

        if (this.flashlightActive) {
            this.battery = Math.max(0, this.battery - this.batteryDepletionRate * delta);
            if (this.battery === 0) {
                this.flashlightLocked = true; // Bloquear linterna
                this.toggleFlashlight(); // Se apaga sola al agotarse
                this.batteryBar.style.backgroundColor = '#ef4444'; // Cambiar barra a rojo (indicando bloqueo)
            }
        } else {
            this.battery = Math.min(100, this.battery + this.batteryRecoveryRate * delta);
            // Si estaba bloqueada y ya cargó por encima del 25%, se desbloquea
            if (this.flashlightLocked && this.battery >= 25.0) {
                this.flashlightLocked = false;
                this.batteryBar.style.backgroundColor = ''; // Volver al color violeta neón normal
            }
        }

        // Actualizar barra de UI
        this.batteryBar.style.width = `${this.battery}%`;
    }

    updateFootsteps(delta) {
        const now = performance.now();
        const fadeTime = 6000; // Las huellas duran 6 segundos

        for (let i = this.footsteps.length - 1; i >= 0; i--) {
            const step = this.footsteps[i];
            const age = now - step.created;

            if (age > fadeTime) {
                this.scene.remove(step.mesh);
                this.footsteps.splice(i, 1);
                continue;
            }

            // Lógica de visibilidad UV para el Buscador
            if (this.role === 'seeker') {
                if (this.flashlightActive) {
                    const dist = this.camera.position.distanceTo(step.mesh.position);
                    const dir = this.camera.getWorldDirection(new THREE.Vector3());
                    const toStep = new THREE.Vector3().subVectors(step.mesh.position, this.camera.position).normalize();
                    const angle = dir.angleTo(toStep);

                    if (dist < 35 && angle < Math.PI / 6) {
                        // El haz ultravioleta hace brillar la huella
                        step.mesh.material.opacity = (1 - age / fadeTime) * 0.8;
                    } else {
                        step.mesh.material.opacity = 0;
                    }
                } else {
                    step.mesh.material.opacity = 0;
                }
            } else {
                // Para el propio invisible, se ven siempre ligeramente translúcidas
                step.mesh.material.opacity = (1 - age / fadeTime) * 0.5;
            }
        }
    }

    animate() {
        if (!this.gameActive) return;

        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();

        // Control y movimiento del jugador
        if (this.controls.enabled) {
            const camera = this.camera;

            this.direction.z = Number(this.keys.w) - Number(this.keys.s);
            this.direction.x = Number(this.keys.a) - Number(this.keys.d);
            this.direction.normalize();

            // Moverse
            this.velocity.z = -this.direction.z * this.moveSpeed * delta;
            this.velocity.x = -this.direction.x * this.moveSpeed * delta;

            const prevPos = camera.position.clone();
            camera.translateX(this.velocity.x);
            camera.translateZ(this.velocity.z);
            camera.position.y = 2; // Mantener altura fija

            // Colisiones simples con los bordes del mapa
            camera.position.x = Math.max(-48, Math.min(48, camera.position.x));
            camera.position.z = Math.max(-48, Math.min(48, camera.position.z));

            // Colisiones con obstáculos (estanterías y cajas) usando límites precomputados
            const playerRadius = 0.8;
            if (this.obstacleBoxes) {
                for (const box of this.obstacleBoxes) {
                    const minX = box.minX - playerRadius;
                    const maxX = box.maxX + playerRadius;
                    const minZ = box.minZ - playerRadius;
                    const maxZ = box.maxZ + playerRadius;

                    if (camera.position.x >= minX && camera.position.x <= maxX &&
                        camera.position.z >= minZ && camera.position.z <= maxZ) {
                        camera.position.copy(prevPos); // Revertir movimiento si choca
                        break;
                    }
                }
            }

            // Si nos hemos movido, registrar y enviar actualización por red
            if (prevPos.distanceTo(camera.position) > 0.005) {
                this.sendPositionUpdate();
                if (this.role === 'invisible') {
                    this.spawnFootstep();
                }
            }
        }


        // Actualizaciones de mecánicas
        this.updateFlashlightPosition();
        this.updateBattery(delta);
        this.updateFootsteps(delta);
        this.checkUVVisibility();

        // Renderizado
        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

// Inicializar el puente entre Red y Juego
window.networkManager.onConnectCallback = (role) => {
    const game = new Game();
    game.start(role);
};
