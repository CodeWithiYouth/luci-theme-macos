'use strict';
'require view';
'require dom';
'require fs';
'require poll';
'require rpc';
'require network';
'require ui';
'require macos.util as util';

/*
 * The macOS desktop. It replaces the classic "Status / Overview" landing page
 * with a desktop that shows live information about the router and provides
 * quick access to every LuCI application.
 */

const callSystemBoard = rpc.declare({ object: 'system', method: 'board' });
const callSystemInfo = rpc.declare({ object: 'system', method: 'info' });
const callLuciVersion = rpc.declare({ object: 'luci', method: 'getVersion' });
const callUnixtime = rpc.declare({ object: 'luci', method: 'getUnixtime', expect: { result: 0 } });
const callDHCPLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });

/* realtime counters collected by the luci-bwc helper (same data as the
 * "Realtime Graphs" page) */
const callRealtimeStats = rpc.declare({
	object: 'luci',
	method: 'getRealtimeStats',
	params: [ 'mode', 'device' ],
	expect: { result: [] }
});

/* physical ethernet ports with their lan/wan role */
const callBuiltinPorts = rpc.declare({
	object: 'luci',
	method: 'getBuiltinEthernetPorts',
	expect: { result: [] }
});

/* fallback counter source when luci-bwc is not available */
const callDeviceStatus = rpc.declare({
	object: 'network.device',
	method: 'status',
	params: [ 'name' ],
	expect: { '': {} }
});

const CONNTRACK_COUNT = '/proc/sys/net/netfilter/nf_conntrack_count';
const CONNTRACK_MAX = '/proc/sys/net/netfilter/nf_conntrack_max';

/* number of chart samples and the polling interval (seconds) */
const TRAFFIC_POINTS = 90;
const TRAFFIC_INTERVAL = 2;

function leases(info) {
	const list = info && Array.isArray(info.dhcp_leases) ? info.dhcp_leases.slice() : [];

	return list.sort((a, b) => (a.expires || 0) < (b.expires || 0) ? 1 : -1);
}

function svgEl(tag, attrs) {
	const el = document.createElementNS('http://www.w3.org/2000/svg', tag);

	for (const k in attrs)
		el.setAttribute(k, attrs[k]);

	return el;
}

/* pick a "nice" upper bound for the y axis (1/2/5 * 1024^n) */
function niceMax(value) {
	if (!(value > 0))
		return 1024;

	let scale = 1;

	while (value / scale >= 1024)
		scale *= 1024;

	const n = value / scale;

	return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * scale;
}

function rateParts(bytesPerSecond) {
	const v = Math.max(0, Number(bytesPerSecond) || 0);

	if (v < 1024)
		return { value: String(Math.round(v)), unit: 'B/s' };

	if (v < 1048576)
		return { value: (v / 1024).toFixed(v >= 102400 ? 0 : 1), unit: 'KB/s' };

	if (v < 1073741824)
		return { value: (v / 1048576).toFixed(v >= 104857600 ? 0 : 1), unit: 'MB/s' };

	return { value: (v / 1073741824).toFixed(2), unit: 'GB/s' };
}

