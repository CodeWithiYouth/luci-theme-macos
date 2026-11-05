#
# luci-theme-macos — a macOS inspired desktop theme for LuCI
#
# This is free software, licensed under the Apache License, Version 2.0.
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=macOS Style Theme (Desktop + Dock)
LUCI_DESCRIPTION:=Replaces the classic router settings layout with a macOS \
	style desktop, dock and application windows. \
	/ 用 macOS 风格的桌面、Dock 与应用窗口取代传统的路由器设置页面布局。
LUCI_DEPENDS:=+luci-base

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=luci-theme-macos contributors

define Package/luci-theme-macos/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	uci -q delete luci.themes.macOS

	if [ "$$(uci -q get luci.main.mediaurlbase)" = "/luci-static/macos" ]; then
		uci -q set luci.main.mediaurlbase=/luci-static/bootstrap
	fi

	uci commit luci
}
endef

# works both inside the LuCI feed (themes/…) and when dropped into package/
LUCI_MK:=$(firstword $(wildcard ../../luci.mk $(TOPDIR)/feeds/luci/luci.mk $(TOPDIR)/luci.mk))

ifeq ($(LUCI_MK),)
$(error Unable to locate luci.mk, please build this package inside the LuCI feed)
endif

# csstidy/jsmin are too old for the modern CSS/JS used here: csstidy stops
# parsing at the SVG data URIs and ships a truncated cascade.css (about 5 KB
# instead of 78 KB), which leaves the theme without any styling. Ship the
# sources unminified instead.
LUCI_MINIFY_CSS:=0
LUCI_MINIFY_JS:=0

include $(LUCI_MK)

# call BuildPackage - OpenWrt buildroot signature
