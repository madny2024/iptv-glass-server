const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// 1. CONFIGURAÇÃO DA PORTA (Essencial para o Railway)
// O Railway escolhe a porta aleatoriamente, por isso usamos process.env.PORT
const PORT = process.env.PORT || 8888;

const app = express();
const server = http.createServer(app);

// 2. CONFIGURAÇÃO DO SOCKET.IO E CORS
const io = new Server(server, {
    cors: {
        origin: "*", // Permite conexões de qualquer lugar (App e Site)
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// 3. SERVIR ARQUIVOS DO SITE (HTML, CSS, JS)
// Isso faz com que ao acessar o link do Railway, ele mostre seu site
app.use(express.static(__dirname));

// ROTA PADRÃO (Opcional, garante que o index.html abra na raiz)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 4. PROXY PARA LISTAS IPTV (A Correção do "Erro ao carregar")
// Como o Railway é HTTPS e muitas listas são HTTP, o servidor baixa a lista
// e entrega para o site, evitando erro de Mista/Segurança.
app.get('/proxy', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).send("URL não fornecida.");
    }

    try {
        console.log(`Baixando lista: ${url}`);
        
        const response = await axios.get(url, {
            // Aumentei o tempo limite para 60 segundos (Listas grandes demoram)
            timeout: 60000, 
            // Permite arquivos de qualquer tamanho (Infinity)
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            // Finge ser um player conhecido para evitar bloqueios
            headers: {
                'User-Agent': 'IPTV Smarters Pro' 
            }
        });

        // Repassa os dados da lista para o seu site
        res.send(response.data);

    } catch (error) {
        console.error("Erro no Proxy:", error.message);
        res.status(500).send("Erro ao buscar a lista. Verifique a URL ou o Servidor IPTV.");
    }
});

// 5. SISTEMA DE SALAS E CONTROLE (Socket.io)
io.on('connection', (socket) => {
    console.log('Novo dispositivo conectado:', socket.id);

    // Entrar na Sala (App, Site ou Controle)
    socket.on('join_room', (data) => {
        // Aceita tanto objeto {room, type} quanto string direta (compatibilidade)
        const room = typeof data === 'object' ? data.room : data;
        socket.join(room);
        console.log(`Socket ${socket.id} entrou na sala: ${room}`);
    });

    // Enviar Vídeo (Do Site -> Para o App)
    socket.on('send_video', (data) => {
        // data: { room, url, title }
        io.to(data.room).emit('play_video', data);
        console.log(`Enviando vídeo para sala ${data.room}: ${data.title}`);
    });

    // Comandos do Controle Remoto (Do Controle -> Para o App)
    socket.on('remote_control', (data) => {
        // data: { room, action, value }
        if (data.room) {
            io.to(data.room).emit('control_command', data);
            // console.log(`Comando ${data.action} enviado para sala ${data.room}`);
        }
    });

    // Status do App (Do App -> Para o Controle/Site)
    // Usado para atualizar a barra de tempo 00:00:00
    socket.on('app_status', (data) => {
        if (data.room) {
            // Repassa o status para todos na sala (inclusive o controle remoto)
            io.to(data.room).emit('player_status', data);
        }
    });

    socket.on('disconnect', () => {
        console.log('Dispositivo desconectado:', socket.id);
    });
});

// 6. INICIAR O SERVIDOR
server.listen(PORT, () => {
    console.log(`🚀 SERVIDOR IPTV GLASS RODANDO NA PORTA: ${PORT}`);
});
