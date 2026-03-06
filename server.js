const express = require("express")
const axios = require("axios")
const { google } = require("googleapis")

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ============================
// CONFIG
// ============================

const PHONE_ID = "937736869432295"
const TOKEN = process.env.WHATSAPP_TOKEN
const ADMIN_PHONE = "50379191790"

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
  ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
  : null

const guias = {}
const mensajesEnviados = {}

// ============================
// GOOGLE SHEETS
// ============================

function getSheetsClient() {
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error("Faltan credenciales de Google Sheets")
  }

  const auth = new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  })

  return google.sheets({ version: "v4", auth })
}

async function buscarGuiaEnSheets(guiaBuscada) {
  if (!GOOGLE_SHEET_ID) {
    console.log("No está configurado GOOGLE_SHEET_ID")
    return null
  }

  try {
    const sheets = getSheetsClient()

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "GUIAS_BOT!A:D"
    })

    const rows = response.data.values || []

    if (rows.length < 2) {
      console.log("La hoja GUIAS_BOT está vacía o solo tiene encabezados")
      return null
    }

    // Espera columnas:
    // A = Guía
    // B = Telefono
    // C = Cliente
    // D = Estado
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const guia = String(row[0] || "").trim()
      const telefono = String(row[1] || "").trim()
      const cliente = String(row[2] || "").trim()
      const estado = String(row[3] || "").trim()

      if (guia === guiaBuscada) {
        console.log("Guía encontrada en Google Sheets:", guiaBuscada)
        return {
          guia,
          telefono,
          cliente,
          estado,
          fila: i + 1
        }
      }
    }

    console.log("Guía no encontrada en Google Sheets:", guiaBuscada)
    return null
  } catch (error) {
    console.log(
      "Error consultando Google Sheets:",
      error.response?.data || error.message
    )
    return null
  }
}

// ============================
// UTILIDADES
// ============================

function normalizarTelefono(numero) {
  if (!numero) return null

  let limpio = String(numero).replace(/\D/g, "")

  if (!limpio) return null

  if (!limpio.startsWith("503")) {
    limpio = "503" + limpio
  }

  return limpio
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================
// CONSULTAR TELEFONO EN C807
// ============================

async function obtenerTelefonoDesdeC807(guia, intentos = 2) {
  const url = `https://app.c807.com/guia.php/madre/ver?guia=${guia}`

  for (let i = 1; i <= intentos; i++) {
    try {
      console.log(`Consultando C807 intento ${i}:`, url)

      const response = await axios.get(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0"
        },
        timeout: 30000
      })

      const data = response.data
      const telefono = data?.datos?.destinatario?.telefono
      const codigo = data?.datos?.destinatario?.codigo_area || "503"

      if (!telefono) {
        console.log("No se encontró teléfono en C807")
        return null
      }

      const telefonoCompleto = normalizarTelefono(`${codigo}${telefono}`)

      console.log("Telefono encontrado en C807:", telefonoCompleto)

      return telefonoCompleto
    } catch (err) {
      console.log("Error consultando C807:", err.response?.data || err.message)

      if (i === intentos) {
        return null
      }

      console.log("Reintentando C807 en 3 segundos...")
      await sleep(3000)
    }
  }

  return null
}

// ============================
// ENVIAR WHATSAPP
// ============================

async function enviarWhatsApp(telefono, mensaje, guia = "", estatus = "") {
  const telefonoCliente = normalizarTelefono(telefono)
  const telefonoAdmin = normalizarTelefono(ADMIN_PHONE)

  if (!telefonoCliente) {
    return {
      enviadoCliente: false,
      enviadoAdmin: false,
      errorCliente: "Telefono cliente inválido"
    }
  }

  let enviadoCliente = false
  let enviadoAdmin = false
  let errorCliente = null

  try {
    await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: telefonoCliente,
        type: "text",
        text: { body: mensaje }
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    )

    enviadoCliente = true
    console.log("Mensaje enviado a cliente:", telefonoCliente)
  } catch (error) {
    errorCliente = error.response?.data || error.message
    console.log("Error enviando al cliente:", errorCliente)
  }

  try {
    const copiaAdmin = `📢 REPORTE DE ENVÍO

Guía: ${guia}
Estatus: ${estatus}
Cliente: ${telefonoCliente}
Resultado cliente: ${enviadoCliente ? "ENVIADO" : "FALLÓ"}

${!enviadoCliente ? `Error: ${JSON.stringify(errorCliente)}\n` : ""}Mensaje enviado:
${mensaje}`

    await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: telefonoAdmin,
        type: "text",
        text: { body: copiaAdmin }
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    )

    enviadoAdmin = true
    console.log("Copia enviada al admin")
  } catch (error) {
    console.log("Error enviando copia:", error.response?.data || error.message)
  }

  return {
    enviadoCliente,
    enviadoAdmin,
    errorCliente
  }
}

// ============================
// REGISTRAR GUIA MANUAL
// ============================

app.post("/registrar-guia", (req, res) => {
  const { guia, telefono, cliente } = req.body

  if (!guia) {
    return res.status(400).json({ error: "Guía requerida" })
  }

  guias[guia] = {
    telefono: normalizarTelefono(telefono),
    cliente: cliente || ""
  }

  console.log("Guía registrada manualmente:", guia)

  res.json({ status: "ok", guia })
})

