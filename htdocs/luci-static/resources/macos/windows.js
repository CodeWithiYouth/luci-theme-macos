'use strict';
'require baseclass';
'require ui';
'require macos.util as util';

/*
 * Window manager for the macOS theme.
 *
 * The desktop page acts as the shell; every application is loaded into a
 * same-origin iframe which renders itself in "embed" mode (no menubar,
 * sidebar, dock or window frame). Windows can be dragged, resized, minimized,
 * maximized, closed and tiled side by side.
 */

const SESSION_KEY = 'macos.open';
const GEO_PREFIX = 'macos.geo2.';
const MAX_WINDOWS = 8;
const MIN_W = 360;
const MIN_H = 240;
const SNAP_GAP = 8;
const MOBILE_BREAKPOINT = 900;

function readJSON(key, fallback) {
	try {
		const v = JSON.parse(sessionStorage.getItem(key) || localStorage.getItem(key));

		return v == null ? fallback : v;
	}
	catch (e) {
		return fallback;
	}
}

function clamp(v, min, max) {
	return Math.max(min, Math.min(max, v));
}

function svgIcon(inner) {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('width', '13');
	svg.setAttribute('height', '13');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '1.8');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.innerHTML = inner;

	return svg;
}

return baseclass.extend({
	__init__() {
		this.shell = document.body.classList && document.body.classList.contains('is-desktop');
		this.enabled = this.shell && window.innerWidth > MOBILE_BREAKPOINT;
		this.windows = {};
		this.order = [];
		this.zIndex = 100;
		this.focused = null;
		this.onFocus = null;
		this.pendingFocus = null;
		this._previewSide = null;
		this._resizeTimer = null;

		if (!this.shell)
			return;

		this.initLayer();
		this.bindGlobals();

		if (this.enabled)
			this.restore();
	},

	/* ------------------------------------------------------------------ */
	/* helpers                                                            */
	/* ------------------------------------------------------------------ */

	layerBounds() {
		const r = this.layer.getBoundingClientRect();

		return { left: r.left, top: r.top, width: r.width, height: r.height };
	},

	/* geometry is kept relative to the windows layer, not to the viewport */
	layerSize() {
		return { left: 0, top: 0, width: this.layer.clientWidth, height: this.layer.clientHeight };
	},

	defaultGeo() {
		const b = this.layerSize();
		const n = this.order.length % 5;
		const width = Math.min(980, Math.max(MIN_W, b.width - 80));
		const height = Math.min(680, Math.max(MIN_H, b.height - 70));

		return {
			left: Math.max(16, Math.round((b.width - width) / 2)) + n * 26,
			top: 18 + n * 22,
			width: width,
			height: height
		};
	},

	currentGeo(win) {
		const r = win.el.getBoundingClientRect();
		const l = this.layer.getBoundingClientRect();

		return { left: r.left - l.left, top: r.top - l.top, width: r.width, height: r.height };
	},

	applyGeometry(win, geo) {
		const el = win.el;

		geo = {
			left: Math.round(geo.left),
			top: Math.round(geo.top),
			width: Math.round(geo.width),
			height: Math.round(geo.height)
		};

		el.style.left = geo.left + 'px';
		el.style.top = geo.top + 'px';
		el.style.width = geo.width + 'px';
		el.style.height = geo.height + 'px';
		el.classList.remove('is-maximized');

		win.geo = geo;
	},

	fitGeo(geo) {
		const b = this.layerSize();

		return {
			left: clamp(geo.left, -120, Math.max(-120, b.width - 140)),
			top: clamp(geo.top, 0, Math.max(0, b.height - 60)),
			width: clamp(geo.width, MIN_W, Math.max(MIN_W, b.width)),
			height: clamp(geo.height, MIN_H, Math.max(MIN_H, b.height))
		};
	},

	snapGeo(side) {
		const b = this.layerSize();
		const g = SNAP_GAP;
		const half = Math.floor((b.width - g * 3) / 2);

		if (side === 'max')
			return { left: 0, top: 0, width: Math.round(b.width), height: Math.round(b.height) };

		if (side === 'left')
			return { left: g, top: g, width: half, height: Math.round(b.height - g * 2) };

		return {
			left: g + half + g,
			top: g,
			width: half,
			height: Math.round(b.height - g * 2)
		};
	},

	pathOfUrl(url) {
		const base = (L.env.cgi_base || '').replace(/\/$/, '');
		let p = String(url || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0].split('#')[0];

		if (base && p.indexOf(base) === 0)
			p = p.slice(base.length);

		return p || '';
	},

	currentUrl(win) {
		try {
			return win.iframe.contentWindow.location.href;
		}
		catch (e) {
			return win.url;
		}
	},

	readGeo(app) {
		let geo = null;

		try { geo = JSON.parse(localStorage.getItem(GEO_PREFIX + app) || 'null'); }
		catch (e) { geo = null; }

		if (!geo || typeof(geo.left) !== 'number' || typeof(geo.width) !== 'number')
			return null;

		return this.fitGeo(geo);
	},

	saveGeo(win) {
		try {
			const geo = (win.el.classList.contains('is-maximized') && win._normal)
				? win._normal
				: this.currentGeo(win);

			localStorage.setItem(GEO_PREFIX + win.app, JSON.stringify(geo));
		}
		catch (e) {}
	},

	saveSession() {
		try {
			sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.order.map((app) => {
				const win = this.windows[app];

				return { app: win.app, url: win.url, label: win.label };
			})));
		}
		catch (e) {}
	},

	/* ------------------------------------------------------------------ */
	/* setup                                                              */
	/* ------------------------------------------------------------------ */

	initLayer() {
		this.layer = E('div', { 'class': 'windows-layer', 'id': 'windows-layer' });
		this.preview = E('div', { 'class': 'snap-preview', 'id': 'snap-preview' });

		document.body.appendChild(this.layer);
		document.body.appendChild(this.preview);
	},

	bindGlobals() {
		document.addEventListener('click', (ev) => {
			if (!this.enabled || ev.defaultPrevented)
				return;

			if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey)
				return;

			const a = ev.target.closest ? ev.target.closest('a[data-app]') : null;

			if (!a)
				return;

			const href = a.getAttribute('href');

			if (!href || href.charAt(0) === '#')
				return;

			ev.preventDefault();

			const app = a.getAttribute('data-app');

			if (app === 'desktop') {
				this.showDesktop();
				return;
			}

			this.openOrFocus(app, href, a.getAttribute('data-label') || a.textContent.trim());
		});

		window.addEventListener('resize', () => {
			clearTimeout(this._resizeTimer);

			this._resizeTimer = window.setTimeout(() => {
				const enabled = window.innerWidth > MOBILE_BREAKPOINT;

				if (enabled === this.enabled) {
					if (enabled)
						Object.values(this.windows).forEach((win) => this.applyGeometry(win, this.fitGeo(this.currentGeo(win))));

					return;
				}

				this.enabled = enabled;

				if (!enabled)
					this.closeAll(true);
			}, 150);
		});

		if (window.MutationObserver) {
			new MutationObserver(() => this.applyDarkAll()).observe(document.documentElement, {
				attributes: true,
				attributeFilter: [ 'data-darkmode' ]
			});
		}
	},

	restore() {
		const hash = decodeURIComponent(location.hash || '');

		if (hash.indexOf('#/admin/') === 0) {
			const path = hash.slice(1);
			const app = path.split('/')[1];
			const base = (L.env.cgi_base || '').replace(/\/$/, '');

			this.open(app, base + '/' + path.replace(/^\//, ''), null);
			return;
		}

		const list = readJSON(SESSION_KEY, []);

		if (Array.isArray(list)) {
			list.slice(-MAX_WINDOWS).forEach((item) => {
				if (item && item.app && item.url)
					this.open(item.app, item.url, item.label);
			});

			this.saveSession();
		}
	},

	/* ------------------------------------------------------------------ */
	/* window creation                                                    */
	/* ------------------------------------------------------------------ */

	openOrFocus(app, url, label) {
		const win = this.windows[app];

		if (!win)
			return this.open(app, url, label);

		if (win.el.classList.contains('is-minimized')) {
			this.restoreWindow(win);
			return win;
		}

		if (url && win.path !== this.pathOfUrl(url)) {
			win.url = url;
			win.path = this.pathOfUrl(url);
			win.iframe.src = url;
			this.saveSession();
		}

		this.focusWindow(win);

		return win;
	},

	open(app, url, label) {
		if (!this.enabled || !url)
			return null;

		if (this.windows[app])
			return this.openOrFocus(app, url, label);

		if (this.order.length >= MAX_WINDOWS)
			this.close(this.order[0]);

		const win = {
			app: app,
			url: url,
			path: this.pathOfUrl(url),
			label: label || app,
			geo: this.readGeo(app) || this.defaultGeo()
		};

		this.buildWindow(win);

		this.layer.appendChild(win.el);

		this.windows[app] = win;
		this.order.push(app);

		this.applyGeometry(win, this.fitGeo(win.geo));
		this.bindWindow(win);
		this.refreshDock();
		this.saveSession();
		this.focusWindow(win);
		this.maybeSplitNewWindow(win);

		return win;
	},

	buildWindow(win) {
		const closeBtn = E('button', { 'class': 'tl tl-close', 'type': 'button', 'title': util.t('Close', '关闭') }, [ E('span', {}, [ '×' ]) ]);
		const minBtn = E('button', { 'class': 'tl tl-min', 'type': 'button', 'title': util.t('Minimize', '最小化') }, [ E('span', {}, [ '−' ]) ]);
		const maxBtn = E('button', { 'class': 'tl tl-max', 'type': 'button', 'title': util.t('Maximize', '最大化') }, [ E('span', {}, [ '+' ]) ]);

		closeBtn.addEventListener('click', () => this.close(win.app));
		minBtn.addEventListener('click', () => this.minimize(win));
		maxBtn.addEventListener('click', () => this.toggleMaximize(win));

		win.titleEl = E('span', { 'class': 'app-title' }, [ win.label ]);

		const splitL = E('button', {
			'class': 'win-btn', 'type': 'button', 'title': util.t('Tile Left', '左半屏')
		}, [ svgIcon('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v15"/><path d="M3.5 4.5H12v15H3.5z" fill="currentColor" fill-opacity=".22" stroke="none"/>') ]);

		const splitR = E('button', {
			'class': 'win-btn', 'type': 'button', 'title': util.t('Tile Right', '右半屏')
		}, [ svgIcon('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v15"/><path d="M12 4.5h8.5v15H12z" fill="currentColor" fill-opacity=".22" stroke="none"/>') ]);

		splitL.addEventListener('click', (ev) => { ev.stopPropagation(); this.split(win, 'left'); });
		splitR.addEventListener('click', (ev) => { ev.stopPropagation(); this.split(win, 'right'); });

		const titlebar = E('header', { 'class': 'app-titlebar' }, [
			E('div', { 'class': 'traffic-lights' }, [ closeBtn, minBtn, maxBtn ]),
			win.titleEl,
			E('div', { 'class': 'win-actions' }, [ splitL, splitR ])
		]);

		win.iframe = E('iframe', {
			'class': 'app-frame',
			'src': win.url,
			'title': win.label,
			'loading': 'eager'
		});

		win.iframe.addEventListener('load', () => this.onFrameLoad(win));

		const handles = [ 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw' ].map((dir) =>
			E('div', { 'class': 'win-resize ' + dir, 'data-dir': dir }));

		win.el = E('div', {
			'class': 'app-window',
			'data-app': win.app,
			'role': 'dialog',
			'aria-label': win.label,
			'tabindex': '-1'
		}, [ titlebar, win.iframe ].concat(handles));

		titlebar.addEventListener('pointerdown', (ev) => this.beginDrag(win, ev));
		titlebar.addEventListener('dblclick', (ev) => {
			if (!ev.target.closest('button'))
				this.toggleMaximize(win);
		});

		handles.forEach((handle) => {
			handle.addEventListener('pointerdown', (ev) => this.beginResize(win, handle.getAttribute('data-dir'), ev));
		});

		win.el.addEventListener('pointerdown', () => this.focusWindow(win), true);
	},

	bindWindow(win) {
		win.el.style.zIndex = ++this.zIndex;
	},

	/* ------------------------------------------------------------------ */
	/* focus / state                                                      */
	/* ------------------------------------------------------------------ */

	focusWindow(win, updateHash) {
		if (!win || !win.el)
			return;

		win.el.style.zIndex = ++this.zIndex;
		win.el.classList.remove('is-minimized');
		win._focusStamp = Date.now();

		if (this.focused && this.focused !== win)
			this.focused.el.classList.remove('is-focused');

		this.focused = win;
		win.el.classList.add('is-focused');

		this.order = this.order.filter((app) => app !== win.app);
		this.order.push(win.app);

		this.refreshDock();

		if (updateHash !== false)
			this.updateHash(win);

		this.emitFocus(win.app);
	},

	showDesktop() {
		if (this.focused)
			this.focused.el.classList.remove('is-focused');

		this.focused = null;
		this.refreshDock();
		this.updateHash(null);
		this.emitFocus('desktop');
	},

	emitFocus(app) {
		if (typeof(this.onFocus) === 'function')
			this.onFocus(app);
		else
			this.pendingFocus = app;
	},

	setFocusHandler(fn) {
		this.onFocus = fn;

		if (this.pendingFocus) {
			fn(this.pendingFocus);
			this.pendingFocus = null;
		}
		else if (this.focused) {
			fn(this.focused.app);
		}
	},

	refreshDock() {
		document.querySelectorAll('#dock-apps .dock-item[data-app]').forEach((el) => {
			const app = el.getAttribute('data-app');
			const win = this.windows[app];

			el.classList.toggle('has-window', !!win);
			el.classList.toggle('is-active', !!win && this.focused === win && !win.el.classList.contains('is-minimized'));
		});

		if (!this.focused) {
			const desktop = document.querySelector('#dock-apps .dock-item[data-app="desktop"]');

			if (desktop)
				desktop.classList.add('is-active');
		}
	},

	updateHash(win) {
		let target;

		if (!win) {
			target = location.pathname + location.search;
		}
		else {
			const path = this.pathOfUrl(this.currentUrl(win));
			target = path ? '#' + path : (location.pathname + location.search);
		}

		try { history.replaceState(null, '', target); }
		catch (e) {}
	},

	topVisible() {
		return Object.values(this.windows)
			.filter((win) => !win.el.classList.contains('is-minimized'))
			.sort((a, b) => (b._focusStamp || 0) - (a._focusStamp || 0))[0] || null;
	},

	others(win) {
		return Object.values(this.windows)
			.filter((w) => w !== win && !w.el.classList.contains('is-minimized'))
			.sort((a, b) => (b._focusStamp || 0) - (a._focusStamp || 0));
	},

	/* ------------------------------------------------------------------ */
	/* actions                                                            */
	/* ------------------------------------------------------------------ */

	minimize(win) {
		win.el.classList.add('is-minimized');
		win.el.classList.remove('is-focused');

		this.pausePoll(win, true);

		if (this.focused === win) {
			this.focused = null;

			const next = this.topVisible();

			if (next)
				this.focusWindow(next);
			else
				this.showDesktop();
		}

		this.refreshDock();
	},

	restoreWindow(win) {
		win.el.classList.remove('is-minimized');
		this.pausePoll(win, false);
		this.focusWindow(win);
	},

	toggleMaximize(win) {
		if (win.el.classList.contains('is-maximized')) {
			this.applyGeometry(win, this.fitGeo(win._normal || this.defaultGeo()));
			win._splitSide = null;
			this.focusWindow(win);
			return;
		}

		win._normal = this.currentGeo(win);
		this.applyGeometry(win, this.snapGeo('max'));
		win.el.classList.add('is-maximized');
		win._splitSide = null;
		this.focusWindow(win);
	},

	snap(win, side) {
		if (!win)
			return;

		if (side === 'max') {
			if (!win.el.classList.contains('is-maximized'))
				win._normal = this.currentGeo(win);

			this.applyGeometry(win, this.snapGeo('max'));
			win.el.classList.add('is-maximized');
			win._splitSide = null;
			return;
		}

		const prev = this.currentGeo(win);

		if (!win._normal && !win.el.classList.contains('is-maximized'))
			win._normal = prev;

		this.applyGeometry(win, this.snapGeo(side));
		win._splitSide = side;
	},

	split(win, side) {
		if (!win)
			return;

		const other = this.others(win)[0];

		this.snap(win, side);

		if (other)
			this.snap(other, side === 'left' ? 'right' : 'left');

		this.focusWindow(win);
	},

	maybeSplitNewWindow(win) {
		const anchor = this.others(win).find((w) => w._splitSide);

		if (anchor)
			this.snap(win, anchor._splitSide === 'left' ? 'right' : 'left');
	},

	close(app) {
		const win = this.windows[app];

		if (!win)
			return;

		this.saveGeo(win);

		if (this.focused === win)
			this.focused = null;

		try { win.iframe.src = 'about:blank'; }
		catch (e) {}

		win.el.remove();

		delete this.windows[app];
		this.order = this.order.filter((a) => a !== app);

		this.refreshDock();
		this.saveSession();

		const next = this.topVisible();

		if (next)
			this.focusWindow(next);
		else
			this.showDesktop();
	},

	closeAll(keepSession) {
		Object.keys(this.windows).forEach((app) => {
			const win = this.windows[app];

			this.saveGeo(win);

			try { win.iframe.src = 'about:blank'; }
			catch (e) {}

			win.el.remove();
			delete this.windows[app];
		});

		this.order = [];
		this.focused = null;
		this.refreshDock();

		if (!keepSession)
			this.saveSession();

		this.showDesktop();
	},

	reloadAll() {
		Object.values(this.windows).forEach((win) => {
			try { win.iframe.contentWindow.location.reload(); }
			catch (e) {}
		});
	},

	/* ------------------------------------------------------------------ */
	/* drag & resize                                                      */
	/* ------------------------------------------------------------------ */

	/* one pointer session: captures the pointer (so an iframe under the
	 * cursor cannot swallow move/up events) and disables frame pointer
	 * events while dragging */
	startGesture(win, ev, onMove, onEnd) {
		const target = ev.currentTarget || ev.target;
		const id = ev.pointerId;

		try { target.setPointerCapture(id); } catch (e) {}

		document.body.classList.add('win-gesture');
		win.el.classList.add('is-gesture');

		const cleanup = () => {
			document.removeEventListener('pointermove', move);
			document.removeEventListener('pointerup', end);
			document.removeEventListener('pointercancel', cancel);
			window.removeEventListener('blur', cancel);

			try { target.releasePointerCapture(id); } catch (e) {}

			document.body.classList.remove('win-gesture');
			win.el.classList.remove('is-gesture');
			document.body.style.cursor = '';
		};

		const move = (e) => {
			if (e.pointerId === id)
				onMove(e);
		};

		const end = (e) => {
			if (e.pointerId !== id)
				return;

			cleanup();
			onEnd(e);
		};

		const cancel = () => {
			cleanup();
			onEnd(null);
		};

		document.addEventListener('pointermove', move);
		document.addEventListener('pointerup', end);
		document.addEventListener('pointercancel', cancel);
		window.addEventListener('blur', cancel);
	},

	beginDrag(win, ev) {
		if (ev.button !== 0 || ev.target.closest('button'))
			return;

		ev.preventDefault();

		const layerRect = this.layer.getBoundingClientRect();
		let start = { x: ev.clientX, y: ev.clientY, geo: this.currentGeo(win) };

		if (win.el.classList.contains('is-maximized')) {
			const normal = win._normal || this.defaultGeo();

			win.el.classList.remove('is-maximized');

			const px = ev.clientX - layerRect.left;
			const ratio = px / Math.max(1, layerRect.width);
			const geo = {
				left: px - normal.width * ratio,
				top: (ev.clientY - layerRect.top) - 18,
				width: normal.width,
				height: normal.height
			};

			this.applyGeometry(win, this.fitGeo(geo));
			start = { x: ev.clientX, y: ev.clientY, geo: this.currentGeo(win) };
			win._splitSide = null;
		}

		win.el.classList.add('is-dragging');
		this.focusWindow(win);

		document.body.style.cursor = 'default';

		this.startGesture(win, ev, (e) => {
			const size = this.layerSize();
			const left = start.geo.left + (e.clientX - start.x);
			const top = start.geo.top + (e.clientY - start.y);

			win.el.style.left = clamp(left, -start.geo.width + 140, size.width - 140) + 'px';
			win.el.style.top = clamp(top, 0, size.height - 40) + 'px';

			this.previewSnap(e);
		}, () => {
			win.el.classList.remove('is-dragging');
			win._splitSide = null;

			if (this._previewSide)
				this.snap(win, this._previewSide);

			this.hidePreview();

			const geo = this.currentGeo(win);

			win._normal = geo;
			win.geo = geo;
			this.saveGeo(win);
		});
	},

	beginResize(win, dir, ev) {
		if (ev.button !== 0)
			return;

		ev.preventDefault();
		ev.stopPropagation();

		this.focusWindow(win);

		const start = { x: ev.clientX, y: ev.clientY, geo: this.currentGeo(win) };
		const size = this.layerSize();
		const cursor = getComputedStyle(ev.currentTarget).cursor;

		win.el.classList.add('is-resizing');
		win._splitSide = null;

		if (cursor && cursor !== 'auto')
			document.body.style.cursor = cursor;

		this.startGesture(win, ev, (e) => {
			const dx = e.clientX - start.x;
			const dy = e.clientY - start.y;
			let { left, top, width, height } = start.geo;

			if (dir.indexOf('e') !== -1)
				width = clamp(start.geo.width + dx, MIN_W, size.width - left);

			if (dir.indexOf('s') !== -1)
				height = clamp(start.geo.height + dy, MIN_H, size.height - top);

			if (dir.indexOf('w') !== -1) {
				width = clamp(start.geo.width - dx, MIN_W, start.geo.left + start.geo.width);
				left = start.geo.left + start.geo.width - width;
			}

			if (dir.indexOf('n') !== -1) {
				height = clamp(start.geo.height - dy, MIN_H, start.geo.top + start.geo.height);
				top = start.geo.top + start.geo.height - height;
			}

			this.applyGeometry(win, { left, top, width, height });
		}, () => {
			win.el.classList.remove('is-resizing');

			const geo = this.currentGeo(win);

			win._normal = geo;
			this.saveGeo(win);
		});
	},

	previewSnap(ev) {
		const b = this.layerBounds();
		let side = null;

		if (ev.clientY <= b.top + 10)
			side = 'max';
		else if (ev.clientX <= b.left + 18)
			side = 'left';
		else if (ev.clientX >= b.left + b.width - 18)
			side = 'right';

		this._previewSide = side;

		if (!side) {
			this.hidePreview();
			return;
		}

		const geo = this.snapGeo(side);

		Object.assign(this.preview.style, {
			display: 'block',
			left: geo.left + 'px',
			top: geo.top + 'px',
			width: geo.width + 'px',
			height: geo.height + 'px'
		});
	},

	hidePreview() {
		this._previewSide = null;
		this.preview.style.display = 'none';
	},

	/* ------------------------------------------------------------------ */
	/* iframe integration                                                 */
	/* ------------------------------------------------------------------ */

	onFrameLoad(win) {
		let doc = null;
		let cw = null;

		try {
			doc = win.iframe.contentDocument;
			cw = win.iframe.contentWindow;
		}
		catch (e) {
			return;
		}

		if (!doc || !cw)
			return;

		if (doc.querySelector('.auth-card')) {
			location.href = cw.location.href;
			return;
		}

		try {
			const title = String(doc.title || '').split('|').pop().trim();

			if (title) {
				win.label = title;
				win.titleEl.textContent = title;
			}

			cw.addEventListener('focus', () => this.focusWindow(win));
		}
		catch (e) {}

		/* remember in-page navigation (tabs, forms) so the session restores it */
		try {
			const cur = this.currentUrl(win);

			if (cur && cur.indexOf('about:') !== 0) {
				win.url = cur;
				win.path = this.pathOfUrl(cur);
			}
		}
		catch (e) {}

		this.applyDark(win);

		if (this.focused === win)
			this.updateHash(win);

		this.saveSession();
	},

	applyDark(win) {
		try {
			const root = win.iframe.contentDocument.documentElement;

			if (root)
				root.setAttribute('data-darkmode', document.documentElement.getAttribute('data-darkmode') || 'false');
		}
		catch (e) {}
	},

	applyDarkAll() {
		Object.values(this.windows).forEach((win) => this.applyDark(win));
	},

	pausePoll(win, stop) {
		try {
			const Lw = win.iframe.contentWindow.L;

			if (Lw && Lw.Poll)
				stop ? Lw.Poll.stop() : Lw.Poll.start();
		}
		catch (e) {}
	}
});
