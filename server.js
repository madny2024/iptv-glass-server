const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// 1. CONFIGURAÇÃO DA PORTA (Essencial para o Railway)
// O Railway define a porta automaticamente na nuvem.
const PORT = process.env.PORT || 8888;

const app = express();
const server = http.createServer(app);

// 2. CONFIGURAÇÃO DE SEGURANÇA (CORS)
// Permite que seu App Mobile e o Site conversem com o servidor
app.use(cors());
app.use(express.json());

const io = new Server(server, {
    cors: {
        origin: "*", // Libera geral (App, Site, Controle)
        methods: ["GET", "POST"]
    }
});

// 3. SERVIR O SITE (Frontend)
// Faz o servidor entregar os arquivos HTML, CSS e JS quando acessam o link
app.use(express.static(__dirname));

// Garante que a raiz abra o index.html (Login)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 4. ROTA PROXY (O Segredo para rodar IPTV no Site HTTPS)
// Isso resolve o erro "Erro ao carregar conteúdo" e "Mixed Content"
app.get('/proxy', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).send("URL não fornecida.");
    }

    try {
        console.log(`📥 Baixando lista via Proxy: ${url}`);
        
        const response = await axios.get(url, {
            timeout: 60000, // 60 segundos (Listas grandes demoram)
            maxContentLength: Infinity, // Sem limite de tamanho
            maxBodyLength: Infinity,
            headers: {
                'User-Agent': 'IPTV Smarters Pro' // Finge ser um app oficial para não ser bloqueado
            }
        });

        // Devolve o conteúdo da lista para o seu site
        res.send(response.data);

    } catch (error) {
        console.error("❌ Erro no Proxy:", error.message);
        res.status(500).send("Erro ao buscar a lista IPTV. Verifique a URL.");
    }
});

// 5. LÓGICA DO SOCKET.IO (Salas, Controle, App)
io.on('connection', (socket) => {
    console.log('🔌 Novo dispositivo conectado:', socket.id);

    // Entrar na Sala (App, Site ou Controle)
    socket.on('join_room', (data) => {
        // Compatibilidade: Aceita objeto {room: '12345'} ou string '12345'
        const room = typeof data === 'object' ? data.room : data;
        if(room) {
            socket.join(room);
            console.log(`✅ Socket ${socket.id} entrou na sala: ${room}`);
        }
    });

    // Enviar Vídeo (Do Site -> Para o App)
    socket.on('send_video', (data) => {
        if(data.room) {
            io.to(data.room).emit('play_video', data);
            console.log(`▶️ Play enviado para sala ${data.room}: ${data.title}`);
        }
    });

    // Comandos do Controle Remoto (Do Controle -> Para o App)
    socket.on('remote_control', (data) => {
        if (data.room) {
            io.to(data.room).emit('control_command', data);
        }
    });

    // Status do App (Do App -> Para o Controle/Site)
    // Atualiza a barra de tempo e o status (Play/Pause)
    socket.on('app_status', (data) => {
        if (data.room) {
            io.to(data.room).emit('player_status', data);
        }
    });

    socket.on('disconnect', () => {
        // console.log('Dispositivo desconectado:', socket.id);
    });
});

// 6. INICIAR O SERVIDOR
server.listen(PORT, () => {
    console.log(`🚀 SERVIDOR IPTV GLASS RODANDO NA PORTA: ${PORT}`);
});
