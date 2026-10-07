'use strict';
// Steam simulado para probar el farmeador sin una cuenta real:
//  - SteamFalso: imita a steam-user (eventos loggedOn, playingState, newItems, webSession...)
//  - servidorWeb: imita steamcommunity.com (/my/badges y /my/gamecards) con el HTML de Steam
//  - relojRapido: 1 hora simulada = (1000 / velocidad) ms reales

const { EventEmitter } = require('events');
const http = require('http');

const STEAMID = '76561198000000001';
const EResult = require('../programa/node_modules/steam-user').EResult;

function relojRapido(velocidad) {
	const inicioReal = Date.now();
	const inicioSim = Date.UTC(2026, 8, 26, 12, 0, 0);
	return {
		ahora: () => inicioSim + (Date.now() - inicioReal) * velocidad,
		programar: (fn, ms) => setTimeout(fn, ms / velocidad),
		cancelar: (t) => clearTimeout(t),
		dormir: (ms) => new Promise((r) => setTimeout(r, ms / velocidad)),
	};
}

function error(eresult) {
	const e = new Error(EResult[eresult]);
	e.eresult = eresult;
	return e;
}

function llaveFalsa(n) {
	const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
	return `${b64({ alg: 'EdDSA', typ: 'JWT' })}.${b64({ iss: 'steam', sub: STEAMID, aud: ['client', 'web'], exp: Math.floor(Date.now() / 1000) + 86400 * 200, n })}.firma`;
}

class SteamFalso extends EventEmitter {
	constructor(cuenta, reloj) {
		super();
		this.cuenta = cuenta;
		this.reloj = reloj;
		this.steamID = null;
		this.bloqueado = false;
		this.jugando = [];
		this.llamadas = []; // cada gamesPlayed: { apps, force, t, conectado, bloqueado }
		this.items = 0;
		this.llavesEmitidas = 0;
		this.maxJugandoALaVez = 0;
		this.opciones = {}; // lo que se cambie con setOption (por ejemplo, la carpeta de datos)
		this._ultimo = reloj.ahora();
		this._tick = setInterval(() => this._avanzar(), 60000 / cuenta.velocidad); // cada minuto simulado
	}

	destruir() {
		clearInterval(this._tick);
	}

	// ---- API de steam-user ----
	logOn(d) {
		setImmediate(() => this._logOn(d));
	}

	_logOn(d) {
		const c = this.cuenta;
		if (d.logonID === undefined || d.machineName === undefined) throw new Error('falta logonID/machineName');
		if (d.refreshToken) {
			if (d.accountName || d.password) throw new Error('Cannot specify account_name when logging in with a refresh token');
			if (d.refreshToken !== c.llaveValida) return this.emit('error', error(EResult.AccessDenied));
			return this._entrar(false);
		}
		if (d.accountName !== c.usuario || d.password !== c.contrasena) return this.emit('error', error(EResult.InvalidPassword));
		if (!c.codigoGuard) return this._entrar(true);
		const pedir = (malo) =>
			this.emit('steamGuard', c.guardPorCorreo ? 'gmail.com' : null, (codigo) => {
				if (codigo === c.codigoGuard) this._entrar(true);
				else setImmediate(() => pedir(true));
			}, malo);
		pedir(false);
	}

	_entrar(conContrasena) {
		const c = this.cuenta;
		this.steamID = { getSteamID64: () => STEAMID };
		if (conContrasena) {
			c.llaveValida = llaveFalsa(++this.llavesEmitidas);
			this.emit('refreshToken', c.llaveValida);
		}
		this.emit('loggedOn', {});
		setTimeout(() => this._darSesionWeb(), 5);
		if (this.bloqueado) setTimeout(() => this.emit('playingState', true, 730), 5);
	}

	_darSesionWeb() {
		if (!this.steamID) return;
		this.emit('webSession', 'sid123', [`sessionid=sid123`, `steamLoginSecure=${this.cuenta.cookie}`]);
	}

	webLogOn() {
		this.cuenta.renovacionesWeb = (this.cuenta.renovacionesWeb || 0) + 1;
		this.cuenta.cookie = `cookie${Math.random().toString(36).slice(2)}`;
		setTimeout(() => this._darSesionWeb(), 5);
	}

	gamesPlayed(apps, force) {
		const lista = [].concat(apps).map(Number);
		this.llamadas.push({ apps: lista, force: Boolean(force), t: this.reloj.ahora(), conectado: Boolean(this.steamID), bloqueado: this.bloqueado });
		if (!this.steamID) return;
		if (this.bloqueado && !force) return; // Steam lo ignora
		this._avanzar();
		this.jugando = lista;
		this.maxJugandoALaVez = Math.max(this.maxJugandoALaVez, lista.length);
		setImmediate(() => this.emit('playingState', false, lista[0] || 0));
	}

	setPersona(estado) {
		this.persona = estado;
	}

