/** Only known diagnostics of the disposable fixture, which has no Realtime server.
 * The raw message may contain an API key: return a static category, never its URL.
 */
export function fixtureRealtimeDiagnostic(
	text: string,
	environment: string | undefined,
	apiOrigin: string | undefined
): 'fixture-realtime-unavailable' | 'fixture-realtime-cancelled' | null {
	if (environment !== 'disposable') return null;
	const match = /^WebSocket connection to '(ws:\/\/[^']+)' failed: (Error during WebSocket handshake: Unexpected response code: 404|WebSocket is closed before the connection is established\.)$/.exec(text);
	if (!match) return null;
	try {
		const socket = new URL(match[1]);
		const api = new URL(apiOrigin ?? '');
		if (api.hostname !== '127.0.0.1' || api.protocol !== 'http:' || socket.host !== api.host ||
			socket.username || socket.password || socket.pathname !== '/realtime/v1/websocket') return null;
		return match[2].startsWith('WebSocket is closed') ? 'fixture-realtime-cancelled' : 'fixture-realtime-unavailable';
	} catch { return null; }
}
