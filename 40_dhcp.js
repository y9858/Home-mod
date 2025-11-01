'use strict';
'require baseclass';
'require rpc';
'require uci';
'require network';
'require validation';

const callLuciDHCPLeases = rpc.declare({
	object: 'luci-rpc',
	method: 'getDHCPLeases',
	expect: { '': {} }
});
 
const callUfpList = rpc.declare({
	object: 'fingerprint',
	method: 'fingerprint',
});

return baseclass.extend({
	title: '',

	isMACStatic: {},
	isDUIDStatic: {},

	load() {
		return Promise.all([
			callLuciDHCPLeases(),
			network.getHostHints(),
			L.hasSystemFeature('ufpd') ? callUfpList() : null,
			L.resolveDefault(uci.load('dhcp'))
		]);
	},

	render([dhcp_leases, host_hints, ufp_list]) {
		if (L.hasSystemFeature('dnsmasq') || L.hasSystemFeature('odhcpd'))
			return this.renderLeases(dhcp_leases, host_hints, ufp_list);

		return E([]);
	},

	handleCreateStaticLease(lease, ev) {
		ev.currentTarget.classList.add('spinning');
		ev.currentTarget.disabled = true;
		ev.currentTarget.blur();

		const cfg = uci.add('dhcp', 'host');
		uci.set('dhcp', cfg, 'name', lease.hostname);
		uci.set('dhcp', cfg, 'ip', lease.ipaddr);
		uci.set('dhcp', cfg, 'mac', [lease.macaddr.toUpperCase()]);

		return uci.save()
			.then(L.bind(L.ui.changes.init, L.ui.changes))
			.then(L.bind(L.ui.changes.displayChanges, L.ui.changes));
	},

	handleCreateStaticLease6(lease, ev) {
		ev.currentTarget.classList.add('spinning');
		ev.currentTarget.disabled = true;
		ev.currentTarget.blur();

		const cfg = uci.add('dhcp', 'host');
		const ip6addr = lease.ip6addrs?.[0]?.replace(/\/128$/, '');
		const ip6arr = ip6addr ? validation.parseIPv6(ip6addr) : null;

		// Combine DUID and IAID if both available
		let duid_iaid = lease.duid ? lease.duid.toUpperCase() : null;
		if (duid_iaid && lease.iaid)
			duid_iaid += `%${lease.iaid}`;

		uci.set('dhcp', cfg, 'name', lease.hostname);
		uci.set('dhcp', cfg, 'duid', duid_iaid);
		uci.set('dhcp', cfg, 'mac', [lease.macaddr]);
		if (ip6arr)
			uci.set('dhcp', cfg, 'hostid', (ip6arr[6] * 0xFFFF + ip6arr[7]).toString(16));

		return uci.save()
			.then(L.bind(L.ui.changes.init, L.ui.changes))
			.then(L.bind(L.ui.changes.displayChanges, L.ui.changes));
	},

	renderLeases(dhcp_leases, host_hints, macaddr) {
		const leases = Array.isArray(dhcp_leases.dhcp_leases) ? dhcp_leases.dhcp_leases : [];
		const leases6 = Array.isArray(dhcp_leases.dhcp6_leases) ? dhcp_leases.dhcp6_leases : [];
		if (leases.length == 0 && leases6.length == 0)
			return E([]);
		const machints = host_hints.getMACHints(false);
		const hosts = uci.sections('dhcp', 'host');
		const isReadonlyView = !L.hasViewPermission();

		for (const host of uci.sections('dhcp', 'host')) {

			if (host.mac) {
				for (const mac of L.toArray(host.mac).map(m => m.toUpperCase())) {
					this.isMACStatic[mac] = true;
				}
			}
			if (host.duid) {
				if (Array.isArray(host.duid)){
					host.duid.map(m => {
						m.toUpperCase();
						this.isDUIDStatic[m] = true;
					})
				} else {
					this.isDUIDStatic[host.duid.toUpperCase()] = true;
				}
			}
		};

		const table = E('table', { 'id': 'status_leases', 'class': 'table lases' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Hostname')),
				E('th', { 'class': 'th' }, _('IPv4 address')),
				E('th', { 'class': 'th' }, _('MAC address')),
				E('th', { 'class': 'th' }, _('DUID')),
				E('th', { 'class': 'th' }, _('Lease time remaining'))
			])
		]);

		cbi_update_table(table, leases.map(L.bind(function(lease) {
			let exp;
			let vendor;

			if (lease.expires === false)
				exp = E('em', _('unlimited'));
			else if (lease.expires <= 0)
				exp = E('em', _('expired'));
			else
				exp = '%t'.format(lease.expires);

			const hint = lease.macaddr ? machints.filter(function(h) { return h[0] == lease.macaddr })[0] : null;
			let host = null;

			if (hint && lease.hostname && lease.hostname != hint[1])
				host = '%s (%s)'.format(lease.hostname, hint[1]);
			else if (lease.hostname)
				host = lease.hostname;

			if (macaddr)
				vendor = macaddr[lease.macaddr.toLowerCase()]?.vendor ?? null;

			const columns = [
				host || '-',
				lease.ipaddr,
				vendor ? lease.macaddr + ` (${vendor})` : lease.macaddr,
				lease.duid ? lease.duid : null,
				exp,
			];

			if (!isReadonlyView && lease.macaddr != null) {
				columns.push(E('button', {
					'class': 'cbi-button cbi-button-apply',
					'click': L.bind(this.handleCreateStaticLease, this, lease),
					'data-tooltip': _('Reserve a specific IP address for this device'),
					'disabled': this.isMACStatic[lease.macaddr.toUpperCase()]
				}, [ _('Reserve IP') ]));
			}

			return columns;
		}, this)), E('em', _('There are no active leases')));

		const table6 = E('table', { 'id': 'status_leases6', 'class': 'table leases6' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Host')),
				E('th', { 'class': 'th' }, _('IPv6 addresses')),
				E('th', { 'class': 'th' }, _('DUID')),
				E('th', { 'class': 'th' }, _('IAID')),
				E('th', { 'class': 'th' }, _('Lease time remaining'))
			])
		]);

		cbi_update_table(table6, leases6.map(L.bind(function(lease) {
			let exp;

			if (lease.expires === false)
				exp = E('em', _('unlimited'));
			else if (lease.expires <= 0)
				exp = E('em', _('expired'));
			else
				exp = '%t'.format(lease.expires);

			const hint = lease.macaddr ? machints.filter(function(h) { return h[0] == lease.macaddr })[0] : null;
			let host = null;

			if (hint && lease.hostname && lease.hostname != hint[1] && lease.ip6addr != hint[1])
				host = '%s (%s)'.format(lease.hostname, hint[1]);
			else if (lease.hostname)
				host = lease.hostname;
			else if (hint)
				host = hint[1];

			const columns = [
				host || '-',
				lease.ip6addrs ? lease.ip6addrs.join('<br />') : lease.ip6addr,
				lease?.duid,
				lease?.iaid,
				exp
			];

			if (!isReadonlyView && lease.duid) {
				columns.push(E('button', {
					'class': 'cbi-button cbi-button-apply',
					'click': L.bind(this.handleCreateStaticLease6, this, lease),
					'data-tooltip': _('Reserve a specific IP address for this device'),
					'disabled': this.isDUIDStatic[lease?.duid?.toUpperCase()]
				}, [ _('Reserve IP') ]));
			}

			return columns;
		}, this)), E('em', _('There are no active leases')));

		return E([
			E('h3', _('Active DHCP Leases')),
			table,
			E('h3', _('Active DHCPv6 Leases')),
			table6
		]);
	},

});
