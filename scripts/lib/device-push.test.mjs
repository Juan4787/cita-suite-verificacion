import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceCleanupSql, deviceLinkQuery, devicePractice, deviceReportSql, deviceSeedSql } from './device-push.mjs';

test('a device run belongs to one environment and one 12-hex identifier', () => {
	assert.equal(devicePractice('staging', '0123456789ab'), 'staging-device-0123456789ab');
	assert.equal(devicePractice('production', '0123456789ab'), 'production-device-0123456789ab');
	for (const [environment, run] of [['development', '0123456789ab'], ['production', '0123456789aB'], ['staging', "x'; drop table businesses; --"], ['staging', undefined]])
		assert.throws(() => devicePractice(environment, run), /12 hexadecimal characters/);
});

test('every row the check writes or removes is of its own practice and owner', () => {
	const slug = devicePractice('production', 'abcdefabcdef');
	const seed = deviceSeedSql(slug, 'Prueba de dispositivo producción');
	assert.match(seed, /insert into auth\.users\(id,email\) values\(v_owner,'production-device-abcdefabcdef@example\.test'\)/);
	assert.match(seed, /values\('Prueba de dispositivo producción','production-device-abcdefabcdef',/);
	const cleanup = deviceCleanupSql(slug);
	const deletes = cleanup.split('\n').filter((line) => /^\s*delete /.test(line));
	assert.deepEqual(deletes.map((line) => line.trim().split(' ').slice(0, 3).join(' ')),
		['delete from public.businesses', 'delete from public.push_devices', 'delete from auth.users']);
	assert.match(cleanup, /delete from public\.businesses where slug='production-device-abcdefabcdef';/);
	assert.match(cleanup, /delete from auth\.users where email='production-device-abcdefabcdef@example\.test';/);
	// A device is removed only through the run's subscriptions, and only when no other subscription keeps it.
	assert.match(cleanup, /where d\.id=r\.device_id and not exists\(select 1 from public\.push_subscriptions s where s\.device_id=d\.id\)/);
	assert.match(deviceReportSql('abcdefabcdef', slug), /split_part\(d\.endpoint,'\/',3\)/);
	assert.equal(deviceLinkQuery('https://project.supabase.co', slug),
		'https://project.supabase.co/rest/v1/appointments?select=confirmation_token,businesses!inner(slug)&businesses.slug=eq.production-device-abcdefabcdef');
});
