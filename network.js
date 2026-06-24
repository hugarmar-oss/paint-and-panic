// Administrador de Red P2P usando PeerJS para Paint and Panic
class NetworkManager {
    constructor() {
        this.peer = null;
        this.conn = null;
        this.role = null; // 'seeker' o 'invisible'
        this.isHost = false;
        
        // Callbacks registrados por el bucle de juego
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

        this.btnCreate.addEventListener('click', () => this.createLobby());
        this.btnJoin.addEventListener('click', () => this.joinLobby());
        this.btnCancel.addEventListener('click', () => this.cancelLobby());
        this.btnCopy.addEventListener('click', () => this.copyLobbyId());
    }

    createLobby() {
        this.isHost = true;
        this.role = 'seeker'; // El host por defecto es el Buscador
        this.connectionMenu.classList.add('hidden');
        this.lobbyStatus.classList.remove('hidden');
        this.displayLobbyId.textContent = "Generando...";

        // Inicializamos PeerJS sin ID específico para que asigne uno aleatorio
        this.peer = new Peer(null, {
            debug: 1
        });

        this.peer.on('open', (id) => {
            this.displayLobbyId.textContent = id;
        });

        this.peer.on('connection', (conn) => {
            // El host acepta la conexión entrante del cliente
            this.conn = conn;
            this.setupConnection();
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
        this.role = 'invisible'; // El jugador que se une es el Invisible
        this.btnJoin.disabled = true;
        this.btnJoin.textContent = "Conectando...";

        this.peer = new Peer(null, {
            debug: 1
        });

        this.peer.on('open', () => {
            // Conectamos directamente con el Peer ID del host
            this.conn = this.peer.connect(targetId, {
                reliable: true
            });
            this.setupConnection();
        });

        this.peer.on('error', (err) => {
            console.error('Error al unirse:', err);
            alert('No se pudo conectar a la sala. Revisa el código.');
            this.btnJoin.disabled = false;
            this.btnJoin.textContent = "Unirse (Invisible)";
        });
    }

    setupConnection() {
        this.conn.on('open', () => {
            console.log('Conexión P2P establecida exitosamente.');
            this.lobbyContainer.classList.add('hidden');
            
            // Enviar confirmación de rol al conectarse
            if (this.isHost) {
                // El host le dice al cliente que su rol es invisible
                this.conn.send({ type: 'init-role', role: 'invisible' });
            }

            if (this.onConnectCallback) {
                this.onConnectCallback(this.role);
            }
        });

        this.conn.on('data', (data) => {
            if (data.type === 'init-role') {
                this.role = data.role;
                if (this.onConnectCallback) this.onConnectCallback(this.role);
                return;
            }
            if (this.onDataCallback) {
                this.onDataCallback(data);
            }
        });

        this.conn.on('close', () => {
            console.log('Conexión cerrada por el otro par.');
            if (this.onDisconnectCallback) {
                this.onDisconnectCallback();
            } else {
                alert('El otro jugador se ha desconectado.');
                window.location.reload();
            }
        });
    }

    send(data) {
        if (this.conn && this.conn.open) {
            this.conn.send(data);
        }
    }

    cancelLobby() {
        if (this.peer) {
            this.peer.destroy();
        }
        this.conn = null;
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

// Exportamos globalmente para game.js
window.networkManager = new NetworkManager();
