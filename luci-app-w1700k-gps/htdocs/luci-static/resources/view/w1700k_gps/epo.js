'use strict';
'require view';
'require form';
'require fs';
'require ui';
'require poll';

var HELPER = '/usr/libexec/w1700k-gps-epo';
var HELPER_MAIN = '/usr/libexec/w1700k-gps';

function getStatus() {
	return fs.exec(HELPER, [ 'status' ]).then(function(res) {
		try {
			return JSON.parse(res.stdout || '{}');
		} catch (e) {
			return {};
		}
	});
}

/* GPS hour (hours since 1980-01-06 00:00:00 UTC) -> readable UTC time */
function gpsHourToDate(h) {
	return new Date(Date.UTC(1980, 0, 6) + h * 3600 * 1000).toISOString().replace('T', ' ').replace(/:\d\d\.\d+Z$/, ' UTC');
}

function describe(st) {
	var rows = [];
	function add(k, v) {
		rows.push(E('div', { 'class': 'tr' }, [
			E('div', { 'class': 'td left', 'width': '33%' }, E('strong', k)),
			E('div', { 'class': 'td left' }, v)
		]));
	}

	if (!st.enabled) {
		add(_('State'), _('Disabled'));
	} else if (!st.configured) {
		add(_('State'), E('span', { 'class': 'alert-message warning' }, _('Enabled, but the vendor, project and device ID are not set.')));
	} else if (!st.updated) {
		add(_('State'), _('Starting… the first transfer happens within a minute.'));
	} else {
		add(_('State'), st.ok
			? E('span', { 'class': 'label success' }, _('working'))
			: E('span', { 'class': 'alert-message warning' }, st.error || _('failed')));
		add(_('Last attempt'), new Date(st.updated * 1000).toLocaleString());
		if (st.ok) {
			add(_('Prediction file'), '%s, slot %d (valid from %s)'.format(st.file, st.slot, gpsHourToDate(st.slot_start)));
			add(_('Sent to the receiver'), _('%d records (GPS + GLONASS); %d accepted, %d rejected, the rest not seen').format(st.sent, st.acks_ok, st.acks_rejected));
		}
		if (st.next)
			add(_('Next transfer'), new Date(st.next * 1000).toLocaleString());
	}
	return E('div', { 'class': 'table' }, rows);
}