// ============================
// DIAGNOSTICO GOOGLE SHEETS
// ============================

app.get("/diagnostico-sheets/:guia", async (req, res) => {
  const { guia } = req.params

  const resultado = await buscarGuiaEnSheets(guia)

  if (!resultado) {
    return res.status(404).json({
      ok: false,
      guia,
      mensaje: "Guía no encontrada en Google Sheets"
    })
  }

  return res.json({
    ok: true,
    data: resultado
  })
})

// ============================
// VER QUE ESTA LEYENDO SHEETS
// ============================

app.get("/ver-sheets", async (req, res) => {

  try {

    const sheets = getSheetsClient()

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "GUIAS_BOT!A:D"
    })

    const rows = response.data.values || []

    res.json({
      filas_encontradas: rows.length,
      primeras_filas: rows.slice(0, 10)
    })

  } catch (error) {

    res.json({
      error: error.message
    })

  }

})

// ============================
// DIAGNOSTICO C807
// ============================

app.get("/diagnostico-c807/:guia", async (req, res) => {
  const { guia } = req.params
  const inicio = Date.now()

  try {
    const telefono = await obtenerTelefonoDesdeC807(guia, 1)
    const tiempo = Date.now() - inicio

    if (!telefono) {
      return res.status(504).json({
        ok: false,
        guia,
        telefono: null,
        tiempo_ms: tiempo,
        mensaje: "No se pudo obtener teléfono desde C807"
      })
    }

    res.json({
      ok: true,
      guia,
      telefono,
      tiempo_ms: tiempo
    })
  } catch (error) {
    const tiempo = Date.now() - inicio

    res.status(500).json({
      ok: false,
      guia,
      error: error.message,
      tiempo_ms: tiempo
    })
  }
})

// ============================
// WEBHOOK C807
// ============================

app.post("/webhook-c807", async (req, res) => {
  try {
    console.log("Webhook recibido:", req.body)

    let raw = Object.keys(req.body)[0]
    let data

    if (req.body.guia) {
      data = req.body
    } else if (raw) {
      try {
        data = JSON.parse(raw)
      } catch (e) {
        console.log("JSON complejo recibido")

        const guia = raw.match(/"guia":"([^"]+)"/)?.[1]
        const estatus = raw.match(/"estatus":"([^"]+)"/)?.[1]

        data = { guia, estatus }
      }
    } else {
      console.log("Webhook vacío")
      return res.sendStatus(200)
    }

    const guia = data?.guia
    const estatus = data?.estatus || ""

    if (!guia) {
      console.log("Webhook sin guía")
      return res.sendStatus(200)
    }

    console.log("Guia:", guia)
    console.log("Estatus:", estatus)

    const clave = `${guia}|${estatus}`

    if (mensajesEnviados[clave]) {
      console.log("Mensaje ya enviado")
      return res.sendStatus(200)
    }

    // 1) memoria local
    let telefono = normalizarTelefono(guias[guia]?.telefono)

    // 2) Google Sheets
    if (!telefono) {
      const datoSheet = await buscarGuiaEnSheets(guia)

      if (datoSheet?.telefono) {
        telefono = normalizarTelefono(datoSheet.telefono)
        console.log("Teléfono obtenido desde Google Sheets:", telefono)
      }
    }

    // 3) C807 como respaldo
    if (!telefono) {
      telefono = await obtenerTelefonoDesdeC807(guia)

      if (!telefono) {
        console.log("No se pudo obtener teléfono ni por Sheets ni por C807")
        return res.sendStatus(200)
      }
    }

    let mensaje = null
    const estatusLower = estatus.toLowerCase()

    if (estatus === "Creado en sistema") {
      mensaje = `📦 C807 Express - Cocinas de Empotrar SV

Tu pedido ha sido registrado en nuestro sistema.

Guía: ${guia}

Seguimiento:
https://c807xpress.com/tracking/?guia=${guia}`
    } else if (estatusLower.includes("ruta")) {
      mensaje = `🚚 C807 Express - Cocinas de Empotrar SV

Tu pedido ya va en camino.

Guía: ${guia}

Seguimiento:
https://c807xpress.com/tracking/?guia=${guia}`
    } else if (
      estatusLower.includes("destino") ||
      estatusLower.includes("entregado")
    ) {
      mensaje = `✅ C807 Express - Cocinas de Empotrar SV

Tu pedido fue entregado exitosamente.

Guía: ${guia}

Historial:
https://c807xpress.com/tracking/?guia=${guia}

Gracias por confiar en nosotros 🙌`
    }

    if (!mensaje) {
      console.log("Estatus sin mensaje configurado:", estatus)
      return res.sendStatus(200)
    }

    const resultado = await enviarWhatsApp(telefono, mensaje, guia, estatus)

    if (resultado.enviadoCliente || resultado.enviadoAdmin) {
      mensajesEnviados[clave] = true
    }

    console.log("Resultado envío:", resultado)
  } catch (err) {
    console.log("Error procesando webhook:", err.response?.data || err.message || err)
  }

  res.sendStatus(200)
})

// ============================
// HEALTHCHECK
// ============================

app.get("/", (req, res) => {
  res.send("Bot C807 activo")
})

// ============================

app.listen(3000, () => {
  console.log("Servidor escuchando en puerto 3000")
})