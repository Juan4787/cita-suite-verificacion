import { env } from '$env/dynamic/public';
import {
	markPatientRevisionUnverified,
	observePatientRevisionEvent,
	patientRevisionState,
	verifyPatientRevision
} from '$lib/client/patient-list-cache';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@cita-suite/shared';
import { get } from 'svelte/store';

const SAFETY_CHECK_MS = 30_000;
const FALLBACK_CHECK_MS = 5_000;

let sharedRealtimeClient: SupabaseClient<Database> | null = null;
let sharedRealtimeUrl = '';
let sharedRealtimeKey = '';

const getSharedRealtimeClient = (url: string, key: string) => {
	if (sharedRealtimeClient && sharedRealtimeUrl === url && sharedRealtimeKey === key) {
		return sharedRealtimeClient;
	}
	if (sharedRealtimeClient) void sharedRealtimeClient.removeAllChannels().catch(() => {});
	sharedRealtimeUrl = url;
	sharedRealtimeKey = key;
	sharedRealtimeClient = createClient<Database>(url, key, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		realtime: { params: { eventsPerSecond: 2 } }
	});
	return sharedRealtimeClient;
};

type RevisionSyncOptions = {
	businessId: string;
	onRevisionChanged: () => void;
};

export const startPatientRevisionSync = ({
	businessId,
	onRevisionChanged
}: RevisionSyncOptions) => {
	if (typeof window === 'undefined') return () => {};

	let stopped = false;
	let client: SupabaseClient<Database> | null = null;
	let channel: RealtimeChannel | null = null;
	let subscribedTopic = '';
	let live = false;
	let safetyTimer: number | null = null;
	let fallbackTimer: number | null = null;
	let fallbackDelay = FALLBACK_CHECK_MS;
	let verification: Promise<void> | null = null;
	let reverifyRequested = false;
	let realtimeAuthReady: Promise<void> = Promise.resolve();

	const isVisible = () => document.visibilityState === 'visible';

	const stopFallback = () => {
		if (fallbackTimer) window.clearTimeout(fallbackTimer);
		fallbackTimer = null;
		fallbackDelay = FALLBACK_CHECK_MS;
	};

	const notifyAndVerify = () => {
		markPatientRevisionUnverified(businessId);
		onRevisionChanged();
		void refreshRevision(true);
	};

	// Sin Realtime verifica antes unas pocas veces (5, 10 y 20 s) y después queda la
	// verificación de seguridad: una pestaña no consulta cada pocos segundos por tiempo
	// indefinido, y una oculta no consulta.
	const startFallback = () => {
		const delay = fallbackDelay;
		if (fallbackTimer || stopped || delay >= SAFETY_CHECK_MS) return;
		fallbackTimer = window.setTimeout(() => {
			fallbackTimer = null;
			fallbackDelay = delay * 2;
			if (isVisible()) void refreshRevision();
			startFallback();
		}, delay);
	};

	const removeCurrentChannel = async () => {
		const currentClient = client;
		const currentChannel = channel;
		channel = null;
		subscribedTopic = '';
		if (currentClient && currentChannel) {
			await currentClient.removeChannel(currentChannel).catch(() => {});
		}
	};

	const subscribe = async (topic: string) => {
		if (stopped || !client || !topic || topic === subscribedTopic) return;
		await realtimeAuthReady;
		await removeCurrentChannel();
		if (stopped || !client) return;

		subscribedTopic = topic;
		channel = client
			.channel(topic, { config: { private: true, broadcast: { self: false } } })
			.on('broadcast', { event: 'data_revision' }, (message) => {
				const payload: unknown = message?.payload;
				if (typeof payload !== 'object' || payload === null || Array.isArray(payload) ||
					!('resource' in payload) || payload.resource !== 'patients' || !('revision' in payload)) return;
				if (observePatientRevisionEvent(businessId, payload.revision)) {
					onRevisionChanged();
					void refreshRevision(true);
				}
			})
			.subscribe((status) => {
				if (stopped) return;
				if (status === 'SUBSCRIBED') {
					live = true;
					stopFallback();
					// Cierra la carrera entre la verificación HTTP y la suscripción.
					void refreshRevision(true);
					return;
				}
				if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
					// Verifica al perder la conexión; los reintentos fallidos del cliente, cada
					// pocos segundos, no agregan nada a la verificación de respaldo.
					if (live) notifyAndVerify();
					live = false;
					startFallback();
				}
			});
	};

	async function refreshRevision(queueIfBusy = false) {
		if (stopped) return;
		if (verification) {
			if (queueIfBusy) reverifyRequested = true;
			return verification;
		}
		verification = (async () => {
			const before = get(patientRevisionState);
			try {
				const snapshot = await verifyPatientRevision(window.fetch.bind(window), businessId);
				if (stopped) return;
				const after = get(patientRevisionState);
				const changed =
					before.businessId === businessId &&
					Boolean(before.revision) &&
					(before.revision !== after.revision || before.cacheScope !== after.cacheScope);
				if (changed) onRevisionChanged();
				if (snapshot.cacheable && snapshot.topic) await subscribe(snapshot.topic);
			} catch {
				if (stopped) return;
				startFallback();
				if (before.status === 'verified') {
					markPatientRevisionUnverified(businessId);
					onRevisionChanged();
				}
			}
		})().finally(() => {
			verification = null;
			if (reverifyRequested && !stopped) {
				reverifyRequested = false;
				queueMicrotask(() => void refreshRevision());
			}
		});
		return verification;
	}

	const verifyAfterReturning = () => {
		if (!isVisible()) return;
		if (verification) return;
		markPatientRevisionUnverified(businessId);
		onRevisionChanged();
		void refreshRevision();
	};

	const supabaseUrl = env.PUBLIC_ODONTO_SUPABASE_URL?.trim();
	const supabaseKey = env.PUBLIC_ODONTO_SUPABASE_ANON_KEY?.trim();
	if (supabaseUrl && supabaseKey) {
		try {
			new URL(supabaseUrl);
			client = getSharedRealtimeClient(supabaseUrl, supabaseKey);
			realtimeAuthReady = client.realtime.setAuth(supabaseKey).catch(() => startFallback());
		} catch {
			client = null;
		}
	}
	if (!client) startFallback();

	document.addEventListener('visibilitychange', verifyAfterReturning);
	window.addEventListener('focus', verifyAfterReturning);
	window.addEventListener('online', verifyAfterReturning);
	safetyTimer = window.setInterval(() => {
		if (isVisible()) void refreshRevision();
	}, SAFETY_CHECK_MS);
	void refreshRevision();

	return () => {
		stopped = true;
		document.removeEventListener('visibilitychange', verifyAfterReturning);
		window.removeEventListener('focus', verifyAfterReturning);
		window.removeEventListener('online', verifyAfterReturning);
		if (safetyTimer) window.clearInterval(safetyTimer);
		stopFallback();
		void removeCurrentChannel();
		client = null;
	};
};
