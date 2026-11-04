#!/usr/bin/env node
/*
 * Minimal static file server for the theme preview pages.
 *
 * Usage: node tools/preview-server.js [port]
 *        open http://127.0.0.1:8123/preview/desktop.html
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8123;

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.json': 'application/json; charset=utf-8'
};

http.createServer((req, res) => {
	const url = decodeURIComponent((req.url || '/').split('?')[0]);
	const file = path.join(ROOT, url === '/' ? 'preview/desktop.html' : url);

	if (!file.startsWith(ROOT)) {
		res.writeHead(403);
		res.end('forbidden');
		return;
	}

	fs.readFile(file, (err, data) => {
		if (err) {
			res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end('not found: ' + url);
			return;
		}

		res.writeHead(200, {
			'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
			'Cache-Control': 'no-store'
		});
		res.end(data);
	});
}).listen(PORT, '127.0.0.1', () => {
	console.log('preview server: http://127.0.0.1:' + PORT + '/preview/desktop.html');
});
