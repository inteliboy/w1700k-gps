// Shared by w1700k-gps (the helper) and w1700k-gps-serve (the daemon): NMEA checksum/parse, coordinates, time helpers
// and analyze(), which turns a list of NMEA lines into the one status object the LuCI pages use.
'use strict';
import { popen, readfile } from 'fs';

export function q(s) {
	return "'" + replace('' + s, "'", "'\\''") + "'";
}

export function sh(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p)
		return { out: '', code: 127 };
	let out = p.read('all');
	let code = p.close();
	return { out: out ?? '', code: code };
}

export function num(s) {
	if (s == null || s == '')
		return null;
	let n = +s;
	return (n != n) ? null : n;
}

/* ddmm.mmmm + N/S/E/W -> signed decimal degrees */
export function coord(v, hemi) {
	let n = num(v);
	if (n == null || !hemi)
		return null;
	let d = int(n / 100);
	let r = d + (n - d * 100) / 60;
	if (hemi == 'S' || hemi == 'W')
		r = -r;
	return int(r * 1e7 + (r < 0 ? -0.5 : 0.5)) / 1e7;
}

/* returns the comma split fields of a valid sentence, or null on a bad checksum / partial line */
export function parse(line) {
	line = trim(line);
	if (substr(line, 0, 1) != '$')
		return null;
	let star = index(line, '*');
	if (star < 0 || length(line) < star + 3)
		return null;
	let cs = 0;
	for (let i = 1; i < star; i++)
		cs ^= ord(line, i);
	if (sprintf('%02X', cs) != uc(substr(line, star + 1, 2)))
		return null;
	return split(substr(line, 1, star - 1), ',');
}

/* GSA system id (last field, NMEA 4.10) -> the talker its satellites use in GSV */
const GSA_TALKER = { '1': 'GP', '2': 'GL', '3': 'GA', '4': 'GB', '5': 'GQ', '6': 'GI' };
/* GPS UTC date (YYYY-MM-DD) + time (HH:MM:SS) -> the same instant in the router's configured timezone
   (/etc/TZ, set by system.@system[0].timezone). Display only: the system clock is never touched. */
export function local_time(date, time) {
	let d = split(date, '-'), t = split(time, ':');
	let ep = timegm({ year: +d[0], mon: +d[1], mday: +d[2], hour: +t[0], min: +t[1], sec: +t[2] });
	if (ep == null)
		return null;
	let tz = trim(readfile('/etc/TZ') ?? '');
	let r = sh((tz != '' ? 'TZ=' + q(tz) + ' ' : '') + 'date -d @' + ep + " '+%Y-%m-%d %H:%M:%S|%Z|%z'");
	if (r.code != 0)
		return null;
	let p = split(trim(r.out), '|');
	if (length(p) != 3)
		return null;
	let dt = split(p[0], ' ');
	return { date: dt[0], time: dt[1], zone: p[1], offset: p[2] };
}

/* GPS UTC date (YYYY-MM-DD) + time (HH:MM:SS) -> unix epoch, or null */
export function gps_epoch(date, time) {
	let d = split(date, '-'), t = split(time, ':');
	return timegm({ year: +d[0], mon: +d[1], mday: +d[2], hour: +t[0], min: +t[1], sec: +t[2] });
}

/* anything before 2025-01-01 is a receiver backup-clock default or a week rollover, not a time to trust */
export const MIN_EPOCH = 1735689600;

const SYSTEMS = { GP: 'GPS', GL: 'GLONASS', GA: 'Galileo', GB: 'BeiDou', BD: 'BeiDou', GQ: 'QZSS', GI: 'NavIC' };

