let variables = [];
let grafica = null;

async function cargar() {
  const res = await fetch("variables.json");
  const data_json = await res.json();
  variables = data_json.variables;

  const lista = document.getElementById("lista");
  const select = document.getElementById("variable");

  for (const v of variables) {
    lista.innerHTML += `<li>${v.name_es} (${v.source})</li>`;

    // Solo POWER: es la única fuente con API simple para este test
    if (v.source === "power") {
      const marca = v.status === "check" ? " ⚠" : "";
      select.innerHTML += `<option value="${v.id}">${v.name_es}${marca}</option>`;
    }
  }

  document.getElementById("boton").addEventListener("click", consultar);
}

async function consultar() {
  const aviso = document.getElementById("aviso");
  const estado = document.getElementById("estado");

  const v = variables.find(x => x.id === document.getElementById("variable").value);
  const lat = document.getElementById("lat").value;
  const lon = document.getElementById("lon").value;
  const inicio = document.getElementById("inicio").value;
  const fin = document.getElementById("fin").value;

  // Avisos del JSON
  const avisos = [];
  if (v.status === "check") {
    avisos.push("Variable sin confirmar en la API mensual: puede fallar. " + (v.fetch_note ?? ""));
  }
  for (const n of v.quality_notes) avisos.push(n.text_es);
  aviso.textContent = avisos.join(" | ");

  const url =
    "https://power.larc.nasa.gov/api/temporal/monthly/point" +
    `?parameters=${v.api_code}&community=AG` +
    `&longitude=${lon}&latitude=${lat}&start=${inicio}&end=${fin}&format=JSON`;

  estado.textContent = "Cargando...";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`POWER respondió ${res.status}`);
    const json = await res.json();

    const serie = json.properties.parameter[v.api_code];
    const unidades = json.parameters?.[v.api_code]?.units ?? v.units_hint;

    // Claves tipo "201501"; las que terminan en "13" son el promedio anual: se omiten.
    // -999 es el valor de "sin dato".
    const etiquetas = [];
    const valores = [];
    for (const [clave, valor] of Object.entries(serie)) {
      if (clave.endsWith("13")) continue;
      etiquetas.push(`${clave.slice(0, 4)}-${clave.slice(4)}`);
      valores.push(valor === -999 ? null : valor);
    }

    dibujar(etiquetas, valores, `${v.name_es} (${unidades})`);
    estado.textContent = `${valores.length} meses cargados`;
  } catch (err) {
    estado.textContent = "Error: " + err.message;
    console.error(err);
  }
}

function dibujar(etiquetas, valores, titulo) {
  if (grafica) grafica.destroy(); // evita superponer gráficas
  grafica = new Chart(document.getElementById("grafica"), {
    type: "line",
    data: {
      labels: etiquetas,
      datasets: [{ label: titulo, data: valores, borderColor: "#1b6ec2", tension: 0.2 }],
    },
  });
}

cargar();
