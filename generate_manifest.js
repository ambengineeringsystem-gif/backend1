#!/usr/bin/env node
/**
 * generate_manifest.js
 *
 * Usage:
 *   node generate_manifest.js [input.json]
 *
 * Reads a kanban export JSON (columns -> arrays of cards) and writes per-task
 * JSON files into DATABASE/tasks, and an index at DATABASE/manifest.json
 */

const fs = require('fs');
const path = require('path');

const WORKDIR = __dirname;
const DATABASE_DIR = path.join(WORKDIR, 'DATABASE');
const TASKS_DIR = path.join(DATABASE_DIR, 'tasks');

function usage() {
	console.log('Usage: node generate_manifest.js [input.json]');
	console.log('If input.json is omitted the script will look for ./kanban_export.json');
}

function safeMkdir(dir) {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadInput(filePath) {
	if (!fs.existsSync(filePath)) {
		console.error('Input file not found:', filePath);
		process.exit(2);
	}
	const raw = fs.readFileSync(filePath, 'utf8');
	try {
		return JSON.parse(raw);
	} catch (e) {
		console.error('Failed to parse JSON:', e.message);
		process.exit(3);
	}
}

function flatten(state) {
	const tasks = [];
	for (const col of Object.keys(state)) {
		const arr = state[col] || [];
		for (const card of arr) {
			tasks.push(Object.assign({}, card, { column: col }));
		}
	}
	return tasks;
}

function writeTasks(tasks) {
	safeMkdir(TASKS_DIR);
	const index = [];
	for (const t of tasks) {
		const id = t.id || ('task_' + Date.now() + '_' + Math.random().toString(36).slice(2,7));
		const filename = id + '.json';
		const relPath = path.join('tasks', filename).replace(/\\/g, '/');
		const outPath = path.join(TASKS_DIR, filename);
		const content = {
			id,
			title: t.title || '',
			created: t.created || null,
			column: t.column || null,
			// preserve any other fields
			details: t.details || null,
			raw: t
		};
		fs.writeFileSync(outPath, JSON.stringify(content, null, 2), 'utf8');
		index.push({ id, title: content.title, path: relPath, column: content.column, created: content.created });
	}
	return index;
}

function writeManifest(index) {
	const manifest = {
		generatedAt: new Date().toISOString(),
		count: index.length,
		tasks: index
	};
	const outPath = path.join(DATABASE_DIR, 'manifest.json');
	fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
	return outPath;
}

function main() {
	const arg = process.argv[2] || path.join(WORKDIR, 'kanban_export.json');
	if (!arg || ['-h','--help'].includes(arg)) return usage();

	const inputPath = path.isAbsolute(arg) ? arg : path.join(WORKDIR, arg);
	const state = loadInput(inputPath);

	// Ensure DATABASE exists
	safeMkdir(DATABASE_DIR);

	const tasks = flatten(state);
	const index = writeTasks(tasks);
	const manifestPath = writeManifest(index);

	console.log(`Wrote ${index.length} task files to ${TASKS_DIR}`);
	console.log('Updated manifest at', manifestPath);
}

if (require.main === module) main();

