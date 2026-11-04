#!/usr/bin/env node
/*
 * Generates the macOS style "squircle" application icons used by the theme.
 *
 * Usage:  node tools/gen-icons.js
 *
 * Every icon is a self contained SVG file so that it can be used directly
 * through <img src="..."> without any runtime dependency.
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'htdocs', 'luci-static', 'macos', 'icons');

/* 24x24 stroke based glyphs (SF-Symbols like line art) */
const GLYPHS = {
	monitor: ['M3 5.5h18v10H3z', 'M9 19.5h6', 'M12 15.5v4'],
	gauge: ['M4.5 17.5a7.5 7.5 0 1 1 15 0', 'M12 17.5l4.2-4.8', 'M12 17.5h.01'],
	gear: [
		'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
		'M12 3.2v2.4', 'M12 18.4v2.4', 'M3.2 12h2.4', 'M18.4 12h2.4',
		'M5.8 5.8l1.7 1.7', 'M16.5 16.5l1.7 1.7', 'M18.2 5.8l-1.7 1.7', 'M7.5 16.5l-1.7 1.7'
	],
	globe: [
		'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3.5 12h17',
		'M12 3c2.6 2.8 2.6 15.2 0 18', 'M12 3c-2.6 2.8-2.6 15.2 0 18'
	],
	puzzle: [
		'M10 4.2a2 2 0 0 1 4 0v1.2h2.8a1 1 0 0 1 1 1v2.9h-1.1a2 2 0 0 0 0 4h1.1v2.9a1 1 0 0 1-1 1H14v-1.1a2 2 0 0 0-4 0v1.1H7.2a1 1 0 0 1-1-1v-2.9h1.1a2 2 0 0 0 0-4H6.2V6.4a1 1 0 0 1 1-1H10z'
	],
	lock: ['M8 10V7.5a4 4 0 0 1 8 0V10', 'M6 10h12v10H6z', 'M12 14.2v2.6'],
	shield: [
		'M12 3.2l7 2.8v5.6c0 4.4-2.9 7.3-7 8.5-4.1-1.2-7-4.1-7-8.5V6z',
		'M8.8 12.1l2.2 2.2 4.2-4.4'
	],
	wifi: [
		'M2.6 8.2a15 15 0 0 1 18.8 0', 'M6 11.9a10 10 0 0 1 12 0',
		'M9.3 15.5a5.5 5.5 0 0 1 5.4 0', 'M12 19h.01'
	],
	disk: ['M4.5 5.5h15v13h-15z', 'M4.5 14.5h15', 'M7.8 17h.01', 'M16.2 17h.01'],
	box: ['M12 3.2l7.5 4.2v9.2L12 20.8l-7.5-4.2V7.4z', 'M4.5 7.4L12 11.6l7.5-4.2', 'M12 11.6v9.2'],
	pulse: ['M3 12h3.4l2.2-6 3.8 12 2.2-6H21'],
	doc: ['M7 3.5h6.5L18 8v12.5H7z', 'M13.5 3.5V8H18', 'M9.8 12h5.4', 'M9.8 15.5h5.4'],
	power: ['M12 3.5v8', 'M7.4 6.6a8 8 0 1 0 9.2 0'],
	door: ['M13.5 4.5H19v15h-5.5', 'M4.5 12h10.5', 'M11.5 8.5L15 12l-3.5 3.5'],
	person: ['M12 11.5a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6z', 'M4.8 20.2c.6-3.6 3.6-5.8 7.2-5.8s6.6 2.2 7.2 5.8'],
	plug: ['M8.5 3.5v5', 'M15.5 3.5v5', 'M6 8.5h12v3.2a6 6 0 0 1-12 0z', 'M12 17.7v3'],
	signpost: ['M12 3.5v17', 'M5 6h10.5l3 2.6-3 2.6H5z', 'M19 13.4H8.5l-3 2.6 3 2.6H19z'],
	terminal: ['M4.5 5.5h15v13h-15z', 'M8.2 10l2.8 2-2.8 2', 'M12.8 15h3.4'],
	sliders: [
		'M4 8.5h8.4', 'M17.2 8.5h2.8', 'M4 15.5h3.2', 'M12 15.5h8',
		'M15 8.5a2.1 2.1 0 1 0 4.2 0 2.1 2.1 0 0 0-4.2 0z',
		'M9.8 15.5a2.1 2.1 0 1 0 4.2 0 2.1 2.1 0 0 0-4.2 0z'
	],
	grid: ['M4.5 4.5h6v6h-6z', 'M13.5 4.5h6v6h-6z', 'M4.5 13.5h6v6h-6z', 'M13.5 13.5h6v6h-6z'],
	clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7.2v5.2l3.2 2'],
	chart: ['M4 20V9.5', 'M10 20V4.5', 'M16 20v-7', 'M21 20H3'],
	antenna: ['M12 20V9', 'M8.6 5.6a5 5 0 0 0 0 7', 'M15.4 5.6a5 5 0 0 1 0 7', 'M5.4 3a9 9 0 0 0 0 12', 'M18.6 3a9 9 0 0 1 0 12', 'M12 20h.01']
};

