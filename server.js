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
const C807_TOKEN = process.env.C807_TOKEN || ""

// base de datos simple (memoria)
const guias = {}
const mensajesEnviados = {}

// ============================
// CONSULTAR TELEFONO EN C807
// ============================

async function obtenerTelefonoDesdeC807(guia) {

  try {

    const url = `https://app.c807.com/guia.php/madre/ver?guia=${guia}`

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${C807_TOKEN}`,
        Accept: "application/json"
      }
    })

    const data = response.data

    const telefono =
      data?.destinatario?.telefono ||
      data?.telefono ||
      null

    if (!telefono) {
      console.log("No se encontró teléfono en C807")
      return null
    }

    console.log("Telefono encontrado en C807:", telefono)

    return telefono

  } catch (err) {

    console.log("Error consultando C807:", err.message)

    return null

  }

}

// ============================
// ENVIAR WHATSAPP
// ============================

async function enviarWhatsApp(telefono, mensaje) {

  try {

    await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: telefono,
        type: "text",
        text: {
          body: mensaje
        }
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    )

    console.log("Mensaje enviado a:", telefono)

  } catch (error) {

    console.log("Error enviando WhatsApp:", error.response?.data || error.message)

  }

}

// ============================
// REGISTRAR GUIA MANUAL
// ============================

app.post("/registrar-guia", (req, res) => {

  const { guia, telefono, cliente } = req.body

  guias[guia] = {
    telefono,
    cliente
  }

  console.log("Guía registrada manualmente:", guia)

  res.json({ status: "ok" })

})

// ============================
// WEBHOOK C807
// ============================

app.post("/webhook-c807", async (req, res) => {

  try {

    console.log("Webhook recibido:", req.body)

    let raw = Object.keys(req.body)[0]

    if (!raw) {
      console.log("Webhook vacío")
      return res.sendStatus(200)
    }

    let data

    try {

      data = JSON.parse(raw)

    } catch (e) {

      console.log("JSON complejo recibido")

      const guia = raw.match(/"guia":"([^"]+)"/)?.[1]
      const estatus = raw.match(/"estatus":"([^"]+)"/)?.[1]

      data = { guia, estatus }

    }

    const guia = data?.guia
    const estatus = data?.estatus || ""

    if (!guia) {
      console.log("Webhook sin guía")
      return res.sendStatus(200)
    }

    console.log("Guia:", guia)
    console.log("Estatus:", estatus)

    // evitar duplicados
    const clave = guia + estatus

    if (mensajesEnviados[clave]) {
      console.log("Mensaje ya enviado")
      return res.sendStatus(200)
    }

    mensajesEnviados[clave] = true

    let cliente = guias[guia]
    let telefono = cliente?.telefono

    // si no está registrado, consultar C807
    if (!telefono) {

      telefono = await obtenerTelefonoDesdeC807(guia)

      if (!telefono) {
        console.log("No se pudo obtener teléfono")
        return res.sendStatus(200)
      }

    }

    // ============================
    // MENSAJE CUANDO SE CREA
    // ============================

    if (estatus === "Creado en sistema") {

      const mensaje = `📦 C807 Express - Cocinas de Empotrar SV

Tu pedido ha sido registrado en nuestro sistema.

Guía: ${guia}

Pronto será recolectado por el servicio de paquetería 🚚

Seguimiento:
https://c807xpress.com/tracking/?guia=${guia}`

      await enviarWhatsApp(telefono, mensaje)

    }

    // ============================
    // CUANDO VA EN RUTA
    // ============================

    if (estatus.toLowerCase().includes("ruta")) {

      const mensaje = `🚚 C807 Express - Cocinas de Empotrar SV

Tu pedido ya va en camino.

Guía: ${guia}

Seguimiento:
https://c807xpress.com/tracking/?guia=${guia}`

      await enviarWhatsApp(telefono, mensaje)

    }

    // ============================
    // CUANDO SE ENTREGA
    // ============================

    if (estatus.toLowerCase().includes("destino")) {

      const mensaje = `✅ C807 Express - Cocinas de Empotrar SV

Tu pedido fue entregado exitosamente.

Guía: ${guia}

Historial:
https://c807xpress.com/tracking/?guia=${guia}

Gracias por confiar en nosotros 🙌`

      await enviarWhatsApp(telefono, mensaje)

    }

  } catch (err) {

    console.log("Error procesando webhook:", err)

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