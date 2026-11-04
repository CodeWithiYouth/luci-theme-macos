'use strict';
'require baseclass';
'require ui';
'require macos.util as util';
'require macos.windows as wm';

/*
 * Desktop chrome for the macOS theme: menubar, sidebar, dock and page tabs.
 */

const dispatchpath = L.env.dispatchpath || [];

return baseclass.extend({
	__init__() {
		this.modeName = (L.env.requestpath && L.env.requestpath[0]) || dispatchpath[0] || 'admin';
		this.app = dispatchpath[1] || 'desktop';
		this.sub = dispatchpath[2] || null;
		this.tree = null;
		this.embed = document.documentElement.getAttribute('data-embed') === '1';
		this.shell = !this.embed && document.body.classList.contains('is-desktop');
		this.activeApp = 'desktop';

		if (this.embed) {
			this.initEmbed();
			return;
		}

		this.initChrome();
		this.initClock();
		this.initDarkMode();
		this.initAlerts();

		if (this.shell) {
			this.app = 'desktop';
			wm.setFocusHandler((app) => this.setActiveApp(app));
		}

		ui.menu.load()
			.then((tree) => this.render(tree))
			.catch((err) => console.error('macos: unable to load menu', err));
	},

	/* ------------------------------------------------------------------ */
	/* helpers                                                            */
	/* ------------------------------------------------------------------ */

	urlFor(...parts) {
		return L.url(this.modeName, ...parts.map(String));
	},

	modeNode(tree) {
		return (tree && tree.children && tree.children[this.modeName])
			|| (tree && tree.children && tree.children.admin)
			|| tree;
	},

	currentTitle(appNode) {
		if (this.app === 'desktop')
			return util.t('Desktop', '桌面');

		return util.appTitle(appNode, this.app);
	},

	/* used by embedded pages: move the change indicators into the toolbar and
	 * render the application pages plus the page tabs */
	initEmbed() {
		const indicators = document.getElementById('indicators');
		const slot = document.getElementById('embed-indicators');
		const toolbar = document.getElementById('window-toolbar');

		if (indicators && slot)
			slot.appendChild(indicators);

		if (indicators && toolbar && window.MutationObserver) {
			const sync = () => toolbar.classList.toggle('has-indicators', indicators.children.length > 0);

			new MutationObserver(sync).observe(indicators, { childList: true });
			sync();
		}

		ui.menu.load()
			.then((tree) => {
				const mode = this.modeNode(tree);
				const container = document.getElementById('tabmenu');

				if (container)
					this.renderAppTabs(mode, container);

				this.renderTabs(mode);
			})
			.catch(() => {});
	},

	/* ------------------------------------------------------------------ */
	/* rendering                                                          */
	/* ------------------------------------------------------------------ */

	render(tree) {
		this.tree = tree;

		const mode = this.modeNode(tree);

		this.renderMenubar(mode);
		this.renderSidebar(mode);
		this.renderDock(mode);
		this.renderTabs(mode);
		this.initWifi();

		if (this.shell) {
			wm.refreshDock();
			this.setActiveApp(wm.focused ? wm.focused.app : 'desktop');
		}
	},

	menuNode(label, items, bold) {
		const li = E('li', { 'class': 'menubar-menu' + (bold ? ' is-app' : '') });
		const dropdown = E('ul', { 'class': 'menubar-dropdown' });

		for (let i = 0; i < items.length; i++) {
			const item = items[i];

			if (item === null) {
				dropdown.appendChild(E('li', { 'class': 'dropdown-sep' }));
				continue;
			}

			let elem;

			if (item.action) {
				elem = E('button', {
					'type': 'button',
					'class': 'dropdown-item' + (item.active ? ' active' : ''),
					'click': item.action
				}, [ item.title ]);
			}
			else {
				const attrs = {
					'href': item.href,
					'class': 'dropdown-item' + (item.active ? ' active' : '')
				};

				if (item.app) {
					attrs['data-app'] = item.app;
					attrs['data-label'] = item.title;
				}

				elem = E('a', attrs, [ item.title ]);
			}

			dropdown.appendChild(E('li', {}, [ elem ]));
		}

		li.appendChild(E('button', { 'type': 'button', 'class': 'menubar-item' }, [ label ]));
		li.appendChild(dropdown);

		return li;
	},

	renderMenubar(mode) {
		const container = document.querySelector('#menubar-items');

		if (!container)
			return;

		const appNode = (mode.children || {})[this.app] || null;
		const appTitle = this.currentTitle(appNode);

		/* application menu */
		const appItems = [ { title: util.t('Desktop', '桌面'), href: this.urlFor('desktop'), app: 'desktop' } ];

		util.menuChildren(appNode).forEach((child) => {
			appItems.push({
				title: util.title(child),
				href: this.urlFor(this.app, child.name),
				app: this.app,
				active: this.sub === child.name
			});
		});

		container.appendChild(this.menuNode(appTitle, appItems, true));

		/* "go" menu - all top level applications */
		container.appendChild(this.menuNode(util.t('Go', '前往'), util.apps(mode).map((child) => ({
			title: util.title(child),
			href: this.urlFor(child.name),
			app: child.name,
			active: this.app === child.name
		}))));

		/* "view" menu - window controls */
		const viewItems = [
			{ title: util.t('Reload Page', '刷新页面'), action: () => location.reload() }
		];

		if (this.shell) {
			viewItems.push(
				{ title: util.t('Tile Left', '左半屏'), action: () => wm.focused && wm.split(wm.focused, 'left') },
				{ title: util.t('Tile Right', '右半屏'), action: () => wm.focused && wm.split(wm.focused, 'right') },
				{ title: util.t('Reload Windows', '刷新所有窗口'), action: () => wm.reloadAll() }
			);
		}
		else {
			viewItems.push(
				{ title: util.t('Toggle Sidebar', '显示/隐藏边栏'), action: () => this.toggleSidebar() },
				{ title: util.t('Full Screen', '全屏'), action: () => this.toggleFullscreen() }
			);
		}

		viewItems.push(null, { title: util.t('Light & Dark', '浅色/深色'), action: () => this.toggleDarkmode() });

		container.appendChild(this.menuNode(util.t('View', '显示'), viewItems));
	},

	setActiveApp(app) {
		this.activeApp = app || 'desktop';

		if (!this.tree || this.embed)
			return;

		const mode = this.modeNode(this.tree);
		const container = document.querySelector('#menubar-items');
		const appNode = (mode.children || {})[this.activeApp] || null;
		const isDesktop = this.activeApp === 'desktop';
		const title = isDesktop ? util.t('Desktop', '桌面') : util.appTitle(appNode, this.activeApp);
		const items = [ { title: util.t('Desktop', '桌面'), href: this.urlFor('desktop'), app: 'desktop', active: isDesktop } ];

		util.menuChildren(appNode).forEach((child) => {
			items.push({
				title: util.title(child),
				href: this.urlFor(this.activeApp, child.name),
				app: this.activeApp,
				active: false
			});
		});

		const menu = this.menuNode(title, items, true);
		const old = container ? container.querySelector('.menubar-menu.is-app') : null;

		if (old)
			old.parentNode.replaceChild(menu, old);
		else if (container)
			container.insertBefore(menu, container.firstChild);
	},

	sidebarItem(icon, label, active, href) {
		return E('a', {
			'class': 'sidebar-item' + (active ? ' active' : ''),
			'href': href
		}, [
			util.appIcon(icon, 'sidebar-appicon', 18),
			E('span', { 'class': 'sidebar-label' }, [ label ])
		]);
	},

	renderSidebar(mode) {
		const nav = document.querySelector('#sidebar-nav');

		if (!nav)
			return;

		const appNode = (mode.children || {})[this.app] || null;
		const appTitle = this.currentTitle(appNode);

		const icon = document.querySelector('#sidebar-icon');
		if (icon)
			icon.src = util.iconUrl(this.app);

		const title = document.querySelector('#sidebar-title');
		if (title)
			title.textContent = appTitle;

		/* pages of the current application first (Finder like) */
		const children = util.menuChildren(appNode);

		if (children.length) {
			const pages = E('div', { 'class': 'sidebar-group' }, [
				E('div', { 'class': 'sidebar-group-title' }, [ util.t('Pages', '页面') ])
			]);

			children.forEach((child) => {
				pages.appendChild(this.sidebarItem(child.name, util.title(child),
					this.sub === child.name, this.urlFor(appNode.name, child.name)));
			});

			nav.appendChild(pages);
		}

		/* all top level applications */
		const apps = E('div', { 'class': 'sidebar-group' }, [
			E('div', { 'class': 'sidebar-group-title' }, [ util.t('Applications', '应用') ])
		]);

		util.apps(mode).forEach((child) => {
			if (child.name === this.app)
				return;

			apps.appendChild(this.sidebarItem(child.name, util.title(child),
				this.app === child.name, this.urlFor(child.name)));
		});

		if (apps.lastElementChild)
			nav.appendChild(apps);
	},

	dockAction(icon, label, href) {
		return E('a', {
			'class': 'dock-item dock-action',
			'href': href,
			'data-label': label
		}, [
			util.appIcon(icon, 'dock-icon', 48),
			E('span', { 'class': 'dock-dot' })
		]);
	},

	renderDock(mode) {
		const dock = document.querySelector('#dock-apps');

		if (!dock)
			return;

		util.apps(mode).forEach((child) => {
			dock.appendChild(E('a', {
				'class': 'dock-item' + (!this.shell && this.app === child.name ? ' is-active' : ''),
				'href': this.urlFor(child.name),
				'data-app': child.name,
				'data-label': util.title(child)
			}, [
				util.appIcon(child.name, 'dock-icon', 48),
				E('span', { 'class': 'dock-dot' })
			]));
		});

		dock.appendChild(E('div', { 'class': 'dock-separator' }));

		const systemNode = (mode.children || {}).system;

		if (systemNode && systemNode.children && systemNode.children.reboot)
			dock.appendChild(this.dockAction('reboot', util.t('Reboot', '重启'), this.urlFor('system', 'reboot')));

		dock.appendChild(this.dockAction('logout', util.t('Log out', '退出登录'), this.urlFor('logout')));
	},

	/* application pages (the entries shown in the sidebar in normal mode) */
	renderAppTabs(mode, container) {
		const appNode = (mode.children || {})[this.app];
		const children = util.menuChildren(appNode);

		if (children.length < 2)
			return;

		const ul = E('ul', { 'class': 'tabs tabs-app' });

		children.forEach((child) => {
			const title = util.title(child);

			ul.appendChild(E('li', { 'class': 'tab' + (this.sub === child.name ? ' active' : '') }, [
				E('a', {
					'href': L.url(this.modeName, this.app, child.name),
					'title': title
				}, [ title ])
			]));
		});

		container.appendChild(ul);
		container.style.display = '';

		const toolbar = document.querySelector('#window-toolbar');
		if (toolbar)
			toolbar.classList.add('has-tabs');
	},

	renderTabLevel(node, parts, level, container) {
		const ul = E('ul', { 'class': 'tabs' + (level ? ' tabs-sub' : '') });
		const children = util.menuChildren(node);
		let active = null;

		children.forEach((child) => {
			const isActive = dispatchpath[3 + level] === child.name;

			ul.appendChild(E('li', { 'class': 'tab' + (isActive ? ' active' : '') }, [
				E('a', { 'href': L.url(...parts, child.name) }, [ util.title(child) ])
			]));

			if (isActive)
				active = child;
		});

		if (!ul.children.length)
			return;

		container.appendChild(ul);
		container.style.display = '';

		const toolbar = document.querySelector('#window-toolbar');
		if (toolbar)
			toolbar.classList.add('has-tabs');

		if (active)
			this.renderTabLevel(active, parts.concat(active.name), level + 1, container);
	},

	renderTabs(mode) {
		const container = document.querySelector('#tabmenu');

		if (!container || dispatchpath.length < 3)
			return;

		let node = mode;

		for (let i = 1; i < 3 && node; i++)
			node = (node.children || {})[dispatchpath[i]];

		if (node)
			this.renderTabLevel(node, [ this.modeName, dispatchpath[1], dispatchpath[2] ], 0, container);
	},

	/* ------------------------------------------------------------------ */
	/* behaviour                                                          */
	/* ------------------------------------------------------------------ */

	toggleSidebar() {
		if (window.innerWidth <= 820) {
			document.body.classList.toggle('sidebar-open');
			return;
		}

		const hidden = document.body.classList.toggle('sidebar-hidden');

		try { localStorage.setItem('macos-sidebar', hidden ? 'hidden' : 'shown'); } catch (e) {}
	},

	toggleFullscreen() {
		const full = document.body.classList.toggle('is-fullscreen');

		try { localStorage.setItem('macos-fullscreen', full ? '1' : '0'); } catch (e) {}
	},

	toggleDarkmode() {
		const root = document.documentElement;
		const dark = root.getAttribute('data-darkmode') !== 'true';

		root.setAttribute('data-darkmode', dark ? 'true' : 'false');

		try { localStorage.setItem('macos-darkmode', dark ? '1' : '0'); } catch (e) {}
	},

	initChrome() {
		const close = document.querySelector('#tl-close');
		const min = document.querySelector('#tl-min');
		const max = document.querySelector('#tl-max');
		const reload = document.querySelector('#titlebar-reload');
		const titlebar = document.querySelector('#titlebar');
		const sidebarButton = document.querySelector('#menubar-sidebar');
		const scrim = document.querySelector('#sidebar-scrim');

		if (close)
			close.addEventListener('click', () => { location.href = this.urlFor('desktop'); });

		if (min)
			min.addEventListener('click', () => this.toggleSidebar());

		if (max)
			max.addEventListener('click', () => this.toggleFullscreen());

		if (sidebarButton)
			sidebarButton.addEventListener('click', () => this.toggleSidebar());

		if (reload)
			reload.addEventListener('click', () => location.reload());

		if (scrim)
			scrim.addEventListener('click', () => document.body.classList.remove('sidebar-open'));

		document.addEventListener('keydown', (ev) => {
			if (ev.key === 'Escape')
				document.body.classList.remove('sidebar-open');
		});

		if (titlebar)
			titlebar.addEventListener('dblclick', (ev) => {
				if (ev.target.closest('.traffic-lights, .titlebar-actions'))
					return;

				this.toggleFullscreen();
			});

		try {
			if (localStorage.getItem('macos-sidebar') === 'hidden' && window.innerWidth > 820)
				document.body.classList.add('sidebar-hidden');

			if (localStorage.getItem('macos-fullscreen') === '1')
				document.body.classList.add('is-fullscreen');
		}
		catch (e) {}
	},

	initClock() {
		const clock = document.querySelector('#menubar-clock');

		if (!clock)
			return;

		const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
		const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
		const fullFmt = new Intl.DateTimeFormat(undefined, {
			weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
			hour: '2-digit', minute: '2-digit', second: '2-digit'
		});

		const tick = () => {
			const now = new Date();

			clock.textContent = (window.innerWidth >= 900)
				? '%s %s'.format(dayFmt.format(now), timeFmt.format(now))
				: timeFmt.format(now);
			clock.title = fullFmt.format(now);
		};

		tick();
		window.setInterval(tick, 1000);
		window.addEventListener('resize', tick);
	},

	initDarkMode() {
		const button = document.querySelector('#menubar-darkmode');

		if (button)
			button.addEventListener('click', () => this.toggleDarkmode());
	},

	initAlerts() {
		document.querySelectorAll('.alerts .alert-close').forEach((button) => {
			button.addEventListener('click', () => {
				const alert = button.closest('.alert-message');

				if (alert && alert.parentNode)
					alert.parentNode.removeChild(alert);
			});
		});
	},

	initWifi() {
		const button = document.querySelector('#menubar-wifi');

		if (!button)
			return;

		if (!util.hasWifi()) {
			button.style.display = 'none';
			return;
		}

		button.addEventListener('click', () => {
			const url = this.urlFor('network', 'wireless');

			if (this.shell && wm.enabled)
				wm.openOrFocus('network', url, util.t('Wireless', '无线'));
			else
				location.href = url;
		});

		if (button.getAttribute('data-bound') === '1')
			return;

		button.setAttribute('data-bound', '1');

		L.require('network').then((network) => {
			const update = () => network.getWifiNetworks().then((nets) => {
				const active = (nets || []).filter((net) => {
					try { return !net.isDisabled() && net.getActiveSSID(); }
					catch (e) { return false; }
				});

				button.classList.toggle('is-up', active.length > 0);
				button.title = active.length
					? active.map((net) => net.getActiveSSID()).join(', ')
					: util.t('Not connected', '未连接');
			}).catch(() => {});

			update();
			window.setInterval(update, 20000);
		}).catch(() => {});
	}
});