/* name -> [gradient top, gradient bottom, glyph] */
const ICONS = {
	desktop: ['#4F8CFF', '#7A5CFF', 'monitor'],
	status: ['#34C6A8', '#1E9BE0', 'gauge'],
	system: ['#A3A8B3', '#5A606B', 'gear'],
	network: ['#1E9BE0', '#1FC8DB', 'globe'],
	services: ['#FF9F0A', '#FF6482', 'puzzle'],
	vpn: ['#7A5CFF', '#B15CFF', 'lock'],
	firewall: ['#FF6B4A', '#E5314C', 'shield'],
	wifi: ['#2AA7FF', '#17D3C4', 'wifi'],
	wireless: ['#2AA7FF', '#17D3C4', 'wifi'],
	storage: ['#66707C', '#2F3944', 'disk'],
	software: ['#34C759', '#0FBFA8', 'box'],
	processes: ['#8E7CFF', '#5B5BF0', 'pulse'],
	activity: ['#8E7CFF', '#5B5BF0', 'pulse'],
	logs: ['#7C8798', '#4A5260', 'doc'],
	reboot: ['#FF9500', '#FF3B30', 'power'],
	logout: ['#5B8DEF', '#4A5A78', 'door'],
	users: ['#FF6FA8', '#A85CFF', 'person'],
	dhcp: ['#17C3E0', '#2A7BFF', 'plug'],
	dns: ['#19C58B', '#0E9AA8', 'globe'],
	routes: ['#FFB020', '#FF7A00', 'signpost'],
	terminal: ['#3A3A3C', '#101012', 'terminal'],
	settings: ['#9AA0AA', '#5A6068', 'sliders'],
	app: ['#9AA0AA', '#6B7280', 'grid'],
	clock: ['#4C6FFF', '#8E5CFF', 'clock'],
	traffic: ['#22C55E', '#0EA5E9', 'chart'],
	'default': ['#9AA0AA', '#6B7280', 'grid']
};

function svg([top, bottom, glyph]) {
	const paths = GLYPHS[glyph] || GLYPHS.grid;

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.25" y2="1">
      <stop offset="0" stop-color="${top}"/>
      <stop offset="1" stop-color="${bottom}"/>
    </linearGradient>
    <linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".34"/>
      <stop offset=".55" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="3" y="3" width="90" height="90" rx="21" fill="url(#g)"/>
  <rect x="3" y="3" width="90" height="90" rx="21" fill="url(#s)"/>
  <rect x="4.1" y="4.1" width="87.8" height="87.8" rx="19.9" fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width="1.4"/>
  <g fill="none" stroke="#ffffff" stroke-opacity=".96" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round" transform="translate(24 24) scale(2)">
${paths.map(p => `    <path d="${p}"/>`).join('\n')}
  </g>
</svg>
`;
}

fs.mkdirSync(OUT, { recursive: true });

for (const [name, def] of Object.entries(ICONS)) {
	const file = path.join(OUT, name === 'default' ? 'app.svg' : `${name}.svg`);
	fs.writeFileSync(file, svg(def), 'utf8');
	console.log('wrote', path.relative(process.cwd(), file));
}

/* Application logo (also used as favicon) */
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4F8CFF"/>
      <stop offset=".55" stop-color="#7A5CFF"/>
      <stop offset="1" stop-color="#FF6482"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="92" height="92" rx="23" fill="url(#lg)"/>
  <rect x="3.2" y="3.2" width="89.6" height="89.6" rx="21.8" fill="none" stroke="#ffffff" stroke-opacity=".25" stroke-width="1.5"/>
  <path d="M24 37a38 38 0 0 1 48 0" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity=".95"/>
  <path d="M33 49a25 25 0 0 1 30 0" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity=".95"/>
  <path d="M42 61a12 12 0 0 1 12 0" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity=".95"/>
  <circle cx="48" cy="72" r="3.4" fill="#ffffff"/>
</svg>
`;

fs.writeFileSync(path.join(__dirname, '..', 'htdocs', 'luci-static', 'macos', 'logo.svg'), logo, 'utf8');
console.log('wrote htdocs/luci-static/macos/logo.svg');
