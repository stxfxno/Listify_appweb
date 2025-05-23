// server.js - Backend completo para Listify
const express = require('express');
const cors = require('cors');
const playdl = require('play-dl');
const ffmpeg = require('fluent-ffmpeg');
const NodeCache = require('node-cache');
const axios = require('axios');
const qs = require('querystring');
const path = require('path');
const fs = require('fs');

// Configuración de la aplicación
const app = express();
const port = process.env.PORT || 3000;
const CACHE_TTL = 60 * 60; // 1 hora en segundos

// Crear caché para búsquedas y tokens
const searchCache = new NodeCache({ stdTTL: CACHE_TTL });
const tokenCache = new NodeCache({ stdTTL: 3000 }); // 50 minutos (menos que la hora que dura el token)

// Middleware
app.use(cors());
app.use(express.json());

// Directorio para archivos estáticos (frontend)
app.use(express.static('public'));

// Asegurarse de que existe la carpeta temp
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// Ruta para servir estáticamente archivos de la carpeta temp
// Esto permite acceder directamente a los archivos MP3 generados
app.use('/downloads', express.static(tempDir));

// Ruta para verificar estado del servidor
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0.0' });
});

// Ruta para obtener token de Spotify
app.post('/api/spotify/token', async (req, res) => {
    try {
        const { clientId, clientSecret } = req.body;
        
        if (!clientId || !clientSecret) {
            return res.status(400).json({ error: 'Se requieren credenciales de Spotify' });
        }
        
        // Verificar si ya tenemos un token en caché
        const cacheKey = `spotify:token:${clientId}`;
        const cachedToken = tokenCache.get(cacheKey);
        
        if (cachedToken) {
            return res.json({ access_token: cachedToken });
        }
        
        // Si no está en caché, solicitar nuevo token
        const tokenResponse = await axios({
            method: 'post',
            url: 'https://accounts.spotify.com/api/token',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
            },
            data: qs.stringify({
                grant_type: 'client_credentials'
            })
        });
        
        // Guardar token en caché
        tokenCache.set(cacheKey, tokenResponse.data.access_token);
        
        return res.json({ access_token: tokenResponse.data.access_token });
        
    } catch (error) {
        console.error('Error al obtener token de Spotify:', error.message);
        return res.status(500).json({ error: 'Error al obtener token de Spotify' });
    }
});

// Ruta para buscar en YouTube (versión simple y universal)
app.get('/api/search-youtube', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ error: 'Se requiere un término de búsqueda' });
        }

        console.log(`Buscando en YouTube: "${query}"`);
        
        // Realizar búsqueda con play-dl
        const searchResults = await playdl.search(query, { 
            limit: 1, 
            source: { youtube: "video" } 
        });
        
        if (searchResults && searchResults.length > 0) {
            const video = searchResults[0];
            console.log(`Resultado encontrado: ${video.title} (ID: ${video.id})`);
            
            return res.json({
                success: true,
                video: {
                    id: video.id,
                    title: video.title,
                    url: video.url,
                    thumbnail: video.thumbnails[0]?.url || null
                }
            });
        } else {
            console.log(`No se encontraron resultados para "${query}"`);
            return res.json({ 
                success: false, 
                message: `No se encontró: ${query}` 
            });
        }
    } catch (error) {
        console.error('Error al buscar en YouTube:', error);
        return res.status(500).json({ 
            error: 'Error al buscar video',
            message: error.message 
        });
    }
});