return view.extend({
	load() {
		return Promise.all([
			ui.menu.load(),
			L.resolveDefault(callSystemBoard(), {}),
			L.resolveDefault(callSystemInfo(), {}),
			L.resolveDefault(callLuciVersion(), {}),
			L.resolveDefault(callUnixtime(), 0),
			L.resolveDefault(callDHCPLeases(), {}),
			L.resolveDefault(fs.trimmed(CONNTRACK_COUNT), null),
			L.resolveDefault(fs.trimmed(CONNTRACK_MAX), null),
			L.resolveDefault(network.getWANNetworks(), []),
			this.loadWifi(),
			L.resolveDefault(callBuiltinPorts(), []),
			L.resolveDefault(fs.read('/etc/board.json'), '{}'),
			L.resolveDefault(network.getDevices(), [])
		]);
	},

	loadWifi() {
		if (!util.hasWifi())
			return Promise.resolve([ [], [] ]);

		return Promise.all([
			L.resolveDefault(network.getWifiDevices(), []),
			L.resolveDefault(network.getWifiNetworks(), [])
		]).then((data) => {
			const nets = (data[1] || []).filter((net) => !net.isDisabled());

			return Promise.all(nets.map((net) =>
				L.resolveDefault(net.getAssocList(), []).then((list) => {
					net.macos_assoc = list || [];
					return net;
				})
			)).then(() => [ data[0] || [], nets ]);
		});
	},

	/* ------------------------------------------------------------------ */
	/* small DOM helpers                                                  */
	/* ------------------------------------------------------------------ */

	row(label, value, extraClass) {
		return E('div', { 'class': 'widget-row' + (extraClass ? ' ' + extraClass : '') }, [
			E('span', { 'class': 'widget-label' }, [ label ]),
			E('span', { 'class': 'widget-value' }, [ value == null || value === '' ? '—' : value ])
		]);
	},

	meter(label, percent, text) {
		return E('div', { 'class': 'widget-meter' }, [
			E('div', { 'class': 'widget-meter-head' }, [
				E('span', { 'class': 'widget-label' }, [ label ]),
				E('span', { 'class': 'widget-value' }, [ text || '%d%%'.format(percent) ])
			]),
			E('div', { 'class': 'meter' }, [
				E('i', { 'style': 'width:%d%%'.format(percent) })
			])
		]);
	},

	stat(value, caption) {
		return E('div', { 'class': 'widget-stat' }, [
			E('span', { 'class': 'widget-stat-value' }, [ value ]),
			E('span', { 'class': 'widget-stat-caption' }, [ caption ])
		]);
	},

	widgetHead(icon, title, href) {
		return E('div', { 'class': 'widget-head' }, [
			util.appIcon(icon, 'widget-icon', 22),
			E('span', { 'class': 'widget-title' }, [ title ]),
			href ? E('span', { 'class': 'widget-chevron', 'aria-hidden': 'true' }, [ '›' ]) : null
		]);
	},

	/* ------------------------------------------------------------------ */
	/* widgets                                                            */
	/* ------------------------------------------------------------------ */

	renderClock(board, version) {
		const time = E('div', { 'class': 'clock-time' }, [ '--:--' ]);
		const date = E('div', { 'class': 'clock-date' }, [ '' ]);

		this.refs.clockTime = time;
		this.refs.clockDate = date;

		return E('a', {
			'class': 'widget widget-clock',
			'href': L.url('admin', 'status', 'overview'),
			'data-app': 'status',
			'data-label': util.t('Overview', '概览'),
			'title': util.t('Open settings', '打开设置')
		}, [
			time,
			date,
			E('div', { 'class': 'clock-host' }, [
				E('span', { 'class': 'status-dot is-up' }),
				E('span', {}, [ '%s · %s'.format(board.hostname || '?', version.branch || 'LuCI') ])
			])
		]);
	},

	renderSystem(board, info) {
		const mem = info.memory || {};
		const root = info.root || {};
		const release = L.isObject(board.release) ? board.release : {};

		const memUsed = (mem.total && mem.free) ? mem.total - mem.free : 0;
		const memPct = util.pct(memUsed, mem.total);
		const diskPct = util.pct(root.used * 1024, root.total * 1024);

		this.refs.uptime = E('span', {}, [ info.uptime ? util.formatUptime(info.uptime) : '—' ]);
		this.refs.load = E('span', {}, [ util.formatLoad(info.load) ]);
		this.refs.memText = E('span', { 'class': 'widget-value' }, [ '%d%%'.format(memPct) ]);
		this.refs.memBar = E('i', { 'style': 'width:%d%%'.format(memPct) });

		return E('a', {
			'class': 'widget widget-system',
			'href': L.url('admin', 'status', 'overview'),
			'data-app': 'status',
			'data-label': util.t('System Information', '系统信息')
		}, [
			this.widgetHead('system', util.t('System Information', '系统信息'), true),
			E('div', { 'class': 'widget-stat-row' }, [
				this.stat(board.hostname || '?', util.t('Hostname', '主机名')),
				this.stat(mem.total ? util.formatBytes(mem.total) : '—', util.t('Memory', '内存'))
			]),
			E('div', { 'class': 'widget-rows' }, [
				this.row(util.t('Model', '设备型号'), board.model || '—'),
				this.row(util.t('Firmware', '固件版本'), release.description || '—'),
				this.row(util.t('Uptime', '运行时间'), this.refs.uptime),
				this.row(util.t('Load Average', '负载'), this.refs.load)
			]),
			E('div', { 'class': 'widget-meter' }, [
				E('div', { 'class': 'widget-meter-head' }, [
					E('span', { 'class': 'widget-label' }, [ util.t('Memory', '内存') ]),
					this.refs.memText
				]),
				E('div', { 'class': 'meter' }, [ this.refs.memBar ])
			]),
			this.meter(util.t('Storage', '存储'), diskPct,
				(root.used != null && root.total)
					? '%s / %s'.format(util.formatBytes(root.used * 1024), util.formatBytes(root.total * 1024))
					: '—')
		]);
	},

	renderNetwork(wan, conntrack) {
		const net = wan && wan[0];
		const connected = !!(net && net.getIPAddrs && net.getIPAddrs().length);

		this.refs.wanDot = E('span', { 'class': 'status-dot' + (connected ? ' is-up' : ' is-down') });
		this.refs.wanTitle = E('span', {}, [ connected ? net.getI18n() : util.t('Not connected', '未连接') ]);
		this.refs.wanAddr = E('span', {}, [ connected ? net.getIPAddrs().join(', ') : '—' ]);
		this.refs.wanGw = E('span', {}, [ connected ? (net.getGatewayAddr() || '—') : '—' ]);
		this.refs.wanDns = E('span', {}, [
			connected && net.getDNSAddrs ? (net.getDNSAddrs().join(', ') || '—') : '—'
		]);
		this.refs.wanUptime = E('span', {}, [
			connected && net.getUptime && net.getUptime() > 0 ? '%t'.format(net.getUptime()) : '—'
		]);
		this.refs.conntrack = E('span', {}, [
			conntrack ? '%s / %s'.format(this.refs.conntrackCount || conntrack, this.refs.conntrackMax || '?') : '—'
		]);

		return E('a', {
			'class': 'widget widget-network',
			'href': L.url('admin', 'network', 'network'),
			'data-app': 'network',
			'data-label': util.t('Network', '网络')
		}, [
			this.widgetHead('network', util.t('Network', '网络'), true),
			E('div', { 'class': 'widget-stat-row' }, [
				E('div', { 'class': 'widget-stat' }, [
					E('span', { 'class': 'widget-stat-value widget-stat-inline' }, [
						this.refs.wanDot,
						this.refs.wanTitle
					]),
					E('span', { 'class': 'widget-stat-caption' }, [ util.t('Protocol', '协议') ])
				])
			]),
			E('div', { 'class': 'widget-rows' }, [
				this.row(util.t('Address', '地址'), this.refs.wanAddr),
				this.row(util.t('Gateway', '网关'), this.refs.wanGw),
				this.row(util.t('DNS', 'DNS'), this.refs.wanDns),
				this.row(util.t('Connected', '已连接'), this.refs.wanUptime),
				this.row(util.t('Connections', '连接数'), this.refs.conntrack)
			])
		]);
	},

	/* ------------------------------------------------------------------ */
	/* live traffic chart                                                 */
	/* ------------------------------------------------------------------ */

	chooseTrafficDevice(wan, devices) {
		let name = null;

		try {
			const l3 = wan && wan[0] && wan[0].getL3Device ? wan[0].getL3Device() : null;

			name = l3 ? l3.getName() : null;
		}
		catch (e) {}

		if (!name) {
			const names = (devices || []).map((dev) => dev.getName());

			if (names.indexOf('br-lan') !== -1) {
				name = 'br-lan';
			}
			else {
				const eth = (devices || []).filter((dev) => {
					try { return dev.getType() === 'ethernet' && dev.isUp(); }
					catch (e) { return false; }
				});

				name = eth.length ? eth[0].getName() : (names[0] || null);
			}
		}

		return name;
	},

	renderTraffic(device) {
		if (!device)
			return null;

		const svg = svgEl('svg', {
			'class': 'traffic-chart',
			'viewBox': '0 0 600 140',
			'preserveAspectRatio': 'none',
			'aria-hidden': 'true'
		});

		const defs = svgEl('defs');

		[
			[ 'traffic-rx-fill', '#0a84ff' ],
			[ 'traffic-tx-fill', '#34c759' ]
		].forEach(([ id, color ]) => {
			const grad = svgEl('linearGradient', { 'id': id, 'x1': '0', 'y1': '0', 'x2': '0', 'y2': '1' });

			grad.appendChild(svgEl('stop', { 'offset': '0', 'stop-color': color, 'stop-opacity': '.34' }));
			grad.appendChild(svgEl('stop', { 'offset': '1', 'stop-color': color, 'stop-opacity': '0' }));
			defs.appendChild(grad);
		});

		svg.appendChild(defs);

		[ 0.25, 0.5, 0.75 ].forEach((factor) => {
			const y = (6 + 128 * factor).toFixed(1);

			svg.appendChild(svgEl('line', {
				'class': 'traffic-grid',
				'x1': '0', 'x2': '600', 'y1': y, 'y2': y
			}));
		});

		const rxArea = svgEl('path', { 'class': 'traffic-area rx', 'd': '' });
		const txArea = svgEl('path', { 'class': 'traffic-area tx', 'd': '' });
		const rxLine = svgEl('path', { 'class': 'traffic-line rx', 'd': '' });
		const txLine = svgEl('path', { 'class': 'traffic-line tx', 'd': '' });

		svg.appendChild(rxArea);
		svg.appendChild(txArea);
		svg.appendChild(rxLine);
		svg.appendChild(txLine);

		const rxValue = E('span', { 'class': 'traffic-value' }, [ '0' ]);
		const rxUnit = E('span', { 'class': 'traffic-unit' }, [ 'B/s' ]);
		const txValue = E('span', { 'class': 'traffic-value' }, [ '0' ]);
		const txUnit = E('span', { 'class': 'traffic-unit' }, [ 'B/s' ]);
		const peakEl = E('span', { 'class': 'widget-value' }, [ '—' ]);
		const totalEl = E('span', { 'class': 'traffic-total' }, [ '—' ]);

		this.refs.traffic = {
			device, rxArea, txArea, rxLine, txLine,
			rxValue, rxUnit, txValue, txUnit, peakEl, totalEl,
			fallback: null
		};

		return E('a', {
			'class': 'widget widget-traffic',
			'href': L.url('admin', 'status', 'realtime', 'bandwidth'),
			'data-app': 'status',
			'data-label': util.t('Live Traffic', '实时流量')
		}, [
			E('div', { 'class': 'widget-head' }, [
				util.appIcon('traffic', 'widget-icon', 22),
				E('span', { 'class': 'widget-title' }, [ util.t('Live Traffic', '实时流量') ]),
				E('span', { 'class': 'widget-device' }, [ device ]),
				E('span', { 'class': 'widget-chevron', 'aria-hidden': 'true' }, [ '›' ])
			]),
			E('div', { 'class': 'traffic-rates' }, [
				E('div', { 'class': 'traffic-rate rx' }, [
					E('span', { 'class': 'traffic-arrow', 'aria-hidden': 'true' }, [ '↓' ]),
					rxValue, rxUnit,
					E('span', { 'class': 'traffic-label' }, [ util.t('Download', '下行') ])
				]),
				E('div', { 'class': 'traffic-rate tx' }, [
					E('span', { 'class': 'traffic-arrow', 'aria-hidden': 'true' }, [ '↑' ]),
					txValue, txUnit,
					E('span', { 'class': 'traffic-label' }, [ util.t('Upload', '上行') ])
				])
			]),
			E('div', { 'class': 'traffic-chart-wrap' }, [ svg ]),
			E('div', { 'class': 'traffic-meta' }, [
				E('span', {}, [ util.t('Peak', '峰值') ]),
				peakEl,
				totalEl
			])
		]);
	},

	pollTraffic() {
		const t = this.refs.traffic;

		if (!t)
			return Promise.resolve();

		return L.resolveDefault(callRealtimeStats('interface', t.device), []).then((series) => {
			const rates = [];
			let sample = null;

			for (let i = 1; Array.isArray(series) && i < series.length; i++) {
				const dt = series[i][0] - series[i - 1][0];

				if (!(dt > 0))
					continue;

				rates.push({
					rx: Math.max(0, (series[i][1] - series[i - 1][1]) / dt),
					tx: Math.max(0, (series[i][2] - series[i - 1][2]) / dt)
				});

				sample = series[i];
			}

			if (rates.length >= 2) {
				t.fallback = null;
				this.drawTraffic(rates.slice(-TRAFFIC_POINTS), sample);

				return;
			}

			/* luci-bwc unavailable: sample the kernel counters ourselves */
			return L.resolveDefault(callDeviceStatus(t.device), null).then((status) => {
				if (!status)
					return;

				const stats = status.statistics || status.stats || {};
				const now = Date.now() / 1000;
				const rx = Number(stats.rx_bytes) || 0;
				const tx = Number(stats.tx_bytes) || 0;

				if (!t.fallback)
					t.fallback = { last: null, rates: [] };

				if (t.fallback.last) {
					const dt = now - t.fallback.last.t;

					if (dt > 0) {
						t.fallback.rates.push({
							rx: Math.max(0, (rx - t.fallback.last.rx) / dt),
							tx: Math.max(0, (tx - t.fallback.last.tx) / dt)
						});
						t.fallback.rates = t.fallback.rates.slice(-TRAFFIC_POINTS);
					}
				}

				t.fallback.last = { t: now, rx, tx };
				this.drawTraffic(t.fallback.rates, [ now, rx, tx ]);
			});
		});
	},

	drawTraffic(rates, sample) {
		const t = this.refs.traffic;

		if (!t)
			return;

		const current = rates.length ? rates[rates.length - 1] : { rx: 0, tx: 0 };
		const peak = rates.reduce((max, rate) => Math.max(max, rate.rx, rate.tx), 0);

		const rx = rateParts(current.rx);
		const tx = rateParts(current.tx);
		const pk = rateParts(peak);

		t.rxValue.textContent = rx.value;
		t.rxUnit.textContent = rx.unit;
		t.txValue.textContent = tx.value;
		t.txUnit.textContent = tx.unit;
		t.peakEl.textContent = '%s %s'.format(pk.value, pk.unit);

		if (sample && sample.length >= 3) {
			t.totalEl.textContent = util.t(
				'Total ↓ %s ↑ %s'.format(util.formatBytes(sample[1]), util.formatBytes(sample[2])),
				'累计 ↓ %s ↑ %s'.format(util.formatBytes(sample[1]), util.formatBytes(sample[2]))
			);
		}

		const W = 600, H = 140, PAD = 6;
		const innerH = H - PAD * 2;

		let scale = niceMax(Math.max(peak, 1024));

		/* avoid constant rescaling on small fluctuations */
		if (t.scale && peak <= t.scale && peak > t.scale * 0.55)
			scale = t.scale;

		t.scale = scale;

		const stepX = W / Math.max(1, rates.length - 1);
		const offset = 0;

		const paths = (key) => {
			const pts = rates.map((rate, i) => {
				const x = (offset + i) * stepX;
				const y = PAD + innerH - Math.min(1, (rate[key] || 0) / scale) * innerH;

				return [ x.toFixed(1), y.toFixed(1) ];
			});

			if (pts.length < 2)
				return { line: '', area: '' };

			const joined = pts.map((pt) => pt[0] + ' ' + pt[1]).join(' L');

			return {
				line: 'M' + joined,
				area: 'M' + pts[0][0] + ' ' + H + ' L' + joined +
					' L' + pts[pts.length - 1][0] + ' ' + H + ' Z'
			};
		};

		const rxPath = paths('rx');
		const txPath = paths('tx');

		t.rxLine.setAttribute('d', rxPath.line);
		t.txLine.setAttribute('d', txPath.line);
		t.rxArea.setAttribute('d', rxPath.area);
		t.txArea.setAttribute('d', txPath.area);
	},

	/* ------------------------------------------------------------------ */
	/* ethernet ports                                                     */
	/* ------------------------------------------------------------------ */

	buildPortList(builtin, boardJson, devices, wan) {
		const ports = [];
		const byName = {};

		const add = (name, role) => {
			if (!name)
				return;

			const existing = byName[name];

			if (existing) {
				if (role && existing.role === 'unknown')
					existing.role = role;

				return;
			}

			const port = { name, role: role || 'unknown' };

			byName[name] = port;
			ports.push(port);
		};

		(builtin || []).forEach((port) => add(port.device, port.role));

		if (!builtin || !builtin.length) {
			try {
				const board = JSON.parse(boardJson || '{}');

				[ 'lan', 'wan' ].forEach((role) => {
					const net = board && board.network ? board.network[role] : null;

					if (!net)
						return;

					if (Array.isArray(net.ports))
						net.ports.forEach((name) => add(name, role));
					else if (typeof net.device === 'string')
						add(net.device, role);
				});
			}
			catch (e) {}
		}

		/* also include physical ethernet devices missing from board.json */
		(devices || []).forEach((dev) => {
			try {
				if (dev.getType() !== 'ethernet')
					return;

				if (typeof(dev.isVirtual) === 'function' && dev.isVirtual())
					return;

				add(dev.getName(), null);
			}
			catch (e) {}
		});

		/* determine the role of the currently active WAN devices */
		(wan || []).forEach((net) => {
			try {
				const l3 = net.getL3Device ? net.getL3Device() : null;

				if (l3 && byName[l3.getName()])
					byName[l3.getName()].role = 'wan';
			}
			catch (e) {}
		});

		return ports.sort((a, b) => L.naturalCompare(a.name, b.name));
	},

	roleLabel(role) {
		if (role === 'lan')
			return 'LAN';

		if (role === 'wan')
			return 'WAN';

		return util.t('Ethernet', '以太网');
	},

	formatSpeed(speed, duplex) {
		const s = Number(speed);

		if (!(s > 0))
			return util.t('No link', '未连接');

		const gbit = (s % 1000 === 0) ? String(s / 1000) : (s / 1000).toFixed(1);

		if (s >= 1000)
			return gbit + ' GbE';

		return s + ' M';
	},

	renderPorts(ports, devices) {
		const deviceNames = {};

		(devices || []).forEach((dev) => {
			try { deviceNames[dev.getName()] = true; }
			catch (e) {}
		});

		let known = (ports || []).slice();

		/* drop ports that are not exposed as netdevs (e.g. swconfig switch ports) */
		if (Object.keys(deviceNames).length)
			known = known.filter((port) => deviceNames[port.name]);

		if (!known.length)
			(devices || []).forEach((dev) => {
				try {
					if (dev.getType() === 'ethernet')
						known.push({ name: dev.getName(), role: 'unknown' });
				}
				catch (e) {}
			});

		if (!known.length)
			return null;

		this.refs.ports = [];

		const grid = E('div', { 'class': 'ports-grid' });

		known.forEach((port) => {
			const led = E('span', { 'class': 'port-led' });
			const sub = E('small', {}, [ '—' ]);
			const speed = E('span', { 'class': 'port-speed' }, [ '—' ]);
			const item = E('div', { 'class': 'port-item is-down' }, [
				led,
				E('div', { 'class': 'port-text' }, [
					E('strong', {}, [ port.name ]),
					sub
				]),
				speed
			]);

			this.refs.ports.push({ name: port.name, role: port.role, item, led, sub, speed });
			grid.appendChild(item);
		});

		this.updatePorts(devices);

		return E('a', {
			'class': 'widget widget-ports',
			'href': L.url('admin', 'network', 'network'),
			'data-app': 'network',
			'data-label': util.t('Port Status', '网口状态')
		}, [
			this.widgetHead('network', util.t('Port Status', '网口状态'), true),
			grid
		]);
	},

	updatePorts(devices) {
		if (!this.refs.ports)
			return;

		const map = {};

		(devices || []).forEach((dev) => {
			try { map[dev.getName()] = dev; }
			catch (e) {}
		});

		this.refs.ports.forEach((port) => {
			const dev = map[port.name];
			let carrier = false, speed = null, duplex = null;

			if (dev) {
				try {
					carrier = !!dev.getCarrier();
					speed = dev.getSpeed();
					duplex = dev.getDuplex();
				}
				catch (e) {}
			}

			if (speed === -1)
				speed = null;

			port.led.className = 'port-led' + (carrier ? ' is-up' : '');
			port.item.classList.toggle('is-down', !carrier);
			port.speed.textContent = carrier
				? (speed > 0 ? this.formatSpeed(speed) : util.t('Linked', '已连接'))
				: util.t('No link', '未连接');

			const parts = [];

			if (port.role === 'lan' || port.role === 'wan')
				parts.push(port.role.toUpperCase());

			if (carrier && duplex)
				parts.push(duplex === 'half' ? util.t('Half duplex', '半双工') : util.t('Full duplex', '全双工'));

			port.sub.textContent = parts.join(' · ') ||
				(carrier ? util.t('Linked', '已连接') : util.t('Unplugged', '未插网线'));
		});
	},

	wifiItems(nets) {
		const list = E('div', { 'class': 'widget-list' });

		(nets || []).forEach((net) => {
			let subtitle = '';

			try {
				subtitle = '%s · ch %s'.format(
					net.getActiveMode ? net.getActiveMode() : 'Wi-Fi',
					net.getChannel ? net.getChannel() : '?'
				);
			}
			catch (e) {}

			list.appendChild(E('div', { 'class': 'list-item' }, [
				util.appIcon('wifi', 'list-icon', 20),
				E('div', { 'class': 'list-text' }, [
					E('strong', {}, [ net.getActiveSSID ? (net.getActiveSSID() || '?') : '?' ]),
					E('small', {}, [ subtitle ])
				]),
				E('span', { 'class': 'badge' }, [ String((net.macos_assoc || []).length) ])
			]));
		});

		return list;
	},

	renderWireless(nets) {
		if (!nets || nets.length === 0)
			return null;

		const total = nets.reduce((sum, net) => sum + (net.macos_assoc || []).length, 0);

		this.refs.wifiTotal = total;
		this.refs.wifiTotalEl = E('span', { 'class': 'widget-stat-value' }, [ String(total) ]);
		this.refs.wifiList = this.wifiItems(nets);

		return E('a', {
			'class': 'widget widget-wireless',
			'href': L.url('admin', 'network', 'wireless'),
			'data-app': 'network',
			'data-label': util.t('Wireless', '无线')
		}, [
			this.widgetHead('wifi', util.t('Wireless', '无线'), true),
			E('div', { 'class': 'widget-stat-row' }, [
				E('div', { 'class': 'widget-stat' }, [
					this.refs.wifiTotalEl,
					E('span', { 'class': 'widget-stat-caption' }, [ util.t('Associated Stations', '已连接客户端') ])
				])
			]),
			this.refs.wifiList
		]);
	},

	renderClients(info) {
		const list = leases(info);
		const box = E('div', { 'class': 'widget-list' }, [
			...(list.length ? [] : [ E('div', { 'class': 'widget-empty' }, [ util.t('No clients', '暂无客户端') ]) ])
		]);

		list.slice(0, 5).forEach((lease) => {
			box.appendChild(E('div', { 'class': 'list-item' }, [
				E('span', { 'class': 'status-dot is-up' }),
				E('div', { 'class': 'list-text' }, [
					E('strong', {}, [ lease.hostname || lease.macaddr || '?' ]),
					E('small', {}, [ lease.ipaddr || '' ])
				])
			]));
		});

		this.refs.clientTotal = E('span', { 'class': 'widget-stat-value' }, [ String(list.length) ]);
		this.refs.clientList = box;

		return E('a', {
			'class': 'widget widget-clients',
			'href': L.url('admin', 'network', 'dhcp'),
			'data-app': 'network',
			'data-label': util.t('Clients', '客户端')
		}, [
			this.widgetHead('users', util.t('Clients', '客户端'), true),
			E('div', { 'class': 'widget-stat-row' }, [
				E('div', { 'class': 'widget-stat' }, [
					this.refs.clientTotal,
					E('span', { 'class': 'widget-stat-caption' }, [ util.t('DHCP Leases', 'DHCP 租约') ])
				])
			]),
			box
		]);
	},

	renderIcons(mode) {
		const grid = E('div', { 'class': 'desktop-icons' });

		util.apps(mode).forEach((child) => {
			if (child.name === 'desktop')
				return;

			grid.appendChild(E('a', {
				'class': 'desk-icon',
				'href': L.url('admin', child.name),
				'data-app': child.name,
				'data-label': util.title(child),
				'title': util.title(child)
			}, [
				util.appIcon(child.name, 'desk-icon-img', 64),
				E('span', { 'class': 'desk-icon-label' }, [ util.title(child) ])
			]));
		});

		return grid;
	},

	/* ------------------------------------------------------------------ */
	/* view                                                               */
	/* ------------------------------------------------------------------ */

	render(data) {
		/* the desktop view only makes sense while this theme is active */
		if (!/(^|\/)macos\/?$/.test(L.env.media || '')) {
			location.replace(L.url('admin', 'status', 'overview'));
			return E([]);
		}

		const tree = data[0],
		      board = data[1] || {},
		      info = data[2] || {},
		      version = data[3] || {},
		      unixtime = data[4] || 0,
		      leasesInfo = data[5] || {},
		      ctCount = data[6],
		      ctMax = data[7],
		      wan = data[8] || [],
		      wifi = data[9] || [ [], [] ],
		      builtinPorts = data[10] || [],
		      boardJson = data[11] || '{}',
		      devices = data[12] || [];

		this.refs = { conntrackCount: ctCount, conntrackMax: ctMax };

		const mode = util.modeNode(tree);
		const widgets = E('div', { 'class': 'desktop-widgets' });

		widgets.appendChild(this.renderClock(board, version));
		widgets.appendChild(this.renderSystem(board, info));
		widgets.appendChild(this.renderNetwork(wan, ctCount));

		const trafficWidget = this.renderTraffic(this.chooseTrafficDevice(wan, devices));
		if (trafficWidget)
			widgets.appendChild(trafficWidget);

		const wifiWidget = this.renderWireless(wifi[1]);
		if (wifiWidget)
			widgets.appendChild(wifiWidget);

		const portsWidget = this.renderPorts(this.buildPortList(builtinPorts, boardJson, devices, wan), devices);
		if (portsWidget)
			widgets.appendChild(portsWidget);

		widgets.appendChild(this.renderClients(leasesInfo));

		const desktop = E('div', { 'class': 'desktop' }, [
			widgets,
			this.renderIcons(mode)
		]);

		this.updateClock(unixtime);

		const slow = { ticks: 0 };

		poll.add(L.bind(function() {
			slow.ticks++;

			const heavy = (slow.ticks % 6) === 0;

			return network.flushCache().then(() => Promise.all([
				L.resolveDefault(callSystemInfo(), info),
				L.resolveDefault(fs.trimmed(CONNTRACK_COUNT), ctCount),
				L.resolveDefault(network.getWANNetworks(), wan),
				heavy ? L.resolveDefault(callDHCPLeases(), leasesInfo) : null,
				heavy ? this.loadWifi() : null,
				L.resolveDefault(network.getDevices(), devices)
			])).then((res) => {
				if (res[0])
					this.updateSystem(res[0]);

				if (res[2])
					this.updateNetwork(res[2], res[1]);

				if (res[3])
					this.updateClients(res[3]);

				if (res[4])
					this.updateWifi(res[4][1]);

				if (res[5])
					this.updatePorts(res[5]);
			});
		}, this), 5);

		/* live traffic chart, refreshed more often than the rest */
		if (this.refs.traffic) {
			poll.add(L.bind(this.pollTraffic, this), TRAFFIC_INTERVAL);
			this.pollTraffic();
		}

		window.setInterval(() => this.updateClock(unixtime), 1000);

		return desktop;
	},

	updateClock(unixtime) {
		if (!this.refs.clockTime)
			return;

		if (this.refs.skew == null)
			this.refs.skew = unixtime > 0 ? (unixtime * 1000 - Date.now()) : 0;

		const date = new Date(Date.now() + this.refs.skew);

		this.refs.clockTime.textContent = new Intl.DateTimeFormat(undefined, {
			hour: '2-digit', minute: '2-digit'
		}).format(date);

		this.refs.clockDate.textContent = new Intl.DateTimeFormat(undefined, {
			month: 'long', day: 'numeric', weekday: 'long'
		}).format(date);
	},

	updateSystem(info) {
		const mem = info.memory || {};
		const memUsed = (mem.total && mem.free) ? mem.total - mem.free : 0;
		const memPct = util.pct(memUsed, mem.total);

		if (this.refs.uptime)
			this.refs.uptime.textContent = info.uptime ? util.formatUptime(info.uptime) : '—';

		if (this.refs.load)
			this.refs.load.textContent = util.formatLoad(info.load);

		if (this.refs.memBar)
			this.refs.memBar.style.width = '%d%%'.format(memPct);

		if (this.refs.memText)
			this.refs.memText.textContent = '%d%% · %s'.format(memPct, util.formatBytes(mem.total));
	},

	updateNetwork(wanNetworks, conntrack) {
		const net = wanNetworks && wanNetworks[0];
		const connected = !!(net && net.getIPAddrs && net.getIPAddrs().length);

		if (this.refs.wanDot)
			this.refs.wanDot.className = 'status-dot' + (connected ? ' is-up' : ' is-down');

		if (this.refs.wanTitle)
			this.refs.wanTitle.textContent = connected ? net.getI18n() : util.t('Not connected', '未连接');

		if (this.refs.wanAddr)
			this.refs.wanAddr.textContent = connected ? net.getIPAddrs().join(', ') : '—';

		if (this.refs.wanGw)
			this.refs.wanGw.textContent = connected ? (net.getGatewayAddr() || '—') : '—';

		if (this.refs.wanDns)
			this.refs.wanDns.textContent = connected && net.getDNSAddrs ? (net.getDNSAddrs().join(', ') || '—') : '—';

		if (this.refs.wanUptime)
			this.refs.wanUptime.textContent = (connected && net.getUptime && net.getUptime() > 0)
				? '%t'.format(net.getUptime())
				: '—';

		if (conntrack && this.refs.conntrack)
			this.refs.conntrack.textContent = '%s / %s'.format(conntrack, this.refs.conntrackMax || '?');
	},

	updateClients(info) {
		const list = leases(info);

		if (this.refs.clientTotal)
			this.refs.clientTotal.textContent = String(list.length);

		if (this.refs.clientList) {
			const box = this.refs.clientList;

			dom.content(box, list.length ? null : E('div', { 'class': 'widget-empty' }, [ util.t('No clients', '暂无客户端') ]));

			list.slice(0, 5).forEach((lease) => {
				box.appendChild(E('div', { 'class': 'list-item' }, [
					E('span', { 'class': 'status-dot is-up' }),
					E('div', { 'class': 'list-text' }, [
						E('strong', {}, [ lease.hostname || lease.macaddr || '?' ]),
						E('small', {}, [ lease.ipaddr || '' ])
					])
				]));
			});
		}
	},

	updateWifi(nets) {
		const total = (nets || []).reduce((sum, net) => sum + (net.macos_assoc || []).length, 0);

		if (this.refs.wifiTotalEl && this.refs.wifiTotal !== total) {
			this.refs.wifiTotal = total;
			this.refs.wifiTotalEl.textContent = String(total);
		}

		if (this.refs.wifiList) {
			const fresh = this.wifiItems(nets);

			if (this.refs.wifiList.parentNode)
				this.refs.wifiList.parentNode.replaceChild(fresh, this.refs.wifiList);

			this.refs.wifiList = fresh;
		}
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
