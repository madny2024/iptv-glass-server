const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// 1. PORTA DO RAILWAY
const PORT = process.env.PORT || 8888;

const app = express();
const server = http.createServer(app);

// 2. MIDDLEWARES
app.use(cors());
app.use(express.json());

// =======================================================
// 3. API PROXY (IMPORTANTE: FICA ANTES DO SITE AGORA)
// =======================================================
app.get('/proxy', async (req, res) => {
    const { url } = req.query;

    if (!url) return res.status(400).json({ error: "URL não fornecida." });

    try {
        // console.log(`📥 Proxy solicitando: ${url}`);
        const response = await axios.get(url, {
            timeout: 60000, 
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            headers: { 'User-Agent': 'IPTV Smarters Pro' }
        });
        res.send(response.data);
    } catch (error) {
        console.error("❌ Erro Proxy:", error.message);
        // Retorna JSON de erro, não HTML
        res.status(500).json({ error: "Falha ao buscar lista" });
    }
});

// =======================================================
// 4. SITE ESTÁTICO (FRONTEND)
// =======================================================
app.use(express.static(__dirname));

// Rota padrão para abrir o Login
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// =======================================================
// 5. SOCKET.IO (CONTROLE E APP)
// =======================================================
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

io.on('connection', (socket) => {
    // console.log('Conectado:', socket.id);

    socket.on('join_room', (data) => {
        const room = typeof data === 'object' ? data.room : data;
        if(room) socket.join(room);
    });

    socket.on('send_video', (data) => {
        if(data.room) io.to(data.room).emit('play_video', data);
    });

    socket.on('remote_control', (data) => {
        if (data.room) io.to(data.room).emit('control_command', data);
    });

    socket.on('app_status', (data) => {
        if (data.room) io.to(data.room).emit('player_status', data);
    });
});

// 6. START
server.listen(PORT, () => {
    console.log(`✅ SERVIDOR ONLINE NA PORTA ${PORT}`);
});
