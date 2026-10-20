// Synthetic Web Push service for staging measurements: accepts every message as a
// healthy provider would and stores nothing. It lives outside the application's
// Supabase project directory, so deploying the application's functions never
// includes it; it is deployed explicitly to the staging project only.
Deno.serve(async (request) => {
	if (request.method !== 'POST') return new Response('Not Found', { status: 404 });
	await request.arrayBuffer();
	return new Response(null, { status: 201 });
});
