const express = require("express")
const axios = require("axios")

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ============================
// CONFIG
// ============================

const PHONE_ID = "937736869432295"
const TOKEN = process.env.WHATSAPP_TOKEN
const ADMIN_PHONE = "50379191790"

const guias = {}
const mensajesEnviados = {}

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================
// CONSULTAR TELEFONO EN C807
// ============================

async function obtenerTelefonoDesdeC807(guia, intentos = 3) {

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

      console.log("Error consultando C807:", err.message)

      if (i === intentos) {
        return null
      }

      console.log("Reintentando en 3 segundos...")
      await sleep(3000)

    }

  }

}

// ============================
// ENVIAR WHATSAPP
// ============================

async function enviarWhatsApp(telefono, mensaje, guia = "", estatus = "") {

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

${!enviadoCliente ? `Error: ${JSON.stringify(errorCliente)}` : ""}

Mensaje enviado:
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
    cliente
  }

  console.log("Guía registrada manualmente:", guia)

  res.json({ status: "ok" })

})

// ============================
// ENDPOINT DIAGNOSTICO C807
// ============================

app.get("/diagnostico-c807/:guia", async (req, res) => {

  const guia = req.params.guia
  const inicio = Date.now()

  try {

    const telefono = await obtenerTelefonoDesdeC807(guia, 1)

    const tiempo = Date.now() - inicio

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

    let cliente = guias[guia]
    let telefono = cliente?.telefono

    if (!telefono) {

      telefono = await obtenerTelefonoDesdeC807(guia)

      if (!telefono) {
        console.log("No se pudo obtener teléfono")
        return res.sendStatus(200)
      }

    }

    let mensaje = null
    const estatusLower = estatus.toLowerCase()

    if (estatus === "Creado en sistema") {

      mensaje = `📦 C807 Express - Cocinas de Empotrar SV

Tu pedido ha sido registrado.

Guía: ${guia}

Seguimiento:
https://c807xpress.com/tracking/?guia=${guia}`

    }

    else if (estatusLower.includes("ruta")) {

      mensaje = `🚚 Tu pedido va en camino.

Guía: ${guia}

Seguimiento:
https://c807xpress.com/tracking/?guia=${guia}`

    }

    else if (
      estatusLower.includes("destino") ||
      estatusLower.includes("entregado")
    ) {

      mensaje = `✅ Tu pedido fue entregado.

Guía: ${guia}

Historial:
https://c807xpress.com/tracking/?guia=${guia}

Gracias por confiar en Cocinas de Empotrar SV.`

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

    console.log("Error procesando webhook:", err.message)

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