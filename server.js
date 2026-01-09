// ======================================================
// SERVER.JS - SISTEMA DE PAREAMENTO IPTV GLASS V3
// ======================================================
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const { Server } = require("socket.io");
const os = require('os');

const app = express();
const PORT = process.env.PORT || 8888;

// Armazena conexões ativas por sala
const activeSessions = new Map();

// Middleware de Log
app.use((req, res, next) => {
    const timestamp = new Date().toLocaleTimeString();
    if(!req.url.includes('socket') && !req.url.includes('favicon')) {
        console.log(`[${timestamp}] 📡 ${req.method} ${req.url}`);
    }
    next();
});

app.use(cors({ origin: "*" }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000,
    pingInterval: 25000
});

// --- ROTA DE PROXY OTIMIZADA ---
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send("URL ausente");

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive'
    };

    if (req.headers.range) headers['Range'] = req.headers.range;

    try {
        const response = await axios({
            method: 'get',
            url: targetUrl,
            responseType: 'stream',
            headers: headers,
            timeout: 30000,
            maxRedirects: 5,
            validateStatus: status => status >= 200 && status < 400
        });

        // Transfere headers importantes
        const h = response.headers;
        if (h['content-length']) res.setHeader('content-length', h['content-length']);
        if (h['content-type']) res.setHeader('content-type', h['content-type']);
        if (h['content-range']) res.setHeader('content-range', h['content-range']);
        if (h['accept-ranges']) res.setHeader('accept-ranges', h['accept-ranges']);
        
        // CORS Headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range');
        
        res.status(response.status);
        response.data.pipe(res);

        // Cleanup ao finalizar
        response.data.on('end', () => {
            if (!res.headersSent) res.end();
        });

        response.data.on('error', (err) => {
            console.error('[PROXY STREAM ERROR]', err.message);
            if (!res.headersSent) res.status(500).end();
        });

    } catch (error) {
        console.error(`[PROXY ERROR] ${error.message}`);
        if (!res.headersSent) {
            res.status(error.response?.status || 500).send("Erro no Proxy");
        }
    }
});

// Servir arquivos estáticos
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

// --- API REST PARA STATUS ---
app.get('/api/sessions', (req, res) => {
    const sessions = Array.from(activeSessions.entries()).map(([room, data]) => ({
        room,
        connections: data.connections,
        lastActivity: data.lastActivity
    }));
    res.json({ total: sessions.length, sessions });
});