	setOption(nombre, valor) {
		this.opciones[nombre] = valor;
	}

	logOff() {
		this._avanzar();
		this.steamID = null;
		this.jugando = [];
		setTimeout(() => this.emit('disconnected', 0, 'Logged off'), 2);
	}

	// ---- controles para las pruebas ----
	usuarioEmpiezaAJugar() {
		this._avanzar();
		this.bloqueado = true;
		this.jugando = [];
		this.emit('playingState', true, 730);
	}

	usuarioDejaDeJugar() {
		this._avanzar();
		this.bloqueado = false;
		this.emit('playingState', false, 0);
	}

	cortarConexion(msSimulados) {
		this._avanzar();
		this.steamID = null;
		this.jugando = [];
		this.emit('disconnected', EResult.NoConnection, 'NoConnection');
		setTimeout(() => this._entrar(false), msSimulados / this.cuenta.velocidad);
	}

	// ---- simulación del paso del tiempo ----
	_avanzar() {
		const ahora = this.reloj.ahora();
		const dt = (ahora - this._ultimo) / 3600000; // horas
		this._ultimo = ahora;
		if (!this.steamID || this.bloqueado || !this.jugando.length) return;
		for (const appid of this.jugando) {
			const j = this.cuenta.juegos.get(appid);
			if (j) j.horas += dt;
		}
		if (this.jugando.length !== 1) return; // jugando varios a la vez no caen cromos
		const j = this.cuenta.juegos.get(this.jugando[0]);
		if (!j || j.restantes <= 0 || j.privado || j.horas < this.cuenta.horasRestriccion) return;
		j.progreso = (j.progreso || 0) + dt;
		const cada = (j.minutosPorCromo || 30) / 60;
		while (j.progreso >= cada && j.restantes > 0) {
			j.progreso -= cada;
			j.restantes--;
			j.recibidos = (j.recibidos || 0) + 1;
			this.items++;
			this.cuenta.caidas.push({ appid: j.appid, t: ahora, jugandoALaVez: this.jugando.length });
			this.emit('newItems', this.items);
		}
	}
}

// ---------- HTML con la misma estructura que steamcommunity.com ----------

function filaJuego(j) {
	const horas = j.horas >= 0.05 ? `&nbsp;&nbsp;&nbsp;${j.horas.toLocaleString('en-US', { maximumFractionDigits: 1 })} hrs on record` : '&nbsp;';
	const r = j.restantesEnInsignias ?? j.restantes;
	const progreso = r > 0 ? `${r} card drop${r === 1 ? '' : 's'} remaining` : 'No card drops remaining';
	const cuerpo = r > 0 ? `You can get ${r} more trading card${r === 1 ? '' : 's'} by playing ${j.nombre}.` : `You don't have any more drops remaining for ${j.nombre}.`;
	return `
<div class="badge_row is_link">
	<a class="badge_row_overlay" href="https://steamcommunity.com/profiles/${STEAMID}/gamecards/${j.appid}/"></a>
	<div class="badge_row_inner">
		<div class="badge_title_row">
			<div class="badge_title_stats">
				<div class="badge_title_playgame"><a class="btn_green_white_innerfade btn_small_thin" href="steam://run/${j.appid}"><span>Play</span></a></div>
				<div class="badge_title_stats_content">
					<div class="badge_title_stats_playtime">${horas}</div>
					<div class="badge_title_stats_drops">
						<span class="progress_info_bold">${progreso}</span>
						<div style="clear: left;"></div>
						<div class="card_drop_info_dialog" id="card_drop_info_gamebadge_${j.appid}_1_0" style="display: none;">
							<div class="card_drop_info_header">Card drops received: ${j.recibidos || 0}</div>
							<div class="card_drop_info_body">Card drops are earned by playing the game.</div>
							<div class="card_drop_info_header">Card drops remaining: ${r}</div>
							<div class="card_drop_info_body">${cuerpo}</div>
						</div>
					</div>
				</div>
			</div>
			<div class="badge_title">
				${j.nombre}&nbsp;<span class="badge_view_details">View details</span>
			</div>
		</div>
		<div class="badge_current"><div class="badge_empty_circle"></div></div>
		<div style="clear: both"></div>
	</div>
</div>`;
}

const FILA_INSIGNIA_NORMAL = `
<div class="badge_row is_link">
	<a class="badge_row_overlay" href="https://steamcommunity.com/profiles/${STEAMID}/badges/13"></a>
	<div class="badge_row_inner">
		<div class="badge_title_row"><div class="badge_title">Game Collector&nbsp;<span class="badge_view_details">View details</span></div></div>
		<div class="badge_content"><div class="badge_info_description"><div class="badge_info_title">Game Collector</div><div>Level 3, 150 XP</div></div></div>
	</div>
</div>`;

