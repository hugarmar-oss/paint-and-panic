// Administrador de Red P2P en Estrella usando PeerJS para Paint and Panic
window.GAME_BUILD = '1.0.6';
const MAX_SURVIVORS = 10;
const MAX_PLAYERS = MAX_SURVIVORS + 1; // 1 cazador + 10 supervivientes

class NetworkManager {
    constructor() {
        this.peer = null;
        this.conn = null; // Conexión al host (si somos cliente)
        this.connections = {}; // Para el host: dict de peerId -> Connection
        this.players = {}; // dict de peerId -> { playerId, color, isHost }
        this.myId = null;
        this.role = null;
        this.isHost = false;
        this.gameStarted = false;
        this.roundTime = null;
        
        // Callbacks registrados por el juego
        this.onConnectCallback = null;
        this.onDataCallback = null;
        this.onDisconnectCallback = null;
        
        this.initUI();
    }

    initUI() {
        this.lobbyContainer = document.getElementById('lobby-container');
        this.btnCreate = document.getElementById('btn-create-lobby');
        this.btnJoin = document.getElementById('btn-join-lobby');
        this.inputLobbyId = document.getElementById('input-lobby-id');
        this.lobbyStatus = document.getElementById('lobby-status');
        this.connectionMenu = document.getElementById('connection-menu');
        this.displayLobbyId = document.getElementById('display-lobby-id');
        this.btnCopy = document.getElementById('btn-copy-code');
        this.btnCancel = document.getElementById('btn-cancel-lobby');
        
        // Nuevos elementos para multijugador
        this.btnStartGame = document.getElementById('btn-start-game');
        this.playersListDiv = document.getElementById('lobby-players-list');

        this.btnCreate.addEventListener('click', () => this.createLobby());
        this.btnJoin.addEventListener('click', () => this.joinLobby());
        this.btnCancel.addEventListener('click', () => this.cancelLobby());
        this.btnCopy.addEventListener('click', () => this.copyLobbyId());
        this.btnStartGame.addEventListener('click', () => this.startGame());
    }

    getAvailableColor() {
        const PRESET_COLORS = ['#39ff14', '#00f0ff', '#ff00ff', '#ffff00', '#ff5e00']; // Verde, Cian, Magenta, Amarillo, Naranja
        const usedColors = Object.values(this.players).map(p => p.color);
        for (const color of PRESET_COLORS) {
            if (!usedColors.includes(color)) {
                return color;
            }
        }
        return PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
    }

    updateLobbyUI() {
        if (!this.playersListDiv) return;
        this.playersListDiv.innerHTML = '';

        const playerIds = Object.keys(this.players);
        playerIds.forEach(id => {
            const player = this.players[id];
            
            const row = document.createElement('div');
            row.className = 'player-row';

            const dot = document.createElement('div');
            dot.className = 'player-dot';
            dot.style.backgroundColor = player.color;
            dot.style.boxShadow = `0 0 10px ${player.color}`;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'player-name';
            nameSpan.textContent = id === this.myId ? `Tú (${id.substring(0, 5)})` : `Jugador (${id.substring(0, 5)})`;

            const tagSpan = document.createElement('span');
            tagSpan.className = 'player-tag';
            tagSpan.textContent = player.isHost ? 'BUSCADOR' : 'INVISIBLE';
            if (player.isHost) {
                tagSpan.style.color = '#ff3333';
                tagSpan.style.borderColor = 'rgba(255, 51, 51, 0.4)';
            } else {
                tagSpan.style.color = player.color;
                tagSpan.style.borderColor = player.color;
            }

            row.appendChild(dot);
            row.appendChild(nameSpan);
            row.appendChild(tagSpan);
            this.playersListDiv.appendChild(row);
        });

        // Habilitar/deshabilitar botón de inicio para el host
        if (this.isHost && this.btnStartGame) {
            const invisibleCount = playerIds.length - 1; // Excluir host
            this.btnStartGame.textContent = `Iniciar Partida (${invisibleCount}/${MAX_SURVIVORS} invisibles)`;
            this.btnStartGame.disabled = invisibleCount === 0;
        }
    }