// --- LÓGICA DE PAREAMENTO (SOCKET.IO) ---
io.on('connection', (socket) => {
    console.log(`⚡ Nova Conexão: ${socket.id}`);
    
    let currentRoom = null;
    let deviceType = 'unknown'; // 'web' ou 'app'

    // 1. ENTRAR EM UMA SALA COM CÓDIGO
    socket.on('join_room', (data) => {
        const roomCode = typeof data === 'string' ? data : data.room;
        deviceType = data.type || 'web';
        
        if (!roomCode) {
            socket.emit('error', { message: 'Código de sala inválido' });
            return;
        }

        // Sai da sala anterior se existir
        if (currentRoom) {
            socket.leave(currentRoom);
            updateSessionCount(currentRoom, -1);
        }

        // Entra na nova sala
        socket.join(roomCode);
        currentRoom = roomCode;
        updateSessionCount(roomCode, 1);

        console.log(`🔗 [${deviceType.toUpperCase()}] ${socket.id} → Sala: ${roomCode}`);
        
        // Confirma entrada
        socket.emit('room_joined', { 
            room: roomCode, 
            type: deviceType,
            timestamp: Date.now() 
        });

        // Notifica outros dispositivos na sala
        socket.to(roomCode).emit('peer_joined', { 
            type: deviceType,
            socketId: socket.id 
        });

        // Envia status atualizado
        broadcastSessionStatus(roomCode);
    });

    // 2. ENVIAR VÍDEO (CAST)
    socket.on('cast_video', (data) => {
        const room = data.room || currentRoom;
        
        if (!room) {
            socket.emit('error', { message: 'Nenhuma sala ativa' });
            return;
        }

        console.log(`🎬 [CAST] Sala ${room}: ${data.url?.substring(0, 50)}...`);
        
        // Envia apenas para dispositivos APP na sala
        socket.to(room).emit('play_video', {
            url: data.url,
            title: data.title,
            timestamp: Date.now(),
            sender: socket.id
        });

        // Confirma envio
        socket.emit('cast_success', { room, timestamp: Date.now() });
    });

    // 3. COMANDOS DE CONTROLE REMOTO
    socket.on('remote_control', (data) => {
        const room = data.room || currentRoom;
        
        if (!room) return;

        console.log(`🎮 [CONTROL] ${data.action} → Sala ${room}`);
        
        socket.to(room).emit('control_command', {
            action: data.action,
            value: data.value,
            timestamp: Date.now(),
            sender: socket.id
        });
    });

    // 4. STATUS DO APP (Sincronização)
    socket.on('app_status', (data) => {
        const room = data.room || currentRoom;
        
        if (!room) return;

        // Envia status apenas para WEB na sala
        socket.to(room).emit('player_status', {
            isPlaying: data.isPlaying,
            currentTime: data.currentTime,
            duration: data.duration,
            timestamp: Date.now()
        });

        // Atualiza última atividade
        if (activeSessions.has(room)) {
            activeSessions.get(room).lastActivity = Date.now();
        }
    });

    // 5. PING/PONG (Keep-Alive)
    socket.on('ping', (data) => {
        socket.emit('pong', { timestamp: Date.now() });
    });

    // 6. DESCONEXÃO
    socket.on('disconnect', (reason) => {
        console.log(`❌ Desconectado: ${socket.id} (${reason})`);
        
        if (currentRoom) {
            updateSessionCount(currentRoom, -1);
            
            // Notifica outros na sala
            socket.to(currentRoom).emit('peer_left', { 
                socketId: socket.id,
                type: deviceType 
            });
            
            broadcastSessionStatus(currentRoom);
        }
    });

    // HELPER: Gerenciar contagem de conexões
    function updateSessionCount(room, delta) {
        if (!activeSessions.has(room)) {
            activeSessions.set(room, { 
                connections: 0, 
                lastActivity: Date.now() 
            });
        }
        
        const session = activeSessions.get(room);
        session.connections = Math.max(0, session.connections + delta);
        session.lastActivity = Date.now();

        // Remove salas vazias
        if (session.connections === 0) {
            activeSessions.delete(room);
            console.log(`🗑️  Sala ${room} removida (vazia)`);
        }
    }

    // HELPER: Broadcast status da sala
    function broadcastSessionStatus(room) {
        const session = activeSessions.get(room);
        if (!session) return;

        io.to(room).emit('session_status', {
            room,
            connections: session.connections,
            timestamp: Date.now()
        });
    }
});

// Limpeza automática de salas inativas (30min)
setInterval(() => {
    const now = Date.now();
    const TIMEOUT = 30 * 60 * 1000; // 30 minutos

    for (const [room, data] of activeSessions.entries()) {
        if (now - data.lastActivity > TIMEOUT) {
            activeSessions.delete(room);
            console.log(`🧹 Sala ${room} expirada (inatividade)`);
        }
    }
}, 5 * 60 * 1000); // Verifica a cada 5min

// --- FUNÇÃO AUXILIAR: IP LOCAL ---
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// --- INICIALIZAÇÃO DO SERVIDOR ---
server.listen(PORT, '0.0.0.0', () => {
    const localIp = getLocalIp();
    
    console.clear();
    console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║         🎬 IPTV GLASS - SERVIDOR V3 ATIVO            ║
║                                                       ║
║  Sistema de Pareamento: ✅ OPERACIONAL               ║
║  Proxy de Stream:        ✅ ATIVO                    ║
║  WebSocket (Socket.IO):  ✅ ONLINE                   ║
║                                                       ║
║───────────────────────────────────────────────────────║
║                                                       ║
║  🖥️  Acesso Web (Navegador):                         ║
║      http://localhost:${PORT}                          ║
║      http://${localIp}:${PORT}                ║
║                                                       ║
║  📱 Acesso App (Celular na mesma rede):              ║
║      http://${localIp}:${PORT}                ║
║                                                       ║
║  📊 Monitoramento:                                   ║
║      http://${localIp}:${PORT}/api/sessions   ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
    `);
    console.log(`🚀 Aguardando conexões...\n`);
});