function paginaInsignias(cuenta, p, conSesion) {
	const todos = [...cuenta.juegos.values()];
	const porPagina = cuenta.juegosPorPagina || 4;
	const paginas = Math.max(1, Math.ceil(todos.length / porPagina));
	const filas = todos.slice((p - 1) * porPagina, p * porPagina).map(filaJuego).join('\n');
	const enlaces = Array.from({ length: paginas }, (_, i) => (i + 1 === p ? `<span class="pagelink">${i + 1}</span>` : `<a class="pagelink" href="?p=${i + 1}">${i + 1}</a>`)).join('&nbsp;');
	return `<!DOCTYPE html><html><head><title>Steam Community :: Badges</title>
<script type="text/javascript">
	g_sessionID = "sid123";
	g_steamID = ${conSesion ? `"${STEAMID}"` : 'false'};
</script></head><body class="flat_page responsive_page">
<div class="profile_small_header_texture"><a class="whiteLink persona_name_text_content" href="#">Jugador</a><span class="profile_small_header_arrow">&raquo;</span><span class="profile_small_header_location">Badges</span></div>
<div class="profile_paging"><div class="pageLinks">${enlaces}</div></div>
<div class="badges_sheet">
${p === 1 ? FILA_INSIGNIA_NORMAL : ''}
${filas}
</div>
<div class="profile_paging"><div class="pageLinks">${enlaces}</div></div>
</body></html>`;
}

function paginaJuego(cuenta, appid) {
	const j = cuenta.juegos.get(appid);
	const r = j ? j.restantes : 0;
	const horas = j && j.horas >= 0.05 ? `&nbsp;&nbsp;${j.horas.toLocaleString('en-US', { maximumFractionDigits: 1 })} hrs on record` : '&nbsp;';
	return `<!DOCTYPE html><html><head><script>g_steamID = "${STEAMID}";</script></head><body>
<div class="profile_small_header_texture">
	<a class="whiteLink persona_name_text_content" href="#">Jugador</a><span class="profile_small_header_arrow">&raquo;</span>
	<a class="whiteLink" href="#">Badges</a><span class="profile_small_header_arrow">&raquo;</span>
	<span class="profile_small_header_location">${j ? j.nombre : 'Unknown'}</span>
</div>
<div class="badge_gamecard_page">
	<div class="badge_title_stats_content">
		<div class="badge_title_stats_playtime">${horas}</div>
		<div class="badge_title_stats_drops"><span class="progress_info_bold">${r > 0 ? `${r} card drop${r === 1 ? '' : 's'} remaining` : 'No card drops remaining'}</span></div>
	</div>
	<div class="badge_info_description"><div class="badge_info_title">Badge</div></div>
</div>
</body></html>`;
}

function servidorWeb(cuenta, cliente) {
	const servidor = http.createServer((req, res) => {
		cliente._avanzar();
		cuenta.pedidos = (cuenta.pedidos || 0) + 1;
		const url = new URL(req.url, 'http://local');
		const conSesion = (req.headers.cookie || '').includes(`steamLoginSecure=${cuenta.cookie}`);
		if (cuenta.fallarProximas > 0) {
			cuenta.fallarProximas--;
			cuenta.fallosServidos = (cuenta.fallosServidos || 0) + 1;
			res.writeHead(502);
			return res.end('Bad gateway');
		}
		let m;
		if (url.pathname === '/my/badges') {
			res.writeHead(302, { Location: conSesion ? `/profiles/${STEAMID}/badges?${url.searchParams}` : `/login/home/?goto=%2Fmy%2Fbadges` });
			return res.end();
		}
		if ((m = /^\/my\/gamecards\/(\d+)$/.exec(url.pathname))) {
			res.writeHead(302, { Location: conSesion ? `http://${req.headers.host}/profiles/${STEAMID}/gamecards/${m[1]}/?l=english` : `/login/home/?goto=%2Fmy%2Fgamecards` });
			return res.end();
		}
		if (url.pathname === `/profiles/${STEAMID}/badges`) {
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			return res.end(paginaInsignias(cuenta, Number(url.searchParams.get('p') || 1), conSesion));
		}
		if ((m = /^\/profiles\/\d+\/gamecards\/(\d+)\/$/.exec(url.pathname))) {
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			return res.end(conSesion ? paginaJuego(cuenta, Number(m[1])) : paginaInsignias(cuenta, 1, false));
		}
		res.writeHead(404);
		res.end('no');
	});
	return new Promise((resolve) => servidor.listen(0, '127.0.0.1', () => resolve(servidor)));
}

function crearCuenta({ juegos, horasRestriccion = 0, velocidad = 3600, ...resto }) {
	return {
		velocidad,
		horasRestriccion,
		cookie: 'cookieinicial',
		caidas: [],
		juegos: new Map(juegos.map((j) => [j.appid, { horas: 0, restantes: 0, ...j }])),
		...resto,
	};
}

module.exports = { SteamFalso, servidorWeb, crearCuenta, relojRapido, paginaInsignias, paginaJuego, filaJuego, STEAMID };