    createLobby() {
        this.isHost = true;
        this.role = 'seeker'; // El host es el Buscador
        this.connectionMenu.classList.add('hidden');
        this.lobbyStatus.classList.remove('hidden');
        this.btnStartGame.classList.remove('hidden');
        this.displayLobbyId.textContent = "Generando...";

        this.peer = new Peer(null, {
            debug: 1,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                ]
            }
        });

        this.peer.on('open', (id) => {
            this.displayLobbyId.textContent = id;
            this.myId = id;
            
            // Registrarnos a nosotros mismos
            this.players[id] = {
                playerId: id,
                color: '#ff3333', // Rojo Buscador
                isHost: true,
                role: 'seeker'
            };
            this.updateLobbyUI();
        });

        this.peer.on('connection', (conn) => {
            this.setupConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('Error en PeerJS:', err);
            alert('Error de conexión. Inténtalo de nuevo.');
            this.cancelLobby();
        });
    }

    joinLobby() {
        const targetId = this.inputLobbyId.value.trim();
        if (!targetId) {
            alert('Por favor introduce un código de sala válido.');
            return;
        }

        this.isHost = false;
        this.role = 'invisible';
        this.btnJoin.disabled = true;
        this.btnJoin.textContent = "Conectando...";
        this.btnStartGame.classList.add('hidden');

        this.peer = new Peer(null, {
            debug: 1,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                ]
            }
        });

        this.peer.on('open', (id) => {
            this.myId = id;
            this.conn = this.peer.connect(targetId, {
                reliable: true
            });
            this.setupConnection(this.conn);
            
            this.connectionMenu.classList.add('hidden');
            this.lobbyStatus.classList.remove('hidden');
        });

        this.peer.on('error', (err) => {
            console.error('Error al unirse:', err);
            alert('No se pudo conectar a la sala. Revisa el código.');
            this.cancelLobby();
        });
    }

    setupConnection(conn) {
        if (this.isHost && this.gameStarted) {
            conn.on('open', () => {
                conn.send({ type: 'lobby-full', message: 'La partida ya ha comenzado.' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }

        if (this.isHost && Object.keys(this.players).length >= MAX_PLAYERS) {
            conn.on('open', () => {
                conn.send({ type: 'lobby-full', message: `La sala está llena (máximo ${MAX_SURVIVORS} supervivientes).` });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }

        conn.on('open', () => {
            console.log('Conexión P2P establecida con:', conn.peer);
            
            if (this.isHost) {
                this.connections[conn.peer] = conn;
                
                const color = this.getAvailableColor();
                this.players[conn.peer] = {
                    playerId: conn.peer,
                    color: color,
                    isHost: false,
                    role: 'invisible'
                };

                // Enviar datos de rol e inicialización de jugadores
                conn.send({
                    type: 'init-role',
                    role: 'invisible',
                    playerId: conn.peer,
                    color: color,
                    players: this.players
                });

                // Notificar a todos los demás clientes
                this.broadcast({
                    type: 'player-joined',
                    playerId: conn.peer,
                    color: color,
                    players: this.players
                }, conn.peer);

                this.updateLobbyUI();
            }
        });

        conn.on('data', (data) => {
            if (data.type === 'init-role') {
                this.role = data.role;
                this.myId = data.playerId;
                this.players = data.players;
                this.updateLobbyUI();
                return;
            }

            if (data.type === 'player-joined') {
                this.players = data.players;
                this.updateLobbyUI();
                return;
            }

            if (data.type === 'player-left') {
                this.players = data.players;
                this.updateLobbyUI();
                if (!this.gameStarted) return;
            }

            if (data.type === 'start-game') {
                this.lobbyContainer.classList.add('hidden');
                if (data.roundTime) {
                    this.roundTime = data.roundTime;
                }
                if (this.onConnectCallback) {
                    this.onConnectCallback(this.role);
                }
                return;
            }

            if (data.type === 'lobby-full') {
                alert(data.message);
                this.cancelLobby();
                return;
            }

            // Identificar quién envió el paquete si no viene ya identificado
            if (!data.playerId) {
                data.playerId = conn.peer;
            }

            // Si somos Host, retransmitimos los datos a todos los demás clientes
            if (this.isHost) {
                this.broadcast(data, conn.peer);
            }

            // Pasar el paquete a la lógica de juego local
            if (this.onDataCallback) {
                this.onDataCallback(data);
            }
        });

        conn.on('close', () => {
            console.log('Conexión cerrada por:', conn.peer);
            
            if (this.isHost) {
                const peerId = conn.peer;
                delete this.connections[peerId];
                delete this.players[peerId];
                
                this.broadcast({
                    type: 'player-left',
                    playerId: peerId,
                    players: this.players
                });
                
                this.updateLobbyUI();

                if (this.onDataCallback) {
                    this.onDataCallback({
                        type: 'player-left',
                        playerId: peerId
                    });
                }
            } else {
                alert('El Buscador (Host) se ha desconectado.');
                window.location.reload();
            }
        });
    }

    broadcast(data, excludePeerId) {
        for (const id in this.connections) {
            if (id !== excludePeerId) {
                const conn = this.connections[id];
                if (conn && conn.open) {
                    conn.send(data);
                }
            }
        }
    }

    send(data) {
        if (!data.playerId) {
            data.playerId = this.myId;
        }
        if (this.isHost) {
            // El host difunde a todos los clientes
            this.broadcast(data);
        } else {
            // El cliente envía directo al host
            if (this.conn && this.conn.open) {
                this.conn.send(data);
            }
        }
    }

    startGame() {
        if (!this.isHost) return;
        this.gameStarted = true;

        const survivorCount = Object.keys(this.players).length - 1;
        this.roundTime = 60.0 + 30.0 * Math.max(1, survivorCount);

        // Difundir inicio a todos los clientes
        this.broadcast({ type: 'start-game', roundTime: this.roundTime });
        
        // Ocultar lobby local e iniciar
        this.lobbyContainer.classList.add('hidden');
        if (this.onConnectCallback) {
            this.onConnectCallback(this.role);
        }
    }

    cancelLobby() {
        if (this.peer) {
            this.peer.destroy();
        }
        this.conn = null;
        this.connections = {};
        this.players = {};
        this.lobbyStatus.classList.add('hidden');
        this.connectionMenu.classList.remove('hidden');
        this.btnJoin.disabled = false;
        this.btnJoin.textContent = "Unirse (Invisible)";
    }

    copyLobbyId() {
        const id = this.displayLobbyId.textContent;
        if (id && id !== "Generando...") {
            navigator.clipboard.writeText(id).then(() => {
                const prevText = this.btnCopy.textContent;
                this.btnCopy.textContent = "✅";
                setTimeout(() => {
                    this.btnCopy.textContent = prevText;
                }, 1500);
            });
        }
    }
}

// Inicializar globalmente
window.networkManager = new NetworkManager();
