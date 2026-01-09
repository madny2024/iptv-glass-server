const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// 1. CONFIGURAÇÃO DE PORTA (Obrigatório para Railway)
const PORT = process.env.PORT || 8080;

const app = express();
const server = http.createServer(app);

// 2. MIDDLEWARES BÁSICOS
app.use(cors());
app.use(express.json());

// ==========================================
// 3. ROTA DE PROXY (CRÍTICO: TEM QUE VIR ANTES DO SITE)
// ==========================================
app.get('/proxy', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: "URL não fornecida" });
    }

    try {
        console.log(`📥 Proxy requisitando: ${url}`);
        
        const response = await axios.get(url, {
            // Configurações para aguentar listas grandes
            timeout: 60000, 
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            responseType: 'json', // Tenta forçar JSON
            headers: {
                'User-Agent': 'IPTV Smarters Pro',
                'Accept': 'application/json'
            }
        });

        // Retorna os dados para o frontend
        res.json(response.data);

    } catch (error) {
        console.error("❌ Erro no Proxy:", error.message);
        // Retorna um JSON de erro, NUNCA HTML
        res.status(500).json({ 
            error: "Erro ao buscar lista", 
            details: error.message 
        });
    }
});

// ==========================================
// 4. SERVIR O SITE (FRONTEND)
// ==========================================
// Serve os arquivos HTML, CSS que estão na mesma pasta
app.use(express.static(__dirname));

// Garante que a rota raiz abra o login
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Fallback: Se tentar acessar uma página que não existe, volta pro index
app.get('*', (req, res) => {
    // Só envia o index se NÃO for uma requisição de API
    if (req.accepts('html')) {
        res.sendFile(path.join(__dirname, 'index.html'));
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// ==========================================
// 5. SOCKET.IO (CONTROLE REMOTO E PAREAMENTO)
// ==========================================
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

io.on('connection', (socket) => {
    console.log('🔌 Dispositivo conectado:', socket.id);

    socket.on('join_room', (data) => {
        const room = typeof data === 'object' ? data.room : data;
        if (room) {
            socket.join(room);
            socket.emit('room_joined', { room });
            // Avisa outros na sala que alguém entrou
            socket.to(room).emit('peer_joined', { type: data.type });
            
            // Atualiza contagem
            const connections = io.sockets.adapter.rooms.get(room)?.size || 0;
            io.to(room).emit('session_status', { connections });
        }
    });

    // Enviar vídeo do Site -> Celular
    socket.on('cast_video', (data) => {
        if (data.room) {
            io.to(data.room).emit('play_video', data);
            console.log(`▶️ Cast enviado para sala ${data.room}`);
        }
    });

    // Comandos do Controle Remoto
    socket.on('remote_control', (data) => {
        if (data.room) {
            io.to(data.room).emit('control_command', data);
        }
    });

    // Status do Player (Sincronização)
    socket.on('app_status', (data) => {
        if (data.room) {
            io.to(data.room).emit('player_status', data);
        }
    });

    socket.on('disconnecting', () => {
        // Notifica as salas que o usuário está saindo
        for (const room of socket.rooms) {
            if (room !== socket.id) {
                socket.to(room).emit('peer_left', { id: socket.id });
            }
        }
    });
});

// ==========================================
// 6. INICIALIZAÇÃO
// ==========================================
server.listen(PORT, () => {
    console.log(`🚀 SERVIDOR IPTV GLASS ONLINE NA PORTA ${PORT}`);
});
