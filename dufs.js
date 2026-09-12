'use strict';
'require form';
'require poll';
'require rpc';
'require uci';
'require view';
const callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: ['name'],
	expect: {
		'': {}
	}
});

function getServiceStatus() {
	return L.resolveDefault(callServiceList('dufs'), {}).then(function(res) {
		let isRunning = false;
		try {
			isRunning = res['dufs']['instances']['dufs']['running'];
		} catch (e) {}
		return isRunning;
	});
}

function renderStatus(isRunning, port, path, useSSL, certPath, keyPath) {
	let spanTemp = '<em><span style="color:%s"><strong>%s %s</strong></span></em>';
	let renderHTML;
	if (isRunning) {
		let protocol = 'http';
		if (useSSL === '1' && certPath && certPath.trim() !== '' && keyPath && keyPath.trim() !== '') {
			protocol = 'https';
		}
		let dufsURL = protocol + '://' + window.location.hostname + ':' + port + '/' + path.replace(/^\//, '');
		let button = String.format('&#160;<a class="btn cbi-button" href="%s" target="_blank" rel="noreferrer noopener">%s</a>', dufsURL, _('Open Web Interface'));
		renderHTML = spanTemp.format('green', _('Dufs'), _('RUNNING')) + button;
	} else {
		renderHTML = spanTemp.format('red', _('Dufs'), _('NOT RUNNING'));
	}
	return renderHTML;
}
return view.extend({
	load() {
		return Promise.all([uci.load('dufs')]);
	},
	render(data) {
		let m, s, o;
		let webport = uci.get(data[0], 'config', 'port') || '5000';
		let webpath = uci.get(data[0], 'config', 'path_prefix') || '/';
		let useSSL = uci.get('dufs', 'config', 'ssl') || '0';
		let certPath = uci.get('dufs', 'config', 'tls_cert') || '';
		let keyPath = uci.get('dufs', 'config', 'tls_key') || '';

		m = new form.Map('dufs', _('Dufs'), _('Dufs is a distinctive utility file server that supports static serving, uploading, searching, accessing control, webdav...'));
		s = m.section(form.TypedSection);
		s.anonymous = true;
		s.render = function() {
			poll.add(function() {
				return L.resolveDefault(getServiceStatus()).then(function(res) {
					let view = document.getElementById('service_status');
					view.innerHTML = renderStatus(res, webport, webpath, useSSL, certPath, keyPath);
				});
			});
			return E('div', {
				class: 'cbi-section',
				id: 'status_bar'
			}, [E('p', {
				id: 'service_status'
			}, _('Collecting data…'))]);
		}
		s = m.section(form.NamedSection, 'config', 'dufs');
		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = o.disabled;
		o.rmempty = false;
		o = s.option(form.Value, 'bind', _('Listen address'));
		o.placeholder = '0.0.0.0,::';
		o = s.option(form.Value, 'port', _('Listen port'), _('留空默认5000（可能与 miniupnpd 冲突）'));
		o.datatype = 'port';
		o.placeholder = '5000';
		o = s.option(form.Value, 'path_prefix', _('Path Prefix'), _('Specify a (URL) path prefix'));
		o = s.option(form.Flag, 'enable_cors', _('Enable CORS'));
		o = s.option(form.Flag, 'internet', _('Allow access from Internet'));
		o = s.option(form.Value, 'serve_path', _('Serve path'));
		o.placeholder = '/mnt';
		o = s.option(form.DynamicList, 'hidden', _('Hidden path'), _('Hide paths from directory listings, e.g. %s.').format('<code>tmp,*.log,*.lock</code>'));
		o = s.option(form.DynamicList, 'auth', _('Auth roles'), _('Add auth roles, e.g. %s.').format('<code>user:pass@/dir1:rw,/dir2</code>'));
		o.description += '<br/>' + _("明文密码可用$6$开头的sha512哈希密码代替更安全，如：'user:哈希密码@/tmp:rw'");
		o.description += '<br/>' + _("获取'pass'的哈希密码的命令：%s.").format('<code>openssl passwd -6 pass</code>');
		o = s.option(form.Flag, 'render_index', _('Render index'), _('Serve index.html when requesting a directory, returns 404 if not found index.html.'));
		o.depends('render_try_index', '0');
		o = s.option(form.Flag, 'render_try_index', _('Render index or directory list'), _('Serve index.html when requesting a directory, returns directory listing if not found index.html.'));
		o.default = o.enabled;
		o = s.option(form.Flag, 'allow_all', _('Allow all operations'));
		o = s.option(form.Flag, 'allow_upload', _('Allow upload files/folders'));
		o.depends('allow_all', '0');
		o = s.option(form.Flag, 'allow_delete', _('Allow delete files/folders'));
		o.depends('allow_all', '0');
		o = s.option(form.Flag, 'allow_search', _('Allow search files/folders'));
		o.depends('allow_all', '0');
		o = s.option(form.Flag, 'allow_symlink', _('Allow symlink to files/folders outside root directory'));
		o.depends('allow_all', '0');
		o = s.option(form.Flag, 'allow_archive', _('Allow zip archive generation'));
		o.depends('allow_all', '0');
		o = s.option(form.ListValue, 'compress', _('Zip compression level'));
		o.value('none', _('None'));
		o.value('low', _('Low'));
		o.value('medium', _('Medium'));
		o.value('high', _('High'));
		o.default = 'none';
		o.depends('allow_all', '1');
		o.depends('allow_archive', '1');

		o = s.option(form.Flag, 'allow_hash', _('允许哈希查询'));
		o.depends('allow_all', '0');
		o = s.option(form.Flag, 'render_spa', _('单页应用模式'));
		o = s.option(form.Flag, 'ssl', _('启用SSL'), _('文件路径错误或证书版本太低会无法启动'));
		o = s.option(form.Value, 'tls_cert', _('证书文件路径'));
		o.depends('ssl', '1');
		o = s.option(form.Value, 'tls_key', _('私钥文件路径'));
		o.depends('ssl', '1');
		o = s.option(form.Value, 'assets', _('前端资产目录'), _('即页面主题文件目录，留空使用内置主题'));
		o = s.option(form.Value, 'log_file', _('日志文件路径'), _('把操作日志写入文件；不包含启动错误（在系统日志查看）'));

		return m.render();
	}
});