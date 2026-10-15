import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
	demoCaseEvents,
	demoCases,
	demoClinicalEntries,
	demoRadiographs,
	demoPatients,
	demoPeople
} from './demo-data';
import type {
	CaseEvent,
	CaseFile,
	ClinicalEntry,
	Patient,
	PatientRadiograph,
	Person
} from '$lib/types';

type DemoDb = {
	patients: Patient[];
	clinicalEntries: ClinicalEntry[];
	radiographs: PatientRadiograph[];
	people: Person[];
	cases: CaseFile[];
	caseEvents: CaseEvent[];
};

const DEMO_DB_PATH =
	process.env.DEMO_DB_PATH ?? path.join(process.cwd(), '.demo-data.local.json');

const seed: DemoDb = {
	patients: demoPatients,
	clinicalEntries: demoClinicalEntries,
	radiographs: demoRadiographs,
	people: demoPeople,
	cases: demoCases,
	caseEvents: demoCaseEvents
};

let cache: DemoDb | null = null;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const loadFromDisk = (): DemoDb | null => {
	try {
		const raw = fs.readFileSync(DEMO_DB_PATH, 'utf8');
		return JSON.parse(raw) as DemoDb;
	} catch (err) {
		return null;
	}
};

const persist = (db: DemoDb) => {
	cache = db;
	try {
		fs.writeFileSync(DEMO_DB_PATH, JSON.stringify(db, null, 2), 'utf8');
	} catch (err) {
		console.warn('No se pudo persistir el almacén local demo', err);
	}
};

const ensureDb = (): DemoDb => {
	if (cache) return cache;
	const fromDisk = loadFromDisk();
	if (fromDisk) {
		cache = fromDisk;
		return cache;
	}
	const initial = clone(seed);
	persist(initial);
	return initial;
};

export const readDemoDb = (): DemoDb => clone(ensureDb());

export const updateDemoDb = <T>(mutate: (db: DemoDb) => T): T => {
	const db = ensureDb();
	const result = mutate(db);
	persist(db);
	return result;
};

export const newId = (prefix: string) =>
	`${prefix}-${typeof randomUUID === 'function' ? randomUUID() : Math.random().toString(36).slice(2)}`;
