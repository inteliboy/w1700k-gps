'use strict';
'require view';
'require fs';
'require ui';
'require uci';
'require poll';

var HELPER = '/usr/libexec/w1700k-gps';

function call() {
	return fs.exec(HELPER, [ 'status' ]).then(function(res) {
		try {
			return JSON.parse(res.stdout || '');
		} catch (e) {
			return { ok: false, error: (res.stderr || res.stdout || _('no answer from the helper')).trim() };
		}
	});
}

function callInfo() {
	return fs.exec(HELPER, [ 'info' ]).then(function(res) {
		try {
			return JSON.parse(res.stdout || '');
		} catch (e) {
			return { ok: false, error: (res.stderr || res.stdout || '').trim() };
		}
	});
}

function row(k, v) {
	return E('div', { 'class': 'tr' }, [
		E('div', { 'class': 'td left', 'width': '33%' }, E('strong', k)),
		E('div', { 'class': 'td left' }, v)
	]);
}

function badge(text, cls) {
	return E('span', { 'class': 'label ' + (cls || ''), 'style': 'margin-right:.5em' }, text);
}

function fmt(v, digits, unit) {
	if (v == null) return '-';
	return v.toFixed(digits) + (unit ? ' ' + unit : '');
}

/* SNR bar: 0..50 dB-Hz */
function snrBar(snr, used) {
	var pct = Math.max(0, Math.min(100, Math.round((snr || 0) * 2)));
	return E('div', { 'style': 'background:rgba(128,128,128,.25);border-radius:3px;min-width:80px;height:.9em' },
		E('div', { 'style': 'height:100%;border-radius:3px;width:' + pct + '%;background:' + (used ? '#4caf50' : '#9e9e9e') }));
}



function callJSON(arg, dflt) {
	return fs.exec(HELPER, [ arg ]).then(function(res) {
		try {
			return JSON.parse(res.stdout || '');
		} catch (e) {
			return dflt;
		}
	});
}

