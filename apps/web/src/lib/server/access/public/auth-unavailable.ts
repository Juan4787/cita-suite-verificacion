import { createHash } from 'node:crypto';

// Standalone: recovery must render even when Auth or the application bundle is
// unavailable. These are the existing Cita Suite tokens, not a second theme.
const styles = `
:root{color-scheme:dark;--bg:#0b1626;--surface:#0b1d32;--text:#eaf1ff;--muted:rgba(234,241,255,.72);--accent:#7c3aed;--accent-hover:#6d28d9;--ring:#c4b5fd;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:17px;background:var(--bg);color:var(--text)}
*{box-sizing:border-box}
body{margin:0;min-width:0;min-height:100svh;display:grid;align-content:center;padding:clamp(1rem,4vw,3rem);overflow-wrap:anywhere}
main{width:100%;max-width:36rem;margin-inline:auto}
header{font-weight:700;margin-bottom:2rem}
section{padding:clamp(1.25rem,4vw,2rem);border:1px solid #244062;border-radius:1rem;background:var(--surface)}
h1{font-size:clamp(1.5rem,4vw,2rem);line-height:1.2;margin:0 0 1rem;letter-spacing:-.01em}
p{line-height:1.6;color:var(--muted);max-width:65ch;margin:0 0 1rem}
a{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;max-width:100%;margin-top:.5rem;padding:.85rem 1.25rem;border-radius:1rem;background:var(--accent);color:#fff;text-align:center;text-decoration:none;font-weight:700;transition:background-color .15s}
a:hover{background:var(--accent-hover)}
a:focus-visible{outline:2px solid var(--ring);outline-offset:4px}
::selection{background:#7c3aed;color:#fff}
@media(max-width:390px){a{width:100%}
}
@media(prefers-reduced-motion:reduce){a{transition:none}
}

`;
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Servicio de acceso no disponible · Cita Suite</title><style>${styles}</style></head><body><main><header>Cita Suite</header><section aria-labelledby="access-title"><h1 id="access-title">No pudimos comprobar tu sesión</h1><p>El servicio de acceso está momentáneamente no disponible.</p><p>Tus datos no se modificaron. Esperá unos segundos y volvé a intentar.</p><a href="">Volver a intentar</a></section></main></body></html>`;
const styleHash = createHash('sha256').update(styles).digest('base64');
const plain =
	'No pudimos validar tu sesión porque el servicio de acceso está momentáneamente no disponible. Tus datos no se modificaron. Esperá unos segundos y volvé a intentar.';

export function authUnavailableResponse(documentRequest: boolean): Response {
	return new Response(documentRequest ? html : plain, {
		status: 503,
		headers: {
			'content-type': documentRequest ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
			'cache-control': 'no-store',
			'retry-after': '10',
			'strict-transport-security': 'max-age=31536000',
			'content-security-policy': `default-src 'none'; style-src 'sha256-${styleHash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
			'x-content-type-options': 'nosniff',
			'x-frame-options': 'DENY',
			'referrer-policy': 'no-referrer',
			'permissions-policy': 'camera=(), microphone=(), geolocation=()'
		}
	});
}
