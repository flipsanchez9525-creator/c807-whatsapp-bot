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
  const auth = new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  })

  return google.sheets({ version: "v4", auth })
}

async function buscarGuiaEnSheets(guiaBuscada) {
  try {
    const sheets = getSheetsClient()

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "GUIAS_BOT!A:D"
    })

    const rows = response.data.values || []

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
    console.log("Error consultando Google Sheets:", error.message)
    return null
  }
}

// ============================
// UTILIDADES
// ============================

function normalizarTelefono(numero) {
  if (!numero) return null

  let limpio = String(numero).replace(/\D/g, "")

  if (!limpio.startsWith("503")) {
    limpio = "503" + limpio
  }

  return limpio
}

function decodificarTextoEscapado(texto) {
  if (typeof texto !== "string") return texto

  try {
    return JSON.parse(`"${texto.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
  } catch {
    return texto
  }
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

      const telefono = response.data?.datos?.destinatario?.telefono
      const codigo = response.data?.datos?.destinatario?.codigo_area || "503"

      if (!telefono) return null

      return normalizarTelefono(`${codigo}${telefono}`)

    } catch (err) {

      console.log("Error consultando C807:", err.message)

      if (i === intentos) return null

      console.log("Reintentando C807 en 3 segundos...")
      await sleep(3000)
    }
  }

  return null
}

// ============================
// ENVIAR WHATSAPP
// ============================

async function enviarWhatsApp(
  telefono,
  mensaje,
  guia = "",
  estatus = "",
  nombreCliente = ""
) {

  const telefonoCliente = normalizarTelefono(telefono)
  const telefonoAdmin = normalizarTelefono(ADMIN_PHONE)

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
        }
      }
    )

    enviadoCliente = true

  } catch (error) {

    errorCliente = error.response?.data || error.message
    console.log("Error enviando al cliente:", errorCliente)

  }

  try {

    const copiaAdmin = `📢 REPORTE DE ENVÍO

Guía: ${guia}
Estatus: ${estatus}
Cliente: ${nombreCliente || "No disponible"}
Teléfono: ${telefonoCliente}
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
        }
      }
    )

    enviadoAdmin = true

  } catch (error) {

    console.log("Error enviando copia:", error.message)

  }

  return {
    enviadoCliente,
    enviadoAdmin,
    errorCliente
  }
}

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
    } else {
      try {
        data = JSON.parse(raw)
      } catch {

        const guia = raw.match(/"guia":"([^"]+)"/)?.[1]
        const estatus = raw.match(/"estatus":"([^"]+)"/)?.[1]

        data = { guia, estatus }
      }
    }

    const guia = decodificarTextoEscapado(data?.guia)
    const estatus = decodificarTextoEscapado(data?.estatus || "")

    if (!guia) return res.sendStatus(200)

    const clave = `${guia}|${estatus}`

    if (mensajesEnviados[clave]) {
      return res.sendStatus(200)
    }

    let telefono = normalizarTelefono(guias[guia]?.telefono)
    let nombreCliente = guias[guia]?.cliente || ""

    if (!telefono) {

      const datoSheet = await buscarGuiaEnSheets(guia)

      if (datoSheet?.telefono) {
        telefono = normalizarTelefono(datoSheet.telefono)
        nombreCliente = datoSheet.cliente
      }

    }

    if (!telefono) {
      telefono = await obtenerTelefonoDesdeC807(guia)
    }

    if (!telefono) {
      console.log("No se pudo obtener teléfono")
      return res.sendStatus(200)
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

    } else if (estatusLower.includes("destino") || estatusLower.includes("entregado")) {

      mensaje = `✅ C807 Express - Cocinas de Empotrar SV

Tu pedido fue entregado exitosamente.

Guía: ${guia}

Historial:
https://c807xpress.com/tracking/?guia=${guia}

Gracias por confiar en nosotros 🙌`
    }

    if (!mensaje) return res.sendStatus(200)

    const resultado = await enviarWhatsApp(
      telefono,
      mensaje,
      guia,
      estatus,
      nombreCliente
    )

    if (resultado.enviadoCliente || resultado.enviadoAdmin) {
      mensajesEnviados[clave] = true
    }

    console.log("Resultado envío:", resultado)

  } catch (err) {

    console.log("Error webhook:", err.message)

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