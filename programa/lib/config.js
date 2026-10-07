'use strict';
// Lee config.json (la carpeta principal del farmeador) y revisa que los valores tengan sentido.

const fs = require('fs');

const PREDETERMINADA = {
	horasMinimas: 3,
	minutosEntreRevisiones: 15,
	horasMaximasSinCromo: 5,
	aparecerEnLinea: false,
	excluir: [],
	soloEstos: [],
};

// Valores internos que no aparecen en config.json
const INTERNOS = {
	segundosTrasJugar: 60,
};

const AYUDA = 'Cambia los valores y guarda el archivo. Qué hace cada opción: mira README.md';

class ErrorDeConfig extends Error {}

function numero(valor, nombre, min, max) {
	if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < min || valor > max) {
		throw new ErrorDeConfig(`"${nombre}" debe ser un número entre ${min} y ${max} (tiene: ${JSON.stringify(valor)}).`);
	}
	return valor;
}

function listaDeAppids(valor, nombre) {
	if (!Array.isArray(valor)) throw new ErrorDeConfig(`"${nombre}" debe ser una lista entre corchetes, por ejemplo [440, 730].`);
	return valor.map((v) => {
		const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
		if (!Number.isInteger(n) || n <= 0) {
			throw new ErrorDeConfig(`En "${nombre}" hay un valor que no es un número de juego (AppID): ${JSON.stringify(v)}.`);
		}
		return n;
	});
}

function lineaDelError(texto, mensaje) {
	const m = /position (\d+)/.exec(mensaje);
	if (!m) return '';
	return ` (cerca de la línea ${texto.slice(0, Number(m[1])).split('\n').length})`;
}

function cargarConfig(ruta) {
	if (!fs.existsSync(ruta)) {
		fs.writeFileSync(ruta, JSON.stringify({ _ayuda: AYUDA, ...PREDETERMINADA }, null, 2) + '\n');
		return { ...PREDETERMINADA, ...INTERNOS };
	}

	const texto = fs.readFileSync(ruta, 'utf8').replace(/^﻿/, ''); // el Bloc de notas a veces agrega un BOM
	let datos;
	try {
		datos = JSON.parse(texto);
	} catch (e) {
		throw new ErrorDeConfig(`config.json tiene un error de escritura${lineaDelError(texto, e.message)}. Revisa comas, comillas y corchetes, o bórralo para volver a los valores de fábrica.`);
	}
	if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
		throw new ErrorDeConfig('config.json no tiene el formato esperado. Bórralo para volver a los valores de fábrica.');
	}

	const c = { ...PREDETERMINADA, ...INTERNOS };
	for (const [clave, valor] of Object.entries(datos)) {
		if (clave.startsWith('_')) continue; // comentarios
		switch (clave) {
			case 'horasMinimas':
				c.horasMinimas = numero(valor, clave, 0, 24);
				break;
			case 'minutosEntreRevisiones':
				c.minutosEntreRevisiones = numero(valor, clave, 5, 60);
				break;
			case 'horasMaximasSinCromo':
				c.horasMaximasSinCromo = numero(valor, clave, 1, 24);
				break;
			case 'aparecerEnLinea':
				if (typeof valor !== 'boolean') throw new ErrorDeConfig('"aparecerEnLinea" debe ser true o false (sin comillas).');
				c.aparecerEnLinea = valor;
				break;
			case 'excluir':
			case 'soloEstos':
				c[clave] = listaDeAppids(valor, clave);
				break;
			default:
				throw new ErrorDeConfig(`config.json tiene una opción que no conozco: "${clave}". Revisa que esté bien escrita.`);
		}
	}
	return c;
}

module.exports = { cargarConfig, ErrorDeConfig, PREDETERMINADA };