var COMPASS = [ 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW' ];
function compass(az) { return COMPASS[Math.round((az % 360) / 45) % 8]; }

/* Sky coverage heat map from the RAM sky file: cells are 15 degrees of azimuth x 10 degrees of elevation.
   Green = satellites were heard there (brighter = stronger), red = satellites were listed there but never heard,
   empty = no satellite has crossed that part of the sky yet. */
function skyHeat(sk) {
	var NS = 'http://www.w3.org/2000/svg', R = 90, C = 110, NA = sk.az, NE = sk.el, da = 360 / NA;
	function el(n, a, txt) {
		var e = document.createElementNS(NS, n);
		Object.keys(a || {}).forEach(function(k) { e.setAttribute(k, a[k]); });
		if (txt != null) e.textContent = txt;
		return e;
	}
	function pt(r, az) { var a = az * Math.PI / 180; return [ (C + r * Math.sin(a)).toFixed(1), (C - r * Math.cos(a)).toFixed(1) ]; }
	var svg = el('svg', { viewBox: '0 0 220 220', width: 260, height: 260, style: 'max-width:100%' });
	for (var e = 0; e < NE; e++) {
		var ro = R * (90 - e * 10) / 90, ri = R * (80 - e * 10) / 90;
		for (var a = 0; a < NA; a++) {
			var i = e * NA + a, seen = sk.seen[i], trk = sk.trk[i];
			if (!seen) continue;
			var p1 = pt(ro, a * da), p2 = pt(ro, (a + 1) * da), p3 = pt(ri, (a + 1) * da), p4 = pt(ri, a * da);
			var d = 'M' + p1.join(' ') + 'A' + ro + ' ' + ro + ' 0 0 1 ' + p2.join(' ') + 'L' + p3.join(' ') + 'A' + ri + ' ' + ri + ' 0 0 0 ' + p4.join(' ') + 'Z';
			var rate = trk / seen, snr = trk ? sk.snr[i] / trk : 0, fill, op;
			if (rate < .3) { fill = '#e53935'; op = Math.min(.85, .25 + seen * .05); }
			else { fill = '#4caf50'; op = Math.max(.25, Math.min(1, snr / 45)) * (rate < .7 ? .6 : 1); }
			var c = el('path', { d: d, fill: fill, 'fill-opacity': op });
			c.appendChild(el('title', {}, _('%s, elevation %d-%d°: listed %d x, heard %d x%s').format(compass(a * da + da / 2), e * 10, e * 10 + 10, seen, trk, trk ? _(', average %s dB-Hz').format(snr.toFixed(0)) : '')));
			svg.appendChild(c);
		}
	}
	var g = { fill: 'none', stroke: 'currentColor', 'stroke-opacity': .3 };
	[ 1, 2 / 3, 1 / 3 ].forEach(function(f) { svg.appendChild(el('circle', Object.assign({ cx: C, cy: C, r: R * f }, g))); });
	svg.appendChild(el('line', Object.assign({ x1: C, y1: C - R, x2: C, y2: C + R }, g)));
	svg.appendChild(el('line', Object.assign({ x1: C - R, y1: C, x2: C + R, y2: C }, g)));
	[ [ 'N', C, 12 ], [ 'S', C, 216 ], [ 'E', 214, C + 4 ], [ 'W', 6, C + 4 ] ].forEach(function(l) {
		svg.appendChild(el('text', { x: l[1], y: l[2], 'text-anchor': 'middle', 'font-size': 11, fill: 'currentColor' }, l[0]));
	});
	return svg;
}

/* directions (45 degree sectors, low = below 30 degrees, high = above) where satellites were listed often but heard rarely */
function blockedDirs(sk) {
	var out = [];
	for (var o = 0; o < 8; o++) {
		[ [ 0, 3, _('low') ], [ 3, sk.el, _('high') ] ].forEach(function(b) {
			var seen = 0, trk = 0;
			for (var e = b[0]; e < b[1]; e++)
				for (var a = 0; a < sk.az; a++) {
					var az = (a + .5) * 360 / sk.az, oct = Math.round(az / 45) % 8;
					if (oct != o) continue;
					seen += sk.seen[e * sk.az + a];
					trk += sk.trk[e * sk.az + a];
				}
			if (seen >= 6 && trk / seen < .3)
				out.push({ dir: COMPASS[o], band: b[2], seen: seen, rate: trk / seen });
		});
	}
	return out;
}

/* Antenna placement check from the live reading and the sky map. Returns [{ lvl: ok|warn|bad, text }] */
function antennaChecks(st, sk) {
	var r = [];
	if (!st || st.ok === false || !st.sentences) {
		r.push({ lvl: 'bad', text: _('No data from the receiver, so nothing can be judged yet.') });
		return r;
	}
	var sats = st.satellites || [], heard = sats.filter(function(s) { return s.snr; });
	var used = sats.filter(function(s) { return s.used; });
	if (st.fix && st.fix_type >= 3 && used.length >= 5)
		r.push({ lvl: 'ok', text: _('Position fix with %d satellites: the antenna position works.').format(used.length) });
	else if (heard.length >= 4)
		r.push({ lvl: 'warn', text: _('%d satellites are heard but there is no good fix yet; give it a few minutes, then judge.').format(heard.length) });
	else
		r.push({ lvl: 'bad', text: _('Only %d satellite(s) heard. A fix needs at least 4. Move the router to a window or outdoors with a clear view of the sky.').format(heard.length) });
	if (heard.length) {
		var avg = heard.reduce(function(a, s) { return a + s.snr; }, 0) / heard.length;
		if (avg >= 35) r.push({ lvl: 'ok', text: _('Strong signal (average %s dB-Hz).').format(avg.toFixed(0)) });
		else if (avg >= 25) r.push({ lvl: 'warn', text: _('Moderate signal (average %s dB-Hz). Above 35 is good; a better view of the sky helps.').format(avg.toFixed(0)) });
		else r.push({ lvl: 'bad', text: _('Weak signal (average %s dB-Hz). Walls, a roof or metal are in the way.').format(avg.toFixed(0)) });
		var high = heard.filter(function(s) { return s.elevation >= 45; });
		if (!high.length)
			r.push({ lvl: 'warn', text: _('No satellite above 45° is heard. Overhead satellites are the strongest; a ceiling or roof above the router blocks them.') });
		var q = [ 0, 0, 0, 0 ], ql = [ 0, 0, 0, 0 ];
		sats.forEach(function(s) { if (s.azimuth != null && s.elevation >= 15) ql[Math.floor(((s.azimuth + 45) % 360) / 90)]++; });
		heard.forEach(function(s) { if (s.azimuth != null && s.elevation >= 15) q[Math.floor(((s.azimuth + 45) % 360) / 90)]++; });
		[ 'N', 'E', 'S', 'W' ].forEach(function(n, i) {
			if (ql[i] >= 2 && q[i] == 0 && heard.length >= 3)
				r.push({ lvl: 'warn', text: _('Satellites listed in the %s are not heard at all: something blocks that side (move the router away from that wall).').format(n) });
		});
	}
	if (st.fix && st.hdop != null && st.hdop > 4)
		r.push({ lvl: 'warn', text: _('HDOP %s is high: the satellites in use are bunched together, which a blocked part of the sky causes.').format(st.hdop.toFixed(1)) });
	if (sk && sk.ok && sk.n >= 30) {
		var bd = blockedDirs(sk);
		if (bd.length)
			r.push({ lvl: 'warn', text: _('Over %d samples, satellites were listed but rarely heard toward: %s.').format(sk.n, bd.map(function(b) { return b.dir + ' ' + b.band; }).join(', ')) });
		else
			r.push({ lvl: 'ok', text: _('Over %d samples no direction looks blocked.').format(sk.n) });
	} else {
		r.push({ lvl: 'info', text: _('The blocked-direction check needs about 30 minutes of samples (%d so far).').format(sk && sk.n || 0) });
	}
	return r;
}

function callHistory() {
	return fs.exec(HELPER, [ 'history' ]).then(function(res) {
		try {
			return JSON.parse(res.stdout || '');
		} catch (e) {
			return { ok: false, samples: [] };
		}
	});
}

function dur(s) {
	s = Math.round(s);
	if (s < 60) return _('%d s').format(s);
	if (s < 3600) return _('%d min %d s').format(Math.floor(s / 60), s % 60);
	return _('%d h %d min').format(Math.floor(s / 3600), Math.floor(s % 3600 / 60));
}

/* One small time chart from the RAM history. Samples: [uptime_s, fix, used, view, hdop, snr].
   series: [{ i: column, color, label, needFix }]. Samples with a fix get a faint green band behind the lines.
   Lines break where samples are missing for more than 3 steps. */
function histChart(h, hours, title, series, ymax, unit) {
	var NS = 'http://www.w3.org/2000/svg', W = 640, H = 120, L = 30, R = 8, T = 6, B = 18;
	var t1 = h.uptime, t0 = t1 - hours * 3600, gap = 3 * h.step;
	var sm = h.samples.filter(function(s) { return s[0] >= t0 - h.step; });
	function el(n, a, txt) {
		var e = document.createElementNS(NS, n);
		Object.keys(a || {}).forEach(function(k) { e.setAttribute(k, a[k]); });
		if (txt != null) e.textContent = txt;
		return e;
	}
	function x(t) { return L + Math.max(0, t - t0) / (t1 - t0) * (W - L - R); }
	function y(v) { return T + (1 - Math.min(v, ymax) / ymax) * (H - T - B); }
	var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, style: 'width:100%;max-width:' + W + 'px;display:block' });
	var g = { stroke: 'currentColor', 'stroke-opacity': .2 };
	[ 0, .5, 1 ].forEach(function(f) {
		var yy = T + (1 - f) * (H - T - B);
		svg.appendChild(el('line', Object.assign({ x1: L, x2: W - R, y1: yy, y2: yy }, g)));
		svg.appendChild(el('text', { x: L - 4, y: yy + 3, 'text-anchor': 'end', 'font-size': 9, fill: 'currentColor', 'fill-opacity': .7 },
			String(Math.round(f * ymax * 10) / 10)));
	});
	sm.forEach(function(s) {
		if (!s[1]) return;
		var xa = x(s[0]), xb = x(s[0] + h.step);
		svg.appendChild(el('rect', { x: xa, y: T, width: Math.max(1, xb - xa), height: H - T - B, fill: '#4caf50', 'fill-opacity': .12 }));
	});
	series.forEach(function(se) {
		var d = '', pen = false, last = null;
		sm.forEach(function(s) {
			var v = s[se.i];
			if (v == null || (se.needFix && !s[1])) {
				pen = false;
				return;
			}
			if (last != null && s[0] - last > gap)
				pen = false;
			d += (pen ? 'L' : 'M') + x(s[0]).toFixed(1) + ' ' + y(v).toFixed(1);
			pen = true;
			last = s[0];
		});
		if (d) svg.appendChild(el('path', { d: d, fill: 'none', stroke: se.color, 'stroke-width': 1.5 }));
	});
	/* time axis in the browser's clock: uptime -> wall time */
	[ 0, .5, 1 ].forEach(function(f) {
		var t = t0 + f * (t1 - t0), d = new Date(Date.now() - (t1 - t) * 1000);
		svg.appendChild(el('text', { x: L + f * (W - L - R), y: H - 4, 'text-anchor': f == 0 ? 'start' : f == 1 ? 'end' : 'middle',
			'font-size': 9, fill: 'currentColor', 'fill-opacity': .7 }, d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
	});
	var legend = series.map(function(se) {
		return E('span', { 'style': 'margin-right:1em' }, [ E('span', { 'style': 'display:inline-block;width:.8em;height:.2em;vertical-align:middle;margin-right:.3em;background:' + se.color }), se.label ]);
	});
	return E('div', { 'style': 'margin:.4em 0 .8em' }, [
		E('div', { 'style': 'font-size:90%' }, [ E('strong', { 'style': 'margin-right:1em' }, title + (unit ? ' (' + unit + ')' : '')), legend ]),
		svg
	]);
}


/* polar sky plot: centre = zenith, rim = horizon, north up. Satellites used in the fix are green. */
function skyPlot(sats) {
	var NS = 'http://www.w3.org/2000/svg', R = 90, C = 110;
	function el(n, a, txt) {
		var e = document.createElementNS(NS, n);
		Object.keys(a || {}).forEach(function(k) { e.setAttribute(k, a[k]); });
		if (txt != null) e.textContent = txt;
		return e;
	}
	var svg = el('svg', { viewBox: '0 0 220 220', width: 260, height: 260, style: 'max-width:100%' });
	var g = { fill: 'none', stroke: 'currentColor', 'stroke-opacity': .3 };
	[ 1, 2 / 3, 1 / 3 ].forEach(function(f) { svg.appendChild(el('circle', Object.assign({ cx: C, cy: C, r: R * f }, g))); });
	svg.appendChild(el('line', Object.assign({ x1: C, y1: C - R, x2: C, y2: C + R }, g)));
	svg.appendChild(el('line', Object.assign({ x1: C - R, y1: C, x2: C + R, y2: C }, g)));
	[ [ 'N', C, 12 ], [ 'S', C, 216 ], [ 'E', 214, C + 4 ], [ 'W', 6, C + 4 ] ].forEach(function(l) {
		svg.appendChild(el('text', { x: l[1], y: l[2], 'text-anchor': 'middle', 'font-size': 11, fill: 'currentColor' }, l[0]));
	});
	sats.forEach(function(s) {
		if (s.elevation == null || s.azimuth == null) return;
		var r = R * (90 - s.elevation) / 90, a = s.azimuth * Math.PI / 180;
		var x = C + r * Math.sin(a), y = C - r * Math.cos(a);
		svg.appendChild(el('circle', { cx: x, cy: y, r: 7, fill: s.used ? '#4caf50' : '#9e9e9e', 'fill-opacity': s.snr ? .95 : .4 }));
		svg.appendChild(el('text', { x: x, y: y + 3, 'text-anchor': 'middle', 'font-size': 8, fill: '#fff' }, String(s.prn)));
	});
	return svg;
}

/* OpenStreetMap embed, in a section that is NOT redrawn with the rest (moving an iframe in the DOM reloads it).
   The browser loads the tiles, the router needs no internet for it. The src only changes when the position moved
   more than ~25 m. */
function updateMap(self, lat, lon, note) {
	if (lat == null || lon == null) {
		self.mapSect.style.display = 'none';
		return;
	}
	self.mapSect.style.display = '';
	self.mapNote.textContent = note || _('Map tiles are loaded by your browser from openstreetmap.org.');
	var d = self.mapAt ? Math.hypot((lat - self.mapAt[0]) * 111000, (lon - self.mapAt[1]) * 111000 * Math.cos(lat * Math.PI / 180)) : 1e9;
	if (d > 25) {
		var dy = 0.002, dx = 0.003;
		self.mapFrame.src = 'https://www.openstreetmap.org/export/embed.html?bbox=%s,%s,%s,%s&layer=mapnik&marker=%s,%s'
			.format(lon - dx, lat - dy, lon + dx, lat + dy, lat, lon);
		self.mapAt = [ lat, lon ];
	}
}

return view.extend({
	load: function() {
		return Promise.all([ call(), uci.load('w1700k_gps') ]).then(function(r) { return r[0]; });
	},

	/* the stored last known position (manual or saved fix), or null */
	storedPos: function() {
		var la = parseFloat(uci.get('w1700k_gps', 'position', 'lat')), lo = parseFloat(uci.get('w1700k_gps', 'position', 'lon'));
		if (isNaN(la) || isNaN(lo))
			return null;
		var saved = parseInt(uci.get('w1700k_gps', 'position', 'saved')) || 0;
		return { lat: la, lon: lo, source: uci.get('w1700k_gps', 'position', 'source') == 'fix' ? 'fix' : 'manual', saved: saved };
	},

	render: function(st) {
		var self = this;
		this.box = E('div');
		this.mapFrame = E('iframe', {
			'style': 'width:100%;height:320px;border:1px solid rgba(128,128,128,.4);border-radius:3px',
			'loading': 'lazy', 'referrerpolicy': 'no-referrer'
		});
		this.mapSect = E('div', { 'style': 'display:none' }, [
			E('h3', _('Map')), this.mapFrame,
			this.mapNote = E('div', { 'class': 'cbi-map-descr' }, _('Map tiles are loaded by your browser from openstreetmap.org.'))
		]);
		this.hours = 1;
		this.hist = null;
		this.histBox = E('div');
		this.last = st;
		this.info = null;
		this.draw(st);
		this.loadHistory();
		/* the receiver firmware string: asked once (cached on the router), after the first paint, because the
		   first query takes a few seconds and shares the serial port with the status reads */
		callInfo().then(function(i) {
			self.info = i;
			self.draw(self.last);
		});
		poll.add(function() {
			return call().then(function(r) {
				/* keep the last good picture if only one read was busy */
				if (r.ok === false && r.error && r.error.indexOf('busy') >= 0)
					return;
				self.last = r;
				self.draw(r);
			});
		}, 5);
		poll.add(function() { return self.loadHistory(); }, 30);
		return E('div', {}, [ this.box, this.skyBox, this.histBox, this.mapSect ]);
	},

	loadHistory: function() {
		var self = this;
		uci.unload('w1700k_gps');
		return Promise.all([ callHistory(), uci.load('w1700k_gps') ]).then(function(r) {
			self.hist = r[0];
			self.drawHistory();
		});
	},

	drawHistory: function() {
		var self = this, h = this.hist, v = E('div');
		v.appendChild(E('h3', _('Fix history')));
		if (!h || !h.ok || !h.samples || h.samples.length < 2) {
			v.appendChild(E('p', E('em', _('The history fills in once a minute and is kept in RAM only (it is lost on reboot). Nothing recorded yet.'))));
			this.histBox.replaceChildren(v);
			return;
		}

		var t = E('div', { 'class': 'table' });
		if (h.first_fix != null)
			t.appendChild(row(_('Time to first fix'), (h.first_fix_exact ? '' : '≤ ') + dur(h.first_fix) + _(' after the router booted')));
		else
			t.appendChild(row(_('Time to first fix'), E('em', _('no fix yet, the router has been up for %s').format(dur(h.uptime)))));
		if (h.lost_at != null && h.reacquired_s != null)
			t.appendChild(row(_('Last fix loss'), _('lost %s ago, regained after %s').format(dur(h.uptime - h.lost_at), dur(h.reacquired_s))));
		else if (h.lost_at != null && !h.fix_now)
			t.appendChild(row(_('Fix lost'), _('no fix for %s').format(dur(h.uptime - h.lost_at))));
		t.appendChild(row('', E('em', _('Measured from router boot (the receiver is powered with the router) to the first sample with a fix; resolution one minute. The satellite prediction data is sent to the receiver within the first minute after boot.'))));
		v.appendChild(t);

		var sel = E('select', { 'class': 'cbi-input-select', 'style': 'width:auto', 'change': function(ev) {
			self.hours = +ev.target.value;
			self.drawHistory();
		} }, [ [ 1, _('last hour') ], [ 6, _('last 6 hours') ], [ 24, _('last 24 hours') ] ].map(function(o) {
			return E('option', { 'value': o[0], 'selected': o[0] == self.hours ? '' : null }, o[1]);
		}));
		v.appendChild(E('div', { 'style': 'margin:.5em 0' }, [ sel, E('span', { 'style': 'margin-left:1em;font-size:90%' }, _('Green background = fix.')) ]));

		var maxv = 8, maxh = 5;
		h.samples.forEach(function(s) {
			maxv = Math.max(maxv, s[3], s[2]);
			if (s[1] && s[4] != null) maxh = Math.max(maxh, Math.ceil(s[4]));
		});
		v.appendChild(histChart(h, this.hours, _('Satellites'), [
			{ i: 3, color: '#9e9e9e', label: _('in view') }, { i: 2, color: '#4caf50', label: _('used') } ], Math.ceil(maxv / 4) * 4));
		v.appendChild(histChart(h, this.hours, _('Signal'), [ { i: 5, color: '#2196f3', label: _('average SNR of used satellites') } ], 50, _('dB-Hz')));
		v.appendChild(histChart(h, this.hours, _('Precision'), [ { i: 4, color: '#ff9800', label: _('HDOP (only with a fix; lower is better)'), needFix: true } ], maxh));
		this.histBox.replaceChildren(v);
	},

	drawSky: function() {
		var sk = this.sky, v = E('div');
		v.appendChild(E('h3', _('Sky coverage')));
		if (!sk || !sk.ok || !sk.n) {
			v.appendChild(E('p', E('em', _('Collected once a minute while satellites are listed, kept in RAM only (lost on reboot). Nothing yet.'))));
			this.skyBox.replaceChildren(v);
			return;
		}
		var bd = blockedDirs(sk), txt;
		if (sk.n < 30)
			txt = E('em', _('Only %d samples so far; satellites need hours to cross the whole sky, so the picture fills in over time.').format(sk.n));
		else if (bd.length)
			txt = [ E('strong', _('Looks blocked or weak toward: ')), bd.map(function(b) { return b.dir + ' (' + b.band + ')'; }).join(', ') ];
		else
			txt = _('No direction looks blocked so far.');
		v.appendChild(E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:1.5em;align-items:flex-start' }, [
			skyHeat(sk),
			E('div', { 'style': 'flex:1;min-width:280px' }, [
				E('p', txt),
				E('p', { 'style': 'font-size:90%' }, [
					E('span', { 'style': 'color:#4caf50' }, '■ '), _('heard (brighter = stronger)'), ' ',
					E('span', { 'style': 'color:#e53935;margin-left:1em' }, '■ '), _('listed but rarely heard (blocked?)')
				]),
				E('p', { 'style': 'font-size:90%' }, _('%d samples over %s. Each cell is 15° of direction × 10° of height; the centre is straight up, the rim the horizon, north on top. Hover a cell for its numbers. Satellites are only listed when the receiver knows roughly where they are, so a freshly powered receiver fills this in slowly.').format(sk.n, dur(Math.max(0, sk.uptime - sk.since))))
			])
		]));
		this.skyBox.replaceChildren(v);
	},

	/* time quality + sharing rows from the serve daemon status file */
	shareRows: function(t) {
		var sv = this.serve;
		if (!sv || !sv.ok)
			return;
		if (!sv.running) {
			t.appendChild(row(_('Sharing'), E('em', _('off (enable NMEA, gpsd, MQTT or the time server in the Settings tab)'))));
			return;
		}
		var tm = sv.time || {}, parts = [];
		if (tm.n >= 3 && tm.off_ms != null) {
			t.appendChild(row(_('Time quality'), _('router clock %s ms from GPS time, jitter ±%s ms over %d fixes. %s').format(
				tm.off_ms.toFixed(0), (tm.jit_ms || 0).toFixed(0), tm.n,
				tm.pps_device ? _('A PPS device exists.') : _('There is no PPS signal on this board, so the time comes from NMEA text: usable to about a tenth of a second, not for precision timing.'))));
		} else {
			t.appendChild(row(_('Time quality'), E('em', _('measured once there is a fix (no PPS signal on this board, NMEA text only)'))));
		}
		if (sv.nmea) parts.push(sv.nmea.error ? E('span', { 'class': 'alert-message warning' }, sv.nmea.error) : _('NMEA TCP %s:%d (%d clients)').format(sv.bind, sv.nmea.port, sv.nmea.clients));
		if (sv.gpsd) parts.push(sv.gpsd.error ? E('span', { 'class': 'alert-message warning' }, sv.gpsd.error) : _('gpsd %s:%d (%d clients)').format(sv.bind, sv.gpsd.port, sv.gpsd.clients));
		if (sv.mqtt) parts.push(sv.mqtt.connected ? _('MQTT connected to %s:%d').format(sv.mqtt.host, sv.mqtt.port) : E('span', { 'class': 'alert-message warning' }, _('MQTT: %s').format(sv.mqtt.error || _('connecting…'))));
		if (sv.ntp) parts.push(sv.ntp.ok === false ? E('span', { 'class': 'alert-message warning' }, sv.ntp.error) : _('time server %s:%d, %d answered%s').format(sv.ntp.bind, sv.ntp.port, sv.ntp.served, sv.ntp.active ? '' : _(' (waiting for a fix, not answering)')));
		if (parts.length) {
			var out = [];
			parts.forEach(function(p, i) { if (i) out.push(E('br')); out.push(p); });
			t.appendChild(row(_('Sharing'), out));
		}
	},

	setClock: function() {
		var self = this;
		ui.showModal(_('Set the router clock'), [
			E('p', _('Set the system clock of this router to the UTC time of the GPS receiver? This changes the time of the whole router (logs, certificates, schedules). It only works while the receiver has a satellite fix.')),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')), ' ',
				E('button', { 'class': 'btn cbi-button-action', 'click': function() {
					ui.showModal(_('Set the router clock'), E('p', { 'class': 'spinning' }, _('Waiting for a GPS time…')));
					fs.exec(HELPER, [ 'settime' ]).then(function(res) {
						var r;
						try { r = JSON.parse(res.stdout || ''); } catch (e) { r = { ok: false, error: (res.stderr || res.stdout || '').trim() }; }
						ui.hideModal();
						if (r.ok)
							ui.addNotification(null, E('p', _('Router clock set from GPS. It was %s %s.').format(dur(Math.abs(r.step)), r.step >= 0 ? _('behind') : _('ahead'))), 'info');
						else
							ui.addNotification(null, E('p', r.error || _('failed')), 'danger');
						return call().then(function(st) { self.last = st; self.draw(st); });
					});
				} }, _('Set clock'))
			])
		]);
	},

	draw: function(st) {
		var sp = this.storedPos(), live = st && st.ok !== false && st.lat != null && st.lon != null;
		if (live)
			updateMap(this, st.lat, st.lon);
		else if (sp)
			updateMap(this, sp.lat, sp.lon, _('Last known position (%s), not a live fix. Map tiles are loaded by your browser from openstreetmap.org.')
				.format(sp.source == 'fix' ? (sp.saved ? _('last satellite fix, %s').format(new Date(sp.saved * 1000).toLocaleString()) : _('last satellite fix')) : _('entered by hand')));
		else
			updateMap(this, null, null);
		var v = E('div');
		v.appendChild(E('h2', _('GPS')));
		v.appendChild(E('div', { 'class': 'cbi-map-descr' },
			_('Live data from the GPS receiver built into the Gemtek W1700K (Airoha AG3352 on /dev/ttyS2). This page only listens, apart from a single version query to the receiver once per boot; it changes no receiver setting. It needs a view of the sky: indoors there is usually no fix.')));

		if (!st || st.ok === false) {
			v.appendChild(E('p', { 'class': 'alert-message warning' }, (st && st.error) || _('The helper did not answer.')));
			this.box.replaceChildren(v);
			return;
		}

		var state;
		if (st.sentences == 0) state = badge(_('no data'), 'warning');
		else if (st.fix && st.fix_type >= 3) state = badge(_('3D fix'), 'success');
		else if (st.fix && st.fix_type == 2) state = badge(_('2D fix'), 'success');
		else state = badge(_('no fix'), 'warning');

		var t = E('div', { 'class': 'table' });
		t.appendChild(row(_('Status'), [ state, _('%d satellites used, %d in view').format(st.sats_used, st.sats_in_view) ]));
		if (st.warning)
			t.appendChild(row(_('Problem'), E('span', { 'class': 'alert-message warning' }, st.warning)));

		var hasPos = st.lat != null && st.lon != null;
		if (hasPos) {
			t.appendChild(row(_('Position'), [
				'%s, %s'.format(st.lat.toFixed(6), st.lon.toFixed(6)), ' ',
				E('a', { 'href': 'https://www.openstreetmap.org/?mlat=%s&mlon=%s#map=17/%s/%s'.format(st.lat, st.lon, st.lat, st.lon), 'target': '_blank', 'rel': 'noreferrer' }, _('(map)'))
			]));
			t.appendChild(row(_('Altitude'), st.alt != null ? fmt(st.alt, 1, 'm') + (st.geoid != null ? _(' (geoid separation %s m)').format(st.geoid) : '') : '-'));
			t.appendChild(row(_('Speed / course'), '%s / %s'.format(fmt(st.speed_kmh, 1, 'km/h'), st.course != null ? st.course.toFixed(0) + '°' : '-')));
		} else {
			t.appendChild(row(_('Position'), sp ? [ _('no live position'), ' · ', _('last known: %s, %s').format(sp.lat.toFixed(6), sp.lon.toFixed(6)) ] : _('no position yet')));
		}
		t.appendChild(row(_('Time from GPS (UTC)'), st.time ? (st.date ? st.date + ' ' : '') + st.time + ' UTC' : '-'));
		if (st.local)
			t.appendChild(row(_('Time from GPS (router timezone)'),
				'%s %s %s (UTC%s)'.format(st.local.date, st.local.time, st.local.zone, st.local.offset.replace(/(\d\d)(\d\d)$/, '$1:$2'))));
		var off = st.clock_offset, cmp;
		if (off == null)
			cmp = _('compared with GPS time as soon as there is a fix');
		else if (Math.abs(off) <= 3)
			cmp = _('matches GPS time (to about ±2 s)');
		else
			cmp = off < 0 ? _('%s ahead of GPS time').format(dur(-off)) : _('%s behind GPS time').format(dur(off));
		t.appendChild(row(_('Router clock'), [
			E('span', { 'style': 'margin-right:1em' }, cmp),
			E('button', { 'class': 'btn cbi-button-action', 'disabled': st.fix ? null : '', 'click': ui.createHandlerFn(this, 'setClock') }, _('Set clock from GPS'))
		]));
		if (st.time && !st.fix)
			t.appendChild(row('', E('em', _('No satellite fix: this time comes from the receiver\'s own backup clock and may be stale or wrong.'))));
		t.appendChild(row(_('Precision (DOP)'), 'HDOP %s · VDOP %s · PDOP %s'.format(fmt(st.hdop, 1), fmt(st.vdop, 1), fmt(st.pdop, 1))));

		var sys = Object.keys(st.systems || {}).sort().map(function(k) { return '%s %d'.format(k, st.systems[k]); });
		t.appendChild(row(_('Satellites in view'), sys.length ? sys.join(' · ') : '0'));
		t.appendChild(row(_('Receiver'), '%s @ %d baud'.format(st.device, st.baud)));
		if (this.info && this.info.ok)
			t.appendChild(row(_('Receiver firmware'), this.info.firmware + (this.info.build_date ? _(' (built %s)').format(this.info.build_date) : '')));
		else if (this.info)
			t.appendChild(row(_('Receiver firmware'), E('em', this.info.error || _('unknown'))));
		else
			t.appendChild(row(_('Receiver firmware'), E('em', _('asking the receiver…'))));
		this.shareRows(t);
		v.appendChild(t);

		/* antenna placement check */
		var chk = antennaChecks(st, this.sky), mark = { ok: ['✔', '#4caf50'], warn: ['▲', '#ff9800'], bad: ['✖', '#e53935'], info: ['ℹ', '#9e9e9e'] };
		v.appendChild(E('h3', _('Antenna check')));
		v.appendChild(E('ul', { 'style': 'list-style:none;padding-left:0;margin:.3em 0' }, chk.map(function(c) {
			return E('li', { 'style': 'margin:.25em 0' }, [ E('span', { 'style': 'color:' + mark[c.lvl][1] + ';margin-right:.5em' }, mark[c.lvl][0]), c.text ]);
		})));

		/* satellite table */
		var sats = st.satellites || [];
		if (sats.length) {
			var tbl = E('table', { 'class': 'table cbi-section-table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, _('System')), E('th', { 'class': 'th' }, _('PRN')),
					E('th', { 'class': 'th' }, _('Elevation')), E('th', { 'class': 'th' }, _('Azimuth')),
					E('th', { 'class': 'th' }, _('SNR (dB-Hz)')), E('th', { 'class': 'th' }, _('Used'))
				])
			]);
			sats.forEach(function(s) {
				tbl.appendChild(E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td' }, s.system), E('td', { 'class': 'td' }, String(s.prn)),
					E('td', { 'class': 'td' }, s.elevation != null ? s.elevation + '°' : '-'),
					E('td', { 'class': 'td' }, s.azimuth != null ? s.azimuth + '°' : '-'),
					E('td', { 'class': 'td' }, [ s.snr != null ? String(s.snr) : '-', snrBar(s.snr, s.used) ]),
					E('td', { 'class': 'td' }, s.used ? _('yes') : '')
				]));
			});
			v.appendChild(E('h3', _('Satellites')));
			v.appendChild(E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:1.5em;align-items:flex-start' }, [ skyPlot(sats), E('div', { 'style': 'flex:1;min-width:320px;overflow-x:auto' }, tbl) ]));
		}

		/* raw NMEA of the last read */
		v.appendChild(E('details', { 'style': 'margin-top:1em' }, [
			E('summary', _('Last NMEA sentences')),
			E('pre', {}, (st.raw || []).join('\n'))
		]));

		this.box.replaceChildren(v);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
