// app.js - JavaScript principal para Listify

document.addEventListener('DOMContentLoaded', function () {
    // Configuración
    const API_BASE_URL = 'http://localhost:3000/api'; // Cambia esto según tu configuración

    // Referencias a elementos del DOM
    const elements = {
        // Navegación
        splashScreen: document.getElementById('splash-screen'),
        mainScreen: document.getElementById('main-screen'),
        startBtn: document.getElementById('start-btn'),
        backBtn: document.getElementById('back-btn'),
        contactBtn: document.getElementById('contact-btn'),
        instagramBtn: document.getElementById('instagram-btn'),
        spotifyConfigBtn: document.getElementById('spotify-config-btn'),
        
        // Interfaz principal
        spotifyUrlInput: document.getElementById('spotify-url'),
        fetchBtn: document.getElementById('fetch-btn'),
        searchInput: document.getElementById('search-input'),
        searchType: document.getElementById('search-type'),
        searchBtn: document.getElementById('search-btn'),
        coverContainer: document.getElementById('cover-container'),
        playlistTitle: document.getElementById('playlist-title'),
        trackList: document.getElementById('track-list'),
        metadataCheckbox: document.getElementById('metadata-checkbox'),
        downloadSongBtn: document.getElementById('download-song-btn'),
        downloadPlaylistBtn: document.getElementById('download-playlist-btn'),

        // Progreso y estado
        currentTask: document.getElementById('current-task'),
        progressBarFill: document.getElementById('progress-bar-fill'),
        statusText: document.getElementById('status-text'),

        // Modal de autenticación
        authModal: document.getElementById('auth-modal'),
        clientIdInput: document.getElementById('client-id-input'),
        clientSecretInput: document.getElementById('client-secret-input'),
        saveAuthBtn: document.getElementById('save-auth-btn'),
        cancelAuthBtn: document.getElementById('cancel-auth-btn'),

        // Notificaciones
        notification: document.getElementById('notification')
    };

    // Estado de la aplicación
    const state = {
        spotifyToken: null,
        currentCoverUrl: null,
        currentAlbumName: null,
        downloadQueue: [],
        isDownloading: false,
        selectedTrackIndex: -1
    };

    // Event Listeners de navegación
    elements.startBtn.addEventListener('click', showMainScreen);
    elements.backBtn.addEventListener('click', showSplashScreen);
    elements.contactBtn.addEventListener('click', openInstagram);
    elements.instagramBtn.addEventListener('click', openInstagram);
    elements.spotifyConfigBtn.addEventListener('click', showAuthModal); // Añade esta línea

    // Event Listeners de acciones principales
    elements.fetchBtn.addEventListener('click', fetchFromSpotifyUrl);
    elements.searchBtn.addEventListener('click', searchSpotify);
    elements.downloadSongBtn.addEventListener('click', downloadSelectedSong);
    elements.downloadPlaylistBtn.addEventListener('click', downloadAllTracks);

    // Event Listeners del modal de autenticación
    elements.saveAuthBtn.addEventListener('click', saveSpotifyCredentials);
    elements.cancelAuthBtn.addEventListener('click', hideAuthModal);

    // Event Listener para selección de canciones
    elements.trackList.addEventListener('click', selectTrack);

    // Inicialización
    init();

    /**
     * Inicializa la aplicación
     */
    function init() {
        // Cargar credenciales guardadas
        const clientId = localStorage.getItem('spotify_client_id');
        const clientSecret = localStorage.getItem('spotify_client_secret');

        if (clientId && clientSecret) {
            elements.clientIdInput.value = clientId;
            elements.clientSecretInput.value = clientSecret;
        }

        // Iniciar con credenciales si están disponibles
        if (clientId && clientSecret) {
            getSpotifyToken();
        }
    }

    /**
     * Muestra la pantalla principal
     */
    function showMainScreen() {
        elements.splashScreen.style.display = 'none';
        elements.mainScreen.style.display = 'flex';

        // Verificar credenciales de Spotify
        const clientId = localStorage.getItem('spotify_client_id');
        const clientSecret = localStorage.getItem('spotify_client_secret');

        if (!clientId || !clientSecret) {
            showAuthModal();
        } else if (!state.spotifyToken) {
            getSpotifyToken();
        }
    }

    /**
     * Muestra la pantalla de inicio
     */
    function showSplashScreen() {
        elements.mainScreen.style.display = 'none';
        elements.splashScreen.style.display = 'flex';
    }

    /**
     * Abre el perfil de Instagram
     */
    function openInstagram() {
        window.open('https://www.instagram.com/stef.dev_/', '_blank');
    }

    /**
     * Muestra el modal de autenticación
     */
    function showAuthModal() {
        elements.authModal.classList.remove('hidden');
    }

    /**
     * Oculta el modal de autenticación
     */
    function hideAuthModal() {
        elements.authModal.classList.add('hidden');
    }

    /**
     * Guarda las credenciales de Spotify
     */
    function saveSpotifyCredentials() {
        const clientId = elements.clientIdInput.value.trim();
        const clientSecret = elements.clientSecretInput.value.trim();

        if (clientId && clientSecret) {
            localStorage.setItem('spotify_client_id', clientId);
            localStorage.setItem('spotify_client_secret', clientSecret);
            hideAuthModal();
            getSpotifyToken();
            showNotification('Credenciales guardadas correctamente', 'success');
        } else {
            showNotification('Por favor ingresa ambas credenciales', 'error');
        }
    }

    /**
     * Obtiene un token de Spotify
     */
    async function getSpotifyToken() {
        try {
            const clientId = localStorage.getItem('spotify_client_id');
            const clientSecret = localStorage.getItem('spotify_client_secret');

            if (!clientId || !clientSecret) {
                showAuthModal();
                return null;
            }

            updateStatus('Obteniendo token de Spotify...');

            // Solicitar token al backend
            const response = await fetch(`${API_BASE_URL}/spotify/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ clientId, clientSecret })
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            state.spotifyToken = data.access_token;
            updateStatus('Listo para buscar música');

            return data.access_token;
        } catch (error) {
            console.error('Error al obtener token:', error);
            showNotification('Error al conectar con Spotify. Verifica tus credenciales.', 'error');
            return null;
        }
    }

    /**
     * Busca tracks desde una URL de Spotify
     */
    async function fetchFromSpotifyUrl() {
        const url = elements.spotifyUrlInput.value.trim();
        if (!url) {
            showNotification('Por favor ingresa una URL de Spotify', 'error');
            return;
        }

        const token = await ensureSpotifyToken();
        if (!token) return;

        clearTrackList();
        updateStatus('Obteniendo datos de Spotify...');
        updateProgress(20);

        try {
            // Extraer ID de URL
            let spotifyId, endpoint, type;

            if (url.includes('album')) {
                const match = url.match(/album\/([a-zA-Z0-9]+)/);
                spotifyId = match ? match[1] : null;
                endpoint = `albums/${spotifyId}`;
                type = 'album';
            } else if (url.includes('playlist')) {
                const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
                spotifyId = match ? match[1] : null;
                endpoint = `playlists/${spotifyId}`;
                type = 'playlist';
            } else {
                throw new Error('URL inválida. Debe ser un álbum o playlist de Spotify');
            }

            if (!spotifyId) {
                throw new Error('No se pudo extraer el ID de Spotify de la URL');
            }

            // Fetch playlist o album
            const response = await fetch(`https://api.spotify.com/v1/${endpoint}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    // Token expirado, obtener nuevo token y reintentar
                    await getSpotifyToken();
                    return fetchFromSpotifyUrl();
                }
                throw new Error(`Error de Spotify: ${response.status}`);
            }

            const data = await response.json();

            // Extraer tracks
            let tracks = [];
            let coverUrl = null;
            let title = '';

            if (type === 'album') {
                tracks = data.tracks.items.map(item =>
                    `${item.name} - ${item.artists.map(artist => artist.name).join(', ')}`
                );
                coverUrl = data.images[0]?.url;
                title = `${data.name} - ${data.artists[0].name}`;
            } else if (type === 'playlist') {
                tracks = data.tracks.items.map(item =>
                    `${item.track.name} - ${item.track.artists.map(artist => artist.name).join(', ')}`
                );
                coverUrl = data.images[0]?.url;
                title = data.name;
            }

            // Actualizar UI
            updateTrackList(tracks);
            updateCover(coverUrl);
            updatePlaylistTitle(title);
            updateProgress(100);
            updateStatus(`Listo - ${tracks.length} canciones encontradas`);

            // Guardar metadatos
            state.currentCoverUrl = coverUrl;
            state.currentAlbumName = title;

        } catch (error) {
            console.error('Error fetching tracks:', error);
            updateProgress(0);
            showNotification(error.message || 'Error al obtener datos de Spotify', 'error');
            updateStatus('Error al obtener datos');
        }
    }

    /**
     * Busca en Spotify según el tipo seleccionado
     */
    /**
     * Asegura que hay un token de Spotify disponible
     */
    async function ensureSpotifyToken() {
        if (!state.spotifyToken) {
            return await getSpotifyToken();
        }
        return state.spotifyToken;
    }

    /**
     * Busca en Spotify según el tipo seleccionado
     */
    async function searchSpotify() {
        const query = elements.searchInput.value.trim();
        const searchType = elements.searchType.value;

        if (!query) {
            showNotification('Por favor ingresa un término de búsqueda', 'error');
            return;
        }

        const token = await ensureSpotifyToken();
        if (!token) return;

        clearTrackList();
        updateStatus(`Buscando ${searchType} en Spotify...`);
        updateProgress(20);

        try {
            let spotifyType;
            switch (searchType) {
                case 'canciones':
                    spotifyType = 'track';
                    break;
                case 'artistas':
                    spotifyType = 'artist';
                    break;
                case 'álbumes':
                    spotifyType = 'album';
                    break;
                default:
                    spotifyType = 'track';
            }

            // Búsqueda en Spotify
            const limit = spotifyType === 'track' ? 50 : 20;
            const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${spotifyType}&limit=${limit}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    // Token expirado, obtener nuevo token y reintentar
                    await getSpotifyToken();
                    return searchSpotify();
                }
                throw new Error(`Error de Spotify: ${response.status}`);
            }

            const data = await response.json();

            // Extraer resultados según tipo de búsqueda
            let results = [];
            let coverUrl = null;
            let title = `Resultados para: ${query}`;

            if (spotifyType === 'track') {
                const items = data.tracks.items;
                results = items.map(item =>
                    `${item.name} - ${item.artists.map(artist => artist.name).join(', ')}`
                );

                if (items.length > 0 && items[0].album.images.length > 0) {
                    coverUrl = items[0].album.images[0].url;
                }
            } else if (spotifyType === 'artist') {
                const items = data.artists.items;

                // Primero añadir artistas
                for (const item of items) {
                    results.push(`${item.name} - Artista`);
                }

                // Luego tracks para el primer artista
                if (items.length > 0) {
                    const artistId = items[0].id;
                    const topTracksResponse = await fetch(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`, {
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    });

                    if (topTracksResponse.ok) {
                        const topTracksData = await topTracksResponse.json();

                        for (const track of topTracksData.tracks) {
                            results.push(`${track.name} - ${track.artists.map(artist => artist.name).join(', ')}`);
                        }
                    }

                    if (items[0].images.length > 0) {
                        coverUrl = items[0].images[0].url;
                    }
                }
            } else if (spotifyType === 'album') {
                const items = data.albums.items;

                for (const album of items) {
                    results.push(`ÁLBUM: ${album.name} - ${album.artists.map(artist => artist.name).join(', ')}`);

                    // Obtener tracks del álbum
                    const albumTracksResponse = await fetch(`https://api.spotify.com/v1/albums/${album.id}/tracks`, {
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    });

                    if (albumTracksResponse.ok) {
                        const albumTracksData = await albumTracksResponse.json();

                        for (const track of albumTracksData.items) {
                            results.push(`  • ${track.name} - ${track.artists.map(artist => artist.name).join(', ')}`);
                        }
                    }
                }

                if (items.length > 0 && items[0].images.length > 0) {
                    coverUrl = items[0].images[0].url;
                }
            }

            // Actualizar UI
            updateTrackList(results);
            updateCover(coverUrl);
            updatePlaylistTitle(title);
            updateProgress(100);
            updateStatus(`Listo - ${results.length} resultados encontrados`);

            // Guardar metadatos
            state.currentCoverUrl = coverUrl;
            state.currentAlbumName = title;

        } catch (error) {
            console.error('Error searching Spotify:', error);
            updateProgress(0);
            showNotification(error.message || 'Error al buscar en Spotify', 'error');
            updateStatus('Error en la búsqueda');
        }
    }

    /**
     * Selecciona una pista de la lista
     */
    function selectTrack(event) {
        if (!event.target.classList.contains('track-item')) return;

        // Quitar selección de todas las pistas
        document.querySelectorAll('.track-item').forEach(item => {
            item.classList.remove('selected');
        });

        // Añadir selección a la pista clickeada
        event.target.classList.add('selected');

        // Guardar índice de la pista seleccionada
        const items = Array.from(elements.trackList.children);
        state.selectedTrackIndex = items.indexOf(event.target);
    }

    /**
     * Descarga la canción seleccionada
     */
    function downloadSelectedSong() {
        const selectedTrack = document.querySelector('.track-item.selected');
        if (!selectedTrack) {
            showNotification('Selecciona una canción para descargar', 'error');
            return;
        }

        downloadTracks([selectedTrack.textContent]);
    }

    /**
     * Descarga todas las canciones de la lista
     */
    function downloadAllTracks() {
        const tracks = Array.from(document.querySelectorAll('.track-item')).map(item => item.textContent);

        if (tracks.length === 0) {
            showNotification('No hay canciones en la lista', 'error');
            return;
        }

        downloadTracks(tracks);
    }

    /**
 * Descarga una lista de canciones
 */
    async function downloadTracks(tracks) {
        const useMetadata = elements.metadataCheckbox.checked;
        const albumName = useMetadata ? state.currentAlbumName : null;

        const total = tracks.length;

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const current = i + 1;

            updateCurrentTask(`Descargando (${current}/${total}): ${track}`);
            updateProgress((current / total) * 100);
            updateStatus('Buscando en YouTube...');

            try {
                // Buscar el video en YouTube
                const searchResponse = await fetch(`${API_BASE_URL}/search-youtube?query=${encodeURIComponent(track)}`);
                const searchData = await searchResponse.json();

                if (searchData.success && searchData.video) {
                    const videoData = searchData.video;
                    updateStatus(`Descargando ${current}/${total}...`);

                    // Crear URL de descarga
                    const downloadUrl = `${API_BASE_URL}/download?videoId=${videoData.id}&title=${encodeURIComponent(track)}`;

                    // Método más robusto para descargar
                    // Crear un elemento <a> y simular un clic
                    const a = document.createElement('a');
                    a.href = downloadUrl;
                    a.download = `${track.replace(/[^\w\s]/gi, '_')}.mp3`;
                    a.style.display = 'none';
                    a.setAttribute('target', '_blank');
                    a.setAttribute('rel', 'noopener noreferrer');
                    document.body.appendChild(a);

                    // Usar setTimeout para dar tiempo al navegador para procesar
                    setTimeout(() => {
                        a.click();

                        // Eliminar el elemento después de un tiempo
                        setTimeout(() => {
                            document.body.removeChild(a);
                        }, 1000);

                        updateStatus(`Descarga iniciada: ${track}`);
                    }, 100);

                } else {
                    updateStatus(`No se encontró: ${track}`);
                    showNotification(`No se encontró: ${track}`, 'error');

                    // Opción para búsqueda manual si falla la automática
                    const useManualSearch = confirm(`No se pudo encontrar "${track}" en YouTube de forma automática. ¿Deseas intentar manualmente?`);

                    if (useManualSearch) {
                        // Abrir búsqueda de YouTube en nueva pestaña
                        window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(track)}`, '_blank');

                        // Solicitar ID del video manualmente
                        const manualVideoId = prompt('Copia el ID del video de YouTube (la parte después de "v=" en la URL):');

                        if (manualVideoId) {
                            const manualDownloadUrl = `${API_BASE_URL}/download?videoId=${manualVideoId}&title=${encodeURIComponent(track)}`;

                            // Usar el mismo método de descarga
                            const a = document.createElement('a');
                            a.href = manualDownloadUrl;
                            a.download = `${track.replace(/[^\w\s]/gi, '_')}.mp3`;
                            a.style.display = 'none';
                            document.body.appendChild(a);

                            setTimeout(() => {
                                a.click();
                                setTimeout(() => document.body.removeChild(a), 1000);
                                updateStatus(`Descarga manual iniciada: ${track}`);
                            }, 100);
                        }
                    }
                }
            } catch (error) {
                console.error('Error downloading track:', error);
                updateStatus(`Error al descargar: ${track}`);
                showNotification(`Error al descargar: ${track}. ${error.message}`, 'error');
            }

            // Esperar entre descargas para evitar sobrecarga
            if (i < tracks.length - 1) {
                // Mostrar mensaje de espera
                updateStatus(`Esperando para la siguiente descarga...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        updateCurrentTask('Proceso finalizado');
        updateStatus(`Se procesaron ${total} canciones`);

        // Mostrar resumen
        if (total > 1) {
            showNotification(`Se han procesado ${total} canciones. Revisa tu carpeta de descargas.`, 'success');
        } else {
            showNotification('Canción procesada correctamente. Revisa tu carpeta de descargas.', 'success');
        }
    }

    /**
     * Actualiza la lista de canciones
     */
    function updateTrackList(tracks) {
        elements.trackList.innerHTML = '';

        tracks.forEach(track => {
            const li = document.createElement('li');
            li.className = 'track-item';
            li.textContent = track;
            elements.trackList.appendChild(li);
        });
    }

    /**
     * Limpia la lista de canciones
     */
    function clearTrackList() {
        elements.trackList.innerHTML = '';
        elements.coverContainer.innerHTML = '';
        elements.playlistTitle.textContent = '';
    }

    /**
     * Actualiza la portada
     */
    function updateCover(coverUrl) {
        elements.coverContainer.innerHTML = '';

        if (coverUrl) {
            const img = document.createElement('img');
            img.src = coverUrl;
            img.className = 'w-full h-full object-cover';
            elements.coverContainer.appendChild(img);
        }
    }

    /**
     * Actualiza el título de la playlist
     */
    function updatePlaylistTitle(title) {
        elements.playlistTitle.textContent = title;
    }

    /**
     * Actualiza el estado de la aplicación
     */
    function updateStatus(message) {
        elements.statusText.textContent = message;
    }

    /**
     * Actualiza la barra de progreso
     */
    function updateProgress(percent) {
        elements.progressBarFill.style.width = `${percent}%`;

        if (percent === 100) {
            setTimeout(() => {
                elements.progressBarFill.style.width = '0%';
            }, 3000);
        }
    }

    /**
     * Actualiza la tarea actual
     */
    function updateCurrentTask(task) {
        elements.currentTask.textContent = task;
    }

    /**
     * Muestra una notificación
     */
    function showNotification(message, type = 'success') {
        const notification = elements.notification;
        notification.textContent = message;
        notification.className = `notification ${type}`;

        // Mostrar notificación
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        // Ocultar después de 3 segundos
        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }
});