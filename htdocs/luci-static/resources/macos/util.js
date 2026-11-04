'use strict';
'require baseclass';
'require ui';

/*
 * Shared helpers for the macOS theme (icon mapping, formatting, i18n).
 */

const LANG = (L.env.lang || document.documentElement.getAttribute('lang') || 'en').toLowerCase();
const IS_ZH = LANG.indexOf('zh') === 0;

/* menu name -> icon basename */
const ICONS = {
	desktop: 'desktop',
	status: 'status',
	system: 'system',
	network: 'network',
	services: 'services',
	vpn: 'vpn',
	firewall: 'firewall',
	wifi: 'wifi',
	wireless: 'wifi',
	storage: 'storage',
	software: 'software',
	processes: 'processes',
	activity: 'activity',
	logs: 'logs',
	log: 'logs',
	reboot: 'reboot',
	logout: 'logout',
	users: 'users',
	dhcp: 'dhcp',
	dns: 'dns',
	routes: 'routes',
	terminal: 'terminal',
	ttyd: 'terminal',
	settings: 'settings',
	statistics: 'traffic',
	nlbwmon: 'traffic',
	sqm: 'traffic',
	qos: 'traffic',
	mwan3: 'routes',
	nas: 'storage',
	'filebrowser': 'storage',
	'docker': 'terminal',
	'passwall': 'vpn',
	'openclash': 'vpn',
	'openvpn': 'vpn',
	'wireguard': 'vpn',
	'shadowsocks': 'vpn',
	'adblock': 'firewall',
	'banip': 'firewall',
	'upnp': 'network',
	'ddns': 'network'
};

return baseclass.extend({
	lang: LANG,
	isZh: IS_ZH,

	/**
	 * Tiny bilingual helper. Menu titles already come translated from LuCI,
	 * this only covers the chrome labels shipped by the theme itself.
	 */
	t(en, zh) {
		return IS_ZH && zh != null ? zh : en;
	},

	iconName(name) {
		const n = String(name || '').toLowerCase().replace(/^luci-app-/, '').replace(/[^a-z0-9_-]/g, '');

		if (ICONS[n])
			return ICONS[n];

		for (const key in ICONS)
			if (n.indexOf(key) !== -1)
				return ICONS[key];

		return 'app';
	},

	iconUrl(name) {
		return L.media('icons/%s.svg'.format(this.iconName(name)));
	},

	appIcon(name, className, size) {
		return E('img', {
			'class': 'app-icon %s'.format(className || ''),
			'src': this.iconUrl(name),
			'width': size || 48,
			'height': size || 48,
			'alt': '',
			'draggable': 'false'
		});
	},

	hasWifi() {
		try { return L.hasSystemFeature('wifi'); } catch (e) { return false; }
	},

	formatBytes(value, digits) {
		let v = Number(value) || 0,
		    units = [ 'B', 'KB', 'MB', 'GB', 'TB' ],
		    i = 0;

		while (v >= 1024 && i < units.length - 1) {
			v /= 1024;
			i++;
		}

		return '%s %s'.format(v.toFixed(v >= 100 || i === 0 ? 0 : (digits != null ? digits : 1)), units[i]);
	},

	formatUptime(seconds) {
		let s = Math.max(0, Math.floor(Number(seconds) || 0)),
		    d = Math.floor(s / 86400),
		    h = Math.floor((s % 86400) / 3600),
		    m = Math.floor((s % 3600) / 60);

		if (d > 0)
			return this.t('%dd %dh'.format(d, h), '%d 天 %d 小时'.format(d, h));

		if (h > 0)
			return this.t('%dh %dm'.format(h, m), '%d 小时 %d 分'.format(h, m));

		return this.t('%dm'.format(m), '%d 分钟'.format(m));
	},

	formatLoad(load) {
		if (!Array.isArray(load))
			return '?';

		return '%.2f  %.2f  %.2f'.format(load[0] / 65535.0, load[1] / 65535.0, load[2] / 65535.0);
	},

	pct(used, total) {
		if (!total)
			return 0;

		return Math.max(0, Math.min(100, Math.round(used / total * 100)));
	},

	menuChildren(node) {
		return ui.menu.getChildren(node || {});
	},

	/* top level applications, without action entries like "logout" */
	apps(node) {
		return this.menuChildren(node).filter((child) => child.title && child.name !== 'logout');
	},

	modeNode(tree) {
		const mode = (L.env.requestpath || [])[0] || 'admin';

		return (tree && tree.children && tree.children[mode]) || (tree && tree.children && tree.children.admin) || tree;
	},

	/* translated menu title, with a special case for the theme's own desktop app */
	title(node) {
		if (!node)
			return '';

		if (node.name === 'desktop')
			return this.t('Desktop', '桌面');

		return node.title ? _(node.title) : '';
	},

	appTitle(node, fallback) {
		return this.title(node) || fallback || '';
	}
});
