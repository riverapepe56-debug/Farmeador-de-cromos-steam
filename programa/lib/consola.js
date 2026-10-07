'use strict';
// Mensajes con hora y colores, y preguntas en la consola (la contraseña se escribe con asteriscos).

const readline = require('readline');

const conColor = Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env);
const pintar = (codigo) => (t) => (conColor ? `\x1b[${codigo}m${t}\x1b[0m` : String(t));
const color = {
	gris: pintar('90'),
	verde: pintar('32'),
	verdeFuerte: pintar('1;32'),
	amarillo: pintar('33'),
	rojo: pintar('31'),
	cian: pintar('36'),
	negrita: pintar('1'),
};

// Nada que venga de afuera (nombres de juegos, mensajes de Steam) puede mandar órdenes a la consola
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
function limpiar(texto) {
	return String(texto).replace(CONTROL, '');
}

function hora() {
	const d = new Date();
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function linea(pinta) {
	return (texto) => console.log(`${color.gris(`[${hora()}]`)} ${pinta(limpiar(texto))}`);
}

const log = {
	info: linea((t) => t),
	ok: linea(color.verde),
	cromo: linea(color.verdeFuerte),
	juego: linea(color.cian),
	aviso: linea(color.amarillo),
	error: linea(color.rojo),
	titulo: (t) => {
		process.title = `Farmeador de cromos - ${limpiar(t)}`;
	},
};

let alCtrlC = () => process.exit(130);
function manejarCtrlC(fn) {
	alCtrlC = fn;
}

function preguntar(texto) {
	return new Promise((resolve) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		rl.on('SIGINT', () => {
			rl.close();
			process.stdout.write('\n');
			alCtrlC();
		});
		rl.question(limpiar(texto), (respuesta) => {
			rl.close();
			resolve(respuesta.trim());
		});
	});
}

function preguntarOculto(texto) {
	const entrada = process.stdin;
	if (!entrada.isTTY || typeof entrada.setRawMode !== 'function') {
		log.aviso('Esta ventana no permite ocultar lo que escribes: la contraseña se verá en pantalla.');
		return preguntar(texto);
	}

	return new Promise((resolve) => {
		let valor = '';
		process.stdout.write(texto);
		entrada.setRawMode(true);
		entrada.setEncoding('utf8');
		entrada.resume();

		const terminar = () => {
			entrada.removeListener('data', alEscribir);
			entrada.setRawMode(false);
			entrada.pause();
			process.stdout.write('\n');
		};

		function alEscribir(trozo) {
			for (const letra of String(trozo)) {
				if (letra === '\r' || letra === '\n') {
					terminar();
					resolve(valor);
					return;
				}
				if (letra === '\u0003') {
					terminar();
					alCtrlC();
					return;
				}
				if (letra === '\u0008' || letra === '\u007f') {
					if (valor.length) {
						valor = Array.from(valor).slice(0, -1).join('');
						process.stdout.write('\b \b');
					}
					continue;
				}
				if (letra === '\u001b') break; // flechas y otras teclas especiales: se ignoran
				if (letra < ' ') continue;
				valor += letra;
				process.stdout.write('*');
			}
		}

		entrada.on('data', alEscribir);
	});
}

async function preguntarSiNo(texto, porDefecto = true) {
	const r = (await preguntar(`${texto} ${porDefecto ? '(S/n)' : '(s/N)'}: `)).toLowerCase();
	if (!r) return porDefecto;
	return r.startsWith('s') || r.startsWith('y');
}

module.exports = { log, color, limpiar, preguntar, preguntarOculto, preguntarSiNo, manejarCtrlC };
