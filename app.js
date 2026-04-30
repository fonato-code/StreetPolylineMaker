class Mapa {
	constructor() {
		this.map;
		this.QuantidadeMaximaExibicao = 5;
		this.Novo = true;
		this.Ponto = [];
		this.Marcador = [];
		this.Circulo = [];
		this.kmAtual = 0;
		this.CoordenadaAux = {
			lat: 0, lng: 0
		};
		this.Importacao = [];
		this.Range;
		this.kmAlterado = false;
		this.toogleHistorico = true;
		this.TabelaRaioPadrao = [50, 100, 150, 250, 500];

		$("body").on("keyup", (e) => {
			console.log(e.keyCode);
			if ((e.which || e.keyCode) == 90 && e.ctrlKey) {
				this.voltar();
			}
			if ((e.which || e.keyCode) == 49 && e.altKey) {
				this.IncrementarRaio();
			}
			if ((e.which || e.keyCode) == 50 && e.altKey) {
				this.DecrementarRaio();
			}
			if ((e.which || e.keyCode) == 81 && e.altKey) {
				var raio = parseInt($("#raio").val());
				$("#raio").val((raio + 50) < 500 ? (raio + 50) : 500).trigger("change");
			}
			if ((e.which || e.keyCode) == 87 && e.altKey) {
				var raio = parseInt($("#raio").val());
				$("#raio").val((raio - 50) < 50 ? 50 : (raio - 50)).trigger("change");
			}
		})
	}

	IncrementarRaio() {
		var raio = parseInt($("#raio").val());
		var resultado = this.TabelaRaioPadrao.filter(x => x > raio);
		if (resultado.length > 0) {
			$("#raio").val(resultado[0]).trigger("change");
		}
	}
	DecrementarRaio() {
		var raio = parseInt($("#raio").val());
		var resultado = this.TabelaRaioPadrao.filter(x => x < raio);
		if (resultado.length > 0) {
			$("#raio").val(resultado[resultado.length - 1]).trigger("change");
		}
	}
	exportar(lst) {
		if ((lst || this.Ponto).length > 0) {
			var nomes = Object.keys((lst || this.Ponto)[0]).filter(x => x != "id");
			var dic = {
				"id": "CD_GEOPOSICAO",
				"longitude": "LONGITUDE",
				"latitude": "LATITUDE",
				"km": "KM_METRO",
				"rodovia": "RODOVIA",
				"raio": "RAIO",
				"sentido": "SENTIDO",
				"nome": "NOME",
			};
			$("#banco").val(Array.from((lst || this.Ponto), (linha, i) => `/*-- LINHA ${i + 1}*/ INSERT INTO GEOPOSICAO(${Array.from(nomes, (coluna, i) => `[${dic[coluna].trim()}]${(nomes.length - 1) == i ? "" : ","}`).join("")}) VALUES (${Array.from(nomes, (coluna, i) => `'${linha[coluna] == undefined ? `''''` : linha[coluna]}'${(nomes.length - 1) == i ? "" : ","}`).join("")})`).join("\n"));

			$("#referencia").val(JSON.stringify((lst || this.Ponto)).replace("[", "").replace("]", ",").replace(/\},\{/g, "},\n{"));
		}
	}
	converter(lst) {
		var pontos = divisao(lst || this.Ponto);
		if (pontos.length > 0) {
			var nomes = Object.keys(pontos[0]).filter(x => x != "id");
			var dic = {
				"id": "CD_GEOPOSICAO",
				"longitude": "LONGITUDE",
				"latitude": "LATITUDE",
				"km": "KM_METRO",
				"rodovia": "RODOVIA",
				"raio": "RAIO",
				"sentido": "SENTIDO",
				"nome": "NOME",
			};
			$("#banco").val(Array.from(pontos, (linha, i) => `/*-- LINHA ${i + 1}*/ INSERT INTO GEOPOSICAO(${Array.from(nomes, (coluna, i) => `[${dic[coluna].trim()}]${(nomes.length - 1) == i ? "" : ","}`).join("")}) VALUES (${Array.from(nomes, (coluna, i) => `'${linha[coluna] == undefined ? `''''` : linha[coluna]}'${(nomes.length - 1) == i ? "" : ","}`).join("")})`).join("\n"));

			$("#referencia").val(JSON.stringify(pontos).replace("[", "").replace("]", ",").replace(/\},\{/g, "},\n{"));
		}
		this.importarMarcadores();
	}
	importarMarcadores() {
		var json = $("#referencia").val();
		json = `[${json.substr(0, json.length - 1)}]`;
		var obj = JSON.parse(json);
		obj.forEach((x, i, a) => {
			let o = {
				radius: x.raio
				, icon: this.CorMarcador((parseInt(("" + x.km).split(".")[1] ?? 0) == 0) ? "#ffffff" : "#ff0000")
				, position: {
					lat: x.latitude
					, lng: x.longitude
				}
				, map: this.map
				, title: `${x.rodovia} ${x.sentido} km ${x.km}, raio${x.raio}`
			}
			//this.AdicionarMarcador(o);
			//this.Importacao.push( new google.maps.Marker(o));
			this.Importacao.push(new google.maps.Circle({
				strokeColor: o.icon.strokeColor
				, strokeOpacity: 0.5
				, strokeWeight: o.icon.strokeWeight
				, fillColor: o.icon.fillColor
				, fillOpacity: 0.2
				, map: this.map
				, title: o.title
				, center: {
					lat: o.position.lat
					, lng: o.position.lng
				}
				, radius: parseFloat(o.radius)
			}));
			google.maps.event.addListener(this.Importacao[this.Importacao.length - 1], "click", (e) => {
				this.NovoItem(e);
			});
			google.maps.event.addListener(this.Importacao[this.Importacao.length - 1], "mousemove", function (e) {
				app.Mover(e);
				$("#t3").text(this.get('title'));
			});
			google.maps.event.addListener(this.Importacao[this.Importacao.length - 1], "mouseout", function (e) {
				$("#t3").text("");
			});
		})
	}
	voltar() {
		this.Marcador[this.Marcador.length - 1].setMap(null);
		this.Marcador.pop();
		this.Circulo[this.Circulo.length - 1].setMap(null);
		this.Circulo.pop();
		this.Ponto.pop()
		this.ValidarExibicao(true);
		let p = this.Ponto[this.Ponto.length - 1];
		$("#id").val(p.id);
		this.CoordenadaAux = {
			lat: p.latitude,
			lng: p.longitude
		}
		this.kmAtual = parseFloat(p.km);
		$("#longitude").val(p.longitude).trigger("change");
		$("#latitude").val(p.latitude).trigger("change");
		$("#km").val(parseFloat(p.km).toFixed(3)).trigger("change");
		$("#rodovia").val(p.rodovia).trigger("change");
		$("#raio").val(p.raio).trigger("change");
		$("#sentido").val(p.sentido).trigger("change");
		$("#nome").val(p.nome).trigger("change");
		this.kmAlterado = false;
		localStorage.setItem("ponto", JSON.stringify(this.Ponto));
	}
	historico() {
		this.exportar(JSON.parse(localStorage.getItem("ponto")));
	}
	Iniciar() {
		this.map = new google.maps.Map(document.getElementById('map-canvas'), {
			center: new google.maps.LatLng(-30.567784505730394, -70.689965606392),
			zoom: 12,
			mapTypeId: 'roadmap',
			styles: [
				{ "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
				{ "featureType": "administrative.land_parcel", "elementType": "labels", "stylers": [{ "visibility": "off" }] },
				{ "featureType": "landscape", "elementType": "labels.text.stroke", "stylers": [{ "visibility": "on" }] },
				{ "featureType": "poi", "stylers": [{ "visibility": "off" }] },
				{ "featureType": "road", "elementType": "geometry.stroke", "stylers": [{ "visibility": "off" }] },
				{ "featureType": "road", "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
				{ "featureType": "road", "elementType": "labels.text.stroke", "stylers": [{ "visibility": "off" }] },
				{ "featureType": "road.arterial", "elementType": "geometry.stroke", "stylers": [{ "visibility": "off" }] },
				{ "featureType": "road.local", "elementType": "labels", "stylers": [{ "visibility": "off" }] },
				{ "featureType": "road.local", "elementType": "labels.text.fill", "stylers": [{ "visibility": "off" }] },
				{ "featureType": "transit", "stylers": [{ "visibility": "off" }] },
			]
		});

		this.Line = new google.maps.Polyline({
			path: [this.CoordenadaAux, this.CoordenadaAux],
			geodesic: true,
			strokeColor: '#000000',
			strokeOpacity: 0.9,
			strokeWeight: 4
		});

		this.Range = new google.maps.Circle({
			strokeColor: "#000"
			, strokeOpacity: 0.8
			, strokeWeight: 2
			, fillColor: "#000"
			, fillOpacity: 0.35
			, map: this.map
			, center: {
				lat: 0
				, lng: 0
			}
			, radius: 500.0
		});

		this.Line.setMap(this.map);

		/* NOVO PONTO */
		google.maps.event.addListener(this.map, "click", (e) => this.NovoItem(e));
		google.maps.event.addListener(this.Line, "click", (e) => this.NovoItem(e));
		google.maps.event.addListener(this.Range, "click", (e) => this.NovoItem(e));


		/* ATUALIZAR DISTANCIA */
		google.maps.event.addListener(this.map, "mousemove", (e) => { this.Mover(e) });
		google.maps.event.addListener(this.Line, "mousemove", (e) => { this.Mover(e) });
		google.maps.event.addListener(this.Range, "mousemove", (e) => { this.Mover(e) });

		/* */

		$("#novo").on("click", () => this.converter());
		$("#km").val((0).toFixed(3));
		$("#raio").val("500");
		$("#raio").on("change", (e) => this.Range.setRadius(parseFloat($(e.currentTarget).val() || "0")));
		$("#km").on("change", (e) => {
			this.kmAlterado = true;
			this.kmAtual = parseFloat(parseFloat($(e.currentTarget).val() || "0").toFixed(3))
		});
		$("#historico").on("click", () => this.historico());
		$("#importar").on("click", () => this.importarMarcadores());
		$("#mostrar-historico").on("click", () => {
			this.Importacao.forEach(x => x.setVisible(!this.toogleHistorico));
			this.toogleHistorico = !this.toogleHistorico;
		});


		//this.LerConfiguracao();
	}
	ValidarExibicao(voltar = false) {

		if (voltar) {
			this.Marcador.forEach(x => x.setVisible(true));
			this.Circulo.forEach(x => x.setVisible(true));
		}
		if (app.Ponto.length > 2)
			this.Marcador.filter((x, i, a) => i < (a.length - 2) && x.getVisible() && !(i == 0 || (i % 10 == 0))).forEach(x => x.setVisible(false));
		if (app.Ponto.length > this.QuantidadeMaximaExibicao)
			this.Circulo.filter((x, i, a) => i < (a.length - this.QuantidadeMaximaExibicao) && x.getVisible() && !(i == 0 || (i % 10 == 0))).forEach(x => x.setVisible(false));
	}
	NovoItem(e) {
		if (this.Novo) {
			if (!this.kmAlterado) {
				let d = this.Ponto.length == 0 ? 0 : this.ObterDistancia(this.CoordenadaAux, { lat: e.latLng.lat(), lng: e.latLng.lng() });
				this.kmAtual += +((parseInt(parseFloat(d)) / 1000.0).toFixed(3));
				$("#km").val(this.kmAtual);
			}
			this.AdicionarPonto(e.latLng.lng(), e.latLng.lat());
			this.CoordenadaAux = {
				lat: e.latLng.lat(),
				lng: e.latLng.lng()
			};
			this.kmAlterado = false;

		}
	}
	Mover(e) {
		let d = this.ObterDistancia(
			this.CoordenadaAux,
			{
				lat: e.latLng.lat(),
				lng: e.latLng.lng()
			}
		);
		$("#t1").text("Total : " + (parseFloat(d)).toFixed(1));
		$("#t2").text("Raio  : " + (d / 2.0).toFixed(1));
		this.Line.setPath([this.CoordenadaAux, {
			lat: e.latLng.lat(),
			lng: e.latLng.lng()
		}]);
		this.Range.setCenter({
			lat: e.latLng.lat(),
			lng: e.latLng.lng()
		});
	}
	ObterDistancia(p1, p2) {
		var deg2rad = (deg) => deg * (Math.PI / 180),
			R = 6371,
			dLat = deg2rad(p2.lat - p1.lat),
			dLng = deg2rad(p2.lng - p1.lng),
			a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
				+ Math.cos(deg2rad(p1.lat))
				* Math.cos(deg2rad(p1.lat))
				* Math.sin(dLng / 2) * Math.sin(dLng / 2),
			c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return ((R * c * 1000).toFixed());
	}
	AdicionarPonto(lon, lat) {
		const id = this.Ponto.length == 0 ? 1 : Math.max(...app.Ponto.map(x => x.id)) + 1;

		this.Ponto.push({
			id: id
			, longitude: lon
			, latitude: lat
			, km: (parseFloat(this.kmAtual) || 0).toFixed("3")
			, rodovia: $("#rodovia").val()
			, raio: parseFloat($("#raio").val()) || 500.0
			, sentido: $("#sentido").val()
			, nome: $("#nome").val()
		});

		this.AdicionarMarcador({
			radius: $("#raio").val() || 500.0
			, icon: this.CorMarcador("#3bd1d8")
			, position: {
				lat: lat
				, lng: lon
			}
			, map: this.map
			, title: ''
		});

		this.ValidarExibicao();

		$("#longitude").val(lon);
		$("#latitude").val(lat);
		$("#id").val(id);
		localStorage.setItem("ponto", JSON.stringify(this.Ponto));
		//this.salvarConfiguracao();
	}
	AdicionarMarcador(o) {
		this.Marcador.push(new google.maps.Marker(o));
		this.AdicionarCirculo(o);
	}
	AdicionarCirculo(o) {
		this.Circulo.push(
			new google.maps.Circle({
				strokeColor: o.icon.strokeColor
				, strokeOpacity: 0.8
				, strokeWeight: o.icon.strokeWeight
				, fillColor: o.icon.fillColor
				, fillOpacity: 0.35
				, map: this.map
				, title: o.title
				, center: {
					lat: o.position.lat
					, lng: o.position.lng
				}
				, radius: parseFloat(o.radius)
			}));
		this.ValidarExibicao();
		google.maps.event.addListener(this.Circulo[this.Circulo.length - 1], 'mouseover', function () {
			this.getMap().getDiv().setAttribute('title', this.get('title'));
		});
		google.maps.event.addListener(this.Circulo[this.Circulo.length - 1], "mousemove", (e) => { this.Mover(e) });
	}
	CorMarcador(color) {
		return {
			path: 'M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1,1 10,-30 C 10,-22 2,-20 0,0 z M -2,-30 a 2,2 0 1,1 4,0 2,2 0 1,1 -4,0',
			fillColor: color,
			fillOpacity: 1,
			strokeColor: '#000',
			strokeWeight: 2,
			scale: 1,
		};
	}
}

let app;
function Iniciar() {
	app = new Mapa();
	app.Iniciar();
}










// Função que calcula a distância entre dois pontos usando a fórmula de haversine
function haversineDistance(lat1, lon1, lat2, lon2) {
	function toRadians(degrees) { return degrees * Math.PI / 180; }
	function toDegrees(radians) { return radians * 180 / Math.PI; }

	const R = 6371; // Raio da Terra em km
	const dLat = toRadians(lat2 - lat1);
	const dLon = toRadians(lon2 - lon1);
	const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
		Math.sin(dLon / 2) * Math.sin(dLon / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return parseFloat((R * c).toFixed(3)); // Retorna a distância em km
}
function haversineDistanceObjeto(p1, p2) {
	return haversineDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
}

var pontos = [
	{ "id": 1, "longitude": -46.02798044067958, "latitude": -23.78749483361417, "km": "211.400", "rodovia": "", "raio": 500, "sentido": "N", "nome": "" },
	{ "id": 2, "longitude": -46.08801903431406, "latitude": -23.805535135370512, "km": "211.400", "rodovia": "", "raio": 50, "sentido": "N", "nome": "" },
];
function divisaoDePontos(stepKm = 0.1) {
	const distance = haversineDistance(pontos[0].latitude, pontos[0].longitude, pontos[1].latitude, pontos[1].longitude);
	const points = [pontos[0], { ...pontos[0], raio: 50 }]
	const steps = Math.floor(distance / stepKm);

	for (let i = 1; i < steps; i++) {
		const fraction = parseFloat((i / steps).toFixed(3));
		const longitude = pontos[0].longitude + fraction * (pontos[1].longitude - pontos[0].longitude);
		const latitude = pontos[0].latitude + fraction * (pontos[1].latitude - pontos[0].latitude);

		const ultimaPosicao = points.length - 1;
		const km = (parseFloat(points[ultimaPosicao].km) + stepKm).toFixed(3)
		console.log(distance, fraction, steps, longitude, latitude)
		const inteiro = parseInt((km + "").split(".")[1]) == 0
		points.push({
			"id": i + 1,
			"longitude": longitude,
			"latitude": latitude,
			"km": km,
			"rodovia": points[ultimaPosicao].rodovia,
			"raio": inteiro ? 500 : (stepKm * 1000 / 2),
			"sentido": points[ultimaPosicao].sentido,
			"nome": points[ultimaPosicao].nome,
		})
	}
	points.push(pontos[1], { ...pontos[1], raio: 50 });
	return JSON.stringify(points).replace(/\[|\]/g, "") + ",";
}
divisaoDePontos();





// var pontos2 = [
// 	{"id":107,"longitude":-46.288772039454386,"latitude":-23.9154310339856,"km":"241.625","rodovia":"","raio":50,"sentido":"N","nome":""},											
// ];

function divisao(listaPontos, distanciaDeCorte = 0.1) {
	const rodovia = listaPontos[0].rodovia;
	const sentido = listaPontos[0].sentido;
	const nome = listaPontos[0].nome;
	var km = parseFloat(listaPontos[0].km);
	var id = 1;
	var ultimoComprimentoCiclo = null;

	var pontos = [{
		longitude: listaPontos[0].longitude,
		latitude: listaPontos[0].latitude,
		km, rodovia, sentido, nome,
		"id": id++,
		"raio": parseInt(distanciaDeCorte * 1000 / 2),
	}];

	for (let p = 0; p < (listaPontos.length - 1); p++) {
		if (true) {
			const ponto1 = listaPontos[p];
			const ponto2 = listaPontos[p + 1];
			const distancia = haversineDistanceObjeto(ponto1, ponto2);
			const arrayCiclos = ObterDistanciasDosCiclos(distancia, distanciaDeCorte, ultimoComprimentoCiclo);

			var cicloAcumulado = 0;
			for (let c = 0; c < arrayCiclos.length; c++) {
				var [comprimentoCiclo, cicloAtual] = arrayCiclos[c];
				cicloAcumulado = cicloAcumulado + cicloAtual;
				cicloAcumuladoFormatado = parseFloat(cicloAcumulado.toFixed(3))

				const longitude = ponto1.longitude + cicloAcumuladoFormatado * (ponto2.longitude - ponto1.longitude);
				const latitude = ponto1.latitude + cicloAcumuladoFormatado * (ponto2.latitude - ponto1.latitude);

				km = parseFloat((km + (cicloAtual * distancia)).toFixed(3));

				const ponto = {
					longitude, latitude, km, rodovia, sentido, nome,
					"id": id++,
					"raio": parseInt(comprimentoCiclo * 1000 / 2),
				};
				if (comprimentoCiclo >= distanciaDeCorte) {
					pontos.push(ponto);
				}
				ultimoComprimentoCiclo = comprimentoCiclo;
				console.log(distancia, cicloAcumuladoFormatado, arrayCiclos.length, ponto);
			}

			console.log(ponto1, ponto2, arrayCiclos);
		}
	}
	console.log(JSON.stringify(pontos).replace(/\[|\]/g, "") + ",");
	return pontos;

	function ObterDistanciasDosCiclos(distancia, distanciaDeCorte, ultimoComprimentoCiclo = null) {
		if (ultimoComprimentoCiclo != null) {
			const distanciaReal = (distancia + ultimoComprimentoCiclo);
			const ciclos = Math.floor(distanciaReal / distanciaDeCorte); //64
			const restoCiclos = parseFloat((distanciaReal - (Math.floor(distanciaReal / distanciaDeCorte) * distanciaDeCorte)).toFixed(3))//0.029
			var tab = [...Array(ciclos).fill(distanciaDeCorte), restoCiclos];

			tab[0] = tab[0] - ultimoComprimentoCiclo;
			tab = tab.map((x, i) => [(i == 0 ? (x + ultimoComprimentoCiclo) : x), x / distancia]);
			console.log(distancia, distanciaDeCorte, ultimoComprimentoCiclo, tab)
			return tab;
		} else {
			const ciclos = Math.floor(distancia / distanciaDeCorte); //64
			const restoCiclos = parseFloat((distancia - (Math.floor(distancia / distanciaDeCorte) * distanciaDeCorte)).toFixed(3))//0.029
			var tab = [...Array(ciclos).fill(distanciaDeCorte), restoCiclos];

			tab = tab.map(x => [x, x / distancia]);
			console.log(distancia, distanciaDeCorte, ultimoComprimentoCiclo, tab)
			return tab;
		}
	}

	/*
		const distance = haversineDistance(
				pontos[0].latitude, 
				pontos[0].longitude, 
				pontos[1].latitude, 
				pontos[1].longitude
		);
		const points = [ pontos[0], {...pontos[0] , raio : 50 } ] 
		const steps = Math.floor(distance/stepKm);

		for (let  i = 1; i < steps; i++){
				const fraction = parseFloat((i/steps).toFixed(3));
				const longitude = pontos[0].longitude + fraction * (pontos[1].longitude - pontos[0].longitude);
				const latitude = pontos[0].latitude + fraction * (pontos[1].latitude - pontos[0].latitude);
				
				const ultimaPosicao = points.length-1;
				const km = (parseFloat(points[ultimaPosicao].km) + stepKm).toFixed(3)

				const inteiro = parseInt((km+"").split(".")[1]) == 0 
				points.push({
						"id":i+1,
						"longitude":longitude,
						"latitude":latitude,
						"km": km,
						"rodovia":points[ultimaPosicao].rodovia,
						"raio": inteiro ? 500 : (stepKm * 1000 / 2),
						"sentido":points[ultimaPosicao].sentido,
						"nome":points[ultimaPosicao].nome,
				})
		}
		points.push(pontos[1], {...pontos[1] , raio : 50 });
		return JSON.stringify(points).replace(/\[|\]/g,"")+",";
		*/
}

divisao(pontos2);
