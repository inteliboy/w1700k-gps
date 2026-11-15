include $(TOPDIR)/rules.mk

LUCI_TITLE:=GPS status and sharing for the Gemtek W1700K (Airoha AG3352)
LUCI_DESCRIPTION:=Live GPS status, sky coverage map, antenna check, satellite prediction (EPO), clock from GPS, and opt-in sharing (NMEA over TCP, gpsd protocol, MQTT with Home Assistant discovery, SNTP time source)
LUCI_DEPENDS:=+luci-base +ucode +ucode-mod-fs +ucode-mod-uci +ucode-mod-socket +ucode-mod-math +coreutils-stty +curl
LUCI_PKGARCH:=all

PKG_VERSION:=0.6.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=inteliboy

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
