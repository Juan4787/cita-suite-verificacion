/* Cita Suite booking host contract v1. No patient data or booking rules live here. */
(function () {
    'use strict';
    if (window.CitaSuiteBooking && window.CitaSuiteBooking.version === 1) {
        if (typeof window.CitaSuiteBooking.install === 'function') window.CitaSuiteBooking.install();
        return;
    }
    var script = document.currentScript;
    var defaultOrigin = script && script.src ? new URL(script.src).origin : window.location.origin;
    var mounted = new WeakMap();
    var protocol = 'cita-suite.booking';
    var uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
    function randomHex() {
        var bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }
    function requestId() {
        if (crypto.randomUUID)
            return crypto.randomUUID();
        var bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        var hex = Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
        return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
    }
    function serviceOrigin(raw) {
        var parsed = new URL(raw);
        var local = ['localhost', '127.0.0.1', '[::1]'].indexOf(parsed.hostname) !== -1;
        if ((parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/')
            throw new Error('Usá una dirección segura y válida para el servicio de reservas.');
        return parsed.origin;
    }
    function validMessage(data, instanceId) {
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.protocol !== protocol || data.version !== 1 || data.instanceId !== instanceId)
            return false;
        if (data.type === 'resize')
            return typeof data.height === 'number' && Number.isFinite(data.height) && data.height >= 200 && data.height <= 10000;
        if (data.type === 'request')
            return typeof data.requestId === 'string' && uuid.test(data.requestId);
        return ['ready', 'completed', 'close'].indexOf(data.type) !== -1;
    }
    function mount(options) {
        options = options || {};
        var key = options.integrationKey;
        if (typeof key !== 'string' || !/^[a-f0-9]{32}$/.test(key))
            throw new Error('Configurá el enlace de integración antes de abrir las reservas.');
        var origin = serviceOrigin(options.baseURL || defaultOrigin);
        var container = options.container || document.body;
        if (!(container instanceof HTMLElement))
            throw new Error('Elegí un contenedor válido para las reservas.');
        if (mounted.has(container))
            throw new Error('Este contenedor ya tiene un turnero. Reutilizá la integración existente.');
        var inline = options.mode === 'inline';
        var instanceId = randomHex();
        var storageKey = 'cita-suite:booking:v1:' + origin + ':' + key;
        var attempt = null;
        try {
            attempt = sessionStorage.getItem(storageKey);
        }
        catch (_) { /* Storage is optional. */ }
        if (!uuid.test(attempt || ''))
            attempt = requestId();
        var theme = options.theme === 'dark' ? 'dark' : 'light';
        var disposed = false, ready = false, timer = null, returnFocus = null, lastHeight = 420, completedAttempt = null;
        var host = document.createElement(inline ? 'section' : 'dialog');
        host.className = 'cita-booking-host';
        host.dataset.colorMode = theme;
        host.setAttribute('aria-label', 'Reservar consulta');
        var toolbar = document.createElement('div');
        toolbar.className = 'cita-booking-toolbar';
        var title = document.createElement('span');
        title.textContent = 'Reservar consulta';
        var closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.textContent = 'Cerrar';
        toolbar.appendChild(title);
        if (!inline)
            toolbar.appendChild(closeButton);
        var feedback = document.createElement('div');
        feedback.className = 'cita-booking-feedback';
        feedback.setAttribute('role', 'status');
        var message = document.createElement('p');
        message.textContent = 'Cargando las opciones de reserva…';
        var retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Volver a intentar';
        retry.hidden = true;
        var fallback = document.createElement('a');
        fallback.textContent = 'Abrir las reservas en otra página';
        fallback.target = '_blank';
        fallback.rel = 'noopener noreferrer';
        fallback.hidden = true;
        feedback.append(message, retry, fallback);
        var iframe = document.createElement('iframe');
        iframe.title = 'Reservas del consultorio';
        iframe.referrerPolicy = 'no-referrer';
        iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads');
        iframe.setAttribute('allow', 'clipboard-write');
        iframe.hidden = true;
        host.append(toolbar, feedback, iframe);
        container.appendChild(host);
        var cssURL = origin + '/booking/embed-v1.css';
        if (!Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some(function (link) { return link.href === cssURL; })) {
            var css = document.createElement('link');
            css.rel = 'stylesheet';
            css.href = cssURL;
            document.head.appendChild(css);
        }
        function remember() { try {
            sessionStorage.setItem(storageKey, attempt);
        }
        catch (_) { /* No patient data is persisted. */ } }
        function emitTheme() {
            if (iframe.contentWindow)
                iframe.contentWindow.postMessage({ protocol: protocol, version: 1, instanceId: instanceId, type: 'theme', theme: theme }, origin);
        }
        function setTheme(value) {
            if (value !== 'dark' && value !== 'light')
                throw new Error('Elegí un tema claro u oscuro.');
            theme = value;
            host.dataset.colorMode = theme;
            if (ready)
                emitTheme();
        }
        function resize(height) {
            lastHeight = height;
            if (inline) {
                iframe.style.height = height + 'px';
                return;
            }
            var viewport = window.visualViewport ? window.visualViewport.height : window.innerHeight;
            var style = getComputedStyle(host);
            var gutter = parseFloat(style.getPropertyValue('--cita-booking-gutter')) || 16;
            var border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
            var maximum = Math.max(0, viewport - 2 * gutter);
            var available = Math.max(0, maximum - toolbar.getBoundingClientRect().height - border);
            host.style.maxHeight = maximum + 'px';
            iframe.style.height = Math.min(height, available) + 'px';
        }
        function viewportChanged() { resize(lastHeight); }
        function showFailure() {
            if (disposed || ready)
                return;
            message.textContent = 'No pudimos abrir las reservas. Podés volver a intentar o abrirlas en otra página.';
            retry.hidden = false;
            fallback.hidden = false;
            feedback.hidden = false;
            iframe.hidden = true;
        }
        function load() {
            if (disposed)
                return;
            clearTimeout(timer);
            ready = false;
            remember();
            message.textContent = 'Cargando las opciones de reserva…';
            retry.hidden = true;
            fallback.hidden = true;
            feedback.hidden = false;
            iframe.hidden = true;
            var src = new URL('/embed/v1/' + key, origin);
            src.searchParams.set('parent_origin', window.location.origin);
            src.searchParams.set('instance_id', instanceId);
            src.searchParams.set('request_id', attempt);
            src.searchParams.set('recover', '1');
            iframe.src = src.href;
            var direct = new URL('/embed/v1/' + key, origin);
            direct.searchParams.set('request_id', attempt);
            direct.searchParams.set('recover', '1');
            fallback.href = direct.href;
            timer = setTimeout(showFailure, 15000);
        }
        function close() {
            if (disposed || inline)
                return;
            if (host.open)
                host.close();
            if (returnFocus && returnFocus.isConnected)
                returnFocus.focus();
            // Keep the frame alive: closing the modal must not abort an in-flight reservation.
        }
        function open() {
            if (disposed)
                throw new Error('La integración se cerró. Volvé a crearla antes de abrir las reservas.');
            if (!inline && !host.open) {
                returnFocus = document.activeElement;
                if (typeof host.showModal !== 'function') {
                    window.location.assign(new URL('/embed/v1/' + key + '?request_id=' + attempt + '&recover=1', origin).href);
                    return;
                }
                host.showModal();
                resize(lastHeight);
            }
            if (!iframe.hasAttribute('src'))
                load();
        }
        function onMessage(event) {
            if (disposed || event.source !== iframe.contentWindow || event.origin !== origin || !validMessage(event.data, instanceId))
                return;
            var data = event.data;
            if (data.type === 'ready') {
                ready = true;
                clearTimeout(timer);
                feedback.hidden = true;
                iframe.hidden = false;
                resize(lastHeight);
                emitTheme();
            }
            else if (data.type === 'resize')
                resize(data.height);
            else if (data.type === 'close')
                close();
            else if (data.type === 'request') {
                attempt = data.requestId;
                remember();
                var direct = new URL('/embed/v1/' + key, origin);
                direct.searchParams.set('request_id', attempt);
                direct.searchParams.set('recover', '1');
                fallback.href = direct.href;
            }
            else if (data.type === 'completed') {
                if (completedAttempt === attempt)
                    return;
                completedAttempt = attempt;
                try {
                    sessionStorage.removeItem(storageKey);
                }
                catch (_) { /* Optional storage. */ }
                if (typeof options.onComplete === 'function') {
                    try {
                        options.onComplete();
                    }
                    catch (_) { /* Host callbacks cannot affect a saved reservation. */ }
                }
            }
        }
        function cancel(event) { event.preventDefault(); close(); }
        function destroy() {
            if (disposed)
                return;
            close();
            disposed = true;
            clearTimeout(timer);
            window.removeEventListener('message', onMessage);
            window.removeEventListener('resize', viewportChanged);
            if (window.visualViewport)
                window.visualViewport.removeEventListener('resize', viewportChanged);
            host.removeEventListener('cancel', cancel);
            closeButton.removeEventListener('click', close);
            retry.removeEventListener('click', load);
            host.remove();
            mounted.delete(container);
        }
        window.addEventListener('message', onMessage);
        window.addEventListener('resize', viewportChanged);
        if (window.visualViewport)
            window.visualViewport.addEventListener('resize', viewportChanged);
        host.addEventListener('cancel', cancel);
        closeButton.addEventListener('click', close);
        retry.addEventListener('click', load);
        var api = Object.freeze({ open: open, close: close, destroy: destroy, setTheme: setTheme });
        mounted.set(container, api);
        if (inline)
            load();
        return api;
    }
    // Declarative installation keeps the existing manual mount API compatible.
    // A real link remains usable when the script is blocked or fails to load.
    function install() {
        var installations = [];
        document.querySelectorAll('[data-cita-suite-booking]').forEach(function (container) {
            if (mounted.has(container)) { installations.push(mounted.get(container)); return; }
            try {
                installations.push(mount({ integrationKey: container.getAttribute('data-cita-suite-booking'), container: container, mode: 'inline' }));
                var link = container.querySelector('[data-cita-suite-fallback]');
                if (link) link.hidden = true;
            } catch (_) {
                // An invalid block must not disable other blocks or its plain link.
            }
        });
        return installations;
    }
    window.CitaSuiteBooking = Object.freeze({ version: 1, mount: mount, install: install });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
}());