// Reemplaza la ruta /api/download con esta versión simplificada
app.get('/api/download', async (req, res) => {
    try {
        const { videoId, title } = req.query;
        
        if (!videoId) {
            return res.status(400).json({ error: 'Se requiere un ID de video' });
        }

        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        console.log(`Iniciando descarga desde: ${videoUrl}`);
        
        // Sanitizar el título para el nombre del archivo
        const sanitizedTitle = title 
            ? title.replace(/[^\w\s-]/gi, '_').replace(/\s+/g, '_').substring(0, 100) 
            : 'audio';
        
        // Crear un archivo temporal único
        const fileName = `${sanitizedTitle}.mp3`;
        const filePath = path.join(tempDir, fileName);
        
        try {
            // Obtener información del video
            console.log(`Obteniendo información para video ID: ${videoId}`);
            const videoInfo = await playdl.video_info(videoUrl);
            
            if (!videoInfo) {
                throw new Error('No se pudo obtener información del video');
            }
            
            // Obtener el stream de audio
            console.log('Obteniendo stream de audio...');
            const audioStream = await playdl.stream(videoUrl, { quality: 140 });
            
            if (!audioStream || !audioStream.stream) {
                throw new Error('No se pudo crear el stream de audio');
            }
            
            // Crear un archivo
            console.log(`Guardando en: ${filePath}`);
            const fileWriter = fs.createWriteStream(filePath);
            
            // Manejar errores
            audioStream.stream.on('error', (err) => {
                console.error('Error en el stream:', err);
                return res.status(500).send('Error al descargar el audio');
            });
            
            fileWriter.on('error', (err) => {
                console.error('Error al escribir archivo:', err);
                return res.status(500).send('Error al guardar el archivo');
            });
            
            // Cuando el archivo se ha escrito completamente
            fileWriter.on('finish', () => {
                console.log('Archivo guardado correctamente. Enviando al cliente...');
                
                // Enviar el archivo como descarga
                res.download(filePath, fileName, (err) => {
                    if (err) {
                        console.error('Error al enviar archivo:', err);
                    }
                    
                    // No eliminar el archivo inmediatamente
                    // Lo haremos después con un cron job o similar
                });
            });
            
            // Pipe el stream al archivo
            audioStream.stream.pipe(fileWriter);
            
        } catch (error) {
            console.error('Error:', error);
            res.status(500).send(`Error: ${error.message}`);
        }
    } catch (error) {
        console.error('Error general:', error);
        res.status(500).send('Error general en la descarga');
    }
});

// Función alternativa para buscar en YouTube directamente usando su HTML/página de resultados
async function searchYouTubeAlternative(query) {
    try {
        // Sanitizar la consulta
        const sanitizedQuery = encodeURIComponent(query);
        const url = `https://www.youtube.com/results?search_query=${sanitizedQuery}`;
        
        console.log(`Realizando búsqueda alternativa en: ${url}`);
        
        const response = await axios.get(url);
        const html = response.data;
        
        // Extraer datos JSON incrustados en el HTML de YouTube
        const dataRegex = /var ytInitialData = (.+?);<\/script>/;
        const match = html.match(dataRegex);
        
        if (!match || !match[1]) {
            throw new Error('No se pudieron extraer datos del HTML');
        }
        
        // Intentar parsear los datos
        let data;
        try {
            data = JSON.parse(match[1]);
        } catch (e) {
            throw new Error(`Error al parsear datos: ${e.message}`);
        }
        
        // Navegar por la estructura para encontrar videos
        const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
        
        // Extraer información del primer contenido que generalmente son los resultados de búsqueda
        let items = [];
        for (const content of contents) {
            if (content.itemSectionRenderer && content.itemSectionRenderer.contents) {
                items = content.itemSectionRenderer.contents;
                break;
            }
        }
        
        // Procesar los ítems para encontrar videos
        const results = [];
        for (const item of items) {
            // Buscar videoRenderer que contiene la información del video
            if (item.videoRenderer) {
                const videoData = item.videoRenderer;
                
                // Extraer ID, título y miniatura
                const videoId = videoData.videoId;
                let title = '';
                
                // Extraer título de diferentes ubicaciones posibles
                if (videoData.title && videoData.title.runs && videoData.title.runs.length > 0) {
                    title = videoData.title.runs.map(run => run.text).join('');
                }
                
                // Extraer URL de miniatura
                let thumbnailUrl = '';
                if (videoData.thumbnail && videoData.thumbnail.thumbnails && videoData.thumbnail.thumbnails.length > 0) {
                    thumbnailUrl = videoData.thumbnail.thumbnails[0].url;
                }
                
                // Añadir a resultados
                if (videoId && title) {
                    results.push({
                        videoId: videoId,
                        title: title,
                        thumbnailUrl: thumbnailUrl
                    });
                }
            }
        }
        
        console.log(`Búsqueda alternativa encontró ${results.length} resultados`);
        return results;
    } catch (error) {
        console.error('Error en búsqueda alternativa:', error);
        return null;
    }
}