/* lines: raw NMEA text lines (junk before '$' tolerated) -> status object (no device/baud/warning fields) */
export function analyze(lines, nolocal) {
	let o = {
		ok: true, sentences: 0,
		fix: false, fix_type: 1, quality: 0,
		time: null, date: null, lat: null, lon: null, alt: null, geoid: null,
		speed_kmh: null, course: null, pdop: null, hdop: null, vdop: null,
		sats_used: 0, sats_in_view: 0, systems: {}, satellites: [], raw: []
	};
	let seen = {}, used = {};

	for (let l in lines) {
		/* a partial line at the start of the read can leave junk before the '$' */
		let at = index(l, '$');
		if (at > 0)
			l = substr(l, at);
		let f = parse(l);
		if (!f)
			continue;
		o.sentences++;
		push(o.raw, trim(l));
		let id = substr(f[0], 2);
		let talker = substr(f[0], 0, 2);
		if (talker == 'BD')
			talker = 'GB';
		if (id == 'GGA') {
			o.quality = int(num(f[6]) ?? 0);
			let la = coord(f[2], f[3]), lo = coord(f[4], f[5]);
			if (o.quality > 0 && la != null && lo != null) {
				o.lat = la;
				o.lon = lo;
				o.alt = num(f[9]);
				o.geoid = num(f[11]);
			}
			let t = f[1];
			if (length(t) >= 6)
				o.time = substr(t, 0, 2) + ':' + substr(t, 2, 2) + ':' + substr(t, 4, 2);
		} else if (id == 'RMC') {
			o.fix = f[2] == 'A';
			if (length(f[9]) == 6)
				o.date = '20' + substr(f[9], 4, 2) + '-' + substr(f[9], 2, 2) + '-' + substr(f[9], 0, 2);
			if (o.fix) {
				let la = coord(f[3], f[4]), lo = coord(f[5], f[6]);
				if (la != null && lo != null) {
					o.lat = la;
					o.lon = lo;
				}
				let kn = num(f[7]);
				o.speed_kmh = kn == null ? null : int(kn * 1.852 * 10 + 0.5) / 10.0;
				o.course = num(f[8]);
			}
			let t = f[1];
			if (length(t) >= 6)
				o.time = substr(t, 0, 2) + ':' + substr(t, 2, 2) + ':' + substr(t, 4, 2);
		} else if (id == 'GSA') {
			let ft = int(num(f[2]) ?? 1);
			if (ft > o.fix_type)
				o.fix_type = ft;
			for (let i = 3; i <= 14; i++)
				if (f[i] != null && f[i] != '')
					used[(talker == 'GN' ? (GSA_TALKER[f[18]] ?? 'GP') : talker) + f[i]] = true;
			o.pdop = num(f[15]) ?? o.pdop;
			o.hdop = num(f[16]) ?? o.hdop;
			o.vdop = num(f[17]) ?? o.vdop;
		} else if (id == 'GSV') {
			let sys = SYSTEMS[talker] ?? talker;
			let inview = int(num(f[3]) ?? 0);
			/* one GSV group per signal band; keep the largest in-view count per system */
			if (inview > (o.systems[sys] ?? 0))
				o.systems[sys] = inview;
			for (let i = 4; i + 3 < length(f); i += 4) {
				if (f[i] == '')
					continue;
				let key = talker + f[i];
				let snr = num(f[i + 3]);
				if (seen[key] == null || (snr ?? 0) > (seen[key].snr ?? 0))
					seen[key] = { system: sys, prn: int(num(f[i])), elevation: num(f[i + 1]), azimuth: num(f[i + 2]), snr: snr };
			}
		}
	}
	for (let k in seen) {
		seen[k].used = used[k] == true;
		push(o.satellites, seen[k]);
	}
	o.satellites = sort(o.satellites, (a, b) => (b.snr ?? -1) - (a.snr ?? -1));
	for (let k in used)
		o.sats_used++;
	for (let k in o.systems)
		o.sats_in_view += o.systems[k];
	if (o.date && o.time && !nolocal)
		o.local = local_time(o.date, o.time);
	let su = 0, sn = 0;
	for (let sat in o.satellites)
		if (sat.used && sat.snr) {
			su += sat.snr;
			sn++;
		}
	o.snr_avg = sn ? int(su / sn * 10 + 0.5) / 10.0 : null;
	/* system clock minus GPS clock is -clock_offset; only meaningful with a fix. The sentences were read over
	   ~2 s, so it is good to about +-2 s. */
	if (o.fix && o.date && o.time) {
		let ep = gps_epoch(o.date, o.time);
		if (ep != null && ep >= MIN_EPOCH) {
			o.epoch = ep;
			o.clock_offset = ep - time();
		}
	}
	o.raw = slice(o.raw, -12);
	return o;
}
