document.addEventListener('DOMContentLoaded', function() {
    const elements = {
        fetchBtn: document.getElementById('fetch-btn'),
        youtubeUrl: document.getElementById('youtube-url'),
        progressSection: document.querySelector('.progress-section'),
        progressFill: document.getElementById('progress-fill'),
        trackList: document.getElementById('track-list'),
        resultsSection: document.querySelector('.results-section'),
        playlistTitle: document.getElementById('playlist-title'),
        trackCount: document.getElementById('track-count'),
        exportBtn: document.getElementById('export-btn'),
        loginSpotifyBtn: document.getElementById('login-spotify'),
        loginModal: document.getElementById('login-modal'),
        successModal: document.getElementById('success-modal'),
        closeModalButtons: document.querySelectorAll('.close-modal'),
        authenticateSpotifyBtn: document.getElementById('authenticate-spotify'),
        openSpotifyBtn: document.getElementById('open-spotify')
    };

    const state = {
        spotifyAuthenticated: false,
        currentTracks: []
    };

    let spotifyToken = null;  // ← Stores access token

    function init() {
        setupEventListeners();
        checkAuthStatus();
    }

    function setupEventListeners() {
        elements.fetchBtn.addEventListener('click', fetchPlaylist);
        elements.loginSpotifyBtn.addEventListener('click', openLoginModal);
        elements.exportBtn.addEventListener('click', exportToSpotify);
        elements.authenticateSpotifyBtn.addEventListener('click', authenticateWithSpotify);
        elements.openSpotifyBtn.addEventListener('click', openInSpotify);

        elements.closeModalButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                elements.loginModal.classList.add('hidden');
                elements.successModal.classList.add('hidden');
            });
        });

        window.addEventListener('click', e => {
            if (e.target === elements.loginModal) elements.loginModal.classList.add('hidden');
            if (e.target === elements.successModal) elements.successModal.classList.add('hidden');
        });
    }

    // ← Extract token from URL after login
    function checkAuthStatus() {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');
        if (token) {
            spotifyToken = token;
            state.spotifyAuthenticated = true;
            updateAuthUI();
            history.replaceState({}, '', window.location.pathname);
        } else if (params.get('auth') === 'error') {
            alert('Spotify login failed: ' + (params.get('message') || 'Try again'));
        }
    }

    function updateAuthUI() {
        elements.loginSpotifyBtn.innerHTML = '<i class="fas fa-check-circle"></i> Connected';
        elements.loginSpotifyBtn.style.backgroundColor = '#333';
        elements.exportBtn.disabled = false;
    }

    // ← Send token during fetch to search Spotify
    async function fetchPlaylist() {
        const url = elements.youtubeUrl.value.trim();
        if (!validateYouTubeUrl(url)) return;

        try {
            setLoadingState(true);
            const data = await postData(
                'http://127.0.0.1:3000/fetch-playlist',
                { youtubeUrl: url },
                spotifyToken ? { Authorization: `Bearer ${spotifyToken}` } : {}
            );
            state.currentTracks = data.tracks;
            displayResults(data.playlistTitle, data.tracks);
        } catch (error) {
            console.error('Fetch error:', error);
            alert(`Error: ${error.message}`);
        } finally {
            setLoadingState(false);
        }
    }

    function validateYouTubeUrl(url) {
        if (!url) { alert('Enter a YouTube URL'); return false; }
        const pattern = /^(https?:\/\/)?(www\.)?youtube\.com\/(watch\?.*list=|playlist\?list=)[A-Za-z0-9_-]+/;
        if (!pattern.test(url)) { alert('Invalid YouTube playlist URL'); return false; }
        return true;
    }

    function setLoadingState(loading) {
        elements.fetchBtn.disabled = loading;
        elements.fetchBtn.innerHTML = loading ? '<i class="fas fa-spinner fa-spin"></i> Processing' : 'Fetch Playlist';
        if (loading) {
            elements.progressSection.classList.remove('hidden');
            simulateProgress();
        }
    }

    function simulateProgress() {
        let p = 0;
        const int = setInterval(() => {
            p += Math.random() * 10;
            if (p >= 100) { p = 100; clearInterval(int); }
            elements.progressFill.style.width = p + '%';
        }, 200);
    }

    function displayResults(title, tracks) {
        elements.playlistTitle.textContent = title || 'Converted Playlist';
        elements.trackCount.textContent = `${tracks.filter(t => t.status === 'found').length} tracks`;
        renderTrackList(tracks);
        elements.resultsSection.classList.remove('hidden');
    }

    function renderTrackList(tracks) {
        elements.trackList.innerHTML = '';
        tracks.forEach(t => {
            const item = document.createElement('div');
            item.className = 'track-item';
            item.dataset.spotifyId = t.spotifyId || '';
            const status = getStatusInfo(t.status);
            item.innerHTML = `
                <i class="fas fa-music"></i>
                <div class="track-info">
                    <div class="track-name">${t.name}</div>
                    <div class="track-artist">${t.artist}</div>
                </div>
                <div class="track-status ${status.class}">${status.text}</div>
            `;
            elements.trackList.appendChild(item);
        });
    }

    function getStatusInfo(s) {
        return {
            found: { class: 'status-found', text: 'Found' },
            searching: { class: 'status-searching', text: 'Searching...' },
            'not-found': { class: 'status-not-found', text: 'Not found' }
        }[s] || { class: 'status-not-found', text: 'Not found' };
    }

    function openLoginModal() {
        elements.loginModal.classList.remove('hidden');
    }

    function authenticateWithSpotify() {
        window.location.href = 'http://127.0.0.1:3000/spotify-login';
    }

    // ← Send token during export
    async function exportToSpotify() {
        if (!spotifyToken) { alert('Connect to Spotify first'); return; }

        try {
            elements.exportBtn.disabled = true;
            elements.exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';

            const payload = {
                playlistTitle: elements.playlistTitle.textContent,
                tracks: Array.from(elements.trackList.children).map(item => ({
                    name: item.querySelector('.track-name').textContent,
                    artist: item.querySelector('.track-artist').textContent,
                    status: item.querySelector('.track-status').textContent.toLowerCase().replace('...', ''),
                    spotifyId: item.dataset.spotifyId || null
                }))
            };

            const data = await postData(
                'http://127.0.0.1:3000/export-playlist',
                payload,
                { Authorization: `Bearer ${spotifyToken}` }
            );

            showSuccessModal(data.playlistUrl);
        } catch (error) {
            console.error('Export error:', error);
            alert(`Export failed: ${error.message}`);
        } finally {
            elements.exportBtn.disabled = false;
            elements.exportBtn.innerHTML = '<i class="fas fa-upload"></i> Export to Spotify';
        }
    }

    function showSuccessModal(url) {
        elements.openSpotifyBtn.href = url;
        elements.successModal.classList.remove('hidden');
    }

    function openInSpotify() {
        elements.successModal.classList.add('hidden');
    }

    // ← Accept headers
    async function postData(url, data, headers = {}) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(txt || `HTTP ${res.status}`);
        }
        return res.json();
    }

    init();
});