// Cola de descargas para evitar sobrecargar el servidor
const downloadQueue = [];
let isProcessing = false;

async function processQueue() {
    if (isProcessing || downloadQueue.length === 0) return;
    
    isProcessing = true;
    const task = downloadQueue.shift();
    
    try {
        await task.execute();
    } catch (error) {
        console.error('Error al procesar tarea de descarga:', error);
    } finally {
        isProcessing = false;
        processQueue(); // Procesar siguiente tarea
    }
}

// Ruta para verificar sistema y dependencias
app.get('/api/system-check', async (req, res) => {
    const results = {
        system: {
            node: process.version,
            platform: process.platform,
            tempDir: path.join(__dirname, 'temp'),
            tempDirExists: fs.existsSync(path.join(__dirname, 'temp'))
        },
        dependencies: {
            playdl: false,
            ffmpeg: false,
            axios: false
        },
        tests: {
            youtubeSearch: false,
            fileSystem: false
        }
    };
    
    // Verificar dependencias
    try {
        // Probar play-dl
        const playdlVersion = require('play-dl/package.json').version;
        results.dependencies.playdl = playdlVersion;
        
        // Probar ffmpeg
        try {
            const ffmpegPath = ffmpeg.path;
            results.dependencies.ffmpeg = ffmpegPath || true;
        } catch (e) {
            results.dependencies.ffmpeg = `Error: ${e.message}`;
        }
        
        // Probar axios
        const axiosVersion = require('axios/package.json').version;
        results.dependencies.axios = axiosVersion;
    } catch (e) {
        console.error('Error verificando dependencias:', e);
    }
    
    // Probar sistema de archivos
    try {
        // Asegurar que existe el directorio temporal
        if (!fs.existsSync(path.join(__dirname, 'temp'))) {
            fs.mkdirSync(path.join(__dirname, 'temp'), { recursive: true });
            results.system.tempDirExists = true;
        }
        
        // Probar escritura de archivo
        const testPath = path.join(__dirname, 'temp', 'test.txt');
        fs.writeFileSync(testPath, 'test');
        fs.unlinkSync(testPath);
        results.tests.fileSystem = true;
    } catch (e) {
        results.tests.fileSystem = `Error: ${e.message}`;
    }
    
    // Probar búsqueda en YouTube
    try {
        const searchResults = await playdl.search('test song', { limit: 1 });
        results.tests.youtubeSearch = searchResults && searchResults.length > 0;
    } catch (e) {
        results.tests.youtubeSearch = `Error: ${e.message}`;
    }
    
    // Enviar resultados
    res.json(results);
});

// Iniciar servidor
app.listen(port, () => {
    console.log(`Servidor Listify ejecutándose en http://localhost:${port}`);
    console.log(`Endpoints disponibles:`);
    console.log(`- GET /api/health - Verificar estado del servidor`);
    console.log(`- POST /api/spotify/token - Obtener token de Spotify`);
    console.log(`- GET /api/search-youtube - Buscar videos en YouTube`);
    console.log(`- GET /api/download - Descargar y convertir a MP3`);
    console.log(`- GET /api/system-check - Verificar estado del sistema`);
    console.log(`- GET /downloads/[filename] - Acceder directamente a archivos MP3`);
});