return view.extend({
	load: function() {
		return getStatus();
	},

	render: function(st) {
		var self = this;
		var m, s, o;

		m = new form.Map('w1700k_gps', _('GPS settings'),
			_('Downloads satellite orbit predictions (MediaTek EPO data) and gives them to the GPS receiver of the Gemtek W1700K, so that it can find satellites faster after a cold start. It only helps once the receiver can hear satellites; it does not make the antenna more sensitive. Only GPS and GLONASS are sent. Nothing is written to the receiver\'s flash: the data is lost when the receiver loses power and is sent again every 30 minutes.'));

		s = m.section(form.NamedSection, 'epo', 'epo', _('Satellite prediction'));
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.rmempty = false;

		o = s.option(form.Value, 'host', _('Server'));
		o.placeholder = 'wpepodownload.mediatek.com';
		o.datatype = 'host';

		o = s.option(form.Value, 'vendor', _('Vendor'));
		o.password = true;
		o.rmempty = false;
		o.description = _('Identifies the customer to the EPO service. Not pre-filled: on a stock Gemtek firmware the value is kept in /etc/config/axon_platform_manager (property axon.gps.anld.config.epoVendor); the image itself ships it blank. Stored here in /etc/config/w1700k_gps, readable by root only.');

		o = s.option(form.Value, 'project', _('Project'));
		o.password = true;
		o.rmempty = false;
		o.description = _('Not pre-filled. On a stock Gemtek firmware it is kept in /etc/config/axon_platform_manager (property axon.gps.anld.config.epoProject), so read it from a backup of the original firmware config filesystem.');

		o = s.option(form.Value, 'device_id', _('Device ID'));
		o.password = true;
		o.rmempty = false;
		o.description = _('Random and unique to this router (generated at install).');

		o = s.option(form.Button, '_regen', _('New device ID'));
		o.inputtitle = _('Generate a new device ID');
		o.inputstyle = 'action';
		o.write = function() {};
		o.remove = function() {};
		o.onclick = function(ev, section_id) {
			var abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
			var b = new Uint8Array(43), id = '';
			crypto.getRandomValues(b);
			for (var i = 0; i < b.length; i++)
				id += abc.charAt(b[i] & 63);
			this.section.getOption('device_id').getUIElement(section_id).setValue(id);
			ui.addNotification(null, E('p', _('A new device ID was generated (43 characters). Click "Save & Apply" to use it; the satellite prediction data is fetched again with it.')), 'info');
		};

		s = m.section(form.NamedSection, 'clock', 'clock', _('Router clock'));
		s.addremove = false;

		o = s.option(form.Flag, 'auto', _('Set the clock from GPS automatically'));
		o.rmempty = false;
		o.description = _('When on, a router clock that is more than 5 seconds off from a satellite fix is corrected (checked once a minute). Useful when this router has no internet time source. It does nothing without a fix and it never touches a clock that is already within 5 seconds. The button on the Status tab sets the clock once.');

		s = m.section(form.NamedSection, 'position', 'position', _('Last known position'));
		s.addremove = false;
		s.description = _('Shown on the map of the Status tab while the receiver has no fix (a router indoors never gets one). It is only a picture of where the router is: it is not sent to the receiver and does not change any GPS data.');

		o = s.option(form.Flag, 'auto', _('Remember the last satellite fix'));
		o.rmempty = false;
		o.description = _('Saves the position of a good 3D fix. Writes to flash, at most once an hour and only after the router moved by more than about 250 m, so a router that stays put writes it once.');

		o = s.option(form.Value, 'lat', _('Latitude'));
		o.datatype = 'float';
		o.placeholder = '52.520008';
		o.validate = function(sid, v) {
			return (v === '' || (+v >= -90 && +v <= 90)) ? true : _('Latitude is between -90 and 90 degrees');
		};

		o = s.option(form.Value, 'lon', _('Longitude'));
		o.datatype = 'float';
		o.placeholder = '13.404954';
		o.validate = function(sid, v) {
			return (v === '' || (+v >= -180 && +v <= 180)) ? true : _('Longitude is between -180 and 180 degrees');
		};
		o.description = _('Decimal degrees. You can enter it by hand (for example copied from a map); a saved fix replaces it when the option above is on. Leave both empty for none.');

		s = m.section(form.NamedSection, 'serve', 'serve', _('Share the GPS data on the network'));
		s.addremove = false;
		s.description = _('Off by default. While any sharing feature is on, a background service owns the serial port and the Status tab reads from it. Nothing here is encrypted or password protected and the position of your router goes to everyone who can connect, so by default these ports listen on the LAN address only. Do not forward them from the internet.');

		o = s.option(form.Value, 'bind', _('Listen address'));
		o.datatype = 'ipaddr';
		o.placeholder = _('LAN address of this router');
		o.description = _('Address for the NMEA, gpsd and time server ports. Empty = the LAN address (or 127.0.0.1 if there is none).');

		o = s.option(form.Flag, 'nmea_enabled', _('NMEA over TCP'));
		o.rmempty = false;
		o.description = _('Streams the receiver\'s NMEA sentences to every client that connects (for example <code>nc ROUTER 10110</code>). Listen only: nothing sent by a client reaches the receiver.');

		o = s.option(form.Value, 'nmea_port', _('NMEA port'));
		o.datatype = 'port';
		o.placeholder = '10110';
		o.depends('nmea_enabled', '1');

		o = s.option(form.Flag, 'gpsd_enabled', _('gpsd protocol'));
		o.rmempty = false;
		o.description = _('Speaks the gpsd JSON protocol (TPV and SKY), so <code>cgps</code>, <code>gpspipe</code>, chrony, Home Assistant and similar clients can use this router as a gpsd server. No gpsd package is needed. Only the watch/poll/version/devices requests are understood; there is no way to change receiver settings.');

		o = s.option(form.Value, 'gpsd_port', _('gpsd port'));
		o.datatype = 'port';
		o.placeholder = '2947';
		o.depends('gpsd_enabled', '1');

		s = m.section(form.NamedSection, 'ntp', 'ntp', _('Time server (SNTP)'));
		s.addremove = false;
		s.description = _('Answers NTP requests as stratum 1 with the reference "GPS", using the time of a satellite fix. There is no PPS signal on this board (no /dev/pps*), so the time comes from the NMEA text only: expect an error of about a tenth of a second, which is fine for logs and home devices but not for precise timing. It does not answer until a fix has been measured, and not at all while there is no fix. Needs the listen address above; port 123 is taken if the router\'s own NTP server is on, then pick another port.');

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.rmempty = false;

		o = s.option(form.Value, 'port', _('UDP port'));
		o.datatype = 'port';
		o.placeholder = '123';
		o.depends('enabled', '1');

		s = m.section(form.NamedSection, 'mqtt', 'mqtt', _('MQTT and Home Assistant'));
		s.addremove = false;
		s.description = _('Publishes fix, position, satellites and signal to an MQTT broker (retained, as one JSON state topic) and announces them to Home Assistant by MQTT discovery (sensors plus a device tracker). The position is sent only while there is a fix. MQTT 3.1.1 without TLS; the password is stored in /etc/config/w1700k_gps, readable by root only.');

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.rmempty = false;

		o = s.option(form.Button, '_import', _('Broker of the Zigbee gateway'));
		o.inputtitle = _('Copy host, user and password from Multiprotocol');
		o.inputstyle = 'action';
		o.write = function() {};
		o.remove = function() {};
		o.onclick = function() {
			return fs.exec(HELPER_MAIN, [ 'mqtt-import' ]).then(function(res) {
				var r;
				try { r = JSON.parse(res.stdout || ''); } catch (e) { r = { ok: false, error: (res.stderr || res.stdout || '').trim() }; }
				if (r.ok) {
					ui.addNotification(null, E('p', _('Copied %s:%d. The page reloads; unsaved edits on it are lost.').format(r.host, r.port)), 'info');
					window.setTimeout(function() { window.location.reload(); }, 1200);
				} else {
					ui.addNotification(null, E('p', r.error || _('failed')), 'danger');
				}
			});
		};
		o.description = _('Saves the broker settings of Services > Multiprotocol (Zigbee MQTT gateway) here. The topics are separate: that one uses its own base name.');

		o = s.option(form.Value, 'host', _('Broker host'));
		o.datatype = 'host';
		o.depends('enabled', '1');

		o = s.option(form.Value, 'port', _('Broker port'));
		o.datatype = 'port';
		o.placeholder = '1883';
		o.depends('enabled', '1');

		o = s.option(form.Value, 'user', _('User'));
		o.depends('enabled', '1');

		o = s.option(form.Value, 'pass', _('Password'));
		o.password = true;
		o.depends('enabled', '1');

		o = s.option(form.Value, 'base', _('Topic base'));
		o.placeholder = 'w1700k_gps';
		o.datatype = 'string';
		o.validate = function(sid, v) { return (v === '' || /^[A-Za-z0-9_-]{1,40}(\/[A-Za-z0-9_-]{1,40})*$/.test(v)) ? true : _('Letters, digits, - _ and / between parts'); };
		o.depends('enabled', '1');

		o = s.option(form.Flag, 'discovery', _('Home Assistant discovery'));
		o.rmempty = false;
		o.default = '1';
		o.depends('enabled', '1');

		o = s.option(form.Value, 'prefix', _('Discovery prefix'));
		o.placeholder = 'homeassistant';
		o.validate = function(sid, v) { return (v === '' || /^[A-Za-z0-9_-]{1,40}(\/[A-Za-z0-9_-]{1,40})*$/.test(v)) ? true : _('Letters, digits, - _ and / between parts'); };
		o.depends('discovery', '1');

		o = s.option(form.Value, 'interval', _('Publish every (seconds)'));
		o.datatype = 'range(5,3600)';
		o.placeholder = '30';
		o.depends('enabled', '1');
		o.description = _('A change of fix state, position or satellite count is published at once; otherwise at this interval.');

		this.box = E('div', {}, describe(st));
		poll.add(function() {
			return getStatus().then(function(r) {
				self.box.replaceChildren(describe(r));
			});
		}, 10);

		return m.render().then(function(node) {
			return E('div', {}, [ node, E('h3', _('Satellite prediction status')), self.box ]);
		});
	}
});
