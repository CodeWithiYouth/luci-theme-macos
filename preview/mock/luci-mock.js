/* Minimal LuCI runtime mock used by preview/mock-*.html.
 * It implements just enough of the LuCI APIs to run the theme JS modules
 * outside of a router. This file is part of the development preview only and
 * is never installed on the device. */
(function() {
	const BASE = '/htdocs/luci-static';
	const RES = BASE + '/resources';
	const MEDIA = BASE + '/macos';

	/* ---------------- tiny sprintf ---------------- */

	function fmtDuration(sec) {
		sec = Math.max(0, Math.floor(Number(sec) || 0));
		const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);

		if (d) return d + 'd ' + h + 'h';
		if (h) return h + 'h ' + m + 'm';
		return m + 'm';
	}

	String.prototype.format = function() {
		let i = 0;
		const args = arguments;

		return this.replace(/%(%|t|\.\d+f|[sdifh])/g, function(m, tok) {
			if (tok === '%') return '%';

			const a = args[i++];

			if (tok === 't') return fmtDuration(a);
			if (tok === 'd' || tok === 'i') return String(parseInt(a, 10) || 0);
			if (tok === 'f') return String(parseFloat(a) || 0);
			if (tok[0] === '.') return (parseFloat(a) || 0).toFixed(parseInt(tok.slice(1), 10));

			return String(a == null ? '' : a);
		});
	};

	/* ---------------- DOM helpers ---------------- */

	function append(parent, child) {
		if (child == null || child === false || child === true) return;

		if (Array.isArray(child)) {
			child.forEach(function(c) { append(parent, c); });
			return;
		}

		if (child instanceof Node) {
			parent.appendChild(child);
			return;
		}

		parent.appendChild(document.createTextNode(String(child)));
	}

	window.E = function(tag, attrs, children) {
		const el = document.createElement(tag);

		if (attrs) {
			for (const k in attrs) {
				const v = attrs[k];

				if (v == null) continue;

				if (k === 'class') el.className = v;
				else if (k === 'style') el.style.cssText = v;
				else if (typeof v === 'function') el.addEventListener(k, v);
				else el.setAttribute(k, v);
			}
		}

		append(el, children);

		return el;
	};

	/* ---------------- module loading ---------------- */

	function mkClass(proto) {
		function Cls() {
			if (typeof this.__init__ === 'function')
				this.__init__();
		}

		Object.assign(Cls.prototype, proto || {});

		return Cls;
	}

	const modules = {};

	async function loadModule(path, deps) {
		if (modules[path]) return modules[path];

		const src = await fetch(RES + '/' + path + '.js').then(function(r) {
			if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path);
			return r.text();
		});

		const names = Object.keys(deps);
		const fn = new Function(...names, src);
		const value = fn(...names.map(function(n) { return deps[n]; }));

		modules[path] = value;

		return value;
	}

	/* ---------------- fake router data ---------------- */

	const board = {
		hostname: 'OpenWrt',
		model: 'Xiaomi Router AX3000T',
		system: 'mediatek/filogic',
		kernel: '6.6.73',
		release: { description: 'OpenWrt 24.10.0', target: 'mediatek/filogic' },
		rootfs_type: 'squashfs'
	};

	const info = {
		uptime: 274320,
		load: [ 5432, 7208, 5898 ],
		memory: { total: 268435456, free: 144703488, buffered: 12058624, cached: 58720256 },
		swap: { total: 0, free: 0 },
		root: { total: 30412, used: 12480, free: 17932 },
		tmp: { total: 134217728, used: 1048576, free: 133169152 }
	};

	const version = { luciname: 'LuCI', luciversion: '24.10', branch: '24.10', revision: 'r1' };

	const leaseInfo = {
		dhcp_leases: [
			{ hostname: 'MacBook-Pro', ipaddr: '192.168.1.102', macaddr: 'AA:BB:CC:00:00:01', expires: 3600 },
			{ hostname: 'iPhone-15', ipaddr: '192.168.1.105', macaddr: 'AA:BB:CC:00:00:02', expires: 3500 },
			{ hostname: '电视盒子', ipaddr: '192.168.1.110', macaddr: 'AA:BB:CC:00:00:03', expires: 3400 },
			{ hostname: 'desktop-pc', ipaddr: '192.168.1.120', macaddr: 'AA:BB:CC:00:00:04', expires: 3300 },
			{ hostname: 'iPad-Air', ipaddr: '192.168.1.121', macaddr: 'AA:BB:CC:00:00:05', expires: 3200 },
			{ hostname: 'printer', ipaddr: '192.168.1.130', macaddr: 'AA:BB:CC:00:00:06', expires: 3100 }
		],
		dhcp6_leases: []
	};

	function wanNetwork() {
		return {
			getI18n: function() { return 'DHCP 客户端'; },
			getIPAddrs: function() { return [ '100.64.12.7' ]; },
			getGatewayAddr: function() { return '100.64.0.1'; },
			getDNSAddrs: function() { return [ '223.5.5.5', '119.29.29.29' ]; },
			getUptime: function() { return 93784; },
			getL3Device: function() { return ethDevice('eth1'); }
		};
	}

	function ethDevice(name, carrier, speed, duplex, type) {
		return {
			getName: function() { return name; },
			getType: function() { return type || 'ethernet'; },
			getI18n: function() { return 'Ethernet Adapter: "' + name + '"'; },
			isUp: function() { return !!carrier; },
			isDisabled: function() { return false; },
			isVirtual: function() { return type === 'bridge'; },
			getCarrier: function() { return !!carrier; },
			getSpeed: function() { return speed; },
			getDuplex: function() { return duplex; },
			getRXBytes: function() { return 0; },
			getTXBytes: function() { return 0; }
		};
	}

	/* intentionally incomplete, like some board.json files: only eth0 is listed */
	const ethernetPorts = [
		{ role: 'lan', device: 'eth0' }
	];

	function realtimeSeries() {
		const now = Math.floor(Date.now() / 1000),
		      out = [];

		let rx = 4200000000,
		    tx = 780000000;

		for (let i = 90; i >= 0; i--) {
			const p = (90 - i);

			rx += 220000 + (Math.sin(p / 9) + 1) / 2 * 3200000;
			tx += 60000 + (Math.cos(p / 11) + 1) / 2 * 520000;

			out.push([ now - i, Math.floor(rx), Math.floor(tx) ]);
		}

		return out;
	}

	function wifiNetwork(ssid, mode, channel, clients) {
		return {
			getActiveSSID: function() { return ssid; },
			getActiveMode: function() { return mode; },
			getChannel: function() { return channel; },
			isDisabled: function() { return false; },
			getAssocList: function() { return Promise.resolve(new Array(clients).fill({ mac: '00:00:00:00:00:00' })); },
			macos_assoc: new Array(clients).fill({})
		};
	}

	/* ---------------- menu tree ---------------- */

	const menuTree = {
		children: {
			admin: {
				name: 'admin', title: 'Administration', order: 10, satisfied: true,
				children: {
					desktop: { title: 'Desktop', order: 1, satisfied: true, children: {} },
					status: { title: 'Status', order: 10, satisfied: true, children: {
						overview: { title: 'Overview', order: 1, satisfied: true, children: {} },
						routes: { title: 'Routing', order: 2, satisfied: true, children: {} },
						logs: { title: 'System Log', order: 4, satisfied: true, children: {} },
						processes: { title: 'Processes', order: 6, satisfied: true, children: {} }
					} },
					system: { title: 'System', order: 20, satisfied: true, children: {
						system: { title: 'System', order: 1, satisfied: true, children: {} },
						admin: { title: 'Administration', order: 2, satisfied: true, children: {} },
						software: { title: 'Software', order: 3, satisfied: true, children: {} },
						startup: { title: 'Startup', order: 4, satisfied: true, children: {} },
						crontab: { title: 'Scheduled Tasks', order: 5, satisfied: true, children: {} },
						mounts: { title: 'Mount Points', order: 6, satisfied: true, children: {} },
						backup: { title: 'Backup / Flash Firmware', order: 7, satisfied: true, children: {} },
						reboot: { title: 'Reboot', order: 8, satisfied: true, children: {} }
					} },
					network: { title: 'Network', order: 50, satisfied: true, children: {
						network: { title: 'Interfaces', order: 1, satisfied: true, children: {} },
						wireless: { title: 'Wireless', order: 2, satisfied: true, children: {} },
						dhcp: { title: 'DHCP/DNS', order: 3, satisfied: true, children: {} },
						firewall: { title: 'Firewall', order: 4, satisfied: true, children: {} }
					} },
					services: { title: 'Services', order: 40, satisfied: true, children: {
						dhcp: { title: 'DHCP/DNS', order: 1, satisfied: true, children: {} },
						upnp: { title: 'UPnP', order: 2, satisfied: true, children: {} }
					} },
					vpn: { title: 'VPN', order: 70, satisfied: true, children: {
						wireguard: { title: 'WireGuard', order: 1, satisfied: true, children: {} }
					} },
					logout: { title: 'Log out', order: 999, satisfied: true, children: {} }
				}
			}
		}
	};

	/* ---------------- LuCI API ---------------- */

	const L = {
		env: {
			lang: 'zh_cn',
			requestpath: [ 'admin' ],
			dispatchpath: [ 'admin', 'desktop' ],
			media: MEDIA,
			resource: RES
		},
		media: function(p) { return MEDIA + '/' + p; },
		resource: function(p) { return RES + '/' + p; },
		url: function() {
			const parts = Array.prototype.slice.call(arguments).filter((p) => p != null && p !== '');

			if (parts[0] === 'admin') {
				const app = parts[1] || 'desktop';
				const sub = parts.slice(2).join('/');

				return 'mock-frame.html?app=' + encodeURIComponent(app) + '&sub=' + encodeURIComponent(sub);
			}

			return '/cgi-bin/luci/' + parts.join('/');
		},
		fspath: function(p) { return p; },
		isObject: function(v) { return v != null && typeof v === 'object'; },
		hasSystemFeature: function() { return true; },
		naturalCompare: new Intl.Collator(undefined, { numeric: true }).compare,
		bind: function(fn, self) {
			const extra = Array.prototype.slice.call(arguments, 2);

			return function() {
				return fn.apply(self, extra.concat(Array.prototype.slice.call(arguments)));
			};
		},
		resolveDefault: function(p, d) {
			return Promise.resolve(p).then(function(v) { return v == null ? d : v; }, function() { return d; });
		},
		require: function(name) {
			if (name === 'network') return Promise.resolve(network);
			if (name === 'ui') return Promise.resolve(ui);
			return loadModule(name.replace(/\./g, '/'), {});
		}
	};

	const rpc = {
		declare: function(spec) {
			return function() {
				switch (spec.method) {
				case 'board': return Promise.resolve(board);
				case 'info': return Promise.resolve(info);
				case 'getVersion': return Promise.resolve(version);
				case 'getUnixtime': return Promise.resolve(Math.floor(Date.now() / 1000));
				case 'getDHCPLeases': return Promise.resolve(leaseInfo);
				case 'getBuiltinEthernetPorts': return Promise.resolve(ethernetPorts);
				case 'getRealtimeStats': return Promise.resolve(realtimeSeries());
				case 'status': return Promise.resolve({
					statistics: { rx_bytes: Date.now() * 1000, tx_bytes: Date.now() * 200 }
				});
				default: return Promise.resolve(null);
				}
			};
		}
	};

	const fs = {
		trimmed: function(path) {
			return Promise.resolve(path.indexOf('max') !== -1 ? '16384' : '184');
		},
		read: function(path) {
			return Promise.resolve(path === '/etc/board.json' ? '{}' : '');
		}
	};

	const network = {
		flushCache: function() { return Promise.resolve(); },
		getWANNetworks: function() { return Promise.resolve([ wanNetwork() ]); },
		getWAN6Networks: function() { return Promise.resolve([]); },
		getWifiDevices: function() { return Promise.resolve([]); },
		getDevices: function() {
			return Promise.resolve([
				ethDevice('eth0', true, 1000, 'full'),
				ethDevice('eth1', true, 1000, 'full'),
				ethDevice('eth2', false, -1, null),
				ethDevice('eth3', true, 100, 'half'),
				ethDevice('br-lan', true, null, null, 'bridge')
			]);
		},
		getWifiNetworks: function() {
			return Promise.resolve([
				wifiNetwork('OpenWrt-5G', 'Master', 36, 5),
				wifiNetwork('OpenWrt', 'Master', 6, 2)
			]);
		}
	};

	const poll = {
		queue: [],
		add: function(fn) { this.queue.push(fn); }
	};

	const dom = {
		content: function(node, content) {
			if (!node) return;
			while (node.firstChild) node.removeChild(node.firstChild);
			append(node, content);
		}
	};

	function getChildren(node) {
		const out = [];

		if (!node || !node.children) return out;

		for (const k in node.children) {
			const child = node.children[k];

			if (!child || child.satisfied === false || !('title' in child)) continue;

			child.name = k;
			out.push(child);
		}

		return out.sort(function(a, b) { return (a.order || 1000) - (b.order || 1000); });
	}

	const ui = {
		menu: {
			load: function() { return Promise.resolve(menuTree); },
			getChildren: getChildren
		},
		showIndicator: function() {},
		hideIndicator: function() {},
		showModal: function() {},
		hideModal: function() {}
	};

	const baseclass = { extend: mkClass, singleton: mkClass };
	const view = { extend: mkClass };

	window._ = function(s) { return s; };
	window.L = L;

	/* ---------------- boot ---------------- */

	window.MockLuCI = {
		_L: L,
		ui: ui,
		network: network,

		setPath: function(path) {
			L.env.dispatchpath = ['admin'].concat(path);
		},

		bootDesktop: async function(container) {
			const utilClass = await loadModule('macos/util', { baseclass: baseclass, ui: ui });
			const util = new utilClass();
			const View = await loadModule('view/macos/desktop', {
				view: view, dom: dom, fs: fs, poll: poll, rpc: rpc,
				network: network, ui: ui, util: util
			});
			const inst = new View();
			const data = await inst.load();

			container.appendChild(inst.render(data));

			return inst;
		},

		bootChrome: async function() {
			const utilClass = await loadModule('macos/util', { baseclass: baseclass, ui: ui });
			const util = new utilClass();

			try {
				sessionStorage.removeItem('macos.open');
				history.replaceState(null, '', location.pathname + location.search);
			}
			catch (e) {}

			const WM = await loadModule('macos/windows', { baseclass: baseclass, ui: ui, util: util });
			const wm = new WM();
			const Menu = await loadModule('menu-macos', { baseclass: baseclass, ui: ui, util: util, wm: wm });
			const menu = new Menu();

			window.__wm = wm;

			return menu;
		}
	};
})();
