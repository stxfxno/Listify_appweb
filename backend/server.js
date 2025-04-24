// server.js - Backend completo para Listify
const express = require('express');
const cors = require('cors');
const ytdl = require('ytdl-core');
const { search } = require('youtube-search-without-api-key');
const ffmpeg = require('fluent-ffmpeg');
const NodeCache = require('node-cache');
const axios = require('axios');
const qs = require('querystring');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

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

// Ruta para buscar en YouTube (con caché)
app.get('/api/search-youtube', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ error: 'Se requiere un término de búsqueda' });
        }

        // Ampliar la búsqueda para mejorar resultados
        console.log(`Buscando en YouTube: "${query}"`);
        
        // Intentar primero con la consulta exacta
        let results = await search(query, { limit: 3 });
        
        // Si no hay resultados, intentar con una búsqueda más amplia
        if (!results || results.length === 0) {
            console.log('No se encontraron resultados, intentando búsqueda alternativa');
            
            // Extraer posible artista y título
            const parts = query.split(' - ');
            if (parts.length > 1) {
                const title = parts[0].trim();
                const artist = parts[1].trim();
                
                // Probar con combinaciones alternativas
                results = await search(`${title} ${artist}`, { limit: 3 });
                
                // Si aún no hay resultados, intentar sólo con el título
                if (!results || results.length === 0) {
                    results = await search(title, { limit: 3 });
                }
            }
        }
        
        if (results && results.length > 0) {
            console.log(`Se encontraron ${results.length} resultados para "${query}"`);
            console.log(`Mejor resultado: ${results[0].title} (ID: ${results[0].id.videoId})`);
            
            return res.json({
                success: true,
                video: {
                    id: results[0].id.videoId,
                    title: results[0].title,
                    url: `https://www.youtube.com/watch?v=${results[0].id.videoId}`,
                    thumbnail: results[0].thumbnail.url
                }
            });
        } else {
            console.log(`No se encontraron resultados para "${query}" después de múltiples intentos`);
            return res.json({ success: false, message: `No se encontró: ${query}` });
        }
    } catch (error) {
        console.error('Error al buscar en YouTube:', error);
        return res.status(500).json({ error: 'Error al buscar video' });
    }
});

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

// Ruta para descargar audio de YouTube (streaming directo)
app.get('/api/download', async (req, res) => {
    try {
        const { videoId, title } = req.query;
        
        if (!videoId) {
            return res.status(400).json({ error: 'Se requiere un ID de video' });
        }

        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        console.log(`Iniciando descarga desde: ${videoUrl}`);
        
        // Configurar encabezados para descarga
        const sanitizedTitle = title ? title.replace(/[^\w\s]/gi, '_') : 'audio';
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizedTitle}.mp3"`);
        res.setHeader('Content-Type', 'audio/mpeg');
        
        // Verificar que el video existe antes de proceder
        await ytdl.getBasicInfo(videoUrl);
        
        // Crear flujo de descarga desde YouTube con mejor manejo de errores
        const videoStream = ytdl(videoUrl, { 
            quality: 'highestaudio', 
            filter: 'audioonly' 
        });
        
        videoStream.on('error', (err) => {
            console.error('Error en stream de YouTube:', err);
            return res.status(500).json({ error: 'Error al descargar el video' });
        });
        
        // Configurar flujo de ffmpeg con mejor manejo de errores
        const ffmpegProcess = ffmpeg(videoStream)
            .audioBitrate(192) // Reducir a 192 para mejor compatibilidad
            .audioCodec('libmp3lame')
            .format('mp3')
            .on('error', (err) => {
                console.error('Error en ffmpeg:', err);
                return res.status(500).json({ error: 'Error al convertir audio' });
            });
        
        // Enviar directamente al cliente
        ffmpegProcess.pipe(res);
        
        console.log(`Descarga iniciada para: ${sanitizedTitle}`);
    } catch (error) {
        console.error('Error general en descarga:', error);
        return res.status(500).json({ error: 'Error al procesar la descarga' });
    }
});

// Iniciar servidor
app.listen(port, () => {
    console.log(`Servidor Listify ejecutándose en http://localhost:${port}`);
    console.log(`Endpoints disponibles:`);
    console.log(`- GET /api/health - Verificar estado del servidor`);
    console.log(`- POST /api/spotify/token - Obtener token de Spotify`);
    console.log(`- GET /api/search-youtube - Buscar videos en YouTube`);
    console.log(`- GET /api/download - Descargar y convertir a MP3`);
});