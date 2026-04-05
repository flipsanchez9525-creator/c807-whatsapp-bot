const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();

app.use(cors({
  origin: ["https://app.c807.com"],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.options("*", cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================
// CONFIG
// ============================

const PHONE_ID = "1122034414325237"
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

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  })

  await auth.authorize()

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

  if (!limpio) return null

  if (!limpio.startsWith("503")) {
    limpio = "503" + limpio
  }

  return limpio
}

function decodificarTextoEscapado(texto) {
  if (typeof texto !== "string") return texto

  return texto
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
}

// ============================
// ENVIAR TEMPLATE WHATSAPP
// ============================

async function enviarTemplateWhatsApp(
  telefono,
  templateName,
  parametros = [],
  guia = "",
  estatus = "",
  nombreCliente = ""
) {
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
  let respuestaCliente = null

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: telefonoCliente,
        type: "template",
        template: {
          name: templateName,
          language: { code: "es" },
          components: [
            {
              type: "body",
              parameters: parametros.map(valor => ({
                type: "text",
                text: String(valor || "")
              }))
            }
          ]
        }
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
    respuestaCliente = response.data
    console.log("Respuesta Meta cliente:", JSON.stringify(response.data))
  } catch (error) {
    errorCliente = error.response?.data || error.message
    console.log("Error enviando template al cliente:", errorCliente)
  }

  try {
    const copiaAdmin = `📢 REPORTE DE ENVÍO

Guía: ${guia}
Estatus: ${estatus}
Cliente: ${nombreCliente || "No disponible"}
Teléfono: ${telefonoCliente}
Template: ${templateName}
Parámetros: ${JSON.stringify(parametros)}
Resultado cliente: ${enviadoCliente ? "ENVIADO" : "FALLÓ"}

${!enviadoCliente ? `Error: ${JSON.stringify(errorCliente)}\n` : ""}
${enviadoCliente ? `Respuesta Meta: ${JSON.stringify(respuestaCliente)}\n` : ""}`

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
  } catch (error) {
    console.log("Error enviando copia admin:", error.response?.data || error.message)
  }

  return {
    enviadoCliente,
    enviadoAdmin,
    errorCliente,
    respuestaCliente
  }
}

// ============================
// ENVIAR WHATSAPP TEXTO LIBRE
// ============================
// Se deja por si luego quieres usarlo para pruebas internas o admin.

async function enviarWhatsApp(
  telefono,
  mensaje,
  guia = "",
  estatus = "",
  nombreCliente = ""
) {
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
        },
        timeout: 15000
      }
    )

    enviadoAdmin = true
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
// NUEVO ENDPOINT CREAR GUIA (FASE 1)
// ============================

app.post("/registrar-guia-fase1", async (req, res) => {
  try {
    const data = req.body || {}

    const sheets = await getSheetsClient()

    const values = [[
      new Date().toISOString(),
      data.guia || "",
      data.numero_orden || "",
      data.nombre || "",
      data.telefono || "",
      data.departamento || "",
      data.municipio || "",
      data.direccion || "",
      data.peso || "",
      data.contenido || "",
      data.tipo_servicio || "",
      data.estado_inicial || "Creada"
    ]]

    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "GUIAS_CREADAS!A:L",
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    })

    res.json({ ok: true, recibido: data })
  } catch (error) {
    console.error("Error registrando guía fase 1:", error.response?.data || error.message)
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    })
  }
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

    if (!guia) {
      return res.sendStatus(200)
    }

    const clave = `${guia}|${estatus}`

    if (mensajesEnviados[clave]) {
      console.log("Mensaje ya enviado:", clave)
      return res.sendStatus(200)
    }

    let telefono = normalizarTelefono(guias[guia]?.telefono)
    let nombreCliente = guias[guia]?.cliente || ""

    if (!telefono) {
      const datoSheet = await buscarGuiaEnSheets(guia)

      if (datoSheet?.telefono) {
        telefono = normalizarTelefono(datoSheet.telefono)
        nombreCliente = datoSheet.cliente || ""
      }
    }

    if (!telefono) {
      console.log("No se encontró teléfono en Google Sheets para la guía:", guia)
      return res.sendStatus(200)
    }

    const estatusLower = estatus.toLowerCase()
    const trackingUrl = `https://c807xpress.com/tracking/?guia=${guia}`

    let templateName = null
    let templateParams = []

    if (estatusLower.includes("ruta")) {
      templateName = "envio_en_ruta"
      templateParams = [guia, trackingUrl]
    } else if (
      estatusLower.includes("destino") ||
      estatusLower.includes("entregado")
    ) {
      templateName = "envio_entregado"
      templateParams = [guia, trackingUrl]
    }

    if (!templateName) {
      console.log("Estatus sin template configurado:", estatus)
      return res.sendStatus(200)
    }

    const resultado = await enviarTemplateWhatsApp(
      telefono,
      templateName,
      templateParams,
      guia,
      estatus,
      nombreCliente
    )

    if (resultado.enviadoCliente || resultado.enviadoAdmin) {
      mensajesEnviados[clave] = true
    }

    console.log("Resultado envío:", resultado)
  } catch (err) {
    console.log("Error webhook:", err.response?.data || err.message || err)
  }

  res.sendStatus(200)
})

// ============================
// HEALTHCHECK
// ============================

app.get("/", (req, res) => {
  res.send("Bot C807 activo")
})

app.get("/probar-admin", async (req, res) => {
  try {
    const resultado = await enviarWhatsApp(
      "50379191790",
      "Prueba directa al admin desde el bot 78069004",
      "PRUEBA-ADMIN",
      "Prueba manual",
      "Admin"
    )

    res.json({
      ok: true,
      resultado
    })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    })
  }
})

// ============================
// REENVIAR SOLO GUIAS EN RUTA
// ============================

app.get("/reenviar-ruta/:guia", async (req, res) => {
  try {
    const { guia } = req.params

    const datoSheet = await buscarGuiaEnSheets(guia)

    if (!datoSheet?.telefono) {
      return res.status(404).json({
        ok: false,
        guia,
        mensaje: "No se encontró la guía o el teléfono en Google Sheets"
      })
    }

const telefono = normalizarTelefono(datoSheet.telefono)
const nombreCliente = datoSheet.cliente || ""
const estatus = decodificarTextoEscapado(datoSheet.estado || "")

const trackingUrl = `https://c807xpress.com/tracking/?guia=${guia}`

const resultado = await enviarTemplateWhatsApp(
  telefono,
  "envio_en_ruta",
  [guia, trackingUrl],
  guia,
  "Reenvío manual - En ruta",
  nombreCliente
)

    return res.json({
      ok: true,
      guia,
      telefono,
      nombreCliente,
      estatus,
      resultado
    })
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    })
  }
})

// ============================

app.listen(3000, () => {
  console.log("Servidor escuchando en puerto 3000")
})